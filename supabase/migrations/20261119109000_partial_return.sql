-- 부분 반품(원장 #17 CLM-025·CLM-083·CLM-085, ADR-0047) — 반품을 굿즈·수량 단위로 받고 고른 몫만 회수·환불한다.
--
-- 원장 CLM-025: 고객 API가 품목·수량 키를 invalid_body로 거부하고 주문 전체만 반품을 받는다. 약관도 "일부만 환급하는 처리는
-- 제공하지 않습니다". action: "ADR-0032의 배분 원장·결제사 부분 취소 기반으로 부분 반품을 설계".
-- 2026-11-19 사용자 결정(원문): "전부 다 구현하고 스위치도 전부 다 켜", 반품배송비 편도 3,000원(무료배송 주문 왕복 6,000원).
-- 스위치를 켜는 migration은 오케스트레이터가 따로 낸다 — 이 migration은 스위치를 켜지 않는다.
--
-- 설계(ADR-0047):
--  * 스위치 partial_return_enabled(반품배송비·부분 취소와 같은 행, 기본 꺼짐). 꺼져 있으면 접수 함수가 partial_return_disabled다.
--  * 클레임 품목 원장 public.order_claim_items(바뀌지 않음). 줄이 있는 반품 클레임이 '부분 반품'이다. 고른 품목이 남은 수량
--    전부면 주문 전체 반품으로 접수한다(지금의 전체 반품 경로). 교환·취소는 주문 전체 그대로.
--  * 회수(prepare_claim_collections)·회수 완료(claim_collections_complete)는 고른 품목·수량만 다룬다.
--  * 환불 접수(admin_record_order_claim_refund filed)가 부분 취소 원장(private.order_partial_cancellations)에 reason_code='return'
--    줄을 만든다(누적 비례 배분 + 비게 된 배송 건 배송비 − 반품배송비 차감). 토스는 기존 부분 취소 오케스트레이터가 결제사 부분
--    취소를 확인하면 적용, 무통장은 바로 적용해 송금 대기, 0원은 바로 완료. 적용 때 배송 건 품목(살아 있는 수량)을 줄이고
--    고른 수량만 재고 복원·적립금 몫 되돌림·카드팩 판정을 한다. 원장 상태가 클레임 단계를 따라 움직인다(트리거).
--  * 결제사가 부분 취소를 받지 않으면 원장은 rejected, 클레임은 확인 필요 — 전액 환불로 돌리지 않는다(ADR-0032 결정 4).
--  * 기존 함수는 앵커 치환으로만 고친다(다른 트랙이 같은 함수의 다른 줄을 고친다).
begin;

create function private.j47_patch_function(p_signature text, p_anchor text, p_replacement text, p_expected integer default 1)
returns void language plpgsql volatile set search_path = '' as $$
declare body text; found_count integer;
begin
  body := pg_get_functiondef(p_signature::regprocedure);
  found_count := (length(body) - length(replace(body, p_anchor, ''))) / length(p_anchor);
  if found_count <> p_expected then raise exception 'j47_anchor_changed: % (found %, expected %)', p_signature, found_count, p_expected; end if;
  execute replace(body, p_anchor, p_replacement);
end $$;
revoke all on function private.j47_patch_function(text, text, text, integer) from public, anon, authenticated, service_role;

-- 1. 스위치(기본 꺼짐). 켤 때는 근거와 켠 시각이 필요하다. 행의 감사·리비전 트리거가 이 칸 변경도 남긴다.
alter table private.return_fee_deduction_settings
  add column partial_return_enabled boolean not null default false,
  add column partial_return_evidence text check (partial_return_evidence is null or (partial_return_evidence = btrim(partial_return_evidence)
    and char_length(partial_return_evidence) between 2 and 1000 and partial_return_evidence !~ '[[:cntrl:]]')),
  add column partial_return_enabled_at timestamptz,
  add constraint return_fee_deduction_settings_partial_return_shape
    check (not partial_return_enabled or (partial_return_evidence is not null and partial_return_enabled_at is not null));

create function private.order_partial_return_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.partial_return_enabled from private.return_fee_deduction_settings s where s.singleton), false);
$$;
revoke all on function private.order_partial_return_enabled() from public, anon, authenticated, service_role;

