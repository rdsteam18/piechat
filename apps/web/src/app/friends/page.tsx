"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, getValidSession } from "@/lib/supabase";
import PublicProfileModal from "@/components/public-profile-modal";
import {
  Users,
  UserPlus,
  Search,
  ArrowLeft,
  MessageSquare,
  UserX,
  Check,
  X,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Filter,
} from "lucide-react";

type Profile = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url?: string | null;
  created_at?: string;
};

type FriendRequest = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: string;
};

type AcceptedFriend = {
  friendshipId: string;
  friend: Profile;
};

type FriendsTab = "my_friends" | "requests" | "discover";

export default function FriendsPage() {
  const router = useRouter();

  // Navigation tab
  const [activeTab, setActiveTab] = useState<FriendsTab>("my_friends");

  // User state
  const [userId, setUserId] = useState("");
  const [loadingInitial, setLoadingInitial] = useState(true);

  // Data state
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequestIds, setOutgoingRequestIds] = useState<Set<string>>(new Set());
  const [acceptedFriends, setAcceptedFriends] = useState<AcceptedFriend[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});

  // Search & Filter state
  const [friendFilterQuery, setFriendFilterQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Feedback & Action states
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Public Profile Modal
  const [viewingProfileUserId, setViewingProfileUserId] = useState<string | null>(null);

  // 1. Load Friendships Data (incoming, accepted, outgoing) with strict deduplication
  const loadData = useCallback(async (currentUserId: string) => {
    try {
      // A. Fetch incoming pending requests
      const { data: incoming, error: reqError } = await supabase
        .from("friendships")
        .select("id, requester_id, addressee_id, status")
        .eq("addressee_id", currentUserId)
        .eq("status", "pending");

      if (reqError) throw reqError;
      setRequests(incoming ?? []);

      // B. Fetch outgoing pending requests (to accurately reflect pending state in Discover)
      const { data: outgoing, error: outError } = await supabase
        .from("friendships")
        .select("id, requester_id, addressee_id, status")
        .eq("requester_id", currentUserId)
        .eq("status", "pending");

      if (!outError && outgoing) {
        setOutgoingRequestIds(new Set(outgoing.map((o) => o.addressee_id)));
      }

      // C. Fetch accepted friendships
      const { data: acceptedRows, error: acceptedError } = await supabase
        .from("friendships")
        .select("id, requester_id, addressee_id, status")
        .or(`requester_id.eq.${currentUserId},addressee_id.eq.${currentUserId}`)
        .eq("status", "accepted");

      if (acceptedError) throw acceptedError;

      // Collect IDs of all other profiles needed
      const incomingIds = (incoming ?? []).map((r) => r.requester_id);
      const acceptedOtherIds = (acceptedRows ?? []).map((r) =>
        r.requester_id === currentUserId ? r.addressee_id : r.requester_id
      );

      const allIds = [...new Set([...incomingIds, ...acceptedOtherIds])];

      if (allIds.length > 0) {
        const { data: people, error: peopleError } = await supabase
          .from("profiles")
          .select("id, username, display_name, bio, avatar_url, created_at")
          .in("id", allIds);

        if (peopleError) throw peopleError;

        const profileMap: Record<string, Profile> = {};
        for (const p of (people ?? []) as Profile[]) {
          profileMap[p.id] = p;
        }
        setProfiles(profileMap);

        // Strict Deduplication: Ensure each friend appears only once regardless of reciprocal rows
        const seenFriendIds = new Set<string>();
        const acceptedList: AcceptedFriend[] = [];

        for (const r of acceptedRows ?? []) {
          const otherId =
            r.requester_id === currentUserId ? r.addressee_id : r.requester_id;

          if (!seenFriendIds.has(otherId) && profileMap[otherId]) {
            seenFriendIds.add(otherId);
            acceptedList.push({
              friendshipId: r.id,
              friend: profileMap[otherId],
            });
          }
        }

        // Sort alphabetically by display name
        acceptedList.sort((a, b) =>
          (a.friend.display_name || a.friend.username).localeCompare(
            b.friend.display_name || b.friend.username
          )
        );

        setAcceptedFriends(acceptedList);
      } else {
        setAcceptedFriends([]);
      }
    } catch (e) {
      setStatus({
        type: "error",
        text: e instanceof Error ? e.message : "Could not load friendships data.",
      });
    }
  }, []);

  // 2. Auth initialization
  useEffect(() => {
    let active = true;

    async function initialize() {
      setLoadingInitial(true);
      const session = await getValidSession();
      if (!active) return;

      if (!session?.user) {
        router.replace("/auth");
        return;
      }

      setUserId(session.user.id);
      await loadData(session.user.id);
      if (active) setLoadingInitial(false);
    }

    void initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (!active) return;
      if (event === "SIGNED_OUT") {
        router.replace("/auth");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadData, router]);

  // 3. Search Users in Discover tab
  async function searchUsers() {
    const cleanQuery = searchQuery.trim().replace(/^@/, "");

    if (cleanQuery.length < 3) {
      setStatus({
        type: "error",
        text: "Please enter at least 3 characters to search.",
      });
      return;
    }

    setIsSearching(true);
    setStatus(null);

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, bio, avatar_url, created_at")
        .or(`username.ilike.%${cleanQuery}%,display_name.ilike.%${cleanQuery}%`)
        .neq("id", userId)
        .limit(25);

      if (error) throw error;

      setSearchResults((data ?? []) as Profile[]);
      if (!data?.length) {
        setStatus({
          type: "error",
          text: `No users found matching "${cleanQuery}".`,
        });
      }
    } catch (err) {
      setStatus({
        type: "error",
        text: err instanceof Error ? err.message : "Search failed.",
      });
    } finally {
      setIsSearching(false);
    }
  }

  // 4. Send Friend Request
  async function sendRequest(targetId: string) {
    if (!userId) return;
    setStatus(null);
    setActionLoading((prev) => ({ ...prev, [targetId]: true }));

    try {
      const { error } = await supabase.from("friendships").insert({
        requester_id: userId,
        addressee_id: targetId,
        status: "pending",
      });

      if (error) {
        if (error.code === "23505") {
          throw new Error("A request or connection with this user already exists.");
        }
        throw error;
      }

      setStatus({
        type: "success",
        text: "Friend request sent successfully!",
      });

      // Update outgoing set locally for immediate UI response
      setOutgoingRequestIds((prev) => new Set([...prev, targetId]));
      await loadData(userId);
    } catch (err) {
      setStatus({
        type: "error",
        text: err instanceof Error ? err.message : "Could not send request.",
      });
    } finally {
      setActionLoading((prev) => ({ ...prev, [targetId]: false }));
    }
  }

  // 5. Respond to Friend Request (Accept / Decline)
  async function respond(requestId: string, accept: boolean) {
    setStatus(null);
    setActionLoading((prev) => ({ ...prev, [requestId]: true }));

    try {
      const { error } = await supabase.rpc("respond_to_friend_request", {
        request_id: requestId,
        accept_request: accept,
      });

      if (error) throw error;

      setStatus({
        type: "success",
        text: accept ? "Friend request accepted!" : "Friend request declined.",
      });

      if (userId) await loadData(userId);
    } catch (err) {
      setStatus({
        type: "error",
        text: err instanceof Error ? err.message : "Could not respond to request.",
      });
    } finally {
      setActionLoading((prev) => ({ ...prev, [requestId]: false }));
    }
  }

  // 6. Remove Friend
  async function handleRemoveFriend(friendId: string, friendName: string) {
    if (
      !confirm(
        `Are you sure you want to remove ${friendName} from your friends list?`
      )
    ) {
      return;
    }

    setStatus(null);
    setActionLoading((prev) => ({ ...prev, [`remove_${friendId}`]: true }));

    try {
      const { error } = await supabase.rpc("remove_friend", {
        p_friend_id: friendId,
      });

      if (error) throw error;

      setStatus({
        type: "success",
        text: `${friendName} was removed from your friends.`,
      });

      if (userId) await loadData(userId);
    } catch (err) {
      setStatus({
        type: "error",
        text: err instanceof Error ? err.message : "Could not remove friend.",
      });
    } finally {
      setActionLoading((prev) => ({ ...prev, [`remove_${friendId}`]: false }));
    }
  }

  // 7. Open Direct Conversation
  async function openDirectChat(friendId: string) {
    if (!userId) {
      router.replace("/auth");
      return;
    }

    setStatus(null);
    setActionLoading((prev) => ({ ...prev, [`chat_${friendId}`]: true }));

    try {
      const { data: convId, error: rpcError } = await supabase.rpc(
        "get_or_create_direct_conversation",
        { p_friend_id: friendId }
      );

      if (rpcError) throw rpcError;

      if (convId) {
        router.push(`/dashboard?conversationId=${convId}`);
      } else {
        router.push("/dashboard");
      }
    } catch (e) {
      setStatus({
        type: "error",
        text: e instanceof Error ? e.message : "Could not open conversation.",
      });
      setActionLoading((prev) => ({ ...prev, [`chat_${friendId}`]: false }));
    }
  }

  // Filtered Friends List
  const filteredFriends = useMemo(() => {
    if (!friendFilterQuery.trim()) return acceptedFriends;
    const q = friendFilterQuery.toLowerCase().trim();
    return acceptedFriends.filter(
      (item) =>
        (item.friend.display_name || "").toLowerCase().includes(q) ||
        (item.friend.username || "").toLowerCase().includes(q)
    );
  }, [acceptedFriends, friendFilterQuery]);

  if (loadingInitial) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--muted)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
          <p className="text-sm font-medium">Loading friends…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--foreground)] sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Top Header Navigation */}
        <header className="flex items-center justify-between border-b border-[var(--border)] pb-4">
          <button
            onClick={() => router.push("/dashboard")}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition cursor-pointer"
          >
            <ArrowLeft size={16} />
            <span>Back to Chats</span>
          </button>

          <h1 className="text-lg font-bold tracking-tight sm:text-xl">
            Friends & Community
          </h1>

          <button
            onClick={() => router.push("/profile")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition cursor-pointer"
          >
            <span>My Profile</span>
          </button>
        </header>

        {/* Status Feedback Banner */}
        {status && (
          <div
            role="alert"
            className={`flex items-start gap-3 rounded-xl border p-4 text-sm font-medium transition animate-in fade-in ${
              status.type === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
            }`}
          >
            {status.type === "success" ? (
              <CheckCircle2
                size={18}
                className="shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400"
              />
            ) : (
              <AlertCircle
                size={18}
                className="shrink-0 mt-0.5 text-red-600 dark:text-red-400"
              />
            )}
            <span className="flex-1 break-words leading-relaxed">{status.text}</span>
            <button
              onClick={() => setStatus(null)}
              className="text-xs opacity-75 hover:opacity-100 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Hero Summary Card */}
        <section className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Friends
              </h2>
              <p className="mt-1 text-xs text-[var(--muted)] max-w-md">
                Connect with peers, accept friend requests, and start direct conversations.
              </p>
            </div>

            <div className="flex items-center gap-3 self-start sm:self-center">
              <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 shadow-xs">
                <Users size={18} className="text-[var(--primary)]" />
                <div>
                  <span className="text-[11px] text-[var(--muted)] block uppercase font-bold tracking-wider">
                    Accepted
                  </span>
                  <span className="text-base font-bold leading-none">
                    {acceptedFriends.length}
                  </span>
                </div>
              </div>

              {requests.length > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 shadow-xs text-sky-700 dark:text-sky-300">
                  <UserPlus size={18} className="text-sky-600 dark:text-sky-400" />
                  <div>
                    <span className="text-[11px] block uppercase font-bold tracking-wider opacity-80">
                      Requests
                    </span>
                    <span className="text-base font-bold leading-none">
                      {requests.length}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Tab Navigation Navigation Bar */}
        <nav
          aria-label="Friends sections"
          className="flex flex-wrap gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-xs"
        >
          <button
            onClick={() => setActiveTab("my_friends")}
            className={`flex flex-1 min-w-[120px] items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-xs font-semibold transition cursor-pointer ${
              activeTab === "my_friends"
                ? "bg-[var(--primary)] text-white shadow-xs"
                : "text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            }`}
          >
            <Users size={15} />
            <span>My Friends ({acceptedFriends.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("requests")}
            className={`flex flex-1 min-w-[120px] items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-xs font-semibold transition cursor-pointer ${
              activeTab === "requests"
                ? "bg-[var(--primary)] text-white shadow-xs"
                : "text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            }`}
          >
            <UserPlus size={15} />
            <span>Requests {requests.length > 0 ? `(${requests.length})` : ""}</span>
          </button>

          <button
            onClick={() => setActiveTab("discover")}
            className={`flex flex-1 min-w-[120px] items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-xs font-semibold transition cursor-pointer ${
              activeTab === "discover"
                ? "bg-[var(--primary)] text-white shadow-xs"
                : "text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            }`}
          >
            <Search size={15} />
            <span>Discover People</span>
          </button>
        </nav>

        {/* TAB 1: MY FRIENDS */}
        {activeTab === "my_friends" && (
          <section className="space-y-4">
            {/* Filter search bar for existing friends */}
            {acceptedFriends.length > 0 && (
              <div className="relative">
                <Filter
                  size={14}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
                />
                <input
                  value={friendFilterQuery}
                  onChange={(e) => setFriendFilterQuery(e.target.value)}
                  placeholder="Filter friends by name or @username…"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] pl-9 pr-4 py-2.5 text-xs font-medium outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition"
                />
                {friendFilterQuery && (
                  <button
                    onClick={() => setFriendFilterQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            {acceptedFriends.length === 0 ? (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-sm">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)] mb-3">
                  <Users size={26} />
                </div>
                <h3 className="text-base font-bold">No friends added yet</h3>
                <p className="mt-1 text-xs text-[var(--muted)] max-w-sm mx-auto leading-relaxed">
                  Search for peers or classmates in Discover People to send friend requests.
                </p>
                <button
                  onClick={() => setActiveTab("discover")}
                  className="button-primary mt-4 text-xs py-2 px-4 inline-flex items-center gap-1.5"
                >
                  <Sparkles size={14} />
                  <span>Discover People</span>
                </button>
              </div>
            ) : filteredFriends.length === 0 ? (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-xs text-[var(--muted)]">
                No friends match &ldquo;{friendFilterQuery}&rdquo;.
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredFriends.map(({ friendshipId, friend }) => (
                  <article
                    key={friendshipId}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm hover:border-[var(--primary)]/50 transition"
                  >
                    {/* Friend User Profile Info */}
                    <div
                      className="flex items-center gap-3.5 min-w-0 cursor-pointer"
                      onClick={() => setViewingProfileUserId(friend.id)}
                      title="View Profile"
                    >
                      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--primary-soft)] font-bold text-[var(--primary)] shadow-inner">
                        {friend.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={friend.avatar_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          (friend.display_name || friend.username || "U")
                            .slice(0, 1)
                            .toUpperCase()
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-bold text-sm hover:underline">
                            {friend.display_name}
                          </h3>
                        </div>
                        <p className="truncate text-xs font-medium text-[var(--muted)]">
                          @{friend.username}
                        </p>
                        {friend.bio && (
                          <p className="mt-1 line-clamp-1 text-xs text-[var(--muted)]">
                            {friend.bio}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      <button
                        disabled={actionLoading[`chat_${friend.id}`]}
                        onClick={() => void openDirectChat(friend.id)}
                        className="button-primary text-xs py-2 px-3.5 inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <MessageSquare size={14} />
                        <span>
                          {actionLoading[`chat_${friend.id}`]
                            ? "Opening…"
                            : "Message"}
                        </span>
                      </button>

                      <button
                        title="Remove Friend"
                        disabled={actionLoading[`remove_${friend.id}`]}
                        onClick={() =>
                          void handleRemoveFriend(
                            friend.id,
                            friend.display_name || friend.username
                          )
                        }
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-red-300 hover:text-red-600 dark:hover:text-red-400 transition cursor-pointer disabled:opacity-50"
                      >
                        <UserX size={15} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {/* TAB 2: INCOMING REQUESTS */}
        {activeTab === "requests" && (
          <section className="space-y-4">
            {requests.length === 0 ? (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-sm">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--background)] text-[var(--muted)] mb-3">
                  <UserPlus size={26} />
                </div>
                <h3 className="text-base font-bold">No incoming requests</h3>
                <p className="mt-1 text-xs text-[var(--muted)] max-w-sm mx-auto">
                  When someone sends you a friend request, you will see it here.
                </p>
              </div>
            ) : (
              <div className="grid gap-3">
                {requests.map((request) => {
                  const person = profiles[request.requester_id];
                  const isWorking = !!actionLoading[request.id];

                  return (
                    <article
                      key={request.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
                    >
                      <div
                        className="flex items-center gap-3.5 min-w-0 cursor-pointer"
                        onClick={() => {
                          if (person?.id) setViewingProfileUserId(person.id);
                        }}
                        title="View Profile"
                      >
                        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--primary-soft)] font-bold text-[var(--primary)] shadow-inner">
                          {person?.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={person.avatar_url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            (person?.display_name || person?.username || "U")
                              .slice(0, 1)
                              .toUpperCase()
                          )}
                        </div>

                        <div className="min-w-0">
                          <h3 className="truncate font-bold text-sm hover:underline">
                            {person?.display_name ?? "PieChat User"}
                          </h3>
                          <p className="truncate text-xs font-medium text-[var(--muted)]">
                            {person ? `@${person.username}` : "Incoming request"}
                          </p>
                          {person?.bio && (
                            <p className="mt-1 line-clamp-1 text-xs text-[var(--muted)]">
                              {person.bio}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        <button
                          disabled={isWorking}
                          onClick={() => void respond(request.id, true)}
                          className="button-primary text-xs py-2 px-3.5 inline-flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Check size={14} />
                          <span>Accept</span>
                        </button>
                        <button
                          disabled={isWorking}
                          onClick={() => void respond(request.id, false)}
                          className="button-secondary text-xs py-2 px-3.5 inline-flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <X size={14} />
                          <span>Decline</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* TAB 3: DISCOVER PEOPLE */}
        {activeTab === "discover" && (
          <section className="space-y-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
              <h3 className="text-base font-bold tracking-tight">Find People on PieChat</h3>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Search by username or display name to connect with friends.
              </p>

              <form
                className="mt-4 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void searchUsers();
                }}
              >
                <div className="relative flex-1">
                  <Search
                    size={15}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
                  />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by username or display name (e.g. devdhar)…"
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] pl-9 pr-4 py-2.5 text-xs font-medium outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition"
                    maxLength={24}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSearching}
                  className="button-primary text-xs py-2 px-4 disabled:opacity-50"
                >
                  {isSearching ? "Searching…" : "Search"}
                </button>
              </form>
            </div>

            {/* Results Grid */}
            {searchResults.length > 0 && (
              <div className="grid gap-3">
                {searchResults.map((person) => {
                  const isAcceptedFriend = acceptedFriends.some(
                    (a) => a.friend.id === person.id
                  );
                  const isPendingIncoming = requests.some(
                    (r) => r.requester_id === person.id
                  );
                  const isPendingOutgoing = outgoingRequestIds.has(person.id);

                  return (
                    <article
                      key={person.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm hover:border-[var(--primary)]/40 transition"
                    >
                      <div
                        className="flex items-center gap-3.5 min-w-0 cursor-pointer"
                        onClick={() => setViewingProfileUserId(person.id)}
                        title="View Profile"
                      >
                        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--primary-soft)] font-bold text-[var(--primary)] shadow-inner">
                          {person.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={person.avatar_url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            (person.display_name || person.username).slice(0, 1).toUpperCase()
                          )}
                        </div>

                        <div className="min-w-0">
                          <h4 className="truncate font-bold text-sm hover:underline">
                            {person.display_name}
                          </h4>
                          <p className="truncate text-xs font-medium text-[var(--muted)]">
                            @{person.username}
                          </p>
                          {person.bio && (
                            <p className="mt-1 line-clamp-1 text-xs text-[var(--muted)]">
                              {person.bio}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Contextual Action Button */}
                      <div className="self-end sm:self-center shrink-0">
                        {isAcceptedFriend ? (
                          <button
                            onClick={() => void openDirectChat(person.id)}
                            className="button-secondary text-xs py-2 px-3.5 inline-flex items-center gap-1.5"
                          >
                            <MessageSquare size={14} />
                            <span>Message</span>
                          </button>
                        ) : isPendingIncoming ? (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-sky-500/10 border border-sky-500/20 px-3 py-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300">
                            Check Requests
                          </span>
                        ) : isPendingOutgoing ? (
                          <button
                            disabled
                            className="button-secondary text-xs py-2 px-3.5 cursor-not-allowed opacity-75 inline-flex items-center gap-1.5"
                          >
                            <Clock size={13} />
                            <span>Request Pending</span>
                          </button>
                        ) : (
                          <button
                            disabled={actionLoading[person.id]}
                            onClick={() => void sendRequest(person.id)}
                            className="button-primary text-xs py-2 px-3.5 inline-flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <UserPlus size={14} />
                            <span>
                              {actionLoading[person.id] ? "Sending…" : "Add Friend"}
                            </span>
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Reusable Public User Profile Modal */}
      {viewingProfileUserId && (
        <PublicProfileModal
          targetUserId={viewingProfileUserId}
          currentUserId={userId}
          onClose={() => {
            setViewingProfileUserId(null);
            if (userId) void loadData(userId);
          }}
          onOpenDirectChat={(friendId) => {
            setViewingProfileUserId(null);
            void openDirectChat(friendId);
          }}
        />
      )}
    </main>
  );
}
