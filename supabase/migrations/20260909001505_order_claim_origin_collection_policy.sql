-- #453 / approved A: whole-order claims, origin-specific physical collection.
-- Confirmation is historical: changing the derived status cannot reopen cancellation.
create function private.preserve_order_confirmation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.confirmed_at is not null then new.confirmed_at:=old.confirmed_at; end if;
 if new.status in ('confirmed','shipping','delivered','done') then
   new.confirmed_at:=coalesce(new.confirmed_at,new.shipped_at,new.delivered_at,new.done_at,clock_timestamp());
 end if;
 return new;
end $$;
revoke all on function private.preserve_order_confirmation() from public,anon,authenticated,service_role;
create trigger orders_preserve_confirmation before insert or update of status,confirmed_at on public.orders
for each row execute function private.preserve_order_confirmation();

-- A shipment item records the physical quantity, independently of order totals.
alter table public.order_shipment_items add column qty integer;
update public.order_shipment_items link set qty=item.qty from public.order_items item where item.id=link.order_item_id;
alter table public.order_shipment_items alter column qty set not null;
alter table public.order_shipment_items add constraint order_shipment_items_qty_positive check(qty>0);
create function private.snapshot_shipment_item_quantity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.qty is null then select qty into new.qty from public.order_items where id=new.order_item_id and order_id=new.order_id; end if;
 return new;
end $$;
revoke all on function private.snapshot_shipment_item_quantity() from public,anon,authenticated,service_role;
create trigger shipment_items_snapshot_quantity before insert on public.order_shipment_items
for each row execute function private.snapshot_shipment_item_quantity();

create function private.order_cancel_eligible(target_order uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select o.status in ('pending','paid') and o.confirmed_at is null
   and o.shipped_at is null and o.delivered_at is null and o.done_at is null
   and not exists(select 1 from public.order_shipments s where s.order_id=o.id
     and (s.status<>'ready' or s.shipped_at is not null or s.delivered_at is not null or s.exported_at is not null))
   and not exists(select 1 from public.audit_log a where a.target='order:'||o.id::text
     and ((a.action='admin.order.status_updated' and a.diff->>'to' in ('confirmed','shipping','delivered','done'))
       or a.action in ('admin.shipment.status_updated','admin.shipment.exported')))
   from public.orders o where o.id=target_order),false);
$$;
revoke all on function private.order_cancel_eligible(uuid) from public,anon,authenticated,service_role;
create function private.order_all_items_delivered(target_order uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.orders o where o.id=target_order and o.status in ('delivered','done'))
   and exists(select 1 from public.order_items i where i.order_id=target_order)
   and not exists(select 1 from public.order_items i where i.order_id=target_order and
     coalesce((select sum(link.qty) from public.order_shipment_items link join public.order_shipments s on s.id=link.shipment_id
       where link.order_item_id=i.id and link.order_id=i.order_id and s.status='delivered' and s.delivered_at is not null),0)<>i.qty);
$$;
revoke all on function private.order_all_items_delivered(uuid) from public,anon,authenticated,service_role;
create function public.order_claim_eligibility(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare delivery_complete boolean;
begin
 if (select auth.uid()) is null or not exists(select 1 from public.orders o where o.id=p_order_id and (o.user_id=(select auth.uid()) or public.is_staff())) then return null; end if;
 delivery_complete:=private.order_all_items_delivered(p_order_id);
 return jsonb_build_object('cancel',private.order_cancel_eligible(p_order_id),'return',delivery_complete,'exchange',delivery_complete);
end $$;
revoke all on function public.order_claim_eligibility(uuid) from public,anon,authenticated,service_role;
grant execute on function public.order_claim_eligibility(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.request_order_claim(p_order_id uuid, p_user_id uuid, p_claim_type text, p_reason text, p_reason_type text, p_bank_name text DEFAULT NULL::text, p_account_number text DEFAULT NULL::text, p_account_holder text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid;
  v_status public.order_status;
  v_delivered_at timestamptz;
  v_claim_id uuid;
  v_has_unresolved_attempt boolean;
  v_masked_account text;
  v_masked_holder text;
  v_payment_count integer;
begin
  if p_claim_type is null or p_claim_type not in ('cancel', 'return', 'exchange') then
    raise check_violation using message = 'invalid claim type';
  end if;
  if p_reason_type is null or p_reason_type not in ('change_of_mind', 'defect') then
    raise check_violation using message = 'invalid cancellation reason type';
  end if;
  if p_reason is null
    or btrim(p_reason) <> p_reason
    or length(p_reason) not between 1 and 200
  then
    raise check_violation using message = 'invalid cancellation reason';
  end if;

  -- Common intake/dispatch lock order: order → shipments → payment attempts/payments.
  select orders.user_id, orders.status, orders.delivered_at
  into v_user_id, v_status, v_delivered_at
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found or p_user_id is null or v_user_id is distinct from p_user_id then
    return 'not_found';
  end if;

  perform s.id from public.order_shipments s where s.order_id=p_order_id order by s.id for update;

  perform attempt.id
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = p_order_id
  order by attempt.id
  for update;

  select exists (
    select 1
    from public.payment_attempts as attempt
    where attempt.purpose = 'order'
      and attempt.ref_id = p_order_id
      and attempt.state in (
        'prepared', 'confirming', 'unknown', 'needs_review', 'approved'
      )
  )
  into v_has_unresolved_attempt;

  if v_status = 'canceled' then
    return 'already_canceled';
  end if;

  -- 반품·교환은 물리적 회수를 전제한다. 배송이 끝나기 전에는 회수할 물건이
  -- Customer cancellation is available only before order confirmation.
  if p_claim_type in ('return', 'exchange') then
    if not private.order_all_items_delivered(p_order_id) then
      return 'not_claimable';
    end if;
  elsif not private.order_cancel_eligible(p_order_id) then
    return 'not_cancelable';
  end if;

  -- 교환도 청약철회 기한을 준용한다(변심 7일 · 하자 3개월). 판정의 진실원은
  -- 계속 order_withdrawal_deadline_passed 하나다.
  if public.order_withdrawal_deadline_passed(v_delivered_at, p_reason_type, now()) then
    return 'deadline_expired';
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = p_order_id
      and request.status in ('requested', 'processing', 'needs_review')
  ) then
    return 'already_requested';
  end if;

  -- status는 적지 않는다. 투영은 private.order_claim_status_for_stage 하나가 만든다.
  insert into public.order_cancellation_requests (
    order_id,
    requested_by,
    reason,
    reason_type,
    claim_type,
    stage
  )
  values (
    p_order_id,
    p_user_id,
    p_reason,
    p_reason_type,
    p_claim_type,
    'requested'
  )
  returning id into v_claim_id;

  /*
   * 환불계좌는 무통장 환불의 유일한 경로이고 카드 fallback의 안전망이다.
   * 세 칸이 모두 있을 때만 저장한다 — 반쪽 계좌는 송금에 쓸 수 없다.
   *
   * 교환에는 저장하지 않는다. 교환의 종결은 재출고이고 어떤 경로로도 돈이
   * 돌아가지 않으므로 계좌를 받을 목적 자체가 없다. 화면은 반품에만 폼을
   * 보이지만 API로는 실어 보낼 수 있으므로 접수 함수가 거른다. 취소·반품은
   * 결제사 취소가 막혔을 때 송금이 유일한 경로라 계속 받고, 보관 기간은
   * 종결 stage에서 seal_order_claim_refund_account가 잡는다.
   */
  if p_claim_type <> 'exchange'
    and p_bank_name is not null
    and p_account_number is not null
    and p_account_holder is not null
  then
    v_masked_account := public.mask_refund_account_number(p_account_number);
    v_masked_holder := public.mask_refund_account_holder(p_account_holder);

    insert into private.claim_refund_accounts (
      claim_id,
      bank_name,
      account_number,
      account_holder,
      masked_account,
      masked_holder
    )
    values (
      v_claim_id,
      btrim(p_bank_name),
      p_account_number,
      btrim(p_account_holder),
      btrim(p_bank_name) || ' ' || v_masked_account,
      v_masked_holder
    );
  end if;

  -- 결제 이력이 없는 pending 주문은 예전처럼 즉시 종결한다.
  if p_claim_type = 'cancel'
    and v_status = 'pending'
    and not v_has_unresolved_attempt
    and not exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = p_order_id
    )
  then
    perform public.finalize_order_cancellation_with_provider_evidence(
      p_order_id,
      p_reason,
      array[]::text[]
    );

    update public.order_cancellation_requests
    set
      stage = 'completed',
      completed_at = now(),
      updated_at = now()
    where id = v_claim_id;

    return 'completed';
  end if;

  /*
   * 자동 승인 — paid(발주확인 전) 변심 취소.
   *
   * 아직 발주확인도 하지 않은 주문의 변심 취소를 사람이 판단할 이유가 없다.
   * 스마트스토어와 같은 경계다. confirmed부터는 발송 준비가 시작됐으므로
   * 운영자 판단으로 남긴다.
   *
   * 승인의 실질(durable claim + 환불 intent)은 admin_decide_order_cancellation의
   * 승인 분기와 같다. decided_by는 null로 남긴다 — 사람이 누른 적이 없다.
   */
  if p_claim_type = 'cancel'
    and v_status = 'paid'
    and p_reason_type = 'change_of_mind'
  then
    insert into public.order_cancellation_claims (
      order_id,
      requested_by,
      previous_status
    )
    values (p_order_id, p_user_id, v_status)
    on conflict (order_id) do nothing;

    insert into public.refunds (
      payment_id,
      amount,
      reason,
      status,
      cancellation_request_id
    )
    select
      payment.id,
      payment.amount,
      p_reason,
      case when refund.status = 'done' then 'done' else 'requested' end,
      v_claim_id
    from public.payments as payment
    left join public.refunds as refund on refund.payment_id = payment.id
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
      and payment.status in ('pending', 'paid', 'canceled', 'refunded')
    on conflict (payment_id) do update
    set
      cancellation_request_id = excluded.cancellation_request_id,
      reason = coalesce(public.refunds.reason, excluded.reason),
      status = case
        when public.refunds.status = 'done' then 'done'
        else 'requested'
      end;

    select count(*)::integer
    into v_payment_count
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
      and payment.status in ('pending', 'paid', 'canceled', 'refunded');

    update public.order_cancellation_requests
    set
      stage = 'processing',
      decided_at = now(),
      provider_started_at = now(),
      updated_at = now()
    where id = v_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      p_user_id,
      'order.claim_auto_approved',
      'order:' || p_order_id::text,
      jsonb_build_object(
        'claimId', v_claim_id,
        'claimType', 'cancel',
        'from', 'requested',
        'to', 'processing',
        'previousOrderStatus', v_status::text,
        'reasonType', p_reason_type,
        'paymentCount', v_payment_count
      )
    );

    perform private.notify_order_claim(
      v_claim_id,
      'auto_approved',
      '취소 요청이 접수됐어요',
      '발송 전 주문이라 자동으로 승인됐습니다. 결제 취소 처리를 시작합니다.'
    );

    return 'auto_approved';
  end if;

  perform private.notify_order_claim(
    v_claim_id,
    'requested',
    '클레임 요청이 접수됐어요',
    '요청을 접수했습니다. 담당자가 확인한 뒤 진행 상황을 알려드립니다.'
  );

  return 'requested';
