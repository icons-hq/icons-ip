-- DRAFT: contact PII remains disabled until an explicit environment activation.
-- Field encryption and plaintext normalization belong to the server; SQL owns
-- authorization, exact envelopes, source/version CAS, fulfillment and retention.
create table private.order_claim_contact_runtime(singleton boolean primary key check(singleton),enabled boolean not null default false);
insert into private.order_claim_contact_runtime values(true,false);
create table private.order_claim_contact_plans(
 id uuid primary key,order_id uuid not null references public.orders(id),claim_id uuid not null references public.order_cancellation_requests(id),
 target text not null check(target in('collection','reshipment')),revision bigint not null check(revision between 1 and 9007199254740991),
 pii_version uuid,sealed_plan jsonb,source_kind text check(source_kind in('seller_intake','order_delivery')),source_id uuid,source_revision text,
 last_operation_id uuid,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),purged_at timestamptz,
 unique(claim_id,target),check((purged_at is null and pii_version is not null and sealed_plan is not null) or
 (purged_at is not null and pii_version is null and sealed_plan is null and source_kind is null and source_id is null and source_revision is null)));
create index order_claim_contact_plans_order on private.order_claim_contact_plans(order_id,claim_id);
create table private.order_claim_contact_operations(
 id uuid primary key,actor_id uuid not null,session_id uuid not null,order_id uuid not null references public.orders(id),
 claim_id uuid not null references public.order_cancellation_requests(id),command text not null check(command in('change','reshipment')),
 target text not null check(target in('collection','reshipment')),expected_claim_type text not null check(expected_claim_type in('return','exchange')),
 expected_claim_revision integer not null check(expected_claim_revision>=0),result_claim_revision integer check(result_claim_revision>=0),
 state text not null check(state in('saved','noop','sealed')),changed_fields text[] not null default '{}',request_hmac text,hmac_key_version text,history jsonb,
 created_at timestamptz not null default clock_timestamp(),purged_at timestamptz,
 check((request_hmac is null)=(hmac_key_version is null)),check(request_hmac is null or request_hmac~'^[0-9a-f]{64}$'),
 check(hmac_key_version is null or hmac_key_version~'^[A-Za-z0-9_-]{1,64}$'),
 check(command<>'reshipment' or(target='reshipment' and expected_claim_type='exchange' and changed_fields='{}')),
 check((state='sealed' and result_claim_revision is null and changed_fields='{}' and request_hmac is null and history is null)
 or(state<>'sealed' and result_claim_revision is not null)),
 check(history is null or(state='saved' and command='change')),check(purged_at is null or(request_hmac is null and history is null)));
create index order_claim_contact_operations_history on private.order_claim_contact_operations(claim_id,created_at desc,id desc);
create index order_claim_contact_operations_actor on private.order_claim_contact_operations(actor_id);
create table private.order_claim_reshipment_destinations(
 claim_id uuid primary key references public.order_cancellation_requests(id),order_id uuid not null references public.orders(id),
 operation_id uuid unique not null references private.order_claim_contact_operations(id) deferrable initially deferred,
 confirmed_claim_revision integer not null check(confirmed_claim_revision>=0),destination jsonb,confirmed_at timestamptz not null default clock_timestamp(),purged_at timestamptz,
 check((purged_at is null and destination is not null) or(purged_at is not null and destination is null)));
create table private.order_claim_contact_retention_cases(
 claim_id uuid not null references public.order_cancellation_requests(id),case_ref text not null check(case_ref~'^[A-Za-z0-9:_./-]{1,120}$'),
 order_id uuid not null references public.orders(id),legal_basis text not null check(legal_basis in('dispute_resolution','statutory_preservation','verified_rights_request')),
 revision bigint not null check(revision between 1 and 9007199254740991),state text not null check(state in('held','released','closed')),
 retain_until timestamptz,case_closed_at timestamptz,released_at timestamptz,last_occurred_at timestamptz not null,last_operation_id uuid not null,updated_at timestamptz not null,
 primary key(claim_id,case_ref),check(retain_until is null or isfinite(retain_until)),check(isfinite(last_occurred_at)),
 check((state='held' and retain_until is not null and case_closed_at is null) or(state='released' and retain_until is null and case_closed_at is null and released_at is not null)
 or(state='closed' and retain_until is null and case_closed_at is not null)));
create table private.order_claim_contact_retention_operations(
 id uuid primary key,actor_id uuid not null,session_id uuid not null,command text not null check(command in('case','purge')),
 request_hash text not null check(request_hash~'^[0-9a-f]{64}$'),receipt jsonb not null,created_at timestamptz not null default clock_timestamp());

create function private.contact_keys(p_value jsonb,p_keys text[]) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p_value)='object' and p_value ?& p_keys and (select count(*) from jsonb_object_keys(case when jsonb_typeof(p_value)='object' then p_value else '{}'::jsonb end))=cardinality(p_keys),false);
$$;
create function private.contact_uuid(p_value jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p_value)='string' and p_value#>>'{}'~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false);
$$;
create function private.contact_digest(p_value jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p_value)='string' and p_value#>>'{}'~'^[0-9a-f]{64}$',false);
$$;
create function private.contact_key_version(p_value jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p_value)='string' and p_value#>>'{}'~'^[A-Za-z0-9_-]{1,64}$',false);
$$;
create function private.contact_base64url(p_value jsonb,p_bytes integer,p_max integer) returns boolean language plpgsql immutable set search_path='' as $$
declare value text;decoded bytea;begin
 if jsonb_typeof(p_value) is distinct from 'string' then return false;end if;value:=p_value#>>'{}';
 if length(value)>p_max or value!~'^[A-Za-z0-9_-]*$' or length(value)%4=1 then return false;end if;
 decoded:=decode(translate(value,'-_','+/')||repeat('=',(4-length(value)%4)%4),'base64');
 return(p_bytes is null or octet_length(decoded)=p_bytes) and rtrim(translate(replace(encode(decoded,'base64'),E'\n',''),'+/','-_'),'=')=value;
 exception when others then return false;end $$;
create function private.contact_field(p_value jsonb,p_key text) returns boolean language sql immutable set search_path='' as $$
 select private.contact_keys(p_value,array['v','kid','iv','tag','ct']) and p_value->'v'='1'::jsonb
 and private.contact_key_version(p_value->'kid') and p_value->>'kid'=p_key
 and private.contact_base64url(p_value->'iv',12,16) and private.contact_base64url(p_value->'tag',16,22)
 and private.contact_base64url(p_value->'ct',null,8192);
$$;
create function private.contact_address_envelope(p_value jsonb,p_key text) returns boolean language sql immutable set search_path='' as $$
 select private.contact_keys(p_value,array['recipientName','phone','postalCode','address1','address2'])
 and not exists(select 1 from jsonb_each(case when jsonb_typeof(p_value)='object' then p_value else '{}'::jsonb end) v where not private.contact_field(v.value,p_key) or(v.key<>'address2' and v.value->>'ct'=''));
$$;
create function private.contact_plan_envelope(p_value jsonb) returns boolean language sql immutable set search_path='' as $$
 select private.contact_keys(p_value,array['planId','piiVersion','keyVersion','addressHmac','addressHmacKeyVersion','address'])
 and private.contact_uuid(p_value->'planId') and private.contact_uuid(p_value->'piiVersion') and private.contact_key_version(p_value->'keyVersion')
 and private.contact_digest(p_value->'addressHmac') and private.contact_key_version(p_value->'addressHmacKeyVersion')
 and private.contact_address_envelope(p_value->'address',p_value->>'keyVersion');
$$;
create function private.contact_history_envelope(p_value jsonb) returns boolean language sql immutable set search_path='' as $$
 select private.contact_keys(p_value,array['piiVersion','keyVersion','before','after','agreement']) and private.contact_uuid(p_value->'piiVersion')
 and private.contact_key_version(p_value->'keyVersion') and private.contact_address_envelope(p_value->'before',p_value->>'keyVersion')
 and private.contact_address_envelope(p_value->'after',p_value->>'keyVersion') and private.contact_field(p_value->'agreement',p_value->>'keyVersion') and p_value#>>'{agreement,ct}'<>'';
$$;
create function private.contact_parties(p_order uuid) returns uuid[] language sql stable security definer set search_path='' as $$
 select array_remove(array[o.user_id,g.recipient_id],null) from public.orders o left join private.gift_intents g on g.order_id=o.id where o.id=p_order;
$$;
create function private.contact_subject(p_order uuid) returns uuid language sql stable security definer set search_path='' as $$
 select case when g.id is not null then g.recipient_id else o.user_id end from public.orders o left join private.gift_intents g on g.order_id=o.id where o.id=p_order;
$$;
create function private.contact_require_identity(p_actor uuid,p_session uuid,p_capability text,p_admin boolean,p_parties uuid[],p_pii boolean) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' or p_actor is null or p_session is null then raise insufficient_privilege using message='auth_changed';end if;
 perform private.gift_lock_subjects(array_append(coalesce(p_parties,'{}'),p_actor));
 -- Membership updates use the same subject fence. Keep that membership locked
 -- through completion even when a caller is retrying a historical operation.
 perform private.lock_operator_subjects(array[p_actor]);
 perform 1 from auth.sessions where id=p_session and user_id=p_actor and(not_after is null or not_after>clock_timestamp()) for share;
 if not found or exists(select 1 from public.profiles where id=p_actor and suspended_at is not null)
 or exists(select 1 from private.account_action_fences where subject_user_id=p_actor)
 or(p_capability is not null and not private.has_operator_capability(p_actor,p_capability,p_admin)) then
 raise insufficient_privilege using message='auth_changed';end if;
 if p_pii and exists(select 1 from private.account_action_fences where subject_user_id=any(p_parties)) then raise sqlstate 'PT409' using message='claim_contact_blocked';end if;
