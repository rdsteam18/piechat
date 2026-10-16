import { Suspense } from "react";
import ChatWorkspace from "@/components/chat-workspace";

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--muted)]">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
            <p className="text-sm font-medium">Loading PieChat…</p>
          </div>
        </main>
      }
    >
      <ChatWorkspace />
    </Suspense>
  );
}
