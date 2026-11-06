-- ==========================================================================
-- ICONS · 판매 제한 굿즈 주문의 카드 provider를 나이스페이로 파생하고, 결제 seam을 연다
--
-- 판매 제한 상품(성인/19금)이 하나라도 담긴 굿즈 카드 주문의 provider는 지금까지
-- 'korpay'였다(20260901120000, #392). 2026-11-05 결정으로 이 주문은 나이스페이
-- (NICEPAY 웹표준, 인증 뒤 서버 승인)로 간다. 일반 주문은 그대로 'toss'다.
--
-- 이 migration이 DB 안에서 고정하는 것:
--   1. 파생 강제: prepare가 판매 제한 주문에는 'nicepay'만, 일반 주문에는 'toss'만
--      카드 provider로 받는다. 'korpay'로는 새 결제를 준비하지 않는다(drain 전용 은퇴).
--   2. 콜백·확정·재정합 seam(nonce 바인딩·콜백 claim·finalize·재정합 claim)이
--      'nicepay' attempt를 받는다. 'korpay'는 진행 중 콜백 drain을 위해 남긴다.
--   3. 나이스페이는 토스처럼 취소 API가 있다. 취소 오케스트레이터가 전액 취소를
--      발행하고 조회로 확인하는 경로(승인·취소 요청 경합의 환불 원장, 만료 준비 결제
--      판정, 취소 완료 기록, 운영자 전액 취소, 환불 접수 안내)를 'nicepay'에도 연다.
--   4. 나이스페이 승인 API를 부르기 전에 서버가 거래 ID(TID)를 먼저 남긴다
--      (service_record_nicepay_payment_reference). 웹표준 거래조회는 TID로만 찾을 수
--      있어서다. 기록이 없으면 승인 API를 부르지 않으므로, 재정합은 "TID 기록 없음 =
--      승인 호출 없음"을 근거로 닫을 수 있다(service_get_nicepay_payment_references).
--   5. 매장 분석의 카드 결제 집계에 'nicepay'를 더한다.
--
-- 바꾸지 않는 것:
--   - 티켓 seam. 나이스페이 계약 품목은 판매 제한 굿즈이고 티켓 gate는 닫혀 있다.
--   - 코페이 수동 복구(claim/finalize_goods_manual_payment_recovery). 나이스페이 건은
--     가맹점관리자에서 취소한 뒤 재정합(거래조회 '취소')으로 닫는다.
--   - 토스 정산 대사(pg_settlement_match). 나이스페이 정산 대사는 별도 후속이다.
--
-- 기존 함수는 본문을 통째로 다시 쓰지 않는다. 현재 정의(pg_get_functiondef)에서
-- provider 줄만 앵커 치환해 다시 실행한다. 다른 migration이 같은 함수를 고친 내용이
-- 함께 남고, 앵커 개수가 기대와 다르면 조용히 덮어쓰지 않고 실패한다. create or
-- replace라 실행 권한은 그대로이고, 등록된 운영자 계약은 끝에서 새 본문으로 다시 적는다.
-- ==========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 앵커 치환 helper(이 migration 안에서만 쓰고 끝에서 지운다)
-- p_patches: [[anchor, replacement, expected_count?], ...] — expected_count 기본 1.
-- ---------------------------------------------------------------------------
create function private.nicepay_seam_patch(p_function regprocedure, p_patches jsonb)
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
      raise exception 'nicepay_seam_anchor_changed: % (% matches, expected %)', p_function, v_found, v_expected;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;

revoke all on function private.nicepay_seam_patch(regprocedure, jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. 파생 강제 — prepare
-- ---------------------------------------------------------------------------
select private.nicepay_seam_patch('private.prepare_goods_payment_before_sale_period(uuid,uuid,public.payment_provider)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$    or p_provider not in ('toss', 'korpay', 'bank_transfer')$anchor$,
    $patched$    or p_provider not in ('toss', 'nicepay', 'bank_transfer')$patched$),
  jsonb_build_array(
    $anchor$  -- 전용 PG(korpay), 일반 주문은 toss만 카드 경로다. 무통장(bank_transfer)은$anchor$,
    $patched$  -- 전용 PG(nicepay — 2026-11-05 코페이에서 전환), 일반 주문은 toss만 카드 경로다.
  -- korpay는 진행 중 결제 drain만 남아 새 결제를 준비하지 않는다. 무통장(bank_transfer)은$patched$),
  jsonb_build_array(
    $anchor$      if p_provider <> 'korpay' then$anchor$,
    $patched$      if p_provider <> 'nicepay' then$patched$)));

