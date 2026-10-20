-- Customer evaluation of the current staff inquiry answer, with independent CAS receipts.
-- No backfill, legacy function replacement, old owner/ACL/registry mutation.
create temp table inquiry_satisfaction_old_functions on commit drop as
select p.oid, pg_get_functiondef(p.oid) definition, p.proowner, p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.prokind='f';
create temp table inquiry_satisfaction_old_internal on commit drop as select * from private.operator_internal_contracts;
create temp table inquiry_satisfaction_old_rpc on commit drop as select * from private.operator_rpc_contracts;

create table private.inquiry_satisfaction_state (
 inquiry_id uuid primary key references public.inquiries(id) on delete cascade,
 latest_answer_id uuid references public.inquiry_messages(id) on delete set null,
 value_answer_id uuid,
 value text check(value in ('satisfied','dissatisfied')),
 rated_at timestamptz,
 revision bigint not null check(revision between 1 and 9007199254740991),
 updated_at timestamptz not null default clock_timestamp(),
 check((value is null and value_answer_id is null and rated_at is null)
  or (value is not null and value_answer_id is not null and rated_at is not null))
);
create table private.inquiry_satisfaction_operations (
 actor_id uuid not null references public.profiles(id) on delete cascade,
 operation_id uuid not null,
 session_id uuid not null,
 inquiry_id uuid not null references public.inquiries(id) on delete cascade,
 answer_id uuid not null,
 expected_revision bigint not null check(expected_revision between 0 and 9007199254740991),
 desired_value text check(desired_value in ('satisfied','dissatisfied')),
 request_fingerprint jsonb not null,
 before_value text check(before_value in ('satisfied','dissatisfied')),
 after_value text check(after_value in ('satisfied','dissatisfied')),
 before_revision bigint not null,
 after_revision bigint not null,
 outcome text not null check(outcome in ('changed','unchanged')),
 created_at timestamptz not null default clock_timestamp(),
 receipt jsonb not null,
 primary key(actor_id,operation_id),
 check(before_revision=expected_revision),
 check(after_value is not distinct from desired_value),
 check((outcome='changed' and before_value is distinct from after_value and after_revision=before_revision+1)
  or (outcome='unchanged' and before_value is not distinct from after_value and after_revision=before_revision))
);
create index inquiry_satisfaction_operations_history_idx on private.inquiry_satisfaction_operations(inquiry_id,created_at desc,operation_id desc);
alter table private.inquiry_satisfaction_state enable row level security;
alter table private.inquiry_satisfaction_operations enable row level security;
revoke all on private.inquiry_satisfaction_state,private.inquiry_satisfaction_operations from public,anon,authenticated,service_role;

create function private.inquiry_satisfaction_viewer() returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); session_text text:=auth.jwt()->>'session_id';
begin
 if actor is null or session_text is null or session_text!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null;end if;
 if not exists(select 1 from auth.users u join public.profiles p on p.id=u.id
  join auth.sessions s on s.user_id=u.id and s.id=session_text::uuid
  where u.id=actor and u.deleted_at is null and (s.not_after is null or s.not_after>statement_timestamp())) then return null;end if;
 return actor;
end $$;
revoke all on function private.inquiry_satisfaction_viewer() from public,anon,authenticated,service_role;

create function private.inquiry_satisfaction_active(p_actor uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select p_actor is not null and exists(select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=p_actor and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())
   and p.suspended_at is null and p.onboarded_at is not null
   and nullif(btrim(coalesce(p.email,u.email),U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),'') is not null
   and nullif(btrim(p.nickname,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),'') is not null
   and p.birth_date is not null and p.birth_date<=(statement_timestamp() at time zone 'UTC')::date
   and p.consents->'terms'='true'::jsonb and p.consents->'privacy'='true'::jsonb
   and not exists(select 1 from private.account_action_fences f where f.subject_user_id=p_actor));