end $$;
create function private.contact_lock_scope(p_order uuid,p_claim uuid,p_parties uuid[]) returns public.order_cancellation_requests
language plpgsql volatile security definer set search_path='' as $$
declare claim public.order_cancellation_requests;begin
 perform 1 from public.orders where id=p_order for update;
 if not found or private.contact_parties(p_order) is distinct from p_parties then raise sqlstate 'PT409' using message='claim_contact_changed';end if;
 perform 1 from public.order_shipments where order_id=p_order order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim and order_id=p_order for update;
 if not found or claim.claim_type not in('return','exchange') then raise no_data_found using message='claim_not_found';end if;
 perform 1 from public.order_claim_collections where claim_id=p_claim order by shipment_id for update;
 perform 1 from private.order_claim_contact_retention_cases where claim_id=p_claim order by case_ref for update;
 perform 1 from private.order_claim_contact_plans where claim_id=p_claim order by target for update;
 return claim;
end $$;
create function private.contact_runtime() returns void language plpgsql volatile security definer set search_path='' as $$begin
 perform singleton from private.order_claim_contact_runtime where singleton and enabled for share;
 if not found then raise sqlstate '55000' using message='feature_disabled';end if;
end $$;
-- This gate deliberately uses actual fulfillment evidence even for a done order.
-- Canceled orders may have completed return/refund duties and must not stay
-- permanently blocked by order_all_items_delivered's top-level status predicate.
create function private.contact_order_obligations(p_order uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare purchase public.orders;begin
 select * into purchase from public.orders where id=p_order;if not found then return 'operational_unknown';end if;
 if purchase.status not in('delivered','done','canceled') or exists(select 1 from public.order_cancellation_requests where order_id=p_order and status in('requested','processing','needs_review'))
 or exists(select 1 from public.order_cancellation_claims where order_id=p_order)
 or exists(select 1 from public.payments p where p.ref_id=p_order and p.purpose='order' and p.status='pending')
 or exists(select 1 from public.payment_attempts where ref_id=p_order and purpose='order' and(state in('prepared','confirming','unknown','needs_review') or(state='approved' and payment_id is null)))
 or exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.ref_id=p_order and p.purpose='order' and r.status<>'done') then return 'operational_pending';end if;
 if purchase.status in('delivered','done') and not private.order_all_items_delivered(p_order) then return 'operational_unknown';end if;
 if purchase.status='canceled' and(not exists(select 1 from public.order_items where order_id=p_order)
 or exists(select 1 from public.order_items i where i.order_id=p_order and coalesce((select sum(l.qty) from public.order_shipment_items l join public.order_shipments s on s.id=l.shipment_id
 where l.order_item_id=i.id and l.order_id=p_order and s.shipped_at is not null and s.delivered_at is not null),0)<>i.qty)) then return 'operational_unknown';end if;
 if purchase.status='canceled' and(not exists(select 1 from public.order_cancellation_requests c where c.order_id=p_order and c.claim_type='return' and c.stage='completed' and c.collected_at is not null and c.completed_at is not null)
 or(purchase.total>0 and(not exists(select 1 from public.payments p join public.refunds r on r.payment_id=p.id where p.ref_id=p_order and p.purpose='order' and p.status='refunded' and r.status='done' and r.completed_at is not null)
 or exists(select 1 from public.payments p where p.ref_id=p_order and p.purpose='order' and p.status in('pending','paid'))))) then return 'operational_unknown';end if;
 if exists(select 1 from public.order_cancellation_requests c where c.order_id=p_order and c.claim_type='exchange' and c.stage='completed'
 and(c.reshipped_at is null or c.reship_carrier is null or c.reship_tracking_number is null or c.reship_delivered_at is null or c.reship_delivered_by is null or c.reship_delivery_evidence is null))
 or exists(select 1 from public.order_cancellation_requests c where c.order_id=p_order and c.stage='completed' and c.collection_required and c.collected_at is null)
 or exists(select 1 from public.order_cancellation_requests c join public.order_claim_collections x on x.claim_id=c.id where c.order_id=p_order and c.stage='completed' and c.collection_required and(x.collected_at is null or x.collected_by is null or x.evidence is null))
 or exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.ref_id=p_order and r.status='done' and r.completed_at is null)
 then return 'operational_unknown';end if;
 return null;
