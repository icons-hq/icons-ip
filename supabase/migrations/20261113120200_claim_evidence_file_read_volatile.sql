-- 회수 생략 근거 사진 조회 RPC를 VOLATILE로 바꾼다(웨이브 2 통합, #615·20261112200300과 같은 함정).
-- T11a public.admin_claim_evidence_file(uuid)는 STABLE인데 운영자 권한 확인(private.require_operator_capability →
-- private.lock_operator_subjects)이 행 잠금을 건다. PostgREST는 STABLE 함수를 READ ONLY 거래로 불러 운영 화면의 근거 사진
-- 열기가 25006으로 실패한다(cs_reply_read_transaction_mode.sql이 STABLE 운영자 RPC에서 닿는 잠금·쓰기를 잡는다).
-- 본문은 그대로 두고 휘발성만 바꾸며, 휘발성을 담는 운영자 계약 지문을 다시 적는다.
begin;

alter function public.admin_claim_evidence_file(uuid) volatile;

do $$declare fn regprocedure:='public.admin_claim_evidence_file(uuid)'::regprocedure;contract record;begin
 select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
 if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);
 elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
  perform private.register_operator_internal_contract(fn);
 end if;
end $$;

commit;
notify pgrst,'reload schema';
