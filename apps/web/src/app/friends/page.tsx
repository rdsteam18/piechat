"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Profile = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
};

type FriendRequest = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: string;
};

export default function FriendsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    async function initialize() {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        router.replace("/auth");
        return;
      }

      if (!active) return;
      setUserId(data.user.id);

      const { data: incoming, error: requestError } = await supabase
        .from("friendships")
        .select("id, requester_id, addressee_id, status")
        .eq("addressee_id", data.user.id)
        .eq("status", "pending");

      if (!active) return;

      if (requestError) {
        setStatus(`Could not load requests: ${requestError.message}`);
      } else {
        setRequests(incoming ?? []);

        const ids = [...new Set((incoming ?? []).map((r) => r.requester_id))];

        if (ids.length) {
          const { data: people } = await supabase
            .from("profiles")
            .select("id, username, display_name, bio")
            .in("id", ids);

          if (active && people) {
            setProfiles(Object.fromEntries(people.map((p) => [p.id, p])));
          }
        }
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [router]);

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
      .select("id, username, display_name, bio")
      .ilike("username", `%${username}%`)
      .neq("id", userId)
      .limit(20);

    setLoading(false);

    if (error) {
      setStatus(`Search failed: ${error.message}`);
      return;
    }

    setResults(data ?? []);
    if (!data?.length) setStatus("No users found.");
  }

  async function sendRequest(targetId: string) {
    setStatus("");

    const { error } = await supabase.from("friendships").insert({
      requester_id: userId,
      addressee_id: targetId,
      status: "pending",
    });

    if (error) {
      setStatus(
        error.code === "23505"
          ? "A request between these accounts already exists."
          : `Could not send request: ${error.message}`
      );
      return;
    }

    setStatus("Friend request sent.");
  }

  async function respond(requestId: string, accept: boolean) {
    setStatus("");

    const { error } = await supabase.rpc("respond_to_friend_request", {
      request_id: requestId,
      accept_request: accept,
    });

    if (error) {
      setStatus(`Could not respond: ${error.message}`);
      return;
    }

    setRequests((current) => current.filter((r) => r.id !== requestId));
    setStatus(accept ? "Friend request accepted." : "Request rejected.");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-5 sm:p-8">
      <header>
        <h1 className="text-3xl font-bold">Friends</h1>
        <p className="mt-2 text-gray-600">
          Find people by their PieChat username.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Discover people</h2>
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
            placeholder="Search username"
            className="min-w-0 flex-1 rounded-lg border px-3 py-3"
            maxLength={24}
          />
          <button
            disabled={loading}
            className="rounded-lg bg-black px-4 py-3 text-white disabled:opacity-50"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </form>

        <div className="space-y-3">
          {results.map((person) => (
            <article
              key={person.id}
              className="flex items-center justify-between gap-3 rounded-xl border p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold">{person.display_name}</p>
                <p className="truncate text-sm text-gray-500">
                  @{person.username}
                </p>
                {person.bio && (
                  <p className="mt-1 text-sm">{person.bio}</p>
                )}
              </div>
              <button
                onClick={() => void sendRequest(person.id)}
                className="shrink-0 rounded-lg bg-black px-3 py-2 text-sm text-white"
              >
                Add friend
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Incoming requests</h2>

        {requests.length === 0 && (
          <p className="text-sm text-gray-500">No pending requests.</p>
        )}

        {requests.map((request) => {
          const person = profiles[request.requester_id];

          return (
            <article
              key={request.id}
              className="flex items-center justify-between gap-3 rounded-xl border p-4"
            >
              <div>
                <p className="font-semibold">
                  {person?.display_name ?? "PieChat user"}
                </p>
                <p className="text-sm text-gray-500">
                  {person ? `@${person.username}` : "Incoming request"}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void respond(request.id, true)}
                  className="rounded-lg bg-black px-3 py-2 text-sm text-white"
                >
                  Accept
                </button>
                <button
                  onClick={() => void respond(request.id, false)}
                  className="rounded-lg border px-3 py-2 text-sm"
                >
                  Reject
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {status && (
        <p role="status" aria-live="polite" className="break-words rounded-lg border p-3 text-sm">
          {status}
        </p>
      )}

      <button
        onClick={() => router.push("/dashboard")}
        className="text-sm underline"
      >
        Back to dashboard
      </button>
    </main>
  );
}
