"use client";

import { useEffect, useRef, useState } from "react";
import {
  Reply,
  Forward,
  Copy,
  Star,
  Info,
  CheckSquare,
  Pin,
  Pencil,
  Trash2,
  ChevronDown,
  X,
} from "lucide-react";

export type MessageAction =
  | "reply"
  | "forward"
  | "copy"
  | "star"
  | "info"
  | "select"
  | "pin"
  | "edit"
  | "delete";

type Props = {
  onAction: (action: MessageAction) => void;
  onReaction?: (emoji: string) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  isStarred?: boolean;
  isPinned?: boolean;
  triggerLabel?: string;
  isOpen?: boolean;
  onToggle?: () => void;
  onClose?: () => void;
  align?: "left" | "right";
  isOwnMessage?: boolean;
};

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const actions: {
  id: MessageAction;
  label: string;
  Icon: typeof Reply;
}[] = [
  { id: "reply", label: "Reply", Icon: Reply },
  { id: "forward", label: "Forward", Icon: Forward },
  { id: "copy", label: "Copy", Icon: Copy },
  { id: "star", label: "Star", Icon: Star },
  { id: "info", label: "Info", Icon: Info },
  { id: "select", label: "Select", Icon: CheckSquare },
  { id: "pin", label: "Pin", Icon: Pin },
  { id: "edit", label: "Edit", Icon: Pencil },
  { id: "delete", label: "Delete", Icon: Trash2 },
];

export default function MessageActionMenu({
  onAction,
  onReaction,
  canEdit = false,
  canDelete = false,
  isStarred = false,
  isPinned = false,
  triggerLabel = "Message actions",
  isOpen,
  onToggle,
  onClose,
  align = "right",
  isOwnMessage = false,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const rootRef = useRef<HTMLDivElement>(null);

  const handleClose = () => {
    if (onClose) {
      onClose();
    }
    setInternalOpen(false);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onToggle) {
      onToggle();
    } else {
      setInternalOpen((prev) => !prev);
    }
  };

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent | PointerEvent) {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        handleClose();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") handleClose();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function runAction(action: MessageAction) {
    handleClose();
    onAction(action);
  }

  return (
    <div ref={rootRef} className="relative inline-flex items-center">
      {/* WhatsApp Inside-Bubble Dropdown Trigger Button */}
      <button
        type="button"
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={handleToggle}
        className={`flex h-5 w-5 items-center justify-center rounded-full transition-all focus-visible:outline-2 ${
          isOwnMessage
            ? open
              ? "bg-black/35 text-white"
              : "bg-black/20 text-white/90 hover:bg-black/30 hover:text-white"
            : open
            ? "bg-black/20 text-[var(--foreground)]"
            : "bg-black/5 text-[var(--foreground)]/70 hover:bg-black/15 hover:text-[var(--foreground)]"
        }`}
      >
        {open ? <X size={12} strokeWidth={2.5} /> : <ChevronDown size={13} strokeWidth={2.5} />}
      </button>

      {/* Action Menu Popup */}
      {open && (
        <div
          role="dialog"
          aria-label="Message actions"
          className={`absolute ${
            align === "right" ? "right-0" : "left-0"
          } top-6 z-50 w-[min(280px,calc(100vw-32px))]
            rounded-2xl border border-[var(--border)]
            bg-[var(--surface)] p-2.5 shadow-2xl animate-fade-in`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Quick Emoji Reactions Row */}
          {onReaction && (
            <div className="flex items-center justify-between gap-1 border-b border-[var(--border)] pb-2 mb-2 px-1">
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    handleClose();
                    onReaction(emoji);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-base hover:scale-130 hover:bg-[var(--background)] transition-transform active:scale-95"
                  title={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-1.5">
            {actions.map(({ id, label, Icon }) => {
              if (id === "edit" && !canEdit) return null;
              if (id === "delete" && !canDelete) return null;

              const displayLabel =
                id === "star" && isStarred
                  ? "Unstar"
                  : id === "pin" && isPinned
                  ? "Unpin"
                  : label;

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => runAction(id)}
                  className={`flex min-h-[64px] flex-col items-center
                    justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-medium
                    hover:bg-[var(--background)] transition
                    focus-visible:outline-2
                    ${id === "delete" ? "text-red-600 hover:bg-red-50" : "text-[var(--foreground)]"}`}
                >
                  <Icon size={18} strokeWidth={1.8} />
                  <span className="truncate max-w-full">{displayLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
