-- 배송정보 템플릿의 수령 방식: 적용 근거와 확인 체크 없이 저장·미리보기·적용한다(2026-11-25 결정 — 저장 = 적용).
--
-- 템플릿이 수령 방식을 함께 바꾸도록 저장하려면 policy에 '수령 설정 적용 근거'(evidence, 2자 이상)와
-- 확인 체크(confirmed=true)가 있어야 했다. 화면에서 그 칸을 걷어 내므로 검증 함수의 두 필수 검사만 없앤다.
-- 상품의 수령 방식 저장(admin_save_goods_fulfillment)은 20261126156000에서 이미 같은 방식으로 풀었다.
--   - 시그니처는 그대로다. 이 검증은 템플릿 저장(v3)·미리보기(v3)·적용(v3)이 private.validate_shipping_settings_charge를 거쳐 부른다.
--     그 함수들의 본문은 바꾸지 않는다.
--   - policy의 evidence·confirmed는 없어도 된다. 있으면 형식만 본다(evidence: 1,000자 이내 글자, confirmed: 참·거짓).
--     이미 저장된 템플릿(두 키가 있는 모양)은 그대로 미리보기·적용된다.
--   - 나머지 검사는 그대로다: 키 이름, 수령 유형, 방식별 금액·단위, 고객 안내 길이, 제어 문자.
--   - 배송비 계산과, 템플릿을 적용했을 때 상품에 저장되는 수령 방식 값은 바뀌지 않는다.
--     적용은 policy를 admin_save_goods_fulfillment에 그대로 넘기고, 근거를 보내지 않으면 상품에 저장돼 있던 근거를 그대로 둔다.

create or replace function private.validate_shipping_settings_fulfillment(p_directive jsonb) returns void language plpgsql immutable set search_path='' as $$
declare p jsonb;m jsonb;begin
 if private.transaction_json_keys(p_directive,array['mode']) and p_directive->>'mode'='preserve' then return;end if;
 if not private.transaction_json_keys(p_directive,array['mode','policy']) or p_directive->>'mode' is distinct from 'replace' then raise invalid_parameter_value using message='invalid_shipping_settings_fulfillment';end if;
 p:=p_directive->'policy';
 -- 객체가 아니면 아래의 키 빼기(-)가 다른 오류를 내므로 먼저 거른다.
 if jsonb_typeof(p) is distinct from 'object' then raise invalid_parameter_value using message='invalid_shipping_settings_fulfillment';end if;
 if not private.transaction_json_keys(p-array['evidence','confirmed'],array['mode','methods','publicNote']) or coalesce(p->>'mode','') not in('shipping','no_delivery')
  or jsonb_typeof(p->'methods') is distinct from 'array' or jsonb_array_length(p->'methods') not between 1 and 5
  or jsonb_typeof(p->'publicNote') is distinct from 'string' or char_length(p->>'publicNote')>1000 or p->>'publicNote'<>btrim(p->>'publicNote')
  or p ? 'evidence' and(jsonb_typeof(p->'evidence') is distinct from 'string' or char_length(p->>'evidence')>1000 or p->>'evidence'<>btrim(p->>'evidence'))
  or p ? 'confirmed' and jsonb_typeof(p->'confirmed') is distinct from 'boolean'
  or ((p->>'publicNote')||coalesce(p->>'evidence',''))~'[[:cntrl:]]' then raise invalid_parameter_value using message='invalid_shipping_settings_fulfillment';end if;
 if (select count(distinct value->>'method') from jsonb_array_elements(p->'methods'))<>jsonb_array_length(p->'methods') then raise invalid_parameter_value;end if;
 for m in select value from jsonb_array_elements(p->'methods') loop
  if not private.transaction_json_keys(m,array['method','feeAmount','feeBasis','installationFee']) or coalesce(m->>'method','') not in('parcel','quick','pickup','direct','freight','none')
   or coalesce(m->>'feeBasis','') not in('per_order','per_item') or not private.transaction_uint(m->'installationFee',0,1000000)
   or (m->>'method'='parcel') is distinct from (m->'feeAmount'='null'::jsonb)
   or m->>'method'<>'parcel' and not private.transaction_uint(m->'feeAmount',0,1000000)
   or m->>'method' in('pickup','none') and (m->'feeAmount'<>'0'::jsonb or m->'installationFee'<>'0'::jsonb)
   or m->>'method'='parcel' and m->>'feeBasis'<>'per_order'
   or p->>'mode'='shipping' and m->>'method'='none' or p->>'mode'='no_delivery' and m->>'method'<>'none'
   then raise invalid_parameter_value using message='invalid_shipping_settings_fulfillment';end if;
 end loop;
end $$;

-- 같은 시그니처를 다시 정의해 실행 권한은 그대로지만, 봉인을 한 번 더 적어 둔다(앱 롤은 직접 부르지 못한다).
revoke all on function private.validate_shipping_settings_fulfillment(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.validate_shipping_settings_fulfillment(jsonb) to postgres;

-- 다시 정의한 함수의 본문 지문을 운영자 내부 계약에 재등록한다.
select private.register_operator_internal_contract('private.validate_shipping_settings_fulfillment(jsonb)'::regprocedure);
