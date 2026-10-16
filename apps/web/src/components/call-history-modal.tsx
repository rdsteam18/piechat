"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Video,
  X,
  Clock,
  RefreshCw,
} from "lucide-react";

export type CallHistoryItem = {
  id: string;
  conversation_id: string;
  caller_id: string;
  recipient_id: string;
  type?: "audio" | "video";
  status: string;
  started_at: string | null;
  ended_at: string | null;
  duration: number;
  created_at: string;
  contactName?: string;
  contactAvatar?: string | null;
};

interface CallHistoryModalProps {
  currentUserId: string;
  onClose: () => void;
  onInitiateCall: (conversationId: string, recipientId: string, type?: "audio" | "video") => void;
}

export default function CallHistoryModal({
  currentUserId,
  onClose,
  onInitiateCall,
}: CallHistoryModalProps) {
  const [calls, setCalls] = useState<CallHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadCallHistory() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("calls")
        .select("*")
        .or(`caller_id.eq.${currentUserId},recipient_id.eq.${currentUserId}`)
        .order("created_at", { ascending: false })
        .limit(40);

      if (error) {
        console.warn("Could not load calls:", error.message);
        setCalls([]);
        setLoading(false);
        return;
      }

      if (!data || data.length === 0) {
        setCalls([]);
        setLoading(false);
        return;
      }

      // Collect all contact IDs
      const contactIds = [
        ...new Set(
          data.map((c) =>
            c.caller_id === currentUserId ? c.recipient_id : c.caller_id
          )
        ),
      ];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .in("id", contactIds);

      const profileMap = new Map(
        (profiles ?? []).map((p) => [
          p.id,
          p.display_name || p.username || "PieChat User",
        ])
      );

      const enrichedCalls: CallHistoryItem[] = data.map((c) => {
        const contactId =
          c.caller_id === currentUserId ? c.recipient_id : c.caller_id;
        return {
          ...c,
          contactName: profileMap.get(contactId) || "PieChat Contact",
        };
      });

      setCalls(enrichedCalls);
    } catch (err) {
      console.error("Error loading call history:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCallHistory();
  }, [currentUserId]);

  const formatDuration = (sec: number) => {
    if (!sec || sec <= 0) return "0s";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const timeStr = d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    if (isToday) return `Today at ${timeStr}`;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} at ${timeStr}`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Call History"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
              <Phone size={18} />
            </div>
            <div>
              <h2 className="font-semibold text-base text-[var(--foreground)]">
                Call History
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Your recent one-to-one voice & video calls
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadCallHistory()}
              title="Refresh"
              className="text-[var(--muted)] hover:text-[var(--foreground)] p-1.5 rounded-lg transition-colors"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={onClose}
              title="Close"
              className="text-[var(--muted)] hover:text-[var(--foreground)] p-1.5 rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="py-12 text-center text-sm text-[var(--muted)]">
              Loading calls…
            </div>
          ) : calls.length === 0 ? (
            <div className="py-16 text-center text-[var(--muted)]">
              <Phone size={36} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium text-sm">No call history yet</p>
              <p className="text-xs mt-1">
                Voice calls you make or receive will appear here.
              </p>
            </div>
          ) : (
            calls.map((call) => {
              const isOutgoing = call.caller_id === currentUserId;
              const isMissed =
                call.status === "missed" ||
                call.status === "declined" ||
                call.status === "cancelled";
              const isConnected =
                call.status === "connected" ||
                call.status === "ended" ||
                call.status === "accepted";

              return (
                <div
                  key={call.id}
                  className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 hover:bg-[var(--surface-hover)] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold text-sm ${
                        isConnected
                          ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400"
                          : "bg-rose-500/10 text-rose-500 dark:text-rose-400"
                      }`}
                    >
                      {call.contactName?.slice(0, 1).toUpperCase()}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm truncate text-[var(--foreground)]">
                          {call.contactName}
                        </span>
                        {call.type === "video" ? (
                          <span className="inline-flex items-center gap-1 rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-400">
                            <Video size={10} /> Video
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                            <Phone size={10} /> Voice
                          </span>
                        )}
                        {isOutgoing ? (
                          <PhoneOutgoing
                            size={13}
                            className={
                              isConnected
                                ? "text-emerald-500 shrink-0"
                                : "text-[var(--muted)] shrink-0"
                            }
                          />
                        ) : isMissed ? (
                          <PhoneMissed size={13} className="text-rose-500 shrink-0" />
                        ) : (
                          <PhoneIncoming
                            size={13}
                            className="text-emerald-500 shrink-0"
                          />
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-[var(--muted)] mt-0.5">
                        <span>{formatDate(call.created_at)}</span>
                        {isConnected && call.duration > 0 && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Clock size={11} />
                              {formatDuration(call.duration)}
                            </span>
                          </>
                        )}
                        {!isConnected && (
                          <>
                            <span>•</span>
                            <span className="capitalize text-rose-500/80 font-medium text-[11px]">
                              {call.status}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button
                      onClick={() => {
                        const contactId =
                          call.caller_id === currentUserId
                            ? call.recipient_id
                            : call.caller_id;
                        onClose();
                        onInitiateCall(call.conversation_id, contactId, "audio");
                      }}
                      title="Voice Call Back"
                      aria-label="Voice Call Back"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--primary)] hover:text-white transition-colors cursor-pointer"
                    >
                      <Phone size={14} />
                    </button>
                    <button
                      onClick={() => {
                        const contactId =
                          call.caller_id === currentUserId
                            ? call.recipient_id
                            : call.caller_id;
                        onClose();
                        onInitiateCall(call.conversation_id, contactId, "video");
                      }}
                      title="Video Call Back"
                      aria-label="Video Call Back"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--primary)] hover:text-white transition-colors cursor-pointer"
                    >
                      <Video size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
