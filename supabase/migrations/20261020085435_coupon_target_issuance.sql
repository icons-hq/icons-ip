begin;
CREATE FUNCTION private.issue_coupon_code(p_code text, p_user_id uuid, p_source text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare coupon public.coupons; held_id uuid; issued timestamptz; reason text;
begin
  if p_source is null or p_source not in ('code_entry','admin_grant') then raise invalid_parameter_value using message='invalid_coupon_issue_source';end if;
  perform private.assert_active_user(p_user_id);
  if private.is_account_write_fenced(p_user_id) then raise insufficient_privilege using message='account_write_fenced';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into coupon from public.coupons where code=upper(btrim(coalesce(p_code,''))) for update;
  if not found or coupon.status<>'active' then raise check_violation using message='coupon_not_found';end if;
  select id into held_id from public.user_coupons where user_id=p_user_id and coupon_code=coupon.code;
  -- An existing held coupon survives the end of the issuance period. Applying it
  -- still rechecks its own expiry, status, recipient and eligible goods.
  if held_id is not null then return held_id;end if;
  issued:=clock_timestamp();
  if issued<coalesce(coupon.issue_starts_at,coupon.starts_at) then raise check_violation using message=case when coupon.issue_starts_at is null then 'coupon_not_started' else 'coupon_issue_not_started' end;end if;
  if (case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end)<=issued then raise check_violation using message=case when coupon.issue_starts_at is null then 'coupon_expired' else 'coupon_issue_ended' end;end if;
  if coupon.ends_at is not null and coupon.ends_at<=issued then raise check_violation using message='coupon_expired';end if;
  reason:=private.coupon_recipient_reason(coupon.recipient_segment,p_user_id);
  if reason is not null then raise check_violation using message=reason;end if;
  if coupon.issue_limit is not null and coupon.issued_count>=coupon.issue_limit then raise check_violation using message='coupon_exhausted';end if;
  insert into public.user_coupons(coupon_code,user_id,issued_source,issued_at,expires_at)
    values(coupon.code,p_user_id,p_source,issued,private.coupon_issue_expiry(coupon,issued)) returning id into held_id;
  update public.coupons set issued_count=issued_count+1 where code=coupon.code;
  return held_id;
end $function$;
revoke all on function private.issue_coupon_code(text,uuid,text) from public,anon,authenticated,service_role;
create or replace function private.claim_coupon_code(p_code text,p_user_id uuid) returns uuid language plpgsql set search_path='' as $$begin return private.issue_coupon_code(p_code,p_user_id,'code_entry');end $$;

create table private.coupon_issue_batches (
 id uuid primary key,actor_id uuid not null,session_id uuid not null,coupon_code text not null references public.coupons(code),coupon_revision bigint not null,
 targets jsonb not null,user_ids uuid[] not null,segment_rule jsonb,request jsonb not null,
 status text not null check(status in ('prepared','invalid','completed','failed')),result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),valid_until timestamptz not null,finished_at timestamptz,
 execution_operation_id uuid not null unique default gen_random_uuid()
);
alter table private.coupon_issue_batches enable row level security;
revoke all on private.coupon_issue_batches from public,anon,authenticated,service_role;
create index coupon_issue_batches_code on private.coupon_issue_batches(coupon_code,created_at desc);

create function private.coupon_issue_identity(p_actor uuid,p_session uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid;begin
 actor:=private.require_operator_capability('marketing.manage',false);
 if actor is distinct from p_actor or p_session is null or auth.jwt()->>'session_id' is distinct from p_session::text
  or not exists(select 1 from auth.sessions where id=p_session and user_id=actor and (not_after is null or not_after>clock_timestamp())) then
  raise insufficient_privilege using message='coupon_issue_auth_changed';end if;return actor;
end $$;
revoke all on function private.coupon_issue_identity(uuid,uuid) from public,anon,authenticated,service_role;

create function private.coupon_issue_rows(p_coupon public.coupons,p_users uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('userId',id,'userCouponId',held_id,'reason',reason) order by id),'[]') from (
  select ids.id,(select id from public.user_coupons where coupon_code=p_coupon.code and user_id=ids.id) held_id,
   case when p.id is null or p.role<>'user' or p.suspended_at is not null or p.onboarded_at is null or p.birth_date is null
      or p.birth_date>((statement_timestamp() at time zone 'Asia/Seoul')::date-interval '14 years')::date
      or private.is_account_write_fenced(ids.id) then 'coupon_customer_unavailable'
    else private.coupon_recipient_reason(p_coupon.recipient_segment,ids.id) end reason
  from unnest(p_users) ids(id) left join public.profiles p on p.id=ids.id
 ) checked;
