-- #494. Customer-authored order notices, separate from internal dispatch notes.
-- This migration does not enable the existing email dispatcher or any provider.
create table private.order_delay_notice_delivery_control (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 changed_at timestamptz not null default now()
);
insert into private.order_delay_notice_delivery_control(singleton) values(true);
alter table private.order_delay_notice_delivery_control enable row level security;
revoke all on private.order_delay_notice_delivery_control from public,anon,authenticated,service_role;
create table private.order_delay_notices (
 id uuid primary key,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 shipment_ids uuid[] not null check(cardinality(shipment_ids) between 1 and 100),
 title text not null check(length(title) between 1 and 80 and title !~ '[[:cntrl:]]'),
 customer_body text not null check(length(customer_body) between 1 and 350),
 expected_ship_date date,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '1 hour',
 requested_at timestamptz
);
create table private.order_delay_notice_targets (
 id uuid primary key default extensions.gen_random_uuid(),
 notice_id uuid not null references private.order_delay_notices(id) on delete restrict,
 order_id uuid not null references public.orders(id) on delete restrict,
 buyer_id uuid not null references public.profiles(id) on delete restrict,
 recipient_email text,
 buyer_name text not null,
 shipment_ids uuid[] not null,
 shipment_labels text[] not null,
 snapshot jsonb not null,
 message_body text not null check(length(message_body) between 1 and 500),
 in_app_status text not null default 'prepared' check(in_app_status in ('prepared','sent')),
 notification_id uuid,
 email_status text not null default 'prepared' check(email_status in ('prepared','queued','processing','sent','failed','unknown','suppressed')),
 email_intent_id uuid unique references private.email_intents(id) on delete restrict,
 error_code text,
 retryable boolean not null default false,
 claim_token uuid,
 lease_until timestamptz,
 available_at timestamptz,
 attempts integer not null default 0 check(attempts between 0 and 100),
 updated_at timestamptz not null default now(),
 unique(notice_id,order_id)
);
create index order_delay_notice_jobs_idx on private.order_delay_notice_targets(available_at,id)
 where email_status in ('queued','processing','unknown');
alter table private.order_delay_notices enable row level security;
alter table private.order_delay_notice_targets enable row level security;
revoke all on private.order_delay_notices,private.order_delay_notice_targets from public,anon,authenticated,service_role;

-- Preserve all #191 digests, fences, leases, provider events, recovery and dark gates.
alter table private.email_intents drop constraint email_intents_source_check;
alter table private.email_intents add constraint email_intents_source_check check(source in ('auth_hook','account_deletion','order_delay_notice'));
alter table private.email_intents drop constraint email_intents_message_kind_check;
alter table private.email_intents add constraint email_intents_message_kind_check check(message_kind in (
 'auth_signup','auth_recovery','auth_email_change_current','auth_email_change_new','auth_reauthentication','account_deletion_notice','order_delay_notice'));
alter table private.email_intent_fences drop constraint email_intent_fences_source_check;
alter table private.email_intent_fences add constraint email_intent_fences_source_check check(source in ('auth_hook','account_deletion','order_delay_notice'));

