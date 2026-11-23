-- ==========================================================================
-- ICONS · 계좌이체 주문의 에스크로(구매안전서비스) 상태 — 운영자 주문 패널·주문 상세(ADR-0049 2026-11-23 보강의 후속)
--
-- 무통장입금(가상계좌) 주문은 입금 정보 json(private.order_virtual_account_json)에 에스크로 배송 등록 상태가 실린다. 계좌이체 주문은
-- 가상계좌 원장이 없어 같은 작업 원장(private.toss_escrow_deliveries, 20261125090300)에 행이 생겨도 화면에 보이지 않았다.
-- 이 migration은 운영자(sales.read) 읽기 RPC 하나를 더한다 — 가상계좌 원장이 없는 시도의 에스크로 작업만 돌려준다.
--
-- 에스크로 적용 여부(useEscrow): 계좌이체는 구매자 선택을 남기는 곳이 없어 작업자가 결제 조회로 확인한다(useEscrow가 아니면 skipped).
--   escrowKey가 있으면 적용, 키 없이 skipped면 적용 안 함, 그 밖(작업자가 아직 확인 전)은 null(확인 중)이다.
-- ==========================================================================

begin;

create function public.admin_order_transfer_escrow(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  -- 읽기 전용(STABLE) 운영자 RPC — 잠금을 거는 require_operator_capability 대신 판정만 한다(PostgREST READ ONLY 모드).
  if (select auth.uid()) is null or not public.has_operator_capability('sales.read', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_order_id is null then
    raise invalid_parameter_value using message = 'invalid_order';
  end if;
  return (
    select pg_catalog.jsonb_build_object(
      'useEscrow', case when job.escrow_key is not null then true when job.state = 'skipped' then false end,
      'deliveryState', job.state,
      'escrowStatus', job.escrow_status,
      'lastErrorCode', job.last_error_code)
    from private.toss_escrow_deliveries as job
    where job.order_id = p_order_id
      and not exists (select 1 from private.payment_attempt_virtual_accounts as va where va.attempt_id = job.attempt_id));
end;
$function$;
revoke all on function public.admin_order_transfer_escrow(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_order_transfer_escrow(uuid) to authenticated;

select private.register_operator_rpc_contract(
  'public.admin_order_transfer_escrow(uuid)'::regprocedure, 'sales.read', 'read', false);

commit;

notify pgrst, 'reload schema';
