-- Seller-assisted return/exchange intake only. Approval, collection receipts,
-- refunds, replacement stock and payment finalization remain separate actions.
create table private.seller_order_claim_intakes (
  claim_id uuid primary key references public.order_cancellation_requests(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  collection_snapshot jsonb not null check (jsonb_typeof(collection_snapshot) = 'array'),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.seller_order_claim_intakes enable row level security;
revoke all on private.seller_order_claim_intakes from public, anon, authenticated, service_role;

create function private.require_seller_claim_staff() returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise insufficient_privilege using message = 'staff_required'; end if;
  perform 1 from public.profiles where id = actor and role in ('staff', 'admin') and suspended_at is null for share;
  if not found then raise insufficient_privilege using message = 'staff_required'; end if;
  return actor;
end $$;
revoke all on function private.require_seller_claim_staff() from public, anon, authenticated, service_role;

-- Read-only rule shared by the form context and the locked writer. The existing
-- physical-delivery and withdrawal-window functions remain the canonical rules.
create function private.seller_claim_intake_block(p_order_id uuid, p_reason_type text, p_at timestamptz)
returns text language plpgsql stable security invoker set search_path = '' as $$
declare target public.orders;
begin
  select * into target from public.orders where id = p_order_id;
  if not found then return 'order_not_found'; end if;
  if target.status = 'canceled' then return 'already_canceled'; end if;
  if not private.order_all_items_delivered(p_order_id) then return 'not_claimable'; end if;
  if public.order_withdrawal_deadline_passed(target.delivered_at, p_reason_type, p_at) then return 'deadline_expired'; end if;
  if exists (select 1 from public.order_cancellation_requests where order_id = p_order_id and status in ('requested', 'processing', 'needs_review')) then return 'already_requested'; end if;
  if exists (select 1 from public.order_cancellation_claims where order_id = p_order_id) then return 'reconciliation_in_progress'; end if;
  return null;
end $$;
revoke all on function private.seller_claim_intake_block(uuid, text, timestamptz) from public, anon, authenticated, service_role;

create function private.seller_claim_collection_targets(p_order_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'shipmentId', s.id, 'originId', s.origin_id, 'originName', s.origin_name_snapshot,
    'returnAddress', origin.return_address, 'status', s.status,
    'items', (select jsonb_agg(jsonb_build_object('id', item.id, 'name', item.good_name_snapshot, 'qty', link.qty) order by item.id)
      from public.order_shipment_items link join public.order_items item on item.id = link.order_item_id where link.shipment_id = s.id)
  ) order by s.origin_id, s.id), '[]')
  from public.order_shipments s join public.fulfillment_origins origin on origin.id = s.origin_id
  where s.order_id = p_order_id and exists (select 1 from public.order_shipment_items link where link.shipment_id = s.id);
$$;
revoke all on function private.seller_claim_collection_targets(uuid) from public, anon, authenticated, service_role;

create function public.admin_seller_claim_intake_context(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target public.orders; result jsonb; observed_at timestamptz := clock_timestamp();
begin
  perform private.require_seller_claim_staff();
  select * into target from public.orders where id = p_order_id;
  if not found then return null; end if;
  select jsonb_build_object(
    'orderId', target.id, 'orderStatus', target.status, 'orderTotal', target.total,
    'buyerName', profile.nickname, 'createdAt', target.created_at, 'deliveredAt', target.delivered_at,
    'address', target.address, 'observedAt', observed_at,
    'blockedReasons', jsonb_build_object(
      'change_of_mind', private.seller_claim_intake_block(target.id, 'change_of_mind', observed_at),
      'defect', private.seller_claim_intake_block(target.id, 'defect', observed_at)),
    'activeClaim', (select jsonb_build_object('id', c.id, 'claimType', c.claim_type, 'stage', c.stage)
      from public.order_cancellation_requests c where c.order_id = target.id and c.status in ('requested', 'processing', 'needs_review') order by c.requested_at desc limit 1),
    'collections', private.seller_claim_collection_targets(target.id),
    'carriers', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'label', c.label, 'active', c.is_active, 'trackingUrlTemplate', c.tracking_url_template) order by c.sort_order, c.code)
      from public.shipping_carriers c where c.is_active), '[]'),
    'inquiries', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'reference', i.reference, 'title', i.title, 'createdAt', i.created_at) order by i.created_at desc)
      from (select * from public.inquiries where user_id = target.user_id and order_id = target.id order by created_at desc, id limit 50) i), '[]')
  ) into result from public.profiles profile where profile.id = target.user_id;
  return result;
