-- 결제 전 주문 내용 확인·구매 조건 동의 기록(원장 PAY-015, 운영 시나리오 3차 트랙 H).
--
-- 주문서는 결제 버튼 바로 위에서 "주문 상품·수량·결제 금액·배송지를 확인했으며 구매 조건과 결제에 동의"를 받는다(카드·무통장 공통).
-- 동의 값 자체는 서버 액션이 true인지 확인하고(우회 방지), 이 migration은 그 사실을 주문별로 남긴다.
--   1. private.order_purchase_acknowledgements — 주문당 1행(PK = order_id). 동의 시각, 고지 문구 버전,
--      그 시점에 청약철회·교환이 제한된 굿즈의 스냅샷(주문 품목 × 굿즈의 claim_* 칸을 DB가 직접 읽는다 — 화면 값을 믿지 않는다).
--   2. public.record_order_purchase_acknowledgement — service_role 전용 멱등 기록. 주문 RPC 3종(place_order_with_cart_snapshot·
--      place_order_with_cart_selection·place_direct_order)과 거래 RPC는 재정의하지 않는다. 앱 서버가 주문 생성 직후 부른다.
--   3. public.admin_order_purchase_acknowledgement — 운영자 주문 상세에 '결제 전 확인 동의 일시'를 보이는 읽기(sales.read).
--      public.admin_order_detail 은 다른 작업과 겹치므로 건드리지 않고 화면이 따로 읽는다.
-- 보존은 거래기록과 같다(처리방침 표 5년). orders 삭제에 함께 지워지고(on delete cascade) 별도 파기 작업은 만들지 않는다.
begin;

create table private.order_purchase_acknowledgements (
  order_id uuid primary key references public.orders(id) on delete cascade,
  user_id uuid not null,
  acknowledged_at timestamptz not null default now(),
  notice_version text not null check (char_length(notice_version) between 1 and 40),
  restricted_goods jsonb not null default '[]'::jsonb check (jsonb_typeof(restricted_goods) = 'array'),
  -- 고객 화면이 실제로 보인 제한 고지: {"goodIds":[...]} 또는 읽기 실패로 일반 고지만 보인 {"unavailable":true}. 알 수 없으면 null(거래 복구 경로).
  screen_notice jsonb check (screen_notice is null or jsonb_typeof(screen_notice) = 'object')
);
alter table private.order_purchase_acknowledgements enable row level security;
revoke all on private.order_purchase_acknowledgements from public, anon, authenticated, service_role;
comment on table private.order_purchase_acknowledgements is
  '결제 전 주문 내용 확인·구매 조건 동의(PAY-015). 주문당 1행, 보존은 거래기록과 같다. 앱 롤은 함수로만 만난다.';

-- 주문 생성 직후 서버가 부른다. 같은 주문의 재호출은 첫 기록을 그대로 두고 false를 돌려준다(멱등).
-- 제한 굿즈는 주문 품목과 굿즈 행에서 지금 읽어 스냅샷으로 남긴다.
create function public.record_order_purchase_acknowledgement(p_user_id uuid, p_order_id uuid, p_notice_version text, p_screen_notice jsonb default null)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  inserted integer;
begin
  if p_user_id is null or p_order_id is null or p_notice_version is null
     or char_length(p_notice_version) not between 1 and 40 then
    raise exception 'invalid_acknowledgement_request' using errcode = '22023';
  end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id and o.user_id = p_user_id) then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if p_screen_notice is not null and jsonb_typeof(p_screen_notice) <> 'object' then
    raise exception 'invalid_acknowledgement_request' using errcode = '22023';
  end if;
  insert into private.order_purchase_acknowledgements (order_id, user_id, notice_version, restricted_goods, screen_notice)
  values (
    p_order_id, p_user_id, p_notice_version,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'goodId', g.id,
        'name', r.name,
        'returnAllowed', g.claim_return_allowed,
        'exchangeAllowed', g.claim_exchange_allowed,
        'reason', g.claim_restriction_reason
      ) order by g.id)
      from (select i.good_id, min(i.good_name_snapshot) as name from public.order_items i where i.order_id = p_order_id group by i.good_id) r
      join public.goods g on g.id = r.good_id
      where g.claim_return_allowed is false or g.claim_exchange_allowed is false
    ), '[]'::jsonb),
    p_screen_notice
  )
  on conflict (order_id) do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end $$;
revoke all on function public.record_order_purchase_acknowledgement(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_order_purchase_acknowledgement(uuid, uuid, text, jsonb) to service_role;

-- 운영자 주문 상세용 읽기. 기록이 없으면(이 기능 이전 주문·기록 실패) null이다.
create function public.admin_order_purchase_acknowledgement(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  found_row private.order_purchase_acknowledgements%rowtype;
begin
  if not public.has_operator_capability('sales.read', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  select * into found_row from private.order_purchase_acknowledgements a where a.order_id = p_order;
  if not found then return null; end if;
  return jsonb_build_object(
    'orderId', found_row.order_id,
    'acknowledgedAt', found_row.acknowledged_at,
    'noticeVersion', found_row.notice_version,
    'restrictedGoods', found_row.restricted_goods
  );
end $$;
revoke all on function public.admin_order_purchase_acknowledgement(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_order_purchase_acknowledgement(uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_order_purchase_acknowledgement(uuid)'::regprocedure, 'sales.read', 'read', false);
select private.register_operator_internal_contract('public.admin_order_purchase_acknowledgement(uuid)'::regprocedure);

notify pgrst, 'reload schema';
commit;
