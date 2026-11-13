-- 한 주문에 같은 쿠폰 정의는 1장(T09 잔여 위험, 오케스트레이터 판단 — 위임 원칙 ④ 돈은 더 안전한 쪽).
-- T09(20261112180000)가 user_coupons의 1인 1장 유일 제약을 부분 유일 색인 2개로 바꿔, 매월 등급 혜택 지급으로 한 회원이 같은 쿠폰 정의
-- (coupon_code)를 여러 장 가질 수 있게 됐다. 쿠폰 중복 정책(coupon_combination_policy.stacking_enabled)과 거래 런타임이 켜져 있고 그 정의가
-- '중복 허용'이면 같은 정의 두 장을 한 주문에 함께 골라 할인이 두 번 들어갈 수 있었다. 보유는 여러 장이어도 한 주문에는 1장만 쓴다.
-- 1) 사용 원장 coupon_redemptions에 (order_id, coupon_code) where status='applied' 부분 유일 색인. legacy 주문서·거래 런타임·선물·정기구매
--    어느 경로든 한 주문에 같은 정의가 두 번 적용되지 못한다. 기존 행은 T09 전까지 1인 1장이라 위반이 없고, 취소로 released된 행은 색인 밖이다.
--    legacy 주문서는 원래 쿠폰 한 장(장바구니 쿠폰 선택 또는 바로구매 주문서 쿠폰)만 받으므로 색인이 마지막 방어선이다.
-- 2) 거래 런타임 쿠폰 조합 계산(private.calculate_goods_transaction_combined_locked)은 같은 정의 두 장을 고르면 다른 조합 거절과 같이
--    coupon_unavailable로 막는다 — 결제 직전 유일 색인 오류 대신 견적 단계에서 알린다. 앵커 정확히 한 번, 운영자 내부 계약 재등록.
begin;

create unique index coupon_redemptions_applied_order_definition
  on public.coupon_redemptions (order_id, coupon_code)
  where status = 'applied';

do $patch$
declare
  target constant regprocedure := 'private.calculate_goods_transaction_combined_locked(uuid,jsonb,jsonb,jsonb,uuid[],bigint,timestamp with time zone,jsonb,uuid)'::regprocedure;
  anchor constant text := $a$if not found or (cardinality(p_user_coupon_ids)>1 and not definition.stackable) then return blocked;end if;$a$;
  body text := pg_get_functiondef(target);
begin
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'coupon_one_definition_anchor_changed';
  end if;
  execute replace(body, anchor, anchor || $a$
  -- 한 주문에 같은 쿠폰 정의는 1장이다(매월 등급 혜택으로 같은 정의를 여러 장 가질 수 있다, 20261112200700).
  if exists(select 1 from unnest(p_user_coupon_ids) other_id join public.user_coupons other_held on other_held.id=other_id
   where other_id<>selected and other_held.user_id=p_actor and other_held.coupon_code=held.coupon_code) then return blocked;end if;$a$);
end $patch$;

do $contracts$
declare
  fn constant regprocedure := 'private.calculate_goods_transaction_combined_locked(uuid,jsonb,jsonb,jsonb,uuid[],bigint,timestamp with time zone,jsonb,uuid)'::regprocedure;
begin
  if exists(select 1 from private.operator_internal_contracts c where to_regprocedure(c.signature)=fn) then
    perform private.register_operator_internal_contract(fn);
  end if;
end $contracts$;

commit;
