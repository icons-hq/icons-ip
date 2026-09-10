-- #491: product exchange/return policy and operational claim cost evidence.
-- These values are customer guidance and staff evidence only. They never create a
-- charge, reduce a refund, block claim intake, or mutate the existing collection
-- and refund state machine.

alter table public.goods
  add column claim_return_allowed boolean,
  add column claim_exchange_allowed boolean,
  add column claim_restriction_reason text,
  add column claim_return_fee bigint,
  add column claim_return_free_shipping_fee bigint,
  add column claim_exchange_fee bigint;

alter table public.goods
  add constraint goods_claim_restriction_reason_shape check (
    claim_restriction_reason is null
    or (char_length(claim_restriction_reason) <= 2000 and not private.has_disallowed_shipping_notice_control(claim_restriction_reason))
  ),
  add constraint goods_claim_return_fee_shape check (claim_return_fee is null or claim_return_fee between 0 and 1000000),
  add constraint goods_claim_return_free_shipping_fee_shape check (claim_return_free_shipping_fee is null or claim_return_free_shipping_fee between 0 and 1000000),
  add constraint goods_claim_exchange_fee_shape check (claim_exchange_fee is null or claim_exchange_fee between 0 and 1000000),
  add constraint goods_claim_restriction_reason_required check (
    (claim_return_allowed is distinct from false or char_length(btrim(coalesce(claim_restriction_reason, ''), E' \t\n\r')) > 0)
    and (claim_exchange_allowed is distinct from false or char_length(btrim(coalesce(claim_restriction_reason, ''), E' \t\n\r')) > 0)
  );

alter table public.order_cancellation_requests
  add column operational_fee_kind text,
  add column operational_fee_amount bigint,
  add column operational_fee_note text,
  add column operational_fee_evidence text,
  add column operational_fee_confirmed_by uuid references public.profiles(id) on delete set null,
  add column operational_fee_confirmed_at timestamptz;

alter table public.order_cancellation_requests
  add constraint order_claim_operational_fee_kind_check check (
    operational_fee_kind is null or operational_fee_kind in ('return_shipping','exchange_shipping','other')
  ),
  add constraint order_claim_operational_fee_amount_check check (
    operational_fee_amount is null or operational_fee_amount between 0 and 1000000
  ),
  add constraint order_claim_operational_fee_note_check check (
    operational_fee_note is null or (char_length(operational_fee_note) between 1 and 500 and not private.has_disallowed_shipping_notice_control(operational_fee_note))
  ),
  add constraint order_claim_operational_fee_evidence_check check (
    operational_fee_evidence is null or (char_length(operational_fee_evidence) between 1 and 1000 and not private.has_disallowed_shipping_notice_control(operational_fee_evidence))
  ),
  add constraint order_claim_operational_fee_complete_check check (
    (operational_fee_amount is null
      and operational_fee_kind is null
      and operational_fee_note is null
      and operational_fee_evidence is null
      and operational_fee_confirmed_by is null
      and operational_fee_confirmed_at is null)
    or (operational_fee_amount is not null
      and operational_fee_kind is not null
      and operational_fee_note is not null
      and operational_fee_evidence is not null
      and operational_fee_confirmed_at is not null)
  );

-- Staff-only product policy setter. The null/0 distinction is preserved: null
-- means no confirmed amount, while 0 means an explicitly confirmed free policy.
create function public.admin_save_good_claim_policy(
  target_good_id text, target_policy jsonb, expected_updated_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); previous public.goods; saved public.goods;
  next_return boolean; next_exchange boolean; next_reason text; next_return_fee bigint;
  next_free_return_fee bigint; next_exchange_fee bigint; field text; before_policy jsonb; after_policy jsonb;
