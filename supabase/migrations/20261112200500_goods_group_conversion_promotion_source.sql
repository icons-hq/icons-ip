-- T08 잔여 위험(1014-109·110 할인 프로모션 묶음 단위 중지). 그룹상품 전환(admin_confirm_goods_group_conversion)은 옵션을 새 상품으로
-- 나눌 때 그 옵션의 기간 할인(진행·예정·초안)을 새 상품 옵션으로 복사하는데, T08이 더한 출처 promotion_id를 넘기지 않아 복사된 할인이
-- '개별로 건 할인'이 됐다. 그러면 프로모션 '중지'(admin_stop_discount_promotion, promotion_id로 찾음)가 전환된 상품의 할인을 끄지 못해
-- 묶음 단위 중지라는 원래 요청과 어긋난다(오케스트레이터 판단, 위임 원칙 ①).
-- 복사할 때 출처를 함께 옮긴다. 출처가 없는 개별 할인은 null 그대로다. 원상품 쪽 원래 행은 전환이 지금처럼 끄고(disabled) 출처는 바꾸지 않는다
-- (goods_price_period_promotion_guard는 UPDATE의 출처 변경만 막으므로 새 행 INSERT에는 걸리지 않는다).
-- 프로모션 상세의 상품 줄(discount_promotion_goods)은 등록 때 대상 기록이라 더하지 않는다 — 전환된 상품의 할인은 요약의 할인 건수와
-- 중지 영수증(상품 수·끈 할인 수)에 잡힌다.
-- 본문은 앵커 치환으로 고치고(각 앵커 정확히 한 번), 운영자 계약 지문을 다시 적는다.
begin;

do $patch$
declare
  target constant regprocedure := 'public.admin_confirm_goods_group_conversion(uuid,uuid,uuid,uuid)'::regprocedure;
  insert_anchor constant text := $a$insert into private.goods_variant_price_periods(good_id,variant_id,state,regular_price,discount_price,starts_at,ends_at,created_by,updated_by)$a$;
  select_anchor constant text := $a$select target_good_id,target_variant_id,state,regular_price,discount_price,starts_at,ends_at,p_expected_actor_id,p_expected_actor_id$a$;
  body text := pg_get_functiondef(target);
begin
  if (length(body) - length(replace(body, insert_anchor, ''))) / length(insert_anchor) <> 1
    or (length(body) - length(replace(body, select_anchor, ''))) / length(select_anchor) <> 1 then
    raise exception 'goods_group_conversion_promotion_anchor_changed';
  end if;
  body := replace(body, insert_anchor, replace(insert_anchor, 'created_by,updated_by)', 'created_by,updated_by,promotion_id)'));
  body := replace(body, select_anchor, select_anchor || ',promotion_id');
  execute body;
end $patch$;

do $contracts$
declare
  fn constant regprocedure := 'public.admin_confirm_goods_group_conversion(uuid,uuid,uuid,uuid)'::regprocedure;
  contract record;
begin
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if not found then raise exception 'goods_group_conversion_contract_missing'; end if;
  perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
end $contracts$;

commit;