end $$;
create function private.contact_retention(p_claim uuid,p_now timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.order_cancellation_requests;state text;ended timestamptz;base_at timestamptz;effective timestamptz;hold_until timestamptz;active_count integer;expired_count integer;
begin
 select * into c from public.order_cancellation_requests where id=p_claim;
 state:=private.contact_order_obligations(c.order_id);
 if state is null then
  ended:=case c.stage when 'completed' then c.completed_at when 'rejected' then c.decided_at when 'withdrawn' then c.withdrawn_at else null end;
  if c.stage not in('completed','rejected','withdrawn') then state:='operational_pending';elsif ended is null or not isfinite(ended) or ended>p_now then state:='operational_unknown';end if;
 end if;
 select count(*) filter(where r.state='held' and r.retain_until>p_now),count(*) filter(where r.state='held' and r.retain_until<=p_now),max(r.retain_until) filter(where r.state='held' and r.retain_until>p_now)
 into active_count,expired_count,hold_until from private.order_claim_contact_retention_cases r where r.claim_id=p_claim;
 if state is null then
  select greatest(ended,(select max(delivered_at) from public.order_shipments where order_id=c.order_id),
   (select max(greatest(completed_at,reship_delivered_at,decided_at,withdrawn_at,operational_fee_confirmed_at)) from public.order_cancellation_requests where order_id=c.order_id),
   (select max(r.completed_at) from public.refunds r join public.payments p on p.id=r.payment_id where p.ref_id=c.order_id and p.purpose='order'),
   (select max(case_closed_at) from private.order_claim_contact_retention_cases where claim_id=p_claim and legal_basis='dispute_resolution')) into ended;
  base_at:=ended+interval '30 days';effective:=greatest(base_at,hold_until);
  state:=case when effective<=p_now then 'due' when hold_until>base_at then 'held' else 'not_due' end;
 end if;
 if exists(select 1 from private.order_claim_contact_plans where claim_id=p_claim and purged_at is not null) then state:='purged';end if;
 return jsonb_build_object('state',state,'purposeEndedAt',ended,'basePurgeAt',base_at,'effectivePurgeAt',effective,'activeHoldCount',active_count,'expiredHoldCount',expired_count);
end $$;
-- ECMAScript trim whitespace is explicit; PostgreSQL locale character classes
-- do not reliably include NBSP/BOM. C0/C1 controls are rejected before trimming.
create function private.contact_trim(p_value text) returns text language sql immutable set search_path='' as $$
 select btrim(p_value,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
$$;
create function private.contact_source_address(p_raw jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare field text;value text;address jsonb;begin
 if jsonb_typeof(p_raw) is distinct from 'object' or not p_raw ?& array['recipientName','phone','postalCode','address1'] then return null;end if;
 foreach field in array array['recipientName','phone','postalCode','address1','address2'] loop
  if field='address2' and(p_raw->field is null or p_raw->field='null') then continue;end if;
  if jsonb_typeof(p_raw->field) is distinct from 'string' or p_raw->>field~('['||chr(1)||'-'||chr(31)||chr(127)||'-'||chr(159)||']') then return null;end if;
 end loop;
 if p_raw->>'phone'!~'^[0-9 ()+-]+$' then return null;end if;
 address:=jsonb_build_object('recipientName',private.contact_trim(p_raw->>'recipientName'),
 'phone',regexp_replace(p_raw->>'phone','[ ()+-]','','g'),'postalCode',p_raw->>'postalCode','address1',p_raw->>'address1',
 'address2',private.contact_trim(coalesce(p_raw->>'address2','')));
 if char_length(address->>'recipientName') not between 1 and 50 or address->>'phone'!~'^[0-9]{8,15}$'
 or char_length(address->>'postalCode') not between 1 and 20 or private.contact_trim(address->>'postalCode')=''
 or char_length(address->>'address1') not between 1 and 200 or private.contact_trim(address->>'address1')='' or char_length(address->>'address2')>200 then return null;end if;
 return address;
end $$;
create function private.contact_target(p_order uuid,p_claim uuid,p_target text,p_access boolean,p_due jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.order_cancellation_requests;plan private.order_claim_contact_plans;raw jsonb;address jsonb;source jsonb;kind text;source_id uuid;source_revision text;
 result jsonb:=jsonb_build_object('target',p_target,'piiState','unavailable','source',null,'referenceOnly',false,'sourceAddress',null,'plan',null,'unavailableReason','source_unavailable');
begin
 select * into c from public.order_cancellation_requests where id=p_claim and order_id=p_order;
 if p_target='reshipment' and c.claim_type<>'exchange' then return result||jsonb_build_object('piiState','not_applicable','unavailableReason',null);end if;
 if not p_access then return result||jsonb_build_object('piiState','restricted','unavailableReason',null);end if;
 -- Do not read a source address or ciphertext until lifecycle gates pass.
 if p_due->>'state'='purged' then return result||jsonb_build_object('piiState','purged','unavailableReason',null);end if;
 if p_due->>'state'='due' then return result||jsonb_build_object('unavailableReason','retention_due');end if;
 select * into plan from private.order_claim_contact_plans where claim_id=p_claim and target=p_target;
 if found then
  if plan.purged_at is not null then return result||jsonb_build_object('piiState','purged','unavailableReason',null);end if;
  return result||jsonb_build_object('piiState','available','unavailableReason',null,'plan',plan.sealed_plan,
   'source',jsonb_build_object('sourceKind','contact_plan','sourceId',plan.id,'sourceRevision',null,'sourceFingerprint',null,'planRevision',plan.revision,'piiVersion',plan.pii_version));
 end if;
 if p_target='collection' then
  select payload->'collectionAddress' into raw from private.seller_order_claim_intakes where claim_id=p_claim;
  if found then kind:='seller_intake';source_id:=p_claim;end if;
 end if;
 if kind is null then
  source:=private.order_delivery_snapshot(p_order);raw:=source->'address';kind:='order_delivery';source_id:=p_order;source_revision:=source->>'addressRevision';
  if source_revision is null or source_revision!~'^(0|[1-9][0-9]*)$' then return result;end if;
 end if;
 address:=private.contact_source_address(raw);if address is null then return result;end if;
 source:=jsonb_build_object('sourceKind',kind,'sourceId',source_id,'sourceRevision',source_revision,'planRevision',0,'piiVersion',null,
 'sourceFingerprint',encode(extensions.digest(convert_to(jsonb_build_array('claim-contact-source-v1',p_order,p_claim,p_target,kind,source_id,source_revision,
 raw->>'recipientName',raw->>'phone',raw->>'postalCode',raw->>'address1',coalesce(raw->>'address2',''))::text,'UTF8'),'sha256'),'hex'));
 return result||jsonb_build_object('piiState','available','unavailableReason',null,'source',source,'sourceAddress',address,'referenceOnly',kind='order_delivery');
end $$;
create function private.contact_blocker(p_claim public.order_cancellation_requests,p_target text,p_command text) returns text
language plpgsql stable security definer set search_path='' as $$
declare stage text:=case when p_claim.stage='on_hold' then p_claim.held_from else p_claim.stage end;intake jsonb;row jsonb;
begin
 if p_claim.claim_type not in('return','exchange') or(p_target='reshipment' and p_claim.claim_type<>'exchange') then return 'not_applicable';end if;
 if exists(select 1 from public.orders where id=p_claim.order_id and status='canceled') or exists(select 1 from public.order_cancellation_claims where order_id=p_claim.order_id)
 or exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.ref_id=p_claim.order_id and p.purpose='order') then return 'financial_state';end if;
 if stage is null or stage not in('requested','in_review','collecting','collected') then return 'claim_stage';end if;
 if p_target='reshipment' then
  if p_claim.reshipped_at is not null or p_claim.reship_carrier is not null or p_claim.reship_tracking_number is not null or p_claim.reship_delivered_at is not null
  or exists(select 1 from private.claim_reshipment_items_read(p_claim.id)) or exists(select 1 from private.group_claim_reshipment_receipts where claim_id=p_claim.id)
  or exists(select 1 from private.order_claim_reshipment_destinations where claim_id=p_claim.id) then return 'reshipment_started';end if;
  if p_command='reshipment' then
   if p_claim.stage<>'collected' then return 'claim_stage';end if;
   begin perform private.assert_claim_collections_complete(p_claim.id);exception when others then return 'collection_incomplete';end;
  end if;
 else
  if stage not in('requested','in_review') or p_claim.collecting_at is not null or p_claim.collected_at is not null
  or exists(select 1 from public.order_claim_collections where claim_id=p_claim.id and(collected_at is not null or collected_by is not null or evidence is not null)) then return 'collection_started';end if;
  select payload->'collections' into intake from private.seller_order_claim_intakes where claim_id=p_claim.id;
  if found then
   if jsonb_typeof(intake) is distinct from 'array' or jsonb_array_length(intake)=0 then return 'collection_unknown';end if;
   for row in select value from jsonb_array_elements(intake) loop
    if not private.contact_keys(row,array['shipmentId','method','carrier','trackingNumber','note']) or not private.contact_uuid(row->'shipmentId')
    or row->>'method' is distinct from 'not_requested' or row->'carrier' is distinct from 'null'::jsonb or row->'trackingNumber' is distinct from 'null'::jsonb then return 'collection_started';end if;
   end loop;
  end if;
 end if;
 return null;
end $$;
create function public.service_get_order_claim_contact_context(p_order_id uuid,p_claim_id uuid,p_actor_id uuid,p_session_id uuid,p_target text,p_command text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare parties uuid[]:=private.contact_parties(p_order_id);c public.order_cancellation_requests;view jsonb;due jsonb;blocker text;begin
 if p_target is null or p_target not in('collection','reshipment') or p_command is null or p_command not in('change','reshipment') or(p_command='reshipment' and p_target<>'reshipment') then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 perform private.contact_require_identity(p_actor_id,p_session_id,'sales.manage',false,parties,true);
 c:=private.contact_lock_scope(p_order_id,p_claim_id,parties);perform private.contact_runtime();
 due:=private.contact_retention(p_claim_id,clock_timestamp());view:=private.contact_target(p_order_id,p_claim_id,p_target,true,due);
 blocker:=private.contact_blocker(c,p_target,p_command);
 if view->>'piiState'<>'available' then blocker:=coalesce(view->>'unavailableReason',view->>'piiState');end if;
 return jsonb_build_object('orderId',p_order_id,'claimId',p_claim_id,'target',p_target,'command',p_command,'claimType',c.claim_type,'claimRevision',c.claim_revision,'allowed',blocker is null,'blocker',blocker,'current',view);
end $$;
create function private.contact_operation_receipt(p_op private.order_claim_contact_operations) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('operationId',p_op.id,'command',p_op.command,'orderId',p_op.order_id,'claimId',p_op.claim_id,'target',p_op.target,
 'actorId',p_op.actor_id,'sessionId',p_op.session_id,'expectedClaimType',p_op.expected_claim_type,'expectedClaimRevision',p_op.expected_claim_revision,
 'resultClaimRevision',p_op.result_claim_revision,'state',p_op.state,'changedFields',to_jsonb(p_op.changed_fields),'recordedAt',p_op.created_at,
 'piiState',case when p_op.state='sealed' then 'not_stored' when p_op.purged_at is not null then 'purged' when p_op.state='noop' then 'not_stored' else 'retained' end);
$$;
create function private.contact_operation_scope(p_op private.order_claim_contact_operations,p_order uuid,p_claim uuid,p_actor uuid,p_session uuid,p_command text,p_target text,p_type text,p_revision integer) returns void
language plpgsql immutable set search_path='' as $$begin
 if (p_op.order_id,p_op.claim_id,p_op.actor_id,p_op.session_id,p_op.command,p_op.target,p_op.expected_claim_type,p_op.expected_claim_revision)
 is distinct from(p_order,p_claim,p_actor,p_session,p_command,p_target,p_type,p_revision) then raise unique_violation using message='claim_contact_operation_conflict';end if;
end $$;
create function private.contact_operation_input(p_operation uuid,p_command text,p_target text,p_type text,p_revision integer) returns void language plpgsql immutable set search_path='' as $$begin
 if p_operation is null or p_command is null or p_command not in('change','reshipment') or p_target is null or p_target not in('collection','reshipment')
 or p_type is null or p_type not in('return','exchange') or p_revision is null or p_revision<0 or(p_target='reshipment' and p_type<>'exchange')
 or(p_command='reshipment' and p_target<>'reshipment') then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
end $$;
create function public.service_read_order_claim_contact_operation(p_order_id uuid,p_claim_id uuid,p_actor_id uuid,p_session_id uuid,p_operation_id uuid,p_command text,p_target text,p_expected_claim_type text,p_expected_claim_revision integer,p_seal_if_absent boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare parties uuid[]:=private.contact_parties(p_order_id);op private.order_claim_contact_operations;c public.order_cancellation_requests;begin
 perform private.contact_operation_input(p_operation_id,p_command,p_target,p_expected_claim_type,p_expected_claim_revision);
 if p_seal_if_absent is null then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 perform private.contact_require_identity(p_actor_id,p_session_id,'sales.manage',false,parties,false);
 perform pg_advisory_xact_lock(hashtextextended('claim-contact-operation:'||p_operation_id,0));
 -- Scope locking validates current relationship but never fetches PII.
 c:=private.contact_lock_scope(p_order_id,p_claim_id,parties);
 select id,actor_id,session_id,order_id,claim_id,command,target,expected_claim_type,expected_claim_revision,result_claim_revision,
 state,changed_fields,null::text,hmac_key_version,null::jsonb,created_at,purged_at into op
 from private.order_claim_contact_operations where id=p_operation_id;
 if found then perform private.contact_operation_scope(op,p_order_id,p_claim_id,p_actor_id,p_session_id,p_command,p_target,p_expected_claim_type,p_expected_claim_revision);
 elsif p_seal_if_absent then
  insert into private.order_claim_contact_operations(id,actor_id,session_id,order_id,claim_id,command,target,expected_claim_type,expected_claim_revision,state)
  values(p_operation_id,p_actor_id,p_session_id,p_order_id,p_claim_id,p_command,p_target,p_expected_claim_type,p_expected_claim_revision,'sealed') returning * into op;
 end if;
 return jsonb_build_object('receipt',case when op.id is null then null else private.contact_operation_receipt(op) end,'hmacKeyVersion',op.hmac_key_version);
end $$;
create function private.contact_assert_context(p_claim public.order_cancellation_requests,p_target text,p_command text,p_type text,p_revision integer,p_expected jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare view jsonb;due jsonb;begin
 if p_claim.claim_type<>p_type or p_claim.claim_revision<>p_revision then raise sqlstate 'PT409' using message='claim_contact_changed';end if;
 perform private.contact_runtime();due:=private.contact_retention(p_claim.id,clock_timestamp());
 if due->>'state'='purged' then raise sqlstate 'PT410' using message='claim_contact_purged';end if;
 if due->>'state'='due' then raise sqlstate 'PT410' using message='claim_contact_retention_due';end if;
 if private.contact_blocker(p_claim,p_target,p_command) is not null then raise sqlstate 'PT409' using message='claim_contact_blocked';end if;
 view:=private.contact_target(p_claim.order_id,p_claim.id,p_target,true,due);
 if view->>'piiState'<>'available' then raise sqlstate 'PT409' using message='claim_contact_blocked';end if;
 if not private.contact_keys(p_expected,array['sourceKind','sourceId','sourceRevision','sourceFingerprint','planRevision','piiVersion','addressHmac','addressHmacKeyVersion'])
 or not private.contact_digest(p_expected->'addressHmac') or not private.contact_key_version(p_expected->'addressHmacKeyVersion') then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 if p_expected-array['addressHmac','addressHmacKeyVersion'] is distinct from view->'source' then raise sqlstate 'PT409' using message='claim_contact_changed';end if;
 return view;
end $$;
create function public.service_change_order_claim_contact(p_order_id uuid,p_claim_id uuid,p_actor_id uuid,p_session_id uuid,p_operation_id uuid,p_target text,p_expected_claim_type text,p_expected_claim_revision integer,p_expected_context jsonb,p_sealed_change jsonb,p_request_hmac text,p_hmac_key_version text,p_confirmed boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare parties uuid[]:=private.contact_parties(p_order_id);op private.order_claim_contact_operations;c public.order_cancellation_requests;view jsonb;plan jsonb;hist jsonb;fields text[];result_revision integer;old_plan private.order_claim_contact_plans;begin
 perform private.contact_operation_input(p_operation_id,'change',p_target,p_expected_claim_type,p_expected_claim_revision);
 perform private.contact_require_identity(p_actor_id,p_session_id,'sales.manage',false,parties,false);
 perform pg_advisory_xact_lock(hashtextextended('claim-contact-operation:'||p_operation_id,0));
 c:=private.contact_lock_scope(p_order_id,p_claim_id,parties);
 select id,actor_id,session_id,order_id,claim_id,command,target,expected_claim_type,expected_claim_revision,result_claim_revision,
 state,changed_fields,request_hmac,hmac_key_version,null::jsonb,created_at,purged_at into op
 from private.order_claim_contact_operations where id=p_operation_id;
 if found then
  perform private.contact_operation_scope(op,p_order_id,p_claim_id,p_actor_id,p_session_id,'change',p_target,p_expected_claim_type,p_expected_claim_revision);
  if op.state='sealed' then raise sqlstate 'PT409' using message='claim_contact_operation_sealed';end if;
  if op.purged_at is not null then raise sqlstate 'PT410' using message='claim_contact_purged';end if;
  if op.request_hmac is distinct from p_request_hmac or op.hmac_key_version is distinct from p_hmac_key_version then raise unique_violation using message='claim_contact_operation_conflict';end if;
  return private.contact_operation_receipt(op);
 end if;
 if exists(select 1 from private.account_action_fences where subject_user_id=any(parties)) then raise sqlstate 'PT409' using message='claim_contact_blocked';end if;
 if p_confirmed is distinct from true or not private.contact_digest(to_jsonb(p_request_hmac)) or not private.contact_key_version(to_jsonb(p_hmac_key_version))
 or not private.contact_keys(p_sealed_change,array['effect','changedFields','beforeAddressHmac','afterAddressHmac','addressHmacKeyVersion','plan','history'])
 or not private.contact_digest(p_sealed_change->'beforeAddressHmac') or not private.contact_digest(p_sealed_change->'afterAddressHmac')
 or not private.contact_key_version(p_sealed_change->'addressHmacKeyVersion') or jsonb_typeof(p_sealed_change->'changedFields') is distinct from 'array'
 or jsonb_typeof(p_sealed_change->'effect') is distinct from 'string' or p_sealed_change->>'effect' not in('change','noop') then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 fields:=array(select jsonb_array_elements_text(p_sealed_change->'changedFields'));
 if cardinality(fields)>3 or fields is distinct from array(select f from unnest(array['recipientName','phone','address2']) f where f=any(fields)) then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 view:=private.contact_assert_context(c,p_target,'change',p_expected_claim_type,p_expected_claim_revision,p_expected_context);
 if p_sealed_change->>'effect'='noop' then
  if fields<>'{}' or p_sealed_change->'plan' is distinct from 'null'::jsonb or p_sealed_change->'history' is distinct from 'null'::jsonb or p_sealed_change->'beforeAddressHmac' is distinct from p_sealed_change->'afterAddressHmac' then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
  result_revision:=c.claim_revision;
 else
  plan:=p_sealed_change->'plan';hist:=p_sealed_change->'history';
  if cardinality(fields)=0 or not private.contact_plan_envelope(plan) or not private.contact_history_envelope(hist)
   or plan->'addressHmac' is distinct from p_sealed_change->'afterAddressHmac' or plan->'addressHmacKeyVersion' is distinct from p_sealed_change->'addressHmacKeyVersion'
   or plan->'keyVersion' is distinct from hist->'keyVersion'
   or p_sealed_change->'beforeAddressHmac'=p_sealed_change->'afterAddressHmac' then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
  select * into old_plan from private.order_claim_contact_plans where claim_id=p_claim_id and target=p_target;
  if (old_plan.id is not null and(old_plan.id is distinct from(plan->>'planId')::uuid or old_plan.pii_version=(plan->>'piiVersion')::uuid))
   or exists(select 1 from private.order_claim_contact_operations where claim_id=p_claim_id and target=p_target and history->>'piiVersion'=plan->>'piiVersion') then raise sqlstate 'PT409' using message='claim_contact_changed';end if;
  insert into private.order_claim_contact_plans(id,order_id,claim_id,target,revision,pii_version,sealed_plan,source_kind,source_id,source_revision,last_operation_id)
  values((plan->>'planId')::uuid,p_order_id,p_claim_id,p_target,1,(plan->>'piiVersion')::uuid,plan,coalesce(old_plan.source_kind,view#>>'{source,sourceKind}'),coalesce(old_plan.source_id,(view#>>'{source,sourceId}')::uuid),case when old_plan.id is not null then old_plan.source_revision else view#>>'{source,sourceRevision}' end,p_operation_id)
  on conflict(claim_id,target) do update set revision=private.order_claim_contact_plans.revision+1,pii_version=excluded.pii_version,sealed_plan=excluded.sealed_plan,last_operation_id=p_operation_id,updated_at=clock_timestamp();
  update public.order_cancellation_requests set updated_at=clock_timestamp() where id=p_claim_id returning claim_revision into result_revision;
  insert into public.audit_log(actor_id,action,target,diff) values(p_actor_id,'admin.order.claim_contact_changed','order:'||p_order_id,
   jsonb_build_object('claimId',p_claim_id,'operationId',p_operation_id,'target',p_target,'changedFields',to_jsonb(fields),'claimRevision',result_revision));
  perform private.notify_order_claim(p_claim_id,'claim_updated','클레임 연락처가 변경됐어요','고객과 확인한 연락처 정보로 변경했습니다.');
 end if;
 insert into private.order_claim_contact_operations(id,actor_id,session_id,order_id,claim_id,command,target,expected_claim_type,expected_claim_revision,result_claim_revision,state,changed_fields,request_hmac,hmac_key_version,history)
 values(p_operation_id,p_actor_id,p_session_id,p_order_id,p_claim_id,'change',p_target,p_expected_claim_type,p_expected_claim_revision,result_revision,
 case when p_sealed_change->>'effect'='noop' then 'noop' else 'saved' end,fields,p_request_hmac,p_hmac_key_version,hist) returning * into op;
 return private.contact_operation_receipt(op);
end $$;

-- Preserve the full frozen physical engine, including legacy and group branches.
CREATE FUNCTION private.record_order_claim_reshipment_physical(p_claim_id uuid, p_carrier text, p_tracking_number text, p_items jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=(select auth.uid()); selected_order uuid; order_status public.order_status;
  claim public.order_cancellation_requests; item record; selected_variant uuid; source_variant uuid;
  variant public.goods_variants; carrier text:=nullif(btrim(p_carrier),''); tracking text:=nullif(btrim(p_tracking_number),'');
  selections jsonb; requested jsonb; shipped_items jsonb;
begin
  perform private.require_operator_capability('sales.manage',false);

  if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required'; end if;
  if carrier is null or tracking is null or tracking!~'^[A-Z0-9]{8,30}$' then raise check_violation using message='invalid reshipment tracking'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>1000 then raise check_violation using message='invalid reshipment items'; end if;
  for requested in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(requested) is distinct from 'object' or not(requested ?& array['orderItemId','variantId'])
      or (select count(*) from jsonb_object_keys(requested))<>2
      or (requested->>'orderItemId') is null or (requested->>'variantId') is null
      or requested->>'orderItemId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or requested->>'variantId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then raise check_violation using message='invalid reshipment items'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_items) x group by (x->>'orderItemId')::uuid having count(*)>1) then
    raise check_violation using message='invalid reshipment items';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',(x->>'orderItemId')::uuid,'variantId',(x->>'variantId')::uuid)
    order by (x->>'orderItemId')::uuid),'[]') into selections from jsonb_array_elements(p_items) x;
  select order_id into selected_order from public.order_cancellation_requests where id=p_claim_id;
  if not found then raise no_data_found using message='claim_not_found'; end if;
  -- Cancellation, payment finalization and claim operations all lock order first.
  select status into order_status from public.orders where id=selected_order for update;
  select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
  if claim.claim_type<>'exchange' then raise exception using message='claim_type_has_no_reshipment'; end if;
  perform private.lock_goods_stock_successor_topology();
  if exists(select 1 from private.group_claim_reshipment_receipts where claim_id=p_claim_id)
    or (claim.stage<>'completed' and (
      exists(select 1 from public.order_items oi cross join lateral private.order_item_physical_unit(oi.id) unit
        where oi.order_id=selected_order and (unit.good_id<>oi.good_id
          or exists(select 1 from private.goods_stock_successors where source_variant_id=unit.variant_id)
          or exists(select 1 from private.goods_group_members where variant_id=unit.variant_id)
          or exists(select 1 from private.group_claim_reshipment_allocations where order_item_id=oi.id)))
      or exists(select 1 from jsonb_array_elements(selections) x join public.order_items oi on oi.id=(x->>'orderItemId')::uuid
        join public.goods_variants v on v.id=(x->>'variantId')::uuid where oi.good_id<>v.good_id))) then
    return private.record_group_claim_reshipment(p_claim_id,carrier,tracking,selections);
  end if;
  if claim.stage='completed' then
    if claim.reship_carrier=carrier and claim.reship_tracking_number=tracking and not exists(
      select 1 from jsonb_array_elements(selections) selected where not exists(
        select 1 from public.order_claim_reshipment_items shipped where shipped.claim_id=p_claim_id
          and shipped.order_item_id=(selected->>'orderItemId')::uuid and shipped.variant_id=(selected->>'variantId')::uuid))
      then return 'completed'; end if;
    raise unique_violation using message='reshipment_conflict';
  end if;
  perform private.assert_claim_collections_complete(p_claim_id);
  if claim.stage<>'collected' or order_status not in('delivered','done')
    or exists(select 1 from public.order_cancellation_claims where order_id=selected_order)
    then raise exception using message='claim_not_reshippable'; end if;
  if not exists(select 1 from public.shipping_carriers c where c.code=carrier and c.is_active) then raise check_violation using message='unknown shipping carrier'; end if;
  if exists(select 1 from jsonb_array_elements(selections) selected where not exists(
    select 1 from public.order_items oi where oi.id=(selected->>'orderItemId')::uuid and oi.order_id=selected_order)) then
    raise check_violation using message='invalid reshipment items';
  end if;
  perform 1 from public.goods g where g.id in(select good_id from public.order_items where order_id=selected_order) order by g.id for update;
  for item in select * from public.order_items where order_id=selected_order order by good_id,id loop
    source_variant:=private.order_item_stock_variant(item.id);
    select (selected->>'variantId')::uuid into selected_variant from jsonb_array_elements(selections) selected where (selected->>'orderItemId')::uuid=item.id;
    selected_variant:=coalesce(selected_variant,source_variant);
    select * into variant from public.goods_variants where id=selected_variant and good_id=item.good_id;
    if not found or (variant.archived_at is not null and selected_variant<>source_variant) then raise check_violation using message='reshipment_variant_unavailable'; end if;
    insert into public.order_claim_reshipment_items(claim_id,order_item_id,good_id,source_variant_id,variant_id,variant_name_snapshot,variant_code_snapshot,qty)
      values(p_claim_id,item.id,item.good_id,source_variant,selected_variant,variant.name,variant.code,item.qty);
  end loop;
  -- Net all returned/shipped options first. A two-line blue/red swap also works
  -- with no spare stock; every recovered unit belongs to this collected claim.
  for item in select changes.good_id,changes.variant_id,sum(changes.delta)::bigint delta from (
    select good_id,source_variant_id variant_id,qty::bigint delta from public.order_claim_reshipment_items where claim_id=p_claim_id
    union all select good_id,variant_id,-qty::bigint from public.order_claim_reshipment_items where claim_id=p_claim_id
  ) changes group by changes.good_id,changes.variant_id having sum(changes.delta)<>0 order by changes.good_id,delta desc,changes.variant_id loop
    perform private.change_goods_variant_stock(item.good_id,item.variant_id,item.delta::bigint);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',order_item_id,'goodId',good_id,'sourceVariantId',source_variant_id,'variantId',variant_id,'qty',qty) order by order_item_id),'[]')
    into shipped_items from public.order_claim_reshipment_items where claim_id=p_claim_id;
  update public.order_cancellation_requests set stage='completed',reship_carrier=carrier,reship_tracking_number=tracking,
    reshipped_at=now(),completed_at=now(),updated_at=now() where id=p_claim_id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.claim_reshipped','order:'||selected_order::text,
    jsonb_build_object('claimId',p_claim_id,'claimType','exchange','from','collected','to','completed','carrier',carrier,'items',shipped_items));
  perform private.notify_order_claim(p_claim_id,'reshipped','교환 상품이 재출고됐어요','교환 상품을 새 운송장으로 발송했습니다.');
  return 'completed';
end $function$
;

create or replace function public.admin_record_order_claim_reshipment(p_claim_id uuid,p_carrier text,p_tracking_number text,p_items jsonb) returns text
language plpgsql volatile security definer set search_path='' as $$
declare c public.order_cancellation_requests;parties uuid[];begin
 select * into c from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found';end if;
 parties:=private.contact_parties(c.order_id);perform private.gift_lock_subjects(array_append(parties,auth.uid()));
 perform private.require_operator_capability('sales.manage',false);
 c:=private.contact_lock_scope(c.order_id,p_claim_id,parties);
 if c.stage<>'completed' then raise sqlstate 'PT409' using message='claim_contact_blocked';end if;
 return private.record_order_claim_reshipment_physical(p_claim_id,p_carrier,p_tracking_number,p_items);
end $$;
create or replace function public.admin_record_order_claim_reshipment(p_claim_id uuid,p_carrier text,p_tracking_number text) returns text
language plpgsql volatile security definer set search_path='' as $$
declare c public.order_cancellation_requests;parties uuid[];begin
 select * into c from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found';end if;
 parties:=private.contact_parties(c.order_id);perform private.gift_lock_subjects(array_append(parties,auth.uid()));
 perform private.require_operator_capability('sales.manage',false);
 c:=private.contact_lock_scope(c.order_id,p_claim_id,parties);
 if c.stage<>'completed' then raise sqlstate 'PT409' using message='claim_contact_blocked';end if;
 return private.record_order_claim_reshipment_physical(p_claim_id,p_carrier,p_tracking_number,'[]'::jsonb);
end $$;
create function public.service_record_order_claim_reshipment_v2(p_order_id uuid,p_claim_id uuid,p_actor_id uuid,p_session_id uuid,p_operation_id uuid,p_expected_claim_revision integer,p_expected_context jsonb,p_sealed_destination jsonb,p_request_hmac text,p_hmac_key_version text,p_carrier text,p_tracking_number text,p_items jsonb,p_confirmed boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare parties uuid[]:=private.contact_parties(p_order_id);op private.order_claim_contact_operations;c public.order_cancellation_requests;view jsonb;result_revision integer;
 previous_subject text:=current_setting('request.jwt.claim.sub',true);begin
 perform private.contact_operation_input(p_operation_id,'reshipment','reshipment','exchange',p_expected_claim_revision);
 perform private.contact_require_identity(p_actor_id,p_session_id,'sales.manage',false,parties,false);
 perform pg_advisory_xact_lock(hashtextextended('claim-contact-operation:'||p_operation_id,0));
 c:=private.contact_lock_scope(p_order_id,p_claim_id,parties);
 select id,actor_id,session_id,order_id,claim_id,command,target,expected_claim_type,expected_claim_revision,result_claim_revision,
 state,changed_fields,request_hmac,hmac_key_version,null::jsonb,created_at,purged_at into op
 from private.order_claim_contact_operations where id=p_operation_id;
 if found then
  perform private.contact_operation_scope(op,p_order_id,p_claim_id,p_actor_id,p_session_id,'reshipment','reshipment','exchange',p_expected_claim_revision);
  if op.state='sealed' then raise sqlstate 'PT409' using message='claim_contact_operation_sealed';end if;
  if op.purged_at is not null then raise sqlstate 'PT410' using message='claim_contact_purged';end if;
  if op.request_hmac is distinct from p_request_hmac or op.hmac_key_version is distinct from p_hmac_key_version then raise unique_violation using message='claim_contact_operation_conflict';end if;
  return private.contact_operation_receipt(op);
 end if;
 if exists(select 1 from private.account_action_fences where subject_user_id=any(parties)) then raise sqlstate 'PT409' using message='claim_contact_blocked';end if;
 if p_confirmed is distinct from true or not private.contact_digest(to_jsonb(p_request_hmac)) or not private.contact_key_version(to_jsonb(p_hmac_key_version))
 or not private.contact_keys(p_sealed_destination,array['piiVersion','keyVersion','address','addressHmac','addressHmacKeyVersion','sourceKind','sourceId','sourceRevision','sourcePlanRevision','sourcePiiVersion'])
 or not private.contact_uuid(p_sealed_destination->'piiVersion') or not private.contact_key_version(p_sealed_destination->'keyVersion')
 or not private.contact_key_version(p_sealed_destination->'addressHmacKeyVersion') or not private.contact_digest(p_sealed_destination->'addressHmac')
 or not private.contact_address_envelope(p_sealed_destination->'address',p_sealed_destination->>'keyVersion')
 or p_carrier is null or char_length(p_carrier) not between 1 and 40 or p_carrier<>btrim(p_carrier) or p_tracking_number is null or p_tracking_number!~'^[A-Z0-9]{8,30}$'
 then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 view:=private.contact_assert_context(c,'reshipment','reshipment','exchange',p_expected_claim_revision,p_expected_context);
 if jsonb_build_object('sourceKind',p_sealed_destination->'sourceKind','sourceId',p_sealed_destination->'sourceId','sourceRevision',p_sealed_destination->'sourceRevision',
 'planRevision',p_sealed_destination->'sourcePlanRevision','piiVersion',p_sealed_destination->'sourcePiiVersion') is distinct from((view->'source')-'sourceFingerprint')
 then raise sqlstate 'PT409' using message='claim_contact_changed';end if;
 -- Preserve the explicit actor only for the already-verified physical call.
 begin
  perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
  perform private.record_order_claim_reshipment_physical(p_claim_id,p_carrier,p_tracking_number,p_items);
  perform set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);
 exception when others then perform set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);raise;end;
 select claim_revision into result_revision from public.order_cancellation_requests where id=p_claim_id;
 insert into private.order_claim_contact_operations(id,actor_id,session_id,order_id,claim_id,command,target,expected_claim_type,expected_claim_revision,result_claim_revision,state,request_hmac,hmac_key_version)
 values(p_operation_id,p_actor_id,p_session_id,p_order_id,p_claim_id,'reshipment','reshipment','exchange',p_expected_claim_revision,result_revision,'saved',p_request_hmac,p_hmac_key_version) returning * into op;
 insert into private.order_claim_reshipment_destinations(claim_id,order_id,operation_id,confirmed_claim_revision,destination)
 values(p_claim_id,p_order_id,p_operation_id,result_revision,p_sealed_destination);
 return private.contact_operation_receipt(op);
end $$;
create function public.service_read_order_claim_contact_history(p_order_id uuid,p_claim_id uuid,p_actor_id uuid,p_session_id uuid,p_viewer_kind text,p_limit integer,p_cursor jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare parties uuid[]:=private.contact_parties(p_order_id);c public.order_cancellation_requests;kind text;access boolean;due jsonb;entries jsonb:='[]';entry jsonb;op private.order_claim_contact_operations;
 dest private.order_claim_reshipment_destinations;dest_view jsonb;next_cursor jsonb;cursor_at timestamptz;cursor_id uuid;n integer:=0;pii_state text;reason text;begin
 if p_viewer_kind is null or p_viewer_kind not in('operator','customer') or p_limit is null or p_limit not between 1 and 20 then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 if p_cursor is not null and p_cursor<>'null'::jsonb then
  if not private.contact_keys(p_cursor,array['recordedAt','operationId']) or not private.contact_uuid(p_cursor->'operationId') or jsonb_typeof(p_cursor->'recordedAt') is distinct from 'string' then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
  begin cursor_at:=(p_cursor->>'recordedAt')::timestamptz;cursor_id:=(p_cursor->>'operationId')::uuid;exception when others then raise invalid_parameter_value using message='invalid_claim_contact_request';end;
  if not isfinite(cursor_at) then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 end if;
 perform private.contact_require_identity(p_actor_id,p_session_id,case when p_viewer_kind='operator' then 'sales.manage' end,false,parties,true);
 c:=private.contact_lock_scope(p_order_id,p_claim_id,parties);
 if p_viewer_kind='operator' then kind:='operator';
 else
  select case when g.recipient_id=p_actor_id then 'gift_recipient' when g.sender_id=p_actor_id then 'gift_sender' when g.id is null and o.user_id=p_actor_id then 'buyer' end into kind
  from public.orders o left join private.gift_intents g on g.order_id=o.id where o.id=p_order_id;
  if kind is null then raise no_data_found using message='claim_not_found';end if;
 end if;
 access:=kind<>'gift_sender';perform private.contact_runtime();due:=private.contact_retention(p_claim_id,clock_timestamp());
 for op in select id,actor_id,session_id,order_id,claim_id,command,target,expected_claim_type,expected_claim_revision,result_claim_revision,
 state,changed_fields,null::text,null::text,case when access and due->>'state' not in('due','purged') and purged_at is null then history else null end,created_at,purged_at
 from private.order_claim_contact_operations where claim_id=p_claim_id and order_id=p_order_id and state='saved' and command='change'
 and(cursor_at is null or(created_at,id)<(cursor_at,cursor_id)) order by created_at desc,id desc limit p_limit+1 loop
  n:=n+1;if n>p_limit then exit;end if;
  pii_state:=case when not access then 'restricted' when op.purged_at is not null then 'purged' when due->>'state'='due' then 'unavailable' when op.history is null then 'unavailable' else 'available' end;
  reason:=case when pii_state='unavailable' then case when due->>'state'='due' then 'retention_due' else 'source_unavailable' end end;
  entry:=jsonb_build_object('operationId',op.id,'target',op.target,'changedFields',to_jsonb(op.changed_fields),'recordedAt',op.created_at,'resultClaimRevision',op.result_claim_revision,
   'piiState',pii_state,'actorId',case when kind='operator' then op.actor_id end,'unavailableReason',reason,'ciphertext',case when pii_state='available' then
   (op.history||jsonb_build_object('recordId',op.id,'agreement',case when kind='operator' then op.history->'agreement' else 'null'::jsonb end)) else null end);
  entries:=entries||jsonb_build_array(entry);next_cursor:=jsonb_build_object('recordedAt',op.created_at,'operationId',op.id);
 end loop;
 if n<=p_limit then next_cursor:=null;end if;
 select claim_id,order_id,operation_id,confirmed_claim_revision,case when access and due->>'state' not in('due','purged') and purged_at is null then destination else null end,confirmed_at,purged_at
 into dest from private.order_claim_reshipment_destinations where claim_id=p_claim_id;
 pii_state:=case when c.claim_type<>'exchange' or(dest.claim_id is null and c.reshipped_at is null) then 'not_applicable'
 when not access then 'restricted' when dest.purged_at is not null or due->>'state'='purged' then 'purged'
 when due->>'state'='due' then 'unavailable' when dest.destination is null then 'unavailable' else 'available' end;
 dest_view:=jsonb_build_object('source',case when dest.claim_id is not null then 'v2_confirmed' when c.reshipped_at is not null then 'legacy_unconfirmed' else 'none' end,
 'operationId',dest.operation_id,'recordedAt',dest.confirmed_at,'piiState',pii_state,'destination',case when pii_state='available' then dest.destination else null end,
 'unavailableReason',case when pii_state='unavailable' then case when due->>'state'='due' then 'retention_due' else 'source_unavailable' end end);
 return jsonb_build_object('viewerId',p_actor_id,'sessionId',p_session_id,'orderId',p_order_id,'claimId',p_claim_id,'viewerKind',kind,'piiAccess',access,
 'current',jsonb_build_object('collection',private.contact_target(p_order_id,p_claim_id,'collection',access,due),'reshipment',private.contact_target(p_order_id,p_claim_id,'reshipment',access,due)),
 'entries',entries,'nextCursor',next_cursor,'reshipmentDestination',dest_view);
end $$;
create function private.contact_counts(p_claim uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'plans',(select count(*) from private.order_claim_contact_plans where claim_id=p_claim and sealed_plan is not null),
 'operations',(select count(*) from private.order_claim_contact_operations where claim_id=p_claim and(history is not null or request_hmac is not null)),
 'destinations',(select count(*) from private.order_claim_reshipment_destinations where claim_id=p_claim and destination is not null),
 'addressEnvelopes',(select 5*count(*) from private.order_claim_contact_plans where claim_id=p_claim and sealed_plan is not null)
  +(select 10*count(*) from private.order_claim_contact_operations where claim_id=p_claim and history is not null)
  +(select 5*count(*) from private.order_claim_reshipment_destinations where claim_id=p_claim and destination is not null),
 'agreementEnvelopes',(select count(*) from private.order_claim_contact_operations where claim_id=p_claim and history is not null),
 'requestHmacs',(select count(*) from private.order_claim_contact_operations where claim_id=p_claim and request_hmac is not null),
 'addressHmacs',(select count(*) from private.order_claim_contact_plans where claim_id=p_claim and sealed_plan is not null)
  +(select count(*) from private.order_claim_reshipment_destinations where claim_id=p_claim and destination is not null),
 'operatorReferences',(select count(*) from private.order_claim_contact_operations where claim_id=p_claim));
$$;
create function private.contact_count_sum(p_counts jsonb) returns bigint language sql immutable set search_path='' as $$
 select coalesce((p_counts->>'addressEnvelopes')::bigint,0)+coalesce((p_counts->>'agreementEnvelopes')::bigint,0)+coalesce((p_counts->>'requestHmacs')::bigint,0)+coalesce((p_counts->>'addressHmacs')::bigint,0);
$$;
create function private.contact_retention_scope(p_claim uuid,p_now timestamptz) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('orderId',c.order_id,'claimId',c.id,'subjectKind',case when exists(select 1 from private.gift_intents where order_id=c.order_id) then 'gift_recipient' else 'buyer' end,
 'remaining',private.contact_counts(c.id))||private.contact_retention(c.id,p_now) from public.order_cancellation_requests c where c.id=p_claim;
$$;
create function private.contact_retention_remaining(p_subject uuid,p_now timestamptz) returns jsonb language sql stable security definer set search_path='' as $$
 with scopes as(select private.contact_retention_scope(c.id,p_now) scope from public.order_cancellation_requests c where c.claim_type in('return','exchange') and private.contact_subject(c.order_id)=p_subject)
 select jsonb_build_object('eligibleScopes',count(*) filter(where scope->>'state'='due'),'heldScopes',count(*) filter(where scope->>'state'='held'),
 'notDueScopes',count(*) filter(where scope->>'state'='not_due'),'operationallyBlockedScopes',count(*) filter(where scope->>'state' in('operational_pending','operational_unknown')),
 'piiFields',coalesce(sum(private.contact_count_sum(scope->'remaining')),0),'operatorReferences',(select count(*) from private.order_claim_contact_operations where actor_id=p_subject)) from scopes;
$$;
create function private.contact_instant(p_value jsonb) returns timestamptz language plpgsql immutable set search_path='' as $$
declare result timestamptz;begin
 if jsonb_typeof(p_value) is distinct from 'string' or p_value#>>'{}'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 result:=(p_value#>>'{}')::timestamptz;if not isfinite(result) then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;return result;
 exception when others then raise invalid_parameter_value using message='invalid_claim_contact_request';end $$;
create function public.service_record_order_claim_contact_retention_case(p_order_id uuid,p_claim_id uuid,p_actor_id uuid,p_session_id uuid,p_operation_id uuid,p_expected_case_revision bigint,p_case jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare parties uuid[]:=private.contact_parties(p_order_id);claim public.order_cancellation_requests;old private.order_claim_contact_retention_cases;
 op private.order_claim_contact_retention_operations;occurred timestamptz;until_at timestamptz;request_hash text;receipt jsonb;action text;recorded timestamptz;begin
 if p_operation_id is null or p_expected_case_revision is null or p_expected_case_revision not between 0 and 9007199254740990
 or not private.contact_keys(p_case,array['action','caseRef','approvalRef','legalBasis','retainUntil','occurredAt'])
 or jsonb_typeof(p_case->'action') is distinct from 'string' or p_case->>'action' not in('hold','extend','release','close')
 or jsonb_typeof(p_case->'caseRef') is distinct from 'string' or p_case->>'caseRef'!~'^[A-Za-z0-9:_./-]{1,120}$'
 or jsonb_typeof(p_case->'approvalRef') is distinct from 'string' or p_case->>'approvalRef'!~'^[A-Za-z0-9:_./-]{1,120}$'
 or jsonb_typeof(p_case->'legalBasis') is distinct from 'string' or p_case->>'legalBasis' not in('dispute_resolution','statutory_preservation','verified_rights_request')
 then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 action:=p_case->>'action';occurred:=private.contact_instant(p_case->'occurredAt');
 if action in('hold','extend') then until_at:=private.contact_instant(p_case->'retainUntil');
 elsif p_case->'retainUntil' is distinct from 'null'::jsonb then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 request_hash:=encode(extensions.digest(convert_to(jsonb_build_array('claim-contact-case-v1',p_order_id,p_claim_id,p_actor_id,p_session_id,p_operation_id,p_expected_case_revision,
 action,p_case->>'caseRef',p_case->>'approvalRef',p_case->>'legalBasis',occurred,until_at)::text,'UTF8'),'sha256'),'hex');
 perform private.contact_require_identity(p_actor_id,p_session_id,'platform.manage',true,parties,false);
 perform pg_advisory_xact_lock(hashtextextended('claim-contact-retention-operation:'||p_operation_id,0));
 claim:=private.contact_lock_scope(p_order_id,p_claim_id,parties);
 select * into op from private.order_claim_contact_retention_operations where id=p_operation_id;
 if found then
  if op.actor_id is distinct from p_actor_id or op.session_id is distinct from p_session_id or op.command<>'case' or op.request_hash<>request_hash then raise unique_violation using message='claim_contact_operation_conflict';end if;
  return op.receipt;
 end if;
 select * into old from private.order_claim_contact_retention_cases where claim_id=p_claim_id and case_ref=p_case->>'caseRef' for update;
 if coalesce(old.revision,0)<>p_expected_case_revision or(old.claim_id is not null and old.legal_basis<>p_case->>'legalBasis') then raise sqlstate 'PT409' using message='claim_contact_changed';end if;
 -- Bind validation and the receipt to the same instant after every lock wait.
 recorded:=clock_timestamp();
 if occurred>recorded or(old.last_occurred_at is not null and occurred<old.last_occurred_at)
 or(action in('hold','extend') and(until_at<=recorded or until_at<=occurred)) then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 if old.state='closed' or(action='hold' and old.state is not null and old.state<>'released') or(action='extend' and(old.state is distinct from 'held' or until_at<=old.retain_until))
 or(action='release' and old.state is distinct from 'held') or(action='close' and old.state is not null and old.state not in('held','released')) then raise sqlstate 'PT409' using message='claim_contact_blocked';end if;
 if exists(select 1 from private.order_claim_contact_plans where claim_id=p_claim_id and purged_at is not null) and action in('hold','extend') then raise sqlstate 'PT410' using message='claim_contact_purged';end if;
 insert into private.order_claim_contact_retention_cases(claim_id,case_ref,order_id,legal_basis,revision,state,retain_until,case_closed_at,released_at,last_occurred_at,last_operation_id,updated_at)
 values(p_claim_id,p_case->>'caseRef',p_order_id,p_case->>'legalBasis',p_expected_case_revision+1,case when action in('hold','extend') then 'held' when action='release' then 'released' else 'closed' end,
 until_at,case when action='close' then occurred end,case when action='release' then occurred else old.released_at end,occurred,p_operation_id,recorded)
 on conflict(claim_id,case_ref) do update set revision=excluded.revision,state=excluded.state,retain_until=excluded.retain_until,case_closed_at=excluded.case_closed_at,released_at=excluded.released_at,
 last_occurred_at=excluded.last_occurred_at,last_operation_id=excluded.last_operation_id,updated_at=excluded.updated_at returning * into old;
 receipt:=jsonb_build_object('operationId',p_operation_id,'orderId',p_order_id,'claimId',p_claim_id,'actorId',p_actor_id,'sessionId',p_session_id,'caseRef',old.case_ref,
 'action',action,'legalBasis',old.legal_basis,'expectedRevision',p_expected_case_revision,'resultRevision',old.revision,'state',old.state,'retainUntil',old.retain_until,
 'caseClosedAt',old.case_closed_at,'releasedAt',old.released_at,'occurredAt',occurred,'recordedAt',recorded);
 insert into private.order_claim_contact_retention_operations(id,actor_id,session_id,command,request_hash,receipt) values(p_operation_id,p_actor_id,p_session_id,'case',request_hash,receipt);
 insert into public.audit_log(actor_id,action,target,diff) values(p_actor_id,'admin.order.claim_contact_retention','claim:'||p_claim_id,
 jsonb_build_object('operationId',p_operation_id,'caseRef',old.case_ref,'approvalRef',p_case->>'approvalRef','legalBasis',old.legal_basis,'action',action,'caseRevision',old.revision));
 return receipt;
end $$;
create function public.service_inventory_order_claim_contact_data(p_subject_id uuid,p_actor_id uuid,p_session_id uuid,p_limit integer,p_after_claim_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare scopes jsonb:='[]';claim record;next_id uuid;n integer:=0;recorded timestamptz:=statement_timestamp();begin
 if p_subject_id is null or p_limit is null or p_limit not between 1 and 1000 then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 perform private.contact_require_identity(p_actor_id,p_session_id,'platform.manage',true,array[p_subject_id],false);
 for claim in select c.id from public.order_cancellation_requests c where c.claim_type in('return','exchange') and private.contact_subject(c.order_id)=p_subject_id
 and(p_after_claim_id is null or c.id>p_after_claim_id) order by c.id limit p_limit+1 loop
  n:=n+1;if n>p_limit then exit;end if;
  scopes:=scopes||jsonb_build_array(private.contact_retention_scope(claim.id,recorded));next_id:=claim.id;
 end loop;
 if n<=p_limit then next_id:=null;end if;
 return jsonb_build_object('subjectId',p_subject_id,'actorId',p_actor_id,'sessionId',p_session_id,'recordedAt',recorded,'scopes',scopes,'nextClaimId',next_id,
 'operatorReferenceCount',(select count(*) from private.order_claim_contact_operations where actor_id=p_subject_id));
end $$;
create function public.service_purge_order_claim_contact_data(p_subject_id uuid,p_actor_id uuid,p_session_id uuid,p_operation_id uuid,p_cutoff timestamptz,p_limit integer) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ids uuid[];order_ids uuid[];parties uuid[];scope record;op private.order_claim_contact_retention_operations;request_hash text;receipt jsonb;due jsonb;counts jsonb;
 removed jsonb:='{"plans":0,"operations":0,"destinations":0,"addressEnvelopes":0,"agreementEnvelopes":0,"requestHmacs":0,"addressHmacs":0,"operatorReferences":0}';
 purged_ids uuid[]:='{}';targets integer:=0;v_target text;key text;recorded timestamptz;
begin
 if p_subject_id is null or p_operation_id is null or p_cutoff is null or not isfinite(p_cutoff) or p_cutoff>clock_timestamp() or p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 request_hash:=encode(extensions.digest(convert_to(jsonb_build_array('claim-contact-purge-v1',p_subject_id,p_actor_id,p_session_id,p_operation_id,p_cutoff,p_limit)::text,'UTF8'),'sha256'),'hex');
 -- Candidate discovery takes no domain locks. Lock all subjects before all
 -- order rows, and recheck ownership instead of acquiring a new late subject.
 select coalesce(array_agg(x.id order by x.order_id,x.id),'{}'),coalesce(array_agg(distinct x.order_id order by x.order_id),'{}') into ids,order_ids from(
 select c.id,c.order_id from public.order_cancellation_requests c where c.claim_type in('return','exchange') and private.contact_subject(c.order_id)=p_subject_id
 and private.contact_retention(c.id,p_cutoff)->>'state'='due' order by c.order_id,c.id limit p_limit)x;
 select coalesce(array_agg(distinct party order by party),'{}') into parties from unnest(order_ids) o cross join lateral unnest(private.contact_parties(o)) party;
 parties:=array_append(parties,p_subject_id);
 perform private.contact_require_identity(p_actor_id,p_session_id,'platform.manage',true,parties,false);
 perform pg_advisory_xact_lock(hashtextextended('claim-contact-retention-operation:'||p_operation_id,0));
 select * into op from private.order_claim_contact_retention_operations where id=p_operation_id;
 if found then
  if op.actor_id is distinct from p_actor_id or op.session_id is distinct from p_session_id or op.command<>'purge' or op.request_hash<>request_hash then raise unique_violation using message='claim_contact_operation_conflict';end if;
  return op.receipt;
 end if;
 perform 1 from public.orders where id=any(order_ids) order by id for update;
 if exists(select 1 from public.order_cancellation_requests c where c.id=any(ids) and(private.contact_subject(c.order_id) is distinct from p_subject_id or
 exists(select 1 from unnest(private.contact_parties(c.order_id)) party where not party=any(parties)))) then raise sqlstate 'PT409' using message='claim_contact_changed';end if;
 perform 1 from public.order_shipments where order_id=any(order_ids) order by order_id,id for update;
 perform 1 from public.order_cancellation_requests where id=any(ids) order by order_id,id for update;
 perform 1 from public.order_claim_collections where claim_id=any(ids) order by claim_id,shipment_id for update;
 perform 1 from private.order_claim_contact_retention_cases where claim_id=any(ids) order by claim_id,case_ref for update;
 perform 1 from private.order_claim_contact_plans where claim_id=any(ids) order by claim_id,target for update;
 perform 1 from private.order_claim_contact_operations where claim_id=any(ids) order by id for update;
 perform 1 from private.order_claim_reshipment_destinations where claim_id=any(ids) order by claim_id for update;
 recorded:=clock_timestamp();
 if p_cutoff>recorded then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 for scope in select * from public.order_cancellation_requests where id=any(ids) order by order_id,id loop
  due:=private.contact_retention(scope.id,p_cutoff);if due->>'state'<>'due' then continue;end if;
  counts:=private.contact_counts(scope.id);
  for key in select jsonb_object_keys(removed) loop
   if key<>'operatorReferences' then removed:=jsonb_set(removed,array[key],to_jsonb((removed->>key)::integer+(counts->>key)::integer));end if;
  end loop;
  foreach v_target in array case when scope.claim_type='exchange' then array['collection','reshipment'] else array['collection'] end loop
   insert into private.order_claim_contact_plans(id,order_id,claim_id,target,revision,purged_at)
   values(extensions.gen_random_uuid(),scope.order_id,scope.id,v_target,1,recorded)
   on conflict(claim_id,target) do update set pii_version=null,sealed_plan=null,source_kind=null,source_id=null,source_revision=null,purged_at=recorded,updated_at=recorded;
  end loop;
  update private.order_claim_contact_operations set request_hmac=null,hmac_key_version=null,history=null,purged_at=recorded where claim_id=scope.id and state<>'sealed';
  update private.order_claim_reshipment_destinations set destination=null,purged_at=recorded where claim_id=scope.id;
  -- A return can retain an earlier exchange target after a type transition.
  update private.order_claim_contact_plans set pii_version=null,sealed_plan=null,source_kind=null,source_id=null,source_revision=null,purged_at=recorded,updated_at=recorded where claim_id=scope.id and purged_at is null;
  targets:=targets+(select count(*) from private.order_claim_contact_plans where claim_id=scope.id);
  if private.contact_count_sum(private.contact_counts(scope.id))<>0 then raise check_violation using message='claim_contact_purge_residual';end if;
  purged_ids:=array_append(purged_ids,scope.id);
 end loop;
 receipt:=jsonb_build_object('operationId',p_operation_id,'subjectId',p_subject_id,'actorId',p_actor_id,'sessionId',p_session_id,'cutoff',p_cutoff,'limit',p_limit,'recordedAt',recorded,
 'purgedClaimIds',to_jsonb(purged_ids),'purgedTargetCount',targets,'removed',removed,'selectedResidualPiiFields',0,'remaining',private.contact_retention_remaining(p_subject_id,statement_timestamp()));
 insert into private.order_claim_contact_retention_operations(id,actor_id,session_id,command,request_hash,receipt) values(p_operation_id,p_actor_id,p_session_id,'purge',request_hash,receipt);
 return receipt;
end $$;
-- Account-deletion fences must not overtake an unconfirmed replacement delivery.
create function private.contact_order_reshipment_pending(p_order uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.order_cancellation_requests c where c.order_id=p_order and c.claim_type='exchange' and c.stage='completed'
 and(c.reshipped_at is null or c.reship_carrier is null or c.reship_tracking_number is null or c.reship_delivered_at is null or c.reship_delivered_by is null or c.reship_delivery_evidence is null));
$$;
do $$declare definition text;changed text;begin
 definition:=pg_get_functiondef('private.account_deletion_blockers(uuid)'::regprocedure);
 changed:=replace(definition,'and order_record.status in (''pending'', ''paid'', ''confirmed'', ''shipping'')',
 'and (order_record.status in (''pending'', ''paid'', ''confirmed'', ''shipping'') or private.contact_order_reshipment_pending(order_record.id))');
 if changed=definition then raise check_violation using message='claim_contact_account_blocker_shape_changed';end if;
 execute changed;
end $$;
create or replace function private.gift_account_deletion_blockers(p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when count(*)=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('code','active_received_gift','count',count(*),'path','/gifts')) end
 from private.gift_intents gift join public.orders purchase on purchase.id=gift.order_id where gift.recipient_id=p_actor and gift.sender_id<>p_actor and
 (purchase.status not in('canceled','done') and not private.order_all_items_delivered(purchase.id)
 or private.contact_order_reshipment_pending(purchase.id)
 or exists(select 1 from public.order_cancellation_requests where order_id=purchase.id and status in('requested','processing','needs_review')));
$$;
-- Seal all new private state and functions before granting the eight service RPCs.
do $$declare item record;begin
 for item in select c.oid::regclass as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private'
 and c.relkind='r' and(c.relname like 'order_claim_contact_%' or c.relname='order_claim_reshipment_destinations') loop
  execute format('alter table %s enable row level security',item.name);
  execute format('revoke all on %s from public,anon,authenticated,service_role',item.name);
 end loop;
 for item in select p.oid::regprocedure as signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='private' and(p.proname like 'contact_%' or p.proname='record_order_claim_reshipment_physical'))
 or(n.nspname='public' and p.proname in('service_get_order_claim_contact_context','service_change_order_claim_contact','service_read_order_claim_contact_operation',
 'service_record_order_claim_reshipment_v2','service_read_order_claim_contact_history','service_record_order_claim_contact_retention_case',
 'service_inventory_order_claim_contact_data','service_purge_order_claim_contact_data')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',item.signature);
  execute format('grant execute on function %s to postgres',item.signature);
  if item.nspname='public' then
   execute format('grant execute on function %s to service_role',item.signature);
   perform private.register_operator_rpc_contract(item.signature,case when item.proname in('service_record_order_claim_contact_retention_case','service_inventory_order_claim_contact_data','service_purge_order_claim_contact_data') then 'platform.manage' else 'sales.manage' end,
   'service_start',item.proname in('service_record_order_claim_contact_retention_case','service_inventory_order_claim_contact_data','service_purge_order_claim_contact_data'));
  else perform private.register_operator_internal_contract(item.signature);end if;
 end loop;
end $$;
revoke all on function public.admin_record_order_claim_reshipment(uuid,text,text),public.admin_record_order_claim_reshipment(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_reshipment(uuid,text,text),public.admin_record_order_claim_reshipment(uuid,text,text,jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_record_order_claim_reshipment(uuid,text,text)'::regprocedure,'sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_record_order_claim_reshipment(uuid,text,text,jsonb)'::regprocedure,'sales.manage','read',false);
select private.register_operator_internal_contract('private.account_deletion_blockers(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.gift_account_deletion_blockers(uuid)'::regprocedure);
notify pgrst,'reload schema';