end;
$function$;

revoke all on function public.request_order_claim(uuid,uuid,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.request_order_claim(uuid,uuid,text,text,text,text,text,text) to service_role;

-- Historical, already-recorded collection facts remain historical. Only unfinished
-- physical recovery is upgraded; provider/financial ledgers are never synthesized.
alter table public.order_cancellation_requests add column collection_policy text not null default 'legacy'
  check(collection_policy in ('legacy','origin'));
alter table public.order_cancellation_requests add column collection_required boolean not null default false;
-- Metadata-only backfill does not represent a new operator/provider action.
alter table public.order_cancellation_requests disable trigger trg_order_cancellation_requests_updated;
update public.order_cancellation_requests c set collection_required=true where c.claim_type in ('return','exchange');
update public.order_cancellation_requests c set collection_policy='origin'
where c.claim_type in ('return','exchange') and c.stage not in ('completed','rejected') and c.collected_at is null;
-- A past cancellation after confirmation/dispatch is not evidence of collection.
update public.order_cancellation_requests c set collection_policy='origin',collection_required=true
from public.orders o where o.id=c.order_id and c.claim_type='cancel' and c.stage not in ('completed','rejected')
 and o.status<>'canceled' and not private.order_cancel_eligible(o.id);
alter table public.order_cancellation_requests enable trigger trg_order_cancellation_requests_updated;
alter table public.order_cancellation_requests alter column collection_policy set default 'origin';
create function private.set_claim_collection_requirement() returns trigger
language plpgsql security invoker set search_path='' as $$
begin new.collection_required:=(new.claim_type in ('return','exchange')); return new; end $$;
revoke all on function private.set_claim_collection_requirement() from public,anon,authenticated,service_role;
create trigger claims_collection_requirement before insert on public.order_cancellation_requests
for each row execute function private.set_claim_collection_requirement();

create table public.order_claim_collections (
 claim_id uuid not null references public.order_cancellation_requests(id) on delete cascade,
 shipment_id uuid not null references public.order_shipments(id) on delete restrict,
 origin_id uuid not null references public.fulfillment_origins(id) on delete restrict,
 origin_name_snapshot text not null,
 return_address_snapshot text not null,
 items_snapshot jsonb not null check(jsonb_typeof(items_snapshot)='array' and jsonb_array_length(items_snapshot)>0),
 collected_at timestamptz,
 collected_by uuid references public.profiles(id) on delete restrict,
 evidence text check(evidence is null or (evidence=btrim(evidence) and char_length(evidence) between 1 and 500 and translate(evidence,E'\n\r\t','') !~ '[[:cntrl:]]')),
 primary key(claim_id,shipment_id),
 unique(claim_id,origin_id),
 check((collected_at is null and collected_by is null and evidence is null)
   or (collected_at is not null and collected_by is not null and evidence is not null and btrim(return_address_snapshot)<>''))
);
alter table public.order_claim_collections enable row level security;
revoke all on public.order_claim_collections from public,anon,authenticated,service_role;
grant select on public.order_claim_collections to authenticated;
create policy order_claim_collections_owner_staff on public.order_claim_collections for select to authenticated
using(exists(select 1 from public.order_cancellation_requests c join public.orders o on o.id=c.order_id
  where c.id=claim_id and (o.user_id=(select auth.uid()) or public.is_staff())));

create function private.prepare_claim_collections(target_claim uuid,require_address boolean default true) returns void
language plpgsql security invoker set search_path='' as $$
declare claim public.order_cancellation_requests;
begin
 select * into claim from public.order_cancellation_requests where id=target_claim;
 if claim.collection_policy<>'origin' or not claim.collection_required then return; end if;
 -- Caller owns order → shipment → claim locks. Origin settings cannot change in
 -- the middle of a collection snapshot; an origin is locked in UUID order.
 perform o.id from public.fulfillment_origins o where o.id in(select s.origin_id from public.order_shipments s where s.order_id=claim.order_id) order by o.id for share;
 if require_address and exists(select 1 from public.order_shipments s join public.fulfillment_origins o on o.id=s.origin_id
   where s.order_id=claim.order_id and exists(select 1 from public.order_shipment_items i where i.shipment_id=s.id)
   and btrim(o.return_address)='') then raise check_violation using message='claim_return_address_required'; end if;
 insert into public.order_claim_collections(claim_id,shipment_id,origin_id,origin_name_snapshot,return_address_snapshot,items_snapshot)
 select claim.id,s.id,s.origin_id,s.origin_name_snapshot,o.return_address,
   (select jsonb_agg(jsonb_build_object('orderItemId',i.id,'name',i.good_name_snapshot,'qty',link.qty) order by i.id)
    from public.order_shipment_items link join public.order_items i on i.id=link.order_item_id where link.shipment_id=s.id)
 from public.order_shipments s join public.fulfillment_origins o on o.id=s.origin_id
 where s.order_id=claim.order_id and exists(select 1 from public.order_shipment_items i where i.shipment_id=s.id)
 on conflict(claim_id,shipment_id) do nothing;
 if require_address and not exists(select 1 from public.order_claim_collections where claim_id=target_claim) then
   raise check_violation using message='claim_collections_incomplete'; end if;
end $$;
revoke all on function private.prepare_claim_collections(uuid,boolean) from public,anon,authenticated,service_role;
-- Existing unfinished claims get snapshots without pretending an absent address
-- is collection evidence. It can be captured once, before the first confirmation.
do $$ declare claim record; begin
 for claim in select id from public.order_cancellation_requests where collection_policy='origin' and collection_required
   and (stage in ('collecting','collected','processing','needs_review') or (stage='on_hold' and held_from in ('collecting','collected','processing','needs_review')))
 loop perform private.prepare_claim_collections(claim.id,false); end loop;
end $$;

create function private.claim_collections_complete(target_claim uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select not c.collection_required or c.collection_policy='legacy' or
   (exists(select 1 from public.order_items i where i.order_id=c.order_id)
    and exists(select 1 from public.order_claim_collections x where x.claim_id=c.id)
    and not exists(select 1 from public.order_claim_collections x where x.claim_id=c.id and x.collected_at is null)
    and not exists(select 1 from public.order_items i where i.order_id=c.order_id and
      coalesce((select sum((j->>'qty')::bigint) from public.order_claim_collections x cross join lateral jsonb_array_elements(x.items_snapshot) j
       where x.claim_id=c.id and (j->>'orderItemId')::uuid=i.id),0)<>i.qty))
 from public.order_cancellation_requests c where c.id=target_claim),false);
$$;
revoke all on function private.claim_collections_complete(uuid) from public,anon,authenticated,service_role;
create function private.assert_claim_collections_complete(target_claim uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if not private.claim_collections_complete(target_claim) then raise check_violation using message='claim_collections_incomplete'; end if;
end $$;
revoke all on function private.assert_claim_collections_complete(uuid) from public,anon,authenticated,service_role;
create function private.claim_collection_records(target_claim uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('shipmentId',x.shipment_id,'originId',x.origin_id,'originName',x.origin_name_snapshot,
  'returnAddress',x.return_address_snapshot,'items',x.items_snapshot,'collectedAt',x.collected_at,'collectedBy',x.collected_by,'collectorName',(select nickname from public.profiles where id=x.collected_by),'evidence',x.evidence)
  order by x.origin_id,x.shipment_id),'[]') from public.order_claim_collections x where x.claim_id=target_claim;
$$;
revoke all on function private.claim_collection_records(uuid) from public,anon,authenticated,service_role;