$$;
revoke all on function private.coupon_issue_rows(public.coupons,uuid[]) from public,anon,authenticated,service_role;

create function private.coupon_issue_batch_document(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select b.result||jsonb_build_object('canExecute',b.actor_id=auth.uid() and b.session_id::text=auth.jwt()->>'session_id' and b.status='prepared' and b.valid_until>statement_timestamp(),
  'rows',coalesce((select jsonb_agg(row.value||jsonb_build_object('nickname',coalesce(p.nickname,'현재 고객 정보 없음')) order by row.position)
   from jsonb_array_elements(b.result->'rows') with ordinality row(value,position) left join public.profiles p on p.id=(row.value->>'userId')::uuid),'[]'))
 from private.coupon_issue_batches b where b.id=p_id;
$$;
revoke all on function private.coupon_issue_batch_document(uuid) from public,anon,authenticated,service_role;

create function public.admin_find_coupon_issue_customers(p_query text) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or char_length(btrim(p_query)) not between 2 and 200 then raise invalid_parameter_value;end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'nickname',nickname,'maskedEmail',case when strpos(email,'@')>0 then left(email,1)||'***@'||split_part(email,'@',2) else '' end) order by nickname,id),'[]')
  from (select p.id,p.nickname,p.email from public.profiles p where p.role='user' and p.suspended_at is null and p.onboarded_at is not null and p.birth_date<=((statement_timestamp() at time zone 'Asia/Seoul')::date-interval '14 years')::date
   and not private.is_account_write_fenced(p.id) and (p.id::text=btrim(p_query) or lower(p.email)=lower(btrim(p_query)) or strpos(lower(p.nickname),lower(btrim(p_query)))>0)
   order by nickname,id limit 50) customers);
