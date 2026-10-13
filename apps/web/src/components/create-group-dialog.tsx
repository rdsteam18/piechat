"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Friend = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type Props = {
  onClose: () => void;
  onCreated: (conversationId: string) => void;
};

export default function CreateGroupDialog({ onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadFriends() {
      try {
        const { data: auth, error: authError } =
          await supabase.auth.getUser();

        if (authError || !auth.user) {
          throw new Error("Please sign in again.");
        }

        const uid = auth.user.id;

        const { data: requests, error: requestError } = await supabase
          .from("friendships")
          .select("requester_id,addressee_id")
          .eq("status", "accepted")
          .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`);

        if (requestError) throw requestError;

        const ids = [
          ...new Set(
            (requests ?? []).map((request) =>
              request.requester_id === uid
                ? request.addressee_id
                : request.requester_id
            )
          ),
        ];

        if (ids.length === 0) {
          if (active) setFriends([]);
          return;
        }

        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("id,username,display_name,avatar_url")
          .in("id", ids)
          .order("display_name", { ascending: true });

        if (profilesError) throw profilesError;
        if (active) setFriends((profiles ?? []) as Friend[]);
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : "Could not load friends.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadFriends();
    return () => {
      active = false;
    };
  }, []);

  function toggleFriend(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }

  async function createGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const cleanTitle = title.trim();

    if (!cleanTitle) {
      setError("Enter a group name.");
      return;
    }

    if (selected.length === 0) {
      setError("Select at least one friend.");
      return;
    }

    setCreating(true);

    try {
      const { data, error: rpcError } = await supabase.rpc(
        "create_group_conversation",
        {
          group_title: cleanTitle,
          member_ids: selected,
        }
      );

      if (rpcError) throw rpcError;
      if (!data || typeof data !== "string") {
        throw new Error("Group was created, but no conversation ID was returned.");
      }

      onCreated(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create group.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-title"
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="create-group-title" className="text-xl font-semibold">
              Create a group
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Choose a name and invite your friends.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
          >
            Close
          </button>
        </div>

        <form onSubmit={createGroup} className="mt-5 space-y-5">
          <div>
            <label htmlFor="group-title" className="mb-2 block text-sm font-medium">
              Group name
            </label>
            <input
              id="group-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={80}
              required
              placeholder="e.g. College Friends"
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-3"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium">Members</label>
              <span className="text-xs text-[var(--muted)]">
                {selected.length} selected
              </span>
            </div>

            {loading ? (
              <p className="py-4 text-sm text-[var(--muted)]">Loading friends…</p>
            ) : friends.length === 0 ? (
              <p className="py-4 text-sm text-[var(--muted)]">
                No accepted friends found. Add a friend first.
              </p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {friends.map((friend) => {
                  const name =
                    friend.display_name || friend.username || "Unknown user";

                  return (
                    <label
                      key={friend.id}
                      className="flex cursor-pointer items-center gap-3 rounded-md p-3 hover:bg-[var(--background)]"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(friend.id)}
                        onChange={() => toggleFriend(friend.id)}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                      {friend.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={friend.avatar_url}
                          alt=""
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary-soft)] font-semibold text-[var(--primary)]">
                          {name.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {name}
                        </span>
                        {friend.username && (
                          <span className="block truncate text-xs text-[var(--muted)]">
                            @{friend.username}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={creating || loading || friends.length === 0}
            className="button-primary w-full disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create group"}
          </button>
        </form>
      </section>
    </div>
  );
}