$$;
revoke all on function private.inquiry_satisfaction_active(uuid) from public,anon,authenticated,service_role;

-- Pure projection. The presence of a state row permanently disables legacy fallback.
create function private.inquiry_satisfaction_current(p_inquiry_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare state private.inquiry_satisfaction_state%rowtype; answer uuid; answer_at timestamptz; current_value text; current_rated_at timestamptz; current_revision bigint:=0;
begin
 select * into state from private.inquiry_satisfaction_state where inquiry_id=p_inquiry_id;
 if found then
  current_revision:=state.revision;
  select id,created_at into answer,answer_at from public.inquiry_messages
   where id=state.latest_answer_id and inquiry_id=p_inquiry_id and author='staff';
  if answer is not null and answer=state.value_answer_id then current_value:=state.value;current_rated_at:=state.rated_at;end if;
 else
  select id,created_at into answer,answer_at from public.inquiry_messages
   where inquiry_id=p_inquiry_id and author='staff' order by created_at desc,id desc limit 1;
 end if;
 return jsonb_build_object('inquiryId',p_inquiry_id,'answerId',answer,'answerCreatedAt',answer_at,
  'value',current_value,'revision',current_revision,'ratedAt',current_rated_at);
end $$;
revoke all on function private.inquiry_satisfaction_current(uuid) from public,anon,authenticated,service_role;

create function private.inquiry_satisfaction_staff_insert() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 if new.author<>'staff' then return new;end if;
 -- No account lock here: the established staff writer already owns the parent.
 perform 1 from public.inquiries where id=new.inquiry_id for update;
 if not found then raise foreign_key_violation using message='inquiry_satisfaction_parent_missing';end if;
 insert into private.inquiry_satisfaction_state(inquiry_id,latest_answer_id,revision)
 values(new.inquiry_id,new.id,1)
 on conflict(inquiry_id) do update set latest_answer_id=excluded.latest_answer_id,
  value_answer_id=null,value=null,rated_at=null,revision=private.inquiry_satisfaction_state.revision+1,updated_at=clock_timestamp();
 return new;
end $$;
revoke all on function private.inquiry_satisfaction_staff_insert() from public,anon,authenticated,service_role;
create trigger inquiry_satisfaction_staff_insert after insert on public.inquiry_messages
 for each row when(new.author='staff') execute function private.inquiry_satisfaction_staff_insert();

create function public.get_my_inquiry_satisfaction(p_inquiry_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.inquiry_satisfaction_viewer(); current_state jsonb; active boolean; reason text;
begin
 if actor is null then raise invalid_authorization_specification using message='inquiry_satisfaction_auth_required';end if;
 if p_inquiry_id is null or not exists(select 1 from public.inquiries where id=p_inquiry_id and user_id=actor) then
  raise no_data_found using message='inquiry_satisfaction_inquiry_unavailable';end if;
 current_state:=private.inquiry_satisfaction_current(p_inquiry_id);active:=private.inquiry_satisfaction_active(actor);
 reason:=case when not active then 'account_unavailable' when current_state->>'answerId' is null then 'no_answer' else null end;
 return current_state||jsonb_build_object('actorId',actor,'sessionId',(auth.jwt()->>'session_id')::uuid,
  'canEvaluate',reason is null,'unavailableReason',reason);
end $$;
revoke all on function public.get_my_inquiry_satisfaction(uuid) from public,anon,authenticated,service_role;

-- Both write and receipt recovery wait behind the same account/operation key.
-- Recovery is read-only but VOLATILE because it takes advisory/identity row locks.
create function private.inquiry_satisfaction_request(
 p_operation_id uuid,p_inquiry_id uuid,p_expected_actor_id uuid,p_expected_session_id uuid,
 p_expected_answer_id uuid,p_expected_revision bigint,p_desired_value text,p_write boolean
) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare actor uuid:=private.inquiry_satisfaction_viewer();
begin
 if p_operation_id is null or p_inquiry_id is null or p_expected_actor_id is null or p_expected_session_id is null
  or p_expected_answer_id is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>9007199254740991
  or p_desired_value is not null and p_desired_value not in ('satisfied','dissatisfied') or p_write is null then
  raise invalid_parameter_value using message='inquiry_satisfaction_invalid_request';end if;
 if actor is null or actor<>p_expected_actor_id or (auth.jwt()->>'session_id')::uuid<>p_expected_session_id then
  raise invalid_authorization_specification using message='inquiry_satisfaction_auth_required';end if;
 perform private.lock_account_action_subject(actor);
 perform 1 from auth.users where id=actor for share nowait;
 perform 1 from public.profiles where id=actor for share nowait;
 perform 1 from auth.sessions where id=p_expected_session_id and user_id=actor for share nowait;
 if private.inquiry_satisfaction_viewer() is distinct from actor then
  raise invalid_authorization_specification using message='inquiry_satisfaction_auth_required';end if;
 if p_write and not private.inquiry_satisfaction_active(actor) then
  raise insufficient_privilege using message='inquiry_satisfaction_account_unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended('inquiry-satisfaction-operation:'||actor::text||':'||p_operation_id::text,0));
 return jsonb_build_object('operationId',p_operation_id,'inquiryId',p_inquiry_id,'expectedActorId',actor,
  'expectedSessionId',p_expected_session_id,'expectedAnswerId',p_expected_answer_id,'expectedRevision',p_expected_revision,'desiredValue',p_desired_value);
end $$;
revoke all on function private.inquiry_satisfaction_request(uuid,uuid,uuid,uuid,uuid,bigint,text,boolean) from public,anon,authenticated,service_role;

create function public.set_my_inquiry_satisfaction(
 p_operation_id uuid,p_inquiry_id uuid,p_expected_actor_id uuid,p_expected_session_id uuid,
 p_expected_answer_id uuid,p_expected_revision bigint,p_desired_value text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare fingerprint jsonb; old_operation private.inquiry_satisfaction_operations%rowtype; current_state jsonb;
 before_value text; after_revision bigint; outcome text; stamp timestamptz; receipt jsonb;
begin
 fingerprint:=private.inquiry_satisfaction_request(p_operation_id,p_inquiry_id,p_expected_actor_id,p_expected_session_id,p_expected_answer_id,p_expected_revision,p_desired_value,true);
 select * into old_operation from private.inquiry_satisfaction_operations where actor_id=p_expected_actor_id and operation_id=p_operation_id;
 if found then
  if old_operation.request_fingerprint is distinct from fingerprint then raise sqlstate 'PT409' using message='inquiry_satisfaction_operation_conflict';end if;
  return jsonb_build_object('operation','completed','receipt',old_operation.receipt,'current',public.get_my_inquiry_satisfaction(p_inquiry_id));
 end if;
 perform 1 from public.inquiries where id=p_inquiry_id and user_id=p_expected_actor_id for update nowait;
 if not found then raise no_data_found using message='inquiry_satisfaction_inquiry_unavailable';end if;
 perform 1 from private.inquiry_satisfaction_state where inquiry_id=p_inquiry_id for update nowait;
 current_state:=private.inquiry_satisfaction_current(p_inquiry_id);
 if (current_state->>'answerId')::uuid is distinct from p_expected_answer_id then raise sqlstate 'PT409' using message='inquiry_satisfaction_answer_changed';end if;
 if (current_state->>'revision')::bigint<>p_expected_revision then raise sqlstate 'PT409' using message='inquiry_satisfaction_revision_conflict';end if;
 -- Lock the current answer to prevent staff-profile/message deletion from
 -- removing it between CAS and commit; NOWAIT avoids reversing FK lock order.
 perform 1 from public.inquiry_messages where id=p_expected_answer_id and inquiry_id=p_inquiry_id and author='staff' for share nowait;
 if not found then raise sqlstate 'PT409' using message='inquiry_satisfaction_answer_changed';end if;
 stamp:=clock_timestamp();before_value:=current_state->>'value'; after_revision:=p_expected_revision;outcome:='unchanged';
 if before_value is distinct from p_desired_value then
  after_revision:=p_expected_revision+1;outcome:='changed';
  insert into private.inquiry_satisfaction_state(inquiry_id,latest_answer_id,value_answer_id,value,rated_at,revision,updated_at)
  values(p_inquiry_id,p_expected_answer_id,case when p_desired_value is null then null else p_expected_answer_id end,
   p_desired_value,case when p_desired_value is null then null else stamp end,after_revision,stamp)
  on conflict(inquiry_id) do update set latest_answer_id=excluded.latest_answer_id,value_answer_id=excluded.value_answer_id,
   value=excluded.value,rated_at=excluded.rated_at,revision=excluded.revision,updated_at=excluded.updated_at;
  -- audit_log.actor_id has a legacy NO ACTION FK. Keep the actor identifier in
  -- the minimal event payload so a new rating cannot block account FK cleanup.
  insert into public.audit_log(actor_id,action,target,diff) values(null,'inquiry.satisfaction.changed','inquiries:'||p_inquiry_id::text,
   jsonb_build_object('actorId',p_expected_actor_id,'operationId',p_operation_id,'inquiryId',p_inquiry_id,'answerId',p_expected_answer_id,
    'beforeValue',before_value,'afterValue',p_desired_value,'beforeRevision',p_expected_revision,'afterRevision',after_revision));
 end if;
 receipt:=fingerprint||jsonb_build_object('beforeValue',before_value,'afterValue',p_desired_value,'beforeRevision',p_expected_revision,
  'afterRevision',after_revision,'outcome',outcome,'createdAt',stamp);
 insert into private.inquiry_satisfaction_operations(actor_id,operation_id,session_id,inquiry_id,answer_id,expected_revision,desired_value,request_fingerprint,
  before_value,after_value,before_revision,after_revision,outcome,created_at,receipt)
 values(p_expected_actor_id,p_operation_id,p_expected_session_id,p_inquiry_id,p_expected_answer_id,p_expected_revision,p_desired_value,fingerprint,
  before_value,p_desired_value,p_expected_revision,after_revision,outcome,stamp,receipt);
 return jsonb_build_object('operation','completed','receipt',receipt,'current',public.get_my_inquiry_satisfaction(p_inquiry_id));
exception when lock_not_available then raise sqlstate 'PT409' using message='inquiry_satisfaction_retry';
end $$;
revoke all on function public.set_my_inquiry_satisfaction(uuid,uuid,uuid,uuid,uuid,bigint,text) from public,anon,authenticated,service_role;

create function public.read_my_inquiry_satisfaction_operation(
 p_operation_id uuid,p_inquiry_id uuid,p_expected_actor_id uuid,p_expected_session_id uuid,
 p_expected_answer_id uuid,p_expected_revision bigint,p_desired_value text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare fingerprint jsonb; old_operation private.inquiry_satisfaction_operations%rowtype; current_state jsonb;
begin
 fingerprint:=private.inquiry_satisfaction_request(p_operation_id,p_inquiry_id,p_expected_actor_id,p_expected_session_id,p_expected_answer_id,p_expected_revision,p_desired_value,false);
 current_state:=public.get_my_inquiry_satisfaction(p_inquiry_id);
 select * into old_operation from private.inquiry_satisfaction_operations where actor_id=p_expected_actor_id and operation_id=p_operation_id;
 if found then
  if old_operation.request_fingerprint is distinct from fingerprint then raise sqlstate 'PT409' using message='inquiry_satisfaction_operation_conflict';end if;
  return jsonb_build_object('operation','completed','receipt',old_operation.receipt,'current',current_state);
 end if;
 return jsonb_build_object('operation','unresolved','receipt',null,'current',current_state);
exception when lock_not_available then raise sqlstate 'PT409' using message='inquiry_satisfaction_retry';
end $$;
revoke all on function public.read_my_inquiry_satisfaction_operation(uuid,uuid,uuid,uuid,uuid,bigint,text) from public,anon,authenticated,service_role;

create function public.admin_inquiry_satisfaction_console(
 p_status text default null,p_category text default null,p_from date default null,p_to date default null,
 p_query text default null,p_field text default 'all',p_limit integer default 20,p_offset integer default 0,p_satisfaction text default 'all'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_query text:=nullif(btrim(coalesce(p_query,'')),'');v_field text:=coalesce(nullif(btrim(coalesce(p_field,'')),''),'all');
 v_limit integer:=least(greatest(coalesce(p_limit,20),1),100);v_offset integer:=greatest(coalesce(p_offset,0),0);result jsonb;
begin
 if auth.uid() is null or not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_status is not null and p_status not in ('open','answered','closed') then raise check_violation using message='invalid_inquiry_status_filter';end if;
 if p_category is not null and p_category not in ('order','claim','good','account','etc') then raise check_violation using message='invalid_inquiry_category_filter';end if;
 if v_field not in ('all','title','buyer','order') then raise check_violation using message='invalid_inquiry_search_field';end if;
 if p_from is not null and p_to is not null and p_from>p_to then raise check_violation using message='invalid_inquiry_date_range';end if;
 if v_query is not null and char_length(v_query)>100 then raise check_violation using message='inquiry_search_query_too_long';end if;
 if p_satisfaction is null or p_satisfaction not in ('all','satisfied','dissatisfied','unrated') then raise check_violation using message='invalid_inquiry_satisfaction_filter';end if;
 with base as materialized (
  select thread.id,thread.reference,thread.category,thread.title,thread.status,thread.user_id,buyer.nickname buyer_name,buyer.email buyer_email,
   case when public.has_operator_capability('sales.read') then thread.order_id else null::uuid end order_id,
   thread.good_id,good.name good_name,thread.handled_by,handler.nickname handler_name,thread.created_at,thread.last_message_at,thread.answered_at,thread.closed_at,
   (select count(*) from public.inquiry_messages message where message.inquiry_id=thread.id) message_count,
   thread.assignee_id,case when assignee.id is null then null else coalesce(nullif(btrim(assignee.nickname),''),'운영자_'||left(assignee.id::text,6)) end assignee_name,
   thread.waiting_since,private.inquiry_satisfaction_current(thread.id)->>'value' satisfaction
  from public.inquiries thread join public.profiles buyer on buyer.id=thread.user_id
  left join public.profiles handler on handler.id=thread.handled_by left join public.profiles assignee on assignee.id=thread.assignee_id
  left join public.goods good on good.id=thread.good_id
  where (p_status is null or thread.status=p_status) and (p_category is null or thread.category=p_category)
   and (p_from is null or thread.created_at>=(p_from::timestamp at time zone 'Asia/Seoul'))
   and (p_to is null or thread.created_at<((p_to+1)::timestamp at time zone 'Asia/Seoul'))
   and (v_query is null
    or (v_field in ('all','title') and position(lower(v_query) in lower(thread.title))>0)
    or (v_field in ('all','buyer') and (position(lower(v_query) in lower(coalesce(buyer.nickname,'')))>0 or position(lower(v_query) in lower(coalesce(buyer.email,'')))>0))
    or (v_field in ('all','order') and public.has_operator_capability('sales.read') and (position(lower(v_query) in lower(coalesce(thread.order_id::text,'')))>0 or lower(v_query)=lower(thread.reference::text))))
 ), filtered as materialized (select * from base where p_satisfaction='all' or coalesce(satisfaction,'unrated')=p_satisfaction),
 page as (select * from filtered order by case status when 'open' then 0 when 'answered' then 1 else 2 end,
  case when status='open' then waiting_since else last_message_at end,id limit v_limit offset v_offset)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page) order by case status when 'open' then 0 when 'answered' then 1 else 2 end,
   case when status='open' then waiting_since else last_message_at end,id) from page),'[]'::jsonb),
  'total',(select count(*) from filtered),'summary',(select jsonb_build_object('satisfied',count(*) filter(where satisfaction='satisfied'),
   'dissatisfied',count(*) filter(where satisfaction='dissatisfied'),'unrated',count(*) filter(where satisfaction is null)) from base)) into result;
 return result;
