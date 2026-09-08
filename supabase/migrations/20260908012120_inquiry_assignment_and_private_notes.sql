-- #415: 문의 담당자, 표시명, 내부 메모, 미답변 경과 시간.
-- 기존 inquiries와 고객 대화/RPC 계약을 유지한다. handled_by는 마지막 처리자이며
-- 담당자 assignee_id와 독립적이다. 내부 메모는 고객 대화에 절대로 합치지 않는다.
alter table public.inquiries
  add column assignee_id uuid references public.profiles(id) on delete set null,
  add column waiting_since timestamptz;

-- 기존 대화는 첫 답변자로 배정한다. 미답변 시간은 마지막 운영자 답변 이후의
-- 첫 고객 메시지부터 센다. 고객이 독촉 메시지를 보내도 기다린 시간이 초기화되지 않는다.
update public.inquiries as thread
set assignee_id = (
  select message.author_id from public.inquiry_messages as message
  where message.inquiry_id = thread.id and message.author = 'staff'
  order by message.created_at, message.id limit 1
), waiting_since = case when thread.status = 'open' then coalesce((
  select min(message.created_at) from public.inquiry_messages as message
  where message.inquiry_id = thread.id and message.author = 'user'
    and message.created_at >= coalesce((
      select max(reply.created_at) from public.inquiry_messages as reply
      where reply.inquiry_id = thread.id and reply.author = 'staff'
    ), '-infinity'::timestamptz)
), thread.last_message_at) else null end;

alter table public.inquiries
  add constraint inquiries_waiting_state_check check (
    (status = 'open' and waiting_since is not null)
    or (status <> 'open' and waiting_since is null)
  );
create index inquiries_waiting_queue_idx on public.inquiries(waiting_since, id)
  where status = 'open';
create index inquiries_assignee_idx on public.inquiries(assignee_id)
  where assignee_id is not null;

create function private.track_inquiry_assignment_and_wait()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.waiting_since := case when new.status = 'open' then new.created_at else null end;
  else
    new.waiting_since := case
      when new.status <> 'open' then null
      when old.status <> 'open' then new.last_message_at
      else old.waiting_since end;
    if new.status = 'answered' and old.answered_at is null and old.assignee_id is null
      and v_actor is not null and public.is_staff()
    then
      new.assignee_id := v_actor;
      insert into public.audit_log(actor_id, action, target, diff)
      values (v_actor, 'admin.inquiry.assigned', 'inquiries:' || new.id::text,
        jsonb_build_object('before', null, 'after', v_actor, 'source', 'first_reply'));
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.track_inquiry_assignment_and_wait()
  from public, anon, authenticated, service_role;
create trigger inquiry_assignment_and_wait
  before insert or update of status, last_message_at on public.inquiries
  for each row execute function private.track_inquiry_assignment_and_wait();

-- 목적별 표시명 읽기: profiles self-only 정책을 넓히지 않는다. 해당 문의의
-- 고객과 staff만 실제 메시지에 참여한 답변자의 표시명을 볼 수 있다.
create function public.inquiry_message_author_names(target_inquiry_id uuid)
returns table(message_id uuid, author_name text)
language sql stable security definer set search_path = '' as $$
  select message.id, coalesce(nullif(btrim(profile.nickname), ''), '운영자_' || left(profile.id::text, 6))
  from public.inquiry_messages as message
  join public.inquiries as thread on thread.id = message.inquiry_id
  join public.profiles as profile on profile.id = message.author_id
  where thread.id = target_inquiry_id and message.author = 'staff'
    and (select auth.uid()) is not null
    and (thread.user_id = (select auth.uid()) or (select public.is_staff()));
$$;
revoke all on function public.inquiry_message_author_names(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.inquiry_message_author_names(uuid) to authenticated;

create table public.inquiry_internal_notes (
  id uuid primary key default extensions.gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000 and body ~ '[^[:space:]]'),
  created_at timestamptz not null default now()
);
create index inquiry_internal_notes_thread_idx
  on public.inquiry_internal_notes(inquiry_id, created_at, id);