create function public.admin_record_order_claim_origin_collection(p_claim_id uuid,p_shipment_id uuid,p_evidence text)
returns text language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());claim public.order_cancellation_requests;collection public.order_claim_collections;order_key uuid;address_value text;
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff required'; end if;
 if p_evidence is null or p_evidence<>btrim(p_evidence) or char_length(p_evidence) not between 1 and 500 or translate(p_evidence,E'\n\r\t','') ~ '[[:cntrl:]]' then
   raise check_violation using message='invalid_collection_evidence'; end if;
 select order_id into order_key from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found'; end if;
 perform id from public.orders where id=order_key for update;
 perform id from public.order_shipments where order_id=order_key order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
 if claim.collection_policy<>'origin' or not claim.collection_required then raise check_violation using message='claim_type_has_no_collection'; end if;
 select * into collection from public.order_claim_collections where claim_id=p_claim_id and shipment_id=p_shipment_id for update;
 if not found then raise no_data_found using message='claim_collection_not_found'; end if;
 if collection.collected_at is not null then
   if collection.evidence=p_evidence then return case when private.claim_collections_complete(p_claim_id) then 'collected' else 'collecting' end; end if;
   raise unique_violation using message='claim_collection_conflict';
 end if;
 if claim.stage not in ('collecting','collected','processing','needs_review') then raise exception using message='claim_not_collectable'; end if;
 address_value:=collection.return_address_snapshot;
 if btrim(address_value)='' then
   select return_address into address_value from public.fulfillment_origins where id=collection.origin_id for share;
   if coalesce(btrim(address_value),'')='' then raise check_violation using message='claim_return_address_required'; end if;
 end if;
 update public.order_claim_collections set return_address_snapshot=address_value,collected_at=clock_timestamp(),collected_by=actor,evidence=p_evidence
 where claim_id=p_claim_id and shipment_id=p_shipment_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.claim_origin_collected','order:'||order_key::text,
  jsonb_build_object('claimId',p_claim_id,'shipmentId',p_shipment_id,'originId',collection.origin_id,'items',collection.items_snapshot,'returnAddress',address_value,'evidence',p_evidence));
 if private.claim_collections_complete(p_claim_id) then
   update public.order_cancellation_requests set collected_at=coalesce(collected_at,clock_timestamp()),
     stage=case when stage='collecting' then 'collected' else stage end,updated_at=clock_timestamp() where id=p_claim_id returning * into claim;
   perform private.notify_order_claim(p_claim_id,'collected','반송한 굿즈가 모두 입고됐어요','모든 출고지의 입고가 확인되어 후속 처리를 준비합니다.');
 end if;
 return case when private.claim_collections_complete(p_claim_id) then 'collected' else 'collecting' end;
