import { Suspense } from "react";
import ChatWorkspace from "@/components/chat-workspace";

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--muted)]">
          Loading PieChat…
        </main>
      }
    >
      <ChatWorkspace />
    </Suspense>
  );
}
