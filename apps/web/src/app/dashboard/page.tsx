"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function DashboardPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;

    async function checkSession() {
      const { data, error } = await supabase.auth.getUser();

      if (!active) return;

      if (error || !data.user) {
        router.replace("/auth");
      } else {
        setEmail(data.user.email ?? null);
      }

      setChecking(false);
    }

    void checkSession();

    return () => {
      active = false;
    };
  }, [router]);

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      alert(error.message);
      return;
    }

    router.replace("/auth");
    router.refresh();
  }

  if (checking) {
    return <main className="p-8">Checking session...</main>;
  }

  if (!email) return null;

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold">Welcome to PieChat</h1>
      <p className="mt-3 text-gray-600">
        Signed in as: {email}
      </p>

      <p className="mt-4">
        Your account is connected. Chat features will come next.
      </p>

      <button
        onClick={() => router.push("/profile")}
        className="mt-6 mr-3 rounded-lg border px-5 py-3 font-medium hover:bg-gray-50"
      >
        Edit profile
      </button>

      <button
        onClick={handleLogout}
        className="mt-6 rounded-lg bg-black px-5 py-3 text-white"
      >
        Log out
      </button>
    </main>
  );
}
