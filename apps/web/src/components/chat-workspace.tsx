"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type Conversation = {
  id: string;
  type: "direct" | "group";
  title: string | null;
  created_at: string;
};

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  message_type: string;
  content: string | null;
  created_at: string;
  deleted_at: string | null;
};

export default function ChatWorkspace() {
  const router = useRouter();

  const [userId, setUserId] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationMembers, setConversationMembers] = useState<
    Record<string, string[]>
  >({});
  const [members, setMembers] = useState<Record<string, Profile>>({});
  const [filteredIds, setFilteredIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const loadConversations = useCallback(async (uid: string) => {
    const { data: memberships, error: membershipError } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", uid);

    if (membershipError) throw membershipError;

    const ids = [...new Set((memberships ?? []).map((m) => m.conversation_id))];

    if (ids.length === 0) {
      setConversations([]);
      setSelectedId("");
      setMessages([]);
      setMembers({});
      setConversationMembers({});
      return;
    }

    const { data: rows, error: conversationError } = await supabase
      .from("conversations")
      .select("id,type,title,created_at")
      .in("id", ids)
      .order("created_at", { ascending: false });

    if (conversationError) throw conversationError;

    const list = (rows ?? []) as Conversation[];
    setConversations(list);
    setSelectedId((previous) =>
      list.some((conversation) => conversation.id === previous)
        ? previous
        : list[0]?.id ?? ""
    );

    const { data: allMembers, error: membersError } = await supabase
      .from("conversation_members")
      .select("conversation_id,user_id")
      .in("conversation_id", ids);

    if (membersError) throw membersError;

    const convMembersMap: Record<string, string[]> = {};
    for (const m of allMembers ?? []) {
      if (!convMembersMap[m.conversation_id]) {
        convMembersMap[m.conversation_id] = [];
      }
      convMembersMap[m.conversation_id].push(m.user_id);
    }
    setConversationMembers(convMembersMap);

    const userIds = [
      ...new Set(
        (allMembers ?? []).map((m) => m.user_id).filter((id) => id !== uid)
      ),
    ];

    if (userIds.length === 0) {
      setMembers({});
      return;
    }

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id,username,display_name,avatar_url")
      .in("id", userIds);

    if (profilesError) throw profilesError;

    const map: Record<string, Profile> = {};
    for (const person of (profiles ?? []) as Profile[]) {
      map[person.id] = person;
    }
    setMembers(map);
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    const { data, error: messageError } = await supabase
      .from("messages")
      .select("id,conversation_id,sender_id,message_type,content,created_at,deleted_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(100);

    if (messageError) throw messageError;

    setMessages((data ?? []) as Message[]);
  }, []);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const { data, error: authError } = await supabase.auth.getUser();

        if (authError || !data.user) {
          router.replace("/auth");
          return;
        }

        if (!active) return;

        setUserId(data.user.id);

        const { data: ownProfile, error: profileError } = await supabase
          .from("profiles")
          .select("id,username,display_name,avatar_url")
          .eq("id", data.user.id)
          .maybeSingle();

        if (profileError) throw profileError;
        if (!active) return;

        setProfile(ownProfile as Profile | null);
        await loadConversations(data.user.id);
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : "Could not load chats.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [loadConversations, router]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }

    let active = true;

    async function load() {
      try {
        setError("");
        const { data, error: messageError } = await supabase
          .from("messages")
          .select("id,conversation_id,sender_id,message_type,content,created_at,deleted_at")
          .eq("conversation_id", selectedId)
          .order("created_at", { ascending: true })
          .limit(100);

        if (messageError) throw messageError;
        if (active) setMessages((data ?? []) as Message[]);
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : "Could not load messages.");
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;

    const channel = supabase
      .channel(`chat-${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          const incoming = payload.new as Message;
          setMessages((current) =>
            current.some((message) => message.id === incoming.id)
              ? current
              : [...current, incoming]
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedId]);

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = draft.trim();
    if (!content || !selectedId || !userId || sending) return;

    setSending(true);
    setError("");

    try {
      const { error: insertError } = await supabase.from("messages").insert({
        conversation_id: selectedId,
        sender_id: userId,
        message_type: "text",
        content,
      });

      if (insertError) throw insertError;

      setDraft("");
      await loadMessages(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  const selected = conversations.find((item) => item.id === selectedId);

  function conversationName(conversation: Conversation) {
    if (conversation.type === "group") {
      return conversation.title || "Untitled group";
    }

    // Accurate conversation-specific member lookup
    const memberIds = conversationMembers[conversation.id] ?? [];
    const otherId = memberIds.find((id) => id !== userId);
    const otherMember = otherId ? members[otherId] : undefined;

    return (
      otherMember?.display_name || otherMember?.username || "Direct conversation"
    );
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--muted)]">
        Loading PieChat…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--background)] p-3 text-[var(--foreground)] sm:p-6">
      <div className="mx-auto flex h-[calc(100dvh-24px)] max-w-7xl overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] sm:h-[calc(100dvh-48px)]">
        {/* Sidebar / Conversation list */}
        <aside
          className={`${
            selectedId ? "hidden md:flex" : "flex"
          } w-full shrink-0 flex-col border-r border-[var(--border)] md:w-80`}
        >
          <div className="border-b border-[var(--border)] p-5">
            <div className="flex items-center justify-between">
              <span className="text-xl font-bold tracking-tight">PieChat</span>
              <button
                className="text-sm font-medium text-[var(--primary)] hover:underline"
                onClick={() => router.push("/profile")}
              >
                Profile
              </button>
            </div>
            <p className="mt-2 truncate text-sm text-[var(--muted)]">
              {profile?.display_name || profile?.username || "Your account"}
            </p>
            <input
              aria-label="Search conversations"
              placeholder="Search conversations"
              className="mt-4 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]"
              onChange={(event) => {
                const query = event.target.value.toLowerCase();
                const visible = conversations.filter((conversation) =>
                  conversationName(conversation).toLowerCase().includes(query)
                );
                setFilteredIds(visible.map((conversation) => conversation.id));
              }}
            />
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              Conversations
            </p>
            {conversations.length === 0 ? (
              <div className="px-3 py-5 text-center">
                <p className="font-medium">No chats yet</p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  Find a friend to start a conversation.
                </p>
                <button
                  onClick={() => router.push("/friends")}
                  className="button-primary mt-4"
                >
                  Find friends
                </button>
              </div>
            ) : (
              conversations
                .filter(
                  (conversation) =>
                    !filteredIds.length || filteredIds.includes(conversation.id)
                )
                .map((conversation) => (
                  <button
                    key={conversation.id}
                    onClick={() => setSelectedId(conversation.id)}
                    className={`mb-1 flex w-full items-center gap-3 rounded-md p-3 text-left transition ${
                      selectedId === conversation.id
                        ? "bg-[var(--primary-soft)]"
                        : "hover:bg-[var(--background)]"
                    }`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] font-semibold text-[var(--primary)]">
                      {conversationName(conversation).slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {conversationName(conversation)}
                      </span>
                      <span className="block text-xs text-[var(--muted)]">
                        {conversation.type === "group"
                          ? "Group"
                          : "Direct message"}
                      </span>
                    </span>
                  </button>
                ))
            )}
          </div>

          <div className="flex gap-2 border-t border-[var(--border)] p-3">
            <button
              className="button-secondary flex-1"
              onClick={() => router.push("/friends")}
            >
              Friends
            </button>
            <button
              className="button-secondary flex-1"
              onClick={async () => {
                await supabase.auth.signOut();
                router.replace("/auth");
                router.refresh();
              }}
            >
              Log out
            </button>
          </div>
        </aside>

        {/* Chat / Message Panel */}
        <section
          className={`${
            selectedId ? "flex" : "hidden md:flex"
          } min-w-0 flex-1 flex-col`}
        >
          {selected ? (
            <>
              <header className="flex min-h-[72px] items-center gap-3 border-b border-[var(--border)] px-4 sm:px-6">
                <button
                  onClick={() => setSelectedId("")}
                  className="mr-1 text-sm font-medium text-[var(--primary)] md:hidden"
                >
                  ← Back
                </button>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary-soft)] font-semibold text-[var(--primary)]">
                  {conversationName(selected).slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h1 className="truncate font-semibold">
                    {conversationName(selected)}
                  </h1>
                  <p className="text-xs text-[var(--muted)]">
                    {selected.type === "group"
                      ? "Group conversation"
                      : "Direct conversation"}
                  </p>
                </div>
              </header>

              <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-6">
                {messages.length === 0 ? (
                  <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
                    <p className="font-semibold">Start the conversation</p>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      Send a message to get things going.
                    </p>
                  </div>
                ) : (
                  messages.map((message) => {
                    const mine = message.sender_id === userId;
                    return (
                      <div
                        key={message.id}
                        className={`flex ${
                          mine ? "justify-end" : "justify-start"
                        }`}
                      >
                        <div
                          className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-4 py-3 sm:max-w-[70%] ${
                            mine
                              ? "bg-[var(--primary)] text-white"
                              : "bg-[var(--background)]"
                          }`}
                        >
                          {message.deleted_at
                            ? "This message was deleted"
                            : message.content || `[${message.message_type}]`}
                          <p
                            className={`mt-1 text-right text-[10px] ${
                              mine ? "text-white/70" : "text-[var(--muted)]"
                            }`}
                          >
                            {new Date(message.created_at).toLocaleTimeString(
                              [],
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {error && (
                <p role="alert" className="px-4 text-sm text-red-700">
                  {error}
                </p>
              )}

              <form
                onSubmit={sendMessage}
                className="flex items-end gap-2 border-t border-[var(--border)] p-3 sm:p-4"
              >
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  rows={1}
                  maxLength={5000}
                  placeholder="Write a message…"
                  aria-label="Message"
                  className="max-h-32 min-h-11 flex-1 resize-y rounded-md border border-[var(--border)] bg-transparent px-3 py-3 text-sm outline-none focus:border-[var(--primary)]"
                />
                <button
                  disabled={sending || !draft.trim()}
                  className="button-primary disabled:opacity-50"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary-soft)] text-xl font-bold text-[var(--primary)]">
                P
              </div>
              <h1 className="mt-5 text-2xl font-semibold tracking-tight">
                Your conversations, all in one place.
              </h1>
              <p className="mt-3 max-w-sm text-sm leading-6 text-[var(--muted)]">
                Select a conversation or find friends to start chatting.
              </p>
              <button
                className="button-primary mt-5"
                onClick={() => router.push("/friends")}
              >
                Find friends
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
