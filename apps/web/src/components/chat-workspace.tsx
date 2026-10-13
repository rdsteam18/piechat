"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

type ScheduledItem = {
  id: string;
  conversation_id: string;
  content: string;
  scheduledTime: number; // timestamp ms
};

export default function ChatWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialConversationParam = searchParams.get("conversationId");

  const [userId, setUserId] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationMembers, setConversationMembers] = useState<
    Record<string, string[]>
  >({});
  const [memberRoles, setMemberRoles] = useState<
    Record<string, Record<string, string>>
  >({});
  const [members, setMembers] = useState<Record<string, Profile>>({});
  const [filteredIds, setFilteredIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Step 14: Group Management State
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupTitleDraft, setGroupTitleDraft] = useState("");
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [acceptedFriends, setAcceptedFriends] = useState<Profile[]>([]);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [groupActionLoading, setGroupActionLoading] = useState(false);

  // Message Scheduling State
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledItems, setScheduledItems] = useState<ScheduledItem[]>([]);

  // Step 12: In-memory client cache
  const messagesCacheRef = useRef<Record<string, Message[]>>({});

  // Realtime typing
  const [typingUsers, setTypingUsers] = useState<
    Record<string, { username: string; expiresAt: number }>
  >({});
  const lastTypingBroadcastRef = useRef<number>(0);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Rate limiting tracker
  const recentSendTimestampsRef = useRef<number[]>([]);

  // Auto-scroll
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Fetch accepted friends for group creation
  const loadFriends = useCallback(async (uid: string) => {
    try {
      const { data: rows, error: friendsError } = await supabase
        .from("friendships")
        .select("id, requester_id, addressee_id, status")
        .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
        .eq("status", "accepted");

      if (friendsError) throw friendsError;

      const friendIds = (rows ?? []).map((r) =>
        r.requester_id === uid ? r.addressee_id : r.requester_id
      );

      if (friendIds.length === 0) {
        setAcceptedFriends([]);
        return;
      }

      const { data: people, error: peopleError } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .in("id", friendIds);

      if (peopleError) throw peopleError;
      setAcceptedFriends((people ?? []) as Profile[]);
    } catch {
      // Non-critical, graceful fallback
    }
  }, []);

  const loadConversations = useCallback(
    async (uid: string) => {
      const { data: memberships, error: membershipError } = await supabase
        .from("conversation_members")
        .select("conversation_id, user_id, role")
        .eq("user_id", uid);

      if (membershipError) throw membershipError;

      const ids = [...new Set((memberships ?? []).map((m) => m.conversation_id))];

      if (ids.length === 0) {
        setConversations([]);
        setSelectedId("");
        setMessages([]);
        setMembers({});
        setConversationMembers({});
        setMemberRoles({});
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

      setSelectedId((previous) => {
        if (
          initialConversationParam &&
          list.some((c) => c.id === initialConversationParam)
        ) {
          return initialConversationParam;
        }
        return list.some((conversation) => conversation.id === previous)
          ? previous
          : list[0]?.id ?? "";
      });

      const { data: allMembers, error: membersError } = await supabase
        .from("conversation_members")
        .select("conversation_id, user_id, role")
        .in("conversation_id", ids);

      if (membersError) throw membersError;

      const convMembersMap: Record<string, string[]> = {};
      const convRolesMap: Record<string, Record<string, string>> = {};

      for (const m of allMembers ?? []) {
        if (!convMembersMap[m.conversation_id]) {
          convMembersMap[m.conversation_id] = [];
          convRolesMap[m.conversation_id] = {};
        }
        convMembersMap[m.conversation_id].push(m.user_id);
        convRolesMap[m.conversation_id][m.user_id] = m.role;
      }
      setConversationMembers(convMembersMap);
      setMemberRoles(convRolesMap);

      const allUserIds = [
        ...new Set((allMembers ?? []).map((m) => m.user_id)),
      ];

      if (allUserIds.length === 0) {
        setMembers({});
        return;
      }

      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id,username,display_name,avatar_url")
        .in("id", allUserIds);

      if (profilesError) throw profilesError;

      const map: Record<string, Profile> = {};
      for (const person of (profiles ?? []) as Profile[]) {
        map[person.id] = person;
      }
      setMembers(map);
    },
    [initialConversationParam]
  );

  const loadMessages = useCallback(
    async (conversationId: string) => {
      if (!conversationId) {
        setMessages([]);
        return;
      }

      if (messagesCacheRef.current[conversationId]) {
        setMessages(messagesCacheRef.current[conversationId]);
      }

      const { data, error: messageError } = await supabase
        .from("messages")
        .select(
          "id,conversation_id,sender_id,message_type,content,created_at,deleted_at"
        )
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(100);

      if (messageError) throw messageError;

      const freshList = (data ?? []) as Message[];
      messagesCacheRef.current[conversationId] = freshList;
      setMessages(freshList);
      setTimeout(scrollToBottom, 50);
    },
    [scrollToBottom]
  );

  // Initialize
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
        await Promise.all([
          loadConversations(data.user.id),
          loadFriends(data.user.id),
        ]);
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
  }, [loadConversations, loadFriends, router]);

  // Selected conversation changed
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }

    let active = true;

    async function load() {
      try {
        setError("");
        await loadMessages(selectedId);
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
  }, [selectedId, loadMessages]);

  // Realtime subscription
  useEffect(() => {
    if (!selectedId || !userId) return;

    setTypingUsers({});

    const channel = supabase
      .channel(`chat-${selectedId}`, {
        config: {
          broadcast: { self: false },
        },
      })
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
          setMessages((current) => {
            if (current.some((m) => m.id === incoming.id)) return current;
            const updated = [...current, incoming];
            messagesCacheRef.current[selectedId] = updated;
            return updated;
          });
          setTimeout(scrollToBottom, 50);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          const updatedMsg = payload.new as Message;
          setMessages((current) => {
            const next = current.map((m) =>
              m.id === updatedMsg.id ? updatedMsg : m
            );
            messagesCacheRef.current[selectedId] = next;
            return next;
          });
        }
      )
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (!payload || payload.userId === userId) return;
        const typingSenderId = payload.userId as string;
        const typingSenderName = (payload.username as string) || "Someone";

        setTypingUsers((current) => ({
          ...current,
          [typingSenderId]: {
            username: typingSenderName,
            expiresAt: Date.now() + 2500,
          },
        }));
      })
      .subscribe();

    typingChannelRef.current = channel;

    const interval = setInterval(() => {
      const now = Date.now();
      setTypingUsers((current) => {
        let changed = false;
        const next: Record<string, { username: string; expiresAt: number }> = {};
        for (const [id, user] of Object.entries(current)) {
          if (user.expiresAt > now) {
            next[id] = user;
          } else {
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
      typingChannelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [selectedId, userId, scrollToBottom]);

  // Scheduled message dispatcher ticker
  useEffect(() => {
    if (scheduledItems.length === 0) return;

    const timer = setInterval(async () => {
      const now = Date.now();
      const readyToSend = scheduledItems.filter((item) => item.scheduledTime <= now);

      if (readyToSend.length === 0) return;

      setScheduledItems((current) =>
        current.filter((item) => item.scheduledTime > now)
      );

      for (const item of readyToSend) {
        try {
          await supabase.from("messages").insert({
            conversation_id: item.conversation_id,
            sender_id: userId,
            message_type: "text",
            content: item.content,
          });
          if (item.conversation_id === selectedId) {
            await loadMessages(selectedId);
          }
        } catch {
          // Scheduled item execution error
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [scheduledItems, userId, selectedId, loadMessages]);

  const broadcastTyping = useCallback(() => {
    if (!selectedId || !typingChannelRef.current) return;
    const now = Date.now();
    if (now - lastTypingBroadcastRef.current < 1200) return;

    lastTypingBroadcastRef.current = now;
    void typingChannelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: {
        userId,
        username: profile?.display_name || profile?.username || "Someone",
      },
    });
  }, [selectedId, userId, profile]);

  function handleDraftChange(value: string) {
    setDraft(value);
    if (value.trim()) {
      broadcastTyping();
    }
  }

  function checkRateLimit(): boolean {
    const now = Date.now();
    const windowStart = now - 4000;
    const recent = recentSendTimestampsRef.current.filter((t) => t > windowStart);

    if (recent.length >= 5) {
      setError("Please slow down. You are sending messages too quickly.");
      return false;
    }

    if (recent.length > 0 && now - recent[recent.length - 1] < 350) {
      setError("Please wait a moment before sending another message.");
      return false;
    }

    recent.push(now);
    recentSendTimestampsRef.current = recent;
    return true;
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = draft.trim();
    if (!content || !selectedId || !userId || sending) return;

    if (!checkRateLimit()) return;

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

  // Delete message action
  async function handleDeleteMessage(messageId: string) {
    setError("");
    try {
      const { error: updateError } = await supabase
        .from("messages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", messageId);

      if (updateError) throw updateError;

      setMessages((current) =>
        current.map((m) =>
          m.id === messageId ? { ...m, deleted_at: new Date().toISOString() } : m
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete message.");
    }
  }

  // Schedule message handler
  function handleScheduleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || !selectedId || !scheduledDate) return;

    const timeMs = new Date(scheduledDate).getTime();
    if (isNaN(timeMs) || timeMs <= Date.now()) {
      setError("Please pick a future time to schedule.");
      return;
    }

    setScheduledItems((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(2, 9),
        conversation_id: selectedId,
        content,
        scheduledTime: timeMs,
      },
    ]);

    setDraft("");
    setShowScheduleModal(false);
    setScheduledDate("");
  }

  // Create Group RPC
  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    const title = groupTitleDraft.trim();
    if (!title) {
      setError("Please enter a group name.");
      return;
    }
    if (selectedFriendIds.length === 0) {
      setError("Select at least one friend to add to the group.");
      return;
    }

    setGroupActionLoading(true);
    setError("");

    try {
      const { data: convId, error: rpcError } = await supabase.rpc(
        "create_group_conversation",
        {
          group_title: title,
          member_ids: selectedFriendIds,
        }
      );

      if (rpcError) throw rpcError;

      setShowCreateGroup(false);
      setGroupTitleDraft("");
      setSelectedFriendIds([]);

      await loadConversations(userId);
      if (convId) setSelectedId(convId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create group.");
    } finally {
      setGroupActionLoading(false);
    }
  }

  // Add members to existing group
  async function handleAddMembers(friendIds: string[]) {
    if (!selectedId || friendIds.length === 0) return;
    setGroupActionLoading(true);
    try {
      const { error: rpcError } = await supabase.rpc("add_group_members", {
        p_conv_id: selectedId,
        p_member_ids: friendIds,
      });

      if (rpcError) throw rpcError;

      setShowAddMembers(false);
      await loadConversations(userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add members.");
    } finally {
      setGroupActionLoading(false);
    }
  }

  // Remove member / leave group
  async function handleRemoveMember(targetUserId: string) {
    if (!selectedId) return;
    setGroupActionLoading(true);
    try {
      const { error: rpcError } = await supabase.rpc("remove_group_member", {
        p_conv_id: selectedId,
        p_target_user_id: targetUserId,
      });

      if (rpcError) throw rpcError;

      if (targetUserId === userId) {
        // User left the group
        setShowGroupInfo(false);
        setSelectedId("");
      }
      await loadConversations(userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove member.");
    } finally {
      setGroupActionLoading(false);
    }
  }

  const selected = conversations.find((item) => item.id === selectedId);

  function conversationName(conversation: Conversation) {
    if (conversation.type === "group") {
      return conversation.title || "Group conversation";
    }

    const memberIds = conversationMembers[conversation.id] ?? [];
    const otherId = memberIds.find((id) => id !== userId);
    const otherMember = otherId ? members[otherId] : undefined;

    return (
      otherMember?.display_name || otherMember?.username || "Direct conversation"
    );
  }

  const activeTypingList = Object.values(typingUsers).filter(
    (u) => u.expiresAt > Date.now()
  );

  const selectedConversationMemberIds = selected
    ? conversationMembers[selected.id] ?? []
    : [];

  const isUserAdmin =
    selected &&
    memberRoles[selected.id] &&
    memberRoles[selected.id][userId] === "admin";

  const conversationScheduledItems = scheduledItems.filter(
    (item) => item.conversation_id === selectedId
  );

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
        {/* Left Sidebar */}
        <aside
          className={`${
            selectedId ? "hidden md:flex" : "flex"
          } w-full shrink-0 flex-col border-r border-[var(--border)] md:w-80`}
        >
          <div className="border-b border-[var(--border)] p-5">
            <div className="flex items-center justify-between">
              <span className="text-xl font-bold tracking-tight">PieChat</span>
              <div className="flex items-center gap-3">
                <button
                  className="text-sm font-medium text-[var(--primary)] hover:underline"
                  onClick={() => router.push("/profile")}
                >
                  Profile
                </button>
              </div>
            </div>
            <p className="mt-2 truncate text-sm text-[var(--muted)]">
              {profile?.display_name || profile?.username || "Your account"}
            </p>

            <div className="mt-4 flex items-center gap-2">
              <input
                aria-label="Search conversations"
                placeholder="Search conversations"
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
                onChange={(event) => {
                  const query = event.target.value.toLowerCase();
                  const visible = conversations.filter((conversation) =>
                    conversationName(conversation).toLowerCase().includes(query)
                  );
                  setFilteredIds(visible.map((conversation) => conversation.id));
                }}
              />
              <button
                onClick={() => {
                  setError("");
                  setShowCreateGroup(true);
                }}
                title="Create Group"
                className="button-primary shrink-0 px-3 py-2 text-xs"
              >
                + Group
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              Conversations
            </p>
            {conversations.length === 0 ? (
              <div className="px-3 py-5 text-center">
                <p className="font-medium text-sm">No chats yet</p>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                  Find a friend or start a group to begin chatting.
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <button
                    onClick={() => router.push("/friends")}
                    className="button-primary text-xs"
                  >
                    Find friends
                  </button>
                  <button
                    onClick={() => setShowCreateGroup(true)}
                    className="button-secondary text-xs"
                  >
                    + New Group
                  </button>
                </div>
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
                      {conversation.type === "group" ? (
                        <span>👥</span>
                      ) : (
                        conversationName(conversation).slice(0, 1).toUpperCase()
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {conversationName(conversation)}
                      </span>
                      <span className="block text-xs text-[var(--muted)]">
                        {conversation.type === "group"
                          ? `Group (${
                              conversationMembers[conversation.id]?.length || 0
                            } members)`
                          : "Direct message"}
                      </span>
                    </span>
                  </button>
                ))
            )}
          </div>

          <div className="flex gap-2 border-t border-[var(--border)] p-3">
            <button
              className="button-secondary flex-1 text-sm"
              onClick={() => router.push("/friends")}
            >
              Friends
            </button>
            <button
              className="button-secondary flex-1 text-sm"
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
              {/* Chat Header */}
              <header className="flex min-h-[72px] items-center justify-between border-b border-[var(--border)] px-4 sm:px-6">
                <div
                  className="flex items-center gap-3 min-w-0 cursor-pointer"
                  onClick={() => {
                    if (selected.type === "group") setShowGroupInfo(true);
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId("");
                    }}
                    className="mr-1 text-sm font-medium text-[var(--primary)] md:hidden"
                  >
                    ← Back
                  </button>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary-soft)] font-semibold text-[var(--primary)]">
                    {selected.type === "group" ? (
                      <span>👥</span>
                    ) : (
                      conversationName(selected).slice(0, 1).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0">
                    <h1 className="truncate font-semibold">
                      {conversationName(selected)}
                    </h1>
                    <p className="text-xs text-[var(--muted)]">
                      {selected.type === "group"
                        ? `${selectedConversationMemberIds.length} members • Click for details`
                        : "Direct conversation"}
                    </p>
                  </div>
                </div>

                {selected.type === "group" && (
                  <button
                    onClick={() => setShowGroupInfo(true)}
                    className="button-secondary text-xs px-2.5 py-1.5"
                  >
                    Group Info
                  </button>
                )}
              </header>

              {/* Message History */}
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
                    const senderProfile = members[message.sender_id];
                    const senderName =
                      senderProfile?.display_name ||
                      senderProfile?.username ||
                      "User";

                    return (
                      <div
                        key={message.id}
                        className={`group relative flex ${
                          mine ? "justify-end" : "justify-start"
                        }`}
                      >
                        <div
                          className={`relative max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-4 py-3 sm:max-w-[70%] ${
                            mine
                              ? "bg-[var(--primary)] text-white"
                              : "bg-[var(--background)]"
                          }`}
                        >
                          {/* Show sender name in group chats if not mine */}
                          {!mine && selected.type === "group" && (
                            <p className="mb-1 text-xs font-semibold text-[var(--primary)]">
                              {senderName}
                            </p>
                          )}

                          {message.deleted_at ? (
                            <span className="italic text-xs opacity-75">
                              This message was deleted
                            </span>
                          ) : (
                            message.content || `[${message.message_type}]`
                          )}

                          <div className="mt-1 flex items-center justify-end gap-2">
                            <span
                              className={`text-[10px] ${
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
                            </span>

                            {/* Delete message icon for own message */}
                            {mine && !message.deleted_at && (
                              <button
                                onClick={() => void handleDeleteMessage(message.id)}
                                title="Delete message"
                                className="opacity-0 transition-opacity group-hover:opacity-100 text-[11px] text-white/80 hover:text-white"
                              >
                                🗑️
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Scheduled Messages Banner (if any pending) */}
              {conversationScheduledItems.length > 0 && (
                <div className="border-t border-[var(--border)] bg-[var(--primary-soft)] px-4 py-2 text-xs text-[var(--primary)]">
                  <span className="font-semibold">
                    {conversationScheduledItems.length} scheduled message(s) pending:
                  </span>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {conversationScheduledItems.map((item) => (
                      <span
                        key={item.id}
                        className="rounded bg-white/70 px-2 py-0.5 text-[11px]"
                      >
                        &quot;{item.content.slice(0, 15)}...&quot; at{" "}
                        {new Date(item.scheduledTime).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Realtime Typing Indicator */}
              {activeTypingList.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-[var(--muted)]">
                  <div className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--primary)] [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--primary)] [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--primary)]" />
                  </div>
                  <span>
                    {activeTypingList.map((u) => u.username).join(", ")}{" "}
                    {activeTypingList.length > 1 ? "are" : "is"} typing…
                  </span>
                </div>
              )}

              {error && (
                <p role="alert" className="px-4 py-1 text-xs text-red-600">
                  {error}
                </p>
              )}

              {/* Composer */}
              <form
                onSubmit={sendMessage}
                className="flex items-end gap-2 border-t border-[var(--border)] p-3 sm:p-4"
              >
                <textarea
                  value={draft}
                  onChange={(event) => handleDraftChange(event.target.value)}
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

                {/* Schedule button */}
                <button
                  type="button"
                  title="Schedule message"
                  disabled={!draft.trim()}
                  onClick={() => setShowScheduleModal(true)}
                  className="button-secondary shrink-0 px-3 py-2.5 text-sm disabled:opacity-40"
                >
                  ⏰
                </button>

                <button
                  disabled={sending || !draft.trim()}
                  className="button-primary shrink-0 disabled:opacity-50"
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
                Select a conversation, create a group, or find friends to start chatting.
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  className="button-primary"
                  onClick={() => router.push("/friends")}
                >
                  Find friends
                </button>
                <button
                  className="button-secondary"
                  onClick={() => setShowCreateGroup(true)}
                >
                  + Create Group
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* 1. Modal: Create New Group */}
      {showCreateGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <h2 className="text-xl font-bold tracking-tight">Create Group</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Name your group and choose friends to add.
            </p>

            <form onSubmit={handleCreateGroup} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Group Name
                </label>
                <input
                  required
                  maxLength={60}
                  value={groupTitleDraft}
                  onChange={(e) => setGroupTitleDraft(e.target.value)}
                  placeholder="e.g. Design Team, Family, Study Buddies"
                  className="mt-1.5 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Select Friends ({selectedFriendIds.length} selected)
                </label>
                <div className="mt-2 max-h-48 overflow-y-auto space-y-2 rounded-md border border-[var(--border)] p-2">
                  {acceptedFriends.length === 0 ? (
                    <p className="p-2 text-xs text-[var(--muted)]">
                      No accepted friends found. Add friends first to start a group!
                    </p>
                  ) : (
                    acceptedFriends.map((friend) => {
                      const isChecked = selectedFriendIds.includes(friend.id);
                      return (
                        <label
                          key={friend.id}
                          className="flex cursor-pointer items-center justify-between rounded p-2 text-sm transition hover:bg-[var(--background)]"
                        >
                          <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--primary-soft)] text-xs font-bold text-[var(--primary)]">
                              {(friend.display_name || friend.username || "U")
                                .slice(0, 1)
                                .toUpperCase()}
                            </span>
                            <span>{friend.display_name || friend.username}</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setSelectedFriendIds((prev) =>
                                isChecked
                                  ? prev.filter((id) => id !== friend.id)
                                  : [...prev, friend.id]
                              );
                            }}
                            className="h-4 w-4 rounded accent-[var(--primary)]"
                          />
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              {error && <p className="text-xs text-red-600">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateGroup(false)}
                  className="button-secondary text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    groupActionLoading ||
                    !groupTitleDraft.trim() ||
                    selectedFriendIds.length === 0
                  }
                  className="button-primary text-sm disabled:opacity-50"
                >
                  {groupActionLoading ? "Creating…" : "Create Group"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Modal: Group Info & Management */}
      {showGroupInfo && selected && selected.type === "group" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <div>
                <h2 className="text-xl font-bold tracking-tight">
                  {conversationName(selected)}
                </h2>
                <p className="text-xs text-[var(--muted)]">
                  {selectedConversationMemberIds.length} members
                </p>
              </div>
              <button
                onClick={() => {
                  setShowGroupInfo(false);
                  setShowAddMembers(false);
                }}
                className="text-lg text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                ✕
              </button>
            </div>

            {/* Members List */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Group Members
                </span>
                {isUserAdmin && (
                  <button
                    onClick={() => setShowAddMembers(!showAddMembers)}
                    className="text-xs font-semibold text-[var(--primary)] hover:underline"
                  >
                    + Add Member
                  </button>
                )}
              </div>

              {/* Add member sub-view */}
              {showAddMembers && (
                <div className="mt-2 rounded-md border border-[var(--border)] p-2">
                  <p className="text-xs text-[var(--muted)] mb-2">
                    Select friends to add to this group:
                  </p>
                  {acceptedFriends.filter(
                    (f) => !selectedConversationMemberIds.includes(f.id)
                  ).length === 0 ? (
                    <p className="text-xs text-[var(--muted)]">
                      All your accepted friends are already in this group.
                    </p>
                  ) : (
                    acceptedFriends
                      .filter(
                        (f) => !selectedConversationMemberIds.includes(f.id)
                      )
                      .map((friend) => (
                        <div
                          key={friend.id}
                          className="flex items-center justify-between p-1 text-xs"
                        >
                          <span>{friend.display_name || friend.username}</span>
                          <button
                            onClick={() => void handleAddMembers([friend.id])}
                            disabled={groupActionLoading}
                            className="button-primary text-[11px] px-2 py-1"
                          >
                            Add
                          </button>
                        </div>
                      ))
                  )}
                </div>
              )}

              <div className="mt-3 max-h-56 overflow-y-auto space-y-2">
                {selectedConversationMemberIds.map((mId) => {
                  const mProfile = members[mId];
                  const role =
                    memberRoles[selected.id]?.[mId] || "member";
                  const isSelf = mId === userId;

                  return (
                    <div
                      key={mId}
                      className="flex items-center justify-between rounded p-2 text-sm hover:bg-[var(--background)]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--primary-soft)] text-xs font-bold text-[var(--primary)]">
                          {(mProfile?.display_name || mProfile?.username || "U")
                            .slice(0, 1)
                            .toUpperCase()}
                        </span>
                        <div>
                          <p className="font-semibold text-xs leading-4">
                            {mProfile?.display_name || mProfile?.username || "Member"}{" "}
                            {isSelf && "(You)"}
                          </p>
                          <p className="text-[10px] text-[var(--muted)]">
                            {role === "admin" ? "Admin" : "Member"}
                          </p>
                        </div>
                      </div>

                      {/* Admin remove member button */}
                      {isUserAdmin && !isSelf && (
                        <button
                          onClick={() => void handleRemoveMember(mId)}
                          disabled={groupActionLoading}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 flex justify-between border-t border-[var(--border)] pt-4">
              <button
                onClick={() => void handleRemoveMember(userId)}
                disabled={groupActionLoading}
                className="text-xs font-medium text-red-600 hover:underline"
              >
                Leave Group
              </button>
              <button
                onClick={() => setShowGroupInfo(false)}
                className="button-secondary text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Modal: Schedule Message */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <h2 className="text-lg font-bold tracking-tight">Schedule Message</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Choose the date and time when this message should be sent automatically.
            </p>

            <form onSubmit={handleScheduleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Send Time
                </label>
                <input
                  type="datetime-local"
                  required
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div className="rounded bg-[var(--background)] p-3 text-xs text-[var(--muted)]">
                <span className="font-semibold text-[var(--foreground)]">Message:</span>{" "}
                &quot;{draft}&quot;
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowScheduleModal(false)}
                  className="button-secondary text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!scheduledDate}
                  className="button-primary text-sm disabled:opacity-50"
                >
                  Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
