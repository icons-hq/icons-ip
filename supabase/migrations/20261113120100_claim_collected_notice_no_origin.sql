-- 클레임 회수 완료 고객 알림 본문에서 '출고지'를 뺀다(1027T-010 "고객 화면 출고지 표기 전부 제거", 웨이브 2 통합).
-- main(20261020085215 operator_capability_guards)의 출고지별 회수 확인과 T11b(20261112213000)의 공용 회수 완료
-- private.complete_order_claim_collection이 같은 문구 '모든 출고지의 입고가 확인되어 후속 처리를 준비합니다.'를 고객 인앱 알림에
-- 싣는다. T11b 뒤로는 공용 함수 하나만 이 문구를 쓴다(출고지 입고 확인·회수 생략 결정·정정이 모두 이 함수를 부른다).
-- 문구만 '반송한 굿즈의 입고가 모두 확인되어 후속 처리를 준비합니다.'로 바꾸고, 효력 있는 회수 생략 분기('반송이 필요한 굿즈가
-- 모두 입고됐어요 …')와 제목·알림 중복 방지 키는 그대로 둔다. 다른 트랙이 같은 함수를 이어 고칠 수 있어 앵커 치환(1회 검사)이다.
begin;

do $do$
declare
 definition text:=pg_get_functiondef('private.complete_order_claim_collection(uuid,text)'::regprocedure);
 anchor text:=$a$'반송한 굿즈가 모두 입고됐어요','모든 출고지의 입고가 확인되어 후속 처리를 준비합니다.'$a$;
 replacement text:=$r$'반송한 굿즈가 모두 입고됐어요','반송한 굿즈의 입고가 모두 확인되어 후속 처리를 준비합니다.'$r$;
begin
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'complete_order_claim_collection notice anchor must appear once';
 end if;
 execute replace(definition,anchor,replacement);
end $do$;
revoke all on function private.complete_order_claim_collection(uuid,text) from public,anon,authenticated,service_role;

-- 이 문구를 고객 알림으로 내보내는 함수가 더 남지 않았는지 확인한다(옛 출고지별 회수 확인은 T11b 뒤 공용 함수를 부른다).
do $$begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('public','private') and p.prosrc like '%모든 출고지의 입고가 확인되어%') then
  raise exception 'claim collected notice still names origins';
 end if;
end $$;

-- 재정의한 함수에 등록된 운영자 계약이 있으면 새 본문·ACL로 다시 적는다(분류는 기존 행 그대로).
do $$declare fn regprocedure:='private.complete_order_claim_collection(uuid,text)'::regprocedure;contract record;begin
 select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
 if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);
 elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
  perform private.register_operator_internal_contract(fn);
 end if;
end $$;

commit;
