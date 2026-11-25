-- ==========================================================================
-- 엑스스퀘어 · 19금(판매 제한) 상품 주문도 토스페이먼츠로 결제한다 — ADR-0053(2026-11-25)
--
-- 사용자 결정(2026-11-25): "19금 상품은 일단은 전부 토스페이먼츠로 판매 진행한다 토스에서도 딱히 상관없다고 했다".
-- 나이스페이(판매 제한 전용 PG, 20261106100100)는 MID·키가 운영에 없어 19금 상품을 결제할 수단이 없었다.
--
-- 1. 결제 준비(prepare): 판매 제한 상품이 담긴 주문의 카드 provider로 'toss'를 받는다. 'nicepay'도 계속 받는다 — 어느 쪽을
--    쓸지는 앱의 주문 단위 파생(lib/payments/goods-sale-restriction.server.ts RESTRICTED_GOODS_CARD_PROVIDER)이 정하고, 나중에
--    나이스페이로 되돌릴 때 이 함수를 다시 바꾸지 않아도 된다. 일반 주문은 지금처럼 'toss'만, 코페이는 지금처럼 받지 않는다.
-- 2. 결제 확정 직전 재확인(claim): "판매 제한 주문의 토스 결제를 캡처 직전에 막는다"(#392)는 검사를 성인 인증 재확인으로 바꾼다.
--    토스가 19금 주문을 받으므로 결제사로 막을 이유는 없지만, 그 검사는 "prepare 뒤 상품이 19금으로 바뀌면 주문 생성 때 성인 인증을
--    거치지 않은 계정의 결제를 끝내지 않는다"는 효과도 냈다. 그 효과를 결제사와 무관하게 남긴다 — 판매 제한 상품이 담긴 주문은
--    토스 캡처 직전에 결제자의 성인 인증이 유효해야 하고, 아니면 거절한다(attempt는 prepared로 남겨 만료 경로가 재고와 함께
--    정리한다). #392 검사처럼 토스에만 건다 — 나이스페이 캡처는 원래부터 제한 축에 걸리지 않았다(되돌릴 때 그대로 쓴다).
-- 3. 운영자 내부 계약에 등록된 두 함수의 지문을 새 본문으로 다시 적는다(operator_capability_coverage).
-- 성인 인증(ADR-0024)·노출 판정·주문 생성 차단은 결제사와 무관하게 그대로다.
-- 기존 함수는 현재 정의(pg_get_functiondef)에서 앵커만 치환해 다시 실행한다(앵커 개수가 다르면 실패).
-- ==========================================================================

begin;

create function private.adult_toss_patch(p_function regprocedure, p_patches jsonb)
returns void
language plpgsql
volatile
set search_path = ''
as $helper$
declare
  v_definition text := pg_catalog.pg_get_functiondef(p_function);
  v_patch jsonb;
  v_found integer;
  v_expected integer;
begin
  for v_patch in select value from pg_catalog.jsonb_array_elements(p_patches) loop
    v_expected := coalesce((v_patch->>2)::integer, 1);
    v_found := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_patch->>0, '')))
      / pg_catalog.length(v_patch->>0);
    if v_found <> v_expected then
      raise exception 'adult_toss_anchor_changed: % (% matches, expected %)', p_function, v_found, v_expected;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;
revoke all on function private.adult_toss_patch(regprocedure, jsonb) from public, anon, authenticated, service_role;

-- 1. prepare — 판매 제한 주문의 카드 provider로 toss(앱 기본)와 nicepay(전용 PG, 되돌릴 때)를 받는다.
select private.adult_toss_patch('private.prepare_goods_payment_before_sale_period(uuid,uuid,public.payment_provider)'::regprocedure,
  $p$[
    ["  -- 전용 PG(nicepay — 2026-11-05 코페이에서 전환), 일반 주문은 toss만 카드 경로다.",
     "  -- 토스(2026-11-25 ADR-0053) 또는 전용 PG(nicepay — 앱 파생이 고른다), 일반 주문은 toss만 카드 경로다."],
    ["      if p_provider <> 'nicepay' then",
     "      if p_provider not in ('toss', 'nicepay') then"]
  ]$p$::jsonb);

-- 2. claim — 판매 제한 주문의 토스 캡처를 막던 재검증을 지운다.
select private.adult_toss_patch('private.claim_goods_payment_before_sale_period(public.payment_provider,text,text,uuid)'::regprocedure,
  $p$[
    ["  -- 판매 제한 재검증(#392). prepare가 파생한 provider가 지금도 유효한지 캡처\n  -- 직전에 한 번 더 본다. 5번과 같은 파생 위반이므로 에러 어휘도 같다.\n  --\n  -- 거절해도 attempt 상태는 손대지 않는다 — prepared로 남아야 TTL이 지난 뒤\n  -- 만료 경로(reconcile_expired_prepared_goods_cancellation · 주문\n  -- expire_stale_checkouts)가 attempt를 canceled로 닫으면서 재고까지 함께\n  -- 되돌린다. 여기서 attempt를 종결시키면 그 정리 경로가 대상을 잃는다.\n  if v_attempt.provider = 'toss'\n    and exists (\n      select 1\n      from public.order_items as item\n      join public.goods as good on good.id = item.good_id\n      where item.order_id = v_order.id\n        and good.sale_restriction <> 'none'\n    )\n  then\n    raise exception 'goods_payment_provider_mismatch' using errcode = '55000';\n  end if;\n",
     "  -- 판매 제한 주문도 토스로 결제한다(2026-11-25 ADR-0053). 대신 캡처 직전에 결제자의 성인 인증을 다시 본다 — prepare 뒤\n  -- 상품이 19금으로 바뀌면 주문 생성 때 성인 인증을 거치지 않은 계정이 결제를 끝내지 못하게 한다. 거절해도 attempt 상태는\n  -- 손대지 않는다 — prepared로 남아야 만료 경로(reconcile_expired_prepared_goods_cancellation · expire_stale_checkouts)가\n  -- 재고까지 함께 되돌린다.\n  if v_attempt.provider = 'toss'\n    and exists (\n      select 1\n      from public.order_items as item\n      join public.goods as good on good.id = item.good_id\n      where item.order_id = v_order.id\n        and good.sale_restriction <> 'none'\n    )\n    and not private.adult_verification_valid(v_attempt.user_id)\n  then\n    raise exception 'goods_payment_adult_verification_required' using errcode = '55000';\n  end if;\n"]
  ]$p$::jsonb);

drop function private.adult_toss_patch(regprocedure, jsonb);

-- 3. 등록된 운영자 계약은 새 본문으로 다시 적는다(없으면 아무것도 하지 않는다 — 20261106100100과 같은 블록).
do $register$
declare
  v_function regprocedure;
  v_contract record;
begin
  foreach v_function in array array[
    'private.prepare_goods_payment_before_sale_period(uuid,uuid,public.payment_provider)'::regprocedure,
    'private.claim_goods_payment_before_sale_period(public.payment_provider,text,text,uuid)'::regprocedure
  ] loop
    select * into v_contract
    from private.operator_rpc_contracts as contract
    where contract.signature::regprocedure = v_function;
    if found then
      perform private.register_operator_rpc_contract(
        v_function,
        v_contract.capability,
        v_contract.guard_kind,
        v_contract.legacy_admin_only
      );
    end if;
    if exists (
      select 1
      from private.operator_internal_contracts as contract
      where contract.signature::regprocedure = v_function
    ) then
      perform private.register_operator_internal_contract(v_function);
    end if;
  end loop;
end;
$register$;

commit;
