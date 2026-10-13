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

export async function saveCallRecord(record: {
  id: string;
  conversation_id: string;
  caller_id: string;
  recipient_id: string;
  status: string;
  started_at?: string | null;
  ended_at?: string | null;
  duration?: number;
  end_reason?: string | null;
}) {
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `insert into public.calls (id, conversation_id, caller_id, recipient_id, status, started_at, ended_at, duration)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do update set
           status = excluded.status,
           started_at = coalesce(public.calls.started_at, excluded.started_at),
           ended_at = excluded.ended_at,
           duration = excluded.duration`,
        [
          record.id,
          record.conversation_id,
          record.caller_id,
          record.recipient_id,
          record.status,
          record.started_at ?? null,
          record.ended_at ?? null,
          record.duration ?? 0,
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
        status: record.status,
        started_at: record.started_at,
        ended_at: record.ended_at,
        duration: record.duration ?? 0,
      });
    } catch (fallbackErr) {
      console.warn("Supabase upsert call fallback also failed:", fallbackErr);
    }
  }
}
