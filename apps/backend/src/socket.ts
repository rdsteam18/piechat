import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import crypto from "crypto";
import {
  verifyUserToken,
  verifyDirectConversationMembership,
  saveCallRecord,
  supabase,
} from "./db.js";

export interface ActiveCallSession {
  callId: string;
  conversationId: string;
  callerId: string;
  recipientId: string;
  status:
    | "ringing"
    | "accepted"
    | "connected"
    | "ended"
    | "declined"
    | "cancelled"
    | "busy"
    | "missed"
    | "failed";
  startedAt: number | null;
  ringingTimer: NodeJS.Timeout | null;
}

// Global state trackers
export const userSockets = new Map<string, Set<string>>();
export const activeCalls = new Map<string, ActiveCallSession>();
// Quick lookup: userId -> callId
export const userActiveCallMap = new Map<string, string>();

export function setupSocketServer(httpServer: HttpServer, webOrigin: string) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: [webOrigin, "http://localhost:3000", "https://piechat-neon.vercel.app"],
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // 1. Authentication Middleware
  io.use(async (socket: Socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");

      if (!token) {
        return next(new Error("Authentication token required"));
      }

      const user = await verifyUserToken(token);
      if (!user || !user.id) {
        return next(new Error("Invalid or expired session token"));
      }

      socket.data.userId = user.id;
      socket.data.email = user.email;
      return next();
    } catch (err) {
      return next(new Error("Internal authentication error"));
    }
  });

  // 2. Connection Lifecycle
  io.on("connection", (socket: Socket) => {
    const userId: string = socket.data.userId;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    // Register user socket
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(socket.id);
    socket.join(`user:${userId}`);

    console.log(`[Socket] User ${userId} connected on socket ${socket.id}`);

    // Helper: emit to all active sockets of a user
    const emitToUser = (targetUserId: string, event: string, payload: unknown) => {
      io.to(`user:${targetUserId}`).emit(event, payload);
    };

    // Helper: end active call session and persist
    const terminateCall = async (
      callId: string,
      status: ActiveCallSession["status"],
      reason?: string
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

      session.status = status;
      userActiveCallMap.delete(session.callerId);
      userActiveCallMap.delete(session.recipientId);
      activeCalls.delete(callId);

      // Persist to database
      await saveCallRecord({
        id: callId,
        conversation_id: session.conversationId,
        caller_id: session.callerId,
        recipient_id: session.recipientId,
        status,
        started_at: session.startedAt ? new Date(session.startedAt).toISOString() : null,
        ended_at: now,
        duration,
        end_reason: reason,
      });
    };

    // -------------------------------------------------------------
    // EVENT: call:initiate
    // -------------------------------------------------------------
    socket.on(
      "call:initiate",
      async (payload: { conversationId: string; recipientId: string }) => {
        try {
          const { conversationId, recipientId } = payload || {};

          if (!conversationId || !recipientId) {
            socket.emit("call:error", { message: "Invalid initiate payload" });
            return;
          }

          if (recipientId === userId) {
            socket.emit("call:error", { message: "Cannot call yourself" });
            return;
          }

          // Check if caller is already in a call
          if (userActiveCallMap.has(userId)) {
            socket.emit("call:error", {
              message: "You are already in an active call",
            });
            return;
          }

          // Check if recipient is already in a call
          if (userActiveCallMap.has(recipientId)) {
            socket.emit("call:busy", { recipientId });
            return;
          }

          // Validate conversation membership and type
          const isMember = await verifyDirectConversationMembership(
            conversationId,
            userId,
            recipientId
          );

          if (!isMember) {
            socket.emit("call:error", {
              message: "Unauthorized: not members of this direct conversation",
            });
            return;
          }

          const callId = crypto.randomUUID();

          // Fetch caller profile for display
          let callerProfile: {
            username: string;
            display_name: string;
            avatar_url: string | null;
          } = {
            username: "User",
            display_name: "PieChat User",
            avatar_url: null,
          };

          try {
            const { data: p } = await supabase
              .from("profiles")
              .select("username, display_name, avatar_url")
              .eq("id", userId)
              .single();
            if (p) callerProfile = p;
          } catch {
            // fallback
          }

          // 30-second ringing timeout
          const ringingTimer = setTimeout(async () => {
            const current = activeCalls.get(callId);
            if (current && current.status === "ringing") {
              emitToUser(userId, "call:timeout", { callId });
              emitToUser(recipientId, "call:timeout", { callId });
              await terminateCall(callId, "missed", "Ringing timeout (30s)");
            }
          }, 30000);

          const newSession: ActiveCallSession = {
            callId,
            conversationId,
            callerId: userId,
            recipientId,
            status: "ringing",
            startedAt: null,
            ringingTimer,
          };

          activeCalls.set(callId, newSession);
          userActiveCallMap.set(userId, callId);
          userActiveCallMap.set(recipientId, callId);

          // Save initial ringing state to DB
          await saveCallRecord({
            id: callId,
            conversation_id: conversationId,
            caller_id: userId,
            recipient_id: recipientId,
            status: "ringing",
          });

          // Notify caller they are ringing
          socket.emit("call:ringing", { callId, recipientId });

          // Notify recipient of incoming call
          emitToUser(recipientId, "call:incoming", {
            callId,
            conversationId,
            callerId: userId,
            callerProfile,
          });
        } catch (err) {
          console.error("Error in call:initiate:", err);
          socket.emit("call:error", { message: "Failed to initiate call" });
        }
      }
    );

    // -------------------------------------------------------------
    // EVENT: call:offer (WebRTC SDP offer)
    // -------------------------------------------------------------
    socket.on(
      "call:offer",
      (payload: { callId: string; sdp: RTCSessionDescriptionInit }) => {
        const { callId, sdp } = payload || {};
        const session = activeCalls.get(callId);

        if (!session || session.callerId !== userId) {
          socket.emit("call:error", { message: "Invalid call session or caller" });
          return;
        }

        emitToUser(session.recipientId, "call:offer", { callId, sdp });
      }
    );

    // -------------------------------------------------------------
    // EVENT: call:answer (WebRTC SDP answer)
    // -------------------------------------------------------------
    socket.on(
      "call:answer",
      async (payload: { callId: string; sdp: RTCSessionDescriptionInit }) => {
        const { callId, sdp } = payload || {};
        const session = activeCalls.get(callId);

        if (!session || session.recipientId !== userId) {
          socket.emit("call:error", {
            message: "Invalid call session or unauthorized recipient",
          });
          return;
        }

        if (session.ringingTimer) {
          clearTimeout(session.ringingTimer);
          session.ringingTimer = null;
        }

        session.status = "connected";
        session.startedAt = Date.now();

        // Forward answer to caller
        emitToUser(session.callerId, "call:answer", { callId, sdp });

        // Notify both that call is connected
        emitToUser(session.callerId, "call:connected", {
          callId,
          startedAt: session.startedAt,
        });
        emitToUser(session.recipientId, "call:connected", {
          callId,
          startedAt: session.startedAt,
        });

        await saveCallRecord({
          id: callId,
          conversation_id: session.conversationId,
          caller_id: session.callerId,
          recipient_id: session.recipientId,
          status: "connected",
          started_at: new Date(session.startedAt).toISOString(),
        });
      }
    );

    // -------------------------------------------------------------
    // EVENT: call:candidate (WebRTC ICE candidate)
    // -------------------------------------------------------------
    socket.on(
      "call:candidate",
      (payload: { callId: string; candidate: RTCIceCandidateInit }) => {
        const { callId, candidate } = payload || {};
        const session = activeCalls.get(callId);

        if (
          !session ||
          (session.callerId !== userId && session.recipientId !== userId)
        ) {
          return;
        }

        const targetUserId =
          session.callerId === userId ? session.recipientId : session.callerId;
        emitToUser(targetUserId, "call:candidate", { callId, candidate });
      }
    );

    // -------------------------------------------------------------
    // EVENT: call:decline
    // -------------------------------------------------------------
    socket.on("call:decline", async (payload: { callId: string }) => {
      const { callId } = payload || {};
      const session = activeCalls.get(callId);

      if (!session || session.recipientId !== userId) return;

      emitToUser(session.callerId, "call:declined", { callId });
      await terminateCall(callId, "declined", "Recipient declined call");
    });

    // -------------------------------------------------------------
    // EVENT: call:cancel
    // -------------------------------------------------------------
    socket.on("call:cancel", async (payload: { callId: string }) => {
      const { callId } = payload || {};
      const session = activeCalls.get(callId);

      if (!session || session.callerId !== userId) return;

      emitToUser(session.recipientId, "call:cancelled", { callId });
      await terminateCall(callId, "cancelled", "Caller cancelled call");
    });

    // -------------------------------------------------------------
    // EVENT: call:end
    // -------------------------------------------------------------
    socket.on("call:end", async (payload: { callId: string }) => {
      const { callId } = payload || {};
      const session = activeCalls.get(callId);

      if (
        !session ||
        (session.callerId !== userId && session.recipientId !== userId)
      ) {
        return;
      }

      const targetUserId =
        session.callerId === userId ? session.recipientId : session.callerId;
      emitToUser(targetUserId, "call:ended", { callId });

      await terminateCall(callId, "ended", "Call hung up normally");
    });

    // -------------------------------------------------------------
    // EVENT: disconnect
    // -------------------------------------------------------------
    socket.on("disconnect", async () => {
      const userSet = userSockets.get(userId);
      if (userSet) {
        userSet.delete(socket.id);
        if (userSet.size === 0) {
          userSockets.delete(userId);

          // Clean up any active call if user has no remaining connections
          const activeCallId = userActiveCallMap.get(userId);
          if (activeCallId) {
            const session = activeCalls.get(activeCallId);
            if (session) {
              const peerId =
                session.callerId === userId
                  ? session.recipientId
                  : session.callerId;
              emitToUser(peerId, "call:ended", {
                callId: activeCallId,
                reason: "Peer disconnected",
              });
              await terminateCall(
                activeCallId,
                session.startedAt ? "ended" : "failed",
                "User disconnected unexpectedly"
              );
            }
          }
        }
      }
      console.log(`[Socket] User ${userId} disconnected on socket ${socket.id}`);
    });
  });

  return io;
}