end $$;
revoke all on function public.admin_record_order_claim_origin_collection(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_origin_collection(uuid,uuid,text) to authenticated;

-- This is called before any external provider cancel by the server orchestrator.
-- It checks business authorization, not whether provider evidence already exists.
create function public.assert_order_cancellation_reconciliation_allowed(p_request_id uuid,p_actor_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare claim public.order_cancellation_requests;purchase public.orders;order_key uuid;
begin
 if p_actor_id is null or not exists(select 1 from public.profiles where id=p_actor_id and role in ('staff','admin') and suspended_at is null) then
   raise insufficient_privilege using message='staff required'; end if;
 select order_id into order_key from public.order_cancellation_requests where id=p_request_id;
 if not found then raise no_data_found using message='cancellation_request_not_found'; end if;
 select * into purchase from public.orders where id=order_key for update;
 perform id from public.order_shipments where order_id=order_key order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_request_id for update;
 if claim.stage='completed' and purchase.status='canceled' then return 'completed'; end if;
 if claim.stage='on_hold' then raise check_violation using message='claim_on_hold'; end if;
 if claim.claim_type='exchange' or claim.status not in ('processing','needs_review') then
   raise check_violation using message='cancellation_request_not_processing'; end if;
 perform private.assert_claim_collections_complete(p_request_id);
 if claim.claim_type='cancel' and not claim.collection_required and not private.order_cancel_eligible(order_key) then
   raise check_violation using message='order_not_cancelable'; end if;
 return 'allowed';
end $$;
revoke all on function public.assert_order_cancellation_reconciliation_allowed(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.assert_order_cancellation_reconciliation_allowed(uuid,uuid) to service_role;

create function private.assert_order_collections_complete(target_order uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare claim record;
begin
 if exists(select 1 from public.orders where id=target_order and status='canceled') then return; end if;
 for claim in select id from public.order_cancellation_requests where order_id=target_order
   and stage not in ('completed','rejected') and collection_required order by id
 loop perform private.assert_claim_collections_complete(claim.id); end loop;
 if not private.order_cancel_eligible(target_order) and not exists(
   select 1 from public.order_cancellation_requests where order_id=target_order
     and stage in ('processing','needs_review','collected') and collection_required
     and private.claim_collections_complete(id)) then
   raise check_violation using message='order_not_cancelable';
 end if;
end $$;
revoke all on function private.assert_order_collections_complete(uuid) from public,anon,authenticated,service_role;

-- service_role has column UPDATE privileges on orders for server operations.
-- A raw status write cannot bypass the same physical and financial evidence seam.
create function private.guard_order_claim_cancellation_transition() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='canceled' and old.status<>'canceled' then
   perform private.assert_order_collections_complete(old.id);
   if not private.order_cancel_eligible(old.id) and (not exists(select 1 from public.payments p join public.refunds r on r.payment_id=p.id
       where p.purpose='order' and p.ref_id=old.id and p.status='refunded' and r.status='done')
     or exists(select 1 from public.payments where purpose='order' and ref_id=old.id and status in ('pending','paid'))) then
     raise check_violation using message='payment evidence required';
   end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_order_claim_cancellation_transition() from public,anon,authenticated,service_role;
create trigger orders_claim_cancellation_guard before update of status on public.orders
for each row execute function private.guard_order_claim_cancellation_transition();
CREATE OR REPLACE FUNCTION public.admin_decide_order_claim(p_claim_id uuid, p_decision text, p_note text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_order_id uuid;
  v_order_status public.order_status;
  v_delivered_at timestamptz;
  v_claim record;
  v_next_stage text;
  v_payment_count integer;
  /*
   * 보류를 벗긴 실질 단계.
   *
   * on_hold는 절차의 단계가 아니라 그 위에 덮인 표시다. 보류 중인 클레임을
   * 판정할 때 stage만 보면 processing에서 건 보류가 "아직 착수 전"으로 보인다.
   * lib/orders/claims.ts의 orderClaimEffectiveStage와 같은 정의다.
   */
  v_effective_stage text;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_decision not in ('review', 'approve', 'reject', 'hold', 'resume') then
    raise check_violation using message = 'invalid claim decision';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_claim_id;

  if v_order_id is null then
    raise no_data_found using message = 'claim_not_found';
  end if;

  -- 잠금 순서: 주문 → 클레임. admin_decide_order_cancellation과 같다.
  select orders.status, orders.delivered_at
  into v_order_status, v_delivered_at
  from public.orders
  where orders.id = v_order_id
  for update;

  perform s.id from public.order_shipments s where s.order_id=v_order_id order by s.id for update;

  select request.*
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id
  for update;

  if v_claim.stage in ('completed', 'rejected') then
    raise exception using message = 'claim_not_decidable';
  end if;

  v_effective_stage := case
    when v_claim.stage = 'on_hold' then coalesce(v_claim.held_from, 'requested')
    else v_claim.stage
  end;

  if p_decision = 'reject' then
    if p_note is null
      or btrim(p_note) <> p_note
      or length(p_note) not between 10 and 200
    then
      raise check_violation using message = 'invalid rejection reason';
    end if;

    /*
     * 거절은 처리에 착수하기 전에만 가능하다.
     *
     * processing·needs_review는 이미 durable claim과 refunds(status='requested')를
     * 열어 둔 상태다. 그 상태에서 요청만 rejected로 닫으면 주문은 "취소 진행 중"인
     * 채로 남고 complete_order_cancellation_request가 cancellation_request_not_processing
     * 으로 막아 돈이 갇힌다. needs_review는 Korpay 수동 복구 seam까지 함께 닫혀
     * 복구 경로가 하나도 남지 않는다. 그 단계에서 되돌릴 일이 있으면 거절이 아니라
     * 보류·정합화로 처리한다.
     */
    if v_effective_stage not in ('requested', 'in_review', 'collecting', 'collected') then
      raise exception using message = 'claim_not_rejectable';
    end if;

    update public.order_cancellation_requests
    set
      stage = 'rejected',
      decided_by = v_actor,
      decision_note = p_note,
      decided_at = now(),
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_rejected',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', v_claim.stage,
        'to', 'rejected',
        'reason', p_note
      )
    );

    perform private.notify_order_claim(
      p_claim_id,
      'rejected',
      '클레임 요청이 거절됐어요',
      '요청이 거절됐습니다. 사유: ' || p_note
    );
    return 'rejected';
  end if;

  if p_decision = 'hold' then
    if p_note is null
      or btrim(p_note) <> p_note
      or length(p_note) not between 10 and 200
    then
      raise check_violation using message = 'invalid hold reason';
    end if;
    if v_claim.stage = 'on_hold' then
      return 'on_hold';
    end if;

    update public.order_cancellation_requests
    set
      stage = 'on_hold',
      held_from = v_claim.stage,
      hold_reason = p_note,
      held_at = now(),
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_held',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', v_claim.stage,
        'to', 'on_hold',
        'reason', p_note
      )
    );

    perform private.notify_order_claim(
      p_claim_id,
      'held',
      '클레임 처리가 보류됐어요',
      '처리가 보류됐습니다. 사유: ' || p_note
    );
    return 'on_hold';
  end if;

  if p_decision = 'resume' then
    if v_claim.stage <> 'on_hold' then
      raise exception using message = 'claim_not_held';
    end if;

    v_next_stage := coalesce(v_claim.held_from, 'requested');

    -- status를 여기서 계산하지 않는다. held_from이 needs_review면 이 자리에서
    -- 'requested'를 적어 투영 CHECK에 막혔고, 보류가 영원히 풀리지 않았다(F3).
    update public.order_cancellation_requests
    set
      stage = v_next_stage,
      held_from = null,
      hold_reason = null,
      held_at = null,
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_resumed',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', 'on_hold',
        'to', v_next_stage
      )
    );

    perform private.notify_order_claim(
      p_claim_id,
      'resumed',
      '클레임 처리가 재개됐어요',
      '보류가 해제되어 처리가 다시 시작됐습니다.'
    );
    return v_next_stage;
  end if;

  if p_decision = 'review' then
    if v_claim.stage <> 'requested' then
      raise exception using message = 'claim_not_decidable';
    end if;

    update public.order_cancellation_requests
    set
      stage = 'in_review',
      decided_by = v_actor,
      updated_at = now()
    where id = p_claim_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_in_review',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'from', 'requested',
        'to', 'in_review'
      )
    );
    return 'in_review';
  end if;

  -- 승인.
  if v_claim.stage not in ('requested', 'in_review') then
    raise exception using message = 'claim_not_decidable';
  end if;

  if v_order_status not in (
    'pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done'
  ) then
    raise exception using message = 'order_not_cancelable';
  end if;

  if v_claim.claim_type='cancel' and not private.order_cancel_eligible(v_order_id) then raise exception using message='order_not_cancelable'; end if;
  if v_claim.claim_type in ('return','exchange') and not private.order_all_items_delivered(v_order_id) then raise exception using message='order_not_claimable'; end if;
  perform private.prepare_claim_collections(p_claim_id);

  -- Money/deadline approval continues to use the original request time.
  if public.order_withdrawal_deadline_passed(
    v_delivered_at,
    v_claim.reason_type,
    v_claim.requested_at
  ) then
    raise check_violation using message = 'withdrawal_deadline_expired';
  end if;

  -- 취소는 회수할 물건이 없으므로 곧장 환불 처리로 간다. 반품·교환은 수거부터다.
  if v_claim.claim_type = 'cancel' then
    v_next_stage := 'processing';
  else
    v_next_stage := 'collecting';
  end if;

  if v_next_stage = 'processing' then
    insert into public.order_cancellation_claims (
      order_id,
      requested_by,
      previous_status
    )
    values (v_order_id, v_claim.requested_by, v_order_status)
    on conflict (order_id) do nothing;

    insert into public.refunds (
      payment_id,
      amount,
      reason,
      status,
      cancellation_request_id
    )
    select
      payment.id,
      payment.amount,
      v_claim.reason,
      case when refund.status = 'done' then 'done' else 'requested' end,
      p_claim_id
    from public.payments as payment
    left join public.refunds as refund on refund.payment_id = payment.id
    where payment.purpose = 'order'
      and payment.ref_id = v_order_id
      and payment.status in ('pending', 'paid', 'canceled', 'refunded')
    on conflict (payment_id) do update
    set
      cancellation_request_id = excluded.cancellation_request_id,
      reason = coalesce(public.refunds.reason, excluded.reason),
      status = case
        when public.refunds.status = 'done' then 'done'
        else 'requested'
      end;

    select count(*)::integer
    into v_payment_count
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = v_order_id
      and payment.status in ('pending', 'paid', 'canceled', 'refunded');
  end if;

  update public.order_cancellation_requests
  set
    stage = v_next_stage,
    decided_by = v_actor,
    decision_note = null,
    decided_at = now(),
    provider_started_at = case when v_next_stage = 'processing' then now() else provider_started_at end,
    collecting_at = case when v_next_stage = 'collecting' then now() else collecting_at end,
    updated_at = now()
  where id = p_claim_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.claim_approved',
    'order:' || v_order_id::text,
    jsonb_build_object(
      'claimId', p_claim_id,
      'claimType', v_claim.claim_type,
      'from', v_claim.stage,
      'to', v_next_stage,
      'previousOrderStatus', v_order_status::text,
      'reasonType', v_claim.reason_type,
      'paymentCount', coalesce(v_payment_count, 0)
    )
  );

  perform private.notify_order_claim(
    p_claim_id,
    'approved',
    '클레임 요청이 승인됐어요',
    case
      when v_next_stage = 'collecting'
        then '요청이 승인됐습니다. 안내받은 방법으로 굿즈를 반송해주세요.'
      else '요청이 승인됐습니다. 결제 취소 처리를 시작합니다.'
    end
  );

  return v_next_stage;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_decide_order_cancellation(p_request_id uuid, p_decision text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_order_id uuid;
  v_order_status public.order_status;
  v_delivered_at timestamptz;
  v_request record;
  v_payment_count integer;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise check_violation using message = 'invalid cancellation decision';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select orders.status, orders.delivered_at
  into v_order_status, v_delivered_at
  from public.orders
  where orders.id = v_order_id
  for update;

  perform s.id from public.order_shipments s where s.order_id=v_order_id order by s.id for update;

  select request.*
  into v_request
  from public.order_cancellation_requests as request
  where request.id = p_request_id
  for update;

  if v_request.status <> 'requested' then
    raise exception using message = 'cancellation_request_not_decidable';
  end if;

  -- status만으로는 부족하다. 새 stage는 전부 'requested'로 투영된다.
  if v_request.claim_type <> 'cancel' or v_request.stage <> 'requested' then
    raise exception using message = 'claim_requires_claim_console';
  end if;

  if v_order_status not in (
    'pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done'
  ) then
    raise exception using message = 'order_not_cancelable';
  end if;

  if p_decision = 'reject' then
    if p_note is null
      or btrim(p_note) <> p_note
      or length(p_note) not between 10 and 200
    then
      raise check_violation using message = 'invalid rejection reason';
    end if;

    update public.order_cancellation_requests
    set
      status = 'rejected',
      decided_by = v_actor,
      decision_note = p_note,
      decided_at = now(),
      updated_at = now()
    where id = p_request_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.cancellation_rejected',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'requestId', p_request_id,
        'from', 'requested',
        'to', 'rejected',
        'reason', p_note
      )
    );
    return;
  end if;

  if not private.order_cancel_eligible(v_order_id) then raise exception using message='order_not_cancelable'; end if;

  if public.order_withdrawal_deadline_passed(
    v_delivered_at,
    v_request.reason_type,
    v_request.requested_at
  ) then
    raise check_violation using message = 'withdrawal_deadline_expired';
  end if;

  insert into public.order_cancellation_claims (
    order_id,
    requested_by,
    previous_status
  )
  values (
    v_order_id,
    v_request.requested_by,
    v_order_status
  )
  on conflict (order_id) do nothing;

  insert into public.refunds (
    payment_id,
    amount,
    reason,
    status,
    cancellation_request_id
  )
  select
    payment.id,
    payment.amount,
    v_request.reason,
    case when refund.status = 'done' then 'done' else 'requested' end,
    p_request_id
  from public.payments as payment
  left join public.refunds as refund on refund.payment_id = payment.id
  where payment.purpose = 'order'
    and payment.ref_id = v_order_id
    and payment.status in ('pending', 'paid', 'canceled', 'refunded')
  on conflict (payment_id) do update
  set
    cancellation_request_id = excluded.cancellation_request_id,
    reason = coalesce(public.refunds.reason, excluded.reason),
    status = case
      when public.refunds.status = 'done' then 'done'
      else 'requested'
    end;

  select count(*)::integer
  into v_payment_count
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_order_id
    and payment.status in ('pending', 'paid', 'canceled', 'refunded');

  update public.order_cancellation_requests
  set
    status = 'processing',
    decided_by = v_actor,
    decision_note = null,
    decided_at = now(),
    provider_started_at = now(),
    updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.cancellation_approved',
    'order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'from', 'requested',
      'to', 'processing',
      'previousOrderStatus', v_order_status::text,
      'reasonType', v_request.reason_type,
      'paymentCount', v_payment_count
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_record_order_claim_collection(p_claim_id uuid, p_stage text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_claim record;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_stage not in ('collecting', 'collected') then
    raise check_violation using message = 'invalid collection stage';
  end if;

  perform o.id from public.orders o join public.order_cancellation_requests c on c.order_id=o.id where c.id=p_claim_id for update of o;
  perform s.id from public.order_shipments s join public.order_cancellation_requests c on c.order_id=s.order_id where c.id=p_claim_id order by s.id for update of s;

  select request.*
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id
  for update;

  if not found then
    raise no_data_found using message = 'claim_not_found';
  end if;

  if v_claim.collection_policy='origin' and p_stage='collected' then raise check_violation using message='origin_collection_required'; end if;

  if v_claim.claim_type = 'cancel' then
    raise exception using message = 'claim_type_has_no_collection';
  end if;

  -- 수거 시작은 승인이 이미 만든다. 같은 값으로 다시 부르면 멱등하게 통과하고,
  -- 그 밖의 단계에서 부르면 거절한다 — 뒤로 감는 전이를 만들지 않는다.
  if p_stage = 'collecting' then
    if v_claim.stage = 'collecting' then
      return 'collecting';
    end if;
    raise exception using message = 'claim_not_collectable';
  end if;

  if v_claim.stage = 'collected' then
    return 'collected';
  end if;
  if v_claim.stage <> 'collecting' then
    raise exception using message = 'claim_not_collectable';
  end if;

  update public.order_cancellation_requests
  set
    stage = p_stage,
    collected_at = case when p_stage = 'collected' then now() else collected_at end,
    updated_at = now()
  where id = p_claim_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.claim_collected',
    'order:' || v_claim.order_id::text,
    jsonb_build_object(
      'claimId', p_claim_id,
      'claimType', v_claim.claim_type,
      'from', v_claim.stage,
      'to', p_stage
    )
  );

  perform private.notify_order_claim(
    p_claim_id,
    'collected',
    '반송한 굿즈가 입고됐어요',
    case
      when v_claim.claim_type = 'exchange'
        then '입고가 확인됐습니다. 교환 상품 재출고를 준비합니다.'
      else '입고가 확인됐습니다. 영업일 기준 3일 이내에 환급 절차를 진행합니다.'
    end
  );

  return p_stage;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_order_claim_detail(p_claim_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_claim record;
  v_result jsonb;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select request.*
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id;

  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'claim', jsonb_build_object(
      'id', v_claim.id,
      'collectionPolicy',v_claim.collection_policy,
      'collectionComplete',private.claim_collections_complete(v_claim.id),
      'collections',private.claim_collection_records(v_claim.id),
      'reference', v_claim.reference,
      'orderId', v_claim.order_id,
      'claimType', v_claim.claim_type,
      'stage', v_claim.stage,
      'status', v_claim.status,
      'reason', v_claim.reason,
      'reasonType', v_claim.reason_type,
      'decisionNote', v_claim.decision_note,
      'holdReason', v_claim.hold_reason,
      'heldAt', v_claim.held_at,
      -- 보류를 풀었을 때 돌아갈 단계. 화면이 이 값을 봐야 processing에서 건 보류에
      -- 거부 버튼을 그리지 않는다(DB의 claim_not_rejectable와 같은 판정).
      'heldFrom', v_claim.held_from,
      'requestedAt', v_claim.requested_at,
      'decidedAt', v_claim.decided_at,
      'collectingAt', v_claim.collecting_at,
      'collectedAt', v_claim.collected_at,
      'completedAt', v_claim.completed_at,
      'reshipCarrier', v_claim.reship_carrier,
      'reshipTrackingNumber', v_claim.reship_tracking_number,
      'reshippedAt', v_claim.reshipped_at,
      'reshippedItems', (select coalesce(jsonb_agg(jsonb_build_object('orderItemId',r.order_item_id,'name',oi.good_name_snapshot,
        'variantId',r.variant_id,'variantName',r.variant_name_snapshot,'variantCode',r.variant_code_snapshot,'qty',r.qty) order by r.order_item_id),'[]')
        from public.order_claim_reshipment_items r join public.order_items oi on oi.id=r.order_item_id where r.claim_id=v_claim.id),
      'lastErrorCode', v_claim.last_error_code,
      'handlerName', (
        select handler.nickname
        from public.profiles as handler
        where handler.id = v_claim.decided_by
      )
    ),
    'order', (
      select jsonb_build_object(
        'id', orders.id,
        'status', orders.status,
        'total', orders.total,
        'shippingFee', orders.shipping_fee,
        'createdAt', orders.created_at,
        'deliveredAt', orders.delivered_at,
        'shipments', private.order_shipment_records(orders.id),
        'buyerName', profile.nickname,
        'buyerEmail', profile.email,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', item.id,
            'goodId', item.good_id,
            'variantId', item.variant_id,
            'variantName', item.variant_name_snapshot,
            'currentVariantId', private.order_item_stock_variant(item.id),
            'options', (select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'code',v.code,'stockQty',v.stock_qty) order by v.sort_order,v.id),'[]')
              from public.goods_variants v where v.good_id=item.good_id and (v.archived_at is null or v.id=private.order_item_stock_variant(item.id))),
            'name', item.good_name_snapshot,
            'qty', item.qty,
            'unitPrice', item.unit_price
          ) order by item.id)
          from public.order_items as item
          where item.order_id = orders.id
        ), '[]'::jsonb)
      )
      from public.orders as orders
      join public.profiles as profile on profile.id = orders.user_id
      where orders.id = v_claim.order_id
    ),
    'payment', (
      select jsonb_build_object(
        'id', payment.id,
        'provider', payment.provider,
        'status', payment.status,
        'amount', payment.amount,
        'createdAt', payment.created_at
      )
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = v_claim.order_id
        and payment.status <> 'failed'
      order by payment.created_at desc, payment.id desc
      limit 1
    ),
    'refund', (
      select jsonb_build_object(
        'status', refund.status,
        'amount', refund.amount,
        'method', refund.method,
        'filedAt', refund.filed_at,
        'completedAt', refund.completed_at,
        'settlementNote', refund.settlement_note,
        'handlerName', (
          select handler.nickname
          from public.profiles as handler
          where handler.id = refund.handled_by
        )
      )
      from public.refunds as refund
      join public.payments as payment on payment.id = refund.payment_id
      where payment.purpose = 'order'
        and payment.ref_id = v_claim.order_id
      order by refund.created_at desc, refund.id desc
      limit 1
    ),
    -- 뽑기권 발급/사용 여부. 취소·반품 완료 시 회수 대상이 남아 있는지를
    -- 운영자가 승인 전에 봐야 한다(약관 제17조).
    'cardPacks', (
      select jsonb_build_object(
        'issued', count(*),
        'consumed', count(*) filter (where ticket.consumed_at is not null),
        'revoked', count(*) filter (where ticket.revoked_at is not null)
      )
      from public.draw_tickets as ticket
      where ticket.source = 'order_paid'
        and ticket.source_id = v_claim.order_id
    ),
    'refundAccount', (
      select jsonb_build_object(
        'maskedAccount', account.masked_account,
        'maskedHolder', account.masked_holder,
        'purgeAfter', account.purge_after,
        'purgedAt', account.purged_at
      )
      from private.claim_refund_accounts as account
      where account.claim_id = v_claim.id
    ),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'action', entry.action,
        'createdAt', entry.created_at,
        'diff', entry.diff,
        'actorName', (
          select actor.nickname
          from public.profiles as actor
          where actor.id = entry.actor_id
        )
      ) order by entry.created_at, entry.id)
      from public.audit_log as entry
      where entry.target = 'order:' || v_claim.order_id::text
        -- 레거시 감사 액션(admin.order.cancellation_*)도 같은 클레임의 이력이다.
        -- 'claim'만 찾으면 #252 이전 경로로 처리된 건의 타임라인이 비어 보인다.
        and (entry.action like '%claim%' or entry.action like '%cancellation%')
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_record_order_claim_refund(p_claim_id uuid, p_method text, p_stage text, p_note text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_claim record;
  v_order_status public.order_status;
  v_refund_count integer;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_method not in ('pg_cancel', 'bank_transfer') then
    raise check_violation using message = 'invalid refund method';
  end if;
  if p_stage not in ('filed', 'completed') then
    raise check_violation using message = 'invalid refund stage';
  end if;
  if p_note is not null
    and (btrim(p_note) <> p_note or length(p_note) not between 1 and 300)
  then
    raise check_violation using message = 'invalid settlement note';
  end if;

  select request.order_id
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id;

  if not found then
    raise no_data_found using message = 'claim_not_found';
  end if;

  select orders.status
  into v_order_status
  from public.orders
  where orders.id = v_claim.order_id
  for update;

  select request.*
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id
  for update;

  perform private.assert_claim_collections_complete(p_claim_id);

  if v_claim.claim_type = 'exchange' then
    raise exception using message = 'exchange_has_no_refund';
  end if;

  /*
   * 계좌 송금은 받아 둔 계좌가 있을 때만 적을 수 있다.
   *
   * 없는 계좌로 'bank_transfer'를 기록하면 원장은 송금했다고 말하고 구매자에게는
   * "등록하신 환불계좌로 송금을 접수했습니다"가 나간다 — 존재하지 않는 계좌를
   * 근거로 한 안내다. 파기된 행(purged_at)은 통과시킨다: 수집 사실은 남아 있고,
   * 그때 송금은 실제로 그 계좌로 갔다.
   */
  if p_method = 'bank_transfer'
    and not exists (
      select 1
      from private.claim_refund_accounts as account
      where account.claim_id = p_claim_id
    )
  then
    raise exception using message = 'claim_refund_account_missing';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_claim.order_id
  order by payment.id
  for update;

  if p_stage = 'filed' then
    if v_claim.stage not in ('collected', 'processing') then
      raise exception using message = 'claim_not_refundable';
    end if;

    -- 반품은 입고가 확인된 뒤에야 durable claim이 생긴다. 그 전에 만들면
    -- 물건이 돌아오지 않은 주문의 재고가 복원 대기 상태로 열린다.
    if v_claim.stage = 'collected' then
      insert into public.order_cancellation_claims (
        order_id,
        requested_by,
        previous_status
      )
      values (v_claim.order_id, v_claim.requested_by, v_order_status)
      on conflict (order_id) do nothing;

      insert into public.refunds (
        payment_id,
        amount,
        reason,
        status,
        cancellation_request_id
      )
      select
        payment.id,
        payment.amount,
        v_claim.reason,
        case when refund.status = 'done' then 'done' else 'requested' end,
        p_claim_id
      from public.payments as payment
      left join public.refunds as refund on refund.payment_id = payment.id
      where payment.purpose = 'order'
        and payment.ref_id = v_claim.order_id
        and payment.status in ('pending', 'paid', 'canceled', 'refunded')
      on conflict (payment_id) do update
      set
        cancellation_request_id = excluded.cancellation_request_id,
        reason = coalesce(public.refunds.reason, excluded.reason),
        status = case
          when public.refunds.status = 'done' then 'done'
          else 'requested'
        end;

      update public.order_cancellation_requests
      set
        stage = 'processing',
        provider_started_at = coalesce(provider_started_at, now()),
        updated_at = now()
      where id = p_claim_id;
    end if;

    -- 수단·처리자·접수시각은 첫 기록이 이긴다. 재접수가 덮으면 이미 계좌로 송금한
    -- 건이 결제사 취소로 보이고, 실제로 접수한 사람이 마지막 클릭한 사람으로 바뀐다.
    -- 갱신 가능한 것은 상계·정산 메모뿐이다.
    update public.refunds as refund
    set
      method = coalesce(refund.method, p_method),
      handled_by = coalesce(refund.handled_by, v_actor),
      filed_at = coalesce(refund.filed_at, now()),
      settlement_note = coalesce(p_note, refund.settlement_note)
    from public.payments as payment
    where refund.payment_id = payment.id
      and payment.purpose = 'order'
      and payment.ref_id = v_claim.order_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.claim_refund_filed',
      'order:' || v_claim.order_id::text,
      jsonb_build_object(
        'claimId', p_claim_id,
        'claimType', v_claim.claim_type,
        'method', p_method,
        'from', v_claim.stage,
        'to', 'processing'
      )
    );

    perform private.notify_order_claim(
      p_claim_id,
      'refund_filed',
      '환불 접수가 완료됐어요',
      case
        when p_method = 'bank_transfer'
          then '등록하신 환불계좌로 송금을 접수했습니다.'
        else '결제사에 결제 취소를 접수했습니다. 카드사 처리 일정에 따라 반영 시점이 다를 수 있습니다.'
      end
    );

    return 'filed';
  end if;

  -- 완료 기록.
  if v_claim.stage <> 'completed' then
    raise exception using message = 'claim_refund_finalization_required';
  end if;

  update public.refunds as refund
  set
    method = coalesce(refund.method, p_method),
    handled_by = coalesce(refund.handled_by, v_actor),
    completed_at = coalesce(refund.completed_at, now()),
    settlement_note = coalesce(p_note, refund.settlement_note)
  from public.payments as payment
  where refund.payment_id = payment.id
    and payment.purpose = 'order'
    and payment.ref_id = v_claim.order_id;

  get diagnostics v_refund_count = row_count;

  -- 환불 원장이 한 줄도 없는 완료는 "돈은 돌아갔는데 장부가 비었다"는 뜻이다.
  -- 첫 판매 리스크 목록이 지적한 그 상태를 여기서 막는다.
  if v_refund_count = 0 then
    raise exception using message = 'claim_refund_ledger_missing';
  end if;

  -- 환불계좌 파기 기한은 여기서 잡지 않는다. 클레임이 종결 stage에 닿는 순간
  -- private.seal_order_claim_refund_account가 이미 잡았다 — 거절·교환·레거시
  -- 완료까지 같은 규칙을 받으려면 판정이 한 곳에 있어야 한다.

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.claim_refund_completed',
    'order:' || v_claim.order_id::text,
    jsonb_build_object(
      'claimId', p_claim_id,
      'claimType', v_claim.claim_type,
      'method', p_method,
      'refundRows', v_refund_count,
      'settlementNote', p_note
    )
  );

  perform private.notify_order_claim(
    p_claim_id,
    'refund_completed',
    '환불이 완료됐어요',
    '환급 처리가 완료됐습니다. 결제수단에 따라 반영 시점이 다를 수 있습니다.'
  );

  return 'completed';
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_record_order_claim_reshipment(p_claim_id uuid, p_carrier text, p_tracking_number text, p_items jsonb)
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
  if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff required'; end if;
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
    perform private.change_goods_variant_stock(item.good_id,item.variant_id,item.delta);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',order_item_id,'goodId',good_id,'sourceVariantId',source_variant_id,'variantId',variant_id,'qty',qty) order by order_item_id),'[]')
    into shipped_items from public.order_claim_reshipment_items where claim_id=p_claim_id;
  update public.order_cancellation_requests set stage='completed',reship_carrier=carrier,reship_tracking_number=tracking,
    reshipped_at=now(),completed_at=now(),updated_at=now() where id=p_claim_id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.claim_reshipped','order:'||selected_order::text,
    jsonb_build_object('claimId',p_claim_id,'claimType','exchange','from','collected','to','completed','carrier',carrier,'items',shipped_items));
  perform private.notify_order_claim(p_claim_id,'reshipped','교환 상품이 재출고됐어요','교환 상품을 새 운송장으로 발송했습니다.');
  return 'completed';
