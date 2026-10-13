# PieChat Voice Calling — Architecture & Deployment Setup Guide

## 1. System Architecture

PieChat's one-to-one voice calling system is designed for high reliability, minimal latency, and zero camera access.

```
┌─────────────────────────┐               ┌─────────────────────────┐
│     Caller Client       │               │    Recipient Client     │
│   (Next.js / WebRTC)    │               │   (Next.js / WebRTC)    │
└────────────┬────────────┘               └────────────┬────────────┘
             │                                         │
             │         1. Authenticated Signaling      │
             ├─────────────────────────────────────────┤
             │  (Socket.IO & Supabase Realtime Fallback)│
             ▼                                         ▼
┌───────────────────────────────────────────────────────────────────┐
│              Signaling & Membership Verification                  │
│  - Express / Node.js Socket.IO server                             │
│  - Supabase Auth JWT token verification                           │
│  - Database check: Direct conversation & membership verification  │
│  - Server-side Call State Machine & busy policy                   │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │
                                  ▼ 2. ICE Candidates & SDP Offer/Answer
┌───────────────────────────────────────────────────────────────────┐
│                     Peer-to-Peer Audio Stream                     │
│               WebRTC (audio: true, video: false)                  │
│               Encrypted DTLS-SRTP Audio Flow                      │
│               STUN / TURN Relays when traversing NATs             │
└───────────────────────────────────────────────────────────────────┘
```

---

## 2. Signaling Infrastructure & Fallback Redundancy

* **Primary Signaling**: Authenticated Socket.IO server running on `apps/backend/src/server.ts` and `apps/backend/src/socket.ts`.
  * Verifies Supabase Auth token on handshake (`socket.handshake.auth.token`).
  * Validates caller & recipient membership in the direct conversation via PostgreSQL.
  * Manages unique server-generated UUID `callId`.
  * Enforces state machine: `ringing`, `accepted`, `connected`, `declined`, `cancelled`, `busy`, `missed`, `ended`.
* **Redundant Fallback**: In serverless deployments (such as static/serverless Vercel hosting without an always-on backend instance), the frontend automatically uses Supabase Realtime authenticated channels (`user-calls-${userId}` and `call-signal-${conversationId}`) to ensure uninterrupted calling.

---

## 3. Required Environment Variables

### Frontend (`apps/web/.env.local` / Vercel Environment Variables):
```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="your-anon-key"

# Signaling Server URL (Point to deployed backend or localhost for dev)
NEXT_PUBLIC_SOCKET_URL="https://your-backend.onrender.com"

# Optional TURN / STUN Configuration (JSON string)
# Leave empty to default to Google's public STUN servers
NEXT_PUBLIC_ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"stun:stun1.l.google.com:19302"}]'
```

### Backend (`apps/backend/.env` / Cloud Host Environment Variables):
```env
PORT=4000
WEB_ORIGIN="https://piechat-neon.vercel.app"

# Database Connections
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[ref]:[password]@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres"

# Supabase Auth Verification
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_ANON_KEY="your-anon-key"

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=500
```

---

## 4. Production TURN Server Setup (Traversal of Restrictive NATs & Firewalls)

For production calls between different mobile networks or enterprise Wi-Fi where symmetric NAT prevents direct peer-to-peer routing, a TURN relay server is required.

### Recommended Providers:
1. **Twilio Network Traversal Service**: Issues ephemeral, short-lived TURN credentials.
2. **Metered.ca / Xirsys**: Provides standard TURN endpoints with username and credential.
3. **Open-Source coturn**: Self-hosted coturn server on a VPS with a static IP and UDP ports 3478, 5349.

### Setting up Credentials:
Add the TURN configuration to `NEXT_PUBLIC_ICE_SERVERS` in Vercel:
```json
[
  { "urls": "stun:stun.l.google.com:19302" },
  {
    "urls": "turn:turn.example.com:3478",
    "username": "piechat-user",
    "credential": "secure-turn-password"
  }
]
```

---

## 5. Supabase Database Migration

Execute the migration in the **Supabase Dashboard -> SQL Editor**:
```sql
-- Create Calls Table
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'ringing' check (status in ('ringing', 'accepted', 'connected', 'declined', 'missed', 'cancelled', 'busy', 'failed', 'ended')),
  started_at timestamptz,
  ended_at timestamptz,
  duration integer not null default 0,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists calls_conversation_idx on public.calls(conversation_id);
create index if not exists calls_caller_idx on public.calls(caller_id);
create index if not exists calls_recipient_idx on public.calls(recipient_id);

-- RLS Policies
alter table public.calls enable row level security;

create policy "calls_select_members"
on public.calls for select to authenticated
using (
  public.is_conversation_member(conversation_id)
);

create policy "calls_insert_caller"
on public.calls for insert to authenticated
with check (
  caller_id = (select auth.uid())
  and public.is_conversation_member(conversation_id)
);

create policy "calls_update_participants"
on public.calls for update to authenticated
using (
  caller_id = (select auth.uid()) or recipient_id = (select auth.uid())
)
with check (
  caller_id = (select auth.uid()) or recipient_id = (select auth.uid())
);

-- Realtime
alter table public.calls replica identity full;
alter publication supabase_realtime add table public.calls;
```

---

## 6. Browser & Mobile Permissions / Limitations

1. **HTTPS is Mandatory**: `navigator.mediaDevices.getUserMedia` requires a secure HTTPS context or `localhost`. Plain `http://` on custom domains will fail.
2. **Audio-Only Guarantee**: PieChat never requests video permissions or camera hardware.
3. **Autoplay Restrictions**: Modern browsers (Safari, Chrome) may suspend audio elements until the user has interacted with the page. PieChat automatically catches this and displays a one-tap audio unlock banner: *"Tap here to enable incoming audio"*.
4. **Procedural Ringtone**: Outgoing and incoming ringtones use the standard Web Audio API (`AudioContext`), eliminating external sound asset downloads or broken paths.

---

## 7. Local Development Setup

To run both frontend and backend locally:
```bash
# Terminal 1: Backend Signaling Server (Port 4000)
npm run dev:backend

# Terminal 2: Web Frontend (Port 3000)
npm run dev:web
```

To test calling locally:
1. Open Chrome in a normal profile and log into Account 1 at `http://localhost:3000`.
2. Open Chrome in Incognito or Firefox and log into Account 2 at `http://localhost:3000`.
3. Ensure both accounts are accepted friends and click **Call** in the direct chat header.