end $$;
revoke all on function public.admin_seller_claim_intake_context(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_seller_claim_intake_context(uuid) to authenticated;

create function private.seller_claim_intake_json(p_claim_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'requestId', intake.claim_id, 'claimId', claim.id, 'reference', claim.reference,
    'orderId', claim.order_id, 'claimType', claim.claim_type, 'stage', claim.stage,
    'requestedAt', claim.requested_at, 'actorId', intake.actor_id, 'actorName', actor.nickname,
    'source', intake.payload->>'source', 'inquiryId', intake.payload->>'inquiryId',
    'customerRequestedAt', intake.payload->>'customerRequestedAt',
    'agreementEvidence', intake.payload->>'agreementEvidence',
    'collectionAddress', intake.payload->'collectionAddress',
    'collections', intake.collection_snapshot
  ) from private.seller_order_claim_intakes intake
    join public.order_cancellation_requests claim on claim.id = intake.claim_id
    join public.profiles actor on actor.id = intake.actor_id
  where intake.claim_id = p_claim_id;
$$;
revoke all on function private.seller_claim_intake_json(uuid) from public, anon, authenticated, service_role;

create function public.admin_get_seller_claim_intake(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_seller_claim_staff();
  if p_request_id is null then raise invalid_parameter_value using message = 'invalid_seller_claim_request'; end if;
  -- A readback must wait for an in-flight submission using the same request key.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('seller_claim_intake:' || p_request_id, 0));
  return private.seller_claim_intake_json(p_request_id);
end $$;
revoke all on function public.admin_get_seller_claim_intake(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_seller_claim_intake(uuid) to authenticated;

create function private.validate_seller_claim_intake(p_payload jsonb, p_refund_account jsonb) returns void
language plpgsql immutable security invoker set search_path = '' as $$
declare field text; row jsonb; address jsonb := p_payload->'collectionAddress';
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or not (p_payload ?& array['orderId','claimType','reasonType','reason','source','inquiryId','customerRequestedAt','agreementEvidence','agreementConfirmed','collectionAddress','collections'])
    or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('orderId','claimType','reasonType','reason','source','inquiryId','customerRequestedAt','agreementEvidence','agreementConfirmed','collectionAddress','collections'))
    or coalesce(p_payload->>'orderId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'claimType','') not in ('return','exchange')
    or coalesce(p_payload->>'reasonType','') not in ('change_of_mind','defect')
    or coalesce(p_payload->>'source','') not in ('inquiry','phone','email','other')
    or p_payload->'agreementConfirmed' is distinct from 'true'::jsonb
    or jsonb_typeof(p_payload->'customerRequestedAt') is distinct from 'string'
    or coalesce(p_payload->>'customerRequestedAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
  then raise invalid_parameter_value using message = 'invalid_seller_claim_request'; end if;
  foreach field in array array['reason','agreementEvidence'] loop
    if jsonb_typeof(p_payload->field) is distinct from 'string'
      or p_payload->>field <> btrim(p_payload->>field, E' \t\n\r')
      or char_length(p_payload->>field) not between 1 and (case when field = 'reason' then 200 else 1000 end)
      or translate(p_payload->>field, E'\n\r\t', '') ~ '[[:cntrl:]]'
    then raise invalid_parameter_value using message = 'invalid_seller_claim_evidence'; end if;
  end loop;
  if (p_payload->>'source' = 'inquiry' and coalesce(p_payload->>'inquiryId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or (p_payload->>'source' <> 'inquiry' and p_payload->'inquiryId' is distinct from 'null'::jsonb)
  then raise invalid_parameter_value using message = 'invalid_seller_claim_inquiry'; end if;

  if jsonb_typeof(address) is distinct from 'object'
    or not (address ?& array['recipientName','phone','postalCode','address1','address2'])
    or exists(select 1 from jsonb_object_keys(address) k where k not in ('recipientName','phone','postalCode','address1','address2'))
    or exists(select 1 from jsonb_each(address) x where jsonb_typeof(x.value) <> 'string')
    or coalesce(address->>'phone','') !~ '^[0-9]{8,15}$'
    or coalesce(address->>'postalCode','') !~ '^[0-9]{5}$'
  then raise invalid_parameter_value using message = 'invalid_seller_claim_collection_address'; end if;
  foreach field in array array['recipientName','phone','postalCode','address1','address2'] loop
    if address->>field <> btrim(address->>field, E' \t\n\r')
      or char_length(address->>field) > (case when field = 'recipientName' then 50 else 200 end)
      or (field <> 'address2' and char_length(address->>field) = 0)
      or address->>field ~ '[[:cntrl:]]'
    then raise invalid_parameter_value using message = 'invalid_seller_claim_collection_address'; end if;
  end loop;

  if jsonb_typeof(p_payload->'collections') is distinct from 'array'
    or jsonb_array_length(p_payload->'collections') not between 1 and 1000
  then raise invalid_parameter_value using message = 'invalid_seller_claim_collections'; end if;
  for row in select value from jsonb_array_elements(p_payload->'collections') loop
    if jsonb_typeof(row) is distinct from 'object'
      or not (row ?& array['shipmentId','method','carrier','trackingNumber','note'])
      or exists(select 1 from jsonb_object_keys(row) k where k not in ('shipmentId','method','carrier','trackingNumber','note'))
      or coalesce(row->>'shipmentId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(row->>'method','') not in ('not_requested','seller_arranged','customer_sent')
      or jsonb_typeof(row->'note') is distinct from 'string' or char_length(row->>'note') > 500
      or row->>'note' <> btrim(row->>'note', E' \t\n\r') or translate(row->>'note', E'\n\r\t','') ~ '[[:cntrl:]]'
      or jsonb_typeof(row->'carrier') not in ('string', 'null')
      or jsonb_typeof(row->'trackingNumber') not in ('string', 'null')
      or ((row->>'carrier' is null) <> (row->>'trackingNumber' is null))
      or (row->>'method' = 'customer_sent' and row->>'carrier' is null)
      or (row->>'method' = 'not_requested' and row->>'carrier' is not null)
      or (row->>'method' = 'seller_arranged' and char_length(row->>'note') = 0)
      or (row->>'carrier' is not null and (coalesce(row->>'carrier','') !~ '^[a-z0-9_]{2,32}$' or coalesce(row->>'trackingNumber','') !~ '^[A-Z0-9]{8,30}$'))
    then raise invalid_parameter_value using message = 'invalid_seller_claim_collections'; end if;
  end loop;

  if p_refund_account is not null and p_refund_account <> 'null'::jsonb then
    if p_payload->>'claimType' <> 'return' or jsonb_typeof(p_refund_account) is distinct from 'object'
      or not (p_refund_account ?& array['bankName','accountNumber','accountHolder'])
      or exists(select 1 from jsonb_object_keys(p_refund_account) k where k not in ('bankName','accountNumber','accountHolder'))
      or exists(select 1 from jsonb_each(p_refund_account) x where jsonb_typeof(x.value) <> 'string')
      or coalesce(p_refund_account->>'accountNumber','') !~ '^[0-9-]{8,30}$'
    then raise invalid_parameter_value using message = 'invalid_seller_claim_refund_account'; end if;
    foreach field in array array['bankName','accountHolder'] loop
      if p_refund_account->>field <> btrim(p_refund_account->>field)
        or char_length(p_refund_account->>field) not between 1 and 40
        or p_refund_account->>field ~ '[[:cntrl:]]'
      then raise invalid_parameter_value using message = 'invalid_seller_claim_refund_account'; end if;
    end loop;
  end if;
end $$;
revoke all on function private.validate_seller_claim_intake(jsonb, jsonb) from public, anon, authenticated, service_role;

create function public.admin_submit_seller_claim_intake(p_request_id uuid, p_payload jsonb, p_refund_account jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.require_seller_claim_staff(); target public.orders;
  previous private.seller_order_claim_intakes; saved_payload jsonb; collections jsonb; targets jsonb;
  block text; submitted_at timestamptz; requested_at timestamptz; target_id uuid;
begin
  if p_request_id is null then raise invalid_parameter_value using message = 'invalid_seller_claim_request'; end if;
  perform private.validate_seller_claim_intake(p_payload, p_refund_account);
  target_id := (p_payload->>'orderId')::uuid;
  requested_at := (p_payload->>'customerRequestedAt')::timestamptz;
  -- Raw bank details have exactly one storage destination and its existing purge
  -- lifecycle. The idempotency receipt stores only their SHA-256 fingerprint.
  saved_payload := p_payload || jsonb_build_object('refundAccountDigest',
    case when p_refund_account is null or p_refund_account = 'null'::jsonb then null
      else encode(extensions.digest(p_refund_account::text, 'sha256'), 'hex') end);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('seller_claim_intake:' || p_request_id, 0));
  select * into previous from private.seller_order_claim_intakes where claim_id = p_request_id;
  if found then
    if previous.actor_id <> actor or previous.payload <> saved_payload then
      raise exception using errcode = 'PT409', message = 'seller_claim_request_conflict';
    end if;
    return private.seller_claim_intake_json(p_request_id);
  end if;
  if exists(select 1 from public.order_cancellation_requests where id = p_request_id) then
    raise exception using errcode = 'PT409', message = 'seller_claim_request_conflict';
  end if;

  -- Same parent-first order as customer intake and dispatch. No financial
  -- operation is performed after these locks; they only stabilize eligibility.
  select * into target from public.orders where id = target_id for update;
  if not found then raise no_data_found using message = 'order_not_found'; end if;
  perform s.id from public.order_shipments s where s.order_id = target_id order by s.id for update;
  perform attempt.id from public.payment_attempts attempt where attempt.purpose = 'order' and attempt.ref_id = target_id order by attempt.id for update;
  submitted_at := clock_timestamp();
  block := private.seller_claim_intake_block(target_id, p_payload->>'reasonType', submitted_at);
  if block is not null then raise check_violation using message = block; end if;
  if requested_at < target.created_at or requested_at > submitted_at then
    raise invalid_parameter_value using message = 'invalid_seller_claim_customer_time';
  end if;
  if p_payload->>'source' = 'inquiry' then
    perform 1 from public.inquiries where id = (p_payload->>'inquiryId')::uuid and user_id = target.user_id and order_id = target_id for share;
    if not found then raise check_violation using message = 'seller_claim_inquiry_mismatch'; end if;
  end if;
  targets := private.seller_claim_collection_targets(target_id);
  if jsonb_array_length(targets) <> jsonb_array_length(p_payload->'collections')
    or (select count(distinct (x->>'shipmentId')::uuid) from jsonb_array_elements(p_payload->'collections') x) <> jsonb_array_length(targets)
    or exists(select 1 from jsonb_array_elements(p_payload->'collections') x where not exists(select 1 from jsonb_array_elements(targets) t where (t->>'shipmentId')::uuid = (x->>'shipmentId')::uuid))
  then raise check_violation using message = 'seller_claim_collections_changed'; end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'collections') x where x->>'carrier' is not null
    and not exists(select 1 from public.shipping_carriers carrier where carrier.code = x->>'carrier' and carrier.is_active))
  then raise check_violation using message = 'unknown_shipping_carrier'; end if;
  select jsonb_agg(x || jsonb_build_object('originId', t->>'originId', 'originName', t->>'originName', 'items', t->'items') order by t->>'originId', t->>'shipmentId')
    into collections from jsonb_array_elements(p_payload->'collections') x join jsonb_array_elements(targets) t on (x->>'shipmentId')::uuid = (t->>'shipmentId')::uuid;

  insert into public.order_cancellation_requests(id, order_id, requested_by, claim_type, reason_type, reason, stage, requested_at)
    values(p_request_id, target_id, target.user_id, p_payload->>'claimType', p_payload->>'reasonType', p_payload->>'reason', 'requested', submitted_at);
  insert into private.seller_order_claim_intakes(claim_id, actor_id, payload, collection_snapshot, created_at)
    values(p_request_id, actor, saved_payload, collections, submitted_at);
  -- Preserve the submitted payload for exact idempotency while the immutable
  -- target labels/items are stored separately inside the same private receipt.
  -- They are returned by joining the original input with its intake snapshot.
  if p_refund_account is not null and p_refund_account <> 'null'::jsonb then
    insert into private.claim_refund_accounts(claim_id, bank_name, account_number, account_holder, masked_account, masked_holder)
      values(p_request_id, p_refund_account->>'bankName', p_refund_account->>'accountNumber', p_refund_account->>'accountHolder',
        (p_refund_account->>'bankName') || ' ' || public.mask_refund_account_number(p_refund_account->>'accountNumber'),
        public.mask_refund_account_holder(p_refund_account->>'accountHolder'));
  end if;
  insert into public.audit_log(actor_id, action, target, diff) values(actor, 'admin.order.claim_intake_created', 'order:' || target_id::text,
    jsonb_build_object('claimId', p_request_id, 'claimType', p_payload->>'claimType', 'to', 'requested', 'source', p_payload->>'source',
      'inquiryId', p_payload->>'inquiryId', 'customerRequestedAt', requested_at, 'collectionCount', jsonb_array_length(collections)));
  perform private.notify_order_claim(p_request_id, 'seller_requested', '반품·교환 요청이 접수됐어요',
    '고객님과 확인한 내용을 바탕으로 담당자가 요청을 접수했습니다. 승인과 이후 처리는 별도로 진행됩니다.');
  return private.seller_claim_intake_json(p_request_id);
end $$;
revoke all on function public.admin_submit_seller_claim_intake(uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_submit_seller_claim_intake(uuid, jsonb, jsonb) to authenticated;

-- Keep the existing detail wrapper's custom-input projection and add only
-- staff-visible intake provenance; no new metadata is granted to customer rows.
create or replace function public.admin_order_claim_detail(p_claim_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message = 'staff required'; end if;
  result := private.admin_order_claim_detail_before_custom_inputs(p_claim_id);
  if result is null then return null; end if;
  if result->'order' is not null and result->'order' <> 'null'::jsonb then
    result := jsonb_set(result, '{order,items}', private.with_order_item_custom_inputs(result#>'{order,items}'));
  end if;
  return result || jsonb_build_object('sellerIntake', private.seller_claim_intake_json(p_claim_id));
end $$;
revoke all on function public.admin_order_claim_detail(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_order_claim_detail(uuid) to authenticated;

notify pgrst, 'reload schema';