end $function$;

CREATE OR REPLACE FUNCTION public.finalize_order_cancellation_with_provider_evidence(p_order_id uuid, p_reason text, p_provider_payment_keys text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status public.order_status;
  v_provider_payment_keys text[] := coalesce(
    array_remove(p_provider_payment_keys, null),
    array[]::text[]
  );
  v_item record;
begin
  select orders.status
  into v_status
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order not found';
  end if;

  perform s.id from public.order_shipments s where s.order_id=p_order_id order by s.id for update;
  perform private.assert_order_collections_complete(p_order_id);

  if v_status not in (
    'pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'order not cancelable';
  end if;

  -- 배송이 나간 뒤의 취소는 staff 결정이 남긴 durable claim이 반드시 선행한다.
  -- claim이 없다는 것은 승인 경로 밖에서 들어왔다는 뜻이므로 거절한다.
  if v_status in ('shipping', 'delivered', 'done') and not exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = p_order_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'order not cancelable';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
  order by payment.id
  for update;

  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
      and payment.status in ('pending', 'paid')
      and (
        payment.payment_key is null
        or not (payment.payment_key = any(v_provider_payment_keys))
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'provider cancellation required';
  end if;

  if v_status in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
    and not exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = p_order_id
        and (
          payment.status in ('canceled', 'refunded')
          or payment.payment_key = any(v_provider_payment_keys)
        )
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'payment evidence required';
  end if;

  if v_status <> 'canceled' then
    for v_item in
      select order_item.id, order_item.good_id, order_item.qty, private.order_item_stock_variant(order_item.id) as variant_id
      from public.order_items as order_item
      where order_item.order_id = p_order_id
      order by order_item.good_id, order_item.id
    loop
      perform private.change_goods_variant_stock(v_item.good_id, v_item.variant_id, v_item.qty::bigint);
      insert into public.audit_log(actor_id,action,target,diff)
      values((select auth.uid()),'order.option_stock_restored','order:'||p_order_id::text,
        jsonb_build_object('orderItemId',v_item.id,'goodId',v_item.good_id,'variantId',v_item.variant_id,'delta',v_item.qty,'reason',p_reason));
    end loop;

    perform ticket.id
    from public.draw_tickets as ticket
    where ticket.source = 'order_paid'
      and ticket.source_id = p_order_id
      and ticket.consumed_at is null
      and ticket.revoked_at is null
    order by ticket.id
    for update;

    update public.draw_tickets as ticket
    set revoked_at = now()
    where ticket.source = 'order_paid'
      and ticket.source_id = p_order_id
      and ticket.consumed_at is null
      and ticket.revoked_at is null;
  end if;

  insert into public.refunds (payment_id, amount, reason, status)
  select
    payment.id,
    payment.amount,
    p_reason,
    'done'
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
    and (
      payment.status in ('canceled', 'refunded')
      or payment.payment_key = any(v_provider_payment_keys)
    )
  on conflict (payment_id) do update
  set
    amount = excluded.amount,
    reason = coalesce(public.refunds.reason, excluded.reason),
    status = 'done';

  update public.payments as payment
  set status = 'refunded'
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
    and (
      payment.status in ('canceled', 'refunded')
      or payment.payment_key = any(v_provider_payment_keys)
    );

  if v_status <> 'canceled' then
    update public.orders
    set
      status = 'canceled',
      expires_at = null
    where id = p_order_id;
  end if;

  delete from public.order_cancellation_claims
  where order_id = p_order_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_begin_order_cancellation_reconcile(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_order_id uuid;
  v_request_status text;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  perform orders.id
  from public.orders
  where orders.id = v_order_id
  for update;

  select request.status
  into v_request_status
  from public.order_cancellation_requests as request
  where request.id = p_request_id
  for update;

  perform public.assert_order_cancellation_reconciliation_allowed(p_request_id,v_actor);

  if v_request_status = 'processing' then
    return;
  end if;

  if v_request_status <> 'needs_review' then
    raise exception using message = 'cancellation_request_not_reconcilable';
  end if;

  if not exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = v_order_id
  ) then
    raise exception using message = 'cancellation_claim_missing';
  end if;

  update public.refunds
  set status = 'requested'
  where cancellation_request_id = p_request_id
    and status = 'failed';

  update public.order_cancellation_requests
  set
    status = 'processing',
    decided_by = coalesce(decided_by, v_actor),
    decided_at = coalesce(decided_at, now()),
    provider_started_at = coalesce(provider_started_at, now()),
    updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.cancellation_reconcile_started',
    'order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'from', 'needs_review',
      'to', 'processing'
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_goods_manual_payment_recovery(p_attempt_id uuid, p_actor_id uuid, p_request_id uuid, p_case_ref text, p_operation text, p_claim_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_request public.order_cancellation_requests%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_existing_claim private.goods_payment_manual_recovery_claims%rowtype;
  v_terminal private.goods_payment_manual_recovery_audits%rowtype;
  v_payment public.payments%rowtype;
  v_cancellation_claim public.order_cancellation_claims%rowtype;
begin
  if p_attempt_id is null
    or p_actor_id is null
    or p_request_id is null
    or p_claim_token is null
    or p_operation is distinct from 'provider_cancel_confirmed'
    or p_case_ref is null
    or p_case_ref !~ '^case_v1_[0-9a-f]{32}$'
  then
    raise invalid_parameter_value using
      message = 'goods_manual_recovery_input_invalid';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_id
      and profile.role = 'admin'
      and profile.suspended_at is null
  ) then
    raise insufficient_privilege using message = 'admin required';
  end if;

  -- Resolve the order without a lock, then acquire every money/stock lock in
  -- the shared order -> request -> attempt -> payments order.
  select attempt.ref_id
  into v_order_id
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.provider = 'korpay'
    and attempt.purpose = 'order';

  if v_order_id is null then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = v_order_id
  for update;

  if not found then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  select request.*
  into v_request
  from public.order_cancellation_requests as request
  where request.id = p_request_id
    and request.order_id = v_order.id
  for update;

  if not found then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.provider = 'korpay'
    and attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
  for update;

  if not found then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_order.id
  order by payment.id
  for update;

  select audit.*
  into v_terminal
  from private.goods_payment_manual_recovery_audits as audit
  where audit.attempt_id = v_attempt.id
    and audit.operation = p_operation;

  if found then
    if v_terminal.order_id is distinct from v_order.id
      or v_terminal.request_id is distinct from v_request.id
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_terminal_mismatch';
    end if;

    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'outcome', v_terminal.outcome
    );
  end if;

  perform private.assert_claim_collections_complete(v_request.id);

  if v_request.status not in ('processing', 'needs_review') then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_request_not_recoverable';
  end if;

  if v_attempt.user_id is distinct from v_order.user_id
    or v_attempt.amount is distinct from v_order.total
    or v_attempt.currency is distinct from 'KRW'
    or v_request.requested_by is distinct from v_order.user_id
    or not private.goods_order_snapshot_matches(
      v_order.id,
      v_order.total,
      v_order.shipping_fee
    )
  then
    raise object_not_in_prerequisite_state using
      message = 'goods_manual_recovery_order_attempt_mismatch';
  end if;

  select claim.*
  into v_cancellation_claim
  from public.order_cancellation_claims as claim
  where claim.order_id = v_order.id
  for update;

  if not found
    or v_cancellation_claim.requested_by is distinct from v_request.requested_by
  then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_claim_required';
  end if;

  select claim.*
  into v_existing_claim
  from private.goods_payment_manual_recovery_claims as claim
  where claim.attempt_id = v_attempt.id
  for update;

  if found and v_existing_claim.expires_at > pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object('claim_status', 'in_progress');
  end if;

  if v_attempt.state = 'confirming'
    and v_attempt.claim_expires_at > pg_catalog.clock_timestamp()
  then
    return pg_catalog.jsonb_build_object('claim_status', 'in_progress');
  end if;

  if v_attempt.state not in ('confirming', 'approved', 'unknown', 'needs_review') then
    raise object_not_in_prerequisite_state using
      message = 'goods_payment_attempt_not_recoverable';
  end if;

  if v_attempt.state = 'approved' then
    select payment.*
    into v_payment
    from public.payments as payment
    where payment.id = v_attempt.payment_id;

    if not found
      or v_payment.user_id is distinct from v_attempt.user_id
      or v_payment.purpose is distinct from 'order'
      or v_payment.ref_id is distinct from v_order.id
      or v_payment.provider is distinct from 'korpay'
      or v_payment.amount is distinct from v_attempt.amount
      or v_payment.idempotency_key is distinct from 'attempt:' || v_attempt.id::text
      or v_payment.status not in ('paid', 'canceled', 'refunded')
      or v_payment.raw is not null
      or (v_payment.status = 'paid' and v_payment.payment_key is null)
      or exists (
        select 1
        from public.payments as other_payment
        where other_payment.purpose = 'order'
          and other_payment.ref_id = v_order.id
          and other_payment.id <> v_payment.id
          and other_payment.status <> 'failed'
      )
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_approved_payment_evidence_invalid';
    end if;
  end if;

  insert into private.goods_payment_manual_recovery_claims (
    attempt_id,
    order_id,
    request_id,
    actor_id,
    operation,
    case_ref,
    claim_token,
    prior_attempt_state,
    claimed_at,
    expires_at
  )
  values (
    v_attempt.id,
    v_order.id,
    v_request.id,
    p_actor_id,
    p_operation,
    p_case_ref,
    p_claim_token,
    v_attempt.state,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '15 minutes'
  )
  on conflict (attempt_id) do update
  set
    order_id = excluded.order_id,
    request_id = excluded.request_id,
    actor_id = excluded.actor_id,
    operation = excluded.operation,
    case_ref = excluded.case_ref,
    claim_token = excluded.claim_token,
    prior_attempt_state = private.goods_payment_manual_recovery_claims.prior_attempt_state,
    claimed_at = excluded.claimed_at,
    expires_at = excluded.expires_at
  where private.goods_payment_manual_recovery_claims.expires_at
    <= pg_catalog.clock_timestamp();

  if not found then
    return pg_catalog.jsonb_build_object('claim_status', 'in_progress');
  end if;

  if v_attempt.state in ('confirming', 'unknown', 'needs_review') then
    update public.payment_attempts as attempt
    set
      state = 'confirming',
      claim_token = p_claim_token,
      claim_expires_at = pg_catalog.clock_timestamp() + interval '15 minutes'
    where attempt.id = v_attempt.id;
  end if;

  return pg_catalog.jsonb_build_object('claim_status', 'claimed');
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_goods_manual_payment_recovery(p_attempt_id uuid, p_actor_id uuid, p_request_id uuid, p_case_ref text, p_operation text, p_claim_token uuid, p_operator_attested boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_request public.order_cancellation_requests%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_manual_claim private.goods_payment_manual_recovery_claims%rowtype;
  v_terminal private.goods_payment_manual_recovery_audits%rowtype;
  v_payment public.payments%rowtype;
  v_cancellation_claim public.order_cancellation_claims%rowtype;
  v_provider_keys text[] := array[]::text[];
  v_final_attempt_state public.payment_attempt_state;
  v_has_payment boolean := false;
begin
  if p_attempt_id is null
    or p_actor_id is null
    or p_request_id is null
    or p_claim_token is null
    or p_operation is distinct from 'provider_cancel_confirmed'
    or p_case_ref is null
    or p_case_ref !~ '^case_v1_[0-9a-f]{32}$'
    or p_operator_attested is distinct from true
  then
    raise invalid_parameter_value using
      message = 'goods_manual_recovery_attestation_invalid';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_id
      and profile.role = 'admin'
      and profile.suspended_at is null
  ) then
    raise insufficient_privilege using message = 'admin required';
  end if;

  select attempt.ref_id
  into v_order_id
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.provider = 'korpay'
    and attempt.purpose = 'order';

  if v_order_id is null then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  -- Keep the same global lock order as claim and cancellation writers.
  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = v_order_id
  for update;

  if not found then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  select request.*
  into v_request
  from public.order_cancellation_requests as request
  where request.id = p_request_id
    and request.order_id = v_order.id
  for update;

  if not found then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.provider = 'korpay'
    and attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
  for update;

  if not found then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_order.id
  order by payment.id
  for update;

  select audit.*
  into v_terminal
  from private.goods_payment_manual_recovery_audits as audit
  where audit.attempt_id = v_attempt.id
    and audit.operation = p_operation;

  if found then
    if v_terminal.order_id is distinct from v_order.id
      or v_terminal.request_id is distinct from v_request.id
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_terminal_mismatch';
    end if;
    return v_terminal.outcome;
  end if;

  perform private.assert_claim_collections_complete(v_request.id);

  if v_request.status not in ('processing', 'needs_review') then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_request_not_recoverable';
  end if;

  if v_attempt.user_id is distinct from v_order.user_id
    or v_attempt.amount is distinct from v_order.total
    or v_attempt.currency is distinct from 'KRW'
    or v_request.requested_by is distinct from v_order.user_id
    or not private.goods_order_snapshot_matches(
      v_order.id,
      v_order.total,
      v_order.shipping_fee
    )
  then
    raise object_not_in_prerequisite_state using
      message = 'goods_manual_recovery_order_attempt_mismatch';
  end if;

  select claim.*
  into v_cancellation_claim
  from public.order_cancellation_claims as claim
  where claim.order_id = v_order.id
  for update;

  if not found
    or v_cancellation_claim.requested_by is distinct from v_request.requested_by
  then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_claim_required';
  end if;

  select claim.*
  into v_manual_claim
  from private.goods_payment_manual_recovery_claims as claim
  where claim.attempt_id = v_attempt.id
  for update;

  if not found
    or v_manual_claim.order_id is distinct from v_order.id
    or v_manual_claim.request_id is distinct from v_request.id
    or v_manual_claim.actor_id is distinct from p_actor_id
    or v_manual_claim.operation is distinct from p_operation
    or v_manual_claim.case_ref is distinct from p_case_ref
    or v_manual_claim.claim_token is distinct from p_claim_token
  then
    raise object_not_in_prerequisite_state using
      message = 'goods_manual_recovery_claim_invalid';
  end if;

  if v_manual_claim.prior_attempt_state in ('confirming', 'unknown', 'needs_review') then
    if v_attempt.state is distinct from 'confirming'
      or v_attempt.claim_token is distinct from p_claim_token
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_attempt_claim_invalid';
    end if;

    v_final_attempt_state := public.finalize_goods_payment_attempt(
      v_attempt.id,
      p_claim_token,
      'canceled'::public.payment_attempt_state
    );

    if v_final_attempt_state is distinct from 'canceled' then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_attempt_not_canceled';
    end if;

    -- An ambiguous attempt does not prove that an approved provider payment
    -- ever existed. Close only the attempt and preserve the absence of payment
    -- and refund rows instead of synthesizing provider history.
    if exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = v_order.id
        and payment.status <> 'failed'
    ) then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_payment_ambiguous';
    end if;
  elsif v_manual_claim.prior_attempt_state = 'approved' then
    if v_attempt.state is distinct from 'approved'
      or v_attempt.payment_id is null
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_approved_payment_evidence_invalid';
    end if;

    select payment.*
    into v_payment
    from public.payments as payment
    where payment.id = v_attempt.payment_id;

    if not found
      or v_payment.user_id is distinct from v_attempt.user_id
      or v_payment.purpose is distinct from 'order'
      or v_payment.ref_id is distinct from v_order.id
      or v_payment.provider is distinct from 'korpay'
      or v_payment.amount is distinct from v_attempt.amount
      or v_payment.idempotency_key is distinct from 'attempt:' || v_attempt.id::text
      or v_payment.status not in ('paid', 'canceled', 'refunded')
      or v_payment.raw is not null
      or (v_payment.status = 'paid' and v_payment.payment_key is null)
      or exists (
        select 1
        from public.payments as other_payment
        where other_payment.purpose = 'order'
          and other_payment.ref_id = v_order.id
          and other_payment.id <> v_payment.id
          and other_payment.status <> 'failed'
      )
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_approved_payment_evidence_invalid';
    end if;

    if v_payment.status = 'paid' then
      v_provider_keys := array[v_payment.payment_key];
    end if;
    v_has_payment := true;
  else
    raise object_not_in_prerequisite_state using
      message = 'goods_manual_recovery_prior_state_invalid';
  end if;

  perform public.finalize_order_cancellation_with_provider_evidence(
    v_order.id,
    v_request.reason,
    v_provider_keys
  );

  if v_has_payment then
    update public.refunds as refund
    set cancellation_request_id = v_request.id
    where refund.payment_id = v_payment.id
      and (
        refund.cancellation_request_id is null
        or refund.cancellation_request_id = v_request.id
      );

    if not exists (
      select 1
      from public.refunds as refund
      where refund.payment_id = v_payment.id
        and refund.cancellation_request_id = v_request.id
        and refund.amount = v_payment.amount
        and refund.status = 'done'
    ) then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_refund_invalid';
    end if;
  end if;

  update public.order_cancellation_requests as request
  set
    status = 'completed',
    last_error_code = null,
    completed_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp()
  where request.id = v_request.id;

  insert into private.goods_payment_manual_recovery_audits (
    attempt_id,
    order_id,
    request_id,
    actor_id,
    operation,
    case_ref,
    prior_attempt_state,
    outcome
  )
  values (
    v_attempt.id,
    v_order.id,
    v_request.id,
    p_actor_id,
    p_operation,
    p_case_ref,
    v_manual_claim.prior_attempt_state,
    'provider_cancel_confirmed'
  );

  delete from private.goods_payment_manual_recovery_claims as claim
  where claim.attempt_id = v_attempt.id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    'admin.payment.goods_manual_provider_cancel_confirmed',
    'order:' || v_order.id::text,
    pg_catalog.jsonb_build_object(
      'attemptId', v_attempt.id,
      'requestId', v_request.id,
      'operation', p_operation,
      'caseRef', p_case_ref,
      'outcome', 'provider_cancel_confirmed'
    )
  );

  return 'provider_cancel_confirmed';
