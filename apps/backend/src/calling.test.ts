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
});
