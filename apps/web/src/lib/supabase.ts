import { createClient, Session } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://pwpgfyfungyviyqvxrgm.supabase.co";

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3cGdmeWZ1bmd5dml5cXZ4cmdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MjUyMTksImV4cCI6MjEwNzQwMTIxOX0.tuqo7uWSok0JPmvbBWEyRJv_3t-ljlic7mGi6aW8sFU";

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Safely resolves the active authenticated session.
 * - Returns immediately if the cached session has a fresh access token.
 * - Automatically performs token refresh using the stored refresh_token if the access token
 *   has expired (e.g. returning the next day or after 1 hour).
 * - Avoids premature redirects while session restoration/refresh is in flight.
 * - Returns null only if no session exists or if the refresh token is genuinely revoked/expired.
 */
export async function getValidSession(): Promise<Session | null> {
  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      console.warn("[auth] getSession notice:", error.message);
    }

    if (session) {
      const now = Math.floor(Date.now() / 1000);
      // If access token is still fresh for at least 60 seconds, use it
      if (session.expires_at && session.expires_at > now + 60) {
        return session;
      }

      // If access token is expired or expiring soon, securely refresh it using refresh_token
      const { data: refreshed, error: refreshError } =
        await supabase.auth.refreshSession();
      if (!refreshError && refreshed.session) {
        return refreshed.session;
      }

      // Network temporary glitch fallback: if existing token hasn't fully expired yet
      if (session.expires_at && session.expires_at > now) {
        return session;
      }

      return null;
    }

    // If getSession returned null, give refreshSession one try in case storage has a refresh token
    const { data: refreshed, error: refreshError } =
      await supabase.auth.refreshSession();
    if (!refreshError && refreshed?.session) {
      return refreshed.session;
    }

    return null;
  } catch (err) {
    console.warn("[auth] getValidSession error:", err);
    return null;
  }
}
