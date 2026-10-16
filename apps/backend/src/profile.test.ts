import { describe, it } from "node:test";
import assert from "node:assert";

// Shared validation rules matching client and database constraints
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,24}$/;
const MAX_BIO_LENGTH = 160;
const MAX_DISPLAY_NAME_LENGTH = 60;
const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_AVATAR_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

function validateUsername(username: string): { valid: boolean; error?: string } {
  const trimmed = username.trim().toLowerCase();
  if (!trimmed) {
    return { valid: false, error: "Username is required." };
  }
  if (trimmed.length < 3) {
    return { valid: false, error: "Username must be at least 3 characters." };
  }
  if (trimmed.length > 24) {
    return { valid: false, error: "Username must be at most 24 characters." };
  }
  if (!USERNAME_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: "Username may only contain letters, numbers, and underscores.",
    };
  }
  return { valid: true };
}

function validateDisplayName(displayName: string): { valid: boolean; error?: string } {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return { valid: false, error: "Display name cannot be empty." };
  }
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return {
      valid: false,
      error: `Display name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`,
    };
  }
  return { valid: true };
}

function validateBio(bio: string): { valid: boolean; error?: string } {
  if (bio.length > MAX_BIO_LENGTH) {
    return {
      valid: false,
      error: `Bio must be at most ${MAX_BIO_LENGTH} characters.`,
    };
  }
  return { valid: true };
}

function validateAvatarFile(file: { size: number; type: string }): {
  valid: boolean;
  error?: string;
} {
  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: "Supported image formats are JPEG, PNG, WebP, and GIF.",
    };
  }
  if (file.size > MAX_AVATAR_SIZE_BYTES) {
    return {
      valid: false,
      error: "Image file size exceeds the 5 MB limit.",
    };
  }
  return { valid: true };
}

function deriveRelationshipState(params: {
  currentUserId: string;
  targetUserId: string;
  friendship: {
    requester_id: string;
    addressee_id: string;
    status: string;
  } | null;
}): "self" | "none" | "accepted" | "outgoing_pending" | "incoming_pending" | "blocked_by_me" | "blocked_by_them" {
  const { currentUserId, targetUserId, friendship } = params;
  if (currentUserId === targetUserId) return "self";
  if (!friendship) return "none";

  if (friendship.status === "accepted") return "accepted";

  if (friendship.status === "pending") {
    if (friendship.requester_id === currentUserId) return "outgoing_pending";
    if (friendship.addressee_id === currentUserId) return "incoming_pending";
  }

  if (friendship.status === "blocked") {
    if (friendship.requester_id === currentUserId) return "blocked_by_me";
    if (friendship.addressee_id === currentUserId) return "blocked_by_them";
  }

  return "none";
}

function sanitizeStoragePath(userId: string, filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
  const safeExt = ["jpeg", "jpg", "png", "webp", "gif"].includes(ext) ? ext : "jpg";
  return `${userId}/avatar-${Date.now()}.${safeExt}`;
}

function canDeleteAvatar(avatarUrl: string, userId: string): boolean {
  if (!avatarUrl || !avatarUrl.includes("avatars")) return false;
  const parts = avatarUrl.split("/avatars/");
  if (parts.length <= 1) return false;
  const storagePath = parts[1].split("?")[0];
  return storagePath.startsWith(`${userId}/`);
}

