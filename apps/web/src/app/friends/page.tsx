"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Profile = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url?: string | null;
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

export default function FriendsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [acceptedFriends, setAcceptedFriends] = useState<AcceptedFriend[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async (currentUserId: string) => {
    try {
      // 1. Fetch incoming pending requests
      const { data: incoming, error: reqError } = await supabase
        .from("friendships")
        .select("id, requester_id, addressee_id, status")
        .eq("addressee_id", currentUserId)
        .eq("status", "pending");

      if (reqError) throw reqError;
      setRequests(incoming ?? []);

      // 2. Fetch accepted friendships
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
          .select("id, username, display_name, bio, avatar_url")
          .in("id", allIds);

        if (peopleError) throw peopleError;

        const profileMap: Record<string, Profile> = {};
        for (const p of (people ?? []) as Profile[]) {
          profileMap[p.id] = p;
        }
        setProfiles(profileMap);

        const acceptedList: AcceptedFriend[] = [];
        for (const r of acceptedRows ?? []) {
          const otherId =
            r.requester_id === currentUserId ? r.addressee_id : r.requester_id;
          if (profileMap[otherId]) {
            acceptedList.push({
              friendshipId: r.id,
              friend: profileMap[otherId],
            });
          }
        }
        setAcceptedFriends(acceptedList);
      } else {
        setAcceptedFriends([]);
      }
    } catch (e) {
      setStatus(
        e instanceof Error ? e.message : "Could not load friendships data."
      );
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function initialize() {
      let authUser: { id: string } | null = null;
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user) {
        authUser = sessionData.session.user;
      } else {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user) {
          authUser = userData.user;
        }
      }

      if (!authUser) {
        router.replace("/auth");
        return;
      }

      if (!active) return;
      setUserId(authUser.id);
      await loadData(authUser.id);
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [loadData, router]);

  async function searchUsers() {
    const username = query.trim().replace(/^@/, "");

    if (username.length < 3) {
      setStatus("Enter at least 3 characters to search.");
      return;
    }

    setLoading(true);
    setStatus("");

    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, bio, avatar_url")
      .ilike("username", `%${username}%`)
      .neq("id", userId)
      .limit(20);

    setLoading(false);

    if (error) {
      setStatus(`Search failed: ${error.message}`);
      return;
    }

    setResults((data ?? []) as Profile[]);
    if (!data?.length) setStatus("No users found.");
  }

  async function sendRequest(targetId: string) {
    setStatus("");
    setActionLoading((prev) => ({ ...prev, [targetId]: true }));

    const { error } = await supabase.from("friendships").insert({
      requester_id: userId,
      addressee_id: targetId,
      status: "pending",
    });

    setActionLoading((prev) => ({ ...prev, [targetId]: false }));

    if (error) {
      setStatus(
        error.code === "23505"
          ? "A request or connection with this user already exists."
          : `Could not send request: ${error.message}`
      );
      return;
    }

    setStatus("Friend request sent successfully.");
  }

  async function respond(requestId: string, accept: boolean) {
    setStatus("");
    setActionLoading((prev) => ({ ...prev, [requestId]: true }));

    const { error } = await supabase.rpc("respond_to_friend_request", {
      request_id: requestId,
      accept_request: accept,
    });

    setActionLoading((prev) => ({ ...prev, [requestId]: false }));

    if (error) {
      setStatus(`Could not respond: ${error.message}`);
      return;
    }

    setStatus(accept ? "Friend request accepted!" : "Request declined.");
    if (userId) await loadData(userId);
  }

  async function openDirectChat(friendId: string) {
    setStatus("");
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
      setStatus(
        e instanceof Error ? e.message : "Could not open conversation."
      );
      setActionLoading((prev) => ({ ...prev, [`chat_${friendId}`]: false }));
    }
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--foreground)] sm:px-6">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="flex items-center justify-between border-b border-[var(--border)] pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Friends</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Find friends, manage requests, and start direct conversations.
            </p>
          </div>
          <button
            onClick={() => router.push("/dashboard")}
            className="button-secondary text-sm"
          >
            ← Back to Chats
          </button>
        </header>

        {status && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm text-[var(--foreground)]"
          >
            {status}
          </div>
        )}

        {/* 1. Accepted Friends Section (Step 13) */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              My Friends ({acceptedFriends.length})
            </h2>
          </div>

          {acceptedFriends.length === 0 ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--muted)]">
              You haven&apos;t added any friends yet. Search for a username below to connect.
            </div>
          ) : (
            <div className="grid gap-3">
              {acceptedFriends.map(({ friendshipId, friend }) => (
                <article
                  key={friendshipId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--primary)]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] font-semibold text-[var(--primary)]">
                      {(friend.display_name || friend.username).slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-sm">
                        {friend.display_name}
                      </p>
                      <p className="truncate text-xs text-[var(--muted)]">
                        @{friend.username}
                      </p>
                      {friend.bio && (
                        <p className="mt-1 truncate text-xs text-[var(--muted)]">
                          {friend.bio}
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    disabled={actionLoading[`chat_${friend.id}`]}
                    onClick={() => void openDirectChat(friend.id)}
                    className="button-primary shrink-0 text-sm disabled:opacity-50"
                  >
                    {actionLoading[`chat_${friend.id}`]
                      ? "Opening…"
                      : "Message"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* 2. Incoming Requests */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">
            Incoming Requests ({requests.length})
          </h2>

          {requests.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No pending requests.</p>
          ) : (
            <div className="grid gap-3">
              {requests.map((request) => {
                const person = profiles[request.requester_id];
                const isWorking = !!actionLoading[request.id];

                return (
                  <article
                    key={request.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-sm">
                        {person?.display_name ?? "PieChat user"}
                      </p>
                      <p className="truncate text-xs text-[var(--muted)]">
                        {person ? `@${person.username}` : "Incoming request"}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        disabled={isWorking}
                        onClick={() => void respond(request.id, true)}
                        className="button-primary text-xs disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        disabled={isWorking}
                        onClick={() => void respond(request.id, false)}
                        className="button-secondary text-xs disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* 3. Discover People */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Discover people</h2>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void searchUsers();
            }}
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by username (e.g. devdhar)"
              className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]"
              maxLength={24}
            />
            <button
              disabled={loading}
              className="button-primary text-sm disabled:opacity-50"
            >
              {loading ? "Searching…" : "Search"}
            </button>
          </form>

          {results.length > 0 && (
            <div className="grid gap-3 pt-2">
              {results.map((person) => {
                const isFriend = acceptedFriends.some(
                  (a) => a.friend.id === person.id
                );

                return (
                  <article
                    key={person.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-sm">
                        {person.display_name}
                      </p>
                      <p className="truncate text-xs text-[var(--muted)]">
                        @{person.username}
                      </p>
                      {person.bio && (
                        <p className="mt-1 truncate text-xs text-[var(--muted)]">
                          {person.bio}
                        </p>
                      )}
                    </div>
                    {isFriend ? (
                      <button
                        onClick={() => void openDirectChat(person.id)}
                        className="button-secondary shrink-0 text-xs"
                      >
                        Message
                      </button>
                    ) : (
                      <button
                        disabled={actionLoading[person.id]}
                        onClick={() => void sendRequest(person.id)}
                        className="button-primary shrink-0 text-xs disabled:opacity-50"
                      >
                        {actionLoading[person.id] ? "Sending…" : "Add friend"}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
