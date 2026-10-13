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

-- ========================================================
-- STEP 12: Realtime & Non-recursive Conversation Membership
-- ========================================================

create or replace function public.is_conversation_member(p_conv_id uuid)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.conversation_members
    where conversation_id = p_conv_id
      and user_id = auth.uid()
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid) to authenticated;

drop policy if exists "conversations_select_members" on public.conversations;
create policy "conversations_select_members"
on public.conversations
for select to authenticated
using (
  public.is_conversation_member(id)
);

drop policy if exists "members_select_same_conversation" on public.conversation_members;
create policy "members_select_same_conversation"
on public.conversation_members
for select to authenticated
using (
  public.is_conversation_member(conversation_id)
);

drop policy if exists "messages_select_members" on public.messages;
create policy "messages_select_members"
on public.messages
for select to authenticated
using (
  public.is_conversation_member(conversation_id)
);

drop policy if exists "messages_insert_as_member" on public.messages;
create policy "messages_insert_as_member"
on public.messages
for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and public.is_conversation_member(conversation_id)
);

-- Realtime publication for messages
alter table public.messages replica identity full;
alter publication supabase_realtime add table public.messages;

-- ========================================================
-- STEP 13: Direct Conversation Creation RPC
-- ========================================================

create or replace function public.get_or_create_direct_conversation(p_friend_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_conv_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_user_id = p_friend_id then
    raise exception 'Cannot create direct conversation with yourself';
  end if;

  -- Verify they are accepted friends
  if not exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = v_user_id and addressee_id = p_friend_id)
        or (requester_id = p_friend_id and addressee_id = v_user_id))
  ) then
    raise exception 'Users are not accepted friends';
  end if;

  -- Check existing direct conversation
  select c.id into v_conv_id
  from public.conversations c
  join public.conversation_members cm1 on cm1.conversation_id = c.id and cm1.user_id = v_user_id
  join public.conversation_members cm2 on cm2.conversation_id = c.id and cm2.user_id = p_friend_id
  where c.type = 'direct'
  limit 1;

  if v_conv_id is not null then
    return v_conv_id;
  end if;

  -- Create new direct conversation
  insert into public.conversations (type, created_by)
  values ('direct', v_user_id)
  returning id into v_conv_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values
    (v_conv_id, v_user_id, 'member'),
    (v_conv_id, p_friend_id, 'member')
  on conflict do nothing;

  return v_conv_id;
end;
$$;

revoke all on function public.get_or_create_direct_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;

-- ========================================================
-- PHASE 14: Secure Group Chat RPCs
-- ========================================================

-- 1. Create Group Conversation RPC
create or replace function public.create_group_conversation(
  group_title text,
  member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_conv_id uuid;
  v_clean_title text;
  v_member_id uuid;
  v_valid_members uuid[];
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  v_clean_title := trim(group_title);
  if length(v_clean_title) < 1 or length(v_clean_title) > 60 then
    raise exception 'Group name must be between 1 and 60 characters';
  end if;

  -- Filter unique member IDs and exclude creator
  select coalesce(array_agg(distinct m), '{}')
  into v_valid_members
  from unnest(member_ids) as m
  where m <> v_user_id;

  if coalesce(array_length(v_valid_members, 1), 0) < 1 then
    raise exception 'Select at least one friend to create a group';
  end if;

  -- Validate friendship: every selected member must be an accepted friend with the creator
  foreach v_member_id in array v_valid_members loop
    if not exists (
      select 1 from public.friendships
      where status = 'accepted'
        and (
          (requester_id = v_user_id and addressee_id = v_member_id)
          or (requester_id = v_member_id and addressee_id = v_user_id)
        )
    ) then
      raise exception 'All members must be accepted friends of the creator';
    end if;
  end loop;

  -- Create conversation row
  insert into public.conversations (type, title, created_by)
  values ('group', v_clean_title, v_user_id)
  returning id into v_conv_id;

  -- Add creator as admin
  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_conv_id, v_user_id, 'admin');

  -- Add validated friends as members
  foreach v_member_id in array v_valid_members loop
    insert into public.conversation_members (conversation_id, user_id, role)
    values (v_conv_id, v_member_id, 'member')
    on conflict do nothing;
  end loop;

  return v_conv_id;
end;
$$;

revoke all on function public.create_group_conversation(text, uuid[]) from public, anon;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;

