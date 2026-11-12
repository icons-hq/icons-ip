-- 강제 배송완료의 막는 사유를 주문 상태에 맞춘다(QA 라운드 1 운영 S-T04-05).
--
-- 옮길 배송 건이 없는 주문은 주문 상태가 발주확인·배송중이 아니면 모두 'requires_confirmed'(신규주문은 먼저 발주확인)로 막아,
-- 이미 배송완료·거래확정·취소된 주문에도 '먼저 발주확인해주세요'가 보였다. 끝난 주문(배송완료·거래확정·취소)은
-- 'nothing_to_deliver'(이미 배송완료됐거나 취소된 주문)로 막는다. 결제 대기·신규주문은 그대로 'requires_confirmed'다.
-- 확인창 미리보기와 실행 함수가 같은 순서로 판정한다(실행은 미리보기 뒤 상태가 바뀐 경우의 오류 문구만 달라진다).
-- 20261112130100은 웨이브 1 통합에 있어 고치지 않고 앵커 치환으로 판정 한 줄씩만 바꾼다(각 앵커 정확히 1회).
begin;

do $patch$
declare preview text:=pg_get_functiondef('public.admin_force_order_delivery_preview(text)'::regprocedure);
 execute_def text:=pg_get_functiondef('public.admin_force_order_delivered(text,text,uuid)'::regprocedure);
 preview_anchor constant text:=$a$blockers:=blockers||case when purchase.status not in('confirmed','shipping') then 'requires_confirmed'$a$;
 execute_anchor constant text:=$a$  if purchase.status not in('confirmed','shipping') then raise check_violation using message='forced_delivery_requires_confirmed';end if;$a$;
begin
 if (length(preview)-length(replace(preview,preview_anchor,'')))/length(preview_anchor)<>1 then
  raise exception 'forced_delivery_preview_blocker_anchor_changed';
 end if;
 if (length(execute_def)-length(replace(execute_def,execute_anchor,'')))/length(execute_anchor)<>1 then
  raise exception 'forced_delivery_execute_blocker_anchor_changed';
 end if;
 execute replace(preview,preview_anchor,$r$blockers:=blockers||case when purchase.status in('delivered','done','canceled') then 'nothing_to_deliver'
   when purchase.status not in('confirmed','shipping') then 'requires_confirmed'$r$);
 execute replace(execute_def,execute_anchor,$r$  if purchase.status in('delivered','done','canceled') then raise check_violation using message='forced_delivery_nothing_to_deliver';end if;
  if purchase.status not in('confirmed','shipping') then raise check_violation using message='forced_delivery_requires_confirmed';end if;$r$);
end $patch$;

-- 바꾼 RPC의 계약 지문을 같은 능력·가드로 다시 등록한다(operator_capability_coverage drift 방지).
do $$declare signature text;fn regprocedure;contract record;registered boolean;begin
 foreach signature in array array['public.admin_force_order_delivery_preview(text)','public.admin_force_order_delivered(text,text,uuid)'] loop
  fn:=signature::regprocedure;registered:=false;
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);registered:=true;end if;
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);registered:=true;
  end if;
  if not registered then raise exception 'operational_rpc_contract_missing: %',signature;end if;
 end loop;
end $$;

commit;
notify pgrst,'reload schema';
