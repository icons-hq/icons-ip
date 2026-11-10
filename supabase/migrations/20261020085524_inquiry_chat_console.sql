-- ICONS 상담 콘솔. Existing inquiry messages remain the conversation source.
-- Read receipts belong to each operator and to exact displayed customer messages;
-- opening a conversation must never consume a message that arrived after the read.
create table private.inquiry_chat_reads (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.inquiry_messages(id) on delete cascade,
  read_at timestamptz not null default clock_timestamp(),
  primary key (actor_id, message_id)
);
alter table private.inquiry_chat_reads enable row level security;
revoke all on private.inquiry_chat_reads from public, anon, authenticated, service_role;
create index inquiry_chat_reads_message_idx on private.inquiry_chat_reads(message_id);
create index inquiry_messages_chat_customer_idx on public.inquiry_messages(inquiry_id, id) where author='user';

create function public.admin_inquiry_chat_console(
  p_status text default 'all', p_assignee text default 'all', p_period text default '7d',
  p_read text default 'all', p_sort text default 'recent', p_query text default '',
  p_limit integer default 30, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid := (select auth.uid());
  v_query text := btrim(coalesce(p_query,''));
  v_limit integer := least(greatest(coalesce(p_limit,30),1),100);
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_result jsonb;
begin
  if v_actor is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message='operator_capability_required';
  end if;
  if p_status is null or p_status not in ('all','open','answered','closed')
    or p_period is null or p_period not in ('7d','30d','all')
    or p_read is null or p_read not in ('all','unread','read')
    or p_sort is null or p_sort not in ('recent','oldest')
    or p_assignee is null or (p_assignee not in ('all','me','unassigned') and p_assignee !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or char_length(v_query)>100 then
    raise invalid_parameter_value using message='invalid_inquiry_chat_filter';
  end if;
  with base as materialized (
    select thread.id,thread.reference,thread.title,thread.category,thread.status,
      coalesce(nullif(btrim(buyer.nickname),''),'고객_'||left(buyer.id::text,6)) buyer_name,
      thread.assignee_id,coalesce(nullif(btrim(assignee.nickname),''),'운영자_'||left(assignee.id::text,6)) assignee_name,
      thread.last_message_at,coalesce(latest.body,'') preview,coalesce(latest.author,'user') preview_author,
      (select count(*) from public.inquiry_messages message
        where message.inquiry_id=thread.id and message.author='user'
          and not exists(select 1 from private.inquiry_chat_reads seen where seen.actor_id=v_actor and seen.message_id=message.id)) unread_count
    from public.inquiries thread join public.profiles buyer on buyer.id=thread.user_id
    left join public.profiles assignee on assignee.id=thread.assignee_id
    left join lateral (select left(message.body,180) body,message.author from public.inquiry_messages message
      where message.inquiry_id=thread.id order by message.created_at desc,message.id desc limit 1) latest on true
    where (p_period='all' or thread.last_message_at >= current_timestamp-case p_period when '7d' then interval '7 days' else interval '30 days' end)
      and (p_assignee='all' or (p_assignee='me' and thread.assignee_id=v_actor)
        or (p_assignee='unassigned' and thread.assignee_id is null) or thread.assignee_id::text=lower(p_assignee))
      and (v_query='' or position(lower(v_query) in lower(thread.title))>0
        or position(lower(v_query) in lower(coalesce(buyer.nickname,'')))>0
        or thread.reference::text=v_query
        or exists(select 1 from public.inquiry_messages message where message.inquiry_id=thread.id
          and position(lower(v_query) in lower(message.body))>0))
  ), filtered as materialized (
    select * from base where (p_status='all' or status=p_status)
      and (p_read='all' or (p_read='unread' and unread_count>0) or (p_read='read' and unread_count=0))
  ), page as (
    select * from filtered order by
      case when p_sort='recent' then last_message_at end desc,
      case when p_sort='oldest' then last_message_at end asc,id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(page) order by
      case when p_sort='recent' then last_message_at end desc,
      case when p_sort='oldest' then last_message_at end asc,id) from page),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'counts',(select jsonb_build_object('all',count(*),'open',count(*) filter(where status='open'),
      'answered',count(*) filter(where status='answered'),'closed',count(*) filter(where status='closed')) from base),
    'unreadMessages',(select coalesce(sum(unread_count),0) from base),
    'staffOptions',coalesce((select jsonb_agg(jsonb_build_object('id',profile.id,
      'name',coalesce(nullif(btrim(profile.nickname),''),'운영자_'||left(profile.id::text,6))) order by profile.nickname,profile.id)
      from public.profiles profile where profile.role in ('staff','admin') and profile.suspended_at is null
        and private.has_operator_capability(profile.id,'cs.manage',false)),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.admin_inquiry_chat_console(text,text,text,text,text,text,integer,integer) from public,anon,authenticated,service_role;

create function public.admin_mark_inquiry_chat_read(p_inquiry_id uuid,p_message_ids uuid[])
returns integer language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid;v_inserted integer;
begin
  v_actor:=private.require_operator_capability('cs.manage',false);
  if p_inquiry_id is null or p_message_ids is null or cardinality(p_message_ids) not between 1 and 500
    or array_position(p_message_ids,null) is not null then
    raise invalid_parameter_value using message='invalid_inquiry_chat_read';
  end if;
  if not exists(select 1 from public.inquiries where id=p_inquiry_id) then
    raise no_data_found using message='inquiry_not_found';
  end if;
  if exists(select 1 from unnest(p_message_ids) ids(id) where not exists(
    select 1 from public.inquiry_messages message where message.id=ids.id and message.inquiry_id=p_inquiry_id and message.author='user')) then
    raise invalid_parameter_value using message='invalid_inquiry_chat_message';
  end if;
  insert into private.inquiry_chat_reads(actor_id,message_id)
    select v_actor,message.id from public.inquiry_messages message
    where message.inquiry_id=p_inquiry_id and message.author='user' and message.id=any(p_message_ids)
    on conflict(actor_id,message_id) do nothing;
  get diagnostics v_inserted=row_count;
  return v_inserted;
end $$;
revoke all on function public.admin_mark_inquiry_chat_read(uuid,uuid[]) from public,anon,authenticated,service_role;

-- Use the existing trusted CS owner; never grant privileged dependencies to client roles.
do $owner$ declare owner_id oid;entry regprocedure;
begin
  select proowner into owner_id from pg_proc where oid='public.admin_inquiry_satisfaction_console(text,text,date,date,text,text,integer,integer,text)'::regprocedure;
  if owner_id is null or owner_id in ('anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid)
    or not exists(select 1 from pg_roles where oid=owner_id and (rolsuper or rolbypassrls)) then
    raise exception 'inquiry_chat_trusted_owner_required';
  end if;
  if not has_function_privilege(owner_id,'private.require_operator_capability(text,boolean)'::regprocedure,'EXECUTE')
    or not has_function_privilege(owner_id,'private.has_operator_capability(uuid,text,boolean)'::regprocedure,'EXECUTE') then
    raise exception 'inquiry_chat_dependency_denied';
  end if;
  execute format('grant select,insert on private.inquiry_chat_reads to %I',pg_get_userbyid(owner_id));
  foreach entry in array array[
    'public.admin_inquiry_chat_console(text,text,text,text,text,text,integer,integer)'::regprocedure,
    'public.admin_mark_inquiry_chat_read(uuid,uuid[])'::regprocedure
  ] loop
    execute format('alter function %s owner to %I',entry,pg_get_userbyid(owner_id));
    execute format('revoke all on function %s from public,anon,authenticated,service_role',entry);
    execute format('grant execute on function %s to authenticated,postgres',entry);
  end loop;
end $owner$;
select private.register_operator_rpc_contract('public.admin_inquiry_chat_console(text,text,text,text,text,text,integer,integer)'::regprocedure,'cs.manage','read',false);
select private.register_operator_rpc_contract('public.admin_mark_inquiry_chat_read(uuid,uuid[])'::regprocedure,'cs.manage','write',false);
notify pgrst,'reload schema';
