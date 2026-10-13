-- PIECHAT: Initial database schema

-- 1. Profiles (linked with Supabase auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null default '',
  avatar_url text,
  bio text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-zA-Z0-9_]{3,24}$')
);

-- 2. Friendships
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'blocked')),
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

-- 3. Conversations (Direct / Group)
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct', 'group')),
  title text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 4. Conversation Members
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin')),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- 5. Messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  message_type text not null default 'text' check (message_type in ('text', 'image', 'video', 'file', 'voice')),
  content text,
  media_url text,
  reply_to_id uuid references public.messages(id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Indexes for performance
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create index if not exists friendships_addressee_status_idx on public.friendships (addressee_id, status);
create index if not exists conversation_members_user_idx on public.conversation_members (user_id);

-- Enable Row Level Security (RLS) on all tables
alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- ========================================================
-- STEP 4: Access Policies & Auto Profile Creation Trigger
-- ========================================================

-- Profiles Policies
create policy "profiles_select_authenticated"
on public.profiles
for select to authenticated
using (true);

create policy "profiles_insert_own"
on public.profiles
for insert to authenticated
with check (id = (select auth.uid()));

create policy "profiles_update_own"
on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Friendships Policies
create policy "friendships_select_participants"
on public.friendships
for select to authenticated
using (
  requester_id = (select auth.uid())
  or addressee_id = (select auth.uid())
);

create policy "friendships_insert_requester"
on public.friendships
for insert to authenticated
with check (requester_id = (select auth.uid()));

create policy "friendships_update_participants"
on public.friendships
for update to authenticated
using (
  requester_id = (select auth.uid())
  or addressee_id = (select auth.uid())
)
with check (
  requester_id = (select auth.uid())
  or addressee_id = (select auth.uid())
);

-- Conversations Policies
create policy "conversations_select_members"
on public.conversations
for select to authenticated
using (
  exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = id
      and cm.user_id = (select auth.uid())
  )
);

create policy "conversations_insert_creator"
on public.conversations
for insert to authenticated
with check (created_by = (select auth.uid()));

-- Conversation Members Policies
create policy "members_select_same_conversation"
on public.conversation_members
for select to authenticated
using (
  exists (
    select 1
    from public.conversation_members mine
    where mine.conversation_id = conversation_id
      and mine.user_id = (select auth.uid())
  )
);

create policy "members_insert_creator_self"
on public.conversation_members
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.conversations c
    where c.id = conversation_id
      and c.created_by = (select auth.uid())
  )
);

-- Messages Policies
create policy "messages_select_members"
on public.messages
for select to authenticated
using (
  exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.user_id = (select auth.uid())
  )
);

create policy "messages_insert_as_member"
on public.messages
for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.user_id = (select auth.uid())
  )
);

create policy "messages_update_own"
on public.messages
for update to authenticated
using (sender_id = (select auth.uid()))
with check (sender_id = (select auth.uid()));

-- Automatic Profile Creation on Signup Trigger
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    username,
    display_name
  )
  values (
    new.id,
    'user_' || substr(replace(new.id::text, '-', ''), 1, 16),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      split_part(coalesce(new.email, 'user'), '@', 1)
    )
  );

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- ========================================================
-- STEP 9: Friend Request Security & Resolution Function
-- ========================================================

drop policy if exists "friendships_update_participants"
on public.friendships;

drop policy if exists "friendships_insert_requester"
on public.friendships;

create policy "friendships_insert_pending_request"
on public.friendships
for insert to authenticated
with check (
  requester_id = (select auth.uid())
  and status = 'pending'
);

create or replace function public.respond_to_friend_request(
  request_id uuid,
  accept_request boolean
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_requester_id uuid;
  v_addressee_id uuid;
  v_conv_id uuid;
begin
  select requester_id, addressee_id
  into v_requester_id, v_addressee_id
  from public.friendships
  where id = request_id
    and addressee_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'Request not found or already handled';
  end if;

  update public.friendships
  set status = case
    when accept_request then 'accepted'
    else 'rejected'
  end
  where id = request_id;

  if accept_request then
    select c.id into v_conv_id
    from public.conversations c
    join public.conversation_members cm1 on cm1.conversation_id = c.id and cm1.user_id = v_requester_id
    join public.conversation_members cm2 on cm2.conversation_id = c.id and cm2.user_id = v_addressee_id
    where c.type = 'direct'
    limit 1;

    if v_conv_id is null then
      insert into public.conversations (type, created_by)
      values ('direct', v_addressee_id)
      returning id into v_conv_id;

      insert into public.conversation_members (conversation_id, user_id, role)
      values
        (v_conv_id, v_requester_id, 'member'),
        (v_conv_id, v_addressee_id, 'member')
      on conflict do nothing;
    end if;
  end if;
end;
$$;

revoke all on function public.respond_to_friend_request(uuid, boolean)
from public, anon;

grant execute on function public.respond_to_friend_request(uuid, boolean)
to authenticated;

create policy "friendships_receiver_respond"
on public.friendships
for update to authenticated
using (
  addressee_id = (select auth.uid())
  and status = 'pending'
)
with check (
  addressee_id = (select auth.uid())
  and status in ('accepted', 'rejected')
);

