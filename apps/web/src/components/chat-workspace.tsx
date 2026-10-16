"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import CreateGroupDialog from "@/components/create-group-dialog";
import MessageActionMenu, { MessageAction } from "@/components/message-action-menu";
import { checkMessageEditEligibility } from "@/lib/message-actions";
import {
  MessageSquare,
  Users,
  Star as StarIcon,
  User as UserIcon,
  LogOut,
  Search,
  Plus,
  Smile,
  Clock,
  Send,
  Pin as PinIcon,
  ArrowLeft,
  X,
  CheckCheck,
  Check,
  CheckSquare,
  Trash2,
  Phone,
  Video,
} from "lucide-react";
import VoiceCallModal from "@/components/voice-call-modal";
import CallHistoryModal from "@/components/call-history-modal";
import PublicProfileModal from "@/components/public-profile-modal";
import { getSocket } from "@/lib/socket";

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
  reply_to_id?: string | null;
  edited_at?: string | null;
  created_at: string;
  deleted_at: string | null;
};

type ScheduledItem = {
  id: string;
  conversation_id: string;
  content: string;
  scheduledTime: number;
};

type Reaction = {
  message_id: string;
  user_id: string;
  emoji: string;
};

type Receipt = {
  message_id: string;
  user_id: string;
  delivered_at: string | null;
  read_at: string | null;
};

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const EMOJI_PICKER_LIST = [
  "😀", "😂", "😍", "🥰", "😎", "🥳", "🤔", "😭", "😡", "🤯",
  "👍", "👎", "👏", "🙌", "🙏", "🤝", "💪", "✌️", "👋", "🔥",
  "❤️", "✨", "🎉", "🚀", "💯", "⭐", "🍕", "☕", "💻", "📚"
];

