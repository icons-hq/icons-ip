-- 재고 부족 부분 취소(ADR-0032 보완 2026-11-19, 원장 #15 SHP-010·SHP-067) — 다른 배송 건이 발송된 뒤에도 발송 전 배송 건 몫을 취소·환불한다.
--
-- 원장 원문(SHP-010): 혼합 주문에서 김포분은 발송됐는데 남양주분이 품절·출고 불가로 판명. 운영자 전액 취소는 배송 건 하나라도
-- 발송되면 shipment_already_dispatched로 거절, 재고 부족 부분 취소는 '모든 배송 건 발송 전' 조건이라 불가 → 미발송 출고지 몫을
-- 취소·환불할 시스템 경로가 없다. action: "최소한 '발송 전 배송 건 단위 취소·환불' 경로를 실운영 전 확보".
--
-- 결정(판단 위임 원칙 ① 원문 ② 업계 ③ 좁히지 않음 ④ 돈·재고는 안전한 쪽 + 스위치·감사):
--  * 막힘을 '주문 전체 발송 전'에서 '고른 품목이 속한 배송 건이 발송 전(ready)'으로 옮긴다. 주문 상태는 결제완료·발주확인에
--    배송중(일부 발송)을 더한다. 주문 전체가 배송완료·구매확정이거나, 발송 전 배송 건에 남은 품목이 없으면 계속 막는다.
--  * 이미 발송된 배송 건의 품목은 품목 단위로 막고 이유(shipment_dispatched)를 보인다 — 반품·교환으로 처리한다.
--  * 환불액·배송비 몫·적립금 몫·재고 복원·카드팩 회수·합포장·착불 의무·출고 보류는 지금 계산을 그대로 쓴다(발송 전 배송 건만
--    건드리므로 같은 규칙이 성립한다). 그 배송 건이 닫히면 그 배송 건의 선결제 배송비를 함께 돌려준다.
--  * 주문 상태는 닫힌 배송 건을 빼고 다시 센다(배송 건 상태 갱신 트리거 → refresh_order_fulfillment, ADR-0032 결정 3·8).
--    남은 배송 건이 모두 배송완료면 주문이 배송완료가 되고 그 시각에 구매확정 정책을 포착한다(delivered_at = 남은 배송 건의 마지막 도착).
--  * 결제사 확인을 기다리는 동안(처리 중·결제확인필요) 그 주문은 반품·교환 접수를 받지 않는다 — 배송 중 접수가 열려 있는
--    일부 발송 주문에서 부분 취소 잔액이 확정되기 전 환불 의도 금액이 잔액보다 커지지 않게 한다. 같은 동안 발송 전 배송 건은
--    배송 건 행에서도 발송을 막는다(이미 배송중인 주문은 주문 상태 전이 가드를 지나지 않으므로) — 결제사에서 돈은 돌려줬는데
--    물건도 나가는 일이 없게 한다. 이미 나간 배송 건의 배송완료 기록은 막지 않는다.
--  * 교환 재출고 품목 원장(order_claim_reshipment_items)에 이력이 있는 품목은 재고 복원 단위가 품목 전체라 나누지 않는다
--    (그룹 배정 원장과 같은 stock_topology_changed). 발송 전 주문만 열던 때는 생길 수 없던 이력이다.
--  * 스위치(partial_cancel_enabled)는 그대로다. 켜는 것은 사람 결정이다.
--  * '창고 출고 중단 확인' 판정 줄(admin_start_order_partial_cancellation의 p_warehouse_stop_confirmed)은 다른 트랙이 고친다.
--    이 migration은 시작 함수를 건드리지 않는다.
begin;

create function private.o3e_patch_function(p_signature text, p_anchor text, p_replacement text)
returns void language plpgsql volatile set search_path = '' as $$
declare body text; found_count integer;
begin
  body := pg_get_functiondef(p_signature::regprocedure);
  found_count := (length(body) - length(replace(body, p_anchor, ''))) / length(p_anchor);
  if found_count <> 1 then raise exception 'o3e_anchor_changed: % (found %)', p_signature, found_count; end if;
  execute replace(body, p_anchor, p_replacement);
end $$;
revoke all on function private.o3e_patch_function(text, text, text) from public, anon, authenticated, service_role;

-- 1. 주문 단위 막힘: 배송중(일부 발송)도 연다. 발송 전 배송 건에 남은 품목이 하나도 없을 때만 shipment_already_dispatched다.
select private.o3e_patch_function('private.order_partial_cancellation_blockers(uuid)',
$a$  if purchase.status not in ('paid', 'confirmed') or purchase.shipped_at is not null or purchase.delivered_at is not null or purchase.done_at is not null then
    blockers := array_append(blockers, 'order_not_partial_cancelable');
  end if;
  if exists(select 1 from public.order_shipments s where s.order_id = p_order_id
      and (s.status not in ('ready', 'canceled') or s.shipped_at is not null or s.delivered_at is not null)) then
    blockers := array_append(blockers, 'shipment_already_dispatched');
  end if;$a$,
$a$  -- 2026-11-19(원장 #15): 다른 배송 건이 발송된 주문(배송중)도 발송 전 배송 건 몫은 부분 취소한다. 주문 전체가 배송완료·구매확정이면 막는다.
  if purchase.status not in ('paid', 'confirmed', 'shipping') or purchase.delivered_at is not null or purchase.done_at is not null then
    blockers := array_append(blockers, 'order_not_partial_cancelable');
  end if;
  -- 발송된 배송 건이 있고 발송 전(ready) 배송 건에 남은 품목이 없으면 부분 취소할 몫이 없다(발송된 몫은 반품·교환).
  if exists(select 1 from public.order_shipments s where s.order_id = p_order_id
      and (s.status in ('shipping', 'delivered') or s.shipped_at is not null or s.delivered_at is not null))
    and not exists(select 1 from public.order_shipments s where s.order_id = p_order_id and s.status = 'ready'
      and s.shipped_at is null and s.delivered_at is null and s.delivery_method <> 'digital'
      and exists(select 1 from public.order_shipment_items l where l.shipment_id = s.id)) then
    blockers := array_append(blockers, 'shipment_already_dispatched');
  end if;$a$);

-- 2. 품목 단위 막힘: 이미 발송된 배송 건의 품목은 shipment_dispatched(반품·교환으로 처리). 교환 재출고 품목 이력도 재고 복원 단위가 품목 전체다.
select private.o3e_patch_function('private.order_partial_cancellation_item_blocker(uuid)',
$a$  if not found or link.qty <> active then return 'shipment_missing'; end if;$a$,
$a$  if not found or link.qty <> active then return 'shipment_missing'; end if;
  -- 2026-11-19(원장 #15): 다른 배송 건은 발송됐어도 되지만, 이 품목의 배송 건이 이미 나갔으면 부분 취소 대상이 아니다.
  if exists(select 1 from public.order_shipments s where s.id = link.shipment_id
      and (s.status in ('shipping', 'delivered') or s.shipped_at is not null or s.delivered_at is not null)) then
    return 'shipment_dispatched';
  end if;$a$);

select private.o3e_patch_function('private.order_partial_cancellation_item_blocker(uuid)',
$a$    or exists(select 1 from private.group_claim_reshipment_allocations where order_item_id = item.id) then$a$,
$a$    or exists(select 1 from private.group_claim_reshipment_allocations where order_item_id = item.id)
    or exists(select 1 from public.order_claim_reshipment_items where order_item_id = item.id) then$a$);

-- 3. 적용: 주문 전체가 아니라 고른 품목의 배송 건·닫는 배송 건이 발송 전인지 다시 확인한다. 주문 상태는 배송 건 갱신 트리거가
--    닫힌 배송 건을 빼고 다시 센다(남은 배송 건이 모두 배송완료면 배송완료 → 구매확정 정책 포착).
select private.o3e_patch_function('private.apply_order_partial_cancellation(uuid,uuid,text,boolean)',
$a$  if purchase.status not in ('paid', 'confirmed') or purchase.shipped_at is not null or purchase.delivered_at is not null
    or exists(select 1 from public.order_shipments s where s.order_id = head.order_id
      and (s.status not in ('ready', 'canceled') or s.shipped_at is not null or s.delivered_at is not null)) then
    raise check_violation using message = 'partial_cancel_state_changed';
  end if;$a$,
$a$  -- 2026-11-19(원장 #15): 다른 배송 건의 발송은 막지 않는다. 고른 품목의 배송 건과 닫을 배송 건은 모두 발송 전이어야 한다.
  if purchase.status not in ('paid', 'confirmed', 'shipping') or purchase.delivered_at is not null or purchase.done_at is not null
    or exists(select 1 from private.order_partial_cancellation_items l join public.order_shipments s on s.id = l.shipment_id
      where l.partial_cancellation_id = p_id and (s.status <> 'ready' or s.shipped_at is not null or s.delivered_at is not null))
    or exists(select 1 from private.order_partial_cancellation_shipments c join public.order_shipments s on s.id = c.shipment_id
      where c.partial_cancellation_id = p_id and (s.status <> 'ready' or s.shipped_at is not null or s.delivered_at is not null)) then
    raise check_violation using message = 'partial_cancel_state_changed';
  end if;$a$);

-- 4. 결제사 확인을 기다리는 부분 취소가 있는 동안 배송 중 반품·교환 접수를 열지 않는다(고객·대리 접수·반품입고 반입이 같은 판정).
select private.o3e_patch_function('private.order_return_intake_eligible(uuid)',
$a$  select 1 from public.orders o where o.id=p_order_id and o.status='shipping'$a$,
$a$  select 1 from public.orders o where o.id=p_order_id and o.status='shipping' and not private.order_partial_cancel_in_flight(o.id)$a$);

-- 5. 발송 차단의 마지막 방어선. 발송 전 주문은 주문 상태 전이 가드(결제완료·발주확인 → 배송중)가 처리 중 발송을 막았지만, 이미
--    배송중인 주문은 주문 상태가 바뀌지 않아 그 가드를 지나지 않는다. 결제사 확인을 기다리는 동안 그 주문의 발송 전 배송 건이
--    나가지 않게 배송 건 행에서 막는다(이미 나간 배송 건의 배송완료 기록은 막지 않는다). 출고 경로는 이미 assert_order_dispatch_allowed로
--    같은 판정을 하므로 이 트리거는 그 경로를 지나지 않은 쓰기만 잡는다.
create function private.guard_shipment_dispatch_during_partial_cancel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'ready' and (new.status in ('shipping', 'delivered') or new.shipped_at is not null)
    and private.order_partial_cancel_in_flight(new.order_id) then
    raise exception using errcode = '23514', message = 'order cancellation in progress';
  end if;
  return new;
end $$;
revoke all on function private.guard_shipment_dispatch_during_partial_cancel() from public, anon, authenticated, service_role;
create trigger shipment_partial_cancel_dispatch_guard before update of status, shipped_at on public.order_shipments
  for each row execute function private.guard_shipment_dispatch_during_partial_cancel();

-- 재정의한 함수의 등록된 계약을 새 본문·ACL로 다시 적는다(분류는 기존 행 그대로).
do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'private.order_partial_cancellation_blockers(uuid)'::regprocedure,
    'private.order_partial_cancellation_item_blocker(uuid)'::regprocedure,
    'private.apply_order_partial_cancellation(uuid,uuid,text,boolean)'::regprocedure,
    'private.order_return_intake_eligible(uuid)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only); end if;
    if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

drop function private.o3e_patch_function(text, text, text);

commit;
notify pgrst, 'reload schema';