-- ---------------------------------------------------------------------------
-- 2. 콜백·확정·재정합 seam
-- ---------------------------------------------------------------------------
select private.nicepay_seam_patch('public.bind_goods_payment_callback_nonce(uuid,text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  if not found or v_attempt.provider not in ('toss', 'korpay') then$anchor$,
    $patched$  if not found or v_attempt.provider not in ('toss', 'korpay', 'nicepay') then$patched$)));

select private.nicepay_seam_patch('private.claim_goods_payment_before_sale_period(public.payment_provider,text,text,uuid)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  if p_provider not in ('toss', 'korpay')$anchor$,
    $patched$  if p_provider not in ('toss', 'korpay', 'nicepay')$patched$)));

select private.nicepay_seam_patch('public.finalize_goods_payment_attempt(uuid,uuid,public.payment_attempt_state,text,text,text,text,text,text,timestamp with time zone)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$    and attempt.provider in ('toss', 'korpay', 'bank_transfer')$anchor$,
    $patched$    and attempt.provider in ('toss', 'korpay', 'nicepay', 'bank_transfer')$patched$,
    2),
  -- 승인과 구매자 취소 요청이 겹치면 토스처럼 결제 원장을 남기고 요청을 환불로 잇는다.
  -- 나이스페이는 취소 API가 있어 오케스트레이터가 전액 취소를 발행할 수 있다.
  jsonb_build_array(
    $anchor$      or (v_cancel_requested and (v_attempt.provider <> 'toss' or v_request.claim_type <> 'cancel'))$anchor$,
    $patched$      or (v_cancel_requested and (v_attempt.provider not in ('toss', 'nicepay') or v_request.claim_type <> 'cancel'))$patched$)));

select private.nicepay_seam_patch('public.claim_goods_payment_reconciliation(uuid,uuid,text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$    and attempt.provider in ('toss', 'korpay')$anchor$,
    $patched$    and attempt.provider in ('toss', 'korpay', 'nicepay')$patched$,
    2)));

-- ---------------------------------------------------------------------------
-- 3. 취소 API로 닫는 경로
-- ---------------------------------------------------------------------------
select private.nicepay_seam_patch('public.reconcile_expired_prepared_goods_cancellation(uuid,uuid)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$    and attempt.provider in ('toss', 'korpay')$anchor$,
    $patched$    and attempt.provider in ('toss', 'korpay', 'nicepay')$patched$),
  jsonb_build_array(
    $anchor$  if v_attempt.state='approved' and v_attempt.provider='toss'$anchor$,
    $patched$  if v_attempt.state='approved' and v_attempt.provider in ('toss','nicepay')$patched$)));

select private.nicepay_seam_patch('public.complete_order_cancellation_request(uuid,text[],uuid)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$    and payment.provider = 'toss'$anchor$,
    $patched$    and payment.provider in ('toss', 'nicepay')$patched$)));

-- 오류 어휘 staff_cancellation_toss_only는 앱 계약이라 이름을 그대로 둔다.
select private.nicepay_seam_patch('public.admin_start_order_cancellation(uuid,text,text,boolean)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$        payment.provider <> 'toss'$anchor$,
    $patched$        payment.provider not in ('toss', 'nicepay')$patched$)));

select private.nicepay_seam_patch('public.admin_record_order_claim_refund(uuid,text,text,text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$            and payment.provider = 'toss'$anchor$,
    $patched$            and payment.provider in ('toss', 'nicepay')$patched$)));

-- ---------------------------------------------------------------------------
-- 5. 매장 분석 카드 결제 집계
-- ---------------------------------------------------------------------------
select private.nicepay_seam_patch('private.store_analytics_paid_orders(timestamp with time zone,timestamp with time zone)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$((a.provider in ('toss','korpay') and o.payment_method='card')$anchor$,
    $patched$((a.provider in ('toss','korpay','nicepay') and o.payment_method='card')$patched$)));

drop function private.nicepay_seam_patch(regprocedure, jsonb);

-- ---------------------------------------------------------------------------
-- 4. 나이스페이 거래 ID(TID) 기록·조회 — service role 전용
-- ---------------------------------------------------------------------------

