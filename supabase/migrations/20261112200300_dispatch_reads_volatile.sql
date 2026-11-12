-- 원장 재작업 웨이브 1 통합 시험(cs_reply_read_transaction_mode.sql, CI storefront 샤드)에서 드러난 T04 결함.
-- PostgREST는 STABLE·IMMUTABLE로 선언된 RPC를 POST로 불러도 READ ONLY 트랜잭션에서 실행한다. 아래 두 읽기 RPC는 STABLE인데
-- 운영자 권한 가드 private.require_operator_capability(→ private.lock_operator_subjects, 행 잠금)를 거쳐, PostgREST로 부르면
-- 25006(read-only transaction)으로 실패한다 — 발송처리 화면의 [배송 방법]·[택배 외 발송처리] 팝업 자료(S36-072·S36-X04)와
-- 강제 배송완료 대상 확인(1014-083)이 열리지 않는다. 같은 판정을 쓰는 상담 답변 RPC처럼 VOLATILE로 바꿔 읽기·쓰기 트랜잭션에서
-- 가드의 잠금을 잡게 한다. 본문·권한·반환은 그대로이고, 변동성(provolatile) 값이 바뀌므로 운영자 내부 계약 지문을 다시 적는다.
begin;

alter function public.admin_dispatch_delivery_options(uuid[]) volatile;
alter function public.admin_force_order_delivery_preview(text) volatile;

do $contracts$
declare
  signature text;
  fn regprocedure;
  contract record;
begin
  foreach signature in array array[
    'public.admin_dispatch_delivery_options(uuid[])',
    'public.admin_force_order_delivery_preview(text)'
  ] loop
    fn := signature::regprocedure;
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
    if not found then raise exception 'dispatch_reads_volatile_contract_missing: %', signature; end if;
    perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $contracts$;

notify pgrst, 'reload schema';
commit;