begin
  if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if jsonb_typeof(target_policy) is distinct from 'object' or exists(select 1 from jsonb_object_keys(target_policy) key
    where key not in ('returnAllowed','exchangeAllowed','restrictionReason','returnFee','returnFreeShippingFee','exchangeFee')) then
    raise invalid_parameter_value using message='invalid_good_claim_policy';
  end if;
  foreach field in array array['returnAllowed','exchangeAllowed'] loop
    if target_policy ? field and jsonb_typeof(target_policy->field) not in ('boolean','null') then
      raise invalid_parameter_value using message='invalid_good_claim_policy';
    end if;
  end loop;
  foreach field in array array['returnFee','returnFreeShippingFee','exchangeFee'] loop
    if target_policy ? field and jsonb_typeof(target_policy->field)<>'null' then
      if jsonb_typeof(target_policy->field)<>'number' or target_policy->>field !~ '^[0-9]+$'
        or (target_policy->>field)::numeric>1000000 then
        raise invalid_parameter_value using message='invalid_good_claim_policy';
      end if;
    end if;
  end loop;
  if target_policy ? 'restrictionReason' and jsonb_typeof(target_policy->'restrictionReason') not in ('string','null') then
    raise invalid_parameter_value using message='invalid_good_claim_policy';
  end if;
  select * into previous from public.goods where id=target_good_id for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  if previous.archived_at is not null then raise check_violation using message='good_archived'; end if;
  if expected_updated_at is null or previous.updated_at is distinct from expected_updated_at then
    raise exception using errcode='PT409',message='good_claim_policy_conflict';
  end if;
  next_return:=case when target_policy?'returnAllowed' then (target_policy->>'returnAllowed')::boolean else previous.claim_return_allowed end;
  next_exchange:=case when target_policy?'exchangeAllowed' then (target_policy->>'exchangeAllowed')::boolean else previous.claim_exchange_allowed end;
  next_reason:=case when target_policy?'restrictionReason' then nullif(btrim(target_policy->>'restrictionReason',E' \t\n\r'),'') else previous.claim_restriction_reason end;
  next_return_fee:=case when target_policy?'returnFee' then (target_policy->>'returnFee')::bigint else previous.claim_return_fee end;
  next_free_return_fee:=case when target_policy?'returnFreeShippingFee' then (target_policy->>'returnFreeShippingFee')::bigint else previous.claim_return_free_shipping_fee end;
  next_exchange_fee:=case when target_policy?'exchangeFee' then (target_policy->>'exchangeFee')::bigint else previous.claim_exchange_fee end;
  if char_length(coalesce(next_reason,''))>2000 or private.has_disallowed_shipping_notice_control(next_reason)
    or ((next_return=false or next_exchange=false) and next_reason is null) then
    raise check_violation using message='invalid_good_claim_policy';
  end if;
  before_policy:=jsonb_build_object('returnAllowed',previous.claim_return_allowed,'exchangeAllowed',previous.claim_exchange_allowed,
    'restrictionReason',previous.claim_restriction_reason,'returnFee',previous.claim_return_fee,
    'returnFreeShippingFee',previous.claim_return_free_shipping_fee,'exchangeFee',previous.claim_exchange_fee);
  after_policy:=jsonb_build_object('returnAllowed',next_return,'exchangeAllowed',next_exchange,'restrictionReason',next_reason,
    'returnFee',next_return_fee,'returnFreeShippingFee',next_free_return_fee,'exchangeFee',next_exchange_fee);
  if before_policy=after_policy then return after_policy||jsonb_build_object('goodId',previous.id,'updatedAt',previous.updated_at); end if;
  update public.goods set claim_return_allowed=next_return,claim_exchange_allowed=next_exchange,
    claim_restriction_reason=next_reason,claim_return_fee=next_return_fee,claim_return_free_shipping_fee=next_free_return_fee,
    claim_exchange_fee=next_exchange_fee where id=target_good_id returning * into saved;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'catalog.good.claim_policy_updated','goods:'||saved.id,
    jsonb_build_object('before',before_policy,'after',after_policy));
  return after_policy||jsonb_build_object('goodId',saved.id,'updatedAt',saved.updated_at);
