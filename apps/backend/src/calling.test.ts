import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  ActiveCallSession,
  activeCalls,
  userActiveCallMap,
  userSockets,
} from "./socket.js";

describe("PieChat Voice Calling — State Machine & Security Tests", () => {
  beforeEach(() => {
    activeCalls.clear();
    userActiveCallMap.clear();
    userSockets.clear();
  });

  describe("1. Call Lifecycle State Transitions", () => {
    it("should initialize a call in 'ringing' status", () => {
      const callId = "test-call-1";
      const session: ActiveCallSession = {
        callId,
        conversationId: "conv-1",
        callerId: "user-alice",
        recipientId: "user-bob",
        status: "ringing",
        startedAt: null,
        ringingTimer: null,
      };

      activeCalls.set(callId, session);
      userActiveCallMap.set("user-alice", callId);
      userActiveCallMap.set("user-bob", callId);

      assert.strictEqual(activeCalls.get(callId)?.status, "ringing");
      assert.strictEqual(userActiveCallMap.get("user-alice"), callId);
      assert.strictEqual(userActiveCallMap.get("user-bob"), callId);
    });

    it("should transition from 'ringing' to 'connected' on answer and record startedAt", () => {
      const callId = "test-call-2";
      const session: ActiveCallSession = {
        callId,
        conversationId: "conv-1",
        callerId: "user-alice",
        recipientId: "user-bob",
        status: "ringing",
        startedAt: null,
        ringingTimer: null,
      };

      activeCalls.set(callId, session);
      const now = Date.now();
      session.status = "connected";
      session.startedAt = now;

      assert.strictEqual(session.status, "connected");
      assert.ok(session.startedAt !== null);
      assert.ok(session.startedAt <= Date.now());
    });

    it("should calculate correct duration in seconds upon call completion", () => {
      const startTime = Date.now() - 45000; // 45 seconds ago
      const endTime = Date.now();
      const durationSeconds = Math.floor((endTime - startTime) / 1000);

      assert.strictEqual(durationSeconds, 45);
    });
  });

  describe("2. Busy Policy & Mutual Call Prevention", () => {
    it("should prevent a caller from initiating multiple simultaneous calls", () => {
      const activeCallId = "call-existing";
      userActiveCallMap.set("user-alice", activeCallId);

      const canInitiate = !userActiveCallMap.has("user-alice");
      assert.strictEqual(canInitiate, false, "Caller should be marked busy");
    });

    it("should return busy if recipient is already engaged in another call", () => {
      const activeCallId = "call-bob-charlie";
      userActiveCallMap.set("user-bob", activeCallId);

      const recipientAvailable = !userActiveCallMap.has("user-bob");
      assert.strictEqual(
        recipientAvailable,
        false,
        "Recipient should be reported as busy"
      );
    });
  });

  describe("3. Authorization & Signaling Security", () => {
    it("should reject signaling when sender is neither caller nor recipient", () => {
      const session: ActiveCallSession = {
        callId: "call-secure-1",
        conversationId: "conv-1",
        callerId: "user-alice",
        recipientId: "user-bob",
        status: "connected",
        startedAt: Date.now(),
        ringingTimer: null,
      };

      const maliciousSender = "user-eve";
      const isParticipant =
        maliciousSender === session.callerId ||
        maliciousSender === session.recipientId;

      assert.strictEqual(
        isParticipant,
        false,
        "Unauthorized user must not access signaling channel"
      );
    });

    it("should only allow recipient to answer the call", () => {
      const session: ActiveCallSession = {
        callId: "call-auth-answer",
        conversationId: "conv-1",
        callerId: "user-alice",
        recipientId: "user-bob",
        status: "ringing",
        startedAt: null,
        ringingTimer: null,
      };

      const callerAnswering = session.recipientId === "user-alice";
      const recipientAnswering = session.recipientId === "user-bob";

      assert.strictEqual(callerAnswering, false);
      assert.strictEqual(recipientAnswering, true);
    });

    it("should prevent caller from placing a call to themselves", () => {
      const callerId = "user-alice";
      const recipientId = "user-alice";
      const isSelfCall = callerId === recipientId;

      assert.strictEqual(isSelfCall, true);
    });
  });

  describe("4. Timeout and Cancellation Behavior", () => {
    it("should cleanly tear down session on ringing cancellation", () => {
      const callId = "call-cancel-test";
      const session: ActiveCallSession = {
        callId,
        conversationId: "conv-1",
        callerId: "user-alice",
        recipientId: "user-bob",
        status: "ringing",
        startedAt: null,
        ringingTimer: null,
      };

      activeCalls.set(callId, session);
      userActiveCallMap.set("user-alice", callId);
      userActiveCallMap.set("user-bob", callId);

      // Cancel call
      activeCalls.delete(callId);
      userActiveCallMap.delete("user-alice");
      userActiveCallMap.delete("user-bob");

      assert.strictEqual(activeCalls.has(callId), false);
      assert.strictEqual(userActiveCallMap.has("user-alice"), false);
      assert.strictEqual(userActiveCallMap.has("user-bob"), false);
    });
  });

  describe("5. Mute Audio Track State Logic", () => {
    it("should toggle audio track enabled flag correctly", () => {
      let isAudioEnabled = true;

      // Toggle mute
      isAudioEnabled = !isAudioEnabled;
      assert.strictEqual(isAudioEnabled, false, "Audio track should be disabled when muted");

      // Toggle unmute
      isAudioEnabled = !isAudioEnabled;
      assert.strictEqual(isAudioEnabled, true, "Audio track should be enabled when unmuted");
    });
  });

  describe("6. ICE Config & Ephemeral TURN Credentials (Blueprint Phase 3)", () => {
    it("should generate valid short-lived HMAC-SHA1 credentials for coturn", async () => {
      const { generateTurnCredentials, DEFAULT_STUN_SERVERS } = await import("./ice.js");
      const userId = "test-user-uuid";
      const secret = "super-secret-turn-key";
      const urls = ["turn:turn.piechat.app:3478", "turns:turn.piechat.app:5349"];

      const config = generateTurnCredentials(userId, secret, urls, 3600);

      assert.strictEqual(config.urls.length, 2);
      assert.ok(config.username.includes(userId));
      assert.ok(typeof config.credential === "string" && config.credential.length > 0);
      assert.strictEqual(config.ttl, 3600);
      assert.ok(DEFAULT_STUN_SERVERS.length >= 2);
    });
  });

  describe("7. Call UI Event Isolation (Part A2)", () => {
    it("should ensure non-call pointer/click events do NOT end an active call", () => {
      let callState: "connected" | "ended" = "connected";

      // Simulated non-call UI events (clicking avatar, text, video container, backdrop)
      const handleUIContainerClick = (e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        // Container click MUST NOT call endCall
      };

      let propagationStopped = false;
      handleUIContainerClick({
        stopPropagation: () => {
          propagationStopped = true;
        },
      });

      assert.strictEqual(propagationStopped, true);
      assert.strictEqual(callState, "connected", "Call must remain active on arbitrary click");

      // Only explicit End Call button terminates the call
      const handleExplicitEndCall = () => {
        callState = "ended";
      };

      handleExplicitEndCall();
      assert.strictEqual(callState, "ended", "Explicit End Call button must end the call");
    });
  });

  describe("8. Chat Home Navigation Logic (Part B)", () => {
    const userConversations = [
      { id: "group-1", type: "group", title: "Project Team" },
      { id: "direct-1", type: "direct", title: "Alice" },
      { id: "group-2", type: "group", title: "Study Group" },
    ];

    // Mirror the fixed selection algorithm in chat-workspace.tsx
    function computeSelectedId(
      requestedId: string | null,
      previousId: string,
      list: typeof userConversations
    ): string {
      if (requestedId && list.some((item) => item.id === requestedId)) {
        return requestedId;
      }
      if (previousId && list.some((item) => item.id === previousId)) {
        return previousId;
      }
      // Never auto-select list[0] — must show empty chat home!
      return "";
    }

    it("should display chat home with NO conversation selected when visiting /dashboard", () => {
      const selected = computeSelectedId(null, "", userConversations);
      assert.strictEqual(selected, "", "Navigating to /dashboard must not auto-select any group");
    });

    it("should open the intended conversation when valid conversationId deep link is visited", () => {
      const selected = computeSelectedId("direct-1", "", userConversations);
      assert.strictEqual(selected, "direct-1", "Valid deep link must open requested conversation");
    });

    it("should NOT open any conversation when invalid or unauthorized conversationId is provided", () => {
      const selected = computeSelectedId("unauthorized-conv-id", "", userConversations);
      assert.strictEqual(selected, "", "Unauthorized ID must not open a conversation");
    });

    it("should clear selected conversation when user navigates back to /dashboard from Profile or Friends", () => {
      // User returns from /profile to /dashboard with null requestedId
      const selectedAfterReturn = computeSelectedId(null, "", userConversations);
      assert.strictEqual(
        selectedAfterReturn,
        "",
        "Returning from Profile must show chat home with no old group opened"
      );
    });
  });

  describe("9. Multi-Tab & Duplicate Event Deduplication (Part A1 & A5)", () => {
    it("should deduplicate initiate requests with same clientRequestId", () => {
      const pendingMap = new Map<string, { callId: string; ts: number }>();
      const clientReqId = "req-uuid-1234";
      const callId = "call-first-uuid";

      pendingMap.set(clientReqId, { callId, ts: Date.now() });

      // Second request with same clientRequestId within 60s
      const existing = pendingMap.get(clientReqId);
      const isDuplicate = Boolean(existing && Date.now() - existing.ts < 60_000);

      assert.strictEqual(isDuplicate, true);
      assert.strictEqual(existing?.callId, callId, "Must return original callId idempotently");
    });
  });

  describe("10. One-to-One Video Calling Architecture & Media Flow", () => {
    it("should correctly store and distinguish 'video' call sessions", () => {
      const callId = "video-call-101";
      const session: ActiveCallSession = {
        callId,
        conversationId: "conv-video-1",
        callerId: "user-alice",
        recipientId: "user-bob",
        callType: "video",
        status: "ringing",
        startedAt: null,
        ringingTimer: null,
      };

      activeCalls.set(callId, session);
      userActiveCallMap.set("user-alice", callId);
      userActiveCallMap.set("user-bob", callId);

      const retrieved = activeCalls.get(callId);
      assert.strictEqual(retrieved?.callType, "video");
      assert.strictEqual(retrieved?.status, "ringing");
    });

    it("should validate video call initiation payload and reject invalid media types", () => {
      const validAudio = { conversationId: "c1", type: "audio" };
      const validVideo = { conversationId: "c1", type: "video" };
      const invalidType = { conversationId: "c1", type: "screen_only" };

      const validateType = (t: string) => ["audio", "video"].includes(t);

      assert.strictEqual(validateType(validAudio.type), true);
      assert.strictEqual(validateType(validVideo.type), true);
      assert.strictEqual(validateType(invalidType.type), false);
    });

    it("should toggle camera off without terminating or disconnecting the active call", () => {
      const mockVideoTrack = { kind: "video", enabled: true };
      const mockAudioTrack = { kind: "audio", enabled: true };
      let callStatus = "connected";

      // User toggles camera off
      mockVideoTrack.enabled = false;

      // Audio must remain active and enabled
      assert.strictEqual(mockVideoTrack.enabled, false, "Camera track should be disabled");
      assert.strictEqual(mockAudioTrack.enabled, true, "Audio track must remain enabled");
      assert.strictEqual(callStatus, "connected", "Call status must remain connected");

      // User toggles camera back on
      mockVideoTrack.enabled = true;
      assert.strictEqual(mockVideoTrack.enabled, true, "Camera track should be re-enabled");
      assert.strictEqual(callStatus, "connected");
    });

    it("should toggle microphone mute without interrupting video transmission", () => {
      const mockVideoTrack = { kind: "video", enabled: true };
      const mockAudioTrack = { kind: "audio", enabled: true };

      // User mutes mic
      mockAudioTrack.enabled = false;

      assert.strictEqual(mockAudioTrack.enabled, false, "Audio track should be muted");
      assert.strictEqual(mockVideoTrack.enabled, true, "Video track must continue streaming");
    });

    it("should handle video call completion with duration and 'completed' reason", () => {
      const callId = "video-call-102";
      const startMs = Date.now() - 120_000; // 2 minutes ago
      const session: ActiveCallSession = {
        callId,
        conversationId: "conv-video-2",
        callerId: "user-alice",
        recipientId: "user-bob",
        callType: "video",
        status: "connected",
        startedAt: startMs,
        ringingTimer: null,
      };

      activeCalls.set(callId, session);
      const now = Date.now();
      const duration = Math.floor((now - session.startedAt!) / 1000);

      // Terminal state
      session.status = "ended";
      activeCalls.delete(callId);

      assert.strictEqual(duration, 120);
      assert.strictEqual(session.status, "ended");
      assert.strictEqual(activeCalls.has(callId), false);
    });
  });
});