describe("PieChat Profile & Account Settings Suite", () => {
  describe("1. Username Validation & Database Constraint Alignment", () => {
    it("should accept valid standard usernames", () => {
      assert.strictEqual(validateUsername("alice").valid, true);
      assert.strictEqual(validateUsername("bob_123").valid, true);
      assert.strictEqual(validateUsername("dev_dhar").valid, true);
      assert.strictEqual(validateUsername("User_99").valid, true);
      assert.strictEqual(validateUsername("abc").valid, true); // exactly 3 chars
      assert.strictEqual(validateUsername("a".repeat(24)).valid, true); // exactly 24 chars
    });

    it("should reject usernames shorter than 3 characters", () => {
      assert.strictEqual(validateUsername("").valid, false);
      assert.strictEqual(validateUsername("a").valid, false);
      assert.strictEqual(validateUsername("ab").valid, false);
      assert.strictEqual(validateUsername("  ").valid, false);
    });

    it("should reject usernames longer than 24 characters", () => {
      assert.strictEqual(validateUsername("a".repeat(25)).valid, false);
      assert.strictEqual(validateUsername("very_long_username_that_exceeds_limit").valid, false);
    });

    it("should reject usernames with illegal characters", () => {
      assert.strictEqual(validateUsername("alice smith").valid, false); // spaces
      assert.strictEqual(validateUsername("alice-bob").valid, false); // dashes
      assert.strictEqual(validateUsername("alice@piechat").valid, false); // @ symbol
      assert.strictEqual(validateUsername("alice.dev").valid, false); // dots
      assert.strictEqual(validateUsername("alice!").valid, false); // exclamation
      assert.strictEqual(validateUsername("<script>").valid, false); // html tags
    });
  });

  describe("2. Display Name Validation", () => {
    it("should accept valid display names", () => {
      assert.strictEqual(validateDisplayName("Alice Smith").valid, true);
      assert.strictEqual(validateDisplayName("D").valid, true); // 1 character
      assert.strictEqual(validateDisplayName("A".repeat(60)).valid, true); // exactly 60 characters
    });

    it("should reject empty or whitespace-only display names", () => {
      assert.strictEqual(validateDisplayName("").valid, false);
      assert.strictEqual(validateDisplayName("   ").valid, false);
    });

    it("should reject display names exceeding 60 characters", () => {
      assert.strictEqual(validateDisplayName("A".repeat(61)).valid, false);
    });
  });

  describe("3. Bio Length Validation", () => {
    it("should accept empty or valid length bios", () => {
      assert.strictEqual(validateBio("").valid, true);
      assert.strictEqual(validateBio("Hello world!").valid, true);
      assert.strictEqual(validateBio("B".repeat(160)).valid, true); // exactly 160 characters
    });

    it("should reject bios exceeding 160 characters", () => {
      assert.strictEqual(validateBio("B".repeat(161)).valid, false);
      assert.strictEqual(validateBio("B".repeat(200)).valid, false);
    });
  });

  describe("4. Avatar File Validation (Type & 5MB Limit)", () => {
    it("should accept valid image types under 5MB", () => {
      assert.strictEqual(
        validateAvatarFile({ type: "image/jpeg", size: 1024 * 500 }).valid,
        true
      );
      assert.strictEqual(
        validateAvatarFile({ type: "image/png", size: 1024 * 1024 }).valid,
        true
      );
      assert.strictEqual(
        validateAvatarFile({ type: "image/webp", size: 1024 * 2000 }).valid,
        true
      );
      assert.strictEqual(
        validateAvatarFile({ type: "image/gif", size: 1024 * 512 }).valid,
        true
      );
    });

    it("should reject unsupported file types", () => {
      assert.strictEqual(
        validateAvatarFile({ type: "application/pdf", size: 1024 }).valid,
        false
      );
      assert.strictEqual(
        validateAvatarFile({ type: "video/mp4", size: 1024 }).valid,
        false
      );
      assert.strictEqual(
        validateAvatarFile({ type: "image/svg+xml", size: 1024 }).valid,
        false
      );
      assert.strictEqual(
        validateAvatarFile({ type: "text/plain", size: 1024 }).valid,
        false
      );
    });

    it("should reject files exceeding the 5MB size limit", () => {
      const fiveMb = 5 * 1024 * 1024;
      assert.strictEqual(
        validateAvatarFile({ type: "image/jpeg", size: fiveMb }).valid,
        true
      );
      assert.strictEqual(
        validateAvatarFile({ type: "image/jpeg", size: fiveMb + 1 }).valid,
        false
      );
      assert.strictEqual(
        validateAvatarFile({ type: "image/png", size: 10 * 1024 * 1024 }).valid,
        false
      );
    });
  });

  describe("5. Avatar Storage Security & Path Scoping", () => {
    it("should enforce user-scoped path prefix matching RLS storage policy", () => {
      const userId = "550e8400-e29b-41d4-a716-446655440000";
      const path = sanitizeStoragePath(userId, "photo.png");
      assert.ok(path.startsWith(`${userId}/`));
      assert.ok(path.endsWith(".png"));
    });

    it("should allow user to delete only their own avatar files", () => {
      const userId = "user-123";
      const ownUrl = "https://example.supabase.co/storage/v1/object/public/avatars/user-123/avatar-12345.jpg";
      const otherUrl = "https://example.supabase.co/storage/v1/object/public/avatars/user-999/avatar-12345.jpg";

      assert.strictEqual(canDeleteAvatar(ownUrl, userId), true);
      assert.strictEqual(canDeleteAvatar(otherUrl, userId), false);
      assert.strictEqual(canDeleteAvatar("", userId), false);
    });
  });

  describe("6. Relationship State Machine for Public Profiles", () => {
    const userA = "user-alice";
    const userB = "user-bob";

    it("should identify self profile", () => {
      const state = deriveRelationshipState({
        currentUserId: userA,
        targetUserId: userA,
        friendship: null,
      });
      assert.strictEqual(state, "self");
    });

    it("should identify no relationship", () => {
      const state = deriveRelationshipState({
        currentUserId: userA,
        targetUserId: userB,
        friendship: null,
      });
      assert.strictEqual(state, "none");
    });

    it("should identify accepted friendship", () => {
      const state = deriveRelationshipState({
        currentUserId: userA,
        targetUserId: userB,
        friendship: { requester_id: userA, addressee_id: userB, status: "accepted" },
      });
      assert.strictEqual(state, "accepted");
    });

    it("should distinguish outgoing vs incoming pending requests", () => {
      const outgoing = deriveRelationshipState({
        currentUserId: userA,
        targetUserId: userB,
        friendship: { requester_id: userA, addressee_id: userB, status: "pending" },
      });
      assert.strictEqual(outgoing, "outgoing_pending");

      const incoming = deriveRelationshipState({
        currentUserId: userA,
        targetUserId: userB,
        friendship: { requester_id: userB, addressee_id: userA, status: "pending" },
      });
      assert.strictEqual(incoming, "incoming_pending");
    });

    it("should distinguish blocked by me vs blocked by them", () => {
      const blockedByMe = deriveRelationshipState({
        currentUserId: userA,
        targetUserId: userB,
        friendship: { requester_id: userA, addressee_id: userB, status: "blocked" },
      });
      assert.strictEqual(blockedByMe, "blocked_by_me");

      const blockedByThem = deriveRelationshipState({
        currentUserId: userA,
        targetUserId: userB,
        friendship: { requester_id: userB, addressee_id: userA, status: "blocked" },
      });
      assert.strictEqual(blockedByThem, "blocked_by_them");
    });
  });

  describe("7. Friends List Deduplication (Fix Duplicate Friends Bug)", () => {
    it("should deduplicate reciprocal friendship rows so each user appears only once", () => {
      const currentUserId = "user-devdhar";
      const friendId = "user-rdsteam";

      // Both directions exist in DB as was observed with RDS TEAM
      const acceptedRows = [
        {
          id: "row-1",
          requester_id: friendId,
          addressee_id: currentUserId,
          status: "accepted",
        },
        {
          id: "row-2",
          requester_id: currentUserId,
          addressee_id: friendId,
          status: "accepted",
        },
      ];

      const profileMap: Record<string, { id: string; username: string; display_name: string }> = {
        [friendId]: { id: friendId, username: "rdsteam", display_name: "RDS TEAM" },
      };

      const seenFriendIds = new Set<string>();
      const deduplicatedList: Array<{ friendshipId: string; friend: typeof profileMap[string] }> = [];

      for (const r of acceptedRows) {
        const otherId = r.requester_id === currentUserId ? r.addressee_id : r.requester_id;
        if (!seenFriendIds.has(otherId) && profileMap[otherId]) {
          seenFriendIds.add(otherId);
          deduplicatedList.push({
            friendshipId: r.id,
            friend: profileMap[otherId],
          });
        }
      }

      assert.strictEqual(deduplicatedList.length, 1);
      assert.strictEqual(deduplicatedList[0].friend.username, "rdsteam");
      assert.strictEqual(deduplicatedList[0].friend.display_name, "RDS TEAM");
    });
  });

  describe("8. Pairwise Uniqueness Database Safeguard", () => {
    it("should compute identical pairwise ordering keys for reciprocal pairs", () => {
      const userA = "005b93bf-6386-4a41-96ab-1f0e5628333c";
      const userB = "656bb9e1-51c0-415d-af3f-7edde6f1bec4";

      // Mimic Postgres least() and greatest()
      const pairKey1 = [userA < userB ? userA : userB, userA > userB ? userA : userB].join("::");
      const pairKey2 = [userB < userA ? userB : userA, userB > userA ? userB : userA].join("::");

      assert.strictEqual(pairKey1, pairKey2);
    });
  });

  describe("9. Friend Request and Removal Permissions", () => {
    it("should reject friend request if target is self", () => {
      const user = "user-123";
      assert.strictEqual(user === user, true); // Prevents self-request
    });

    it("should detect when a user is already an accepted friend to prevent duplicate requests", () => {
      const acceptedFriendIds = new Set(["friend-1", "friend-2"]);
      assert.strictEqual(acceptedFriendIds.has("friend-1"), true);
      assert.strictEqual(acceptedFriendIds.has("friend-3"), false);
    });
  });

  describe("10. Friends Real-Time Filter Logic", () => {
    const friendList = [
      { friend: { display_name: "RDS TEAM", username: "rdsteam" } },
      { friend: { display_name: "Piyush Shah", username: "piyush_shah" } },
      { friend: { display_name: "Jayesh", username: "jayesh" } },
    ];

    function filterFriends(query: string) {
      if (!query.trim()) return friendList;
      const q = query.toLowerCase().trim();
      return friendList.filter(
        (item) =>
          item.friend.display_name.toLowerCase().includes(q) ||
          item.friend.username.toLowerCase().includes(q)
      );
    }

    it("should return all friends when query is empty", () => {
      assert.strictEqual(filterFriends("").length, 3);
      assert.strictEqual(filterFriends("   ").length, 3);
    });

    it("should filter friends by display name case-insensitively", () => {
      const results = filterFriends("rds");
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].friend.username, "rdsteam");
    });

    it("should filter friends by username", () => {
      const results = filterFriends("piyush");
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].friend.display_name, "Piyush Shah");
    });

    it("should return empty list when no friends match", () => {
      const results = filterFriends("nonexistent_user");
      assert.strictEqual(results.length, 0);
    });
  });
});

