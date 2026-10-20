-- Private consultation tags and exact same-customer conversation history.
create table private.inquiry_chat_tags (
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  label text not null check(char_length(label) between 1 and 20 and label=btrim(label) and label !~ '[[:cntrl:]]'),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(inquiry_id,label)
);
alter table private.inquiry_chat_tags enable row level security;
revoke all on private.inquiry_chat_tags from public,anon,authenticated,service_role;

create or replace function public.admin_inquiry_chat_console(
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
      coalesce((select jsonb_agg(tag.label order by tag.label) from private.inquiry_chat_tags tag where tag.inquiry_id=thread.id),'[]'::jsonb) tags,
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
        or exists(select 1 from private.inquiry_chat_tags tag where tag.inquiry_id=thread.id and position(lower(v_query) in lower(tag.label))>0)
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

create function public.admin_inquiry_chat_context(p_inquiry_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_customer uuid;
begin
  if (select auth.uid()) is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message='operator_capability_required';end if;
  select user_id into v_customer from public.inquiries where id=p_inquiry_id;
  if not found then raise no_data_found using message='inquiry_not_found';end if;
  return jsonb_build_object('inquiryId',p_inquiry_id,
    'tags',coalesce((select jsonb_agg(label order by label) from private.inquiry_chat_tags where inquiry_id=p_inquiry_id),'[]'::jsonb),
    'previousCount',(select count(*) from public.inquiries where user_id=v_customer and id<>p_inquiry_id),
    'previous',coalesce((select jsonb_agg(jsonb_build_object('id',prior.id,'reference',prior.reference,'title',prior.title,
      'status',prior.status,'lastMessageAt',prior.last_message_at) order by prior.last_message_at desc,prior.id)
      from (select id,reference,title,status,last_message_at from public.inquiries where user_id=v_customer and id<>p_inquiry_id
        order by last_message_at desc,id limit 20) prior),'[]'::jsonb));
end $$;
revoke all on function public.admin_inquiry_chat_context(uuid) from public,anon,authenticated,service_role;

create function public.admin_update_inquiry_chat_tag(p_expected_actor_id uuid,p_inquiry_id uuid,p_label text,p_present boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid;v_label text:=btrim(coalesce(p_label,''));v_changed integer;
begin
  v_actor:=private.require_operator_capability('cs.manage',false);
  if p_expected_actor_id is distinct from v_actor then raise insufficient_privilege using message='inquiry_chat_actor_changed';end if;
  if p_inquiry_id is null or p_present is null or char_length(v_label) not between 1 and 20 or v_label ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message='invalid_inquiry_chat_tag';end if;
  perform 1 from public.inquiries where id=p_inquiry_id for update;
  if not found then raise no_data_found using message='inquiry_not_found';end if;
  if p_present then
    if not exists(select 1 from private.inquiry_chat_tags where inquiry_id=p_inquiry_id and label=v_label)
      and (select count(*) from private.inquiry_chat_tags where inquiry_id=p_inquiry_id)>=10 then
      raise check_violation using message='inquiry_chat_tag_limit';end if;
    insert into private.inquiry_chat_tags(inquiry_id,label,actor_id) values(p_inquiry_id,v_label,v_actor)
      on conflict(inquiry_id,label) do nothing;
  else
    delete from private.inquiry_chat_tags where inquiry_id=p_inquiry_id and label=v_label;
  end if;
  get diagnostics v_changed=row_count;
  if v_changed>0 then
    insert into public.audit_log(actor_id,action,target,diff) values(v_actor,'admin.inquiry.chat_tag_changed','inquiries:'||p_inquiry_id::text,
      jsonb_build_object('label',v_label,'present',p_present));
  end if;
  return public.admin_inquiry_chat_context(p_inquiry_id);
end $$;
revoke all on function public.admin_update_inquiry_chat_tag(uuid,uuid,text,boolean) from public,anon,authenticated,service_role;

do $owner$ declare owner_id oid;entry regprocedure;
begin
  select proowner into owner_id from pg_proc where oid='public.admin_inquiry_chat_console(text,text,text,text,text,text,integer,integer)'::regprocedure;
  if owner_id is null or owner_id in ('anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid)
    or not exists(select 1 from pg_roles where oid=owner_id and (rolsuper or rolbypassrls)) then raise exception 'inquiry_chat_trusted_owner_required';end if;
  execute format('grant select,insert,delete on private.inquiry_chat_tags to %I',pg_get_userbyid(owner_id));
  foreach entry in array array[
    'public.admin_inquiry_chat_context(uuid)'::regprocedure,'public.admin_update_inquiry_chat_tag(uuid,uuid,text,boolean)'::regprocedure,
    'public.admin_inquiry_chat_console(text,text,text,text,text,text,integer,integer)'::regprocedure
  ] loop
    execute format('alter function %s owner to %I',entry,pg_get_userbyid(owner_id));
    execute format('revoke all on function %s from public,anon,authenticated,service_role',entry);
    execute format('grant execute on function %s to authenticated,postgres',entry);
  end loop;
end $owner$;
select private.register_operator_rpc_contract('public.admin_inquiry_chat_console(text,text,text,text,text,text,integer,integer)'::regprocedure,'cs.manage','read',false);
select private.register_operator_rpc_contract('public.admin_inquiry_chat_context(uuid)'::regprocedure,'cs.manage','read',false);
select private.register_operator_rpc_contract('public.admin_update_inquiry_chat_tag(uuid,uuid,text,boolean)'::regprocedure,'cs.manage','write',false);
notify pgrst,'reload schema';