-- 콜백을 claim한(confirming) 나이스페이 attempt에 인증 응답의 TID를 남긴다. 게이트웨이는
-- 이 기록이 성공했을 때만 승인 API를 부른다. 같은 TID 재기록은 아무것도 하지 않고,
-- 다른 TID는 거절한다(콜백 claim은 attempt당 한 번이라 정상 경로에서는 생기지 않는다).
create function public.service_record_nicepay_payment_reference(
  p_attempt_id uuid,
  p_transaction_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_existing text;
begin
  if p_attempt_id is null
    or p_transaction_id is null
    or p_transaction_id !~ '^[A-Za-z0-9]{10,30}$'
  then
    raise invalid_parameter_value using message = 'nicepay_reference_invalid';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.provider = 'nicepay'
    and attempt.purpose = 'order'
  for update;

  if not found then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  if v_attempt.state is distinct from 'confirming'
    or v_attempt.claim_expires_at is null
    or v_attempt.claim_expires_at <= pg_catalog.clock_timestamp()
  then
    raise object_not_in_prerequisite_state using message = 'nicepay_reference_claim_required';
  end if;

  select evidence.provider_transaction_id
  into v_existing
  from private.payment_provider_evidence as evidence
  where evidence.payment_attempt_id = v_attempt.id
    and evidence.evidence_kind = 'nicepay_authenticated'
  order by evidence.recorded_at, evidence.id
  limit 1;

  if found then
    if v_existing is distinct from p_transaction_id then
      raise object_not_in_prerequisite_state using message = 'nicepay_reference_conflict';
    end if;
    return;
  end if;

  insert into private.payment_provider_evidence (
    payment_attempt_id,
    evidence_kind,
    provider_transaction_id
  )
  values (
    v_attempt.id,
    'nicepay_authenticated',
    p_transaction_id
  );
end;
$function$;

comment on function public.service_record_nicepay_payment_reference(uuid, text) is
  '나이스페이 승인 API 호출 전에 콜백을 claim한 attempt의 거래 ID(TID)를 남긴다. 서버 게이트웨이 전용.';

revoke all on function public.service_record_nicepay_payment_reference(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_record_nicepay_payment_reference(uuid, text)
  to service_role;

-- 재정합·조회용. 이 attempt에 남은 TID를 중복 없이 돌려준다(보통 0개 또는 1개).
-- 비어 있으면 승인 API를 부른 적이 없다는 뜻이다.
create function public.service_get_nicepay_payment_references(p_attempt_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_attempt_id is null then
    raise invalid_parameter_value using message = 'nicepay_reference_invalid';
  end if;

  if not exists (
    select 1
    from public.payment_attempts as attempt
    where attempt.id = p_attempt_id
      and attempt.provider = 'nicepay'
      and attempt.purpose = 'order'
  ) then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  return array(
    select distinct reference.transaction_id
    from (
      select pg_catalog.btrim(evidence.provider_transaction_id) as transaction_id
      from private.payment_provider_evidence as evidence
      where evidence.payment_attempt_id = p_attempt_id
        and evidence.provider_transaction_id is not null
      union all
      select pg_catalog.btrim(evidence.provider_payment_key)
      from private.payment_provider_evidence as evidence
      where evidence.payment_attempt_id = p_attempt_id
        and evidence.provider_payment_key is not null
    ) as reference
    where reference.transaction_id ~ '^[A-Za-z0-9]{10,30}$'
    order by reference.transaction_id
  );
end;
$function$;

comment on function public.service_get_nicepay_payment_references(uuid) is
  '나이스페이 attempt에 남은 거래 ID(TID) 목록. 비어 있으면 승인 API를 부른 적이 없다. 서버 게이트웨이 전용.';

revoke all on function public.service_get_nicepay_payment_references(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.service_get_nicepay_payment_references(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 등록된 운영자 계약은 새 본문으로 다시 적는다(없으면 아무것도 하지 않는다).
-- ---------------------------------------------------------------------------
do $register$
declare
  v_function regprocedure;
  v_contract record;
begin
  foreach v_function in array array[
    'private.prepare_goods_payment_before_sale_period(uuid,uuid,public.payment_provider)'::regprocedure,
    'public.bind_goods_payment_callback_nonce(uuid,text)'::regprocedure,
    'private.claim_goods_payment_before_sale_period(public.payment_provider,text,text,uuid)'::regprocedure,
    'public.finalize_goods_payment_attempt(uuid,uuid,public.payment_attempt_state,text,text,text,text,text,text,timestamp with time zone)'::regprocedure,
    'public.claim_goods_payment_reconciliation(uuid,uuid,text)'::regprocedure,
    'public.reconcile_expired_prepared_goods_cancellation(uuid,uuid)'::regprocedure,
    'public.complete_order_cancellation_request(uuid,text[],uuid)'::regprocedure,
    'public.admin_start_order_cancellation(uuid,text,text,boolean)'::regprocedure,
    'public.admin_record_order_claim_refund(uuid,text,text,text)'::regprocedure,
    'private.store_analytics_paid_orders(timestamp with time zone,timestamp with time zone)'::regprocedure
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

notify pgrst, 'reload schema';
