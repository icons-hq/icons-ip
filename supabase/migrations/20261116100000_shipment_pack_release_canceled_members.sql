begin;
-- 합포장 구성 배송 건이 취소되면 그 배송 건을 묶음에서 뺀다(2026-11-16, 원장 재작업 알려진 후속 1).
--
-- 전에는 주문 전액 취소(운영자 전액 취소·승인된 고객 취소 요청)가 배송 건을 canceled로 닫아도 묶음 구성원으로 남았다.
-- 같은 묶음의 다른 주문은 단독 출고지시가 shipment_pack_selection_required, 묶음 전체가 shipment_not_ready,
-- 해제가 shipment_pack_release_blocked(canRelease=false)로 막혀 DB 개입 없이는 출고할 수 없었다.
--
-- 규칙: 취소된 배송 건은 실물 상자에 들어갈 수 없으므로 그 구성원만 해제 시각을 남겨 뺀다(이력 보존).
-- 남는 구성원이 2건 이상이면 묶음은 그대로(revision +1 — 앞서 연 조회 버전·해제 요청은 shipment_pack_changed로 거절된다),
-- 1건 이하면 묶음 자체를 해제한다. 출고지시가 이미 나간 묶음도 같다 — 출고지시 뒤 전액 취소는 '창고 출고 중단 확인'을
-- 받은 뒤에만 열리므로(ADR-0018) 창고에 남은 지시는 나머지 구성원의 상자다. 운영자가 고르는 합포장 해제·구성 변경
-- (출고지시 뒤 금지)는 바꾸지 않는다. 재고 부족 부분 취소의 '먼저 합포장 해제'(partial_cancel_shipment_packed, ADR-0032)도 그대로다.
--
-- 잠금: 취소 경로가 이미 잡은 주문 → 배송 건 잠금 뒤에 묶음 행을 잡는다. 묶음 범위 잠금(lock_shipment_pack_scope)도
-- 주문 → 배송 건 → 묶음 순서라 역전이 없고, 같은 묶음의 두 주문이 동시에 취소되면 묶음 행에서 줄 선다.
-- 다른 주문의 배송 건 행은 건드리지 않는다(동시 취소끼리 교착 방지). 앞서 만든 출고 파일은 취소된 배송 건 자신의
-- updated_at 변경으로 shipment_changed가 된다.

create function private.release_shipment_pack_member_on_cancel(p_shipment uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare
  v_pack uuid;
  v_order uuid;
  v_remaining uuid[];
  v_dissolved boolean;
begin
  select m.pack_id into v_pack from private.shipment_pack_members m where m.shipment_id=p_shipment and m.released_at is null;
  if v_pack is null then return false; end if;
  perform 1 from private.shipment_packs where id=v_pack for update;
  -- 잠금을 기다리는 동안 같은 묶음의 다른 취소가 묶음을 풀었을 수 있다.
  update private.shipment_pack_members set released_at=clock_timestamp()
   where pack_id=v_pack and shipment_id=p_shipment and released_at is null;
  if not found then return false; end if;
  select coalesce(array_agg(m.shipment_id order by m.shipment_id),'{}'::uuid[]) into v_remaining
    from private.shipment_pack_members m where m.pack_id=v_pack and m.released_at is null;
  v_dissolved:=cardinality(v_remaining)<2;
  if v_dissolved then
    update private.shipment_pack_members set released_at=clock_timestamp() where pack_id=v_pack and released_at is null;
    update private.shipment_packs set released_at=clock_timestamp(),release_reason='구성 배송 건 취소로 자동 해제',revision=revision+1 where id=v_pack;
  else
    update private.shipment_packs set revision=revision+1 where id=v_pack;
  end if;
  select s.order_id into v_order from public.order_shipments s where s.id=p_shipment;
  insert into public.audit_log(actor_id,action,target,diff) values(null,'system.shipment.pack_member_canceled',v_pack::text,
    jsonb_build_object('packId',v_pack,'shipmentId',p_shipment,'orderId',v_order,'dissolved',v_dissolved,
      'remainingShipmentIds',to_jsonb(v_remaining),'reason','shipment_canceled'));
  return true;
end $$;

create function private.release_canceled_shipment_pack_member() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.release_shipment_pack_member_on_cancel(new.id);
  return null;
end $$;

create trigger order_shipments_release_canceled_pack_member
  after update of status on public.order_shipments
  for each row when (new.status='canceled' and old.status is distinct from new.status)
  execute function private.release_canceled_shipment_pack_member();

-- 이 수정 전에 이미 취소된 구성원이 남은 묶음을 같은 규칙으로 푼다. 다시 불러도 바뀌는 것이 없다.
create function private.release_canceled_shipment_pack_members() returns integer
language plpgsql security definer set search_path='' as $$
declare
  v_shipment uuid;
  v_released integer:=0;
begin
  for v_shipment in
    select m.shipment_id from private.shipment_pack_members m join public.order_shipments s on s.id=m.shipment_id
     where m.released_at is null and s.status='canceled' order by m.shipment_id
  loop
    if private.release_shipment_pack_member_on_cancel(v_shipment) then v_released:=v_released+1; end if;
  end loop;
  return v_released;
end $$;

revoke all on function private.release_shipment_pack_member_on_cancel(uuid) from public, anon, authenticated, service_role;
revoke all on function private.release_canceled_shipment_pack_member() from public, anon, authenticated, service_role;
revoke all on function private.release_canceled_shipment_pack_members() from public, anon, authenticated, service_role;

select private.release_canceled_shipment_pack_members();
commit;