alter table public.inquiry_internal_notes enable row level security;
revoke all on public.inquiry_internal_notes from public, anon, authenticated, service_role;
grant select on public.inquiry_internal_notes to authenticated;
create policy inquiry_internal_notes_staff_read on public.inquiry_internal_notes
  for select to authenticated using ((select public.is_staff()));

create function public.admin_reassign_inquiry(
  target_inquiry_id uuid, target_assignee_id uuid, target_reason text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_before uuid;
  v_reason text := btrim(coalesce(target_reason, ''), E' \t\n\r');
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if char_length(v_reason) not between 1 and 500 then
    raise invalid_parameter_value using message = 'invalid_assignment_reason';
  end if;
  select thread.assignee_id into v_before from public.inquiries as thread
    where thread.id = target_inquiry_id for update;
  if not found then raise no_data_found using message = 'inquiry_not_found'; end if;
  if target_assignee_id is not null then
    perform 1 from public.profiles as profile
      where profile.id = target_assignee_id and profile.role in ('staff', 'admin')
        and profile.suspended_at is null for share;
    if not found then raise invalid_parameter_value using message = 'invalid_inquiry_assignee'; end if;
  end if;
  if v_before is not distinct from target_assignee_id then return false; end if;
  update public.inquiries set assignee_id = target_assignee_id where id = target_inquiry_id;
  insert into public.audit_log(actor_id, action, target, diff)
    values (v_actor, 'admin.inquiry.reassigned', 'inquiries:' || target_inquiry_id::text,
      jsonb_build_object('before', v_before, 'after', target_assignee_id, 'reason', v_reason));
  return true;
end;
$$;
revoke all on function public.admin_reassign_inquiry(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_reassign_inquiry(uuid, uuid, text) to authenticated;

create function public.admin_add_inquiry_internal_note(target_inquiry_id uuid, target_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_body text := btrim(coalesce(target_body, ''), E' \t\n\r');
  v_note_id uuid;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise invalid_parameter_value using message = 'invalid_inquiry_note_body';
  end if;
  perform 1 from public.inquiries where id = target_inquiry_id for update;
  if not found then raise no_data_found using message = 'inquiry_not_found'; end if;
  insert into public.inquiry_internal_notes(inquiry_id, author_id, body)
    values (target_inquiry_id, v_actor, v_body) returning id into v_note_id;
  insert into public.audit_log(actor_id, action, target, diff)
    values (v_actor, 'admin.inquiry.note_added', 'inquiries:' || target_inquiry_id::text,
      jsonb_build_object('noteId', v_note_id));
  return v_note_id;
end;
$$;
revoke all on function public.admin_add_inquiry_internal_note(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_add_inquiry_internal_note(uuid, text) to authenticated;

-- 문의 상세의 staff 전용 작은 DTO. 메모는 고객용 author_names와 합치지 않는다.
create function public.admin_inquiry_workspace(target_inquiry_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  select jsonb_build_object(
    'assigneeName', case when assignee.id is null then null else
      coalesce(nullif(btrim(assignee.nickname), ''), '운영자_' || left(assignee.id::text, 6)) end,
    'staffOptions', coalesce((
      select jsonb_agg(jsonb_build_object('id', profile.id, 'name',
        coalesce(nullif(btrim(profile.nickname), ''), '운영자_' || left(profile.id::text, 6)))
        order by profile.nickname nulls last, profile.id)
      from public.profiles as profile
      where profile.role in ('staff', 'admin') and profile.suspended_at is null
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', note.id, 'body', note.body,
        'authorName', coalesce(nullif(btrim(author.nickname), ''),
          case when author.id is null then '탈퇴한 운영자' else '운영자_' || left(author.id::text, 6) end),
        'createdAt', note.created_at) order by note.created_at, note.id)
      from public.inquiry_internal_notes as note
      left join public.profiles as author on author.id = note.author_id
      where note.inquiry_id = thread.id
    ), '[]'::jsonb)
  ) into v_result
  from public.inquiries as thread
  left join public.profiles as assignee on assignee.id = thread.assignee_id
  where thread.id = target_inquiry_id;
  if not found then raise no_data_found using message = 'inquiry_not_found'; end if;
  return v_result;
end;
$$;
revoke all on function public.admin_inquiry_workspace(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_inquiry_workspace(uuid) to authenticated;

-- 반환 DTO에 담당자와 대기 시작을 확장한다. 같은 필터/호출 계약을 유지한다.
drop function public.admin_search_inquiries(text,text,date,date,text,text,integer,integer);
create function public.admin_search_inquiries(
  p_status text default null,
  p_category text default null,
  p_from date default null,
  p_to date default null,
  p_query text default null,
  p_field text default 'all',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  reference bigint,
  category text,
  title text,
  status text,
  user_id uuid,
  buyer_name text,
  buyer_email text,
  order_id uuid,
  good_id text,
  good_name text,
  handled_by uuid,
  handler_name text,
  created_at timestamptz,
  last_message_at timestamptz,
  answered_at timestamptz,
  closed_at timestamptz,
  message_count bigint,
  total_count bigint,
  assignee_id uuid,
  assignee_name text,
  waiting_since timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_field text := coalesce(nullif(btrim(coalesce(p_field, '')), ''), 'all');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  if p_status is not null and p_status not in ('open', 'answered', 'closed') then
    raise check_violation using message = 'invalid_inquiry_status_filter';
  end if;
  if p_category is not null
    and p_category not in ('order', 'claim', 'good', 'account', 'etc')
  then
    raise check_violation using message = 'invalid_inquiry_category_filter';
  end if;
  if v_field not in ('all', 'title', 'buyer', 'order') then
    raise check_violation using message = 'invalid_inquiry_search_field';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid_inquiry_date_range';
  end if;
  if v_query is not null and char_length(v_query) > 100 then
    raise check_violation using message = 'inquiry_search_query_too_long';
  end if;

  return query
  select
    thread.id,
    thread.reference,
    thread.category,
    thread.title,
    thread.status,
    thread.user_id,
    buyer.nickname as buyer_name,
    buyer.email as buyer_email,
    thread.order_id,
    thread.good_id,
    good.name as good_name,
    thread.handled_by,
    handler.nickname as handler_name,
    thread.created_at,
    thread.last_message_at,
    thread.answered_at,
    thread.closed_at,
    (
      select count(*)
      from public.inquiry_messages as message
      where message.inquiry_id = thread.id
    ) as message_count,
    count(*) over()::bigint as total_count,
    thread.assignee_id,
    case when assignee.id is null then null else
      coalesce(nullif(btrim(assignee.nickname), ''), '운영자_' || left(assignee.id::text, 6)) end,
    thread.waiting_since
  from public.inquiries as thread
  join public.profiles as buyer on buyer.id = thread.user_id
  left join public.profiles as handler on handler.id = thread.handled_by
  left join public.profiles as assignee on assignee.id = thread.assignee_id
  left join public.goods as good on good.id = thread.good_id
  where (p_status is null or thread.status = p_status)
    and (p_category is null or thread.category = p_category)
    and (
      p_from is null
      or thread.created_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    )
    and (
      p_to is null
      or thread.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
    )
    and (
      v_query is null
      or (
        v_field in ('all', 'title')
        and position(lower(v_query) in lower(thread.title)) > 0
      )
      or (
        v_field in ('all', 'buyer')
        and (
          position(lower(v_query) in lower(coalesce(buyer.nickname, ''))) > 0
          or position(lower(v_query) in lower(coalesce(buyer.email, ''))) > 0
        )
      )
      or (
        v_field in ('all', 'order')
        and (
          position(lower(v_query) in lower(coalesce(thread.order_id::text, ''))) > 0
          or lower(v_query) = lower(thread.reference::text)
        )
      )
    )
  /* 미답변이 먼저, 그중에서도 오래 기다린 것이 위로. 종결은 맨 아래다. */
  order by
    case thread.status when 'open' then 0 when 'answered' then 1 else 2 end,
    case when thread.status = 'open' then thread.waiting_since else thread.last_message_at end,
    thread.id
  limit v_limit
  offset v_offset;
end;
$$;
revoke all on function public.admin_search_inquiries(text,text,date,date,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_inquiries(text,text,date,date,text,text,integer,integer) to authenticated;
