-- ==========================================================================
-- ICONS · 토스 에스크로 키 분리 뒤처리 · 계좌이체 에스크로 부분 취소 차단 — ADR-0049 결정 6 보강(2026-11-23)
--
-- 1. 에스크로 거래 조회·배송 등록·수정은 부가서비스 API라 결제 시크릿 키(gsk)로 부를 수 없다(토스 'API 키' 문서). 지금까지 작업자가
--    gsk로 불러 거래 조회가 4xx로 거절되면 작업이 운영자 확인(manual_required)으로 굳었다. 앱은 이제 에스크로 키(API 개별 연동 sk)로
--    부르고, 키 거절은 다시 시도로 둔다. 이 migration은 키·인증 거절로 굳은 작업을 다시 대기열로 돌린다(운영 주문 0건이라 보통 0행).
-- 2. 에스크로 키가 없을 때 작업자는 작업을 고르지 않는다(백오프가 쌓이지 않게). 처리할 작업이 남았는지만 세는 서비스 함수를 둔다 —
--    남아 있으면 cron이 실패(toss_escrow_key_missing)로 남겨 시스템 상태·운영 알림에 보인다.
-- 3. 토스 에스크로는 구매확정 전 부분 취소를 거절한다(/guides/v2/escrow '취소와 구매확정 요청'). 가상계좌만 막던 부분 취소·부분 반품·
--    반품배송비 차감 판정에 계좌이체를 더한다 — 계좌이체는 에스크로 선택이 DB에 없으므로, 작업자가 결제 조회로 에스크로가 아님을
--    확인한 결제(작업이 키 없이 건너뜀)만 부분 취소를 연다.
-- 기존 함수는 현재 정의(pg_get_functiondef)에서 앵커만 치환해 다시 실행한다(앵커 개수가 다르면 실패).
-- ==========================================================================

begin;

create function private.escrow_key_patch(p_function regprocedure, p_patches jsonb)
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
      raise exception 'escrow_key_anchor_changed: % (% matches, expected %)', p_function, v_found, v_expected;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;
revoke all on function private.escrow_key_patch(regprocedure, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. 키·인증 거절로 굳은 에스크로 작업을 다시 대기열로
--    (예전 작업자의 확인 코드: 토스 오류 코드 그대로, 본문 코드가 없으면 '{단계}_{상태}' — 401·403)
-- ---------------------------------------------------------------------------
update private.toss_escrow_deliveries
set state = case when delivery_method is not null then 'ready' else 'waiting' end,
    last_error_code = null,
    next_attempt_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp()
where state = 'manual_required'
  and (last_error_code in ('UNAUTHORIZED_KEY', 'INVALID_API_KEY', 'INCORRECT_BASIC_AUTH_FORMAT', 'FORBIDDEN_REQUEST', 'API_KEY_ACCESS_DENIED')
    or last_error_code ~ '^(payment_inquiry|escrow_inquiry|delivery_update|delivery_register)_(401|403)$');

-- ---------------------------------------------------------------------------
-- 2. 에스크로 키가 없을 때 처리할 작업 수(작업을 고르는 규칙과 같다 — service_claim_toss_escrow_jobs)
-- ---------------------------------------------------------------------------
create function public.service_count_toss_escrow_jobs_due()
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select count(*)::integer
  from private.toss_escrow_deliveries as job
  where job.next_attempt_at <= pg_catalog.clock_timestamp()
    and (job.state = 'ready'
      or (job.state in ('registered', 'waiting') and job.escrow_status is distinct from 'CONFIRMED'
        and job.escrow_status is distinct from 'CANCELED'));
$function$;
revoke all on function public.service_count_toss_escrow_jobs_due() from public, anon, authenticated, service_role;
grant execute on function public.service_count_toss_escrow_jobs_due() to service_role;

-- ---------------------------------------------------------------------------
-- 3. 계좌이체 에스크로 부분 취소 차단
-- ---------------------------------------------------------------------------
-- 작업자가 결제 조회의 useEscrow로 에스크로가 아님을 확인한 계좌이체 결제인가(작업이 거래 키 없이 건너뜀 — 거래가 끝나 건너뛴 에스크로
-- 결제는 거래 키가 남는다). 확인 전·작업 없음은 에스크로일 수 있으므로 거짓이다.
create function private.toss_transfer_confirmed_non_escrow(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from private.toss_escrow_deliveries as job
    where job.attempt_id = p_attempt_id and job.state = 'skipped' and job.escrow_key is null);
$function$;
revoke all on function private.toss_transfer_confirmed_non_escrow(uuid) from public, anon, authenticated, service_role;

select private.escrow_key_patch('private.order_partial_cancellation_blockers(uuid)'::regprocedure,
  $p$[["(e.payment_method = '가상계좌' or e.result_code = 'DONE_virtual_account')", "(e.payment_method = '가상계좌' or e.result_code = 'DONE_virtual_account' or (e.payment_method = '계좌이체' and not private.toss_transfer_confirmed_non_escrow(a.id)))"]]$p$::jsonb);
select private.escrow_key_patch('private.order_partial_return_order_blocker(uuid)'::regprocedure,
  $p$[["(e.payment_method = '가상계좌' or e.result_code = 'DONE_virtual_account')", "(e.payment_method = '가상계좌' or e.result_code = 'DONE_virtual_account' or (e.payment_method = '계좌이체' and not private.toss_transfer_confirmed_non_escrow(a.id)))"]]$p$::jsonb);
select private.escrow_key_patch('private.return_fee_deduction_plan(uuid)'::regprocedure,
  $p$[["(e.payment_method = '가상계좌' or e.result_code = 'DONE_virtual_account')", "(e.payment_method = '가상계좌' or e.result_code = 'DONE_virtual_account' or (e.payment_method = '계좌이체' and not private.toss_transfer_confirmed_non_escrow(a.id)))"]]$p$::jsonb);

-- 운영자 계약 재등록(재정의한 함수가 계약에 있으면)
do $register$
declare
  v_function regprocedure;
  v_contract record;
begin
  foreach v_function in array array[
    'private.order_partial_cancellation_blockers(uuid)'::regprocedure,
    'private.order_partial_return_order_blocker(uuid)'::regprocedure,
    'private.return_fee_deduction_plan(uuid)'::regprocedure
  ] loop
    select * into v_contract from private.operator_rpc_contracts as contract
    where contract.signature::regprocedure = v_function;
    if found then
      perform private.register_operator_rpc_contract(
        v_function, v_contract.capability, v_contract.guard_kind, v_contract.legacy_admin_only);
    end if;
    if exists (select 1 from private.operator_internal_contracts as contract where contract.signature::regprocedure = v_function) then
      perform private.register_operator_internal_contract(v_function);
    end if;
  end loop;
end;
$register$;

drop function private.escrow_key_patch(regprocedure, jsonb);

commit;

notify pgrst, 'reload schema';