-- 2. Add Group Members RPC
create or replace function public.add_group_members(
  p_conv_id uuid,
  p_member_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_member_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Verify caller is admin of this group
  if not exists (
    select 1 from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    where cm.conversation_id = p_conv_id
      and cm.user_id = v_user_id
      and cm.role = 'admin'
      and c.type = 'group'
  ) then
    raise exception 'Only group admins can add members';
  end if;

  foreach v_member_id in array p_member_ids loop
    if v_member_id <> v_user_id then
      -- Must be accepted friend of the admin
      if exists (
        select 1 from public.friendships
        where status = 'accepted'
          and (
            (requester_id = v_user_id and addressee_id = v_member_id)
            or (requester_id = v_member_id and addressee_id = v_user_id)
          )
      ) then
        insert into public.conversation_members (conversation_id, user_id, role)
        values (p_conv_id, v_member_id, 'member')
        on conflict do nothing;
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.add_group_members(uuid, uuid[]) from public, anon;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;

-- 3. Remove Group Member RPC
create or replace function public.remove_group_member(
  p_conv_id uuid,
  p_target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_caller_role text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_caller_role
  from public.conversation_members
  where conversation_id = p_conv_id
    and user_id = v_user_id;

  if v_caller_role is null then
    raise exception 'You are not a member of this conversation';
  end if;

  -- Caller can remove themselves (leave), or admin can remove any member
  if v_user_id <> p_target_user_id and v_caller_role <> 'admin' then
    raise exception 'Only admins can remove other members';
  end if;

  delete from public.conversation_members
  where conversation_id = p_conv_id
    and user_id = p_target_user_id;
end;
$$;

revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

-- ========================================================
-- STEP 16 & 17: Receipts, Reactions, and Read Status
-- ========================================================

-- 1. Message Receipts Table
create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key (message_id, user_id)
);

alter table public.message_receipts enable row level security;

drop policy if exists "receipts_select_members" on public.message_receipts;
create policy "receipts_select_members" on public.message_receipts
for select to authenticated
using (
  exists (
    select 1 from public.messages m
    where m.id = message_receipts.message_id
      and public.is_conversation_member(m.conversation_id)
  )
);

drop policy if exists "receipts_insert_self" on public.message_receipts;
create policy "receipts_insert_self" on public.message_receipts
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages m
    where m.id = message_receipts.message_id
      and public.is_conversation_member(m.conversation_id)
  )
);

drop policy if exists "receipts_update_self" on public.message_receipts;
create policy "receipts_update_self" on public.message_receipts
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Mark messages read RPC
create or replace function public.mark_messages_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.is_conversation_member(p_conversation_id) then
    return;
  end if;

  insert into public.message_receipts (message_id, user_id, read_at, delivered_at)
  select m.id, v_user_id, now(), now()
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.sender_id <> v_user_id
  on conflict (message_id, user_id)
  do update set
    read_at = coalesce(message_receipts.read_at, excluded.read_at),
    delivered_at = coalesce(message_receipts.delivered_at, excluded.delivered_at);
end;
$$;

revoke all on function public.mark_messages_read(uuid) from public, anon;
grant execute on function public.mark_messages_read(uuid) to authenticated;

-- 2. Message Reactions Table
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji),
  constraint message_reactions_emoji_length check (char_length(emoji) between 1 and 32)
);

create index if not exists message_reactions_message_id_idx on public.message_reactions(message_id);

alter table public.message_reactions enable row level security;

drop policy if exists "reactions_select_members" on public.message_reactions;
create policy "reactions_select_members" on public.message_reactions
for select to authenticated
using (
  exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and public.is_conversation_member(m.conversation_id)
  )
);

drop policy if exists "reactions_insert_self" on public.message_reactions;
create policy "reactions_insert_self" on public.message_reactions
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and public.is_conversation_member(m.conversation_id)
  )
);

drop policy if exists "reactions_delete_self" on public.message_reactions;
create policy "reactions_delete_self" on public.message_reactions
for delete to authenticated
using (user_id = auth.uid());

