"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type OAuthProvider = "google" | "github" | "linkedin_oidc" | "facebook";

export default function AuthPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);

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
            emailRedirectTo: `${window.location.origin}/auth/callback`,
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

  async function signInWithProvider(provider: OAuthProvider) {
    setOauthLoading(provider);
    setStatus("");

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setStatus(`OAuth sign-in failed: ${error.message}`);
        setOauthLoading(null);
      }
    } catch (err) {
      setStatus(
        err instanceof Error ? err.message : "OAuth connection failed"
      );
      setOauthLoading(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-3xl font-bold tracking-tight">PieChat</h1>
        <p className="mt-2 text-sm text-gray-600">
          Chat with your people.
        </p>

        {/* Tab Switcher */}
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

        {/* Social Logins */}
        <div className="mt-6 space-y-2.5">
          {/* Google */}
          <button
            type="button"
            onClick={() => signInWithProvider("google")}
            disabled={loading || oauthLoading !== null}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            {oauthLoading === "google"
              ? "Connecting Google..."
              : `Continue with Google`}
          </button>

          {/* GitHub */}
          <button
            type="button"
            onClick={() => signInWithProvider("github")}
            disabled={loading || oauthLoading !== null}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            <svg className="h-5 w-5 fill-gray-900" viewBox="0 0 24 24">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              />
            </svg>
            {oauthLoading === "github"
              ? "Connecting GitHub..."
              : `Continue with GitHub`}
          </button>

          {/* LinkedIn & Facebook in 2 columns */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* LinkedIn */}
            <button
              type="button"
              onClick={() => signInWithProvider("linkedin_oidc")}
              disabled={loading || oauthLoading !== null}
              className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white py-2.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
            >
              <svg className="h-4 w-4 fill-[#0A66C2]" viewBox="0 0 24 24">
                <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 8.76a1.64 1.64 0 1 0 0-3.28 1.64 1.64 0 0 0 0 3.28m1.39 9.74v-8.37H5.07v8.37h2.78z" />
              </svg>
              {oauthLoading === "linkedin_oidc" ? "..." : "LinkedIn"}
            </button>

            {/* Facebook */}
            <button
              type="button"
              onClick={() => signInWithProvider("facebook")}
              disabled={loading || oauthLoading !== null}
              className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white py-2.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
            >
              <svg className="h-4 w-4 fill-[#1877F2]" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
              {oauthLoading === "facebook" ? "..." : "Facebook"}
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-3 text-gray-400">
              Or continue with email
            </span>
          </div>
        </div>

        {/* Email / Password Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label htmlFor="displayName" className="mb-1 block text-sm font-medium">
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
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
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
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
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
            disabled={loading || oauthLoading !== null}
            className="w-full rounded-lg bg-black py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
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
            className="mt-4 break-words rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700"
          >
            {status}
          </p>
        )}
      </section>
    </main>
  );
}
