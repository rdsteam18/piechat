import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_URL;
const SUPABASE_URL = process.env.SUPABASE_URL || "https://pwpgfyfungyviyqvxrgm.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3cGdmeWZ1bmd5dml5cXZ4cmdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MjUyMTksImV4cCI6MjEwNzQwMTIxOX0.tuqo7uWSok0JPmvbBWEyRJv_3t-ljlic7mGi6aW8sFU";

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
});

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

export async function verifyUserToken(token: string): Promise<{ id: string; email?: string } | null> {
  if (!token) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return null;
    }
    return { id: data.user.id, email: data.user.email };
  } catch {
    return null;
  }
}

export async function verifyDirectConversationMembership(
  conversationId: string,
  callerId: string,
  recipientId: string
): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      // 1. Verify conversation is direct
      const convRes = await client.query(
        "select type from public.conversations where id = $1",
        [conversationId]
      );
      if (convRes.rows.length === 0 || convRes.rows[0].type !== "direct") {
        return false;
      }

      // 2. Verify both users are members of this conversation
      const membersRes = await client.query(
        "select user_id from public.conversation_members where conversation_id = $1 and user_id in ($2, $3)",
        [conversationId, callerId, recipientId]
      );

      return membersRes.rows.length === 2;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Database check failed:", err);
    // Fallback using Supabase client
    try {
      const { data: conv } = await supabase
        .from("conversations")
        .select("type")
        .eq("id", conversationId)
        .single();
      if (!conv || conv.type !== "direct") return false;

      const { data: members } = await supabase
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", conversationId)
        .in("user_id", [callerId, recipientId]);

      return (members?.length ?? 0) === 2;
    } catch {
      return false;
    }
  }
}

/**
 * Derives the recipient (other member) of a direct conversation from the DB.
 * Never trusts a client-provided recipientId.
 * Returns null if the conversation is not direct, doesn't exist, or
 * the caller is not a member.
 */
export async function getDirectConversationRecipient(
  conversationId: string,
  callerId: string
): Promise<string | null> {
  try {
    const client = await pool.connect();
    try {
      // Fetch all members of this conversation; must be a direct conv with exactly 2 members
      const res = await client.query(
        `select c.type, cm.user_id
         from public.conversations c
         join public.conversation_members cm on cm.conversation_id = c.id
         where c.id = $1 and c.type = 'direct'`,
        [conversationId]
      );

      if (res.rows.length === 0) return null; // Not a direct conversation

      const memberIds: string[] = res.rows.map((r: { user_id: string }) => r.user_id);
      if (!memberIds.includes(callerId)) return null; // Caller is not a member

      const recipient = memberIds.find((id) => id !== callerId) ?? null;
      return recipient;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("getDirectConversationRecipient DB error:", err);
    // Supabase fallback
    try {
      const { data: conv } = await supabase
        .from("conversations")
        .select("type")
        .eq("id", conversationId)
        .single();
      if (!conv || conv.type !== "direct") return null;

      const { data: members } = await supabase
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", conversationId);

      if (!members || members.length === 0) return null;
      const memberIds = members.map((m: { user_id: string }) => m.user_id);
      if (!memberIds.includes(callerId)) return null;
      return memberIds.find((id: string) => id !== callerId) ?? null;
    } catch {
      return null;
    }
  }
}

const profileCache = new Map<
  string,
  { profile: { username: string; display_name: string; avatar_url: string | null }; ts: number }
>();
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches the caller's display profile with in-memory caching and direct Postgres query
 * to ensure zero latency on the fast call-notification path.
 */
export async function getCallerProfile(
  userId: string
): Promise<{ username: string; display_name: string; avatar_url: string | null }> {
  const cached = profileCache.get(userId);
  if (cached && Date.now() - cached.ts < PROFILE_CACHE_TTL_MS) {
    return cached.profile;
  }

  const fallback = { username: "User", display_name: "PieChat User", avatar_url: null };

  try {
    const client = await pool.connect();
    try {
      const res = await client.query(
        "select username, display_name, avatar_url from public.profiles where id = $1 limit 1",
        [userId]
      );
      if (res.rows.length > 0) {
        const p = res.rows[0];
        const profile = {
          username: p.username || "User",
          display_name: p.display_name || p.username || "PieChat User",
          avatar_url: p.avatar_url ?? null,
        };
        profileCache.set(userId, { profile, ts: Date.now() });
        return profile;
      }
    } finally {
      client.release();
    }
  } catch {
    // Supabase fallback
    try {
      const { data } = await supabase
        .from("profiles")
        .select("username, display_name, avatar_url")
        .eq("id", userId)
        .single();
      if (data) {
        const profile = data as { username: string; display_name: string; avatar_url: string | null };
        profileCache.set(userId, { profile, ts: Date.now() });
        return profile;
      }
    } catch {
      // return fallback
    }
  }

  return fallback;
}

export async function saveCallRecord(record: {
  id: string;
  conversation_id: string;
  caller_id: string;
  recipient_id: string;
  type?: "audio" | "video";
  status: string;
  started_at?: string | null;
  ended_at?: string | null;
  duration?: number;
  end_reason?: string | null;
}) {
  const callType = record.type ?? "audio";
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `insert into public.calls (id, conversation_id, caller_id, recipient_id, type, status, started_at, ended_at, duration, end_reason)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (id) do update set
           type = coalesce(public.calls.type, excluded.type),
           status = excluded.status,
           started_at = coalesce(public.calls.started_at, excluded.started_at),
           ended_at = excluded.ended_at,
           duration = excluded.duration,
           end_reason = coalesce(excluded.end_reason, public.calls.end_reason)`,
        [
          record.id,
          record.conversation_id,
          record.caller_id,
          record.recipient_id,
          callType,
          record.status,
          record.started_at ?? null,
          record.ended_at ?? null,
          record.duration ?? 0,
          record.end_reason ?? null,
        ]
      );
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Failed to save call in PostgreSQL, attempting Supabase fallback:", err);
    try {
      await supabase.from("calls").upsert({
        id: record.id,
        conversation_id: record.conversation_id,
        caller_id: record.caller_id,
        recipient_id: record.recipient_id,
        type: callType,
        status: record.status,
        started_at: record.started_at,
        ended_at: record.ended_at,
        duration: record.duration ?? 0,
        end_reason: record.end_reason,
      });
    } catch (fallbackErr) {
      console.warn("Supabase upsert call fallback also failed:", fallbackErr);
    }
  }
}