end $$;
revoke all on function public.admin_save_good_claim_policy(text,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good_claim_policy(text,jsonb,timestamptz) to authenticated;

-- Record only the amount confirmed by operations. This RPC deliberately never
-- calls a refund, payment, claim transition, or CS intake gate.
create function public.admin_record_order_claim_operational_fee(
  p_claim_id uuid,
  p_fee_kind text,
  p_amount bigint,
  p_note text,
  p_evidence text,
  p_expected_updated_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid());
  previous public.order_cancellation_requests;
  saved public.order_cancellation_requests;
  normalized_note text := nullif(btrim(coalesce(p_note, '')), '');
  normalized_evidence text := nullif(btrim(coalesce(p_evidence, '')), '');
  normalized_kind text := nullif(btrim(coalesce(p_fee_kind, '')), '');
begin
  if actor is null or not public.is_staff() then raise insufficient_privilege using message = 'staff_required'; end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 1000000) then
    raise invalid_parameter_value using message = 'invalid_claim_operational_fee';
  end if;
  if p_amount is null then
    if normalized_kind is not null or normalized_note is not null or normalized_evidence is not null then
      raise invalid_parameter_value using message = 'invalid_claim_operational_fee';
    end if;
  elsif normalized_kind not in ('return_shipping','exchange_shipping','other')
    or normalized_note is null or char_length(normalized_note) > 500
    or normalized_evidence is null or char_length(normalized_evidence) > 1000
    or private.has_disallowed_shipping_notice_control(normalized_note)
    or private.has_disallowed_shipping_notice_control(normalized_evidence) then
    raise invalid_parameter_value using message = 'invalid_claim_operational_fee';
  end if;
  select * into previous from public.order_cancellation_requests where id = p_claim_id for update;
  if not found then raise no_data_found using message = 'claim_not_found'; end if;
  if p_expected_updated_at is null or previous.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'PT409', message = 'claim_operational_fee_conflict';
  end if;
  update public.order_cancellation_requests set
    operational_fee_kind = normalized_kind,
    operational_fee_amount = p_amount,
    operational_fee_note = normalized_note,
    operational_fee_evidence = normalized_evidence,
    operational_fee_confirmed_by = case when p_amount is null then null else actor end,
    operational_fee_confirmed_at = case when p_amount is null then null else clock_timestamp() end
    where id = p_claim_id returning * into saved;
  insert into public.audit_log(actor_id, action, target, diff)
    values (actor, 'admin.order.claim_operational_fee_recorded', 'order:' || saved.order_id::text,
      jsonb_build_object('claimId', saved.id, 'before', jsonb_build_object(
        'kind', previous.operational_fee_kind, 'amount', previous.operational_fee_amount,
        'note', previous.operational_fee_note, 'evidence', previous.operational_fee_evidence
      ), 'after', jsonb_build_object(
        'kind', saved.operational_fee_kind, 'amount', saved.operational_fee_amount,
        'note', saved.operational_fee_note, 'evidence', saved.operational_fee_evidence
      )));
  return jsonb_build_object('claimId', saved.id, 'kind', saved.operational_fee_kind,
    'amount', saved.operational_fee_amount, 'note', saved.operational_fee_note,
    'evidence', saved.operational_fee_evidence, 'confirmedBy', saved.operational_fee_confirmed_by,
    'confirmedAt', saved.operational_fee_confirmed_at, 'updatedAt', saved.updated_at);
