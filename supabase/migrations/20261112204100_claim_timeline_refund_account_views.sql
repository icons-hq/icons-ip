-- 요청 상세 타임라인에 환불 계좌 열람 기록을 보인다(QA 라운드 1 운영 S-T03-04).
--
-- 무통장 환불 계좌 원문 열람은 요청 상세의 '송금 목적 환불계좌 열람'(목적 prepare_bank_transfer)과 환불 송금 대기 목록 엑셀
-- (목적 list_export, 20261112120200)이 같은 감사 액션 admin.order.bank_refund_account_viewed(대상 주문, diff.claimId)를 남긴다.
-- 요청 상세 타임라인은 액션 이름에 claim·cancellation이 들어간 기록만 읽어 이 열람이 보이지 않았다. 그 요청의 열람 기록만
-- 함께 읽는다. 감사 diff에는 계좌 원문이 없다(요청 id·목적·리비전·엑셀 발급 id) — 타임라인은 열람자·시각·경로(목적)만 보인다.
-- 같은 함수를 웨이브 2 트랙(T11a·T11b·T21a)도 고치므로 원문 복사 대신 타임라인 조건 한 줄만 앵커 치환한다(정확히 1회).
--   앵커: and (entry.action like '%claim%' or entry.action like '%cancellation%')
begin;

do $patch$
declare definition text:=pg_get_functiondef('private.admin_order_claim_detail_before_operational_fee(uuid)'::regprocedure);
 anchor constant text:=$a$and (entry.action like '%claim%' or entry.action like '%cancellation%')$a$;
begin
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'claim_timeline_refund_account_view_anchor_changed';
 end if;
 execute replace(definition,anchor,$r$and (entry.action like '%claim%' or entry.action like '%cancellation%'
          -- 이 요청의 환불 계좌 열람(요청 상세·환불 송금 대기 엑셀). 감사 diff에 계좌 원문은 없다(20261112204100).
          or (entry.action = 'admin.order.bank_refund_account_viewed' and entry.diff->>'claimId' = v_claim.id::text))$r$);
end $patch$;

-- 내부 계약 지문을 다시 등록한다(operator_capability_coverage drift 방지).
select private.register_operator_internal_contract('private.admin_order_claim_detail_before_operational_fee(uuid)'::regprocedure);

commit;
notify pgrst,'reload schema';
