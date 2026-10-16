import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import crypto from "crypto";
import { z } from "zod";
import {
  verifyUserToken,
  getDirectConversationRecipient,
  getCallerProfile,
  saveCallRecord,
} from "./db.js";

// ─── Constants ──────────────────────────────────────────────────────────────
const RING_TIMEOUT_MS  = 40_000; // 40 s
const MAX_SDP_BYTES    = 20_480; // 20 KB
const MAX_ICE_BYTES    =  2_048; //  2 KB
const RATE_WINDOW_MS   = 60_000; // 1 min window for initiate rate limit
const RATE_MAX_CALLS   = 5;      // max initiates per user per minute

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();

const InitiatePayload = z.object({
  conversationId: uuidSchema,
  type: z.enum(["audio", "video"]).default("audio"),
  clientRequestId: uuidSchema.optional(),
});

const CallIdPayload = z.object({ callId: uuidSchema });

const SignalPayload = z.object({
  callId: uuidSchema,
  kind: z.enum(["offer", "answer", "ice", "ice-restart-offer", "media-state"]),
  sdp: z
    .string()
    .max(MAX_SDP_BYTES, "SDP payload too large")
    .optional(),
  candidate: z
    .string()
    .max(MAX_ICE_BYTES, "ICE candidate too large")
    .optional()
    .or(z.object({}).passthrough().optional()),
  state: z.string().max(64).optional(),
});

const EndPayload = z.object({
  callId: uuidSchema,
  reason: z
    .enum(["completed", "failed_media", "failed_network"])
    .optional(),
});

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ActiveCallSession {
  callId: string;
  conversationId: string;
  callerId: string;
  recipientId: string;
  callType?: "audio" | "video";
  status: "ringing" | "connecting" | "connected" | "ended";
  startedAt: number | null;
  ringingTimer: NodeJS.Timeout | null;
  // clientRequestId for idempotent initiate acks
  clientRequestId?: string;
}

type AckFn = (res: { ok: boolean; [k: string]: unknown }) => void;

// ─── Global registries (exported for unit tests) ─────────────────────────────
export const userSockets      = new Map<string, Set<string>>();
export const activeCalls      = new Map<string, ActiveCallSession>();
export const userActiveCallMap = new Map<string, string>(); // userId → callId

// clientRequestId → callId (for idempotent initiate within 60 s)
const pendingInitiates = new Map<string, { callId: string; ts: number }>();