-- Toggle Reaction RPC
create or replace function public.toggle_message_reaction(p_message_id uuid, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_exists boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select exists(
    select 1 from public.message_reactions
    where message_id = p_message_id and user_id = v_user_id and emoji = p_emoji
  ) into v_exists;

  if v_exists then
    delete from public.message_reactions
    where message_id = p_message_id and user_id = v_user_id and emoji = p_emoji;
    return false;
  else
    insert into public.message_reactions (message_id, user_id, emoji)
    values (p_message_id, v_user_id, p_emoji)
    on conflict do nothing;
    return true;
  end if;
end;
$$;

revoke all on function public.toggle_message_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;

alter table public.message_reactions replica identity full;
alter publication supabase_realtime add table public.message_reactions;
alter table public.message_receipts replica identity full;
alter publication supabase_realtime add table public.message_receipts;

-- ========================================================
-- STEP 20: Secure Message Actions (Edit & Delete RPCs)
-- ========================================================

-- Edit Message RPC with Server-Side Read Limits Enforcement
create or replace function public.edit_message(
  p_message_id uuid,
  p_content text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_msg record;
  v_reader_count int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_content is null or trim(p_content) = '' then
    raise exception 'Message content cannot be empty';
  end if;

  select m.id, m.conversation_id, m.sender_id, m.deleted_at, c.type as conv_type
  into v_msg
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where m.id = p_message_id;

  if not found then
    raise exception 'Message not found';
  end if;

  if v_msg.sender_id <> v_user_id then
    raise exception 'Unauthorized: You can only edit your own messages';
  end if;

  if not public.is_conversation_member(v_msg.conversation_id) then
    raise exception 'Unauthorized: You are not a member of this conversation';
  end if;

  if v_msg.deleted_at is not null then
    raise exception 'Cannot edit a deleted message';
  end if;

  -- Count distinct recipients who have read this message
  select count(distinct user_id)
  into v_reader_count
  from public.message_receipts
  where message_id = p_message_id
    and read_at is not null
    and user_id <> v_user_id;

  -- Direct chat rule: cannot edit if read by recipient
  if v_msg.conv_type = 'direct' and v_reader_count > 0 then
    raise exception 'Cannot edit: message has already been read by the recipient';
  end if;

  -- Group chat rule: cannot edit if read by more than 2 members
  if v_msg.conv_type = 'group' and v_reader_count > 2 then
    raise exception 'Cannot edit: message has been read by more than 2 members';
  end if;

  update public.messages
  set content = p_content,
      edited_at = now()
  where id = p_message_id;

  return true;
end;
$$;

revoke all on function public.edit_message(uuid, text) from public, anon;
grant execute on function public.edit_message(uuid, text) to authenticated;

-- Delete Message RPC (Soft Delete for Everyone)
create or replace function public.delete_message(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_msg record;
  v_caller_role text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select m.id, m.conversation_id, m.sender_id, m.deleted_at, c.type as conv_type
  into v_msg
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where m.id = p_message_id;

  if not found then
    raise exception 'Message not found';
  end if;

  if not public.is_conversation_member(v_msg.conversation_id) then
    raise exception 'Unauthorized: Not a member of this conversation';
  end if;

  select role into v_caller_role
  from public.conversation_members
  where conversation_id = v_msg.conversation_id
    and user_id = v_user_id;

  -- Only sender or group admin can delete
  if v_msg.sender_id <> v_user_id and coalesce(v_caller_role, '') <> 'admin' then
    raise exception 'Unauthorized: Only sender or group admin can delete this message';
  end if;

  update public.messages
  set deleted_at = now()
  where id = p_message_id;

  return true;
end;
$$;

revoke all on function public.delete_message(uuid) from public, anon;
grant execute on function public.delete_message(uuid) to authenticated;

-- ========================================================
-- STEP 21: Audio Voice Calling System (Calls Table & Policies)
-- ========================================================

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'ringing' check (status in ('ringing', 'accepted', 'rejected', 'busy', 'cancelled', 'missed', 'failed', 'ended')),
  started_at timestamptz,
  ended_at timestamptz,
  duration integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists calls_conversation_idx on public.calls(conversation_id);
create index if not exists calls_caller_idx on public.calls(caller_id);
create index if not exists calls_recipient_idx on public.calls(recipient_id);

alter table public.calls enable row level security;

drop policy if exists "calls_select_members" on public.calls;
create policy "calls_select_members"
on public.calls for select to authenticated
using (
  public.is_conversation_member(conversation_id)
);

drop policy if exists "calls_insert_caller" on public.calls;
create policy "calls_insert_caller"
on public.calls for insert to authenticated
with check (
  caller_id = (select auth.uid())
  and public.is_conversation_member(conversation_id)
);

drop policy if exists "calls_update_participants" on public.calls;
create policy "calls_update_participants"
on public.calls for update to authenticated
using (
  caller_id = (select auth.uid()) or recipient_id = (select auth.uid())
)
with check (
  caller_id = (select auth.uid()) or recipient_id = (select auth.uid())
);

alter table public.calls replica identity full;
alter publication supabase_realtime add table public.calls;