-- 2. 클레임 품목 원장. 접수 때 한 번 쓰고 바꾸지 않는다. 구매자는 자기 주문 것만, 운영자는 주문 조회 권한으로 읽는다.
create table public.order_claim_items (
  claim_id uuid not null references public.order_cancellation_requests(id) on delete restrict,
  order_id uuid not null,
  order_item_id uuid not null,
  shipment_id uuid not null,
  qty integer not null check (qty > 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (claim_id, order_item_id),
  foreign key (order_id, order_item_id) references public.order_items(order_id, id) on delete restrict,
  foreign key (order_id, shipment_id) references public.order_shipments(order_id, id) on delete restrict
);
create index order_claim_items_item on public.order_claim_items(order_item_id);
create index order_claim_items_order on public.order_claim_items(order_id);
alter table public.order_claim_items enable row level security;
revoke all on table public.order_claim_items from public, anon, authenticated, service_role;
grant select on table public.order_claim_items to authenticated, service_role;
create policy order_claim_items_owner_staff_read on public.order_claim_items for select to authenticated
  using ((select public.has_operator_capability('sales.read'::text)) or exists(select 1 from public.orders o
    where o.id = order_claim_items.order_id and o.user_id = (select auth.uid())));

create function private.guard_order_claim_items() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise check_violation using message = 'order_claim_items_immutable';
end $$;
revoke all on function private.guard_order_claim_items() from public, anon, authenticated, service_role;
create trigger order_claim_items_immutable before update or delete on public.order_claim_items
  for each row execute function private.guard_order_claim_items();

-- 3. 부분 취소 원장에 부분 반품 줄을 싣는다: 클레임·반품배송비 차감 칸. 환불액 = 굿즈 몫 + 배송비 몫 − 차감.
alter table private.order_partial_cancellations
  add column claim_id uuid references public.order_cancellation_requests(id) on delete restrict,
  add column return_fee_deduction bigint not null default 0 check (return_fee_deduction >= 0),
  add column return_fee_basis text check (return_fee_basis is null or return_fee_basis in ('one_way', 'round_trip')),
  add column return_fee_one_way_amount integer check (return_fee_one_way_amount is null or return_fee_one_way_amount between 1 and 1000000),
  add column return_fee_settings_revision integer check (return_fee_settings_revision is null or return_fee_settings_revision >= 1),
  drop constraint order_partial_cancellations_reason_code_check,
  add constraint order_partial_cancellations_reason_code_check check (reason_code in ('out_of_stock', 'return')),
  drop constraint order_partial_cancellations_amounts,
  add constraint order_partial_cancellations_amounts check (
    refund_amount = goods_refund_amount + shipping_refund_amount - return_fee_deduction and refund_amount <= balance_before),
  add constraint order_partial_cancellations_return_shape check (
    (reason_code = 'return') = (claim_id is not null)
    and (reason_code = 'return' or return_fee_deduction = 0)
    and ((return_fee_deduction > 0) = (return_fee_basis is not null and return_fee_one_way_amount is not null and return_fee_settings_revision is not null))
    and (return_fee_deduction = 0 or return_fee_deduction = return_fee_one_way_amount::bigint * case return_fee_basis when 'round_trip' then 2 else 1 end));
-- 한 부분 반품 클레임에 살아 있는 환불 원장은 하나다(결제사가 받지 않아 닫힌 줄 뒤의 다시 접수는 새 줄).
create unique index order_partial_cancellations_claim on private.order_partial_cancellations(claim_id)
  where claim_id is not null and state <> 'rejected';

-- 부분 반품으로 남는 품목이 없어진 배송 건(배송완료 그대로 두고 그 선결제 배송비만 돌려준다). 닫힌 배송 건 원장과 따로 둔다 —
-- 발송 전 부분 취소의 닫힌 배송 건은 주문 상태·정산 내보내기에서 빠지지만 이 배송 건은 실제로 배송됐다.
create table private.order_partial_return_shipments (
  partial_cancellation_id uuid not null references private.order_partial_cancellations(id) on delete restrict,
  order_id uuid not null,
  shipment_id uuid not null,
  shipping_fee_refund bigint not null check (shipping_fee_refund >= 0),
  primary key (partial_cancellation_id, shipment_id),
  foreign key (order_id, shipment_id) references public.order_shipments(order_id, id) on delete restrict
);
create index order_partial_return_shipments_shipment on private.order_partial_return_shipments(shipment_id);
alter table private.order_partial_return_shipments enable row level security;
revoke all on table private.order_partial_return_shipments from public, anon, authenticated, service_role;
create trigger order_partial_return_shipments_guard before update or delete on private.order_partial_return_shipments
  for each row execute function private.guard_order_partial_cancellation_children();

-- 바뀌지 않는 칸에 새 칸을 더한다.
select private.j47_patch_function('private.guard_order_partial_cancellation()',
  'new.refund_amount, new.store_credit_restore_amount, new.operation_id, new.created_by, new.created_at)',
  'new.refund_amount, new.store_credit_restore_amount, new.operation_id, new.created_by, new.created_at, new.claim_id,
      new.return_fee_deduction, new.return_fee_basis, new.return_fee_one_way_amount, new.return_fee_settings_revision)');
select private.j47_patch_function('private.guard_order_partial_cancellation()',
  'old.refund_amount, old.store_credit_restore_amount, old.operation_id, old.created_by, old.created_at)',
  'old.refund_amount, old.store_credit_restore_amount, old.operation_id, old.created_by, old.created_at, old.claim_id,
      old.return_fee_deduction, old.return_fee_basis, old.return_fee_one_way_amount, old.return_fee_settings_revision)');

-- 4. 읽기 도우미.
create function private.claim_is_partial_return(p_claim_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.order_claim_items ci where ci.claim_id = p_claim_id);
$$;
revoke all on function private.claim_is_partial_return(uuid) from public, anon, authenticated, service_role;

-- 부분 반품이 아니면 모든 품목이 대상이다(주문 전체 클레임).
create function private.claim_line_selected(p_claim_id uuid, p_order_item_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not private.claim_is_partial_return(p_claim_id)
    or exists(select 1 from public.order_claim_items ci where ci.claim_id = p_claim_id and ci.order_item_id = p_order_item_id);
$$;
revoke all on function private.claim_line_selected(uuid, uuid) from public, anon, authenticated, service_role;

-- 회수 완료 판정의 품목별 기대 수량: 부분 반품은 고른 수량(고르지 않은 품목은 0), 주문 전체는 살아 있는 수량.
create function private.claim_item_target_qty(p_claim_id uuid, p_order_item_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select case when private.claim_is_partial_return(p_claim_id)
    then coalesce((select ci.qty from public.order_claim_items ci where ci.claim_id = p_claim_id and ci.order_item_id = p_order_item_id), 0)
    else private.order_item_active_qty(p_order_item_id) end;
$$;
revoke all on function private.claim_item_target_qty(uuid, uuid) from public, anon, authenticated, service_role;

-- 회수 줄: 주문 전체 클레임은 지금과 같은 줄(claim_shipment_return_lines), 부분 반품은 고른 품목·수량만.
create function private.claim_return_lines_for_claim(p_claim uuid)
returns table(shipment_id uuid, order_item_id uuid, item_name text, qty integer, return_address_id uuid, return_name text, return_address text, return_phone text)
language sql stable security definer set search_path = '' as $$
  select l.shipment_id, l.order_item_id, l.item_name, coalesce(ci.qty, l.qty), l.return_address_id, l.return_name, l.return_address, l.return_phone
  from public.order_cancellation_requests c
  cross join lateral private.claim_shipment_return_lines(c.order_id) l
  left join public.order_claim_items ci on ci.claim_id = c.id and ci.order_item_id = l.order_item_id
  where c.id = p_claim and private.claim_line_selected(c.id, l.order_item_id);
$$;
revoke all on function private.claim_return_lines_for_claim(uuid) from public, anon, authenticated, service_role;

create function private.claim_partial_return_applied(p_claim_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.order_partial_cancellations h where h.claim_id = p_claim_id and h.applied_at is not null);
$$;
revoke all on function private.claim_partial_return_applied(uuid) from public, anon, authenticated, service_role;

-- 발송 전 부분 취소(재고 부족)만의 수량. 재고 대조의 '창고를 떠난 수량'은 부분 반품을 빼지 않는다(이미 떠났다).
create function private.order_item_stockout_canceled_qty(p_order_item_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(line.qty) from private.order_partial_cancellation_items line
    join private.order_partial_cancellations head on head.id = line.partial_cancellation_id
    where line.order_item_id = p_order_item_id and head.applied_at is not null and head.reason_code = 'out_of_stock'), 0)::integer;
$$;
revoke all on function private.order_item_stockout_canceled_qty(uuid) from public, anon, authenticated, service_role;

create function private.order_item_returned_qty(p_order_item_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(line.qty) from private.order_partial_cancellation_items line
    join private.order_partial_cancellations head on head.id = line.partial_cancellation_id
    where line.order_item_id = p_order_item_id and head.applied_at is not null and head.reason_code = 'return'), 0)::integer;
$$;
revoke all on function private.order_item_returned_qty(uuid) from public, anon, authenticated, service_role;

-- 모두 반품돼 배송 건 품목 행이 사라진 품목의 원래 배송 건(재고 대조가 출고 시각을 그 배송 건에서 읽는다).
create function private.order_item_returned_shipment(p_order_item_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select line.shipment_id from private.order_partial_cancellation_items line
    join private.order_partial_cancellations head on head.id = line.partial_cancellation_id
    where line.order_item_id = p_order_item_id and head.applied_at is not null and head.reason_code = 'return'
    order by head.applied_at desc, head.id limit 1;
$$;
revoke all on function private.order_item_returned_shipment(uuid) from public, anon, authenticated, service_role;

-- 무료배송 주문의 나가는 쪽 운임(왕복의 한쪽)을 이미 뺐는지. 같은 주문에서 한 번만 뺀다(부분 반품·주문 전체 반품 공통).
create function private.order_outbound_leg_charged(p_order_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.order_partial_cancellations h where h.order_id = p_order_id and h.reason_code = 'return'
      and h.state <> 'rejected' and h.return_fee_basis = 'round_trip')
    or exists(select 1 from private.claim_refund_deductions d where d.order_id = p_order_id and d.basis = 'round_trip' and d.state <> 'not_applied');
$$;
revoke all on function private.order_outbound_leg_charged(uuid) from public, anon, authenticated, service_role;

-- 이 클레임에서 배송 분실(택배사 확인)로 회수를 생략한 배송 건의 품목(실물이 없어 판매 재고로 되돌리지 않는다).
create function private.claim_item_lost_in_transit(p_claim_id uuid, p_order_item_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.order_claim_collection_waivers w
    join public.order_claim_collections x on x.claim_id = w.claim_id and x.shipment_id = w.shipment_id
    where w.claim_id = p_claim_id and w.kind = 'carrier_loss' and private.claim_collection_waived(w.claim_id, w.shipment_id)
      and exists(select 1 from jsonb_array_elements(x.items_snapshot) j where (j->>'orderItemId')::uuid = p_order_item_id));
$$;
revoke all on function private.claim_item_lost_in_transit(uuid, uuid) from public, anon, authenticated, service_role;

-- 5. 접수 판정. 주문 단위(결제·선물·배분)와 품목 단위. 막힌 이유 코드는 화면이 문장으로 바꾼다.
create function private.order_partial_return_order_blocker(p_order_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare purchase public.orders; pay public.payments; payment_count integer; v1 text[];
begin
  select * into purchase from public.orders where id = p_order_id;
  if not found then return 'order_not_found'; end if;
  -- 선물 주문의 클레임은 받는 분·보낸 분 흐름이 따로다(주문 전체). 부분 반품은 열지 않는다.
  if exists(select 1 from private.gift_intents g where g.order_id = p_order_id) then return 'gift_order'; end if;
  if purchase.calculation_version is null or purchase.calculation_version not in (1, 2) then return 'legacy_order'; end if;
  if exists(select 1 from public.payment_attempts a where a.purpose = 'order' and a.ref_id = p_order_id
      and a.state in ('prepared', 'confirming', 'unknown', 'needs_review')) then
    return 'payment_reconciliation_required';
  end if;
  select count(*) into payment_count from public.payments p where p.purpose = 'order' and p.ref_id = p_order_id and p.status <> 'failed';
  pay := private.order_partial_cancellation_payment(p_order_id);
  if payment_count <> 1 or pay.id is null or pay.status <> 'paid' or pay.amount <= 0 or pay.amount <> purchase.total then
    return 'payment_unavailable';
  end if;
  -- 결제사 부분 취소를 받지 않는 결제: 나이스페이(계약 전)·코페이·토스 가상계좌·정기배송 바인딩(ADR-0031·0032와 같은 목록).
  if pay.provider not in ('toss', 'bank_transfer')
    or pay.provider = 'toss' and nullif(btrim(pay.payment_key), '') is null
    or exists(select 1 from public.payment_attempts a join private.payment_provider_bindings b on b.attempt_id = a.id
      where a.purpose = 'order' and a.ref_id = p_order_id)
    or pay.provider = 'toss' and exists(select 1 from public.payment_attempts a
      join private.payment_provider_evidence e on e.payment_attempt_id = a.id
      where a.purpose = 'order' and a.ref_id = p_order_id and (e.payment_method = '가상계좌' or e.result_code = 'DONE_virtual_account')) then
    return 'unsupported_payment';
  end if;
  v1 := private.order_v1_allocation_blockers(p_order_id);
  if cardinality(v1) > 0 then
    return case v1[1] when 'partial_cancel_v1_allocation_mismatch' then 'v1_allocation_mismatch' else 'v1_allocation_unavailable' end;
  end if;
  return null;
end $$;
revoke all on function private.order_partial_return_order_blocker(uuid) from public, anon, authenticated, service_role;

create function private.order_partial_return_item_blocker(p_order_item_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare item public.order_items; link public.order_shipment_items; ship public.order_shipments; active integer; physical record; target record;
  reservation_state text;
begin
  select * into item from public.order_items where id = p_order_item_id;
  if not found then return 'order_item_not_found'; end if;
  active := private.order_item_active_qty(item.id);
  if active <= 0 then return 'fully_returned'; end if;
  if coalesce(item.fulfillment_terms_snapshot->>'mode', '') in ('digital', 'no_delivery') then return 'digital_item'; end if;
  if item.production_terms_snapshot is not null or exists(select 1 from private.order_production_jobs j where j.order_item_id = item.id) then
    return 'production_item';
  end if;
  if (private.order_item_price_allocation(item.id)).order_item_id is null then return 'allocation_missing'; end if;
  select * into link from public.order_shipment_items where order_item_id = item.id and order_id = item.order_id;
  if not found or link.qty <> active then return 'shipment_missing'; end if;
  select * into ship from public.order_shipments where id = link.shipment_id;
  -- 고른 품목은 발송된 배송 건(배송중·배송완료)에 있어야 한다. 발송 전 몫은 재고 부족 부분 취소·운영자 취소의 몫이다.
  if ship.delivery_method = 'digital' or ship.status not in ('shipping', 'delivered') or (ship.shipped_at is null and ship.delivered_at is null) then
    return 'shipment_not_dispatched';
  end if;
  -- 상품 통합(재고 승계)·교환 재출고 배정 이력이 있는 품목은 재고 복원 단위가 품목 전체라 수량 단위로 나누지 않는다(ADR-0032와 같다).
  select * into physical from private.order_item_physical_unit(item.id);
  select * into target from private.resolve_goods_stock_successor(physical.good_id, physical.variant_id);
  if target.hop_count > 0 or physical.good_id <> item.good_id
    or exists(select 1 from private.group_claim_reshipment_allocations where order_item_id = item.id)
    or exists(select 1 from public.order_claim_reshipment_items where order_item_id = item.id) then
    return 'stock_topology_changed';
  end if;
  -- 예약 판매 품목은 실물이 할당된 뒤(배정 allocated)에만 수량 단위로 실물 재고에 되돌린다.
  if item.supply_source = 'preorder' then
    select r.state into reservation_state from private.goods_preorder_reservations r where r.order_item_id = item.id;
    if reservation_state is distinct from 'allocated' then return 'preorder_not_allocated'; end if;
  elsif item.supply_source <> 'stock' then
    return 'supply_unavailable';
  end if;
  return null;
end $$;
revoke all on function private.order_partial_return_item_blocker(uuid) from public, anon, authenticated, service_role;

-- 고른 품목·수량을 좁힌다. 모양이 틀리면 예외, 판정이 막히면 {ok:false, code}. coversAll = 남은 수량 전부(→ 주문 전체 반품).
create function private.order_partial_return_selection(p_order_id uuid, p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare entry jsonb; item public.order_items; seen uuid[] := array[]::uuid[]; qty integer; blocker text; lines jsonb := '[]'::jsonb;
  link public.order_shipment_items; covers boolean;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise invalid_parameter_value using message = 'invalid_partial_return_items';
  end if;
  for entry in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(entry) <> 'object' or (select count(*) from jsonb_object_keys(entry)) <> 2 or not entry ?& array['orderItemId', 'qty']
      or jsonb_typeof(entry->'orderItemId') <> 'string' or coalesce(entry->>'orderItemId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(entry->'qty') <> 'number' or coalesce(entry->>'qty', '') !~ '^[1-9][0-9]{0,5}$' then
      raise invalid_parameter_value using message = 'invalid_partial_return_items';
    end if;
    if (entry->>'orderItemId')::uuid = any(seen) then raise invalid_parameter_value using message = 'invalid_partial_return_items'; end if;
    seen := seen || (entry->>'orderItemId')::uuid;
    select * into item from public.order_items where id = (entry->>'orderItemId')::uuid and order_id = p_order_id;
    if not found then return jsonb_build_object('ok', false, 'code', 'partial_return_item_not_found'); end if;
    blocker := private.order_partial_return_item_blocker(item.id);
    if blocker is not null then
      return jsonb_build_object('ok', false, 'code', 'partial_return_item_' || blocker, 'orderItemId', item.id);
    end if;
    qty := (entry->>'qty')::integer;
    if qty > private.order_item_active_qty(item.id) then
      return jsonb_build_object('ok', false, 'code', 'partial_return_qty_exceeds_remaining', 'orderItemId', item.id);
    end if;
    select * into link from public.order_shipment_items where order_item_id = item.id and order_id = p_order_id;
    lines := lines || jsonb_build_object('orderItemId', item.id, 'shipmentId', link.shipment_id, 'qty', qty);
  end loop;
  covers := not exists(select 1 from public.order_items i where i.order_id = p_order_id
    and private.order_item_active_qty(i.id) <> coalesce((select (x->>'qty')::integer from jsonb_array_elements(lines) x
      where (x->>'orderItemId')::uuid = i.id), 0));
  return jsonb_build_object('ok', true, 'coversAll', covers,
    'lines', (select jsonb_agg(x order by x->>'orderItemId') from jsonb_array_elements(lines) x));
end $$;
revoke all on function private.order_partial_return_selection(uuid, jsonb) from public, anon, authenticated, service_role;

create function private.insert_order_claim_items(p_claim_id uuid, p_order_id uuid, p_lines jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.order_claim_items(claim_id, order_id, order_item_id, shipment_id, qty)
  select p_claim_id, p_order_id, (x->>'orderItemId')::uuid, (x->>'shipmentId')::uuid, (x->>'qty')::integer
  from jsonb_array_elements(p_lines) x;
$$;
revoke all on function private.insert_order_claim_items(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

-- 화면 품목 목록(구매자·운영자 공통). 반품 제한 굿즈는 고를 수 있고 제한 사유를 함께 싣는다(ADR-0017: 고지일 뿐 접수를 막지 않는다).
create function private.order_partial_return_items_json(p_order_id uuid, p_customer boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId', i.id, 'goodName', i.good_name_snapshot,
      'variantName', case when p_customer and i.option_sale_mode_snapshot = 'random' then null else i.variant_name_snapshot end,
      'orderedQty', i.qty, 'activeQty', private.order_item_active_qty(i.id), 'returnedQty', private.order_item_returned_qty(i.id),
      'unitPrice', i.unit_price, 'shipmentId', link.shipment_id, 'shipmentNumber', ship.shipment_number, 'originName', ship.origin_name_snapshot,
      'blocker', private.order_partial_return_item_blocker(i.id),
      'returnRestricted', coalesce(g.claim_return_allowed = false, false),
      'restrictionReason', case when g.claim_return_allowed = false then g.claim_restriction_reason end)
    order by ship.shipment_number nulls last, i.good_name_snapshot, i.id), '[]'::jsonb)
  from public.order_items i
  left join public.order_shipment_items link on link.order_item_id = i.id and link.order_id = i.order_id
  left join public.order_shipments ship on ship.id = link.shipment_id
  left join public.goods g on g.id = i.good_id
  where i.order_id = p_order_id;
$$;
revoke all on function private.order_partial_return_items_json(uuid, boolean) from public, anon, authenticated, service_role;

-- 5-0. 공개 정책: 부분 반품을 받는지(접수 안내·운영 화면 문구가 스위치 상태에 맞는 문장을 고른다). 반품배송비 정책 읽기와 같은 모양.
create function public.get_partial_return_policy() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('enabled', private.order_partial_return_enabled());
$$;
revoke all on function public.get_partial_return_policy() from public, anon, authenticated, service_role;
grant execute on function public.get_partial_return_policy() to anon, authenticated, service_role;

-- 5-1. 구매자 문맥(주문 상세 반품 폼). 스위치가 꺼져 있으면 {enabled:false} — 화면은 지금처럼 주문 전체만 보인다.
create function public.get_my_order_partial_return_context(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not exists(select 1 from public.orders o where o.id = p_order_id and o.user_id = (select auth.uid())) then
    return null;
  end if;
  if not private.order_partial_return_enabled() then return jsonb_build_object('enabled', false); end if;
  return jsonb_build_object('enabled', true, 'blocker', private.order_partial_return_order_blocker(p_order_id),
    'items', private.order_partial_return_items_json(p_order_id, true));
end $$;
revoke all on function public.get_my_order_partial_return_context(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_my_order_partial_return_context(uuid) to authenticated;

-- 5-2. 고객 접수(서버 라우트가 service_role로 부른다 — request_order_claim과 같은 경계). 품목을 고르지 않은 요청은 이 함수가 아니라
--      지금의 request_order_claim으로 간다. 고른 품목이 남은 수량 전부면 주문 전체 반품으로 접수한다.
create function public.request_order_partial_return(p_order_id uuid, p_user_id uuid, p_items jsonb, p_reason text, p_reason_type text,
  p_bank_name text default null, p_account_number text default null, p_account_holder text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare purchase public.orders; selection jsonb; result jsonb; claim_key uuid;
begin
  if not private.order_partial_return_enabled() then return 'partial_return_disabled'; end if;
  -- 공통 잠금 순서: 주문 → 배송 건(→ 결제 시도는 접수 함수가 이어서 잠근다).
  select * into purchase from public.orders where id = p_order_id for update;
  if not found or p_user_id is null or purchase.user_id is distinct from p_user_id then return 'not_found'; end if;
  perform s.id from public.order_shipments s where s.order_id = p_order_id order by s.id for update;
  if purchase.status = 'canceled' then return 'already_canceled'; end if;
  if exists(select 1 from public.order_cancellation_requests r where r.order_id = p_order_id and r.status in ('requested', 'processing', 'needs_review')) then
    return 'already_requested';
  end if;
  if not private.order_return_intake_eligible(p_order_id) then return 'not_claimable'; end if;
  if exists(select 1 from private.gift_intents g where g.order_id = p_order_id) then return 'partial_return_unavailable'; end if;
  selection := private.order_partial_return_selection(p_order_id, p_items);
  if not (selection->>'ok')::boolean then return 'partial_return_item_unavailable'; end if;
  if (selection->>'coversAll')::boolean then
    return public.request_order_claim(p_order_id, p_user_id, 'return', p_reason, p_reason_type, p_bank_name, p_account_number, p_account_holder);
  end if;
  if private.order_partial_return_order_blocker(p_order_id) is not null then return 'partial_return_unavailable'; end if;
  result := private.request_order_claim_for_parties(p_order_id, p_user_id, p_user_id, null, 'return', p_reason, p_reason_type,
    p_bank_name, p_account_number, p_account_holder);
  if result->>'outcome' = 'requested' then
    claim_key := (result->>'claimId')::uuid;
    perform private.insert_order_claim_items(claim_key, p_order_id, selection->'lines');
    insert into public.audit_log(actor_id, action, target, diff)
    values (p_user_id, 'order.claim_partial_return_requested', 'order:' || p_order_id::text,
      jsonb_build_object('claimId', claim_key, 'reasonType', p_reason_type, 'items', selection->'lines'));
  end if;
  return result->>'outcome';
end $$;
revoke all on function public.request_order_partial_return(uuid, uuid, jsonb, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.request_order_partial_return(uuid, uuid, jsonb, text, text, text, text, text) to service_role;

-- 5-3. 운영자 대리 접수(1:1 문의·전화로 받은 부분 반품). 기존 대리 접수 함수를 그대로 쓰고, 회수 대상 배송 건만 고른 품목의 배송 건으로
--      좁힌다(같은 트랜잭션 표식 icons.partial_return_items — 표식이 없으면 지금 그대로). 같은 요청 id 재전송은 같은 결과다.
create function private.partial_return_seller_targets(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare selected jsonb := nullif(current_setting('icons.partial_return_items', true), '')::jsonb;
begin
  if selected is null then return private.seller_claim_collection_targets(p_order_id); end if;
  return coalesce((select jsonb_agg(t || jsonb_build_object('items',
      (select jsonb_agg(i || jsonb_build_object('qty', (x->>'qty')::integer) order by i->>'id')
        from jsonb_array_elements(t->'items') i join jsonb_array_elements(selected) x on (x->>'orderItemId')::uuid = (i->>'id')::uuid))
    order by t->>'originId', t->>'shipmentId')
    from jsonb_array_elements(private.seller_claim_collection_targets(p_order_id)) t
    where exists(select 1 from jsonb_array_elements(selected) x where (x->>'shipmentId')::uuid = (t->>'shipmentId')::uuid)), '[]'::jsonb);
end $$;
revoke all on function private.partial_return_seller_targets(uuid) from public, anon, authenticated, service_role;

select private.j47_patch_function('public.admin_submit_seller_claim_intake(uuid,jsonb,jsonb)',
  'targets := private.seller_claim_collection_targets(target_id);',
  'targets := private.partial_return_seller_targets(target_id);');

create function public.admin_submit_seller_partial_return_intake(p_request_id uuid, p_payload jsonb, p_items jsonb, p_refund_account jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); target_id uuid; selection jsonb; blocker text; result jsonb; requested jsonb;
begin
  perform private.require_operator_capability('sales.manage', false);
  if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object'
    or coalesce(p_payload->>'orderId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise invalid_parameter_value using message = 'invalid_seller_claim_request';
  end if;
  target_id := (p_payload->>'orderId')::uuid;
  -- 재전송: 기존 함수가 같은 운영자·같은 본문인지 판정하고, 여기서는 고른 품목이 같은지 본다.
  if exists(select 1 from public.order_cancellation_requests where id = p_request_id) then
    result := public.admin_submit_seller_claim_intake(p_request_id, p_payload, p_refund_account);
    if private.claim_is_partial_return(p_request_id) then
      select jsonb_agg(jsonb_build_object('orderItemId', ci.order_item_id, 'qty', ci.qty) order by ci.order_item_id) into requested
        from public.order_claim_items ci where ci.claim_id = p_request_id;
      if requested is distinct from (select jsonb_agg(jsonb_build_object('orderItemId', (x->>'orderItemId')::uuid, 'qty', (x->>'qty')::integer)
          order by (x->>'orderItemId')::uuid) from jsonb_array_elements(p_items) x) then
        raise exception using errcode = 'PT409', message = 'seller_claim_request_conflict';
      end if;
    end if;
    return result || jsonb_build_object('partialReturn', private.claim_is_partial_return(p_request_id));
  end if;
  if not private.order_partial_return_enabled() then raise check_violation using message = 'partial_return_disabled'; end if;
  if p_payload->>'claimType' is distinct from 'return' then raise check_violation using message = 'partial_return_return_only'; end if;
  perform 1 from public.orders where id = target_id for update;
  if not found then raise no_data_found using message = 'order_not_found'; end if;
  perform s.id from public.order_shipments s where s.order_id = target_id order by s.id for update;
  selection := private.order_partial_return_selection(target_id, p_items);
  if not (selection->>'ok')::boolean then raise check_violation using message = selection->>'code'; end if;
  if (selection->>'coversAll')::boolean then
    return public.admin_submit_seller_claim_intake(p_request_id, p_payload, p_refund_account) || jsonb_build_object('partialReturn', false);
  end if;
  blocker := private.order_partial_return_order_blocker(target_id);
  if blocker is not null then raise check_violation using message = 'partial_return_' || blocker; end if;
  perform set_config('icons.partial_return_items', (selection->'lines')::text, true);
  result := public.admin_submit_seller_claim_intake(p_request_id, p_payload, p_refund_account);
  perform set_config('icons.partial_return_items', '', true);
  perform private.insert_order_claim_items(p_request_id, target_id, selection->'lines');
  insert into public.audit_log(actor_id, action, target, diff)
  values (actor, 'admin.order.claim_partial_return_intake', 'order:' || target_id::text,
    jsonb_build_object('claimId', p_request_id, 'items', selection->'lines'));
  return result || jsonb_build_object('partialReturn', true, 'items', selection->'lines');
end $$;
revoke all on function public.admin_submit_seller_partial_return_intake(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_submit_seller_partial_return_intake(uuid, jsonb, jsonb, jsonb) to authenticated;

-- 5-4. 운영자 문맥(대리 접수 폼의 품목 선택). 읽기지만 권한 가드가 행 잠금을 써서 VOLATILE이다.
create function public.admin_order_partial_return_context(p_order_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_operator_capability('sales.manage', false);
  if not exists(select 1 from public.orders where id = p_order_id) then raise no_data_found using message = 'order_not_found'; end if;
  if not private.order_partial_return_enabled() then return jsonb_build_object('enabled', false); end if;
  return jsonb_build_object('enabled', true, 'blocker', private.order_partial_return_order_blocker(p_order_id),
    'items', private.order_partial_return_items_json(p_order_id, false));
end $$;
revoke all on function public.admin_order_partial_return_context(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_order_partial_return_context(uuid) to authenticated;

-- 6. 회수: 승인 때 회수 행·묶음을 고른 품목·수량으로만 만든다(주문 전체 클레임은 지금과 같은 줄). 회수 완료는 고른 수량과 대조한다.
select private.j47_patch_function('private.prepare_claim_collections(uuid,boolean)',
  'private.claim_shipment_return_lines(claim.order_id)', 'private.claim_return_lines_for_claim(claim.id)', 3);
select private.j47_patch_function('private.prepare_claim_collections(uuid,boolean)',
  $a$(select jsonb_agg(jsonb_build_object('orderItemId',i.id,'name',i.good_name_snapshot,'qty',link.qty) order by i.id)$a$,
  $a$(select jsonb_agg(jsonb_build_object('orderItemId',i.id,'name',i.good_name_snapshot,'qty',
     coalesce((select ci.qty from public.order_claim_items ci where ci.claim_id=claim.id and ci.order_item_id=i.id),link.qty)) order by i.id)$a$);
select private.j47_patch_function('private.prepare_claim_collections(uuid,boolean)',
  'from public.order_shipment_items link join public.order_items i on i.id=link.order_item_id where link.shipment_id=s.id)',
  'from public.order_shipment_items link join public.order_items i on i.id=link.order_item_id where link.shipment_id=s.id
     and private.claim_line_selected(claim.id,i.id))');
select private.j47_patch_function('private.prepare_claim_collections(uuid,boolean)',
  'exists(select 1 from public.order_shipment_items i where i.shipment_id=s.id)',
  'exists(select 1 from public.order_shipment_items i where i.shipment_id=s.id and private.claim_line_selected(claim.id,i.order_item_id))');
select private.j47_patch_function('private.claim_collections_complete(uuid)',
  '<>private.order_item_active_qty(i.id)))', '<>private.claim_item_target_qty(c.id,i.id)))');

-- 부분 반품은 반품 → 교환 전환을 열지 않는다(교환은 주문 전체 재출고).
select private.j47_patch_function('private.order_claim_type_change_blocker(public.order_cancellation_requests)',
  $a$ when p_claim.claim_type not in('return','exchange') then 'claim_conversion_type_unavailable'$a$,
  $a$ when p_claim.claim_type not in('return','exchange') then 'claim_conversion_type_unavailable'
 when private.claim_is_partial_return(p_claim.id) then 'claim_conversion_partial_return'$a$);

-- 주문 전체 결제 취소 경로(오케스트레이터 정합화)는 부분 반품 클레임을 받지 않는다 — 결제사 전액 취소가 나가기 전에 막는다.
select private.j47_patch_function('public.assert_order_cancellation_reconciliation_allowed(uuid,uuid)',
  ' select * into claim from public.order_cancellation_requests where id=p_request_id for update;',
  ' select * into claim from public.order_cancellation_requests where id=p_request_id for update;
 -- 부분 반품(ADR-0047)은 부분 환불 원장(결제사 부분 취소)으로만 환불한다.
 if private.claim_is_partial_return(p_request_id) then raise check_violation using message=''partial_return_uses_partial_refund''; end if;');

-- 7. 반품배송비 차감(ADR-0031 규칙을 부분 반품에): 단순 변심만, 반송 한 번마다 편도, 최초 무료배송 주문은 주문당 한 번 나가는 쪽
--    운임을 더한다(왕복). 차감액이 이번 환불액 이상이거나 같은 클레임에 배송비 청구가 있으면 빼지 않는다.
create function private.partial_return_fee_deduction(p_claim_id uuid, p_gross bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare settings private.return_fee_deduction_settings; claim public.order_cancellation_requests; purchase public.orders; outbound boolean;
  fee bigint; reason text;
begin
  select * into settings from private.return_fee_deduction_settings where singleton;
  select * into claim from public.order_cancellation_requests where id = p_claim_id;
  if not found or settings.singleton is null or not settings.enabled then
    return jsonb_build_object('applicable', false, 'reason', 'disabled', 'deductionAmount', 0);
  end if;
  if claim.reason_type <> 'change_of_mind' then
    return jsonb_build_object('applicable', false, 'reason', 'seller_fault', 'deductionAmount', 0);
  end if;
  -- 스위치를 켠 시각 이전에 '결제금액 전액'으로 안내받고 접수한 반품은 차감하지 않는다(주문 전체 반품과 같은 규칙, 트랙 A 2-1).
  if settings.enabled_at is null or claim.requested_at < settings.enabled_at then
    return jsonb_build_object('applicable', false, 'reason', 'requested_before_enabled', 'deductionAmount', 0);
  end if;
  -- 효력 있는 배송 분실 기록(택배사 확인)이 있으면 차감하지 않는다(주문 전체 반품과 같은 규칙, 트랙 E).
  if private.claim_has_effective_carrier_loss(claim.id) then
    return jsonb_build_object('applicable', false, 'reason', 'carrier_loss', 'deductionAmount', 0);
  end if;
  select * into purchase from public.orders where id = claim.order_id;
  outbound := coalesce(purchase.shipping_fee, 0) = 0 and coalesce(purchase.shipping_collect_total, 0) = 0
    and not private.order_outbound_leg_charged(claim.order_id);
  fee := settings.one_way_amount::bigint * case when outbound then 2 else 1 end;
  reason := case
    when exists(select 1 from private.claim_fee_invoices i where i.claim_id = claim.id and i.state in ('unpaid', 'reported', 'paid')) then 'claim_fee_invoiced'
    when fee >= p_gross then 'fee_exceeds_refund'
    else null end;
  return jsonb_build_object('applicable', reason is null, 'reason', reason, 'basis', case when outbound then 'round_trip' else 'one_way' end,
    'oneWayAmount', settings.one_way_amount, 'feeAmount', fee, 'deductionAmount', case when reason is null then fee else 0 end,
    'settingsRevision', settings.revision);
end $$;
revoke all on function private.partial_return_fee_deduction(uuid, bigint) from public, anon, authenticated, service_role;

-- 주문 전체 반품의 차감: 같은 주문의 부분 반품이 이미 나가는 쪽 운임을 뺐으면 왕복을 다시 빼지 않는다(편도).
select private.j47_patch_function('private.return_fee_deduction_plan(uuid)',
  $a$basis := case when coalesce(purchase.shipping_fee, 0) = 0 and coalesce(purchase.shipping_collect_total, 0) = 0 then 'round_trip' else 'one_way' end;$a$,
  $a$basis := case when coalesce(purchase.shipping_fee, 0) = 0 and coalesce(purchase.shipping_collect_total, 0) = 0
    and not private.order_outbound_leg_charged(claim.order_id) then 'round_trip' else 'one_way' end;$a$);

-- 부분 반품 클레임에는 주문 전체 반품의 차감 판정을 쓰지 않는다(운영 환불 단계·고객 안내가 주문 전체 금액을 보이지 않게). 부분 반품의 차감은
-- 아래 계산이 정한다.
select private.j47_patch_function('private.return_fee_deduction_plan(uuid)',
  '  select * into purchase from public.orders where id = claim.order_id;',
  '  if private.claim_is_partial_return(claim.id) then return null; end if;
  select * into purchase from public.orders where id = claim.order_id;');

-- 8. 계산(읽기 전용). 운영 화면 미리보기와 환불 접수가 같은 함수를 쓴다.
create function private.order_partial_return_plan(p_claim_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare claim public.order_cancellation_requests; purchase public.orders; pay public.payments; blocker text; ci public.order_claim_items;
  item public.order_items; allocation private.order_price_allocations; link public.order_shipment_items; ship public.order_shipments;
  canceled_before integer; canceled_after integer; lines jsonb := '[]'::jsonb; emptied jsonb := '[]'::jsonb; touched uuid[] := array[]::uuid[];
  goods bigint := 0; shipping bigint := 0; credit bigint := 0; balance bigint; line_paid bigint; line_volume bigint; line_coupon bigint;
  line_credit bigint; shipment_left integer; ship_id uuid; fee jsonb; gross bigint; refund bigint; last_return boolean; fee_amount bigint;
begin
  select * into claim from public.order_cancellation_requests where id = p_claim_id;
  if not found then raise no_data_found using message = 'claim_not_found'; end if;
  if claim.claim_type <> 'return' or not private.claim_is_partial_return(claim.id) then raise check_violation using message = 'partial_return_not_partial'; end if;
  select * into purchase from public.orders where id = claim.order_id;
  blocker := private.order_partial_return_order_blocker(claim.order_id);
  if blocker is not null then raise check_violation using message = 'partial_return_' || blocker; end if;
  pay := private.order_partial_cancellation_payment(claim.order_id);
  for ci in select * from public.order_claim_items where claim_id = claim.id order by order_item_id loop
    select * into item from public.order_items where id = ci.order_item_id;
    allocation := private.order_item_price_allocation(item.id);
    if allocation.order_item_id is null then raise check_violation using message = 'partial_return_item_allocation_missing'; end if;
    canceled_before := private.order_item_partially_canceled_qty(item.id);
    select * into link from public.order_shipment_items where order_item_id = item.id and order_id = item.order_id;
    if ci.qty > item.qty - canceled_before or link.order_item_id is null or link.shipment_id <> ci.shipment_id or link.qty < ci.qty then
      raise check_violation using message = 'partial_return_state_changed';
    end if;
    select * into ship from public.order_shipments where id = link.shipment_id;
    canceled_after := canceled_before + ci.qty;
    line_paid := private.partial_cancel_prorate(allocation.paid_goods_total, canceled_after, item.qty)
      - private.partial_cancel_prorate(allocation.paid_goods_total, canceled_before, item.qty);
    line_volume := private.partial_cancel_prorate(allocation.volume_discount, canceled_after, item.qty)
      - private.partial_cancel_prorate(allocation.volume_discount, canceled_before, item.qty);
    line_coupon := private.partial_cancel_prorate(allocation.coupon_discount, canceled_after, item.qty)
      - private.partial_cancel_prorate(allocation.coupon_discount, canceled_before, item.qty);
    line_credit := private.partial_cancel_prorate(allocation.store_credit_discount, canceled_after, item.qty)
      - private.partial_cancel_prorate(allocation.store_credit_discount, canceled_before, item.qty);
    goods := goods + line_paid;
    credit := credit + line_credit;
    if not ship.id = any(touched) then touched := touched || ship.id; end if;
    lines := lines || jsonb_build_object('orderItemId', item.id, 'shipmentId', ship.id, 'shipmentNumber', ship.shipment_number,
      'originName', ship.origin_name_snapshot, 'goodName', item.good_name_snapshot, 'variantName', item.variant_name_snapshot,
      'qty', ci.qty, 'orderedQty', item.qty, 'canceledQtyBefore', canceled_before, 'remainingQtyAfter', item.qty - canceled_after,
      'grossAmount', ci.qty::bigint * item.unit_price - line_volume, 'volumeDiscount', line_volume, 'couponDiscount', line_coupon,
      'storeCreditDiscount', line_credit, 'goodsRefundAmount', line_paid);
  end loop;
  if jsonb_array_length(lines) = 0 then raise check_violation using message = 'partial_return_not_partial'; end if;
  -- 그 배송 건에 남는 품목이 없으면 그 배송 건의 선결제 배송비를 함께 돌려준다(배송 건은 배송완료 그대로).
  foreach ship_id in array touched loop
    select coalesce(sum(l.qty), 0) - coalesce((select sum((x->>'qty')::integer) from jsonb_array_elements(lines) x
        where (x->>'shipmentId')::uuid = ship_id), 0)
      into shipment_left from public.order_shipment_items l where l.shipment_id = ship_id;
    if shipment_left = 0 then
      select * into ship from public.order_shipments where id = ship_id;
      shipping := shipping + private.order_shipment_prepaid_fee(ship_id);
      emptied := emptied || jsonb_build_object('shipmentId', ship.id, 'shipmentNumber', ship.shipment_number, 'originName', ship.origin_name_snapshot,
        'shippingFeeRefund', private.order_shipment_prepaid_fee(ship_id));
    end if;
  end loop;
  balance := pay.amount - private.payment_partial_refunded_amount(pay.id);
  -- 이 반품 뒤에 살아 있는 수량이 하나도 없으면 남은 잔액 전부다(1원 끝수까지 주문 전체 반품과 같게).
  last_return := not exists(select 1 from public.order_items i where i.order_id = claim.order_id
    and private.order_item_active_qty(i.id) - coalesce((select (x->>'qty')::integer from jsonb_array_elements(lines) x
      where (x->>'orderItemId')::uuid = i.id), 0) > 0);
  if last_return and balance >= shipping then goods := balance - shipping; end if;
  gross := goods + shipping;
  if gross > balance then raise check_violation using message = 'partial_return_exceeds_balance'; end if;
  fee := private.partial_return_fee_deduction(claim.id, gross);
  fee_amount := coalesce((fee->>'deductionAmount')::bigint, 0);
  refund := gross - fee_amount;
  return jsonb_build_object('claimId', claim.id, 'orderId', claim.order_id, 'orderNumber', purchase.order_number, 'paymentId', pay.id,
    'provider', pay.provider, 'paymentAmount', pay.amount, 'balanceBefore', balance, 'goodsRefundAmount', goods,
    'shippingRefundAmount', shipping, 'grossRefundAmount', gross, 'returnFee', fee, 'returnFeeDeduction', fee_amount,
    'refundAmount', refund, 'balanceAfter', balance - refund, 'storeCreditRestoreAmount', credit, 'lastReturn', last_return,
    'lines', lines, 'emptiedShipments', emptied);
end $$;
revoke all on function private.order_partial_return_plan(uuid) from public, anon, authenticated, service_role;

-- 9. 수량 단위 재고 복원(부분 반품). 배송 분실 품목·불량으로 고른 품목은 판매 재고로 되돌리지 않는다. 할당된 예약 판매 품목은 실물
--    재고로 되돌리고 예약 배정은 남은 수량을 위해 그대로 둔다. 감사 액션은 부분 취소와 같다(order.option_stock_partially_restored —
--    주문 전체 복원과 섞지 않는다). p_follow_successor는 결제확인필요 해소 때만 참이다(ADR-0032 결정 6).
create function private.restore_order_item_returned_supply(p_order_item_id uuid, p_qty integer, p_partial_cancellation_id uuid,
  p_claim_id uuid, p_follow_successor boolean default false)
returns void language plpgsql set search_path = '' as $$
declare item public.order_items; physical record; target record; reservation private.goods_preorder_reservations;
begin
  select * into item from public.order_items where id = p_order_item_id;
  if not found then raise no_data_found using message = 'order_item_not_found'; end if;
  if p_qty is null or p_qty <= 0 then raise invalid_parameter_value using message = 'invalid_partial_return_items'; end if;
  perform 1 from public.orders where id = item.order_id for update;
  if private.claim_item_lost_in_transit(p_claim_id, item.id) then
    insert into public.audit_log(actor_id, action, target, diff) values(auth.uid(), 'order.option_stock_lost_in_transit', 'order:' || item.order_id::text,
      jsonb_build_object('orderItemId', item.id, 'goodId', item.good_id, 'variantId', item.variant_id, 'qty', p_qty, 'supplySource', item.supply_source,
        'reason', '부분 반품', 'claimId', p_claim_id, 'partialCancellationId', p_partial_cancellation_id));
    return;
  end if;
  -- 반품 불량 재고(QNA-035): 이 클레임에서 불량으로 고른 품목(기록은 admin_record_claim_defective_stock).
  if exists(select 1 from private.claim_defective_stock d where d.claim_id = p_claim_id and d.order_item_id = item.id) then return; end if;
  perform private.lock_goods_stock_successor_topology();
  select * into physical from private.order_item_physical_unit(item.id);
  select * into target from private.resolve_goods_stock_successor(physical.good_id, physical.variant_id);
  perform 1 from public.goods where id = any(array[item.good_id, physical.good_id, target.good_id]) order by id for update nowait;
  perform 1 from public.goods_variants where id = any(array[item.variant_id, physical.variant_id, target.variant_id]) order by id for update nowait;
  if item.supply_source = 'preorder' then
    select * into reservation from private.goods_preorder_reservations where order_item_id = item.id for update;
    if not found or reservation.state <> 'allocated' then raise check_violation using message = 'partial_return_item_preorder_not_allocated'; end if;
  elsif item.supply_source <> 'stock' then
    raise check_violation using message = 'partial_return_item_supply_unavailable';
  end if;
  if not p_follow_successor and (target.hop_count > 0 or physical.good_id <> item.good_id
    or exists(select 1 from private.group_claim_reshipment_allocations where order_item_id = item.id)
    or exists(select 1 from public.order_claim_reshipment_items where order_item_id = item.id)) then
    raise check_violation using message = 'partial_cancel_item_stock_topology_changed';
  end if;
  perform private.apply_group_physical_stock_deltas(jsonb_build_array(jsonb_build_object('goodId', target.good_id, 'variantId', target.variant_id, 'delta', p_qty)));
  insert into public.audit_log(actor_id, action, target, diff) values(auth.uid(), 'order.option_stock_partially_restored', 'order:' || item.order_id::text,
    jsonb_build_object('orderItemId', item.id, 'goodId', target.good_id, 'variantId', target.variant_id, 'delta', p_qty,
      'originalGoodId', item.good_id, 'originalVariantId', item.variant_id, 'physicalGoodId', physical.good_id, 'physicalVariantId', physical.variant_id,
      'generationKind', physical.generation_kind, 'generationId', physical.generation_id, 'operationPath', target.operation_path,
      'supplySource', item.supply_source, 'preorderPolicyId', item.preorder_policy_id, 'reason', '부분 반품',
      'partialCancellationId', p_partial_cancellation_id, 'claimId', p_claim_id, 'followedSuccessor', p_follow_successor));
exception when lock_not_available then raise sqlstate 'PT409' using message = 'goods_group_retry';
end $$;
revoke all on function private.restore_order_item_returned_supply(uuid, integer, uuid, uuid, boolean) from public, anon, authenticated, service_role;

-- 10. 적용(부분 반품). 결제사 확인 뒤(토스)·환불 접수 때(무통장·0원) 한 트랜잭션에서 배송 건 품목(살아 있는 수량)·재고·적립금·카드팩을
--     바꾼다. 클레임 단계는 원장 상태 트리거가 맞춘다.
create function private.apply_order_partial_return(p_id uuid, p_actor uuid, p_next_state text, p_follow_successor boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare head private.order_partial_cancellations; purchase public.orders; claim public.order_cancellation_requests; line record; ship_id uuid;
  policy record; remaining numeric; active_targets integer;
begin
  select * into head from private.order_partial_cancellations where id = p_id for update;
  if not found then raise no_data_found using message = 'partial_cancellation_not_found'; end if;
  if head.applied_at is not null then return; end if;
  if head.reason_code <> 'return' then raise check_violation using message = 'partial_return_not_partial'; end if;
  if p_next_state not in ('completed', 'awaiting_transfer') then raise invalid_parameter_value using message = 'invalid_partial_cancel_state'; end if;
  select * into purchase from public.orders where id = head.order_id for update;
  perform s.id from public.order_shipments s where s.order_id = head.order_id order by s.id for update;
  select * into claim from public.order_cancellation_requests where id = head.claim_id for update;
  if purchase.status = 'canceled' or claim.claim_type <> 'return' or claim.stage not in ('processing', 'needs_review')
    or not private.claim_collections_complete(claim.id) then
    raise check_violation using message = 'partial_return_state_changed';
  end if;
  for line in select l.*, link.qty as link_qty, link.shipment_id as link_shipment
    from private.order_partial_cancellation_items l
    left join public.order_shipment_items link on link.order_item_id = l.order_item_id and link.order_id = l.order_id
    where l.partial_cancellation_id = p_id order by l.order_item_id loop
    if line.link_qty is null or line.link_shipment <> line.shipment_id or line.link_qty < line.qty
      or private.order_item_partially_canceled_qty(line.order_item_id) <> line.canceled_qty_before then
      raise check_violation using message = 'partial_return_state_changed';
    end if;
  end loop;
  update private.order_partial_cancellations set state = p_next_state, applied_at = clock_timestamp(),
    completed_at = case when p_next_state = 'completed' then clock_timestamp() else completed_at end, last_error_code = null
  where id = p_id;
  for line in select * from private.order_partial_cancellation_items where partial_cancellation_id = p_id order by order_item_id loop
    delete from public.order_shipment_items where order_item_id = line.order_item_id and order_id = line.order_id and qty = line.qty;
    if not found then
      update public.order_shipment_items set qty = qty - line.qty where order_item_id = line.order_item_id and order_id = line.order_id;
    end if;
    perform private.restore_order_item_returned_supply(line.order_item_id, line.qty, p_id, head.claim_id, p_follow_successor);
  end loop;
  for ship_id in select shipment_id from private.order_partial_return_shipments where partial_cancellation_id = p_id order by shipment_id loop
    if exists(select 1 from public.order_shipment_items where shipment_id = ship_id) then
      raise check_violation using message = 'partial_return_state_changed';
    end if;
  end loop;
  if head.store_credit_restore_amount > 0 then
    perform private.restore_order_store_credit_portion(head.order_id, purchase.user_id, head.store_credit_restore_amount);
  end if;
  -- 카드팩: 지급 조건의 거울(ADR-0032와 같다). 남은 수량의 대상 금액이 최소 금액에 못 미치거나 대상 품목이 모두 빠지면 미개봉만 회수한다.
  for policy in select distinct rp.id, rp.target_ip_id, rp.target_good_id, rp.min_amount
    from public.draw_tickets t join public.reward_policies rp on rp.id = t.reward_policy_id
    where t.source = 'order_paid' and t.source_id = head.order_id and t.consumed_at is null and t.revoked_at is null loop
    select coalesce(sum(private.order_item_active_qty(i.id)::numeric * i.unit_price), 0),
      count(*) filter (where private.order_item_active_qty(i.id) > 0)
      into remaining, active_targets
    from public.order_items i where i.order_id = head.order_id and i.good_ip_id_snapshot = policy.target_ip_id
      and (policy.target_good_id is null or i.good_id = policy.target_good_id);
    if active_targets = 0 or remaining < policy.min_amount then
      perform t.id from public.draw_tickets t where t.source = 'order_paid' and t.source_id = head.order_id
        and t.reward_policy_id = policy.id and t.consumed_at is null and t.revoked_at is null order by t.id for update;
      update public.draw_tickets set revoked_at = now() where source = 'order_paid' and source_id = head.order_id
        and reward_policy_id = policy.id and consumed_at is null and revoked_at is null;
    end if;
  end loop;
  insert into public.audit_log(actor_id, action, target, diff)
  values (p_actor, 'admin.order.partial_return_applied', 'order:' || head.order_id::text,
    jsonb_build_object('partialCancellationId', p_id, 'claimId', head.claim_id, 'state', p_next_state, 'provider', head.provider,
      'refundAmount', head.refund_amount, 'goodsRefundAmount', head.goods_refund_amount, 'shippingRefundAmount', head.shipping_refund_amount,
      'returnFeeDeduction', head.return_fee_deduction, 'storeCreditRestoreAmount', head.store_credit_restore_amount,
      'lines', (select jsonb_agg(jsonb_build_object('orderItemId', l.order_item_id, 'shipmentId', l.shipment_id, 'qty', l.qty,
        'goodsRefundAmount', l.goods_refund_amount) order by l.order_item_id) from private.order_partial_cancellation_items l where l.partial_cancellation_id = p_id),
      'emptiedShipments', coalesce((select jsonb_agg(r.shipment_id order by r.shipment_id) from private.order_partial_return_shipments r
        where r.partial_cancellation_id = p_id), '[]'::jsonb)));
  perform private.notify_order_partial_cancellation(p_id, 'applied');
end $$;
revoke all on function private.apply_order_partial_return(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;

select private.j47_patch_function('private.apply_order_partial_cancellation(uuid,uuid,text,boolean)',
  '  if head.applied_at is not null then return; end if;',
  '  if head.applied_at is not null then return; end if;
  -- 부분 반품(ADR-0047)은 배송된 품목의 회수·환불이라 발송 전 조건·배송 건 닫기를 따르지 않는다.
  if head.reason_code = ''return'' then perform private.apply_order_partial_return(p_id, p_actor, p_next_state, p_follow_successor); return; end if;');

-- 11. 알림. 부분 반품은 반품 문장으로 말한다(알림·주문 상세가 같은 사실).
create function private.notify_order_partial_return(p_id uuid, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare head private.order_partial_cancellations; purchase public.orders; label text; body text; title text; deduction text;
begin
  select * into head from private.order_partial_cancellations where id = p_id;
  select * into purchase from public.orders where id = head.order_id;
  label := left(coalesce(private.partial_cancellation_items_label(p_id), '일부 굿즈'), 200);
  deduction := case when head.return_fee_deduction > 0 then format('반품배송비 %s을 뺀 ', private.format_krw(head.return_fee_deduction)) else '' end;
  if p_event = 'applied' then
    title := case when head.state = 'completed' then '반품 환불이 완료됐어요' else '반품 환불 송금을 접수했어요' end;
    body := format('반품하신 %s의 확인을 마쳤습니다. %s%s나머지 굿즈는 그대로 유지됩니다.', label,
      case when head.refund_amount = 0 then '돌려드릴 결제 금액은 없습니다. '
        when head.provider = 'bank_transfer'
        then format('%s환불 %s은 등록하신 환불계좌로 송금해 드립니다. ', deduction, private.format_krw(head.refund_amount))
        else format('%s%s을 결제사에서 부분 취소했습니다(카드사 처리에 영업일 기준 3~4일). ', deduction, private.format_krw(head.refund_amount)) end,
      case when head.store_credit_restore_amount > 0
        then format('사용하신 적립금 %s은 적립금으로 되돌려 드렸습니다. ', private.format_krw(head.store_credit_restore_amount)) else '' end);
  elsif p_event = 'transferred' then
    title := '반품 환불을 송금했어요';
    body := format('반품하신 %s의 환불 %s을 환불계좌로 송금했습니다.', label, private.format_krw(head.refund_amount));
  else
    return;
  end if;
  insert into public.notifications(user_id, type, title, body, link_path, source_type, source_id, dedupe_key)
  values (purchase.user_id, 'claim_updated', title, left(body, 500), '/orders/' || purchase.id::text, 'order_partial_cancellation', head.id::text,
    'partial-return:' || p_event || ':' || head.id::text)
  on conflict (user_id, dedupe_key) do nothing;
end $$;
revoke all on function private.notify_order_partial_return(uuid, text) from public, anon, authenticated, service_role;

select private.j47_patch_function('private.notify_order_partial_cancellation(uuid,text)',
  '  select * into head from private.order_partial_cancellations where id = p_id;
',
  '  select * into head from private.order_partial_cancellations where id = p_id;
  if head.reason_code = ''return'' then perform private.notify_order_partial_return(p_id, p_event); return; end if;
');

-- 12. 원장 상태 → 클레임 단계. 완료면 클레임 완료, 확인 필요면 확인 필요, 다시 처리 중이면 처리 중, 결제사가 받지 않아 닫히면 확인 필요
--     (partial_return_provider_refused — 전액 환불로 돌리지 않는다, 같은 클레임에 환불 접수를 다시 기록하면 새 원장으로 다시 시도).
create function private.sync_partial_return_claim() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.reason_code <> 'return' or new.state is not distinct from old.state then return null; end if;
  if new.state = 'completed' then
    update public.order_cancellation_requests set stage = 'completed', completed_at = coalesce(completed_at, now()), last_error_code = null,
      updated_at = now() where id = new.claim_id and stage <> 'completed';
  elsif new.state = 'needs_review' then
    update public.order_cancellation_requests set stage = 'needs_review', last_error_code = coalesce(new.last_error_code, 'partial_return_review'),
      updated_at = now() where id = new.claim_id and stage <> 'completed';
  elsif new.state = 'processing' then
    update public.order_cancellation_requests set stage = 'processing', last_error_code = null, updated_at = now()
      where id = new.claim_id and stage = 'needs_review';
  elsif new.state = 'rejected' then
    update public.order_cancellation_requests set stage = 'needs_review', last_error_code = 'partial_return_provider_refused',
      updated_at = now() where id = new.claim_id and stage <> 'completed';
    insert into public.audit_log(actor_id, action, target, diff)
    values (null, 'admin.order.partial_return_provider_refused', 'order:' || new.order_id::text,
      jsonb_build_object('claimId', new.claim_id, 'partialCancellationId', new.id, 'refundAmount', new.refund_amount, 'reason', new.last_error_code));
  end if;
  return null;
end $$;
revoke all on function private.sync_partial_return_claim() from public, anon, authenticated, service_role;
create trigger order_partial_cancellations_return_claim after update of state on private.order_partial_cancellations
  for each row execute function private.sync_partial_return_claim();

-- 13. 환불 접수·완료 기록(부분 반품). admin_record_order_claim_refund가 주문·클레임을 잠그고 회수 완료를 확인한 뒤 여기로 보낸다.
--     filed: 계산을 한 번 정해 부분 환불 원장을 만든다(토스 processing → [환불 완료 확정]의 결제사 부분 취소, 무통장은 바로 적용해 송금 대기,
--     0원은 바로 완료). completed: 원장·클레임이 완료됐는지 확인하고 기록만 남긴다(환불은 결제사 확인·송금 증빙이 끝냈다).
create function private.record_partial_return_refund(p_claim_id uuid, p_method text, p_stage text, p_note text, p_actor uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare claim public.order_cancellation_requests; plan jsonb; head private.order_partial_cancellations; v_id uuid; v_sequence integer;
  v_state text; zero boolean; line jsonb; emptied jsonb; account private.claim_refund_accounts; fee jsonb; expected_method text;
begin
  select * into claim from public.order_cancellation_requests where id = p_claim_id for update;
  perform a.id from public.payment_attempts a where a.purpose = 'order' and a.ref_id = claim.order_id order by a.id for update;
  perform p.id from public.payments p where p.purpose = 'order' and p.ref_id = claim.order_id order by p.id for update;
  if p_stage = 'completed' then
    select * into head from private.order_partial_cancellations where claim_id = p_claim_id and state <> 'rejected';
    if claim.stage <> 'completed' or head.id is null or head.state <> 'completed' then
      raise exception using message = 'claim_refund_finalization_required';
    end if;
    if p_method <> (case when head.provider = 'bank_transfer' then 'bank_transfer' else 'pg_cancel' end) then
      raise check_violation using message = 'partial_return_refund_method_mismatch';
    end if;
    insert into public.audit_log(actor_id, action, target, diff)
    values (p_actor, 'admin.order.claim_refund_completed', 'order:' || claim.order_id::text,
      jsonb_build_object('claimId', p_claim_id, 'claimType', claim.claim_type, 'method', p_method, 'partialReturn', true,
        'partialCancellationId', head.id, 'refundAmount', head.refund_amount, 'returnFeeDeduction', head.return_fee_deduction,
        'settlementNote', p_note));
    return 'completed';
  end if;
  -- 이미 접수한 원장이 살아 있으면 같은 결과다(다시 누름).
  select * into head from private.order_partial_cancellations where claim_id = p_claim_id and state <> 'rejected';
  if found then return 'filed'; end if;
  -- 입고완료, 또는 결제사가 부분 취소를 받지 않아 닫힌 원장 뒤의 다시 접수만.
  if not (claim.stage = 'collected' or claim.stage = 'needs_review'
      and exists(select 1 from private.order_partial_cancellations h where h.claim_id = p_claim_id and h.state = 'rejected')) then
    raise exception using message = 'claim_not_refundable';
  end if;
  -- 버전 1 주문은 첫 부분 환불 때 배분을 얼린다(ADR-0032 보완 — 얼린 뒤에는 다시 계산하지 않는다).
  perform private.freeze_order_v1_allocation(claim.order_id, p_actor, extensions.gen_random_uuid());
  plan := private.order_partial_return_plan(p_claim_id);
  expected_method := case when plan->>'provider' = 'bank_transfer' then 'bank_transfer' else 'pg_cancel' end;
  if p_method <> expected_method then raise check_violation using message = 'partial_return_refund_method_mismatch'; end if;
  zero := (plan->>'refundAmount')::bigint = 0;
  if plan->>'provider' = 'bank_transfer' then
    -- 무통장 송금 담당(ADR-0010·T03과 같은 판정).
    perform private.require_operator_capability('sales.manage', true);
    if not zero then
      select * into account from private.claim_refund_accounts where claim_id = p_claim_id;
      if not found or account.purged_at is not null or account.account_number is null then
        raise exception using message = 'claim_refund_account_missing';
      end if;
    end if;
  end if;
  fee := plan->'returnFee';
  select coalesce(max(sequence), 0) + 1 into v_sequence from private.order_partial_cancellations where order_id = claim.order_id;
  v_state := case when zero then 'completed' when plan->>'provider' = 'bank_transfer' then 'awaiting_transfer' else 'processing' end;
  insert into private.order_partial_cancellations(order_id, payment_id, provider, sequence, reason_code, customer_decision, note,
    warehouse_stop_confirmed, payment_amount, balance_before, goods_refund_amount, shipping_refund_amount, refund_amount,
    store_credit_restore_amount, state, operation_id, created_by, filed_at, filed_by, claim_id,
    return_fee_deduction, return_fee_basis, return_fee_one_way_amount, return_fee_settings_revision)
  values (claim.order_id, (plan->>'paymentId')::uuid, (plan->>'provider')::public.payment_provider, v_sequence, 'return',
    left(format('반품 클레임 #%s · %s', claim.reference, claim.reason), 500), p_note, false,
    (plan->>'paymentAmount')::bigint, (plan->>'balanceBefore')::bigint, (plan->>'goodsRefundAmount')::bigint,
    (plan->>'shippingRefundAmount')::bigint, (plan->>'refundAmount')::bigint, (plan->>'storeCreditRestoreAmount')::bigint,
    'processing', extensions.gen_random_uuid(), p_actor,
    case when v_state = 'awaiting_transfer' then clock_timestamp() end, case when v_state = 'awaiting_transfer' then p_actor end, p_claim_id,
    (plan->>'returnFeeDeduction')::bigint,
    case when (plan->>'returnFeeDeduction')::bigint > 0 then fee->>'basis' end,
    case when (plan->>'returnFeeDeduction')::bigint > 0 then (fee->>'oneWayAmount')::integer end,
    case when (plan->>'returnFeeDeduction')::bigint > 0 then (fee->>'settingsRevision')::integer end)
  returning id into v_id;
  for line in select value from jsonb_array_elements(plan->'lines') loop
    insert into private.order_partial_cancellation_items(partial_cancellation_id, order_id, order_item_id, shipment_id, qty, canceled_qty_before,
      gross_amount, volume_discount, coupon_discount, store_credit_discount, goods_refund_amount)
    values (v_id, claim.order_id, (line->>'orderItemId')::uuid, (line->>'shipmentId')::uuid, (line->>'qty')::integer, (line->>'canceledQtyBefore')::integer,
      (line->>'grossAmount')::bigint, (line->>'volumeDiscount')::bigint, (line->>'couponDiscount')::bigint,
      (line->>'storeCreditDiscount')::bigint, (line->>'goodsRefundAmount')::bigint);
  end loop;
  for emptied in select value from jsonb_array_elements(plan->'emptiedShipments') loop
    insert into private.order_partial_return_shipments(partial_cancellation_id, order_id, shipment_id, shipping_fee_refund)
    values (v_id, claim.order_id, (emptied->>'shipmentId')::uuid, (emptied->>'shippingFeeRefund')::bigint);
  end loop;
  if v_state = 'awaiting_transfer' then
    -- 고객이 반품 신청 때 낸 환불계좌를 부분 환불 원장 계좌로 옮긴다(송금 대기 목록·엑셀·송금 완료가 이 원장을 읽는다).
    insert into private.order_partial_cancellation_refund_accounts(partial_cancellation_id, bank_name, account_number, account_holder, masked_account, masked_holder)
    values (v_id, account.bank_name, account.account_number, account.account_holder, account.masked_account, account.masked_holder);
  end if;
  update public.order_cancellation_requests set stage = 'processing', provider_started_at = coalesce(provider_started_at, now()),
    last_error_code = null, updated_at = now() where id = p_claim_id;
  insert into public.audit_log(actor_id, action, target, diff)
  values (p_actor, 'admin.order.claim_refund_filed', 'order:' || claim.order_id::text,
    jsonb_build_object('claimId', p_claim_id, 'claimType', claim.claim_type, 'method', p_method, 'from', claim.stage, 'to', 'processing',
      'partialReturn', true, 'partialCancellationId', v_id, 'provider', plan->>'provider', 'balanceBefore', (plan->>'balanceBefore')::bigint,
      'goodsRefundAmount', (plan->>'goodsRefundAmount')::bigint, 'shippingRefundAmount', (plan->>'shippingRefundAmount')::bigint,
      'returnFee', fee, 'refundAmount', (plan->>'refundAmount')::bigint, 'lines', plan->'lines', 'emptiedShipments', plan->'emptiedShipments'));
  if v_state in ('awaiting_transfer', 'completed') then
    perform private.apply_order_partial_cancellation(v_id, p_actor, v_state);
  else
    perform private.notify_order_claim(p_claim_id, 'refund_filed', '환불 접수가 완료됐어요',
      format('반품하신 굿즈의 환불 %s%s을 결제사 부분 취소로 진행합니다. 결제사 취소가 확인되면 다시 알려드립니다.',
        private.format_krw((plan->>'refundAmount')::bigint),
        case when (plan->>'returnFeeDeduction')::bigint > 0
          then format('(반품배송비 %s 차감)', private.format_krw((plan->>'returnFeeDeduction')::bigint)) else '' end));
  end if;
  return 'filed';
end $$;
revoke all on function private.record_partial_return_refund(uuid, text, text, text, uuid) from public, anon, authenticated, service_role;

select private.j47_patch_function('public.admin_record_order_claim_refund(uuid,text,text,text)',
  '  perform private.assert_claim_collections_complete(p_claim_id);
',
  '  perform private.assert_claim_collections_complete(p_claim_id);
  -- 부분 반품(ADR-0047)은 주문 전체 취소 원장(order_cancellation_claims·refunds)을 열지 않고 부분 환불 원장으로 간다.
  if private.claim_is_partial_return(p_claim_id) then
    if v_claim.claim_type <> ''return'' then raise exception using message = ''claim_not_refundable''; end if;
    return private.record_partial_return_refund(p_claim_id, p_method, p_stage, p_note, v_actor);
  end if;
');

-- 14. 재고 대조: '창고를 떠난 수량'은 발송 전 부분 취소만 뺀다(부분 반품은 이미 떠났다 — 돌아온 수량은 회수 묶음이 센다). 모두 반품돼
--     배송 건 품목 행이 사라진 품목은 원래 배송 건의 출고 시각을 쓴다. 무통장 부분 반품은 환불 접수 때 재고를 되돌리므로 그때부터 복원으로 센다.
select private.j47_patch_function('private.stock_reconcile_flows(uuid[],timestamp with time zone)',
  '(oi.qty-private.order_item_partially_canceled_qty(oi.id))::bigint as qty',
  '(oi.qty-private.order_item_stockout_canceled_qty(oi.id))::bigint as qty');
select private.j47_patch_function('private.stock_reconcile_flows(uuid[],timestamp with time zone)',
  'left join public.order_shipments s on s.id=si.shipment_id',
  'left join public.order_shipments s on s.id=coalesce(si.shipment_id,private.order_item_returned_shipment(oi.id))');
select private.j47_patch_function('private.stock_reconcile_flows(uuid[],timestamp with time zone)',
  $a$else o.status='canceled' or c.stage='completed' end as restored,c.id as claim_id$a$,
  $a$else o.status='canceled' or c.stage='completed' or private.claim_partial_return_applied(c.id) end as restored,c.id as claim_id$a$);

-- 15. 주문 전체 반품의 재고 복원: 앞선 부분 반품의 불량·배송 분실 기록은 그 반품 수량에만 해당한다(남은 수량은 되돌린다).
select private.j47_patch_function('private.restore_order_item_supply(uuid,text)',
  $a$where d.order_item_id=item.id and c.claim_type='return' and c.stage not in ('rejected','withdrawn')) then$a$,
  $a$where d.order_item_id=item.id and c.claim_type='return' and c.stage not in ('rejected','withdrawn')
    and not private.claim_is_partial_return(c.id)) then$a$);
select private.j47_patch_function('private.order_item_lost_in_transit(uuid)',
  $a$where w.kind = 'carrier_loss' and c.claim_type = 'return' and c.stage not in ('rejected', 'withdrawn')$a$,
  $a$where w.kind = 'carrier_loss' and c.claim_type = 'return' and c.stage not in ('rejected', 'withdrawn')
      and not private.claim_is_partial_return(c.id)$a$);

-- 16. 반품 불량 재고(QNA-035): 부분 반품은 고른 품목만, 불량 수량은 그 클레임의 반품 수량이다. 부분 반품 환불을 적용한 뒤(재고가 정해진 뒤)에는
--     선택을 바꿀 수 없고, 기록은 주문 취소 대신 부분 반품 적용 뒤에 연다.
select private.j47_patch_function('public.admin_plan_claim_defective_stock(uuid,uuid[])',
  'or exists(select 1 from private.bank_transfer_claim_refunds b where b.claim_id = p_claim_id or b.order_id = claim.order_id) then',
  'or exists(select 1 from private.bank_transfer_claim_refunds b where b.claim_id = p_claim_id or b.order_id = claim.order_id)
    or private.claim_partial_return_applied(p_claim_id) then');
select private.j47_patch_function('public.admin_plan_claim_defective_stock(uuid,uuid[])',
  '  delete from private.claim_defective_stock d where d.claim_id = p_claim_id and d.state = ''planned'' and not (d.order_item_id = any(ids));',
  '  if exists(select 1 from unnest(ids) x where not private.claim_line_selected(p_claim_id, x)) then
    raise check_violation using message = ''defective_stock_item_not_in_claim'';
  end if;
  delete from private.claim_defective_stock d where d.claim_id = p_claim_id and d.state = ''planned'' and not (d.order_item_id = any(ids));');
select private.j47_patch_function('public.admin_plan_claim_defective_stock(uuid,uuid[])',
  'for item in select oi.id, private.order_item_active_qty(oi.id) as qty from public.order_items oi where oi.id = any(ids) order by oi.id loop',
  'for item in select oi.id, coalesce((select ci.qty from public.order_claim_items ci where ci.claim_id = p_claim_id and ci.order_item_id = oi.id),
      private.order_item_active_qty(oi.id)) as qty from public.order_items oi where oi.id = any(ids) order by oi.id loop');
select private.j47_patch_function('public.admin_record_claim_defective_stock(uuid)',
  $a$if claim.stage in ('rejected','withdrawn') or ord.status <> 'canceled' then$a$,
  $a$if claim.stage in ('rejected','withdrawn') or (ord.status <> 'canceled' and not private.claim_partial_return_applied(p_claim_id)) then$a$);
select private.j47_patch_function('public.admin_record_claim_defective_stock(uuid)',
  $a$or exists(select 1 from private.group_stock_restorations g where g.order_item_id = item.id and g.cause = 'refund') then$a$,
  $a$or exists(select 1 from private.group_stock_restorations g where g.order_item_id = item.id and g.cause = 'refund')
        or exists(select 1 from public.audit_log a where a.target = 'order:' || claim.order_id::text and a.action = 'order.option_stock_partially_restored'
          and a.diff->>'orderItemId' = item.id::text and a.diff->>'claimId' = p_claim_id::text) then$a$);

-- 17. 부분 반품 완료는 주문 전체 취소·반품 완료가 아니다 — 리뷰 이벤트 보상 회수·베스트 리뷰 무효화를 주문 전체에 걸지 않는다.
select private.j47_patch_function('private.review_event_purchase_revocation()',
  $a$and (new.status='completed' or new.stage='completed') then$a$,
  $a$and (new.status='completed' or new.stage='completed') and not private.claim_is_partial_return(new.id) then$a$);
select private.j47_patch_function('private.review_best_purchase_changed()',
  $a$and (new.status='completed' or new.stage='completed') then$a$,
  $a$and (new.status='completed' or new.stage='completed') and not private.claim_is_partial_return(new.id) then$a$);

-- 18. 읽기. 부분 환불 원장 JSON은 부분 반품 줄에만 종류·클레임·차감 칸을 더한다(재고 부족 부분 취소 줄의 모양은 그대로).
select private.j47_patch_function('private.order_partial_cancellation_json(uuid,text)',
  $a$    'closedShipmentCount', (select count(*) from private.order_partial_cancellation_shipments c where c.partial_cancellation_id = head.id))$a$,
  $a$    'closedShipmentCount', (select count(*) from private.order_partial_cancellation_shipments c where c.partial_cancellation_id = head.id))
  || case when head.reason_code = 'return' then jsonb_build_object('reasonCode', 'return', 'claimId', head.claim_id,
      'returnFeeDeduction', head.return_fee_deduction, 'returnFeeBasis', head.return_fee_basis,
      'emptiedShipmentCount', (select count(*) from private.order_partial_return_shipments r where r.partial_cancellation_id = head.id))
    else '{}'::jsonb end$a$);
select private.j47_patch_function('public.service_order_partial_cancellation(uuid)',
  $a$'paymentKey', pay.payment_key,$a$,
  $a$'reasonCode', head.reason_code, 'claimId', head.claim_id, 'paymentKey', pay.payment_key,$a$);

-- 거래확정 엑셀(정산): 부분 반품으로 비게 된 배송 건은 배송비를 환불했으므로 닫힌 배송 건처럼 센다(품목·배송비 배분에서 뺀다).
-- 반품배송비 차감액은 결제 잔액에 남은 수입이라 품목 금액에 넣지 않고 따로 싣는다(returnFeeRetained — 부분 반품이 있을 때만 키가 있다).
create function private.shipment_emptied_by_partial_return(p_shipment_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.order_partial_return_shipments r
    join private.order_partial_cancellations h on h.id = r.partial_cancellation_id
    where r.shipment_id = p_shipment_id and h.applied_at is not null);
$$;
revoke all on function private.shipment_emptied_by_partial_return(uuid) from public, anon, authenticated, service_role;
select private.j47_patch_function('private.collect_settled_export_for_search(date,date,text,text,text)',
  $a$case when private.shipment_closed_by_partial_cancel(s.id) then jsonb_build_object('closedByPartialCancel', true)$a$,
  $a$case when private.shipment_closed_by_partial_cancel(s.id) or private.shipment_emptied_by_partial_return(s.id) then jsonb_build_object('closedByPartialCancel', true)$a$);
select private.j47_patch_function('private.order_partial_cancel_report_fields(uuid)',
  $a$          'shippingRefundAmount', h.shipping_refund_amount, 'appliedAt', h.applied_at) order by h.sequence)
        from private.order_partial_cancellations h where h.order_id = p_order_id and h.applied_at is not null))$a$,
  $a$          'shippingRefundAmount', h.shipping_refund_amount, 'appliedAt', h.applied_at) order by h.sequence)
        from private.order_partial_cancellations h where h.order_id = p_order_id and h.applied_at is not null))
      || case when exists(select 1 from private.order_partial_cancellations h where h.order_id = p_order_id and h.applied_at is not null
          and h.reason_code = 'return' and h.return_fee_deduction > 0)
        then jsonb_build_object('returnFeeRetained', (select sum(h.return_fee_deduction)::bigint from private.order_partial_cancellations h
          where h.order_id = p_order_id and h.applied_at is not null and h.reason_code = 'return'))
        else '{}'::jsonb end$a$);

-- 운영 클레임 상세의 부분 반품 칸: 고른 품목, 환불 원장(가장 최근 살아 있는 줄과 이력), 환불 접수 전이면 계산 미리보기.
create function public.admin_order_claim_partial_return(p_claim_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare claim public.order_cancellation_requests; level text; can_manage boolean; preview jsonb; items jsonb; history jsonb; live uuid;
begin
  perform private.require_operator_capability('sales.read', false);
  select * into claim from public.order_cancellation_requests where id = p_claim_id;
  if not found then raise no_data_found using message = 'claim_not_found'; end if;
  if not private.claim_is_partial_return(p_claim_id) then return null; end if;
  can_manage := public.has_operator_capability('sales.manage', false);
  level := case when public.has_operator_capability('sales.manage', true) then 'legacy' when can_manage then 'manage' else 'read' end;
  select jsonb_agg(jsonb_build_object('orderItemId', ci.order_item_id, 'goodName', item.good_name_snapshot, 'variantName', item.variant_name_snapshot,
      'variantCode', item.variant_code_snapshot, 'qty', ci.qty, 'orderedQty', item.qty, 'shipmentId', ci.shipment_id,
      'shipmentNumber', ship.shipment_number, 'originName', ship.origin_name_snapshot) order by ship.shipment_number, item.good_name_snapshot, item.id)
    into items
  from public.order_claim_items ci join public.order_items item on item.id = ci.order_item_id
  join public.order_shipments ship on ship.id = ci.shipment_id where ci.claim_id = p_claim_id;
  select coalesce(jsonb_agg(private.order_partial_cancellation_json(h.id, level) order by h.sequence), '[]'::jsonb) into history
  from private.order_partial_cancellations h where h.claim_id = p_claim_id;
  select h.id into live from private.order_partial_cancellations h where h.claim_id = p_claim_id and h.state <> 'rejected';
  if live is null and can_manage and claim.stage in ('collected', 'needs_review', 'collecting', 'in_review', 'requested', 'on_hold') then
    begin
      preview := private.order_partial_return_plan(p_claim_id);
    exception when check_violation or no_data_found then
      preview := jsonb_build_object('error', sqlerrm);
    end;
  end if;
  return jsonb_build_object('items', coalesce(items, '[]'::jsonb), 'refundId', live, 'history', history, 'preview', preview);
end $$;
revoke all on function public.admin_order_claim_partial_return(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_order_claim_partial_return(uuid) to authenticated;

-- 구매자 주문 상세: 자기 주문의 부분 반품 클레임과 고른 품목(랜덤 판매 옵션 이름은 숨긴다).
create function public.get_my_order_claim_items(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('claimId', ci.claim_id, 'orderItemId', ci.order_item_id, 'goodName', item.good_name_snapshot,
      'variantName', case when item.option_sale_mode_snapshot = 'random' then null else item.variant_name_snapshot end, 'qty', ci.qty)
    order by ci.created_at, item.good_name_snapshot, item.id), '[]'::jsonb)
  from public.order_claim_items ci join public.order_items item on item.id = ci.order_item_id join public.orders o on o.id = ci.order_id
  where ci.order_id = p_order_id and (select auth.uid()) is not null and o.user_id = (select auth.uid());
$$;
revoke all on function public.get_my_order_claim_items(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_my_order_claim_items(uuid) to authenticated;

-- 19. 운영 스위치 화면(트랙 A 패턴): 문서에 부분 반품 칸을 더하고 저장 RPC를 둔다. 켤 때 근거 필수, 작업 ID 멱등, 낡은 리비전 PT409, 감사 한 줄.
select private.j47_patch_function('private.operations_switches_document()',
  $a$      from private.return_fee_deduction_settings r where r.singleton));$a$,
  $a$      from private.return_fee_deduction_settings r where r.singleton),
    'partialReturn', (select jsonb_build_object('revision', r.revision, 'enabled', r.partial_return_enabled,
        'evidence', r.partial_return_evidence, 'enabledAt', r.partial_return_enabled_at, 'updatedAt', r.updated_at,
        'updatedBy', (select p.nickname from public.profiles p where p.id = r.updated_by))
      from private.return_fee_deduction_settings r where r.singleton));$a$);

create function public.admin_save_partial_return_switch(p_enabled boolean, p_evidence text,
  p_expected_revision integer, p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare actor uuid; previous private.return_fee_deduction_settings; request jsonb; receipt jsonb;
begin
  actor := private.require_operator_capability('platform.manage', true);
  perform private.require_operator_capability('sales.manage', false);
  if p_enabled is null or p_expected_revision is null or p_expected_revision < 1 or p_operation_id is null
    or (p_evidence is not null and (p_evidence <> btrim(p_evidence) or char_length(p_evidence) not between 2 and 1000 or p_evidence ~ '[[:cntrl:]]'))
    then raise invalid_parameter_value using message = 'invalid_operations_switch'; end if;
  if p_enabled and p_evidence is null then raise invalid_parameter_value using message = 'operations_switch_evidence_required'; end if;
  request := jsonb_build_object('enabled', p_enabled, 'evidence', p_evidence, 'expectedRevision', p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended('operations-switch-operation:' || p_operation_id::text, 0));
  receipt := private.operator_lifecycle_replay(actor, p_operation_id, 'admin.operations_switch.partial_return', request);
  if receipt is not null then return receipt; end if;
  select * into previous from private.return_fee_deduction_settings where singleton for update;
  if not found then raise no_data_found using message = 'operations_switch_missing'; end if;
  if previous.revision <> p_expected_revision then raise sqlstate 'PT409' using message = 'operations_switch_changed'; end if;
  perform set_config('icons.operations_switch_tx', txid_current()::text, true);
  update private.return_fee_deduction_settings set partial_return_enabled = p_enabled,
    partial_return_evidence = coalesce(p_evidence, partial_return_evidence), updated_by = actor,
    partial_return_enabled_at = case when p_enabled and not previous.partial_return_enabled then clock_timestamp() else previous.partial_return_enabled_at end
    where singleton;
  receipt := private.operations_switches_document();
  insert into public.audit_log(id, actor_id, action, target, diff) values (p_operation_id, actor, 'admin.operations_switch.partial_return',
    'return_fee_deduction_settings', jsonb_build_object('request', request,
      'before', jsonb_build_object('enabled', previous.partial_return_enabled, 'evidence', previous.partial_return_evidence,
        'revision', previous.revision), 'result', receipt));
  return receipt;
end $$;
revoke all on function public.admin_save_partial_return_switch(boolean, text, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_partial_return_switch(boolean, text, integer, uuid) to authenticated;

-- 20. 운영자 계약. 새 RPC는 분류를 적고, 본문을 바꾼 함수는 등록된 분류값 그대로 지문을 다시 적는다. 새 RLS 정책도 등록한다.
select private.register_operator_rpc_contract('public.admin_order_partial_return_context(uuid)'::regprocedure, 'sales.manage', 'read', false);
select private.register_operator_rpc_contract('public.admin_submit_seller_partial_return_intake(uuid,jsonb,jsonb,jsonb)'::regprocedure, 'sales.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_order_claim_partial_return(uuid)'::regprocedure, 'sales.read', 'read', false);
select private.register_operator_rpc_contract('public.admin_save_partial_return_switch(boolean,text,integer,uuid)'::regprocedure, 'platform.manage', 'write', true);
select private.register_operator_policy_contract('public.order_claim_items'::regclass, 'order_claim_items_owner_staff_read', 'sales.read');
do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'private.guard_order_partial_cancellation()'::regprocedure,
    'public.admin_submit_seller_claim_intake(uuid,jsonb,jsonb)'::regprocedure,
    'private.prepare_claim_collections(uuid,boolean)'::regprocedure,
    'private.claim_collections_complete(uuid)'::regprocedure,
    'private.order_claim_type_change_blocker(public.order_cancellation_requests)'::regprocedure,
    'public.assert_order_cancellation_reconciliation_allowed(uuid,uuid)'::regprocedure,
    'private.return_fee_deduction_plan(uuid)'::regprocedure,
    'private.apply_order_partial_cancellation(uuid,uuid,text,boolean)'::regprocedure,
    'private.notify_order_partial_cancellation(uuid,text)'::regprocedure,
    'public.admin_record_order_claim_refund(uuid,text,text,text)'::regprocedure,
    'private.stock_reconcile_flows(uuid[],timestamp with time zone)'::regprocedure,
    'private.restore_order_item_supply(uuid,text)'::regprocedure,
    'private.order_item_lost_in_transit(uuid)'::regprocedure,
    'public.admin_plan_claim_defective_stock(uuid,uuid[])'::regprocedure,
    'public.admin_record_claim_defective_stock(uuid)'::regprocedure,
    'private.review_event_purchase_revocation()'::regprocedure,
    'private.review_best_purchase_changed()'::regprocedure,
    'private.order_partial_cancellation_json(uuid,text)'::regprocedure,
    'public.service_order_partial_cancellation(uuid)'::regprocedure,
    'private.operations_switches_document()'::regprocedure,
    'private.collect_settled_export_for_search(date,date,text,text,text)'::regprocedure,
    'private.order_partial_cancel_report_fields(uuid)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only); end if;
    if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

drop function private.j47_patch_function(text, text, text, integer);

commit;
notify pgrst, 'reload schema';
