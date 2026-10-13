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
  MoreHorizontal,
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
  canEdit?: boolean;
  canDelete?: boolean;
  isStarred?: boolean;
  isPinned?: boolean;
  triggerLabel?: string;
  isOpen?: boolean;
  onClose?: () => void;
  position?: "top" | "bottom";
};

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
  canEdit = false,
  canDelete = false,
  isStarred = false,
  isPinned = false,
  triggerLabel = "Message actions",
  isOpen,
  onClose,
  position = "bottom",
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const rootRef = useRef<HTMLDivElement>(null);

  const setOpen = (val: boolean) => {
    if (isOpen !== undefined && onClose && !val) {
      onClose();
    } else {
      setInternalOpen(val);
    }
  };

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function runAction(action: MessageAction) {
    setOpen(false);
    onAction(action);
  }

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="flex h-6 w-6 items-center justify-center rounded-full
          bg-[var(--surface)] text-[var(--foreground)]
          shadow-sm ring-1 ring-[var(--border)]
          hover:bg-[var(--background)]
          focus-visible:outline-2 focus-visible:outline-offset-2 transition"
      >
        {open ? <X size={14} /> : <MoreHorizontal size={14} />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Message actions"
          className={`absolute right-0 ${
            position === "top" ? "bottom-8" : "top-8"
          } z-50 w-[min(280px,calc(100vw-32px))]
            rounded-xl border border-[var(--border)]
            bg-[var(--surface)] p-2 shadow-2xl animate-fade-in`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-3 gap-1">
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
                    justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium
                    hover:bg-[var(--background)] transition
                    focus-visible:outline-2
                    ${id === "delete" ? "text-red-600 hover:bg-red-50" : ""}`}
                >
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{displayLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
