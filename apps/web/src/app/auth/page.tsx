"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus("");

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              display_name: displayName.trim(),
            },
            emailRedirectTo: `${window.location.origin}/auth`,
          },
        });

        if (error) throw error;

        if (data.session) {
          setStatus("Account created. You are signed in.");
          router.push("/dashboard");
          router.refresh();
        } else {
          setStatus(
            "Signup submitted. Check your email to verify your account before logging in."
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) throw error;

        router.push("/dashboard");
        router.refresh();
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-3xl font-bold tracking-tight">PieChat</h1>
        <p className="mt-2 text-sm text-gray-600">
          Chat with your people.
        </p>

        <div className="mt-6 grid grid-cols-2 rounded-lg bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setStatus("");
            }}
            className={`rounded-md py-2 text-sm font-medium ${
              mode === "signup" ? "bg-white shadow-sm" : ""
            }`}
          >
            Sign up
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("login");
              setStatus("");
            }}
            className={`rounded-md py-2 text-sm font-medium ${
              mode === "login" ? "bg-white shadow-sm" : ""
            }`}
          >
            Log in
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {mode === "signup" && (
            <div>
              <label htmlFor="displayName" className="mb-1 block text-sm">
                Display name
              </label>
              <input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength={60}
                autoComplete="name"
                className="w-full rounded-lg border px-3 py-3 outline-none focus:ring-2 focus:ring-black"
                placeholder="Your name"
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1 block text-sm">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-lg border px-3 py-3 outline-none focus:ring-2 focus:ring-black"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              className="w-full rounded-lg border px-3 py-3 outline-none focus:ring-2 focus:ring-black"
              placeholder="At least 8 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-black py-3 font-medium text-white disabled:opacity-50"
          >
            {loading
              ? "Please wait..."
              : mode === "signup"
                ? "Create account"
                : "Log in"}
          </button>
        </form>

        {status && (
          <p
            role="status"
            aria-live="polite"
            className="mt-4 break-words rounded-lg border p-3 text-sm"
          >
            {status}
          </p>
        )}
      </section>
    </main>
  );
}
