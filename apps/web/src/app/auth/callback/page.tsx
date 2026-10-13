"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function handleAuthCallback() {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");

        if (code) {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else {
          // Check if session is already active (implicit flow / tokens in hash)
          const { data, error: sessionError } =
            await supabase.auth.getSession();
          if (sessionError) throw sessionError;

          if (!data.session) {
            // Listen once for auth state change
            const { data: authListener } = supabase.auth.onAuthStateChange(
              (event, session) => {
                if (session && active) {
                  router.replace("/dashboard");
                  router.refresh();
                }
              }
            );
            return () => {
              authListener.subscription.unsubscribe();
            };
          }
        }

        if (active) {
          router.replace("/dashboard");
          router.refresh();
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Authentication callback failed. Please try again."
          );
        }
      }
    }

    void handleAuthCallback();

    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 text-center shadow-sm sm:p-8">
        {error ? (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900">
              Authentication Error
            </h1>
            <p className="mt-2 text-sm text-gray-600">{error}</p>
            <button
              onClick={() => router.replace("/auth")}
              className="mt-6 w-full rounded-lg bg-black py-2.5 text-sm font-medium text-white hover:bg-gray-800"
            >
              Back to Sign in
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-black border-t-transparent" />
            <h1 className="text-xl font-semibold text-gray-900">
              Completing sign in...
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              Please wait while your session is being secured.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