end $$;
revoke all on function public.admin_find_coupon_issue_customers(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_find_coupon_issue_customers(text) to authenticated;
select private.register_operator_rpc_contract('public.admin_find_coupon_issue_customers(text)'::regprocedure,'marketing.manage','read',false);

create function public.admin_preview_coupon_issue(p_id uuid,p_coupon_code text,p_targets jsonb,p_expected_actor uuid,p_expected_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;coupon public.coupons;segment private.customer_segments;batch private.coupon_issue_batches;ids uuid[];target jsonb;request jsonb;rows jsonb;result jsonb;
 needed integer;existing integer;invalid integer;issue text;at_value timestamptz:=clock_timestamp();
begin
 actor:=private.coupon_issue_identity(p_expected_actor,p_expected_session);
 if p_id is null or p_coupon_code is null or p_coupon_code!~'^[A-Z0-9][A-Z0-9-]{2,23}$' or jsonb_typeof(p_targets) is distinct from 'object' then raise invalid_parameter_value using message='invalid_coupon_issue';end if;
 if p_targets->>'kind'='customers' then
  if (select count(*) from jsonb_object_keys(p_targets))<>2 or jsonb_typeof(p_targets->'userIds') is distinct from 'array' or jsonb_array_length(p_targets->'userIds') not between 1 and 1000
   or exists(select 1 from jsonb_array_elements(p_targets->'userIds') v where jsonb_typeof(v)<>'string' or v#>>'{}'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise invalid_parameter_value using message='invalid_coupon_issue_targets';end if;
  select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(p_targets->'userIds');
  if cardinality(ids)<>(select count(distinct v) from unnest(ids) v) then raise invalid_parameter_value using message='duplicate_coupon_issue_target';end if;
  target:=jsonb_build_object('kind','customers','userIds',to_jsonb(ids));
 elsif p_targets->>'kind'='segment' then
  if (select count(*) from jsonb_object_keys(p_targets))<>3 or p_targets->>'segmentId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(p_targets->'revision') is distinct from 'number' or p_targets->>'revision'!~'^[1-9][0-9]{0,8}$' then raise invalid_parameter_value using message='invalid_coupon_issue_targets';end if;
  target:=p_targets;
 else raise invalid_parameter_value using message='invalid_coupon_issue_targets';end if;
 request:=jsonb_build_object('couponCode',p_coupon_code,'targets',target,'sessionId',p_expected_session);
 perform pg_advisory_xact_lock(hashtextextended('coupon-issue-batch:'||p_id::text,0));
 select * into batch from private.coupon_issue_batches where id=p_id;
 if found then
  if batch.actor_id<>actor or batch.request is distinct from request then raise sqlstate 'PT409' using message='coupon_issue_operation_conflict';end if;
  return private.coupon_issue_batch_document(p_id);
 end if;
 if target->>'kind'='segment' then
  select * into segment from private.customer_segments where id=(target->>'segmentId')::uuid and archived_at is null for share;
  if not found or segment.revision<>(target->>'revision')::integer or not private.customer_segment_references_available(segment.rule) then raise sqlstate 'PT409' using message='customer_segment_changed';end if;
  select coalesce(array_agg(customer_id order by customer_id),'{}') into ids from (select customer_id from private.customer_segment_members(segment.rule,at_value) order by customer_id limit 1001) members;
  if cardinality(ids)>1000 then raise program_limit_exceeded using message='coupon_issue_target_limit';end if;
 end if;
 select * into coupon from public.coupons where code=p_coupon_code for share;
 if not found or coupon.status<>'active' then raise check_violation using message='coupon_not_found';end if;
 if at_value<coalesce(coupon.issue_starts_at,coupon.starts_at) then raise check_violation using message='coupon_issue_not_started';end if;
 if (case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end)<=at_value or coupon.ends_at<=at_value then raise check_violation using message='coupon_issue_ended';end if;
 rows:=private.coupon_issue_rows(coupon,ids);
 select count(*) filter(where value->>'reason' is null and value->>'userCouponId' is null),count(*) filter(where value->>'userCouponId' is not null),count(*) filter(where value->>'reason' is not null)
  into needed,existing,invalid from jsonb_array_elements(rows);
 issue:=case when cardinality(ids)=0 then 'coupon_issue_no_targets' when invalid>0 then 'coupon_issue_invalid_targets' when coupon.issue_limit is not null and needed>coupon.issue_limit-coupon.issued_count then 'coupon_exhausted' end;
 result:=jsonb_build_object('id',p_id,'couponCode',coupon.code,'couponName',coupon.name,'couponRevision',coupon.terms_revision,'targetKind',target->>'kind',
  'segmentName',segment.name,'status',case when issue is null then 'prepared' else 'invalid' end,'targetCount',cardinality(ids),'plannedCount',needed,'existingCount',existing,'invalidCount',invalid,
  'issuedCount',0,'createdAt',at_value,'validUntil',at_value+interval '15 minutes','finishedAt',null,'error',issue,'rows',rows);
 insert into private.coupon_issue_batches(id,actor_id,session_id,coupon_code,coupon_revision,targets,user_ids,segment_rule,request,status,result,created_at,valid_until)
 values(p_id,actor,p_expected_session,coupon.code,coupon.terms_revision,target,ids,segment.rule,request,result->>'status',result,at_value,at_value+interval '15 minutes');
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.coupon.issue_previewed','coupon_issue_batch:'||p_id,jsonb_build_object('couponCode',coupon.code,'targetCount',cardinality(ids),'plannedCount',needed));
 return private.coupon_issue_batch_document(p_id);
end $$;
revoke all on function public.admin_preview_coupon_issue(uuid,text,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_coupon_issue(uuid,text,jsonb,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_preview_coupon_issue(uuid,text,jsonb,uuid,uuid)'::regprocedure,'marketing.manage','write',false);

create function public.admin_execute_coupon_issue(p_id uuid,p_expected_actor uuid,p_expected_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;batch private.coupon_issue_batches;coupon public.coupons;segment private.customer_segments;target_user uuid;held uuid;rows jsonb;row jsonb;
 eligible uuid[];needed integer;existing integer;issued integer:=0;problem text;completed jsonb:='[]';
begin
 actor:=private.coupon_issue_identity(p_expected_actor,p_expected_session);
 select * into batch from private.coupon_issue_batches where id=p_id;
 if not found or batch.actor_id<>actor or batch.session_id<>p_expected_session then raise insufficient_privilege using message='coupon_issue_batch_not_found';end if;
 if batch.status<>'prepared' then return private.coupon_issue_batch_document(p_id);end if;
 -- Match code-entry's profile -> per-user advisory -> coupon lock order.
 perform private.lock_operator_subjects(array_append(batch.user_ids,actor));
 foreach target_user in array batch.user_ids loop perform pg_advisory_xact_lock(hashtextextended(target_user::text,0));end loop;
 select * into batch from private.coupon_issue_batches where id=p_id for update;
 if batch.status<>'prepared' then return private.coupon_issue_batch_document(p_id);end if;
 begin
  if batch.valid_until<=clock_timestamp() then raise check_violation using message='coupon_issue_preview_stale';end if;
  select * into coupon from public.coupons where code=batch.coupon_code for update;
  if coupon.status<>'active' or coupon.terms_revision<>batch.coupon_revision then raise check_violation using message='coupon_issue_policy_changed';end if;
  if batch.targets->>'kind'='segment' then
   select * into segment from private.customer_segments where id=(batch.targets->>'segmentId')::uuid for share;
   if not found or segment.archived_at is not null or segment.revision<>(batch.targets->>'revision')::integer or segment.rule is distinct from batch.segment_rule or not private.customer_segment_references_available(segment.rule) then raise check_violation using message='customer_segment_changed';end if;
   select coalesce(array_agg(customer_id),'{}') into eligible from private.customer_segment_members(segment.rule,clock_timestamp()) where customer_id=any(batch.user_ids);
   if not batch.user_ids<@eligible then raise check_violation using message='coupon_issue_segment_changed';end if;
  end if;
  rows:=private.coupon_issue_rows(coupon,batch.user_ids);
  if exists(select 1 from jsonb_array_elements(rows) r where r->>'reason' is not null) then raise check_violation using message='coupon_issue_invalid_targets';end if;
  select count(*) filter(where value->>'userCouponId' is null),count(*) filter(where value->>'userCouponId' is not null) into needed,existing from jsonb_array_elements(rows);
  if coupon.issue_limit is not null and needed>coupon.issue_limit-coupon.issued_count then raise check_violation using message='coupon_exhausted';end if;
  for row in select value from jsonb_array_elements(rows) loop
   held:=(row->>'userCouponId')::uuid;
   if held is null then
    held:=private.issue_coupon_code(batch.coupon_code,(row->>'userId')::uuid,'admin_grant');issued:=issued+1;
   end if;
   completed:=completed||jsonb_build_array(row||jsonb_build_object('userCouponId',held));
  end loop;
  update private.coupon_issue_batches set status='completed',finished_at=clock_timestamp(),result=result||jsonb_build_object('status','completed','issuedCount',issued,'existingCount',existing,'finishedAt',clock_timestamp(),'rows',completed) where id=p_id;
 exception when others then
  problem:=sqlerrm;
  if problem not in ('coupon_issue_preview_stale','coupon_issue_policy_changed','customer_segment_changed','coupon_issue_segment_changed','coupon_issue_invalid_targets','coupon_exhausted','coupon_issue_not_started','coupon_issue_ended','coupon_expired','coupon_not_found','coupon_first_purchase_only','coupon_repeat_purchase_only','account_suspended','account_write_fenced') then problem:='coupon_issue_failed';end if;
  update private.coupon_issue_batches set status='failed',finished_at=clock_timestamp(),result=result||jsonb_build_object('status','failed','issuedCount',0,'error',problem,'finishedAt',clock_timestamp()) where id=p_id;
 end;
 insert into public.audit_log(id,actor_id,action,target,diff) values(batch.execution_operation_id,actor,'admin.coupon.issue_executed','coupon_issue_batch:'||p_id,
  jsonb_build_object('couponCode',batch.coupon_code,'status',(select status from private.coupon_issue_batches where id=p_id),'result',private.coupon_issue_batch_document(p_id)-'rows'));
 return private.coupon_issue_batch_document(p_id);
end $$;
revoke all on function public.admin_execute_coupon_issue(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_execute_coupon_issue(uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_execute_coupon_issue(uuid,uuid,uuid)'::regprocedure,'marketing.manage','write',false);

create function public.admin_get_coupon_issue(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return private.coupon_issue_batch_document(p_id);
end $$;
revoke all on function public.admin_get_coupon_issue(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_coupon_issue(uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_get_coupon_issue(uuid)'::regprocedure,'marketing.manage','read',false);
commit;
