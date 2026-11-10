-- Reviewed recurring billing and fixed-source goods subscriptions.
-- Public, provider-write and worker gates are OFF. No keys, jobs or provider
-- requests are provisioned here. Validated in a disposable clone before
-- approved local application with the shared GoodsTransaction migrations.

create function private.subscription_json_keys(p_value jsonb,p_keys text[]) returns boolean
language sql immutable security invoker set search_path='' as $$
 select jsonb_typeof(p_value)='object' and p_value ?& p_keys and p_value-p_keys='{}'::jsonb;
$$;

create function private.subscription_valid_envelope(p_value jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(private.subscription_json_keys(p_value,array['v','keyVersion','iv','ciphertext','tag'])
  and p_value->'v'='1'::jsonb and jsonb_typeof(p_value->'keyVersion')='string'
  and p_value->>'keyVersion'~'^[A-Za-z0-9_-]{1,64}$'
  and jsonb_typeof(p_value->'iv')='string' and p_value->>'iv'~'^[A-Za-z0-9_-]{16}$'
  and jsonb_typeof(p_value->'tag')='string' and p_value->>'tag'~'^[A-Za-z0-9_-]{22}$'
  and jsonb_typeof(p_value->'ciphertext')='string' and length(p_value->>'ciphertext') between 2 and 400 and p_value->>'ciphertext'~'^[A-Za-z0-9_-]+$',false);
$$;

create function private.subscription_normalize_intervals(p_value jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$declare result jsonb;begin
 if jsonb_typeof(p_value) is distinct from 'array' or jsonb_array_length(p_value) not between 1 and 6
  or exists(select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e.value)<>'string'
   or e.value#>>'{}' not in('week_1','week_2','week_4','month_1','month_2','month_3'))
  or (select count(distinct value) from jsonb_array_elements(p_value))<>jsonb_array_length(p_value) then
  raise invalid_parameter_value using message='invalid_subscription_intervals';end if;
 select jsonb_agg(value order by value) into result from jsonb_array_elements(p_value);return result;
end $$;

create function private.subscription_normalize_schedule(p_value jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$declare anchor date; cadence integer;begin
 if not coalesce(private.subscription_json_keys(p_value,array['unit','interval','anchorDate','time','monthEnd']),false)
  or jsonb_typeof(p_value->'unit') is distinct from 'string' or p_value->>'unit' not in('week','month')
  or jsonb_typeof(p_value->'interval') is distinct from 'number' or p_value->>'interval'!~'^[1-4]$'
  or jsonb_typeof(p_value->'anchorDate') is distinct from 'string' or p_value->>'anchorDate'!~'^(20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(p_value->'time') is distinct from 'string' or p_value->>'time'!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
  or jsonb_typeof(p_value->'monthEnd') is distinct from 'boolean' then
  raise invalid_parameter_value using message='invalid_subscription_schedule';end if;
 anchor:=(p_value->>'anchorDate')::date;cadence:=(p_value->>'interval')::integer;
 if (p_value->>'unit'='week' and (cadence not in(1,2,4) or (p_value->>'monthEnd')::boolean))
  or (p_value->>'unit'='month' and cadence not in(1,2,3)) then
  raise invalid_parameter_value using message='invalid_subscription_schedule';end if;
 return jsonb_build_object('unit',p_value->>'unit','interval',cadence,'anchorDate',anchor::text,'time',p_value->>'time','monthEnd',(p_value->>'monthEnd')::boolean);
exception when datetime_field_overflow or invalid_datetime_format then
 raise invalid_parameter_value using message='invalid_subscription_schedule';
end $$;

create function private.subscription_slot_at(p_schedule jsonb,p_slot integer) returns timestamptz
language plpgsql immutable security invoker set search_path='' as $$declare schedule jsonb;anchor date;target date;last_day date;begin
 schedule:=private.subscription_normalize_schedule(p_schedule);
 if p_slot is null or p_slot not between 0 and 1200 then raise invalid_parameter_value using message='invalid_subscription_schedule';end if;
 anchor:=(schedule->>'anchorDate')::date;
 if schedule->>'unit'='week' then target:=anchor+(7*(schedule->>'interval')::integer*p_slot);
 else
  target:=(date_trunc('month',anchor::timestamp)+make_interval(months=>(schedule->>'interval')::integer*p_slot))::date;
  last_day:=(target+interval '1 month'-interval '1 day')::date;
  target:=case when (schedule->>'monthEnd')::boolean then last_day
   else target+(least(extract(day from anchor)::integer,extract(day from last_day)::integer)-1) end;
 end if;
 return (target+(schedule->>'time')::time) at time zone 'Asia/Seoul';
end $$;

create table private.goods_subscription_runtime (
 singleton boolean primary key default true check(singleton),public_enabled boolean not null default false,
 charge_enabled boolean not null default false,worker_enabled boolean not null default false,fake_local_enabled boolean not null default false,
 terms_version text not null default 'goods-subscription-v1' check(terms_version~'^[A-Za-z0-9_-]{1,64}$')
);
insert into private.goods_subscription_runtime(singleton) values(true);

create table private.goods_subscription_policies (
 good_id text primary key references public.goods(id) on delete cascade,enabled boolean not null default false,
 intervals jsonb not null default '["month_1"]'::jsonb check(intervals=private.subscription_normalize_intervals(intervals)),
 message text not null default '' check(char_length(message)<=500 and message=btrim(message) and message!~'[[:cntrl:]]'),
 revision bigint not null default 1 check(revision>0),updated_by uuid references public.profiles(id) on delete set null,
 updated_at timestamptz not null default clock_timestamp()
);

create table private.billing_profiles (
 id uuid primary key,merchant_id text not null check(merchant_id~'^[A-Za-z0-9_-]{1,14}$'),
 environment text not null check(environment in('test','live')),adapter text not null check(adapter in('toss','fake')),
 enabled boolean not null default false,created_at timestamptz not null default clock_timestamp(),
 unique(merchant_id,environment),check(adapter<>'fake' or environment='test')
);
create table private.billing_customers (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),
 profile_id uuid not null references private.billing_profiles(id),customer_key uuid not null default gen_random_uuid() unique,
 created_at timestamptz not null default clock_timestamp(),unique(user_id,profile_id)
);
create table private.billing_credentials (
 id uuid primary key,owner_id uuid not null references public.profiles(id),customer_id uuid not null references private.billing_customers(id),
 profile_id uuid not null references private.billing_profiles(id),envelope jsonb check(envelope is null or private.subscription_valid_envelope(envelope)),
 state text not null check(state in('active','revoking','revoked','needs_review')),issuer_code text not null check(issuer_code~'^[A-Z0-9]{2}$'),
 masked_number text not null check(masked_number~'^[0-9*]{8,20}$' and length(replace(masked_number,'*',''))<=12
  and length(masked_number)-length(replace(masked_number,'*',''))>=4 and masked_number!~'[0-9]{9}'),
 authenticated_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),revoked_at timestamptz,
 revision bigint not null default 1 check(revision>0),check((state='revoked')=(revoked_at is not null)),
 check((state='revoked')=(envelope is null))
);
create index billing_credentials_owner on private.billing_credentials(owner_id,state,created_at,id);
create table private.billing_enrollments (
 id uuid primary key,owner_id uuid not null references public.profiles(id),session_id uuid not null,
 profile_id uuid not null references private.billing_profiles(id),customer_id uuid not null references private.billing_customers(id),
 credential_id uuid not null unique,nonce_digest text not null check(nonce_digest~'^[0-9a-f]{64}$'),
 nonce_envelope jsonb not null check(private.subscription_valid_envelope(nonce_envelope)),
 auth_envelope jsonb check(auth_envelope is null or private.subscription_valid_envelope(auth_envelope)),
 auth_fingerprint text check(auth_fingerprint is null or auth_fingerprint~'^[0-9a-f]{64}$'),
 write_key_version text not null check(write_key_version~'^[A-Za-z0-9_-]{1,64}$'),
 idempotency_key text not null unique check(char_length(idempotency_key) between 1 and 300 and idempotency_key~'^[!-~]+$'),
 state text not null default 'prepared' check(state in('prepared','processing','ready','declined','unknown','needs_review','expired')),
 claim_token uuid,lease_until timestamptz,claim_fence bigint not null default 0 check(claim_fence>=0),
 first_dispatched_at timestamptz,recovery_until timestamptz,expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 safe_reason text check(safe_reason is null or safe_reason~'^[a-z0-9_]{1,64}$'),
 check((claim_token is null)=(lease_until is null)),check(expires_at>created_at and expires_at<=created_at+interval '10 minutes')
);
create index billing_enrollments_owner on private.billing_enrollments(owner_id,created_at,id);

create table private.goods_subscription_plans (
 id uuid primary key,owner_id uuid not null references public.profiles(id),creation_operation_id uuid not null unique,
 creation_request_hash text not null check(creation_request_hash~'^[0-9a-f]{64}$'),
 state text not null default 'draft' check(state in('draft','awaiting_first_payment','active','paused','needs_confirmation','canceled')),
 revision bigint not null default 1 check(revision>0),credential_id uuid references private.billing_credentials(id),
 current_terms_id uuid,first_cycle_id uuid not null unique,last_cycle_number integer not null default 1 check(last_cycle_number>0),
 next_slot integer not null default 0 check(next_slot between 0 and 1200),next_run_at timestamptz,
 pause_reason text check(pause_reason is null or pause_reason in('customer_paused','payment_failed','stock_unavailable','goods_unavailable',
  'schedule_missed','account_unavailable','card_unavailable','delivery_unavailable','terms_changed','payment_review')),
 draft_expires_at timestamptz not null,consented_at timestamptz,canceled_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check((state='canceled')=(canceled_at is not null))
);
create index goods_subscription_plans_owner on private.goods_subscription_plans(owner_id,state,updated_at,id);
create table private.goods_subscription_terms (
 id uuid primary key,plan_id uuid not null references private.goods_subscription_plans(id),owner_id uuid not null references public.profiles(id),
 selection jsonb not null,address jsonb not null,address_revision uuid not null,schedule jsonb not null,
 delivery_choices jsonb not null,renewal_terms jsonb not null,renewal_terms_hash text not null check(renewal_terms_hash~'^[0-9a-f]{64}$'),
 policy_terms_version text not null,first_quote_id uuid,renewal_quote_id uuid,
 first_display jsonb not null,renewal_display jsonb not null,created_at timestamptz not null default clock_timestamp(),
 check(schedule=private.subscription_normalize_schedule(schedule)),check(jsonb_typeof(selection)='array' and jsonb_array_length(selection) between 1 and 100),
 check(jsonb_typeof(address)='object' and octet_length(address::text)<=4096),check(jsonb_typeof(delivery_choices)='object'),
 check(octet_length(selection::text)<=65536 and octet_length(renewal_terms::text)<=131072)
);
alter table private.goods_subscription_plans add constraint subscription_current_terms_fk foreign key(current_terms_id) references private.goods_subscription_terms(id);
create table private.goods_subscription_cycles (
 id uuid primary key,plan_id uuid not null references private.goods_subscription_plans(id),owner_id uuid not null references public.profiles(id),
 cycle_number integer not null check(cycle_number>0),schedule_slot integer not null check(schedule_slot between 0 and 1200),
 terms_id uuid not null references private.goods_subscription_terms(id),scheduled_at timestamptz not null,
 state text not null default 'draft' check(state in('draft','ready','prepared','dispatching','unknown','needs_review','approved','declined','canceled','skipped')),
 revision bigint not null default 1 check(revision>0),quote_id uuid,order_id uuid unique references public.orders(id),attempt_id uuid unique references public.payment_attempts(id),
 claim_token uuid,lease_until timestamptz,claim_fence bigint not null default 0 check(claim_fence>=0),
 dispatched_at timestamptz,settled_at timestamptz,next_check_at timestamptz,
 safe_reason text check(safe_reason is null or safe_reason~'^[a-z0-9_]{1,64}$'),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(plan_id,cycle_number),unique(plan_id,terms_id,schedule_slot),check((claim_token is null)=(lease_until is null)),
 check(attempt_id is null or order_id is not null),check(dispatched_at is null or attempt_id is not null)
);
create unique index goods_subscription_one_unresolved on private.goods_subscription_cycles(plan_id)
 where state in('draft','ready','prepared','dispatching','unknown','needs_review');
create index goods_subscription_due on private.goods_subscription_cycles(coalesce(next_check_at,scheduled_at),id)
 where state in('ready','prepared','dispatching','unknown','needs_review');

create table private.goods_subscription_operations (
 operation_id uuid primary key,owner_id uuid not null references public.profiles(id),plan_id uuid not null references private.goods_subscription_plans(id),
 command text not null check(command in('confirm','pause','resume','cancel','change_schedule','change_destination','replace_card','accept_terms')),
 request_hash text not null check(request_hash~'^[0-9a-f]{64}$'),receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create table private.payment_provider_bindings (
 attempt_id uuid primary key references public.payment_attempts(id) on delete cascade,integration text not null check(integration='toss_billing'),
 owner_id uuid not null,profile_id uuid not null references private.billing_profiles(id),
 merchant_id text not null,environment text not null check(environment in('test','live')),
 credential_id uuid not null,cycle_id uuid not null unique,
 write_key_version text not null check(write_key_version~'^[A-Za-z0-9_-]{1,64}$'),first_dispatched_at timestamptz,
 policy_version integer not null default 1 check(policy_version=1),created_at timestamptz not null default clock_timestamp()
);
create table private.billing_refund_operations (
 attempt_id uuid primary key references private.payment_provider_bindings(attempt_id) on delete cascade,idempotency_key text not null unique,
 amount bigint not null check(amount>=100),request_hash text not null check(request_hash~'^[0-9a-f]{64}$'),
 write_key_version text not null check(write_key_version~'^[A-Za-z0-9_-]{1,64}$'),first_dispatched_at timestamptz not null default clock_timestamp()
);

create function private.subscription_require_service() returns void
language plpgsql stable security invoker set search_path='' as $$begin
 if coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
  nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then
  raise insufficient_privilege using message='subscription_service_required';end if;
end $$;

create function private.subscription_lock_actor(p_actor uuid,p_new_write boolean) returns void
language plpgsql volatile security invoker set search_path='' as $$declare profile public.profiles;begin
 if p_actor is null or p_new_write is null then raise insufficient_privilege using message='subscription_actor_required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,0));
 perform private.lock_account_action_subject(p_actor);
 select * into profile from public.profiles where id=p_actor for share;
 if not found then raise insufficient_privilege using message='subscription_actor_unavailable';end if;
 if p_new_write and (profile.suspended_at is not null or private.is_account_write_fenced(p_actor)
  or profile.onboarded_at is null or profile.birth_date is null or profile.birth_date>current_date
  or nullif(btrim(profile.nickname),'') is null or nullif(btrim(coalesce(profile.email,(select email from auth.users where id=p_actor))),'') is null
  or profile.consents->>'terms' is distinct from 'true' or profile.consents->>'privacy' is distinct from 'true') then
  raise insufficient_privilege using message='subscription_actor_unavailable';end if;
end $$;

create function private.subscription_policy_summary(p_good_id text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('goodId',g.id,'goodUpdatedAt',g.updated_at,'revision',coalesce(p.revision,0),
  'enabled',coalesce(p.enabled,false),'intervals',coalesce(p.intervals,'["month_1"]'::jsonb),'message',coalesce(p.message,''))
 from public.goods g left join private.goods_subscription_policies p on p.good_id=g.id where g.id=p_good_id;
$$;

create function public.admin_get_goods_subscription_policy(p_expected_actor_id uuid,p_good_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_actor_id
  or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='subscription_actor_changed';end if;
 result:=private.subscription_policy_summary(p_good_id);
 if result is null then raise no_data_found using message='subscription_good_not_found';end if;return result;
end $$;

create function public.admin_save_goods_subscription_policy(p_expected_actor_id uuid,p_good_id text,p_expected_revision bigint,
 p_expected_good_updated_at timestamptz,p_operation_id uuid,p_enabled boolean,p_intervals jsonb,p_message text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();current private.goods_subscription_policies;good public.goods;intervals jsonb;request jsonb;result jsonb;changed boolean;
begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='subscription_actor_changed';end if;
 perform private.require_actor_operator_capability(actor,'catalog.manage',false);
 if p_good_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or p_expected_good_updated_at is null
  or p_enabled is null or p_message is null or p_message<>btrim(p_message) or char_length(p_message)>500 or p_message~'[[:cntrl:]]' then
  raise invalid_parameter_value using message='invalid_subscription_policy';end if;
 intervals:=private.subscription_normalize_intervals(p_intervals);
 request:=jsonb_build_object('goodId',p_good_id,'expectedRevision',p_expected_revision,'goodUpdatedAt',p_expected_good_updated_at,
  'contentHash',encode(sha256(convert_to(jsonb_build_array(p_enabled,intervals,p_message)::text,'UTF8')),'hex'));
 perform pg_advisory_xact_lock(hashtextextended('subscription-policy-operation:'||p_operation_id::text,0));
 result:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.goods_subscription_policy.saved',request);
 if result is not null then return result;end if;
 select * into good from public.goods where id=p_good_id for update;
 if not found then raise no_data_found using message='subscription_good_not_found';end if;
 select * into current from private.goods_subscription_policies where good_id=p_good_id for update;
 if coalesce(current.revision,0)<>p_expected_revision or good.updated_at<>p_expected_good_updated_at then
  raise sqlstate 'PT409' using message='subscription_policy_conflict';end if;
 changed:=current.good_id is null or current.enabled is distinct from p_enabled or current.intervals is distinct from intervals or current.message is distinct from p_message;
 if changed then
  insert into private.goods_subscription_policies(good_id,enabled,intervals,message,updated_by)
   values(p_good_id,p_enabled,intervals,p_message,actor)
  on conflict(good_id) do update set enabled=excluded.enabled,intervals=excluded.intervals,message=excluded.message,
   revision=private.goods_subscription_policies.revision+1,updated_by=actor,updated_at=clock_timestamp();
  update public.goods set updated_at=clock_timestamp() where id=p_good_id;
 end if;
 result:=private.subscription_policy_summary(p_good_id)||jsonb_build_object('operationId',p_operation_id,'changed',changed);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.goods_subscription_policy.saved','good:'||p_good_id,
  jsonb_build_object('request',request,'result',result));return result;
end $$;

create function private.billing_registration_summary(p_id uuid,p_server boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',e.id,'state',e.state,'expiresAt',e.expires_at,'credentialId',case when e.state='ready' then e.credential_id end)
 ||case when p_server then jsonb_build_object('ownerId',e.owner_id,'sessionId',e.session_id,'profileId',e.profile_id,
  'merchantId',p.merchant_id,'environment',p.environment,'adapter',p.adapter,'customerKey',c.customer_key,
  'credentialId',e.credential_id,'writeKeyVersion',e.write_key_version,'idempotencyKey',e.idempotency_key,
  'nonceEnvelope',e.nonce_envelope,'authEnvelope',e.auth_envelope,'firstDispatchedAt',e.first_dispatched_at,
  'claimToken',e.claim_token,'claimFence',e.claim_fence,'recoveryUntil',e.recovery_until) else '{}'::jsonb end
 from private.billing_enrollments e join private.billing_profiles p on p.id=e.profile_id
 join private.billing_customers c on c.id=e.customer_id where e.id=p_id;
$$;

create function public.service_prepare_billing_registration(p_actor_id uuid,p_session_id uuid,p_operation_id uuid,p_profile_id uuid,
 p_nonce_digest text,p_nonce_envelope jsonb,p_write_key_version text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare entry private.billing_enrollments;customer_id uuid;profile private.billing_profiles;at_time timestamptz;
begin
 perform private.subscription_require_service();perform private.subscription_lock_actor(p_actor_id,false);
 if p_operation_id is null or p_session_id is null or p_profile_id is null or not exists(select 1 from auth.sessions where id=p_session_id and user_id=p_actor_id)
  or p_nonce_digest is null or p_nonce_digest!~'^[0-9a-f]{64}$' or not private.subscription_valid_envelope(p_nonce_envelope)
  or p_write_key_version is null or p_write_key_version!~'^[A-Za-z0-9_-]{1,64}$' then
  raise invalid_parameter_value using message='invalid_billing_registration';end if;
 select * into entry from private.billing_enrollments where id=p_operation_id for update;
 if found then
  if entry.owner_id<>p_actor_id or entry.session_id<>p_session_id or entry.profile_id<>p_profile_id then
   raise insufficient_privilege using message='billing_registration_conflict';end if;
  return private.billing_registration_summary(entry.id,true);
 end if;
 perform private.subscription_lock_actor(p_actor_id,true);
 if not (select public_enabled from private.goods_subscription_runtime where singleton) then
  raise object_not_in_prerequisite_state using message='subscriptions_unavailable';end if;
 select * into profile from private.billing_profiles where id=p_profile_id and enabled for share;
 if not found or (profile.adapter='fake' and not(select fake_local_enabled from private.goods_subscription_runtime where singleton)) then
  raise object_not_in_prerequisite_state using message='billing_profile_unavailable';end if;
 if (select count(*) from private.billing_enrollments where owner_id=p_actor_id and state in('prepared','processing','unknown','needs_review')
  and created_at>clock_timestamp()-interval '24 hours')>=10 then raise check_violation using message='billing_registration_limit';end if;
 insert into private.billing_customers(user_id,profile_id) values(p_actor_id,p_profile_id)
 on conflict(user_id,profile_id) do update set profile_id=excluded.profile_id returning id into customer_id;
 at_time:=clock_timestamp();
 insert into private.billing_enrollments(id,owner_id,session_id,profile_id,customer_id,credential_id,nonce_digest,nonce_envelope,
  write_key_version,idempotency_key,created_at,updated_at,expires_at)
 values(p_operation_id,p_actor_id,p_session_id,p_profile_id,customer_id,gen_random_uuid(),p_nonce_digest,p_nonce_envelope,
  p_write_key_version,'billing-register:'||p_operation_id::text,at_time,at_time,at_time+interval '10 minutes');
 return private.billing_registration_summary(p_operation_id,true);
end $$;

create function public.service_claim_billing_registration(p_actor_id uuid,p_session_id uuid,p_id uuid,p_nonce_digest text,
 p_auth_envelope jsonb,p_auth_fingerprint text,p_claim_token uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare entry private.billing_enrollments;at_time timestamptz;begin
 perform private.subscription_require_service();perform private.subscription_lock_actor(p_actor_id,false);
 if p_session_id is null or p_claim_token is null or not exists(select 1 from auth.sessions where id=p_session_id and user_id=p_actor_id)
  or not private.subscription_valid_envelope(p_auth_envelope) or p_auth_fingerprint is null or p_auth_fingerprint!~'^[0-9a-f]{64}$' then
  raise invalid_parameter_value using message='invalid_billing_registration';end if;
 select * into entry from private.billing_enrollments where id=p_id and owner_id=p_actor_id and session_id=p_session_id for update;
 if not found or entry.nonce_digest is distinct from p_nonce_digest then raise insufficient_privilege using message='billing_registration_forbidden';end if;
 if entry.state in('ready','declined','expired') then return private.billing_registration_summary(p_id,true)||jsonb_build_object('kind','terminal');end if;
 at_time:=clock_timestamp();
 if entry.first_dispatched_at is null then
  perform private.subscription_lock_actor(p_actor_id,true);
  if entry.expires_at<=at_time or not(select public_enabled from private.goods_subscription_runtime where singleton) then
   update private.billing_enrollments set state='expired',updated_at=at_time where id=p_id;
   return private.billing_registration_summary(p_id,true)||jsonb_build_object('kind','terminal');end if;
 else
  if entry.auth_fingerprint is distinct from p_auth_fingerprint then raise invalid_parameter_value using message='billing_registration_conflict';end if;
  if entry.recovery_until<=at_time then return private.billing_registration_summary(p_id,true)||jsonb_build_object('kind','expired_recovery');end if;
 end if;
 if entry.claim_token is not null and entry.lease_until>at_time then return private.billing_registration_summary(p_id,false)||jsonb_build_object('kind','busy');end if;
 update private.billing_enrollments set state='processing',claim_token=p_claim_token,claim_fence=claim_fence+1,
  lease_until=at_time+interval '10 minutes',first_dispatched_at=coalesce(first_dispatched_at,at_time),
  recovery_until=coalesce(recovery_until,at_time+interval '24 hours'),auth_envelope=coalesce(auth_envelope,p_auth_envelope),
  auth_fingerprint=coalesce(auth_fingerprint,p_auth_fingerprint),updated_at=at_time where id=p_id;
 return private.billing_registration_summary(p_id,true)||jsonb_build_object('kind','claimed');
end $$;

create function public.service_finish_billing_registration(p_actor_id uuid,p_id uuid,p_claim_token uuid,p_claim_fence bigint,p_state text,
 p_envelope jsonb default null,p_card jsonb default null,p_authenticated_at timestamptz default null,p_reason text default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare entry private.billing_enrollments;available boolean;begin
 perform private.subscription_require_service();perform private.subscription_lock_actor(p_actor_id,false);
 select * into entry from private.billing_enrollments where id=p_id and owner_id=p_actor_id for update;
 if not found then raise no_data_found using message='billing_registration_not_found';end if;
 if entry.state='ready' then return private.billing_registration_summary(p_id,false);end if;
 if entry.state<>'processing' or p_claim_token is null or p_claim_fence is null or p_claim_fence<1
  or entry.claim_token is null or entry.lease_until is null or entry.first_dispatched_at is null
  or entry.claim_token is distinct from p_claim_token or entry.claim_fence is distinct from p_claim_fence or entry.lease_until<=clock_timestamp() then
  raise sqlstate 'PT409' using message='billing_registration_claim_stale';end if;
 if p_state is null or p_state not in('ready','declined','unknown','needs_review') or (p_reason is not null and p_reason!~'^[a-z0-9_]{1,64}$') then
  raise invalid_parameter_value using message='invalid_billing_registration_result';end if;
 if p_state='ready' then
  if not private.subscription_valid_envelope(p_envelope) or not coalesce(private.subscription_json_keys(p_card,array['issuerCode','number']),false)
   or p_card->>'issuerCode'!~'^[A-Z0-9]{2}$' or p_card->>'number'!~'^[0-9*]{8,20}$'
   or length(replace(p_card->>'number','*',''))>12 or length(p_card->>'number')-length(replace(p_card->>'number','*',''))<4
   or p_card->>'number'~'[0-9]{9}' or p_authenticated_at is null or p_authenticated_at>clock_timestamp()+interval '5 minutes' then
   raise invalid_parameter_value using message='invalid_billing_registration_result';end if;
  available:=not private.is_account_write_fenced(p_actor_id) and exists(select 1 from public.profiles where id=p_actor_id and suspended_at is null);
  insert into private.billing_credentials(id,owner_id,customer_id,profile_id,envelope,state,issuer_code,masked_number,authenticated_at)
   values(entry.credential_id,p_actor_id,entry.customer_id,entry.profile_id,p_envelope,case when available then 'active' else 'revoking' end,
    p_card->>'issuerCode',p_card->>'number',p_authenticated_at);
 end if;
 update private.billing_enrollments set state=p_state,claim_token=null,lease_until=null,
  auth_envelope=case when p_state in('ready','declined') then null else auth_envelope end,safe_reason=p_reason,updated_at=clock_timestamp() where id=p_id;
 return private.billing_registration_summary(p_id,false);
end $$;

create function public.service_get_billing_registration(p_actor_id uuid,p_session_id uuid,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 perform private.subscription_require_service();
 if not exists(select 1 from auth.sessions where id=p_session_id and user_id=p_actor_id)
  or not exists(select 1 from private.billing_enrollments where id=p_id and owner_id=p_actor_id and session_id=p_session_id) then
  raise insufficient_privilege using message='billing_registration_forbidden';end if;
 return private.billing_registration_summary(p_id,true);
end $$;

create function public.get_my_billing_registration(p_expected_actor_id uuid,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_actor_id
  or not exists(select 1 from private.billing_enrollments where id=p_id and owner_id=auth.uid()) then
  raise insufficient_privilege using message='billing_registration_forbidden';end if;
 return private.billing_registration_summary(p_id,false);
end $$;

create function public.get_my_billing_credentials(p_expected_actor_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_actor_id then
  raise insufficient_privilege using message='subscription_actor_changed';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'state',c.state,'issuerCode',c.issuer_code,'number',c.masked_number,
  'revision',c.revision,'createdAt',c.created_at,'activePlanCount',(select count(*) from private.goods_subscription_plans p
   where p.credential_id=c.id and p.state in('awaiting_first_payment','active','paused','needs_confirmation'))) order by c.created_at desc,c.id)
  from private.billing_credentials c where c.owner_id=auth.uid() and c.state<>'revoked'),'[]'::jsonb);
end $$;

create function public.service_get_payment_gateway_binding(p_attempt_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare binding private.payment_provider_bindings;attempt public.payment_attempts;payment_key text;begin
 perform private.subscription_require_service();
 select * into attempt from public.payment_attempts where id=p_attempt_id;
 if not found then raise no_data_found using message='payment_attempt_not_found';end if;
 select * into binding from private.payment_provider_bindings where attempt_id=p_attempt_id;
 if not found then
  if exists(select 1 from private.goods_subscription_cycles where attempt_id=p_attempt_id) then
   raise object_not_in_prerequisite_state using message='billing_binding_missing';end if;
  return null;
 end if;
 if attempt.provider<>'toss' or attempt.purpose<>'order' or attempt.user_id<>binding.owner_id then
  raise object_not_in_prerequisite_state using message='billing_binding_invalid';end if;
 select p.payment_key into payment_key from public.payments p where p.id=attempt.payment_id;
 return jsonb_build_object('integration',binding.integration,'attemptId',binding.attempt_id,'ownerId',binding.owner_id,
  'profileId',binding.profile_id,'merchantId',binding.merchant_id,'environment',binding.environment,'credentialId',binding.credential_id,
  'cycleId',binding.cycle_id,'writeKeyVersion',binding.write_key_version,'firstDispatchedAt',binding.first_dispatched_at,'providerPaymentKey',payment_key);
end $$;

create function public.service_prepare_billing_refund(p_attempt_id uuid,p_idempotency_key text,p_amount bigint,p_request_hash text,p_key_version text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare binding private.payment_provider_bindings;attempt public.payment_attempts;operation private.billing_refund_operations;begin
 perform private.subscription_require_service();
 if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 300 or p_idempotency_key!~'^[!-~]+$'
  or p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' or p_key_version is null or p_key_version!~'^[A-Za-z0-9_-]{1,64}$' then
  raise invalid_parameter_value using message='invalid_billing_refund';end if;
 perform pg_advisory_xact_lock(hashtextextended('billing-refund:'||p_attempt_id::text,0));
 select * into binding from private.payment_provider_bindings where attempt_id=p_attempt_id;
 select * into attempt from public.payment_attempts where id=p_attempt_id;
 if binding.attempt_id is null or binding.first_dispatched_at is null or attempt.id is null or attempt.amount is distinct from p_amount
  or attempt.provider<>'toss' or attempt.purpose<>'order' or attempt.payment_id is null then
  raise invalid_parameter_value using message='invalid_billing_refund';end if;
 select * into operation from private.billing_refund_operations where attempt_id=p_attempt_id for update;
 if found then
  if operation.idempotency_key<>p_idempotency_key or operation.amount<>p_amount or operation.request_hash<>p_request_hash then
   raise sqlstate 'PT409' using message='billing_refund_conflict';end if;
 else
  insert into private.billing_refund_operations(attempt_id,idempotency_key,amount,request_hash,write_key_version)
   values(p_attempt_id,p_idempotency_key,p_amount,p_request_hash,p_key_version) returning * into operation;
 end if;
 return jsonb_build_object('writeKeyVersion',operation.write_key_version,'firstDispatchedAt',operation.first_dispatched_at);
end $$;

create table private.fake_billing_credentials (
 profile_id uuid not null references private.billing_profiles(id),credential_ref text not null check(credential_ref~'^[0-9a-f]{64}$'),
 customer_ref text not null check(customer_ref~'^[0-9a-f]{64}$'),revoked boolean not null default false,
 primary key(profile_id,credential_ref)
);
create table private.fake_billing_operations (
 profile_id uuid not null references private.billing_profiles(id),operation_ref text not null check(operation_ref~'^[0-9a-f]{64}$'),
 payload_hash text not null check(payload_hash~'^[0-9a-f]{64}$'),receipt jsonb not null,primary key(profile_id,operation_ref)
);
create table private.fake_billing_payments (
 profile_id uuid not null references private.billing_profiles(id),order_ref text not null check(order_ref~'^[0-9a-f]{64}$'),
 receipt jsonb not null,primary key(profile_id,order_ref)
);
create function public.service_fake_billing_command(p_command jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare profile_uuid uuid;kind text;at_time timestamptz;reference text;existing jsonb;current_hash text;credential private.fake_billing_credentials;result jsonb;
begin
 perform private.subscription_require_service();
 if jsonb_typeof(p_command) is distinct from 'object' or p_command-array['kind','profileId','operationRef','payloadHash','credentialRef','customerRef','orderRef','attemptId','amount','at','decline']<>'{}'::jsonb
  or not(p_command?&array['kind','profileId','at']) or p_command->>'kind' not in('register','charge','inspect','refund','revoke') then
  raise invalid_parameter_value using message='invalid_fake_billing_command';end if;
 profile_uuid:=(p_command->>'profileId')::uuid;kind:=p_command->>'kind';at_time:=(p_command->>'at')::timestamptz;
 if not(select fake_local_enabled from private.goods_subscription_runtime where singleton)
  or not exists(select 1 from private.billing_profiles p where p.id=profile_uuid and p.adapter='fake' and p.environment='test') then
  raise insufficient_privilege using message='fake_billing_disabled';end if;
 if at_time is null or at_time<clock_timestamp()-interval '5 minutes' or at_time>clock_timestamp()+interval '5 minutes' then
  raise invalid_parameter_value using message='invalid_fake_billing_time';end if;
 perform pg_advisory_xact_lock(hashtextextended('fake-billing:'||profile_uuid::text,0));
 result:=jsonb_build_object('state','conflict','at',at_time);
 if kind='inspect' then
  return coalesce((select receipt from private.fake_billing_payments p where p.profile_id=profile_uuid and p.order_ref=p_command->>'orderRef'),jsonb_build_object('state','not_found','at',at_time));
 elsif kind='revoke' then
  update private.fake_billing_credentials c set revoked=true where c.profile_id=profile_uuid and c.credential_ref=p_command->>'credentialRef';
  return jsonb_build_object('state',case when found then 'revoked' else 'not_found' end,'at',at_time);
 end if;
 if coalesce(p_command->>'operationRef','')!~'^[0-9a-f]{64}$' or coalesce(p_command->>'payloadHash','')!~'^[0-9a-f]{64}$' then return result;end if;
 select o.payload_hash,o.receipt into current_hash,existing from private.fake_billing_operations o where o.profile_id=profile_uuid and o.operation_ref=p_command->>'operationRef';
 if found then return case when current_hash=p_command->>'payloadHash' then existing else result end;end if;
 if kind='register' then
  if coalesce(p_command->>'credentialRef','')!~'^[0-9a-f]{64}$' or coalesce(p_command->>'customerRef','')!~'^[0-9a-f]{64}$' then return result;end if;
  select * into credential from private.fake_billing_credentials c where c.profile_id=profile_uuid and c.credential_ref=p_command->>'credentialRef';
  if found and (credential.revoked or credential.customer_ref<>p_command->>'customerRef') then return result;end if;
  insert into private.fake_billing_credentials(profile_id,credential_ref,customer_ref) values(profile_uuid,p_command->>'credentialRef',p_command->>'customerRef') on conflict do nothing;
  result:=jsonb_build_object('state','registered','at',at_time);
 else
  if coalesce(p_command->>'orderRef','')!~'^[0-9a-f]{64}$' or p_command->>'attemptId' is null
   or jsonb_typeof(p_command->'amount') is distinct from 'number' or p_command->>'amount'!~'^[0-9]+$'
   or (p_command->>'amount')::numeric not between 100 and 999999999999 then return result;end if;
  perform (p_command->>'attemptId')::uuid;
  select receipt into existing from private.fake_billing_payments p where p.profile_id=profile_uuid and p.order_ref=p_command->>'orderRef';
  if kind='charge' then
   if found then return result;end if;
   select * into credential from private.fake_billing_credentials c where c.profile_id=profile_uuid and c.credential_ref=p_command->>'credentialRef';
   if not found or credential.revoked or credential.customer_ref is distinct from p_command->>'customerRef' then result:=jsonb_build_object('state','declined','at',at_time);
   else
    result:=jsonb_build_object('state',case when coalesce((p_command->>'decline')::boolean,false) then 'declined' else 'approved' end,
     'attemptId',p_command->>'attemptId','amount',p_command->'amount','paymentKey','fake_payment_'||replace(p_command->>'attemptId','-',''),
     'transactionId','fake_approval_'||replace(p_command->>'attemptId','-',''),'at',at_time);
    insert into private.fake_billing_payments(profile_id,order_ref,receipt) values(profile_uuid,p_command->>'orderRef',result);
   end if;
  else
   if existing is null or existing->>'attemptId' is distinct from p_command->>'attemptId' or existing->'amount' is distinct from p_command->'amount' then
    return jsonb_build_object('state','not_found','at',at_time);end if;
   if existing->>'state'='canceled' then result:=existing;
   elsif existing->>'state'<>'approved' then return result;
   else result:=existing||jsonb_build_object('state','canceled','transactionId','fake_cancel_'||replace(p_command->>'attemptId','-',''),'at',at_time);
    update private.fake_billing_payments p set receipt=result where p.profile_id=profile_uuid and p.order_ref=p_command->>'orderRef';
   end if;
  end if;
 end if;
 insert into private.fake_billing_operations(profile_id,operation_ref,payload_hash,receipt) values(profile_uuid,p_command->>'operationRef',p_command->>'payloadHash',result);
 return result;
end $$;

create function public.service_get_subscription_availability(p_actor_id uuid,p_profile_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 perform private.subscription_require_service();
 if p_actor_id is null or not exists(select 1 from public.profiles where id=p_actor_id) then raise insufficient_privilege using message='subscription_actor_required';end if;
 return jsonb_build_object('publicEnabled',(select public_enabled from private.goods_subscription_runtime where singleton),
  'profile',(select jsonb_build_object('profileId',p.id,'merchantId',p.merchant_id,'environment',p.environment,'adapter',p.adapter)
    from private.billing_profiles p where p.id=p_profile_id and p.enabled and (p.adapter<>'fake' or (select fake_local_enabled from private.goods_subscription_runtime where singleton))),
  'hasHistory',exists(select 1 from private.billing_credentials where owner_id=p_actor_id and state<>'revoked')
    or exists(select 1 from private.goods_subscription_plans where owner_id=p_actor_id));
end $$;

create table private.goods_subscription_proposals (
 id uuid primary key,owner_id uuid not null references public.profiles(id),plan_id uuid not null references private.goods_subscription_plans(id),
 expected_revision bigint not null,terms_id uuid not null references private.goods_subscription_terms(id),
 command text not null check(command in('resume','change_schedule','change_destination','replace_card','accept_terms')),
 request_hash text not null,expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp()
);

create function private.subscription_source(p_cycle uuid,p_revision text) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('kind','subscription','id',p_cycle,'revision',p_revision);
$$;
create function private.subscription_renewal_terms(p_display jsonb,p_selection jsonb,p_schedule jsonb,p_address_revision uuid) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$declare goods jsonb;shipping jsonb;begin
 if p_display->>'calculationVersion'<>'2' or p_display->>'currency'<>'KRW' or p_display->'userCouponId'<>'null'::jsonb
  or p_display#>>'{totals,couponDiscountTotal}'<>'0' or p_display#>>'{totals,storeCreditTotal}'<>'0'
  or p_display#>>'{paymentMethods,card}'<>'true' or p_address_revision is null then
  raise invalid_parameter_value using message='invalid_subscription_renewal_terms';end if;
 select jsonb_agg(value-'lineId' order by (value-'lineId')::text collate "C") into goods from jsonb_array_elements(p_display->'lines');
 select jsonb_agg(value||jsonb_build_object('components',(select jsonb_agg(component order by component::text collate "C")
  from jsonb_array_elements(value->'components') component)) order by value::text collate "C") into shipping from jsonb_array_elements(p_display->'shipping');
 return jsonb_build_object('version',1,'currency','KRW','selection',p_selection,'schedule',private.subscription_normalize_schedule(p_schedule),
  'addressRevision',p_address_revision,'onlineTotal',p_display#>'{totals,onlineTotal}','collectShippingTotal',p_display#>'{totals,collectShippingTotal}',
  'goods',goods,'shipping',shipping);
end $$;
create function private.subscription_selection_allowed(p_selection jsonb,p_schedule jsonb) returns boolean
language sql stable security invoker set search_path='' as $$
 select not exists(select 1 from jsonb_array_elements(p_selection) line left join public.goods g on g.id=line->>'goodId'
  left join public.goods_variants v on v.id=(line->>'variantId')::uuid and v.good_id=g.id
  left join private.goods_subscription_policies p on p.good_id=g.id
  where g.id is null or v.id is null or v.preorder_policy_id is not null or g.sale_restriction<>'none' or g.archived_at is not null or g.published_at is null or v.archived_at is not null
   or not coalesce(p.enabled,false) or not(p.intervals?((p_schedule->>'unit')||'_'||(p_schedule->>'interval'))));
$$;
create function private.subscription_plan_summary(p_plan_id uuid,p_details boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p.id,'state',p.state,'revision',p.revision,'termsId',p.current_terms_id,'pauseReason',p.pause_reason,
  'nextRunAt',p.next_run_at,'consentedAt',p.consented_at,'canceledAt',p.canceled_at,'createdAt',p.created_at,'updatedAt',p.updated_at,
  'draftExpiresAt',p.draft_expires_at,'firstCycleId',p.first_cycle_id,'firstQuoteId',t.first_quote_id,'policyTermsVersion',t.policy_terms_version,
  'schedule',t.schedule,'selection',t.selection,'firstDisplay',t.first_display,'renewalDisplay',t.renewal_display,
  'card',case when c.id is null then null else jsonb_build_object('id',c.id,'state',c.state,'issuerCode',c.issuer_code,'number',c.masked_number,'revision',c.revision) end)
 ||case when p_details then jsonb_build_object('address',t.address,'deliveryChoices',t.delivery_choices,'addressRevision',t.address_revision,
  'cycles',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'number',x.cycle_number,'state',x.state,'scheduledAt',x.scheduled_at,
    'orderId',x.order_id,'orderStatus',o.status,'amount',o.total,'settledAt',x.settled_at,'reason',x.safe_reason)
    order by x.cycle_number desc) from (select * from private.goods_subscription_cycles where plan_id=p.id order by cycle_number desc limit 50) x
    left join public.orders o on o.id=x.order_id),'[]'::jsonb)) else '{}'::jsonb end
 from private.goods_subscription_plans p join private.goods_subscription_terms t on t.id=p.current_terms_id
 left join private.billing_credentials c on c.id=p.credential_id where p.id=p_plan_id;
$$;

create function public.prepare_my_goods_subscription(p_expected_actor_id uuid,p_operation_id uuid,p_selection jsonb,p_address jsonb,
 p_schedule jsonb,p_delivery_choices jsonb,p_user_coupon_id uuid default null,p_store_credit_amount bigint default 0) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();selection jsonb;address jsonb;schedule jsonb;choices jsonb;request_hash text;current private.goods_subscription_plans;
 plan_id uuid:=gen_random_uuid();terms_id uuid:=gen_random_uuid();address_revision uuid:=gen_random_uuid();source jsonb;first_quote jsonb;renewal_quote jsonb;renewal_terms jsonb;
begin
 if actor is null or actor is distinct from p_expected_actor_id or p_operation_id is null then raise insufficient_privilege using message='subscription_actor_changed';end if;
 perform private.lock_goods_transaction_source(actor,private.subscription_source(p_operation_id,'prepare'));
 selection:=private.normalize_goods_transaction_selection(p_selection);address:=private.normalize_goods_transaction_address(p_address);
 schedule:=private.subscription_normalize_schedule(p_schedule);choices:=private.normalize_goods_transaction_choices(p_delivery_choices,selection);
 if jsonb_array_length(selection)>100 or octet_length(selection::text)>65536 or octet_length(address::text)>4096
  or p_store_credit_amount is null or p_store_credit_amount<0 then raise invalid_parameter_value using message='invalid_subscription_enrollment';end if;
 request_hash:=encode(sha256(convert_to(jsonb_build_array(selection,address,schedule,choices,p_user_coupon_id,p_store_credit_amount)::text,'UTF8')),'hex');
 select * into current from private.goods_subscription_plans where creation_operation_id=p_operation_id for update;
 if found then
  if current.owner_id<>actor or current.creation_request_hash<>request_hash then raise sqlstate 'PT409' using message='subscription_operation_conflict';end if;
  return jsonb_build_object('state','prepared','subscription',private.subscription_plan_summary(current.id,true));
 end if;
 perform private.subscription_lock_actor(actor,true);
 if not(select public_enabled from private.goods_subscription_runtime where singleton) then raise object_not_in_prerequisite_state using message='subscriptions_unavailable';end if;
 if (schedule->>'anchorDate')::date<>(clock_timestamp() at time zone 'Asia/Seoul')::date then
  raise invalid_parameter_value using message='subscription_first_anchor_today';end if;
 if (select count(*) from private.goods_subscription_plans where owner_id=actor and state='draft' and draft_expires_at>clock_timestamp())>=10 then
  raise check_violation using message='subscription_draft_limit';end if;
 source:=private.subscription_source(p_operation_id,terms_id::text);
 first_quote:=private.quote_goods_transaction(actor,source,selection,address,choices,p_user_coupon_id,p_store_credit_amount);
 if first_quote->>'state'<>'quoted' then return first_quote;end if;
 if not private.subscription_selection_allowed(selection,schedule) then
  return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',null)));end if;
 renewal_quote:=private.quote_goods_transaction(actor,source,selection,address,choices,null,0);
 if renewal_quote->>'state'<>'quoted' then return renewal_quote;end if;
 renewal_terms:=private.subscription_renewal_terms(renewal_quote->'display',selection,schedule,address_revision);
 insert into private.goods_subscription_plans(id,owner_id,creation_operation_id,creation_request_hash,first_cycle_id,draft_expires_at)
  values(plan_id,actor,p_operation_id,request_hash,p_operation_id,(first_quote->>'expiresAt')::timestamptz);
 insert into private.goods_subscription_terms(id,plan_id,owner_id,selection,address,address_revision,schedule,delivery_choices,renewal_terms,
  renewal_terms_hash,policy_terms_version,first_quote_id,renewal_quote_id,first_display,renewal_display)
 values(terms_id,plan_id,actor,selection,address,address_revision,schedule,choices,renewal_terms,encode(sha256(convert_to(renewal_terms::text,'UTF8')),'hex'),
  (select terms_version from private.goods_subscription_runtime where singleton),(first_quote->>'quoteId')::uuid,(renewal_quote->>'quoteId')::uuid,first_quote->'display',renewal_quote->'display');
 update private.goods_subscription_plans set current_terms_id=terms_id where id=plan_id;
 insert into private.goods_subscription_cycles(id,plan_id,owner_id,cycle_number,schedule_slot,terms_id,scheduled_at,quote_id)
  values(p_operation_id,plan_id,actor,1,0,terms_id,clock_timestamp(),(first_quote->>'quoteId')::uuid);
 return jsonb_build_object('state','prepared','subscription',private.subscription_plan_summary(plan_id,true));
end $$;

create function private.subscription_operation_replay(p_actor uuid,p_plan uuid,p_operation uuid,p_command text,p_request_hash text) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$declare entry private.goods_subscription_operations;begin
 if p_operation is null then raise invalid_parameter_value using message='invalid_subscription_operation';end if;
 perform pg_advisory_xact_lock(hashtextextended('subscription-operation:'||p_operation::text,0));
 select * into entry from private.goods_subscription_operations where operation_id=p_operation;
 if not found then return null;end if;
 if entry.owner_id<>p_actor or entry.plan_id<>p_plan or entry.command<>p_command or entry.request_hash<>p_request_hash then
  raise sqlstate 'PT409' using message='subscription_operation_conflict';end if;
 return entry.receipt;
end $$;
create function private.subscription_record_operation(p_actor uuid,p_plan uuid,p_operation uuid,p_command text,p_request_hash text,p_receipt jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$begin
 insert into private.goods_subscription_operations(operation_id,owner_id,plan_id,command,request_hash,receipt)
  values(p_operation,p_actor,p_plan,p_command,p_request_hash,p_receipt);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation,p_actor,'subscription.'||p_command,'subscription:'||p_plan::text,
  jsonb_build_object('requestHash',p_request_hash,'revision',p_receipt->'revision','cycleId',p_receipt->'cycleId','orderId',p_receipt->'orderId'));
 return p_receipt;
end $$;

create function public.confirm_my_goods_subscription(p_expected_actor_id uuid,p_plan_id uuid,p_cycle_id uuid,p_expected_revision bigint,
 p_quote_id uuid,p_terms_id uuid,p_credential_id uuid,p_operation_id uuid,p_consent boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
<<subscription_confirm>>
declare actor uuid:=auth.uid();plan private.goods_subscription_plans;terms private.goods_subscription_terms;cycle private.goods_subscription_cycles;
 credential private.billing_credentials;request_hash text;result jsonb;order_id uuid;renewal_quote jsonb;current_renewal jsonb;
begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='subscription_actor_changed';end if;
 perform private.lock_goods_transaction_source(actor,private.subscription_source(p_cycle_id,p_terms_id::text));
 request_hash:=encode(sha256(convert_to(jsonb_build_array(p_cycle_id,p_expected_revision,p_quote_id,p_terms_id,p_credential_id,p_consent)::text,'UTF8')),'hex');
 result:=private.subscription_operation_replay(actor,p_plan_id,p_operation_id,'confirm',request_hash);if result is not null then return result;end if;
 select * into plan from private.goods_subscription_plans where id=p_plan_id and owner_id=actor for update;
 if not found then raise no_data_found using message='subscription_not_found';end if;
 select * into cycle from private.goods_subscription_cycles where id=p_cycle_id and plan_id=p_plan_id for update;
 select * into terms from private.goods_subscription_terms where id=p_terms_id and plan_id=p_plan_id;
 if plan.revision is distinct from p_expected_revision or plan.state<>'draft' or plan.current_terms_id is distinct from p_terms_id
  or cycle.id is null or cycle.id<>plan.first_cycle_id or cycle.state<>'draft' or terms.id is null or terms.first_quote_id is distinct from p_quote_id
  or plan.draft_expires_at<=clock_timestamp() or p_consent is distinct from true then raise sqlstate 'PT409' using message='subscription_enrollment_changed';end if;
 perform private.subscription_lock_actor(actor,true);
 if not(select public_enabled and charge_enabled from private.goods_subscription_runtime where singleton) then
  raise object_not_in_prerequisite_state using message='subscriptions_unavailable';end if;
 if terms.policy_terms_version<>(select terms_version from private.goods_subscription_runtime where singleton) then raise sqlstate 'PT409' using message='subscription_terms_changed';end if;
 select * into credential from private.billing_credentials where id=p_credential_id and owner_id=actor and state='active' for update;
 if not found or not exists(select 1 from private.billing_profiles where id=credential.profile_id and enabled) then
  raise object_not_in_prerequisite_state using message='subscription_card_unavailable';end if;
 renewal_quote:=private.quote_goods_transaction(actor,private.subscription_source(cycle.id,terms.id::text),terms.selection,terms.address,terms.delivery_choices,null,0);
 if renewal_quote->>'state'<>'quoted' or not private.subscription_selection_allowed(terms.selection,terms.schedule) then raise sqlstate 'PT409' using message='subscription_terms_changed';end if;
 current_renewal:=private.subscription_renewal_terms(renewal_quote->'display',terms.selection,terms.schedule,terms.address_revision);
 if current_renewal is distinct from terms.renewal_terms then raise sqlstate 'PT409' using message='subscription_terms_changed';end if;
 order_id:=private.place_goods_transaction(actor,private.subscription_source(cycle.id,terms.id::text),terms.selection,terms.address,p_quote_id,cycle.id,'card');
 update private.goods_subscription_cycles set state='prepared',order_id=subscription_confirm.order_id,revision=revision+1,scheduled_at=clock_timestamp(),updated_at=clock_timestamp() where id=cycle.id;
 update private.goods_subscription_plans set state='awaiting_first_payment',credential_id=p_credential_id,revision=revision+1,consented_at=clock_timestamp(),updated_at=clock_timestamp(),next_run_at=clock_timestamp() where id=p_plan_id returning * into plan;
 result:=jsonb_build_object('operationId',p_operation_id,'planId',p_plan_id,'revision',plan.revision,'state',plan.state,'cycleId',cycle.id,'orderId',order_id);
 return private.subscription_record_operation(actor,p_plan_id,p_operation_id,'confirm',request_hash,result);
end $$;

create function public.get_my_goods_subscriptions(p_expected_actor_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_actor_id then raise insufficient_privilege using message='subscription_actor_changed';end if;
 return coalesce((select jsonb_agg(private.subscription_plan_summary(id,false) order by updated_at desc,id) from
  (select id,updated_at from private.goods_subscription_plans where owner_id=auth.uid() and (state<>'draft' or draft_expires_at>clock_timestamp()) order by updated_at desc,id limit 100) rows),'[]'::jsonb);
end $$;
create function public.get_my_goods_subscription(p_expected_actor_id uuid,p_plan_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_actor_id or not exists(select 1 from private.goods_subscription_plans where id=p_plan_id and owner_id=auth.uid()) then
  raise insufficient_privilege using message='subscription_actor_changed';end if;
 return private.subscription_plan_summary(p_plan_id,true);
end $$;

-- Only proven uncharged orders may take the existing local cancellation path.
create function private.subscription_release_unpaid_order(p_order_id uuid,p_allow_declined boolean default false) returns void
language plpgsql volatile security invoker set search_path='' as $$declare order_state public.order_status;begin
 if p_order_id is null then return;end if;
 select status into order_state from public.orders where id=p_order_id for update;
 if order_state<>'pending' then return;end if;
 if exists(select 1 from public.order_cancellation_requests where order_id=p_order_id and status in('requested','processing','needs_review'))
  or exists(select 1 from public.payments where purpose='order' and ref_id=p_order_id and status in('pending','paid'))
  or exists(select 1 from public.payment_attempts a left join private.payment_provider_bindings b on b.attempt_id=a.id
   where a.purpose='order' and a.ref_id=p_order_id and (a.state not in('prepared','declined') or (b.first_dispatched_at is not null and (not p_allow_declined or a.state<>'declined')))) then return;end if;
 perform public.cancel_order(p_order_id,'정기배송 미청구 회차 정리');
end $$;
create function private.subscription_stop_cycle(p_cycle_id uuid,p_reason text,p_canceled boolean default false) returns void
language plpgsql volatile security invoker set search_path='' as $$declare cycle private.goods_subscription_cycles;begin
 select * into cycle from private.goods_subscription_cycles where id=p_cycle_id for update;
 if not found or cycle.dispatched_at is not null or cycle.state not in('draft','ready','prepared') then return;end if;
 perform private.subscription_release_unpaid_order(cycle.order_id);
 update private.goods_subscription_cycles set state=case when p_canceled then 'canceled' else 'skipped' end,safe_reason=p_reason,
  claim_token=null,lease_until=null,claim_fence=claim_fence+1,revision=revision+1,updated_at=clock_timestamp() where id=p_cycle_id;
end $$;
create function public.change_my_goods_subscription_state(p_expected_actor_id uuid,p_plan_id uuid,p_expected_revision bigint,p_operation_id uuid,p_command text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare actor uuid:=auth.uid();plan private.goods_subscription_plans;cycle_id uuid;request_hash text;result jsonb;begin
 if actor is null or actor is distinct from p_expected_actor_id or p_command is null or p_command not in('pause','cancel') then
  raise insufficient_privilege using message='subscription_actor_changed';end if;
 perform private.subscription_lock_actor(actor,false);
 request_hash:=encode(sha256(convert_to(jsonb_build_array(p_expected_revision,p_command)::text,'UTF8')),'hex');
 result:=private.subscription_operation_replay(actor,p_plan_id,p_operation_id,p_command,request_hash);if result is not null then return result;end if;
 select * into plan from private.goods_subscription_plans where id=p_plan_id and owner_id=actor for update;
 if not found then raise no_data_found using message='subscription_not_found';end if;
 if plan.revision is distinct from p_expected_revision or (p_command='pause' and plan.state not in('active','awaiting_first_payment','needs_confirmation')) then
  raise sqlstate 'PT409' using message='subscription_state_changed';end if;
 if plan.state<>'canceled' then
  for cycle_id in select id from private.goods_subscription_cycles where plan_id=p_plan_id and state in('draft','ready','prepared') order by id loop
   perform private.subscription_stop_cycle(cycle_id,case when p_command='cancel' then 'customer_canceled' else 'customer_paused' end,p_command='cancel');
  end loop;
  update private.goods_subscription_plans set state=case when p_command='cancel' then 'canceled' else 'paused' end,
   pause_reason=case when p_command='pause' then 'customer_paused' else null end,canceled_at=case when p_command='cancel' then clock_timestamp() else null end,
   next_run_at=null,revision=revision+1,updated_at=clock_timestamp() where id=p_plan_id returning * into plan;
 end if;
 result:=jsonb_build_object('operationId',p_operation_id,'planId',p_plan_id,'revision',plan.revision,'state',plan.state);
 return private.subscription_record_operation(actor,p_plan_id,p_operation_id,p_command,request_hash,result);
end $$;

create function private.subscription_sync_cycle_outcome(p_cycle_id uuid,p_outcome public.payment_attempt_state) returns void
language plpgsql volatile security invoker set search_path='' as $$
declare cycle private.goods_subscription_cycles;plan private.goods_subscription_plans;terms private.goods_subscription_terms;slot integer;due timestamptz;new_cycle uuid;
begin
 select * into cycle from private.goods_subscription_cycles where id=p_cycle_id for update;
 if not found then raise no_data_found using message='subscription_cycle_not_found';end if;
 if cycle.state in('approved','declined','canceled','skipped') then return;end if;
 select * into plan from private.goods_subscription_plans where id=cycle.plan_id for update;
 if p_outcome not in('approved','declined','canceled','unknown','needs_review') then raise invalid_parameter_value using message='invalid_subscription_outcome';end if;
 update private.goods_subscription_cycles set state=p_outcome::text,claim_token=null,lease_until=null,claim_fence=claim_fence+1,revision=revision+1,
  settled_at=case when p_outcome in('approved','declined','canceled') then clock_timestamp() end,
  next_check_at=case when p_outcome='unknown' and claim_fence<12 then clock_timestamp()+interval '5 minutes' end,
  safe_reason=case when p_outcome='approved' then null when p_outcome='declined' then 'payment_failed' else 'payment_review' end,updated_at=clock_timestamp()
  where id=p_cycle_id;
 if p_outcome='unknown' and cycle.claim_fence>=12 then
  update private.goods_subscription_cycles set state='needs_review',next_check_at=null where id=p_cycle_id;
  p_outcome:='needs_review';
 end if;
 if p_outcome='approved' and (plan.state in('active','awaiting_first_payment') or plan.state='paused' and plan.pause_reason='payment_review') then
  select * into terms from private.goods_subscription_terms where id=plan.current_terms_id;
  slot:=case when terms.id=cycle.terms_id then cycle.schedule_slot+1 else 0 end;
  if slot>1200 then
   update private.goods_subscription_plans set state='paused',pause_reason='schedule_missed',next_run_at=null,revision=revision+1,updated_at=clock_timestamp() where id=plan.id;return;
  end if;
  due:=private.subscription_slot_at(terms.schedule,slot);
  if due<=clock_timestamp() then
   update private.goods_subscription_plans set state='paused',pause_reason='schedule_missed',next_run_at=null,revision=revision+1,updated_at=clock_timestamp() where id=plan.id;return;
  end if;
  new_cycle:=gen_random_uuid();
  insert into private.goods_subscription_cycles(id,plan_id,owner_id,cycle_number,schedule_slot,terms_id,scheduled_at,state)
   values(new_cycle,plan.id,plan.owner_id,plan.last_cycle_number+1,slot,terms.id,due,'ready');
  update private.goods_subscription_plans set state='active',pause_reason=null,next_slot=slot,next_run_at=due,
   last_cycle_number=last_cycle_number+1,revision=revision+1,updated_at=clock_timestamp() where id=plan.id;
 elsif p_outcome in('declined','canceled') then
  if p_outcome='declined' then perform private.subscription_release_unpaid_order(cycle.order_id,true);end if;
  update private.goods_subscription_plans set state='paused',pause_reason='payment_failed',next_run_at=null,revision=revision+1,updated_at=clock_timestamp()
   where id=plan.id and state in('active','awaiting_first_payment');
 elsif p_outcome='needs_review' then
  update private.goods_subscription_plans set state='paused',pause_reason='payment_review',next_run_at=null,revision=revision+1,updated_at=clock_timestamp()
   where id=plan.id and state in('active','awaiting_first_payment');
 end if;
end $$;

-- This claim never waits on an actor lock while holding the SKIP LOCKED row.
-- Its transaction ends before source/plan/catalog locks or provider IO begin.
create function public.service_claim_goods_subscription_work(p_claim_token uuid,p_cycle_id uuid default null,p_manual_review boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare cycle private.goods_subscription_cycles;begin
 perform private.subscription_require_service();
 if p_claim_token is null or p_manual_review is null or p_manual_review and p_cycle_id is null then raise invalid_parameter_value using message='invalid_subscription_claim';end if;
 select c.* into cycle from private.goods_subscription_cycles c where (p_cycle_id is null or c.id=p_cycle_id)
  and (c.claim_token is null or c.lease_until<=clock_timestamp()) and (
   (not p_manual_review and c.dispatched_at is null and c.state in('ready','prepared') and c.scheduled_at<=clock_timestamp()
    and (select worker_enabled and charge_enabled from private.goods_subscription_runtime where singleton))
   or (c.dispatched_at is not null and (c.state in('dispatching','unknown') or p_manual_review and c.state='needs_review')
    and (p_manual_review or coalesce(c.next_check_at,c.scheduled_at)<=clock_timestamp())))
 order by coalesce(c.next_check_at,c.scheduled_at),c.id for update skip locked limit 1;
 if not found then return null;end if;
 update private.goods_subscription_cycles set claim_token=p_claim_token,lease_until=clock_timestamp()+interval '10 minutes',claim_fence=claim_fence+1,
  updated_at=clock_timestamp() where id=cycle.id returning * into cycle;
 return jsonb_build_object('cycleId',cycle.id,'actorId',cycle.owner_id,'termsId',cycle.terms_id,'token',cycle.claim_token,'fence',cycle.claim_fence,'expiresAt',cycle.lease_until,'profile',(select jsonb_build_object('profileId',p.id,'merchantId',p.merchant_id,'environment',p.environment)
  from private.billing_profiles p where p.id=coalesce((select b.profile_id from private.payment_provider_bindings b where b.cycle_id=cycle.id),
   (select c.profile_id from private.billing_credentials c join private.goods_subscription_plans g on g.credential_id=c.id where g.id=cycle.plan_id))));
end $$;

create function public.service_prepare_goods_subscription_work(p_actor_id uuid,p_cycle_id uuid,p_claim_token uuid,p_claim_fence bigint,p_profile_id uuid,p_write_key_version text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
<<subscription_work>>
declare cycle private.goods_subscription_cycles;plan private.goods_subscription_plans;terms private.goods_subscription_terms;credential private.billing_credentials;
 profile private.billing_profiles;attempt public.payment_attempts;quoted jsonb;current_terms jsonb;attempt_data jsonb;claim_data jsonb;reason text;
 order_id uuid;enabled boolean;at_time timestamptz;
begin
 perform private.subscription_require_service();perform private.lock_goods_transaction_source(p_actor_id,private.subscription_source(p_cycle_id,'work'));
 select * into cycle from private.goods_subscription_cycles where id=p_cycle_id and owner_id=p_actor_id;
 if not found then raise no_data_found using message='subscription_cycle_not_found';end if;
 select * into plan from private.goods_subscription_plans where id=cycle.plan_id and owner_id=p_actor_id for update;
 select * into cycle from private.goods_subscription_cycles where id=p_cycle_id for update;
 if p_claim_token is null or p_claim_fence is null or p_claim_fence<1 or cycle.claim_token is null or cycle.lease_until is null
  or cycle.claim_token is distinct from p_claim_token or cycle.claim_fence is distinct from p_claim_fence or cycle.lease_until<=clock_timestamp() then
  raise sqlstate 'PT409' using message='subscription_claim_stale';end if;
 if cycle.dispatched_at is not null then
  claim_data:=public.claim_goods_payment_reconciliation(cycle.attempt_id,p_claim_token,'subscription_'||replace(cycle.id::text,'-',''));
  if claim_data->>'claim_status'='terminal' then
   perform private.subscription_sync_cycle_outcome(cycle.id,(claim_data->>'outcome')::public.payment_attempt_state);
   return jsonb_build_object('kind','terminal','outcome',claim_data->>'outcome','orderId',
    case when claim_data->>'outcome'='approved' and exists(select 1 from public.orders where id=cycle.order_id and user_id=p_actor_id and status not in('pending','canceled')) then cycle.order_id end);
  elsif claim_data->>'claim_status'<>'claimed' then
   update private.goods_subscription_cycles set claim_token=null,lease_until=null,next_check_at=clock_timestamp()+interval '5 minutes' where id=cycle.id;
   return jsonb_build_object('kind','wait');
  end if;
  return jsonb_build_object('kind','inspect','attempt',claim_data->'attempt','binding',public.service_get_payment_gateway_binding(cycle.attempt_id));
 end if;
 if plan.state not in('active','awaiting_first_payment') then
  perform private.subscription_stop_cycle(cycle.id,'plan_stopped',plan.state='canceled');return jsonb_build_object('kind','stopped');end if;
 if cycle.state not in('ready','prepared') or cycle.scheduled_at>clock_timestamp() then raise object_not_in_prerequisite_state using message='subscription_cycle_not_due';end if;
 reason:=null;
 begin perform private.subscription_lock_actor(p_actor_id,true);exception when insufficient_privilege then reason:='account_unavailable';end;
 if cycle.scheduled_at<clock_timestamp()-interval '24 hours' then reason:='schedule_missed';end if;
 select * into terms from private.goods_subscription_terms where id=cycle.terms_id;
 if cycle.terms_id<>plan.current_terms_id or terms.policy_terms_version<>(select terms_version from private.goods_subscription_runtime where singleton) then reason:='terms_changed';end if;
 select * into credential from private.billing_credentials where id=plan.credential_id and owner_id=p_actor_id for update;
 if not found or credential.state<>'active' or credential.envelope is null then reason:='card_unavailable';end if;
 if reason is not null then
  perform private.subscription_stop_cycle(cycle.id,reason);
  update private.goods_subscription_plans set state=case when reason='terms_changed' then 'needs_confirmation' else 'paused' end,
   pause_reason=reason,next_run_at=null,revision=revision+1,updated_at=clock_timestamp() where id=plan.id;
  return jsonb_build_object('kind','stopped','reason',reason);
 end if;
 select * into profile from private.billing_profiles where id=credential.profile_id for share;
 if profile.id is distinct from p_profile_id or not profile.enabled or p_write_key_version is null or p_write_key_version!~'^[A-Za-z0-9_-]{1,64}$' then
  raise object_not_in_prerequisite_state using message='subscription_profile_unavailable';end if;
 if cycle.order_id is not null then
  perform 1 from public.orders where id=cycle.order_id for update;
  if not exists(select 1 from public.orders where id=cycle.order_id and status='pending' and expires_at>clock_timestamp()) then
   perform private.subscription_stop_cycle(cycle.id,'order_unavailable');
   update private.goods_subscription_plans set state='paused',pause_reason='payment_failed',next_run_at=null,revision=revision+1,updated_at=clock_timestamp() where id=plan.id;
   return jsonb_build_object('kind','stopped','reason','payment_failed');end if;
  perform private.lock_goods_transaction_catalog(p_actor_id,terms.selection,null);
 else
  quoted:=private.quote_goods_transaction(p_actor_id,private.subscription_source(cycle.id,terms.id::text),terms.selection,terms.address,terms.delivery_choices,null,0);
  if quoted->>'state'<>'quoted' then reason:=case when quoted#>>'{issues,0,code}' in('shipping_unresolved','collect_not_ready','delivery_choice_required') then 'delivery_unavailable' else 'goods_unavailable' end;
  else
   current_terms:=private.subscription_renewal_terms(quoted->'display',terms.selection,terms.schedule,terms.address_revision);
   if current_terms is distinct from terms.renewal_terms then reason:='terms_changed';end if;
  end if;
 end if;
 if not private.subscription_selection_allowed(terms.selection,terms.schedule) then reason:='goods_unavailable';end if;
 if reason is not null then
  perform private.subscription_stop_cycle(cycle.id,reason);
  update private.goods_subscription_plans set state=case when reason='terms_changed' then 'needs_confirmation' else 'paused' end,
   pause_reason=reason,next_run_at=null,revision=revision+1,updated_at=clock_timestamp() where id=plan.id;
  return jsonb_build_object('kind','stopped','reason',reason);
 end if;
 select charge_enabled into enabled from private.goods_subscription_runtime where singleton for share;
 if not enabled then
  update private.goods_subscription_cycles set claim_token=null,lease_until=null where id=cycle.id;return jsonb_build_object('kind','gate_closed');end if;
 if cycle.order_id is null then
  order_id:=private.place_goods_transaction(p_actor_id,private.subscription_source(cycle.id,terms.id::text),terms.selection,terms.address,(quoted->>'quoteId')::uuid,cycle.id,'card');
  update private.goods_subscription_cycles set order_id=subscription_work.order_id,quote_id=(quoted->>'quoteId')::uuid,state='prepared',revision=revision+1 where id=cycle.id;
 else order_id:=cycle.order_id;end if;
 attempt_data:=public.prepare_goods_payment_attempt(p_actor_id,order_id,'toss');
 select * into attempt from public.payment_attempts where id=(attempt_data->>'id')::uuid for update;
 if attempt.state<>'prepared' or attempt.user_id<>p_actor_id then raise object_not_in_prerequisite_state using message='subscription_attempt_unavailable';end if;
 at_time:=clock_timestamp();
 insert into private.payment_provider_bindings(attempt_id,integration,owner_id,profile_id,merchant_id,environment,credential_id,cycle_id,write_key_version,first_dispatched_at)
  values(attempt.id,'toss_billing',p_actor_id,profile.id,profile.merchant_id,profile.environment,credential.id,cycle.id,p_write_key_version,at_time);
 update public.payment_attempts set state='confirming',claim_token=p_claim_token,claim_expires_at=at_time+interval '10 minutes' where id=attempt.id;
 update private.goods_subscription_cycles set attempt_id=attempt.id,state='dispatching',dispatched_at=at_time,revision=revision+1,updated_at=at_time where id=cycle.id;
 return jsonb_build_object('kind','charge','attempt',attempt_data,'binding',public.service_get_payment_gateway_binding(attempt.id),
  'customerKey',(select customer_key from private.billing_customers where id=credential.customer_id),'envelope',credential.envelope);
end $$;

create function public.service_finish_goods_subscription_work(p_actor_id uuid,p_cycle_id uuid,p_claim_token uuid,p_claim_fence bigint,
 p_outcome public.payment_attempt_state,p_provider_payment_key text default null,p_provider_transaction_id text default null,
 p_provider_approval_reference text default null,p_result_code text default null,p_payment_method text default null,p_masked_payment_method text default null,p_approved_at timestamptz default null)
returns public.payment_attempt_state language plpgsql volatile security definer set search_path='' as $$
declare cycle private.goods_subscription_cycles;result public.payment_attempt_state;begin
 perform private.subscription_require_service();perform private.lock_goods_transaction_source(p_actor_id,private.subscription_source(p_cycle_id,'finish'));
 select * into cycle from private.goods_subscription_cycles where id=p_cycle_id and owner_id=p_actor_id;
 if not found then raise no_data_found using message='subscription_cycle_not_found';end if;
 perform 1 from private.goods_subscription_plans where id=cycle.plan_id for update;
 select * into cycle from private.goods_subscription_cycles where id=p_cycle_id for update;
 if cycle.state in('approved','declined','canceled') then return cycle.state::public.payment_attempt_state;end if;
 if p_claim_token is null or p_claim_fence is null or p_claim_fence<1 or cycle.claim_token is null or cycle.lease_until is null
  or cycle.claim_token is distinct from p_claim_token or cycle.claim_fence is distinct from p_claim_fence or cycle.lease_until<=clock_timestamp() then
  raise sqlstate 'PT409' using message='subscription_claim_stale';end if;
 if cycle.attempt_id is null or cycle.dispatched_at is null then raise object_not_in_prerequisite_state using message='subscription_not_dispatched';end if;
 result:=public.finalize_goods_payment_attempt(cycle.attempt_id,p_claim_token,p_outcome,p_provider_payment_key,p_provider_transaction_id,
  p_provider_approval_reference,p_result_code,p_payment_method,p_masked_payment_method,p_approved_at);
 update private.goods_payment_reconciliation_audits set claim_status='terminal',outcome=result,finalized_at=clock_timestamp()
  where claim_token=p_claim_token and operation='payment' and target_id=cycle.attempt_id;
 perform private.subscription_sync_cycle_outcome(cycle.id,result);return result;
end $$;

create function public.service_finalize_subscription_payment_reconciliation(p_attempt_id uuid,p_claim_token uuid,p_outcome public.payment_attempt_state,
 p_provider_payment_key text default null,p_provider_transaction_id text default null,p_provider_approval_reference text default null,
 p_result_code text default null,p_payment_method text default null,p_masked_payment_method text default null,p_approved_at timestamptz default null)
returns public.payment_attempt_state language plpgsql volatile security definer set search_path='' as $$
declare binding private.payment_provider_bindings;cycle private.goods_subscription_cycles;result public.payment_attempt_state;begin
 perform private.subscription_require_service();
 select * into binding from private.payment_provider_bindings where attempt_id=p_attempt_id;
 if not found then raise no_data_found using message='billing_binding_missing';end if;
 perform private.lock_goods_transaction_source(binding.owner_id,private.subscription_source(binding.cycle_id,'reconcile'));
 select * into cycle from private.goods_subscription_cycles where id=binding.cycle_id;
 if not found then
  return public.finalize_goods_payment_reconciliation(p_attempt_id,p_claim_token,p_outcome,p_provider_payment_key,p_provider_transaction_id,
   p_provider_approval_reference,p_result_code,p_payment_method,p_masked_payment_method,p_approved_at);
 end if;
 perform 1 from private.goods_subscription_plans where id=cycle.plan_id for update;
 perform 1 from private.goods_subscription_cycles where id=cycle.id for update;
 result:=public.finalize_goods_payment_reconciliation(p_attempt_id,p_claim_token,p_outcome,p_provider_payment_key,p_provider_transaction_id,
  p_provider_approval_reference,p_result_code,p_payment_method,p_masked_payment_method,p_approved_at);
 perform private.subscription_sync_cycle_outcome(cycle.id,result);return result;
end $$;

create function public.prepare_my_goods_subscription_change(p_expected_actor_id uuid,p_plan_id uuid,p_expected_revision bigint,p_operation_id uuid,
 p_command text,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();plan private.goods_subscription_plans;old_terms private.goods_subscription_terms;proposal private.goods_subscription_proposals;
 terms private.goods_subscription_terms;terms_id uuid:=gen_random_uuid();address_revision uuid:=gen_random_uuid();schedule jsonb;address jsonb;choices jsonb;request_hash text;
 quoted jsonb;renewal_terms jsonb;due timestamptz;result jsonb;
begin
 if actor is null or actor is distinct from p_expected_actor_id or p_operation_id is null or p_command is null
  or p_command not in('resume','change_schedule','change_destination','replace_card','accept_terms') then raise invalid_parameter_value using message='invalid_subscription_change';end if;
 perform private.lock_goods_transaction_source(actor,private.subscription_source(p_operation_id,'proposal'));
 if not coalesce(private.subscription_json_keys(p_payload,case when p_command='change_destination' then array['schedule','address','deliveryChoices'] else array['schedule'] end),false) then
  raise invalid_parameter_value using message='invalid_subscription_change';end if;
 schedule:=private.subscription_normalize_schedule(p_payload->'schedule');
 request_hash:=encode(sha256(convert_to(jsonb_build_array(p_plan_id,p_expected_revision,p_command,p_payload)::text,'UTF8')),'hex');
 select * into proposal from private.goods_subscription_proposals where id=p_operation_id;
 if found then
  if proposal.owner_id<>actor or proposal.plan_id<>p_plan_id or proposal.request_hash<>request_hash then raise sqlstate 'PT409' using message='subscription_operation_conflict';end if;
  select * into terms from private.goods_subscription_terms where id=proposal.terms_id;
  return jsonb_build_object('id',proposal.id,'planId',proposal.plan_id,'expectedRevision',proposal.expected_revision,'command',proposal.command,
   'termsId',terms.id,'quoteId',terms.renewal_quote_id,'expiresAt',proposal.expires_at,'schedule',terms.schedule,'address',terms.address,
   'deliveryChoices',terms.delivery_choices,'display',terms.renewal_display,'policyTermsVersion',terms.policy_terms_version);
 end if;
 select * into plan from private.goods_subscription_plans where id=p_plan_id and owner_id=actor for update;
 if not found then raise no_data_found using message='subscription_not_found';end if;
 if plan.revision is distinct from p_expected_revision or plan.state not in('active','paused','needs_confirmation') then
  raise sqlstate 'PT409' using message='subscription_state_changed';end if;
 perform private.subscription_lock_actor(actor,true);
 if exists(select 1 from private.goods_subscription_cycles where plan_id=p_plan_id and dispatched_at is not null and state in('dispatching','unknown','needs_review')) then
  raise object_not_in_prerequisite_state using message='subscription_payment_pending';end if;
 due:=private.subscription_slot_at(schedule,0);
 if due<=clock_timestamp()+interval '5 minutes' or due>clock_timestamp()+interval '366 days' then
  raise invalid_parameter_value using message='subscription_future_schedule_required';end if;
 select * into old_terms from private.goods_subscription_terms where id=plan.current_terms_id;
 address:=case when p_command='change_destination' then private.normalize_goods_transaction_address(p_payload->'address') else old_terms.address end;
 choices:=case when p_command='change_destination' then private.normalize_goods_transaction_choices(p_payload->'deliveryChoices',old_terms.selection) else old_terms.delivery_choices end;
 if (select count(*) from private.goods_subscription_proposals where owner_id=actor and expires_at>clock_timestamp())>=10 then
  raise check_violation using message='subscription_proposal_limit';end if;
 quoted:=private.quote_goods_transaction(actor,private.subscription_source(p_operation_id,terms_id::text),old_terms.selection,address,choices,null,0);
 if quoted->>'state'<>'quoted' then return quoted;end if;
 if not private.subscription_selection_allowed(old_terms.selection,schedule) then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',null)));end if;
 renewal_terms:=private.subscription_renewal_terms(quoted->'display',old_terms.selection,schedule,address_revision);
 insert into private.goods_subscription_terms(id,plan_id,owner_id,selection,address,address_revision,schedule,delivery_choices,renewal_terms,renewal_terms_hash,
  policy_terms_version,renewal_quote_id,first_display,renewal_display)
 values(terms_id,p_plan_id,actor,old_terms.selection,address,address_revision,schedule,choices,renewal_terms,encode(sha256(convert_to(renewal_terms::text,'UTF8')),'hex'),
  (select terms_version from private.goods_subscription_runtime where singleton),(quoted->>'quoteId')::uuid,old_terms.first_display,quoted->'display');
 insert into private.goods_subscription_proposals(id,owner_id,plan_id,expected_revision,terms_id,command,request_hash,expires_at)
  values(p_operation_id,actor,p_plan_id,p_expected_revision,terms_id,p_command,request_hash,(quoted->>'expiresAt')::timestamptz);
 return jsonb_build_object('id',p_operation_id,'planId',p_plan_id,'expectedRevision',p_expected_revision,'command',p_command,
  'termsId',terms_id,'quoteId',quoted->'quoteId','expiresAt',quoted->'expiresAt','schedule',schedule,'address',address,
  'deliveryChoices',choices,'display',quoted->'display','policyTermsVersion',(select terms_version from private.goods_subscription_runtime where singleton));
end $$;

create function public.confirm_my_goods_subscription_change(p_expected_actor_id uuid,p_plan_id uuid,p_expected_revision bigint,p_proposal_id uuid,
 p_terms_id uuid,p_quote_id uuid,p_credential_id uuid,p_operation_id uuid,p_consent boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();plan private.goods_subscription_plans;proposal private.goods_subscription_proposals;terms private.goods_subscription_terms;
 credential private.billing_credentials;request_hash text;result jsonb;quoted jsonb;renewal_terms jsonb;cycle_id uuid;due timestamptz;
begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='subscription_actor_changed';end if;
 perform private.lock_goods_transaction_source(actor,private.subscription_source(p_proposal_id,p_terms_id::text));
 select * into proposal from private.goods_subscription_proposals where id=p_proposal_id and owner_id=actor and plan_id=p_plan_id;
 if not found then raise no_data_found using message='subscription_proposal_not_found';end if;
 request_hash:=encode(sha256(convert_to(jsonb_build_array(p_expected_revision,p_proposal_id,p_terms_id,p_quote_id,p_credential_id,p_consent)::text,'UTF8')),'hex');
 result:=private.subscription_operation_replay(actor,p_plan_id,p_operation_id,proposal.command,request_hash);if result is not null then return result;end if;
 select * into plan from private.goods_subscription_plans where id=p_plan_id and owner_id=actor for update;
 if plan.revision is distinct from p_expected_revision or proposal.expected_revision<>p_expected_revision or plan.state not in('active','paused','needs_confirmation')
  or proposal.terms_id is distinct from p_terms_id or proposal.expires_at<=clock_timestamp() or p_consent is distinct from true then
  raise sqlstate 'PT409' using message='subscription_proposal_changed';end if;
 perform private.subscription_lock_actor(actor,true);
 if not(select charge_enabled from private.goods_subscription_runtime where singleton) then raise object_not_in_prerequisite_state using message='subscriptions_unavailable';end if;
 if exists(select 1 from private.goods_subscription_cycles where plan_id=p_plan_id and dispatched_at is not null and state in('dispatching','unknown','needs_review')) then
  raise object_not_in_prerequisite_state using message='subscription_payment_pending';end if;
 select * into terms from private.goods_subscription_terms where id=p_terms_id and plan_id=p_plan_id;
 if not found or terms.renewal_quote_id is distinct from p_quote_id or terms.policy_terms_version<>(select terms_version from private.goods_subscription_runtime where singleton) then
  raise sqlstate 'PT409' using message='subscription_terms_changed';end if;
 due:=private.subscription_slot_at(terms.schedule,0);if due<=clock_timestamp() then raise sqlstate 'PT409' using message='subscription_future_schedule_required';end if;
 select * into credential from private.billing_credentials where id=p_credential_id and owner_id=actor and state='active' for update;
 if not found or not exists(select 1 from private.billing_profiles where id=credential.profile_id and enabled) then
  raise object_not_in_prerequisite_state using message='subscription_card_unavailable';end if;
 quoted:=private.quote_goods_transaction(actor,private.subscription_source(p_proposal_id,terms.id::text),terms.selection,terms.address,terms.delivery_choices,null,0);
 if quoted->>'state'<>'quoted' or not private.subscription_selection_allowed(terms.selection,terms.schedule) then raise sqlstate 'PT409' using message='subscription_terms_changed';end if;
 renewal_terms:=private.subscription_renewal_terms(quoted->'display',terms.selection,terms.schedule,terms.address_revision);
 if renewal_terms is distinct from terms.renewal_terms then raise sqlstate 'PT409' using message='subscription_terms_changed';end if;
 for cycle_id in select id from private.goods_subscription_cycles where plan_id=p_plan_id and state in('draft','ready','prepared') order by id loop
  perform private.subscription_stop_cycle(cycle_id,'terms_replaced');
 end loop;
 insert into private.goods_subscription_cycles(id,plan_id,owner_id,cycle_number,schedule_slot,terms_id,scheduled_at,state)
  values(p_proposal_id,p_plan_id,actor,plan.last_cycle_number+1,0,terms.id,due,'ready');
 update private.goods_subscription_plans set state='active',pause_reason=null,current_terms_id=terms.id,credential_id=credential.id,
  next_slot=0,next_run_at=due,last_cycle_number=last_cycle_number+1,revision=revision+1,consented_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_plan_id returning * into plan;
 result:=jsonb_build_object('operationId',p_operation_id,'planId',p_plan_id,'revision',plan.revision,'state',plan.state,'cycleId',p_proposal_id);
 return private.subscription_record_operation(actor,p_plan_id,p_operation_id,proposal.command,request_hash,result);
end $$;

create function public.get_goods_subscription_offers(p_good_ids text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if p_good_ids is null or cardinality(p_good_ids) not between 1 and 100 then raise invalid_parameter_value using message='invalid_subscription_goods';end if;
 if not(select public_enabled and charge_enabled and worker_enabled from private.goods_subscription_runtime where singleton)
  or not(select enabled from private.goods_transaction_runtime where singleton) then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('goodId',g.id,'intervals',p.intervals,'message',p.message) order by g.id)
  from public.goods g join private.goods_subscription_policies p on p.good_id=g.id and p.enabled
  join public.ips ip on ip.id=g.ip_id and ip.archived_at is null and ip.published_at is not null
  where g.id=any(p_good_ids) and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
   and g.allow_card_payment and exists(select 1 from public.goods_variants where good_id=g.id and archived_at is null and preorder_policy_id is null)),'[]'::jsonb);
end $$;

alter table private.billing_credentials add column revoke_claim_token uuid,add column revoke_lease_until timestamptz,
 add column revoke_fence bigint not null default 0,add column revoke_next_check_at timestamptz,
 add constraint billing_credential_revoke_lease_pair check((revoke_claim_token is null)=(revoke_lease_until is null));
create table private.billing_credential_operations (
 operation_id uuid primary key,owner_id uuid not null references public.profiles(id),credential_id uuid not null references private.billing_credentials(id),
 expected_revision bigint not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create function public.request_my_billing_credential_revocation(p_expected_actor_id uuid,p_credential_id uuid,p_expected_revision bigint,p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare actor uuid:=auth.uid();credential private.billing_credentials;operation private.billing_credential_operations;result jsonb;begin
 if actor is null or actor is distinct from p_expected_actor_id or p_operation_id is null then raise insufficient_privilege using message='subscription_actor_changed';end if;
 perform private.subscription_lock_actor(actor,false);
 perform pg_advisory_xact_lock(hashtextextended('billing-credential-operation:'||p_operation_id::text,0));
 select * into operation from private.billing_credential_operations where operation_id=p_operation_id;
 if found then
  if operation.owner_id<>actor or operation.credential_id<>p_credential_id or operation.expected_revision is distinct from p_expected_revision then
   raise sqlstate 'PT409' using message='billing_credential_operation_conflict';end if;return operation.receipt;
 end if;
 select * into credential from private.billing_credentials where id=p_credential_id and owner_id=actor for update;
 if not found then raise no_data_found using message='billing_credential_not_found';end if;
 if credential.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='billing_credential_changed';end if;
 if exists(select 1 from private.goods_subscription_plans where credential_id=p_credential_id and state in('active','awaiting_first_payment','paused','needs_confirmation'))
  or exists(select 1 from private.goods_subscription_cycles c join private.payment_provider_bindings b on b.cycle_id=c.id
   where b.credential_id=p_credential_id and c.state in('dispatching','unknown','needs_review')) then
  raise object_not_in_prerequisite_state using message='billing_credential_in_use';end if;
 if credential.state<>'revoked' then
  update private.billing_credentials set state='revoking',revision=revision+1,revoke_next_check_at=clock_timestamp() where id=p_credential_id returning * into credential;
 end if;
 result:=jsonb_build_object('operationId',p_operation_id,'credentialId',credential.id,'revision',credential.revision,'state',credential.state);
 insert into private.billing_credential_operations(operation_id,owner_id,credential_id,expected_revision,receipt)
  values(p_operation_id,actor,p_credential_id,p_expected_revision,result);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'billing.card.revocation_requested','billing-credential:'||p_credential_id::text,
  jsonb_build_object('revision',credential.revision,'state',credential.state));return result;
end $$;
create function public.service_list_billing_credential_revocations(p_limit integer default 10) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 perform private.subscription_require_service();if p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value using message='invalid_billing_batch';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'actorId',owner_id) order by created_at,id) from
  (select id,owner_id,created_at from private.billing_credentials where state='revoking' and coalesce(revoke_next_check_at,created_at)<=clock_timestamp()
   and (revoke_claim_token is null or revoke_lease_until<=clock_timestamp()) order by created_at,id limit p_limit) rows),'[]'::jsonb);
end $$;
create function public.service_claim_billing_credential_revocation(p_actor_id uuid,p_credential_id uuid,p_claim_token uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare credential private.billing_credentials;begin
 perform private.subscription_require_service();perform private.subscription_lock_actor(p_actor_id,false);
 if p_claim_token is null then raise invalid_parameter_value using message='invalid_billing_claim';end if;
 select * into credential from private.billing_credentials where id=p_credential_id and owner_id=p_actor_id for update;
 if not found or credential.state<>'revoking' or credential.revoke_claim_token is not null and credential.revoke_lease_until>clock_timestamp() then return null;end if;
 if exists(select 1 from private.goods_subscription_plans where credential_id=p_credential_id and state in('active','awaiting_first_payment','paused','needs_confirmation'))
  or exists(select 1 from private.goods_subscription_cycles c join private.payment_provider_bindings b on b.cycle_id=c.id
   where b.credential_id=p_credential_id and c.state in('dispatching','unknown','needs_review')) then return null;end if;
 update private.billing_credentials set revoke_claim_token=p_claim_token,revoke_lease_until=clock_timestamp()+interval '10 minutes',revoke_fence=revoke_fence+1
  where id=p_credential_id returning * into credential;
 return jsonb_build_object('id',credential.id,'ownerId',credential.owner_id,'claimToken',credential.revoke_claim_token,'claimFence',credential.revoke_fence,
  'expiresAt',credential.revoke_lease_until,'envelope',credential.envelope,'profile',(select jsonb_build_object('profileId',p.id,'merchantId',p.merchant_id,'environment',p.environment)
   from private.billing_profiles p where p.id=credential.profile_id));
end $$;
create function public.service_finish_billing_credential_revocation(p_actor_id uuid,p_credential_id uuid,p_claim_token uuid,p_claim_fence bigint,p_state text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare credential private.billing_credentials;begin
 perform private.subscription_require_service();perform private.subscription_lock_actor(p_actor_id,false);
 select * into credential from private.billing_credentials where id=p_credential_id and owner_id=p_actor_id for update;
 if not found then raise no_data_found using message='billing_credential_not_found';end if;
 if credential.state='revoked' then return jsonb_build_object('id',credential.id,'state','revoked','revision',credential.revision);end if;
 if credential.state<>'revoking' or p_claim_token is null or p_claim_fence is null or p_claim_fence<1
  or credential.revoke_claim_token is null or credential.revoke_lease_until is null
  or credential.revoke_claim_token is distinct from p_claim_token or credential.revoke_fence is distinct from p_claim_fence or credential.revoke_lease_until<=clock_timestamp() then
  raise sqlstate 'PT409' using message='billing_credential_claim_stale';end if;
 if p_state is null or p_state not in('revoked','unknown','needs_review') then raise invalid_parameter_value using message='invalid_billing_revoke_result';end if;
 update private.billing_credentials set state=case when p_state='revoked' then 'revoked' when p_state='needs_review' or revoke_fence>=12 then 'needs_review' else 'revoking' end,
  envelope=case when p_state='revoked' then null else envelope end,revoked_at=case when p_state='revoked' then clock_timestamp() end,
  revoke_claim_token=null,revoke_lease_until=null,revoke_next_check_at=case when p_state='unknown' and revoke_fence<12 then clock_timestamp()+interval '5 minutes' end,
  revision=revision+1 where id=p_credential_id returning * into credential;
 return jsonb_build_object('id',credential.id,'state',credential.state,'revision',credential.revision);
end $$;

create function private.goods_subscription_account_blockers(p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(reason order by reason),'[]'::jsonb) from (
  select 'subscription_active'::text as reason where exists(select 1 from private.goods_subscription_plans where owner_id=p_actor and state in('active','awaiting_first_payment','paused','needs_confirmation'))
  union all select 'subscription_payment_pending' where exists(select 1 from private.goods_subscription_cycles where owner_id=p_actor and state in('prepared','dispatching','unknown','needs_review'))
  union all select 'billing_registration_pending' where exists(select 1 from private.billing_enrollments where owner_id=p_actor and first_dispatched_at is not null and state in('processing','unknown','needs_review'))
  union all select 'billing_card_cleanup' where exists(select 1 from private.billing_credentials where owner_id=p_actor and state<>'revoked')
 ) reasons;
$$;
create function private.goods_subscription_account_retention(p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',1,'subscriptions',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'state',p.state,'createdAt',p.created_at,
  'consentedAt',p.consented_at,'canceledAt',p.canceled_at,'cycles',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'number',c.cycle_number,'state',c.state,
   'orderId',c.order_id,'amount',o.total,'scheduledAt',c.scheduled_at,'settledAt',c.settled_at) order by c.cycle_number)
   from private.goods_subscription_cycles c left join public.orders o on o.id=c.order_id where c.plan_id=p.id),'[]'::jsonb)) order by p.created_at,p.id)
   from private.goods_subscription_plans p where p.owner_id=p_actor and p.state<>'draft'),'[]'::jsonb));
$$;
create function private.purge_goods_subscription_account_data(p_actor uuid) returns void
language plpgsql volatile security definer set search_path='' as $$begin
 perform private.subscription_lock_actor(p_actor,false);
 if not private.is_account_write_fenced(p_actor) or private.goods_subscription_account_blockers(p_actor)<>'[]'::jsonb then
  raise object_not_in_prerequisite_state using message='subscription_account_cleanup_pending';end if;
 -- Financial bindings and original refund operations outlive account PII. Their
 -- attempt FK removes them only when the financial attempt itself is deleted.
 delete from private.goods_subscription_operations where owner_id=p_actor;
 delete from private.goods_subscription_proposals where owner_id=p_actor;
 delete from private.goods_subscription_cycles where owner_id=p_actor;
 update private.goods_subscription_plans set current_terms_id=null where owner_id=p_actor;
 delete from private.goods_subscription_terms where owner_id=p_actor;
 delete from private.goods_subscription_plans where owner_id=p_actor;
 delete from private.billing_credential_operations where owner_id=p_actor;
 delete from private.billing_enrollments where owner_id=p_actor;
 delete from private.billing_credentials where owner_id=p_actor;
 delete from private.billing_customers where user_id=p_actor;
end $$;

create function private.guard_subscription_financial_binding() returns trigger
language plpgsql volatile security invoker set search_path='' as $$begin
 if tg_op='DELETE' then
  if exists(select 1 from public.payment_attempts where id=old.attempt_id) then raise check_violation using message='billing_financial_binding_retained';end if;
  return old;
 end if;
 if not exists(select 1 from public.payment_attempts a join private.billing_credentials c on c.id=new.credential_id
  join private.billing_profiles p on p.id=c.profile_id join private.goods_subscription_cycles x on x.id=new.cycle_id
  join private.goods_subscription_plans g on g.id=x.plan_id
  where a.id=new.attempt_id and a.provider='toss' and a.purpose='order' and a.user_id=new.owner_id and a.ref_id=x.order_id
   and c.owner_id=new.owner_id and x.owner_id=new.owner_id and g.credential_id=c.id and c.profile_id=new.profile_id
   and p.merchant_id=new.merchant_id and p.environment=new.environment) then
  raise check_violation using message='billing_financial_binding_invalid';end if;
 return new;
end $$;
create trigger subscription_financial_binding_insert before insert on private.payment_provider_bindings
 for each row execute function private.guard_subscription_financial_binding();
create trigger subscription_financial_binding_delete before delete on private.payment_provider_bindings
 for each row execute function private.guard_subscription_financial_binding();
create trigger subscription_refund_operation_delete before delete on private.billing_refund_operations
 for each row execute function private.guard_subscription_financial_binding();

create function private.guard_subscription_immutable_fields() returns trigger
language plpgsql volatile security invoker set search_path='' as $$declare before jsonb:=to_jsonb(old);after jsonb:=to_jsonb(new);field text;begin
 if tg_table_name in('goods_subscription_terms','goods_subscription_operations','goods_subscription_proposals','billing_credential_operations','payment_provider_bindings','billing_refund_operations') then
  raise check_violation using message='subscription_evidence_immutable';
 elsif tg_table_name='billing_profiles' then
  if after-'enabled' is distinct from before-'enabled' then raise check_violation using message='billing_profile_immutable';end if;
 elsif tg_table_name='billing_customers' then
  if after is distinct from before then raise check_violation using message='billing_customer_immutable';end if;
 elsif tg_table_name='billing_credentials' then
  if after-array['envelope','state','revision','revoked_at','revoke_claim_token','revoke_lease_until','revoke_fence','revoke_next_check_at']
   is distinct from before-array['envelope','state','revision','revoked_at','revoke_claim_token','revoke_lease_until','revoke_fence','revoke_next_check_at'] then
   raise check_violation using message='billing_credential_identity_immutable';end if;
 elsif tg_table_name='billing_enrollments' then
  if after-array['auth_envelope','auth_fingerprint','state','claim_token','lease_until','claim_fence','first_dispatched_at','recovery_until','updated_at','safe_reason']
   is distinct from before-array['auth_envelope','auth_fingerprint','state','claim_token','lease_until','claim_fence','first_dispatched_at','recovery_until','updated_at','safe_reason'] then
   raise check_violation using message='billing_registration_identity_immutable';end if;
 elsif tg_table_name='goods_subscription_plans' then
  foreach field in array array['id','owner_id','creation_operation_id','creation_request_hash','first_cycle_id'] loop
   if after->field is distinct from before->field then raise check_violation using message='subscription_identity_immutable';end if;
  end loop;
 elsif tg_table_name='goods_subscription_cycles' then
  foreach field in array array['id','plan_id','owner_id','cycle_number','schedule_slot','terms_id'] loop
   if after->field is distinct from before->field then raise check_violation using message='subscription_cycle_identity_immutable';end if;
  end loop;
  foreach field in array array['order_id','attempt_id','dispatched_at'] loop
   if before->>field is not null and after->field is distinct from before->field then raise check_violation using message='subscription_cycle_identity_immutable';end if;
  end loop;
  if after->'scheduled_at' is distinct from before->'scheduled_at' and not(before->>'state'='draft' and after->>'state'='prepared') then
   raise check_violation using message='subscription_cycle_identity_immutable';end if;
 end if;
 return new;
end $$;
do $$declare table_name text;begin
 foreach table_name in array array['billing_profiles','billing_customers','billing_credentials','billing_enrollments','goods_subscription_plans',
  'goods_subscription_terms','goods_subscription_cycles','goods_subscription_operations','goods_subscription_proposals','billing_credential_operations','payment_provider_bindings','billing_refund_operations'] loop
 execute format('create trigger subscription_immutable_fields before update on private.%I for each row execute function private.guard_subscription_immutable_fields()',table_name);
 end loop;
end $$;

-- More source/worker/customer functions follow in this DRAFT before its final
-- exact-SHA review. Seal every new object, including default role grants.
do $$declare item regclass;fn regprocedure;entry record;begin
 foreach item in array array['private.goods_subscription_runtime'::regclass,'private.goods_subscription_policies'::regclass,
  'private.billing_profiles'::regclass,'private.billing_customers'::regclass,'private.billing_credentials'::regclass,
  'private.billing_enrollments'::regclass,'private.goods_subscription_plans'::regclass,'private.goods_subscription_terms'::regclass,
  'private.goods_subscription_cycles'::regclass,'private.goods_subscription_operations'::regclass,
  'private.payment_provider_bindings'::regclass,'private.billing_refund_operations'::regclass,
  'private.billing_credential_operations'::regclass,'private.goods_subscription_proposals'::regclass,'private.fake_billing_credentials'::regclass,'private.fake_billing_operations'::regclass,'private.fake_billing_payments'::regclass] loop
  execute format('alter table %s enable row level security',item);
  execute format('revoke all on %s from public,anon,authenticated,service_role',item);
 end loop;
 for entry in select p.oid::regprocedure as signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
  (n.nspname='private' and p.proname in('subscription_json_keys','subscription_valid_envelope','subscription_normalize_intervals',
   'subscription_normalize_schedule','subscription_slot_at','subscription_require_service','subscription_lock_actor',
   'subscription_policy_summary','billing_registration_summary','subscription_source','subscription_renewal_terms',
   'subscription_selection_allowed','subscription_plan_summary','subscription_operation_replay','subscription_record_operation',
   'subscription_release_unpaid_order','subscription_stop_cycle','subscription_sync_cycle_outcome','goods_subscription_account_blockers',
   'goods_subscription_account_retention','purge_goods_subscription_account_data','guard_subscription_immutable_fields','guard_subscription_financial_binding')) or (n.nspname='public' and p.proname in(
   'admin_get_goods_subscription_policy','admin_save_goods_subscription_policy','service_prepare_billing_registration',
   'service_claim_billing_registration','service_finish_billing_registration','service_get_billing_registration','get_my_billing_registration',
   'get_my_billing_credentials','service_get_payment_gateway_binding','service_prepare_billing_refund',
   'service_fake_billing_command','service_get_subscription_availability','prepare_my_goods_subscription','confirm_my_goods_subscription',
   'get_my_goods_subscriptions','get_my_goods_subscription','change_my_goods_subscription_state','service_claim_goods_subscription_work',
   'service_prepare_goods_subscription_work','service_finish_goods_subscription_work','service_finalize_subscription_payment_reconciliation',
   'prepare_my_goods_subscription_change','confirm_my_goods_subscription_change','get_goods_subscription_offers','request_my_billing_credential_revocation',
   'service_list_billing_credential_revocations','service_claim_billing_credential_revocation','service_finish_billing_credential_revocation')) loop
  fn:=entry.signature;
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  if entry.nspname='public' and entry.proname='get_goods_subscription_offers' then execute format('grant execute on function %s to anon,authenticated',fn);
  elsif entry.nspname='public' and (entry.proname like 'admin_%' or entry.proname like 'get_my_%' or entry.proname in('prepare_my_goods_subscription','confirm_my_goods_subscription','change_my_goods_subscription_state','prepare_my_goods_subscription_change','confirm_my_goods_subscription_change','request_my_billing_credential_revocation')) then execute format('grant execute on function %s to authenticated',fn);
  elsif entry.nspname='public' and entry.proname like 'service_%' then execute format('grant execute on function %s to service_role',fn);
  else execute format('grant execute on function %s to postgres',fn);end if;
  perform private.register_operator_internal_contract(fn);
 end loop;
end $$;
select private.register_operator_rpc_contract('public.admin_get_goods_subscription_policy(uuid,text)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_goods_subscription_policy(uuid,text,bigint,timestamptz,uuid,boolean,jsonb,text)'::regprocedure,'catalog.manage','write',false);
notify pgrst,'reload schema';