export default function ChatWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();

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
  const [searchQuery, setSearchQuery] = useState("");
  const [chatFilter, setChatFilter] = useState<"all" | "unread" | "groups">("all");
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Group Management
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [acceptedFriends, setAcceptedFriends] = useState<Profile[]>([]);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [groupActionLoading, setGroupActionLoading] = useState(false);

  // Message Scheduling
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledItems, setScheduledItems] = useState<ScheduledItem[]>([]);

  // WhatsApp-style Message Actions
  const [replyingTo, setReplyingTo] = useState<{
    id: string;
    content: string;
    senderName: string;
  } | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [starredMessageIds, setStarredMessageIds] = useState<string[]>([]);
  const [pinnedMessageId, setPinnedMessageId] = useState<string | null>(null);
  const [openActionMenuMsgId, setOpenActionMenuMsgId] = useState<string | null>(null);
  const [openReactionPickerMsgId, setOpenReactionPickerMsgId] = useState<string | null>(null);

  // Multiple Selection Mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);

  // Reactions & Receipts
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [infoMessage, setInfoMessage] = useState<Message | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Public User Profile Modal
  const [viewingProfileUserId, setViewingProfileUserId] = useState<string | null>(null);

  // Voice / Video Calling
  const [isVoiceCallOpen, setIsVoiceCallOpen] = useState(false);
  const [isVoiceCallInitiator, setIsVoiceCallInitiator] = useState(false);
  const [callType, setCallType] = useState<"audio" | "video">("audio");
  const [incomingOffer, setIncomingOffer] = useState<{
    callId: string;
    callerId: string;
    callerName: string;
    conversationId: string;
    type?: "audio" | "video";
  } | null>(null);
  const [activeCallConversationId, setActiveCallConversationId] = useState("");
  const [showCallHistory, setShowCallHistory] = useState(false);
  const isVoiceCallOpenRef = useRef(false);
  isVoiceCallOpenRef.current = isVoiceCallOpen;

  // Search input ref
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Mobile long-press timer
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cache & Rate Limit
  const messagesCacheRef = useRef<Record<string, Message[]>>({});
  const recentSendTimestampsRef = useRef<number[]>([]);

  // Realtime typing
  const [typingUsers, setTypingUsers] = useState<
    Record<string, { username: string; expiresAt: number }>
  >({});
  const lastTypingBroadcastRef = useRef<number>(0);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Auto-scroll anchor
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Fetch accepted friends
  const loadFriends = useCallback(async (uid: string) => {
    try {
      const { data: rows, error: friendsError } = await supabase
        .from("friendships")
        .select("id, requester_id, addressee_id, status")
        .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
        .eq("status", "accepted");

      if (friendsError) throw friendsError;

      const friendIds = [
        ...new Set(
          (rows ?? []).map((r) =>
            r.requester_id === uid ? r.addressee_id : r.requester_id
          )
        ),
      ];

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
      // Non-critical fallback
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

      const requestedId = searchParams.get("conversationId");
      setSelectedId((previous) => {
        if (requestedId && list.some((item) => item.id === requestedId)) {
          return requestedId;
        }
        if (previous && list.some((item) => item.id === previous)) {
          return previous;
        }
        return "";
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
    [searchParams]
  );

  useEffect(() => {
    const requestedId = searchParams.get("conversationId");
    if (requestedId) {
      if (conversations.some((item) => item.id === requestedId)) {
        setSelectedId(requestedId);
      }
    } else {
      // Visiting /dashboard without a conversationId clears selection to show chat home
      setSelectedId("");
    }
  }, [searchParams, conversations]);

  const handleSelectConversation = useCallback(
    (convId: string) => {
      setSelectedId(convId);
      router.push(`/dashboard?conversationId=${convId}`, { scroll: false });
    },
    [router]
  );

  const handleBackToChatList = useCallback(() => {
    setSelectedId("");
    router.push("/dashboard", { scroll: false });
  }, [router]);

  // Listen for incoming voice calls via singleton Socket.IO
  useEffect(() => {
    if (!userId) return;

    let isMounted = true;
    let socket: import("socket.io-client").Socket | null = null;
    let incomingHandler: ((data: {
      callId: string;
      conversationId: string;
      type: string;
      caller: { id: string; name: string; avatarUrl?: string };
    }) => void) | null = null;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token || !isMounted) return;

      socket = getSocket(session.access_token);
      if (!socket) return;

      incomingHandler = (data) => {
        if (isVoiceCallOpenRef.current) return; // already in a call
        const type = (data.type === "video" ? "video" : "audio") as "audio" | "video";
        setIncomingOffer({
          callId: data.callId,
          callerId: data.caller.id,
          callerName: data.caller.name,
          conversationId: data.conversationId,
          type,
        });
        setCallType(type);
        setActiveCallConversationId(data.conversationId);
        setIsVoiceCallInitiator(false);
        setIsVoiceCallOpen(true);
      };

      socket.off("call:incoming", incomingHandler);
      socket.on("call:incoming", incomingHandler);
    });

    return () => {
      isMounted = false;
      if (socket && incomingHandler) {
        socket.off("call:incoming", incomingHandler);
      }
    };
  }, [userId]);

  function handleStartVoiceCall() {
    if (!selected || selected.type !== "direct") return;
    const memberIds = conversationMembers[selected.id] ?? [];
    const otherId = memberIds.find((id) => id !== userId);
    if (!otherId) return;

    setCallType("audio");
    setActiveCallConversationId(selected.id);
    setIsVoiceCallInitiator(true);
    setIncomingOffer(null);
    setIsVoiceCallOpen(true);
  }

  function handleStartVideoCall() {
    if (!selected || selected.type !== "direct") return;
    const memberIds = conversationMembers[selected.id] ?? [];
    const otherId = memberIds.find((id) => id !== userId);
    if (!otherId) return;

    setCallType("video");
    setActiveCallConversationId(selected.id);
    setIsVoiceCallInitiator(true);
    setIncomingOffer(null);
    setIsVoiceCallOpen(true);
  }

  // Load Reactions and Receipts
  const loadReactionsAndReceipts = useCallback(async (msgIds: string[]) => {
    if (msgIds.length === 0) {
      setReactions([]);
      setReceipts([]);
      return;
    }

    try {
      const [reactionsRes, receiptsRes] = await Promise.all([
        supabase
          .from("message_reactions")
          .select("message_id, user_id, emoji")
          .in("message_id", msgIds),
        supabase
          .from("message_receipts")
          .select("message_id, user_id, delivered_at, read_at")
          .in("message_id", msgIds),
      ]);

      if (reactionsRes.data) setReactions(reactionsRes.data as Reaction[]);
      if (receiptsRes.data) setReceipts(receiptsRes.data as Receipt[]);
    } catch {
      // Non-critical fallback
    }
  }, []);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      if (!conversationId) {
        setMessages([]);
        setReactions([]);
        setReceipts([]);
        return;
      }

      if (messagesCacheRef.current[conversationId]) {
        setMessages(messagesCacheRef.current[conversationId]);
      }

      const { data, error: messageError } = await supabase
        .from("messages")
        .select(
          "id,conversation_id,sender_id,message_type,content,reply_to_id,edited_at,created_at,deleted_at"
        )
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(100);

      if (messageError) throw messageError;

      const freshList = (data ?? []) as Message[];
      messagesCacheRef.current[conversationId] = freshList;
      setMessages(freshList);

      const msgIds = freshList.map((m) => m.id);
      void loadReactionsAndReceipts(msgIds);

      void supabase.rpc("mark_messages_read", {
        p_conversation_id: conversationId,
      });

      setTimeout(scrollToBottom, 50);
    },
    [loadReactionsAndReceipts, scrollToBottom]
  );

  // Initialize Auth
  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        let authUser: { id: string } | null = null;

        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session?.user) {
          authUser = sessionData.session.user;
        } else {
          const { data: userData, error: authError } =
            await supabase.auth.getUser();
          if (!authError && userData?.user) {
            authUser = userData.user;
          }
        }

        if (!authUser) {
          router.replace("/auth");
          return;
        }

        if (!active) return;
        setUserId(authUser.id);

        const { data: ownProfile, error: profileError } = await supabase
          .from("profiles")
          .select("id,username,display_name,avatar_url")
          .eq("id", authUser.id)
          .maybeSingle();

        if (profileError) throw profileError;
        if (!active) return;

        setProfile(ownProfile as Profile | null);
        await Promise.all([
          loadConversations(authUser.id),
          loadFriends(authUser.id),
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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (!session && event !== "INITIAL_SESSION")) {
        router.replace("/auth");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadConversations, loadFriends, router]);

  // Selected conversation change
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
          void supabase.rpc("mark_messages_read", {
            p_conversation_id: selectedId,
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
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message_reactions",
        },
        () => {
          const msgIds = (messagesCacheRef.current[selectedId] ?? []).map(
            (m) => m.id
          );
          void loadReactionsAndReceipts(msgIds);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message_receipts",
        },
        () => {
          const msgIds = (messagesCacheRef.current[selectedId] ?? []).map(
            (m) => m.id
          );
          void loadReactionsAndReceipts(msgIds);
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
  }, [selectedId, userId, loadReactionsAndReceipts, scrollToBottom]);

  // Close reaction picker on outside click / escape
  useEffect(() => {
    if (!openReactionPickerMsgId) return;

    function handleClickOutside(e: MouseEvent) {
      if ((e.target as HTMLElement)?.closest("[data-reaction-picker]")) return;
      setOpenReactionPickerMsgId(null);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenReactionPickerMsgId(null);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openReactionPickerMsgId]);

  // Scheduled message dispatcher ticker
  useEffect(() => {
    if (scheduledItems.length === 0) return;

    const timer = setInterval(async () => {
      const now = Date.now();
      const readyToSend = scheduledItems.filter(
        (item) => item.scheduledTime <= now
      );

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
          // fallback
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [scheduledItems, userId, selectedId, loadMessages]);

  // Step 18.3: Keyboard Shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // 1. Escape: Close open menus, clear replying/editing
      if (e.key === "Escape") {
        setOpenActionMenuMsgId(null);
        setShowEmojiPicker(false);
        setSelectionMode(false);
        setSelectedMessageIds([]);
        if (replyingTo) setReplyingTo(null);
        if (editingMessageId) {
          setEditingMessageId(null);
          setDraft("");
        }
      }

      // 2. Ctrl + K: Focus conversation search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }

      // 3. Shift + ArrowUp: Edit last sent message
      if (e.shiftKey && e.key === "ArrowUp" && !editingMessageId) {
        const mySent = [...messages].reverse().find((m) => m.sender_id === userId && !m.deleted_at);
        if (mySent && mySent.content) {
          e.preventDefault();
          setEditingMessageId(mySent.id);
          setDraft(mySent.content);
          composerInputRef.current?.focus();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [replyingTo, editingMessageId, messages, userId]);

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

  // Send or Edit Message
  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = draft.trim();
    if (!content || !selectedId || !userId || sending) return;

    if (!checkRateLimit()) return;

    setSending(true);
    setError("");

    try {
      if (editingMessageId) {
        // Enforce Smart Message Edit via Server-side RPC
        const { error: editError } = await supabase.rpc("edit_message", {
          p_message_id: editingMessageId,
          p_content: content,
        });

        if (editError) {
          // If RPC is missing during initial migration, fall back to update
          if (
            editError.message.includes("function") &&
            editError.message.includes("does not exist")
          ) {
            const { error: fallbackError } = await supabase
              .from("messages")
              .update({
                content,
                edited_at: new Date().toISOString(),
              })
              .eq("id", editingMessageId)
              .eq("sender_id", userId);
            if (fallbackError) throw fallbackError;
          } else {
            throw editError;
          }
        }

        setEditingMessageId(null);
        setDraft("");
        await loadMessages(selectedId);
      } else {
        const payload: {
          conversation_id: string;
          sender_id: string;
          message_type: string;
          content: string;
          reply_to_id?: string;
        } = {
          conversation_id: selectedId,
          sender_id: userId,
          message_type: "text",
          content,
        };

        if (replyingTo) {
          payload.reply_to_id = replyingTo.id;
        }

        const { error: insertError } = await supabase
          .from("messages")
          .insert(payload);

        if (insertError) throw insertError;

        setDraft("");
        setReplyingTo(null);
        await loadMessages(selectedId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  // Delete message (Soft Delete for Everyone)
  async function handleDeleteMessage(messageId: string) {
    setError("");
    setOpenActionMenuMsgId(null);
    try {
      const { error: deleteError } = await supabase.rpc("delete_message", {
        p_message_id: messageId,
      });

      if (deleteError) {
        if (
          deleteError.message.includes("function") &&
          deleteError.message.includes("does not exist")
        ) {
          const { error: fallbackError } = await supabase
            .from("messages")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", messageId);
          if (fallbackError) throw fallbackError;
        } else {
          throw deleteError;
        }
      }

      setMessages((current) =>
        current.map((m) =>
          m.id === messageId
            ? { ...m, deleted_at: new Date().toISOString() }
            : m
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete message.");
    }
  }

  // Delete multiple selected messages
  async function handleDeleteSelected() {
    if (selectedMessageIds.length === 0) return;
    try {
      await Promise.all(selectedMessageIds.map((id) => handleDeleteMessage(id)));
      setSelectedMessageIds([]);
      setSelectionMode(false);
    } catch {
      // fallback
    }
  }

  // Toggle Reaction RPC
  async function handleToggleReaction(messageId: string, emoji: string) {
    setOpenActionMenuMsgId(null);
    try {
      await supabase.rpc("toggle_message_reaction", {
        p_message_id: messageId,
        p_emoji: emoji,
      });
      const msgIds = messages.map((m) => m.id);
      void loadReactionsAndReceipts(msgIds);
    } catch {
      // non-critical
    }
  }

  // Handle Action Menu selection
  function handleMessageAction(action: MessageAction, message: Message) {
    setOpenActionMenuMsgId(null);
    const senderName = members[message.sender_id]?.display_name || "User";

    switch (action) {
      case "reply":
        setReplyingTo({
          id: message.id,
          content: message.content || "",
          senderName,
        });
        composerInputRef.current?.focus();
        break;
      case "copy":
        if (message.content) {
          void navigator.clipboard.writeText(message.content);
        }
        break;
      case "edit":
        if (message.sender_id === userId && !message.deleted_at) {
          setEditingMessageId(message.id);
          setDraft(message.content || "");
          composerInputRef.current?.focus();
        }
        break;
      case "delete":
        void handleDeleteMessage(message.id);
        break;
      case "star":
        setStarredMessageIds((prev) =>
          prev.includes(message.id)
            ? prev.filter((id) => id !== message.id)
            : [...prev, message.id]
        );
        break;
      case "pin":
        setPinnedMessageId((prev) => (prev === message.id ? null : message.id));
        break;
      case "info":
        setInfoMessage(message);
        break;
      case "select":
        setSelectionMode(true);
        setSelectedMessageIds([message.id]);
        break;
      case "forward":
        if (message.content) {
          setDraft(message.content);
        }
        break;
    }
  }

  // Mobile long-press handlers
  function handleTouchStart(msgId: string) {
    longPressTimerRef.current = setTimeout(() => {
      setOpenActionMenuMsgId(msgId);
    }, 500);
  }

  function handleTouchEnd() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
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

  // Group Member Management
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

  // Filter conversations
  const filteredConversations = conversations.filter((c) => {
    const matchesSearch = conversationName(c)
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (chatFilter === "groups") return c.type === "group";
    return true;
  });

  const pinnedMessage = messages.find((m) => m.id === pinnedMessageId);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--muted)]">
        Loading PieChat…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--background)] p-0 text-[var(--foreground)] sm:p-4 md:p-6">
      <div className="mx-auto flex h-[100dvh] max-w-[1600px] overflow-hidden rounded-none border-0 border-[var(--border)] bg-[var(--surface)] sm:h-[calc(100dvh-32px)] sm:rounded-2xl sm:border shadow-sm">
        
        {/* 1. Left Navigation Rail (Desktop vertical rail, mobile bottom bar) */}
        <nav className="hidden w-16 shrink-0 flex-col items-center justify-between border-r border-[var(--border)] bg-[var(--background)] py-5 md:flex">
          <div className="flex flex-col items-center gap-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)] font-bold text-white shadow-sm">
              P
            </div>
            <div className="flex flex-col items-center gap-4">
              <button
                title="Chats"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)] transition"
              >
                <MessageSquare size={20} />
              </button>
              <button
                title="Friends"
                onClick={() => router.push("/friends")}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] transition"
              >
                <Users size={20} />
              </button>
              <button
                title="Starred Messages"
                onClick={() => setChatFilter("all")}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] transition"
              >
                <StarIcon size={20} />
              </button>
              <button
                id="nav-calls-button"
                title="Calls"
                onClick={() => setShowCallHistory(true)}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] transition cursor-pointer"
              >
                <Phone size={19} />
              </button>
            </div>
          </div>

          <div className="flex flex-col items-center gap-4">
            <button
              title="Profile & Settings"
              onClick={() => router.push("/profile")}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary-soft)] text-xs font-bold text-[var(--primary)] ring-2 ring-transparent hover:ring-[var(--primary)] transition overflow-hidden shadow-xs cursor-pointer"
            >
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                (profile?.display_name || profile?.username || "U").slice(0, 1).toUpperCase()
              )}
            </button>
            <button
              title="Log out"
              onClick={async () => {
                await supabase.auth.signOut();
                router.replace("/auth");
                router.refresh();
              }}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--muted)] hover:bg-red-50 hover:text-red-600 transition"
            >
              <LogOut size={18} />
            </button>
          </div>
        </nav>

        {/* 2. Chat List Sidebar */}
        <aside
          className={`${
            selectedId ? "hidden md:flex" : "flex"
          } w-full shrink-0 flex-col border-r border-[var(--border)] md:w-96`}
        >
          {/* Top Header */}
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3.5">
            <h1 className="text-xl font-bold tracking-tight">Chats</h1>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowCreateGroup(true)}
                title="New Group"
                className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--background)] transition text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <Plus size={18} />
              </button>
              <button
                onClick={() => router.push("/friends")}
                title="Find Friends"
                className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--background)] transition text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <Users size={18} />
              </button>
            </div>
          </div>

          {/* Search Bar & Filters */}
          <div className="border-b border-[var(--border)] px-3 py-2.5">
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 focus-within:border-[var(--primary)]">
              <Search size={16} className="text-[var(--muted)]" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search or start new chat (Ctrl+K)"
                className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")}>
                  <X size={14} className="text-[var(--muted)]" />
                </button>
              )}
            </div>

            {/* Filter Chips */}
            <div className="mt-2.5 flex items-center gap-1.5">
              <button
                onClick={() => setChatFilter("all")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  chatFilter === "all"
                    ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                    : "text-[var(--muted)] hover:bg-[var(--background)]"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setChatFilter("groups")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  chatFilter === "groups"
                    ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                    : "text-[var(--muted)] hover:bg-[var(--background)]"
                }`}
              >
                Groups
              </button>
            </div>
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto p-1.5">
            {filteredConversations.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                <p className="font-medium text-[var(--foreground)]">No conversations</p>
                <p className="mt-1 text-xs">Find friends or create a group to begin.</p>
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
              filteredConversations.map((conversation) => {
                const name = conversationName(conversation);
                const isSelected = selectedId === conversation.id;

                return (
                  <button
                    key={conversation.id}
                    onClick={() => handleSelectConversation(conversation.id)}
                    className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${
                      isSelected
                        ? "bg-[var(--primary-soft)]"
                        : "hover:bg-[var(--background)]"
                    }`}
                  >
                    {(() => {
                      const memberIds = conversationMembers[conversation.id] ?? [];
                      const otherId = memberIds.find((id) => id !== userId);
                      const otherMember = otherId ? members[otherId] : undefined;
                      const avatarUrl = conversation.type === "direct" ? otherMember?.avatar_url : null;

                      return (
                        <span
                          onClick={(e) => {
                            if (conversation.type === "direct" && otherId) {
                              e.stopPropagation();
                              setViewingProfileUserId(otherId);
                            }
                          }}
                          title={conversation.type === "direct" ? "View profile" : undefined}
                          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] font-semibold text-[var(--primary)] shadow-inner overflow-hidden ${
                            conversation.type === "direct" && otherId ? "hover:opacity-85 transition cursor-pointer" : ""
                          }`}
                        >
                          {conversation.type === "group" ? (
                            <span>👥</span>
                          ) : avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={avatarUrl}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            name.slice(0, 1).toUpperCase()
                          )}
                        </span>
                      );
                    })()}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="truncate text-sm font-semibold">
                          {name}
                        </span>
                        <span className="text-[11px] text-[var(--muted)]">
                          {new Date(conversation.created_at).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                      <p className="truncate text-xs text-[var(--muted)] mt-0.5">
                        {conversation.type === "group"
                          ? `Group (${
                              conversationMembers[conversation.id]?.length || 0
                            } members)`
                          : "Direct message"}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Mobile Bottom Navigation Rail */}
          <div className="flex items-center justify-around border-t border-[var(--border)] p-2 md:hidden">
            <button
              onClick={() => setChatFilter("all")}
              className="flex flex-col items-center gap-1 text-[var(--primary)] text-[10px]"
            >
              <MessageSquare size={18} />
              <span>Chats</span>
            </button>
            <button
              onClick={() => router.push("/friends")}
              className="flex flex-col items-center gap-1 text-[var(--muted)] text-[10px]"
            >
              <Users size={18} />
              <span>Friends</span>
            </button>
            <button
              onClick={() => setShowCallHistory(true)}
              className="flex flex-col items-center gap-1 text-[var(--muted)] text-[10px]"
            >
              <Phone size={18} />
              <span>Calls</span>
            </button>
            <button
              onClick={() => router.push("/profile")}
              className="flex flex-col items-center gap-1 text-[var(--muted)] text-[10px]"
            >
              <UserIcon size={18} />
              <span>Profile</span>
            </button>
          </div>
        </aside>

        {/* 3. Main Conversation Panel */}
        <section
          className={`${
            selectedId ? "flex" : "hidden md:flex"
          } min-w-0 flex-1 flex-col`}
          onClick={() => setOpenActionMenuMsgId(null)}
        >
          {selected ? (
            <>
              {/* Header */}
              <header className="flex min-h-[64px] items-center justify-between border-b border-[var(--border)] px-4 sm:px-6 bg-[var(--surface)]">
                <div
                  className="flex items-center gap-3 min-w-0 cursor-pointer"
                  onClick={() => {
                    if (selected.type === "group") {
                      setShowGroupInfo(true);
                    } else {
                      const memberIds = conversationMembers[selected.id] ?? [];
                      const otherId = memberIds.find((id) => id !== userId);
                      if (otherId) setViewingProfileUserId(otherId);
                    }
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleBackToChatList();
                    }}
                    className="mr-1 text-[var(--primary)] md:hidden"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  {(() => {
                    const memberIds = conversationMembers[selected.id] ?? [];
                    const otherId = memberIds.find((id) => id !== userId);
                    const otherMember = otherId ? members[otherId] : undefined;
                    const avatarUrl = selected.type === "direct" ? otherMember?.avatar_url : null;

                    return (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] font-semibold text-[var(--primary)] overflow-hidden shadow-xs">
                        {selected.type === "group" ? (
                          <span>👥</span>
                        ) : avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={avatarUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          conversationName(selected).slice(0, 1).toUpperCase()
                        )}
                      </div>
                    );
                  })()}
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-sm hover:underline">
                      {conversationName(selected)}
                    </h2>
                    <p className="text-xs text-[var(--muted)]">
                      {selected.type === "group"
                        ? `${selectedConversationMemberIds.length} members`
                        : "Click to view profile"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selected.type === "direct" && (
                    <>
                      <button
                        id="direct-call-button"
                        onClick={handleStartVoiceCall}
                        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--primary)] hover:text-white transition-colors cursor-pointer"
                        title="Voice Call"
                        aria-label="Start Voice Call"
                      >
                        <Phone size={15} />
                        <span className="hidden sm:inline">Call</span>
                      </button>
                      <button
                        id="direct-video-call-button"
                        onClick={handleStartVideoCall}
                        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--primary)] hover:text-white transition-colors cursor-pointer"
                        title="Video Call"
                        aria-label="Start Video Call"
                      >
                        <Video size={15} />
                        <span className="hidden sm:inline">Video</span>
                      </button>
                    </>
                  )}
                  {selected.type === "group" && (
                    <button
                      onClick={() => setShowGroupInfo(true)}
                      className="button-secondary text-xs px-2.5 py-1.5"
                    >
                      Group Info
                    </button>
                  )}
                  {selectionMode && (
                    <button
                      onClick={() => {
                        setSelectionMode(false);
                        setSelectedMessageIds([]);
                      }}
                      className="button-secondary text-xs px-2.5 py-1.5"
                    >
                      Cancel Selection
                    </button>
                  )}
                </div>
              </header>

              {/* Pinned Message Banner */}
              {pinnedMessage && (
                <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--primary-soft)] px-4 py-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <PinIcon size={14} className="text-[var(--primary)] shrink-0" />
                    <span className="font-semibold text-[var(--primary)]">Pinned:</span>
                    <span className="truncate text-[var(--foreground)]">
                      {pinnedMessage.content}
                    </span>
                  </div>
                  <button
                    onClick={() => setPinnedMessageId(null)}
                    title="Unpin"
                    className="text-[var(--muted)] hover:text-black font-bold"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Multi-selection Bar */}
              {selectionMode && (
                <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs font-semibold shadow-inner">
                  <span>{selectedMessageIds.length} message(s) selected</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleDeleteSelected()}
                      disabled={selectedMessageIds.length === 0}
                      className="flex items-center gap-1 text-red-600 hover:underline disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Message History List */}
              <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-6 bg-[var(--background)]/30">
                {messages.length === 0 ? (
                  <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
                    <p className="font-semibold text-sm">Start the conversation</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
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

                    const quoted = message.reply_to_id
                      ? messages.find((m) => m.id === message.reply_to_id)
                      : null;
                    const quotedSender = quoted
                      ? members[quoted.sender_id]?.display_name || "User"
                      : "";

                    const msgReactions = reactions.filter(
                      (r) => r.message_id === message.id
                    );
                    const reactionCounts: Record<
                      string,
                      { count: number; reactedByMe: boolean }
                    > = {};
                    for (const r of msgReactions) {
                      if (!reactionCounts[r.emoji]) {
                        reactionCounts[r.emoji] = {
                          count: 0,
                          reactedByMe: false,
                        };
                      }
                      reactionCounts[r.emoji].count += 1;
                      if (r.user_id === userId) {
                        reactionCounts[r.emoji].reactedByMe = true;
                      }
                    }

                    const msgReceipts = receipts.filter(
                      (rc) => rc.message_id === message.id
                    );
                    const hasRead = msgReceipts.some((rc) => !!rc.read_at);
                    const hasDelivered = msgReceipts.some(
                      (rc) => !!rc.delivered_at
                    );
                    const isStarred = starredMessageIds.includes(message.id);
                    const isSelected = selectedMessageIds.includes(message.id);

                    // Smart Message Editing Rule
                    const messageReadCount = receipts.filter(
                      (rc) => rc.message_id === message.id && !!rc.read_at && rc.user_id !== userId
                    ).length;

                    const editCheck = checkMessageEditEligibility({
                      isSender: mine,
                      isDeleted: !!message.deleted_at,
                      convType: selected.type,
                      readerCount: messageReadCount,
                    });
                    const canEditMessage = editCheck.allowed;

                    return (
                      <div
                        key={message.id}
                        className={`group relative flex items-start gap-2 ${
                          mine ? "justify-end" : "justify-start"
                        }`}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setOpenActionMenuMsgId(message.id);
                        }}
                        onTouchStart={() => handleTouchStart(message.id)}
                        onTouchEnd={handleTouchEnd}
                      >
                        {/* Selection Checkbox */}
                        {selectionMode && (
                          <button
                            onClick={() => {
                              setSelectedMessageIds((prev) =>
                                prev.includes(message.id)
                                  ? prev.filter((id) => id !== message.id)
                                  : [...prev, message.id]
                              );
                            }}
                            className="mt-2 text-[var(--primary)]"
                          >
                            <CheckSquare
                              size={18}
                              className={isSelected ? "text-[var(--primary)] fill-current" : "text-gray-300"}
                            />
                          </button>
                        )}

                        {/* WhatsApp-style Hover Reaction Trigger Button */}
                        {!message.deleted_at && (
                          <div
                            className={`relative self-center hidden group-hover:flex items-center select-none ${
                              mine ? "order-first" : "order-last"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenReactionPickerMsgId((prev) =>
                                  prev === message.id ? null : message.id
                                );
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--background)] shadow-sm border border-[var(--border)] transition hover:scale-110"
                              title="React"
                              aria-label="React"
                            >
                              <Smile size={15} />
                            </button>

                            {/* Floating WhatsApp Quick Emoji Bar */}
                            {openReactionPickerMsgId === message.id && (
                              <div
                                data-reaction-picker="true"
                                className={`absolute bottom-full mb-1.5 ${
                                  mine ? "right-0" : "left-0"
                                } z-40 flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 shadow-xl animate-fade-in`}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {QUICK_EMOJIS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleToggleReaction(message.id, emoji);
                                      setOpenReactionPickerMsgId(null);
                                    }}
                                    className="flex h-7 w-7 items-center justify-center rounded-full text-base hover:scale-130 transition active:scale-95"
                                    title={`React with ${emoji}`}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Message Bubble Container with pr-8 for top-right chevron */}
                        <div
                          className={`relative max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 sm:max-w-[70%] shadow-sm transition pr-8 ${
                            mine
                              ? "bg-[var(--primary)] text-white rounded-br-xs"
                              : "bg-[var(--surface)] text-[var(--foreground)] border border-[var(--border)] rounded-bl-xs"
                          }`}
                        >
                          {/* Sender name in group chats */}
                          {!mine && selected.type === "group" && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setViewingProfileUserId(message.sender_id);
                              }}
                              className="mb-1 block text-xs font-semibold text-[var(--primary)] hover:underline text-left cursor-pointer"
                            >
                              {senderName}
                            </button>
                          )}

                          {/* Quoted Reply Block */}
                          {quoted && (
                            <div
                              className={`mb-2 rounded-lg border-l-3 p-2 text-xs ${
                                mine
                                  ? "border-white bg-black/15 text-white/90"
                                  : "border-[var(--primary)] bg-black/5 text-[var(--muted)]"
                              }`}
                            >
                              <span className="block font-semibold">
                                {quotedSender}
                              </span>
                              <span className="block truncate">
                                {quoted.content || "Message"}
                              </span>
                            </div>
                          )}

                          {/* Message Content */}
                          {message.deleted_at ? (
                            <span className="italic text-xs opacity-75">
                              This message was deleted
                            </span>
                          ) : (
                            <span className="text-sm leading-relaxed">
                              {message.content || `[${message.message_type}]`}
                            </span>
                          )}

                          {/* Message Footer: Star, Edited, Time, Read Status */}
                          <div className="mt-1 flex items-center justify-end gap-1.5 select-none">
                            {isStarred && (
                              <span className="text-[10px] text-amber-300">⭐</span>
                            )}
                            {message.edited_at && (
                              <span
                                className={`text-[9px] ${
                                  mine ? "text-white/60" : "text-[var(--muted)]"
                                }`}
                              >
                                (edited)
                              </span>
                            )}
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

                            {mine && (
                              <span
                                title={
                                  hasRead
                                    ? "Read"
                                    : hasDelivered
                                    ? "Delivered"
                                    : "Sent"
                                }
                                className="inline-flex items-center"
                              >
                                {hasRead ? (
                                  <CheckCheck size={14} className="text-sky-300 font-bold" />
                                ) : hasDelivered ? (
                                  <CheckCheck size={14} className="text-white/70" />
                                ) : (
                                  <Check size={14} className="text-white/70" />
                                )}
                              </span>
                            )}
                          </div>

                          {/* Reactions Badges */}
                          {Object.keys(reactionCounts).length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {Object.entries(reactionCounts).map(
                                ([emoji, { count, reactedByMe }]) => (
                                  <button
                                    key={emoji}
                                    onClick={() =>
                                      void handleToggleReaction(
                                        message.id,
                                        emoji
                                      )
                                    }
                                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition border ${
                                      reactedByMe
                                        ? "border-white bg-white/20 text-white font-bold"
                                        : "border-black/10 bg-black/5"
                                    }`}
                                  >
                                    <span>{emoji}</span>
                                    <span className="text-[10px]">{count}</span>
                                  </button>
                                )
                              )}
                            </div>
                          )}

                          {/* WhatsApp-style Inside Top-Right Dropdown Trigger */}
                          <div
                            className={`absolute top-1.5 right-1.5 z-30 transition-opacity ${
                              openActionMenuMsgId === message.id
                                ? "flex opacity-100"
                                : "hidden group-hover:flex opacity-90 hover:opacity-100"
                            }`}
                          >
                            <MessageActionMenu
                              isOpen={openActionMenuMsgId === message.id}
                              onToggle={() =>
                                setOpenActionMenuMsgId((prev) =>
                                  prev === message.id ? null : message.id
                                )
                              }
                              onClose={() => setOpenActionMenuMsgId(null)}
                              onAction={(action) =>
                                handleMessageAction(action, message)
                              }
                              onReaction={(emoji) =>
                                void handleToggleReaction(message.id, emoji)
                              }
                              canEdit={canEditMessage}
                              canDelete={mine || isUserAdmin}
                              isStarred={isStarred}
                              isPinned={pinnedMessageId === message.id}
                              align={mine ? "right" : "left"}
                              isOwnMessage={mine}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Scheduled Messages Banner */}
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

              {/* Typing Indicator */}
              {activeTypingList.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-1 text-xs text-[var(--muted)]">
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

              {/* Replying Banner */}
              {replyingTo && (
                <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--primary-soft)] px-4 py-2 text-xs">
                  <div className="min-w-0">
                    <span className="font-semibold text-[var(--primary)]">
                      Replying to {replyingTo.senderName}:
                    </span>{" "}
                    <span className="truncate italic text-[var(--foreground)]">
                      &quot;{replyingTo.content}&quot;
                    </span>
                  </div>
                  <button
                    onClick={() => setReplyingTo(null)}
                    className="font-bold text-[var(--muted)] hover:text-black"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Editing Banner */}
              {editingMessageId && (
                <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--primary-soft)] px-4 py-2 text-xs">
                  <span className="font-semibold text-[var(--primary)]">
                    ✏️ Editing Message
                  </span>
                  <button
                    onClick={() => {
                      setEditingMessageId(null);
                      setDraft("");
                    }}
                    className="font-semibold text-[var(--muted)] hover:text-black"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {error && (
                <p role="alert" className="px-4 py-1 text-xs text-red-600">
                  {error}
                </p>
              )}

              {/* Emoji Picker Popover */}
              {showEmojiPicker && (
                <div className="border-t border-[var(--border)] bg-[var(--surface)] p-2">
                  <div className="flex items-center justify-between px-2 pb-1">
                    <span className="text-xs font-semibold text-[var(--muted)]">
                      Emoji Palette
                    </span>
                    <button
                      onClick={() => setShowEmojiPicker(false)}
                      className="text-xs text-[var(--muted)] hover:text-black"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="grid grid-cols-10 gap-1 p-1 max-h-32 overflow-y-auto">
                    {EMOJI_PICKER_LIST.map((em) => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => {
                          setDraft((prev) => prev + em);
                        }}
                        className="text-lg hover:scale-125 transition p-1"
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Composer */}
              <form
                onSubmit={sendMessage}
                className="flex items-end gap-2 border-t border-[var(--border)] p-3 sm:p-4 bg-[var(--surface)]"
              >
                <button
                  type="button"
                  title="Emoji"
                  onClick={() => setShowEmojiPicker((prev) => !prev)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)] transition"
                >
                  <Smile size={20} />
                </button>

                <textarea
                  ref={composerInputRef}
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
                  placeholder={
                    editingMessageId
                      ? "Edit your message…"
                      : replyingTo
                      ? "Write a reply…"
                      : "Type a message…"
                  }
                  aria-label="Message"
                  className="max-h-32 min-h-11 flex-1 resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm outline-none focus:border-[var(--primary)] transition"
                />

                {!editingMessageId && (
                  <button
                    type="button"
                    title="Schedule message"
                    disabled={!draft.trim()}
                    onClick={() => setShowScheduleModal(true)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-40 transition"
                  >
                    <Clock size={19} />
                  </button>
                )}

                <button
                  disabled={sending || !draft.trim()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-40 transition shadow-sm"
                >
                  <Send size={18} />
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-2xl font-bold text-[var(--primary)] shadow-sm">
                P
              </div>
              <h2 className="mt-5 text-2xl font-bold tracking-tight">
                PieChat Web
              </h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
                Send and receive messages without keeping your phone online.
                Select a chat or find friends to start.
              </p>
              <div className="mt-6 flex gap-3">
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
                  + New Group
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* 1. Modal: Create New Group */}
      {showCreateGroup && (
        <CreateGroupDialog
          onClose={() => setShowCreateGroup(false)}
          onCreated={(conversationId) => {
            setShowCreateGroup(false);
            router.push(`/dashboard?conversationId=${conversationId}`);
            router.refresh();
          }}
        />
      )}

      {/* 2. Modal: Group Info & Management */}
      {showGroupInfo && selected && selected.type === "group" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3.5">
              <div>
                <h3 className="text-xl font-bold tracking-tight">
                  {conversationName(selected)}
                </h3>
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

              {showAddMembers && (
                <div className="mt-2 rounded-xl border border-[var(--border)] p-2">
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
                          className="flex items-center justify-between p-1.5 text-xs"
                        >
                          <span>{friend.display_name || friend.username}</span>
                          <button
                            onClick={() => void handleAddMembers([friend.id])}
                            disabled={groupActionLoading}
                            className="button-primary text-[11px] px-2.5 py-1"
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
                      className="flex items-center justify-between rounded-lg p-2 text-sm hover:bg-[var(--background)] transition"
                    >
                      <div
                        className="flex items-center gap-2.5 cursor-pointer"
                        onClick={() => setViewingProfileUserId(mId)}
                        title="View profile"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-xs font-bold text-[var(--primary)] overflow-hidden">
                          {mProfile?.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={mProfile.avatar_url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            (mProfile?.display_name || mProfile?.username || "U")
                              .slice(0, 1)
                              .toUpperCase()
                          )}
                        </span>
                        <div>
                          <p className="font-semibold text-xs leading-4 hover:underline">
                            {mProfile?.display_name || mProfile?.username || "Member"}{" "}
                            {isSelf && "(You)"}
                          </p>
                          <p className="text-[10px] text-[var(--muted)]">
                            {role === "admin" ? "Admin" : "Member"}
                          </p>
                        </div>
                      </div>

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
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
            <h3 className="text-lg font-bold tracking-tight">Schedule Message</h3>
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
                  className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div className="rounded-xl bg-[var(--background)] p-3 text-xs text-[var(--muted)]">
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

      {/* 4. Modal: Message Info */}
      {infoMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
            <h3 className="text-lg font-bold tracking-tight">Message Info</h3>
            <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3.5 text-xs">
              <p className="font-semibold text-sm">{infoMessage.content}</p>
              <p className="mt-1.5 text-[10px] text-[var(--muted)]">
                Sent: {new Date(infoMessage.created_at).toLocaleString()}
              </p>
            </div>

            <div className="mt-4 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Read Receipts
              </h4>
              {receipts.filter((rc) => rc.message_id === infoMessage.id).length === 0 ? (
                <p className="text-xs text-[var(--muted)]">
                  No read receipts recorded yet.
                </p>
              ) : (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {receipts
                    .filter((rc) => rc.message_id === infoMessage.id)
                    .map((rc) => {
                      const rcProfile = members[rc.user_id];
                      return (
                        <div
                          key={rc.user_id}
                          className="flex items-center justify-between text-xs"
                        >
                          <span className="font-medium">
                            {rcProfile?.display_name || rcProfile?.username || "Recipient"}
                          </span>
                          <span className="text-[10px] text-sky-600 font-semibold">
                            {rc.read_at
                              ? `Read ${new Date(rc.read_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                              : rc.delivered_at
                              ? "Delivered"
                              : "Sent"}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setInfoMessage(null)}
                className="button-secondary text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Call History Modal */}
      {showCallHistory && (
        <CallHistoryModal
          currentUserId={userId}
          onClose={() => setShowCallHistory(false)}
          onInitiateCall={(convId, contactId, type = "audio") => {
            setShowCallHistory(false);
            setActiveCallConversationId(convId);
            setCallType(type);
            setIsVoiceCallInitiator(true);
            setIncomingOffer(null);
            setIsVoiceCallOpen(true);
          }}
        />
      )}

      {/* Voice & Video Call Modal */}
      {isVoiceCallOpen && activeCallConversationId && (
        <VoiceCallModal
          currentUserId={userId}
          currentUserProfile={profile}
          conversationId={activeCallConversationId}
          recipient={
            (() => {
              const memberIds =
                conversationMembers[activeCallConversationId] ?? [];
              const otherId =
                memberIds.find((id) => id !== userId) ||
                incomingOffer?.callerId;
              return otherId
                ? members[otherId] || {
                    id: otherId,
                    username: incomingOffer?.callerName || "Caller",
                    display_name: incomingOffer?.callerName || "Caller",
                    avatar_url: null,
                  }
                : null;
            })()
          }
          isInitiator={isVoiceCallInitiator}
          callType={callType}
          incomingCallData={incomingOffer}
          onClose={() => {
            setIsVoiceCallOpen(false);
            setIncomingOffer(null);
            setActiveCallConversationId("");
          }}
        />
      )}

      {/* 5. Modal: Public User Profile */}
      {viewingProfileUserId && (
        <PublicProfileModal
          targetUserId={viewingProfileUserId}
          currentUserId={userId}
          onClose={() => setViewingProfileUserId(null)}
          onOpenDirectChat={(friendId) => {
            setViewingProfileUserId(null);
            void (async () => {
              try {
                const { data: convId } = await supabase.rpc(
                  "get_or_create_direct_conversation",
                  { p_friend_id: friendId }
                );
                if (convId) {
                  handleSelectConversation(convId);
                }
              } catch {
                // handled
              }
            })();
          }}
        />
      )}
    </main>
  );
}
