/**
 * Helper to determine if a message is eligible for editing based on
 * PieChat Step 20 Smart Message Editing Rules:
 *
 * 1. Direct chats: editing allowed only before the recipient reads the message.
 * 2. Group chats: editing allowed only while readers count is <= 2.
 * 3. Deleted messages cannot be edited.
 * 4. Only the message sender can edit.
 */
export type EditEligibilityCheck = {
  isSender: boolean;
  isDeleted: boolean;
  convType: "direct" | "group";
  readerCount: number;
};

export type EditEligibilityResult = {
  allowed: boolean;
  reason?: string;
};

export function checkMessageEditEligibility(
  params: EditEligibilityCheck
): EditEligibilityResult {
  if (!params.isSender) {
    return {
      allowed: false,
      reason: "Unauthorized: You can only edit your own messages.",
    };
  }

  if (params.isDeleted) {
    return {
      allowed: false,
      reason: "Cannot edit a deleted message.",
    };
  }

  if (params.convType === "direct") {
    if (params.readerCount > 0) {
      return {
        allowed: false,
        reason: "Cannot edit: message has already been read by the recipient.",
      };
    }
  } else if (params.convType === "group") {
    if (params.readerCount > 2) {
      return {
        allowed: false,
        reason: "Cannot edit: message has been read by more than 2 members.",
      };
    }
  }

  return { allowed: true };
}
