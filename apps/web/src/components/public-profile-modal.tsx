"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  X,
  MessageSquare,
  UserPlus,
  Clock,
  Check,
  ShieldAlert,
  UserCheck,
  Ban,
  Calendar,
} from "lucide-react";

export type PublicProfileModalProps = {
  targetUserId: string;
  currentUserId: string;
  onClose: () => void;
  onOpenDirectChat?: (targetUserId: string) => void;
};

type UserProfile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
};

type FriendshipRecord = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "rejected" | "blocked";
};

export default function PublicProfileModal({
  targetUserId,
  currentUserId,
  onClose,
  onOpenDirectChat,
}: PublicProfileModalProps) {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [friendship, setFriendship] = useState<FriendshipRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isSelf = currentUserId === targetUserId;

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      // 1. Fetch public profile
      const { data: profileData, error: profileErr } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, bio, created_at")
        .eq("id", targetUserId)
        .single();

      if (profileErr || !profileData) {
        throw new Error("Could not find user profile.");
      }
      setProfile(profileData as UserProfile);

      // 2. Fetch friendship relation if not self
      if (currentUserId && currentUserId !== targetUserId) {
        const { data: friendData, error: friendErr } = await supabase
          .from("friendships")
          .select("id, requester_id, addressee_id, status")
          .or(
            `and(requester_id.eq.${currentUserId},addressee_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},addressee_id.eq.${currentUserId})`
          )
          .maybeSingle();

        if (!friendErr && friendData) {
          setFriendship(friendData as FriendshipRecord);
        } else {
          setFriendship(null);
        }
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to load profile."
      );
    } finally {
      setLoading(false);
    }
  }, [currentUserId, targetUserId]);

  useEffect(() => {
    void loadData();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loadData, onClose]);

  // Actions
  async function handleSendFriendRequest() {
    setActionLoading(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const { error } = await supabase.from("friendships").insert({
        requester_id: currentUserId,
        addressee_id: targetUserId,
        status: "pending",
      });

      if (error) {
        if (error.code === "23505") {
          throw new Error("A request or connection already exists.");
        }
        throw new Error(error.message);
      }

      setStatusMessage("Friend request sent!");
      await loadData();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to send request."
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRespondFriendRequest(accept: boolean) {
    if (!friendship) return;
    setActionLoading(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const { error } = await supabase.rpc("respond_to_friend_request", {
        request_id: friendship.id,
        accept_request: accept,
      });

      if (error) throw new Error(error.message);

      setStatusMessage(accept ? "Friend request accepted!" : "Request declined.");
      await loadData();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to respond to request."
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleOpenDirectChat() {
    setActionLoading(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      if (onOpenDirectChat) {
        onOpenDirectChat(targetUserId);
        onClose();
        return;
      }

      const { data: convId, error: rpcError } = await supabase.rpc(
        "get_or_create_direct_conversation",
        { p_friend_id: targetUserId }
      );

      if (rpcError) throw new Error(rpcError.message);

      onClose();
      if (convId) {
        router.push(`/dashboard?conversationId=${convId}`);
      } else {
        router.push("/dashboard");
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not open conversation."
      );
      setActionLoading(false);
    }
  }

  async function handleBlockUser() {
    if (
      !confirm(
        `Are you sure you want to block ${
          profile?.display_name || profile?.username || "this user"
        }? You will no longer receive calls or direct messages from them.`
      )
    ) {
      return;
    }

    setActionLoading(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const { error } = await supabase.rpc("block_user", {
        p_target_user_id: targetUserId,
      });

      if (error) throw new Error(error.message);

      setStatusMessage("User has been blocked.");
      await loadData();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to block user."
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUnblockUser() {
    setActionLoading(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const { error } = await supabase.rpc("unblock_user", {
        p_target_user_id: targetUserId,
      });

      if (error) throw new Error(error.message);

      setStatusMessage("User unblocked.");
      await loadData();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to unblock user."
      );
    } finally {
      setActionLoading(false);
    }
  }

  const isBlockedByMe =
    friendship?.status === "blocked" && friendship.requester_id === currentUserId;
  const isBlockedByThem =
    friendship?.status === "blocked" && friendship.addressee_id === currentUserId;
  const isAccepted = friendship?.status === "accepted";
  const isPendingIncoming =
    friendship?.status === "pending" && friendship.addressee_id === currentUserId;
  const isPendingOutgoing =
    friendship?.status === "pending" && friendship.requester_id === currentUserId;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header background banner */}
        <div className="h-28 bg-gradient-to-r from-[var(--primary)] to-emerald-700/80" />

        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close profile modal"
          className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition"
        >
          <X size={18} />
        </button>

        {/* Profile Content */}
        <div className="px-6 pb-6 pt-0">
          {/* Avatar row */}
          <div className="relative -mt-14 mb-4 flex items-end justify-between">
            <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-[var(--surface)] bg-[var(--primary-soft)] text-2xl font-bold text-[var(--primary)] shadow-md">
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt={profile.display_name || "User Avatar"}
                  className="h-full w-full object-cover"
                />
              ) : (
                (profile?.display_name || profile?.username || "U")
                  .slice(0, 1)
                  .toUpperCase()
              )}
            </div>

            {/* Relationship Status Badges */}
            <div className="mb-2">
              {isSelf && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--primary-soft)] px-3 py-1 text-xs font-semibold text-[var(--primary)]">
                  You
                </span>
              )}
              {isAccepted && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <UserCheck size={13} /> Friends
                </span>
              )}
              {isPendingOutgoing && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  <Clock size={13} /> Request Pending
                </span>
              )}
              {isPendingIncoming && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-600 dark:text-sky-400">
                  Incoming Request
                </span>
              )}
              {isBlockedByMe && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-600 dark:text-red-400">
                  <Ban size={13} /> Blocked
                </span>
              )}
            </div>
          </div>

          {/* Skeleton or Loaded Info */}
          {loading ? (
            <div className="space-y-3 py-4 animate-pulse">
              <div className="h-6 w-36 rounded-md bg-[var(--border)]" />
              <div className="h-4 w-24 rounded-md bg-[var(--border)]" />
              <div className="h-14 w-full rounded-md bg-[var(--border)]" />
            </div>
          ) : profile ? (
            <div>
              <div className="mb-1">
                <h3 className="text-xl font-bold tracking-tight text-[var(--foreground)]">
                  {profile.display_name}
                </h3>
                <p className="text-sm font-medium text-[var(--muted)]">
                  @{profile.username}
                </p>
              </div>

              {/* Bio */}
              <div className="my-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-xs leading-relaxed text-[var(--foreground)]">
                {profile.bio && profile.bio.trim() ? (
                  profile.bio
                ) : (
                  <span className="italic text-[var(--muted)]">
                    No bio shared yet.
                  </span>
                )}
              </div>

              {/* Joined Date */}
              {profile.created_at && (
                <p className="mb-5 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                  <Calendar size={13} />
                  Joined{" "}
                  {new Date(profile.created_at).toLocaleDateString([], {
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              )}

              {/* Status / Error Alerts */}
              {statusMessage && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mb-4 rounded-lg bg-emerald-500/10 p-2.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                >
                  {statusMessage}
                </div>
              )}
              {errorMessage && (
                <div
                  role="alert"
                  className="mb-4 rounded-lg bg-red-500/10 p-2.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-500/20"
                >
                  {errorMessage}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col gap-2.5 pt-2">
                {isSelf ? (
                  <button
                    onClick={() => {
                      onClose();
                      router.push("/profile");
                    }}
                    className="button-primary w-full text-sm"
                  >
                    Edit My Profile
                  </button>
                ) : isBlockedByThem ? (
                  <div className="rounded-lg border border-[var(--border)] p-3 text-center text-xs text-[var(--muted)]">
                    User is unavailable.
                  </div>
                ) : isBlockedByMe ? (
                  <div className="flex gap-2">
                    <button
                      onClick={handleUnblockUser}
                      disabled={actionLoading}
                      className="button-secondary flex-1 text-xs disabled:opacity-50"
                    >
                      {actionLoading ? "Unblocking…" : "Unblock User"}
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Primary relationship actions */}
                    {isAccepted ? (
                      <button
                        onClick={handleOpenDirectChat}
                        disabled={actionLoading}
                        className="button-primary flex w-full items-center justify-center gap-2 text-sm disabled:opacity-50"
                      >
                        <MessageSquare size={16} />
                        {actionLoading ? "Opening…" : "Send Message"}
                      </button>
                    ) : isPendingIncoming ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRespondFriendRequest(true)}
                          disabled={actionLoading}
                          className="button-primary flex-1 items-center justify-center gap-1.5 text-xs disabled:opacity-50"
                        >
                          <Check size={14} /> Accept Request
                        </button>
                        <button
                          onClick={() => handleRespondFriendRequest(false)}
                          disabled={actionLoading}
                          className="button-secondary flex-1 items-center justify-center gap-1.5 text-xs disabled:opacity-50"
                        >
                          <X size={14} /> Decline
                        </button>
                      </div>
                    ) : isPendingOutgoing ? (
                      <button
                        disabled
                        className="button-secondary w-full cursor-not-allowed text-xs opacity-75"
                      >
                        <Clock size={14} className="mr-1.5 inline" /> Request
                        Pending
                      </button>
                    ) : (
                      <button
                        onClick={handleSendFriendRequest}
                        disabled={actionLoading}
                        className="button-primary flex w-full items-center justify-center gap-2 text-sm disabled:opacity-50"
                      >
                        <UserPlus size={16} />
                        {actionLoading ? "Sending…" : "Add Friend"}
                      </button>
                    )}

                    {/* Secondary safety action: Block user */}
                    <div className="pt-2 border-t border-[var(--border)] flex justify-end">
                      <button
                        onClick={handleBlockUser}
                        disabled={actionLoading}
                        className="text-xs text-[var(--muted)] hover:text-red-600 transition inline-flex items-center gap-1 cursor-pointer"
                      >
                        <ShieldAlert size={13} />
                        Block user
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-[var(--muted)]">
              Profile not found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