create or replace function public.enqueue_email_intent(target_source text,target_source_reference_digest text,target_recipient_digest text,target_message_kind text,target_content_revision text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare source_digest bytea:=private.email_digest_from_hex(target_source_reference_digest);
 recipient_digest bytea:=private.email_digest_from_hex(target_recipient_digest);intent private.email_intents%rowtype;created boolean:=false;
begin
 if target_source not in ('auth_hook','account_deletion','order_delay_notice') then raise check_violation using message='invalid_email_source';end if;
 if target_message_kind not in ('auth_signup','auth_recovery','auth_email_change_current','auth_email_change_new','auth_reauthentication','account_deletion_notice','order_delay_notice')
 then raise check_violation using message='invalid_email_message_kind';end if;
 if (target_source='order_delay_notice') is distinct from (target_message_kind='order_delay_notice') then raise check_violation using message='invalid_email_message_kind';end if;
 if target_content_revision is null or target_content_revision !~ '^[a-z0-9_]{1,80}$' then raise check_violation using message='invalid_email_content_revision';end if;
 perform pg_advisory_xact_lock(hashtextextended('email_intent:'||target_source||':'||encode(source_digest,'hex'),0));
 select * into intent from private.email_intents i where i.source=target_source and i.source_reference_digest=source_digest for update;
 if found then
  if intent.recipient_digest is distinct from recipient_digest or intent.message_kind is distinct from target_message_kind or intent.content_revision is distinct from target_content_revision
   then raise unique_violation using message='email_intent_idempotency_conflict';end if;
 else
  insert into private.email_intents(source,source_reference_digest,recipient_digest,message_kind,content_revision)
   values(target_source,source_digest,recipient_digest,target_message_kind,target_content_revision) returning * into intent;created:=true;
 end if;
 insert into private.email_intent_fences(intent_id,source,source_reference_digest) values(intent.id,intent.source,intent.source_reference_digest) on conflict(intent_id) do nothing;
 if not exists(select 1 from private.email_intent_fences f where f.intent_id=intent.id and f.source=intent.source and f.source_reference_digest=intent.source_reference_digest)
  then raise integrity_constraint_violation using message='email_intent_fence_missing';end if;
 return jsonb_build_object('kind',case when created then 'enqueued' else 'existing' end,'intentId',intent.id,'idempotencyKey',intent.idempotency_key,'state',intent.state);
end $$;
revoke all on function public.enqueue_email_intent(text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_email_intent(text,text,text,text,text) to service_role;

-- #191 auth/deletion activation remains unchanged. Order notices have a narrow,
-- independently approved default-off gate and still use every dispatch fence.
create or replace function public.claim_email_intent_dispatch(target_intent_id uuid,target_recipient_digest text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_control private.email_dispatch_control%rowtype;v_intent private.email_intents%rowtype;
 v_recipient_digest bytea:=private.email_digest_from_hex(target_recipient_digest);v_claim_id uuid;v_delay_enabled boolean;
begin
 select * into strict v_control from private.email_dispatch_control where singleton for share;
 select enabled into strict v_delay_enabled from private.order_delay_notice_delivery_control where singleton for share;
 select * into v_intent from private.email_intents where id=target_intent_id for update;
 if not found then raise no_data_found using message='email_intent_not_found';end if;
 if v_intent.recipient_digest is distinct from v_recipient_digest then raise check_violation using message='email_intent_recipient_mismatch';end if;
 if not exists(select 1 from private.email_intent_fences where intent_id=v_intent.id) then raise object_not_in_prerequisite_state using message='email_intent_fence_missing';end if;
 if not (case when v_intent.source='order_delay_notice' then v_delay_enabled else v_control.enabled end)
  then return jsonb_build_object('kind','disabled','state',v_intent.state);end if;
 if v_intent.state in ('accepted','sent','delivered','delayed','bounced','complained','suppressed','failed')
  then return jsonb_build_object('kind','already_dispatched','state',v_intent.state);end if;
 if v_intent.state='needs_review' then return jsonb_build_object('kind','needs_review','state',v_intent.state);end if;
 if v_intent.idempotency_expires_at is not null and now()+interval '5 minutes'>=v_intent.idempotency_expires_at then
  update private.email_intents set state='needs_review',updated_at=now() where id=v_intent.id;
  return jsonb_build_object('kind','needs_review','state','needs_review');
 end if;
 if v_intent.state='dispatching' and v_intent.claimed_at>now()-interval '10 minutes'
  then return jsonb_build_object('kind','in_progress','state',v_intent.state);end if;
 if v_intent.attempt_count>=100 then
  update private.email_intents set state='needs_review',updated_at=now() where id=v_intent.id;
  return jsonb_build_object('kind','needs_review','state','needs_review');
 end if;
 v_claim_id:=extensions.gen_random_uuid();
 update private.email_intents set state='dispatching',dispatch_claim_id=v_claim_id,attempt_count=attempt_count+1,claimed_at=now(),
  first_dispatched_at=coalesce(first_dispatched_at,now()),idempotency_expires_at=coalesce(idempotency_expires_at,now()+interval '24 hours'),updated_at=now()
  where id=v_intent.id returning * into v_intent;
 return jsonb_build_object('kind','claimed','intentId',v_intent.id,'claimId',v_intent.dispatch_claim_id,'idempotencyKey',v_intent.idempotency_key);
end $$;
revoke all on function public.claim_email_intent_dispatch(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_email_intent_dispatch(uuid,text) to service_role;

-- Customer service evidence has the order's retention contract. Generic Auth
-- email cleanup must not erase the fence referenced by an auditable notice.
create or replace function private.destroy_email_dispatch_evidence(p_before timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare ids uuid[]:='{}';event_count integer:=0;fence_count integer:=0;intent_count integer:=0;
begin
 if p_before is null or p_before>now()-interval '24 hours' then raise check_violation using message='invalid_email_retention_cutoff';end if;
 if not exists(select 1 from private.email_dispatch_control where singleton and privacy_retention_ready)
  then raise object_not_in_prerequisite_state using message='email_retention_policy_not_ready';end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into ids from private.email_intents
  where updated_at<p_before and state in ('delivered','bounced','complained','suppressed','failed')
   and source not in ('account_deletion','order_delay_notice');
 delete from private.email_provider_events where intent_id=any(ids) or intent_id is null and received_at<p_before;get diagnostics event_count=row_count;
 delete from private.email_intent_fences where intent_id=any(ids);get diagnostics fence_count=row_count;
 delete from private.email_intents where id=any(ids);get diagnostics intent_count=row_count;
 return jsonb_build_object('eventsDestroyed',event_count,'fencesDestroyed',fence_count,'intentsDestroyed',intent_count);
end $$;
revoke all on function private.destroy_email_dispatch_evidence(timestamptz) from public,anon,authenticated,service_role;

-- Same order-first lock order as dispatch/cancel. No provider call holds a DB lock.
create function private.lock_order_delay_notice_target(target_order uuid,target_shipments uuid[])
returns void language plpgsql volatile security definer set search_path='' as $$
begin
 perform 1 from public.orders where id=target_order for update;
 perform 1 from public.profiles where id=(select user_id from public.orders where id=target_order) for share;
 perform 1 from public.order_shipments where order_id=target_order and id=any(target_shipments) order by id for update;
 perform 1 from public.order_dispatch_delays where order_id=target_order for share;
end $$;

-- Only IDs/timestamps/contract dates are copied; internal free text never enters the notice.
create function private.order_delay_notice_snapshot(target_order uuid,target_shipments uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('orderUpdatedAt',o.updated_at,'orderStatus',o.status,'buyerId',o.user_id,'delayUpdatedAt',d.updated_at,
  'delayRevision',encode(extensions.digest(coalesce(d.reason,'')||coalesce(d.expected_ship_date::text,''),'sha256'),'hex'),
  'shipments',(select jsonb_agg(jsonb_build_object('id',s.id,'updatedAt',s.updated_at,'expectedShipDate',s.expected_ship_date) order by s.id)
    from public.order_shipments s where s.order_id=o.id and s.id=any(target_shipments)))
 from public.orders o left join public.order_dispatch_delays d on d.order_id=o.id
 where o.id=target_order and o.status in ('confirmed','shipping')
  and not exists(select 1 from public.order_cancellation_claims c where c.order_id=o.id)
  and not exists(select 1 from public.order_cancellation_requests c where c.order_id=o.id and c.status in ('requested','processing','needs_review'))
  and cardinality(target_shipments)>0
  and (select count(*) from public.order_shipments s where s.order_id=o.id and s.id=any(target_shipments)
    and s.status='ready' and case when s.original_expected_ship_date is not null
      then s.expected_ship_date<(statement_timestamp() at time zone 'Asia/Seoul')::date
      else o.confirmed_at<now()-interval '3 days' end)=cardinality(target_shipments)
$$;

create function private.order_delay_notice_target_current(target_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(t.snapshot=private.order_delay_notice_snapshot(t.order_id,t.shipment_ids)
   and t.buyer_id=o.user_id
   and t.recipient_email is not distinct from nullif(lower(btrim(p.email)),'')
   and (n.expected_ship_date is null or n.expected_ship_date>=(statement_timestamp() at time zone 'Asia/Seoul')::date),false)
 from private.order_delay_notice_targets t join private.order_delay_notices n on n.id=t.notice_id
 join public.orders o on o.id=t.order_id join public.profiles p on p.id=o.user_id where t.id=target_id
$$;

create function public.admin_get_order_delay_notice(target_notice uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 select jsonb_build_object('id',n.id,'title',n.title,'customerBody',n.customer_body,'expectedShipDate',n.expected_ship_date,
  'createdAt',n.created_at,'expiresAt',n.expires_at,'requestedAt',n.requested_at,
  'emailEnabled',(select enabled from private.order_delay_notice_delivery_control where singleton),'targets',coalesce((
   select jsonb_agg(jsonb_build_object('id',t.id,'orderId',t.order_id,'buyerName',t.buyer_name,'recipientEmail',t.recipient_email,
    'shipmentIds',t.shipment_ids,'shipmentLabels',t.shipment_labels,'messageBody',t.message_body,'inAppStatus',t.in_app_status,
    'emailStatus',case when i.state in ('accepted','sent','delivered','delayed') then 'sent'
      when i.state in ('bounced','complained','failed') then 'failed' when i.state='suppressed' then 'suppressed' else t.email_status end,
    'emailProviderState',i.state,'errorCode',case when i.state in ('bounced','complained','failed') then 'provider_rejected'
      when i.state='suppressed' then 'provider_suppressed' else t.error_code end,
    'retryable',t.retryable and coalesce(i.accepted_at is null,true) and coalesce(i.state not in ('needs_review','failed','bounced','complained','suppressed'),true),
    'attempts',t.attempts) order by t.order_id)
   from private.order_delay_notice_targets t left join private.email_intents i on i.id=t.email_intent_id where t.notice_id=n.id),'[]'))
 into result from private.order_delay_notices n where n.id=target_notice;
 if result is null then raise no_data_found using message='delay_notice_not_found';end if;
 return result;
end $$;

create function public.admin_prepare_order_delay_notice(target_notice uuid,target_shipments uuid[],customer_title text,customer_body text,expected_ship_date date default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());ids uuid[];n private.order_delay_notices%rowtype;g record;v_snapshot jsonb;
 email text;buyer uuid;buyer_name text;labels text[];message text;
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 if target_notice is null or target_shipments is null or cardinality(target_shipments) not between 1 and 100
  or array_position(target_shipments,null) is not null or length(btrim(customer_title)) not between 1 and 80
  or customer_title is null or customer_title ~ '[[:cntrl:]]' or customer_body is null or length(btrim(customer_body)) not between 1 and 350
  or expected_ship_date<(statement_timestamp() at time zone 'Asia/Seoul')::date
 then raise invalid_parameter_value using message='invalid_delay_notice';end if;
 select array_agg(distinct x order by x) into ids from unnest(target_shipments)x;
 perform pg_advisory_xact_lock(hashtextextended('order_delay_notice:'||target_notice::text,0));
 select * into n from private.order_delay_notices where id=target_notice for update;
 if found then
  if n.actor_id<>actor or n.shipment_ids<>ids or n.title<>btrim(customer_title) or n.customer_body<>btrim(customer_body)
    or n.expected_ship_date is distinct from expected_ship_date then raise unique_violation using message='delay_notice_idempotency_conflict';end if;
  return public.admin_get_order_delay_notice(target_notice);
 end if;
 if (select count(*) from public.order_shipments where id=any(ids))<>cardinality(ids) then raise check_violation using message='delay_notice_ineligible';end if;
 insert into private.order_delay_notices(id,actor_id,shipment_ids,title,customer_body,expected_ship_date)
  values(target_notice,actor,ids,btrim(customer_title),btrim(customer_body),expected_ship_date);
 for g in select order_id,array_agg(id order by id) shipment_ids from public.order_shipments where id=any(ids) group by order_id order by order_id loop
  perform private.lock_order_delay_notice_target(g.order_id,g.shipment_ids);
  v_snapshot:=private.order_delay_notice_snapshot(g.order_id,g.shipment_ids);
  if v_snapshot is null then raise check_violation using message='delay_notice_ineligible';end if;
  select o.user_id,nullif(lower(btrim(p.email)),''),coalesce(nullif(p.nickname,''),'구매자') into buyer,email,buyer_name
   from public.orders o join public.profiles p on p.id=o.user_id where o.id=g.order_id;
  select array_agg(origin_name_snapshot||' · '||upper(right(id::text,8)) order by id) into labels from public.order_shipments where id=any(g.shipment_ids);
  message:=btrim(customer_body)||E'\n\n발송 예정일: '||coalesce(to_char(expected_ship_date,'YYYY-MM-DD'),'확인 중')||
   E'\n안내 대상 배송 건: '||(select string_agg(upper(right(x::text,8)),', ' order by x) from unnest(g.shipment_ids[1:3])x)||
   case when cardinality(g.shipment_ids)>3 then ' 외 '||(cardinality(g.shipment_ids)-3)::text||'건' else '' end;
  insert into private.order_delay_notice_targets(notice_id,order_id,buyer_id,recipient_email,buyer_name,shipment_ids,shipment_labels,snapshot,message_body,email_status,error_code)
   values(target_notice,g.order_id,buyer,email,buyer_name,g.shipment_ids,labels,v_snapshot,message,
    case when email is null or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'suppressed' else 'prepared' end,
    case when email is null or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'recipient_missing' else null end);
 end loop;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.delay_notice_prepared','delay_notice:'||target_notice,
  jsonb_build_object('orders',(select count(*) from private.order_delay_notice_targets where notice_id=target_notice),'shipments',cardinality(ids),'channels',jsonb_build_array('in_app','email')));
 return public.admin_get_order_delay_notice(target_notice);
end $$;

create function public.admin_request_order_delay_notice(target_notice uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());n private.order_delay_notices%rowtype;t private.order_delay_notice_targets%rowtype;notification uuid;
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 select * into n from private.order_delay_notices where id=target_notice for update;
 if not found then raise no_data_found using message='delay_notice_not_found';end if;
 if n.requested_at is not null then return public.admin_get_order_delay_notice(target_notice);end if;
 if not (select enabled from private.order_delay_notice_delivery_control where singleton) then raise check_violation using message='delay_notice_delivery_disabled';end if;
 if n.expires_at<now() then raise check_violation using message='delay_notice_expired';end if;
 for t in select * from private.order_delay_notice_targets where notice_id=n.id order by order_id for update loop
  perform private.lock_order_delay_notice_target(t.order_id,t.shipment_ids);
  if not private.order_delay_notice_target_current(t.id) then raise check_violation using message='delay_notice_stale';end if;
  insert into public.notifications(user_id,type,title,body,link_path,source_type,source_id,dedupe_key)
   values(t.buyer_id,'announcement',n.title,t.message_body,'/orders/'||t.order_id,'order_delay_notice',t.id::text,'order_delay_notice:'||t.id)
   on conflict(user_id,dedupe_key) do nothing returning id into notification;
  update private.order_delay_notice_targets set in_app_status='sent',notification_id=notification,
   email_status=case when recipient_email is null or recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'suppressed' else 'queued' end,
   error_code=case when recipient_email is null or recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'recipient_missing' else null end,
   available_at=now(),updated_at=now() where id=t.id;
 end loop;
 update private.order_delay_notices set requested_at=now() where id=n.id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.delay_notice_requested','delay_notice:'||n.id,
  jsonb_build_object('orders',(select count(*) from private.order_delay_notice_targets where notice_id=n.id),'channels',jsonb_build_array('in_app','email')));
 return public.admin_get_order_delay_notice(n.id);
end $$;

create function public.admin_list_order_delay_notices(target_order uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'createdAt',n.created_at,'requestedAt',n.requested_at) order by n.created_at desc)
 from (select n.* from private.order_delay_notices n where target_order is null or exists(select 1 from private.order_delay_notice_targets t where t.notice_id=n.id and t.order_id=target_order)
 order by n.created_at desc limit 30)n),'[]');
end $$;

create function public.admin_retry_order_delay_notice(target_notice uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());t private.order_delay_notice_targets%rowtype;i private.email_intents%rowtype;retried integer:=0;
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 if not (select enabled from private.order_delay_notice_delivery_control where singleton) then raise check_violation using message='delay_notice_delivery_disabled';end if;
 perform 1 from private.order_delay_notices where id=target_notice and requested_at is not null for update;
 if not found then raise no_data_found using message='delay_notice_not_found';end if;
 for t in select * from private.order_delay_notice_targets where notice_id=target_notice and email_status='failed' and retryable order by order_id for update loop
  select * into i from private.email_intents where id=t.email_intent_id for update;
  if i.id is not null and i.idempotency_expires_at<=now()+interval '5 minutes' and i.accepted_at is null then
   update private.order_delay_notice_targets set email_status='unknown',error_code='delivery_needs_review',retryable=false,available_at=null,updated_at=now() where id=t.id;
   continue;
  end if;
  if i.id is not null and (i.accepted_at is not null or i.state not in ('queued','unknown')) then continue;end if;
  perform private.lock_order_delay_notice_target(t.order_id,t.shipment_ids);
  if not private.order_delay_notice_target_current(t.id) then
   update private.order_delay_notice_targets set email_status=case when coalesce(i.attempt_count,0)>0 then 'unknown' else 'suppressed' end,
    error_code='target_changed',retryable=false,available_at=null,updated_at=now() where id=t.id;
  else
   update private.order_delay_notice_targets set email_status='queued',retryable=false,available_at=now(),error_code=null,updated_at=now() where id=t.id;retried:=retried+1;
  end if;
 end loop;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.delay_notice_retried','delay_notice:'||target_notice,jsonb_build_object('queuedEmails',retried));
 return public.admin_get_order_delay_notice(target_notice);
end $$;

create function public.claim_order_delay_email_jobs(batch_limit integer default 25)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 if batch_limit is null or batch_limit not between 1 and 25 then raise invalid_parameter_value using message='invalid_delay_email_batch';end if;
 update private.order_delay_notice_targets set email_status='unknown',error_code='delivery_needs_review',retryable=false,available_at=null,lease_until=null,claim_token=null
  where email_status in ('queued','processing','unknown') and attempts>=100 and (lease_until is null or lease_until<now());
 with selected as (select t.id from private.order_delay_notice_targets t
   where t.attempts<100 and ((t.email_status in ('queued','unknown') and t.available_at<=now()) or (t.email_status='processing' and t.lease_until<now()))
   order by t.available_at nulls last,t.id for update skip locked limit batch_limit),
 claimed as (update private.order_delay_notice_targets t set email_status='processing',claim_token=extensions.gen_random_uuid(),lease_until=now()+interval '10 minutes',attempts=attempts+1,updated_at=now()
   from selected where t.id=selected.id returning t.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'claimToken',c.claim_token,'orderId',c.order_id,'recipient',c.recipient_email,
  'title',n.title,'body',c.message_body,'shipmentLabels',c.shipment_labels)),'[]') into result from claimed c join private.order_delay_notices n on n.id=c.notice_id;
 return result;
end $$;

create function public.bind_order_delay_email_intent(target_id uuid,target_claim uuid,target_intent uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare t private.order_delay_notice_targets%rowtype;i private.email_intents%rowtype;
begin
 select * into t from private.order_delay_notice_targets where id=target_id for update;
 if not found or t.email_status<>'processing' or t.claim_token is distinct from target_claim or t.lease_until<=now() then return false;end if;
 select * into i from private.email_intents where id=target_intent for update;
 if not found or i.source<>'order_delay_notice' or i.message_kind<>'order_delay_notice' or i.content_revision<>'order_delay_v1'
  or (t.email_intent_id is not null and t.email_intent_id<>i.id) then raise check_violation using message='delay_notice_intent_mismatch';end if;
 update private.order_delay_notice_targets set email_intent_id=i.id where id=t.id;
 -- Committed provider acceptance wins even if the order subsequently ships or the lease response was lost.
 if i.state in ('accepted','sent','delivered','delayed','bounced','complained','suppressed','failed') then return true;end if;
 perform private.lock_order_delay_notice_target(t.order_id,t.shipment_ids);
 if not private.order_delay_notice_target_current(t.id) then
  update private.order_delay_notice_targets set email_status=case when i.attempt_count>0 then 'unknown' else 'suppressed' end,
   error_code='target_changed',available_at=null,retryable=false,claim_token=null,lease_until=null,updated_at=now() where id=t.id;
  insert into public.audit_log(actor_id,action,target,diff) values(null,'system.order.delay_notice_suppressed','delay_notice_target:'||t.id,jsonb_build_object('attempted',i.attempt_count>0));
  return false;
 end if;
 return true;
end $$;

create function public.finish_order_delay_email_job(target_id uuid,target_claim uuid,target_status text,target_error text,target_retryable boolean)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare t private.order_delay_notice_targets%rowtype;i private.email_intents%rowtype;status text:=target_status;code text:=target_error;can_retry boolean:=target_retryable;
begin
 if target_status is null or target_status not in ('sent','queued','failed','unknown','suppressed') or target_retryable is null
  or target_error is not null and target_error not in ('provider_suppressed','provider_rejected','delivery_disabled','delivery_in_progress','delivery_needs_review','delivery_outcome_unknown','provider_retryable','provider_not_configured')
 then raise invalid_parameter_value using message='invalid_delay_email_result';end if;
 select * into t from private.order_delay_notice_targets where id=target_id for update;
 if not found or t.email_status<>'processing' or t.claim_token is distinct from target_claim then return false;end if;
 select * into i from private.email_intents where id=t.email_intent_id for update;
 if i.state in ('accepted','sent','delivered','delayed') then status:='sent';code:=null;can_retry:=false;
 elsif i.state in ('bounced','complained','failed') then status:='failed';code:='provider_rejected';can_retry:=false;
 elsif i.state='suppressed' then status:='suppressed';code:='provider_suppressed';can_retry:=false;
 elsif i.state='needs_review' then status:='unknown';code:='delivery_needs_review';can_retry:=false;
 elsif status='sent' then raise check_violation using message='delay_notice_acceptance_required';
 end if;
 update private.order_delay_notice_targets set email_status=status,error_code=code,retryable=can_retry and status='failed',
  available_at=case when status='queued' or status='unknown' and code='delivery_outcome_unknown' then now()+interval '2 minutes' else null end,
  claim_token=null,lease_until=null,updated_at=now() where id=t.id;
 insert into public.audit_log(actor_id,action,target,diff) values(null,'system.order.delay_notice_email_result','delay_notice_target:'||t.id,
  jsonb_build_object('status',status,'errorCode',code,'retryable',can_retry,'attempts',t.attempts));
 return true;
end $$;

revoke all on function private.lock_order_delay_notice_target(uuid,uuid[]),private.order_delay_notice_snapshot(uuid,uuid[]),private.order_delay_notice_target_current(uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.admin_get_order_delay_notice(uuid),public.admin_prepare_order_delay_notice(uuid,uuid[],text,text,date),public.admin_request_order_delay_notice(uuid),public.admin_list_order_delay_notices(uuid),public.admin_retry_order_delay_notice(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_get_order_delay_notice(uuid),public.admin_prepare_order_delay_notice(uuid,uuid[],text,text,date),public.admin_request_order_delay_notice(uuid),public.admin_list_order_delay_notices(uuid),public.admin_retry_order_delay_notice(uuid) to authenticated;
revoke all on function public.claim_order_delay_email_jobs(integer),public.bind_order_delay_email_intent(uuid,uuid,uuid),public.finish_order_delay_email_job(uuid,uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.claim_order_delay_email_jobs(integer),public.bind_order_delay_email_intent(uuid,uuid,uuid),public.finish_order_delay_email_job(uuid,uuid,text,text,boolean) to service_role;
notify pgrst,'reload schema';