end $$;
revoke all on function public.admin_inquiry_satisfaction_console(text,text,date,date,text,text,integer,integer,text) from public,anon,authenticated,service_role;

create function public.admin_inquiry_satisfaction_detail(p_inquiry_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if not exists(select 1 from public.inquiries where id=p_inquiry_id) then raise no_data_found using message='inquiry_satisfaction_inquiry_unavailable';end if;
 return jsonb_build_object('current',private.inquiry_satisfaction_current(p_inquiry_id),'history',coalesce((
  select jsonb_agg(jsonb_build_object('operationId',o.operation_id,'answerId',o.answer_id,'beforeValue',o.before_value,'afterValue',o.after_value,
   'beforeRevision',o.before_revision,'afterRevision',o.after_revision,'outcome',o.outcome,'createdAt',o.created_at) order by o.created_at desc,o.operation_id desc)
  from (select * from private.inquiry_satisfaction_operations where inquiry_id=p_inquiry_id order by created_at desc,operation_id desc limit 20) o),'[]'::jsonb));
end $$;
revoke all on function public.admin_inquiry_satisfaction_detail(uuid) from public,anon,authenticated,service_role;

-- Resolve actual trusted owners; do not broaden any existing dependency ACL.
do $owners$ declare customer_owner oid;admin_owner oid;owner_id oid;entry record;relation text;
begin
 select proowner into customer_owner from pg_proc where oid='public.set_review_helpful(text,uuid,boolean)'::regprocedure;
 select proowner into admin_owner from pg_proc where oid='public.admin_search_inquiries(text,text,date,date,text,text,integer,integer)'::regprocedure;
 foreach owner_id in array array[customer_owner,admin_owner] loop
  if owner_id is null or owner_id in ('anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid)
   or not exists(select 1 from pg_roles where oid=owner_id and (rolsuper or rolbypassrls)) then raise exception 'inquiry_satisfaction_trusted_owner_required';end if;
  if not has_schema_privilege(owner_id,'private','USAGE') or not has_schema_privilege(owner_id,'public','USAGE')
   or not has_schema_privilege(owner_id,'auth','USAGE')
   or not has_function_privilege(owner_id,'auth.uid()'::regprocedure,'EXECUTE')
   or not has_function_privilege(owner_id,'auth.jwt()'::regprocedure,'EXECUTE') then raise exception 'inquiry_satisfaction_dependency_schema_denied';end if;
  foreach relation in array array['public.inquiries','public.inquiry_messages','public.profiles'] loop
   if not has_table_privilege(owner_id,relation,'SELECT') then raise exception 'inquiry_satisfaction_dependency_select_denied: %',relation;end if;
  end loop;
 end loop;
 foreach relation in array array['auth.users','auth.sessions','private.account_action_fences'] loop
  if not has_table_privilege(customer_owner,relation,'SELECT') then raise exception 'inquiry_satisfaction_customer_dependency_denied: %',relation;end if;
 end loop;
 -- PostgreSQL row locks need UPDATE privileges even when the helper performs no UPDATE.
 foreach relation in array array['auth.users','auth.sessions','public.profiles','public.inquiries','public.inquiry_messages'] loop
  if not has_table_privilege(customer_owner,relation,'UPDATE') then raise exception 'inquiry_satisfaction_lock_dependency_denied: %',relation;end if;
 end loop;
 if not has_table_privilege(customer_owner,'public.audit_log','INSERT')
  or not has_function_privilege(customer_owner,'private.lock_account_action_subject(uuid)'::regprocedure,'EXECUTE')
  or not has_function_privilege(admin_owner,'public.has_operator_capability(text,boolean)'::regprocedure,'EXECUTE')
  or not has_table_privilege(admin_owner,'public.goods','SELECT') then raise exception 'inquiry_satisfaction_dependency_execute_denied';end if;
 execute format('grant select,insert,update on private.inquiry_satisfaction_state to %I',pg_get_userbyid(customer_owner));
 execute format('grant select,insert on private.inquiry_satisfaction_operations to %I',pg_get_userbyid(customer_owner));
 execute format('grant select on private.inquiry_satisfaction_state,private.inquiry_satisfaction_operations to %I',pg_get_userbyid(admin_owner));
 for entry in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.oid not in (select oid from inquiry_satisfaction_old_functions) and (
   (n.nspname='private' and p.proname in ('inquiry_satisfaction_viewer','inquiry_satisfaction_active','inquiry_satisfaction_current','inquiry_satisfaction_staff_insert','inquiry_satisfaction_request'))
   or (n.nspname='public' and p.proname in ('get_my_inquiry_satisfaction','set_my_inquiry_satisfaction','read_my_inquiry_satisfaction_operation','admin_inquiry_satisfaction_console','admin_inquiry_satisfaction_detail'))) loop
  owner_id:=case when entry.proname like 'admin_%' then admin_owner else customer_owner end;
  execute format('alter function %s owner to %I',entry.signature,pg_get_userbyid(owner_id));
  execute format('revoke all on function %s from public,anon,authenticated,service_role',entry.signature);
  execute format('grant execute on function %s to postgres',entry.signature);
  if entry.nspname='public' then execute format('grant execute on function %s to authenticated',entry.signature);end if;
 end loop;
 execute format('grant execute on function private.inquiry_satisfaction_current(uuid) to %I',pg_get_userbyid(admin_owner));
end $owners$;

select private.register_operator_internal_contract('private.inquiry_satisfaction_viewer()'::regprocedure);
select private.register_operator_internal_contract('private.inquiry_satisfaction_active(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.inquiry_satisfaction_current(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.inquiry_satisfaction_staff_insert()'::regprocedure);
select private.register_operator_internal_contract('private.inquiry_satisfaction_request(uuid,uuid,uuid,uuid,uuid,bigint,text,boolean)'::regprocedure);
select private.register_operator_internal_contract('public.get_my_inquiry_satisfaction(uuid)'::regprocedure);
select private.register_operator_internal_contract('public.set_my_inquiry_satisfaction(uuid,uuid,uuid,uuid,uuid,bigint,text)'::regprocedure);
select private.register_operator_internal_contract('public.read_my_inquiry_satisfaction_operation(uuid,uuid,uuid,uuid,uuid,bigint,text)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_inquiry_satisfaction_console(text,text,date,date,text,text,integer,integer,text)'::regprocedure,'cs.manage','read',false);
select private.register_operator_rpc_contract('public.admin_inquiry_satisfaction_detail(uuid)'::regprocedure,'cs.manage','read',false);

do $unchanged$ begin
 if exists(select 1 from inquiry_satisfaction_old_functions old left join pg_proc p on p.oid=old.oid
  where p.oid is null or old.definition is distinct from pg_get_functiondef(p.oid) or old.proowner is distinct from p.proowner or old.proacl is distinct from p.proacl)
  or exists(select * from inquiry_satisfaction_old_internal except select * from private.operator_internal_contracts)
  or exists(select * from inquiry_satisfaction_old_rpc except select * from private.operator_rpc_contracts) then
  raise exception 'inquiry_satisfaction_existing_contract_changed';end if;
end $unchanged$;
notify pgrst,'reload schema';