end;
$$;
revoke all on function public.admin_record_order_claim_operational_fee(uuid,text,bigint,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_operational_fee(uuid,text,bigint,text,text,timestamptz) to authenticated;

-- Add operational evidence to the existing staff detail response without copying
-- the large claim-detail query. The inner function remains the source of all
-- existing order, collection, refund, and timeline semantics.
alter function public.admin_order_claim_detail(uuid) set schema private;
alter function private.admin_order_claim_detail(uuid) rename to admin_order_claim_detail_before_operational_fee;
revoke all on function private.admin_order_claim_detail_before_operational_fee(uuid) from public,anon,authenticated,service_role;
create function public.admin_order_claim_detail(p_claim_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid());
  detail jsonb;
  fee public.order_cancellation_requests;
begin
  if actor is null or not public.is_staff() then raise insufficient_privilege using message = 'staff_required'; end if;
  detail := private.admin_order_claim_detail_before_operational_fee(p_claim_id);
  if detail is null then return null; end if;
  select * into fee from public.order_cancellation_requests where id = p_claim_id;
  return detail || jsonb_build_object('claim', (detail->'claim') || jsonb_build_object(
    'operationalFee', jsonb_build_object(
      'kind', fee.operational_fee_kind,
      'amount', fee.operational_fee_amount,
      'note', fee.operational_fee_note,
      'evidence', fee.operational_fee_evidence,
      'confirmedBy', fee.operational_fee_confirmed_by,
      'confirmedAt', fee.operational_fee_confirmed_at,
      'updatedAt', fee.updated_at
    ),
    'updatedAt', fee.updated_at
  ));
end;
$$;
revoke all on function public.admin_order_claim_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_claim_detail(uuid) to authenticated;

-- Re-extend the public shipping policy with nullable claim guidance. Null is
-- intentionally preserved so the public UI can distinguish unknown from free.
create or replace function public.get_good_shipping_policy(target_good_id text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'originId', origin.id,
    'originName', origin.name,
    'returnAddress', origin.return_address,
    'baseFee', origin.base_fee,
    'freeThreshold', origin.free_threshold,
    'feeType', good.shipping_fee_type,
    'individualFee', good.individual_fee,
    'shippingNoticeTemplateId', good.shipping_notice_template_id,
    'shippingNoticeTemplateVersion', good.shipping_notice_template_version,
    'shippingNotice', coalesce(good.shipping_notice_snapshot->>'shippingNotice', ''),
    'returnExchangeNotice', coalesce(good.shipping_notice_snapshot->>'returnExchangeNotice', ''),
    'cs', jsonb_build_object(
      'name', coalesce(good.shipping_notice_snapshot->>'csName', ''),
      'phone', coalesce(good.shipping_notice_snapshot->>'csPhone', ''),
      'email', coalesce(good.shipping_notice_snapshot->>'csEmail', '')
    ),
    'claimPolicy', jsonb_build_object(
      'returnAllowed', good.claim_return_allowed,
      'exchangeAllowed', good.claim_exchange_allowed,
      'restrictionReason', good.claim_restriction_reason,
      'returnFee', good.claim_return_fee,
      'returnFreeShippingFee', good.claim_return_free_shipping_fee,
      'exchangeFee', good.claim_exchange_fee
    )
  )
  from public.goods good
  join public.ips ip on ip.id = good.ip_id
  join public.fulfillment_origins origin on origin.id = good.origin_id and origin.is_active
  where good.id = target_good_id and good.archived_at is null and good.published_at is not null
    and good.sale_restriction = 'none'
    and ip.archived_at is null and ip.published_at is not null;
$$;
revoke all on function public.get_good_shipping_policy(text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_shipping_policy(text) to anon,authenticated;

-- All form and spreadsheet updates use the same atomic writer. The guidance
-- setter never changes a payment, refund, or claim-intake decision.
alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_claim_policy;
revoke all on function private.admin_save_good_before_claim_policy(jsonb) from public,anon,authenticated,service_role;
create function public.admin_save_good(target_good jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb; current_good public.goods;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  saved:=private.admin_save_good_before_claim_policy(target_good-'claim_policy');
  if target_good?'claim_policy' then
    select * into current_good from public.goods where id=saved->>'id' for update;
    perform public.admin_save_good_claim_policy(current_good.id,target_good->'claim_policy',current_good.updated_at);
  end if;
  return saved;
end $$;
revoke all on function public.admin_save_good(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;