end;
$function$;

revoke all on function public.admin_decide_order_claim(uuid, text, text) from public,anon,authenticated,service_role;
grant execute on function public.admin_decide_order_claim(uuid, text, text) to authenticated;

revoke all on function public.admin_decide_order_cancellation(uuid, text, text) from public,anon,authenticated,service_role;
grant execute on function public.admin_decide_order_cancellation(uuid, text, text) to authenticated;

revoke all on function public.admin_record_order_claim_collection(uuid, text) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_collection(uuid, text) to authenticated;

revoke all on function public.admin_order_claim_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_claim_detail(uuid) to authenticated;

revoke all on function public.admin_record_order_claim_refund(uuid, text, text, text) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_refund(uuid, text, text, text) to authenticated;

revoke all on function public.admin_record_order_claim_reshipment(uuid, text, text, jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_reshipment(uuid, text, text, jsonb) to authenticated;

revoke all on function public.finalize_order_cancellation_with_provider_evidence(uuid, text, text[]) from public,anon,authenticated,service_role;

revoke all on function public.admin_begin_order_cancellation_reconcile(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_begin_order_cancellation_reconcile(uuid) to authenticated;

revoke all on function public.claim_goods_manual_payment_recovery(uuid, uuid, uuid, text, text, uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_goods_manual_payment_recovery(uuid, uuid, uuid, text, text, uuid) to service_role;

revoke all on function public.finalize_goods_manual_payment_recovery(uuid, uuid, uuid, text, text, uuid, boolean) from public,anon,authenticated,service_role;
grant execute on function public.finalize_goods_manual_payment_recovery(uuid, uuid, uuid, text, text, uuid, boolean) to service_role;

CREATE OR REPLACE FUNCTION public.reconcile_expired_prepared_goods_cancellation(p_request_id uuid, p_actor_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_request public.order_cancellation_requests%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_cancellation_claim public.order_cancellation_claims%rowtype;
  v_transitioned boolean := false;
begin
  if p_request_id is null or p_actor_id is null then
    raise invalid_parameter_value using
      message = 'prepared_goods_cancellation_input_invalid';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_id
      and profile.role in ('staff', 'admin')
      and profile.suspended_at is null
  ) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  -- Resolve only the lock key first. Every money and stock writer below uses
  -- the shared order -> request -> attempt -> payments ordering.
  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = v_order_id
  for update;

  if not found then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  select request.*
  into v_request
  from public.order_cancellation_requests as request
  where request.id = p_request_id
    and request.order_id = v_order.id
  for update;

  if not found then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
    and attempt.provider in ('toss', 'korpay')
  order by attempt.id
  limit 1
  for update;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_order.id
  order by payment.id
  for update;

  if v_request.status = 'completed' then
    -- loadContext and this lock can be separated by another successful Toss,
    -- Korpay manual, or terminal-attempt reconciliation. A completed request
    -- plus canceled order is the provider-neutral terminal identity.
    if v_order.status = 'canceled' then
      return 'completed';
    end if;
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_terminal_mismatch';
  end if;

  if v_request.status not in ('processing', 'needs_review') then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_request_not_recoverable';
  end if;

  perform public.assert_order_cancellation_reconciliation_allowed(p_request_id,p_actor_id);

  if v_attempt.id is null then
    return 'not_applicable';
  end if;

  -- A callback or another evidence path that moved the attempt beyond
  -- prepared owns the resolution. Do not fall through to the Toss empty-ledger
  -- completion path and do not mutate the request to needs_review here.
  -- An approved, identity-matched Toss ledger is a captured payment, never a
  -- no-capture timeout. Continue to provider reconciliation without mutating it.
  if v_attempt.state='approved' and v_attempt.provider='toss'
    and v_attempt.user_id=v_order.user_id and v_attempt.amount=v_order.total and v_attempt.currency='KRW'
    and exists(select 1 from public.payments p where p.id=v_attempt.payment_id and p.provider=v_attempt.provider
      and p.purpose='order' and p.ref_id=v_order.id and p.user_id=v_order.user_id and p.amount=v_order.total
      and p.status in ('paid','canceled','refunded') and nullif(btrim(p.payment_key),'') is not null) then
    return 'not_applicable';
  end if;
  if v_attempt.state in ('confirming', 'approved', 'unknown', 'needs_review') then
    return 'in_progress';
  end if;

  if v_attempt.state in ('declined', 'canceled') then
    return 'not_applicable';
  end if;

  if v_attempt.state is distinct from 'prepared' then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_payment_attempt_invalid';
  end if;

  if v_order.status is distinct from 'pending'
    or v_attempt.user_id is distinct from v_order.user_id
    or v_attempt.amount is distinct from v_order.total
    or v_attempt.currency is distinct from 'KRW'
    or v_request.requested_by is distinct from v_order.user_id
    or not private.goods_order_snapshot_matches(
      v_order.id,
      v_order.total,
      v_order.shipping_fee
    )
  then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_order_attempt_mismatch';
  end if;

  select claim.*
  into v_cancellation_claim
  from public.order_cancellation_claims as claim
  where claim.order_id = v_order.id
  for update;

  if not found
    or v_cancellation_claim.requested_by is distinct from v_request.requested_by
  then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_claim_required';
  end if;

  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = v_order.id
      and payment.status <> 'failed'
  ) then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_payment_evidence_invalid';
  end if;

  if v_attempt.expires_at is null
    or v_attempt.expires_at > pg_catalog.clock_timestamp()
  then
    return 'in_progress';
  end if;

  update public.payment_attempts as attempt
  set
    state = 'canceled',
    claim_token = null,
    claim_expires_at = null
  where attempt.id = v_attempt.id
    and attempt.state = 'prepared'
    and attempt.expires_at is not null
    and attempt.expires_at <= pg_catalog.clock_timestamp()
  returning true into v_transitioned;

  if not coalesce(v_transitioned, false) then
    return 'in_progress';
  end if;

  perform public.finalize_order_cancellation_with_provider_evidence(
    v_order.id,
    v_request.reason,
    array[]::text[]
  );

  update public.order_cancellation_requests as request
  set
    status = 'completed',
    last_error_code = null,
    completed_at = coalesce(request.completed_at, pg_catalog.clock_timestamp()),
    updated_at = pg_catalog.clock_timestamp()
  where request.id = v_request.id
    and request.status in ('processing', 'needs_review');

  if not found then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_request_changed';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    'admin.order.prepared_goods_cancellation_completed',
    'order:' || v_order.id::text,
    pg_catalog.jsonb_build_object(
      'attemptId', v_attempt.id,
      'requestId', v_request.id,
      'outcome', 'expired_no_capture'
    )
  );

  return 'completed';
end;
$function$;
revoke all on function public.reconcile_expired_prepared_goods_cancellation(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.reconcile_expired_prepared_goods_cancellation(uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.admin_update_order_status(p_order_id uuid, p_status order_status, p_carrier text, p_tracking_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid());purchase public.orders;
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 select * into purchase from public.orders where id=p_order_id for update;
 if not found then raise no_data_found using message='order_not_found';end if;
 perform id from public.order_shipments where order_id=p_order_id order by id for update;
 if p_status is null or p_status not in ('confirmed','shipping','delivered') then raise check_violation using message='invalid_order_status';end if;
 if p_status in ('shipping','delivered') then
   perform public.admin_update_shipment_status(private.single_order_shipment(p_order_id),p_status::text,p_carrier,p_tracking_number);return;
 end if;
 if purchase.status='confirmed' then return;end if;
 if purchase.status<>'paid' then raise exception using message='invalid_order_transition';end if;
 perform private.assert_order_dispatch_allowed(p_order_id);
 update public.orders set status='confirmed',confirmed_at=clock_timestamp() where id=p_order_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.status_updated','order:'||p_order_id,
  jsonb_build_object('from',purchase.status,'to','confirmed'));
end $function$;
revoke all on function public.admin_update_order_status(uuid,public.order_status,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_update_order_status(uuid,public.order_status,text,text) to authenticated;
