-- 10/27 회의 R7: 판매자 대리 접수의 취소는 단순 변심만 받는다.
--
-- 하자·오배송은 굿즈를 받은 뒤에야 알 수 있으므로 취소(발주확인 전)가 아니라 반품·교환으로 접수한다.
-- 접수 화면(SellerClaimIntakeForm)과 클라이언트 파서(lib/admin/seller-claim-intake.ts)가 같은 규칙을
-- 따르고, 여기서 DB 검증(private.validate_seller_claim_intake)도 같은 규칙으로 막는다.
--
-- 범위
-- - 현재 유효 본문(20261020085236)을 pg_get_functiondef로 떠서 취소 분기 맨 앞에 사유 검사 한 줄만 더한다.
--   앵커가 정확히 한 번 나오지 않으면 실패한다(이후 migration이 같은 자리를 바꿨다면 다시 맞춘다).
-- - 구매자 경로(private.request_order_claim_for_parties)는 재정의하지 않는다. 고객 화면은 원래 취소에
--   단순 변심만 보내고, 고객 취소 API(app/api/orders/[orderId]/cancel)가 defect를 400으로 막는다.
-- - 이미 저장된 요청·접수 기록은 바꾸지 않는다(백필 없음). 목록·상세는 기존 사유를 그대로 표시한다.
begin;

do $patch$
declare definition text; anchor text;
begin
  definition := pg_get_functiondef('private.validate_seller_claim_intake(jsonb,jsonb)'::regprocedure);
  anchor := $old$  if p_payload->>'claimType' = 'cancel' then
    if p_payload->'collectionAddress' is distinct from 'null'::jsonb$old$;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'seller_cancel_reason_anchor_changed';
  end if;
  execute replace(definition, anchor, $new$  if p_payload->>'claimType' = 'cancel' then
    if p_payload->>'reasonType' <> 'change_of_mind' then
      raise invalid_parameter_value using message = 'invalid_seller_cancel_reason';
    end if;
    if p_payload->'collectionAddress' is distinct from 'null'::jsonb$new$);
end $patch$;

revoke all on function private.validate_seller_claim_intake(jsonb,jsonb) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.validate_seller_claim_intake(jsonb,jsonb)'::regprocedure);

commit;
notify pgrst,'reload schema';