// Per-user initiate rate limit: userId → timestamps[]
const initRateMap = new Map<string, number[]>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ack(fn: AckFn | undefined, payload: { ok: boolean; [k: string]: unknown }) {
  fn?.(payload);
}

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const times = (initRateMap.get(userId) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  if (times.length >= RATE_MAX_CALLS) return true;
  times.push(now);
  initRateMap.set(userId, times);
  return false;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

export function setupSocketServer(httpServer: HttpServer, webOrigin: string) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: [webOrigin, "http://localhost:3000", "https://piechat-neon.vercel.app"],
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // ── Auth middleware ─────────────────────────────────────────────────────────
  io.use(async (socket: Socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");

      if (!token) return next(new Error("Authentication token required"));

      const user = await verifyUserToken(token);
      if (!user?.id) return next(new Error("Invalid or expired session token"));

      socket.data.userId = user.id;
      socket.data.email  = user.email;
      return next();
    } catch {
      return next(new Error("Internal authentication error"));
    }
  });

  // ── Connection ──────────────────────────────────────────────────────────────
  io.on("connection", (socket: Socket) => {
    const userId: string = socket.data.userId;
    if (!userId) { socket.disconnect(true); return; }

    // Register socket
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId)!.add(socket.id);
    socket.join(`user:${userId}`);
    console.log(`[Socket] ${userId} connected (${socket.id})`);

    // ── Helpers ───────────────────────────────────────────────────────────────

    const emitToUser = (uid: string, event: string, payload: unknown) =>
      io.to(`user:${uid}`).emit(event, payload);

    const terminateCall = async (
      callId: string,
      endReason: string
    ) => {
      const session = activeCalls.get(callId);
      if (!session) return;

      if (session.ringingTimer) {
        clearTimeout(session.ringingTimer);
        session.ringingTimer = null;
      }

      const now = new Date().toISOString();
      const duration = session.startedAt
        ? Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000))
        : 0;

      session.status = "ended";
      userActiveCallMap.delete(session.callerId);
      userActiveCallMap.delete(session.recipientId);
      activeCalls.delete(callId);

      await saveCallRecord({
        id: callId,
        conversation_id: session.conversationId,
        caller_id: session.callerId,
        recipient_id: session.recipientId,
        type: session.callType ?? "audio",
        status: "ended",
        started_at: session.startedAt ? new Date(session.startedAt).toISOString() : null,
        ended_at: now,
        duration,
        end_reason: endReason,
      });
    };

    // ── call:initiate ─────────────────────────────────────────────────────────
    socket.on("call:initiate", async (rawPayload: unknown, cb?: AckFn) => {
      try {
        const parsed = InitiatePayload.safeParse(rawPayload);
        if (!parsed.success) {
          return ack(cb, { ok: false, code: "INVALID_PAYLOAD", message: parsed.error.issues[0]?.message });
        }
        const { conversationId, type, clientRequestId } = parsed.data;

        // Idempotency: same clientRequestId within 60 s → return existing callId
        if (clientRequestId) {
          const existing = pendingInitiates.get(clientRequestId);
          if (existing && Date.now() - existing.ts < 60_000) {
            return ack(cb, { ok: true, callId: existing.callId });
          }
        }

        // Rate limit
        if (isRateLimited(userId)) {
          return ack(cb, { ok: false, code: "RATE_LIMITED", message: "Too many call attempts" });
        }

        // Caller busy?
        if (userActiveCallMap.has(userId)) {
          return ack(cb, { ok: false, code: "BUSY", message: "Already in a call" });
        }

        // ── SECURITY: derive recipientId from DB membership, never from client ──
        const recipientId = await getDirectConversationRecipient(conversationId, userId);
        if (!recipientId) {
          return ack(cb, { ok: false, code: "NOT_MEMBER", message: "Not a member of this direct conversation" });
        }

        // Recipient busy?
        if (userActiveCallMap.has(recipientId)) {
          return ack(cb, { ok: false, code: "BUSY", message: "Recipient is busy" });
        }

        // Recipient online?
        const recipientOnline = (userSockets.get(recipientId)?.size ?? 0) > 0;
        if (!recipientOnline) {
          await saveCallRecord({
            id: crypto.randomUUID(),
            conversation_id: conversationId,
            caller_id: userId,
            recipient_id: recipientId,
            type,
            status: "ended",
            end_reason: "missed",
          });
          return ack(cb, { ok: false, code: "OFFLINE", message: "Recipient is not online" });
        }

        const callId = crypto.randomUUID();
        const expiresAt = Date.now() + RING_TIMEOUT_MS;

        // Ring timeout
        const ringingTimer = setTimeout(async () => {
          const session = activeCalls.get(callId);
          if (session && session.status === "ringing") {
            emitToUser(userId,      "call:ended", { callId, reason: "missed" });
            emitToUser(recipientId, "call:ended", { callId, reason: "missed" });
            await terminateCall(callId, "missed");
          }
        }, RING_TIMEOUT_MS);

        const session: ActiveCallSession = {
          callId,
          conversationId,
          callerId: userId,
          recipientId,
          callType: type,
          status: "ringing",
          startedAt: null,
          ringingTimer,
          clientRequestId,
        };

        activeCalls.set(callId, session);
        userActiveCallMap.set(userId, callId);
        userActiveCallMap.set(recipientId, callId);

        if (clientRequestId) {
          pendingInitiates.set(clientRequestId, { callId, ts: Date.now() });
        }

        // Fetch caller profile for incoming-call display (instant from in-memory cache)
        const callerProfile = await getCallerProfile(userId);

        // Notify callee IMMEDIATELY across all active sockets
        emitToUser(recipientId, "call:incoming", {
          callId,
          conversationId,
          type,
          caller: {
            id: userId,
            name: callerProfile.display_name || callerProfile.username,
            avatarUrl: callerProfile.avatar_url,
          },
          expiresAt,
        });

        // Persist ringing state asynchronously (never blocks signaling delivery)
        saveCallRecord({
          id: callId,
          conversation_id: conversationId,
          caller_id: userId,
          recipient_id: recipientId,
          type,
          status: "ringing",
        }).catch((err) => console.error("[saveCallRecord:ringing]", err));

        console.log(`[Call] ${userId} → ${recipientId} | ${callId} | ${type}`);
        return ack(cb, { ok: true, callId });
      } catch (err) {
        console.error("[call:initiate]", err);
        return ack(cb, { ok: false, code: "error", message: "Internal server error" });
      }
    });

    // ── call:accept ───────────────────────────────────────────────────────────
    socket.on("call:accept", async (rawPayload: unknown, cb?: AckFn) => {
      const parsed = CallIdPayload.safeParse(rawPayload);
      if (!parsed.success) return ack(cb, { ok: false, code: "INVALID_PAYLOAD" });

      const { callId } = parsed.data;
      const session = activeCalls.get(callId);

      if (!session) return ack(cb, { ok: false, code: "NOT_FOUND" });
      if (session.recipientId !== userId) return ack(cb, { ok: false, code: "UNAUTHORIZED" });
      if (session.status !== "ringing") return ack(cb, { ok: true, state: session.status }); // idempotent

      if (session.ringingTimer) { clearTimeout(session.ringingTimer); session.ringingTimer = null; }
      session.status = "connecting";

      // Close other callee tabs
      emitToUser(userId, "call:answered-elsewhere", { callId });

      // Tell caller to start WebRTC offer
      emitToUser(session.callerId, "call:accepted", { callId, calleeSocketReady: true });

      return ack(cb, { ok: true });
    });

    // ── call:decline ──────────────────────────────────────────────────────────
    socket.on("call:decline", async (rawPayload: unknown, cb?: AckFn) => {
      const parsed = CallIdPayload.safeParse(rawPayload);
      if (!parsed.success) return ack(cb, { ok: false, code: "INVALID_PAYLOAD" });

      const { callId } = parsed.data;
      const session = activeCalls.get(callId);

      if (!session) return ack(cb, { ok: true }); // idempotent — already ended
      if (session.recipientId !== userId) return ack(cb, { ok: false, code: "UNAUTHORIZED" });

      emitToUser(session.callerId, "call:ended", { callId, reason: "declined" });
      emitToUser(userId,           "call:ended", { callId, reason: "declined" });
      await terminateCall(callId, "declined");
      return ack(cb, { ok: true });
    });

    // ── call:cancel ───────────────────────────────────────────────────────────
    socket.on("call:cancel", async (rawPayload: unknown, cb?: AckFn) => {
      const parsed = CallIdPayload.safeParse(rawPayload);
      if (!parsed.success) return ack(cb, { ok: false, code: "INVALID_PAYLOAD" });

      const { callId } = parsed.data;
      const session = activeCalls.get(callId);

      if (!session) return ack(cb, { ok: true }); // idempotent
      if (session.callerId !== userId) return ack(cb, { ok: false, code: "UNAUTHORIZED" });

      emitToUser(session.recipientId, "call:ended", { callId, reason: "cancelled" });
      emitToUser(userId,              "call:ended", { callId, reason: "cancelled" });
      await terminateCall(callId, "cancelled");
      return ack(cb, { ok: true });
    });

    // ── call:signal (SDP offer/answer, ICE candidates) ────────────────────────
    socket.on("call:signal", (rawPayload: unknown, cb?: AckFn) => {
      const parsed = SignalPayload.safeParse(rawPayload);
      if (!parsed.success) return ack(cb, { ok: false, code: "INVALID_PAYLOAD", message: parsed.error.issues[0]?.message });

      const { callId, kind, ...rest } = parsed.data;
      const session = activeCalls.get(callId);

      if (!session) return ack(cb, { ok: false, code: "NOT_FOUND" });
      if (session.callerId !== userId && session.recipientId !== userId) {
        return ack(cb, { ok: false, code: "UNAUTHORIZED" });
      }
      if (session.status === "ended" || session.status === "ringing") {
        return ack(cb, { ok: false, code: "INVALID_STATE" });
      }

      const targetId = session.callerId === userId ? session.recipientId : session.callerId;
      emitToUser(targetId, "call:signal", { callId, kind, ...rest, senderId: userId });
      return ack(cb, { ok: true });
    });

    // ── call:connected ────────────────────────────────────────────────────────
    socket.on("call:connected", async (rawPayload: unknown, cb?: AckFn) => {
      const parsed = CallIdPayload.safeParse(rawPayload);
      if (!parsed.success) return ack(cb, { ok: false, code: "INVALID_PAYLOAD" });

      const { callId } = parsed.data;
      const session = activeCalls.get(callId);

      if (!session) return ack(cb, { ok: true }); // idempotent
      if (session.callerId !== userId && session.recipientId !== userId) {
        return ack(cb, { ok: false, code: "UNAUTHORIZED" });
      }

      if (session.status === "connecting" && !session.startedAt) {
        session.status = "connected";
        session.startedAt = Date.now();
        await saveCallRecord({
          id: callId,
          conversation_id: session.conversationId,
          caller_id: session.callerId,
          recipient_id: session.recipientId,
          type: session.callType ?? "audio",
          status: "connected",
          started_at: new Date(session.startedAt).toISOString(),
        });
      }

      return ack(cb, { ok: true });
    });

    // ── call:end ─────────────────────────────────────────────────────────────
    socket.on("call:end", async (rawPayload: unknown, cb?: AckFn) => {
      const parsed = EndPayload.safeParse(rawPayload);
      if (!parsed.success) return ack(cb, { ok: false, code: "INVALID_PAYLOAD" });

      const { callId, reason } = parsed.data;
      const session = activeCalls.get(callId);

      if (!session) return ack(cb, { ok: true }); // idempotent
      if (session.callerId !== userId && session.recipientId !== userId) {
        return ack(cb, { ok: false, code: "UNAUTHORIZED" });
      }

      const endReason = reason ?? "completed";
      const targetId = session.callerId === userId ? session.recipientId : session.callerId;
      emitToUser(targetId, "call:ended", { callId, reason: endReason });

      await terminateCall(callId, endReason);
      return ack(cb, { ok: true });
    });

    // ── call:resume (reconnect resync) ────────────────────────────────────────
    socket.on("call:resume", (_rawPayload: unknown, cb?: AckFn) => {
      const callId = userActiveCallMap.get(userId);
      if (!callId) return ack(cb, { ok: true, call: null });

      const session = activeCalls.get(callId);
      if (!session) return ack(cb, { ok: true, call: null });

      return ack(cb, {
        ok: true,
        call: {
          callId: session.callId,
          conversationId: session.conversationId,
          callType: session.callType,
          status: session.status,
          callerId: session.callerId,
          recipientId: session.recipientId,
          startedAt: session.startedAt,
        },
      });
    });

    // ── Backwards-compat: legacy events from old Supabase-only flow ──────────

    // call:offer → forward as call:signal kind=offer (callers on old frontend)
    socket.on("call:offer", (payload: { callId: string; sdp: unknown }) => {
      const session = activeCalls.get(payload?.callId ?? "");
      if (!session || session.callerId !== userId) return;
      emitToUser(session.recipientId, "call:signal", {
        callId: payload.callId, kind: "offer", sdp: payload.sdp, senderId: userId,
      });
    });

    // call:answer → forward as call:signal kind=answer
    socket.on("call:answer", async (payload: { callId: string; sdp: unknown }) => {
      const session = activeCalls.get(payload?.callId ?? "");
      if (!session || session.recipientId !== userId) return;

      if (session.ringingTimer) { clearTimeout(session.ringingTimer); session.ringingTimer = null; }
      if (session.status !== "connected") {
        session.status = "connected";
        session.startedAt = Date.now();
        await saveCallRecord({
          id: payload.callId,
          conversation_id: session.conversationId,
          caller_id: session.callerId,
          recipient_id: session.recipientId,
          type: session.callType ?? "audio",
          status: "connected",
          started_at: new Date(session.startedAt).toISOString(),
        });
      }

      emitToUser(session.callerId, "call:signal", {
        callId: payload.callId, kind: "answer", sdp: payload.sdp, senderId: userId,
      });
      emitToUser(session.callerId,    "call:connected", { callId: payload.callId, startedAt: session.startedAt });
      emitToUser(session.recipientId, "call:connected", { callId: payload.callId, startedAt: session.startedAt });
    });

    // call:candidate → forward as call:signal kind=ice
    socket.on("call:candidate", (payload: { callId: string; candidate: unknown }) => {
      const session = activeCalls.get(payload?.callId ?? "");
      if (!session) return;
      if (session.callerId !== userId && session.recipientId !== userId) return;
      const targetId = session.callerId === userId ? session.recipientId : session.callerId;
      emitToUser(targetId, "call:signal", {
        callId: payload.callId, kind: "ice", candidate: payload.candidate, senderId: userId,
      });
    });

    // ── disconnect ────────────────────────────────────────────────────────────
    socket.on("disconnect", async () => {
      const userSet = userSockets.get(userId);
      if (userSet) {
        userSet.delete(socket.id);
        if (userSet.size === 0) {
          userSockets.delete(userId);

          const activeCallId = userActiveCallMap.get(userId);
          if (activeCallId) {
            const session = activeCalls.get(activeCallId);
            if (session) {
              const peerId = session.callerId === userId ? session.recipientId : session.callerId;
              const reason = session.startedAt ? "disconnected" : "cancelled";
              emitToUser(peerId, "call:ended", { callId: activeCallId, reason });
              await terminateCall(activeCallId, reason);
            }
          }
        }
      }
      console.log(`[Socket] ${userId} disconnected (${socket.id})`);
    });
  });

  return io;
}
