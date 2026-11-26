-- 배송비 청구 설정(반품·교환 배송비를 고객에게 따로 청구하는 설정): '정책 근거'와 확인 체크 없이 저장한다(2026-11-25 결정 — 저장 = 적용).
--
-- 저장 함수는 p_values에 '정책 근거'(evidence, 2~1000자)와 확인 체크(confirmed=true)가 있어야 저장했다.
-- 화면에서 그 칸을 걷어 내므로 필수 검사만 없앤다. 누가 언제 무엇으로 바꿨는지는 감사 기록(audit_log)이 그대로 남긴다.
--   - 인자 시그니처는 그대로다. p_values의 evidence·confirmed는 보내지 않아도 되고(null도 된다), 보내는 옛 호출도 전과 같이 저장된다.
--   - 이미 저장된 근거 값은 지우지 않는다. 근거를 보내지 않았거나 빈 값으로 보낸 저장은 저장돼 있던 값을 그대로 둔다.
--   - confirmed는 받기만 하고 쓰지 않는다. 그 밖의 키는 전처럼 거절한다.
--   - 나머지 조건은 그대로다: 로그인·판매 관리 권한(sales.manage) 확인, 금액 형식(1~1,000,000원 정수 또는 비움),
--     켤 때 입금 받을 계좌가 있어야 하는 조건(claim_fee_account_missing), 다른 사람이 먼저 바꿨을 때의 거절(PT409),
--     같은 작업 번호 재시도, 감사 기록.
--   - 청구·입금 확인·면제·취소·반환을 기록하는 함수(admin_change_claim_fee)와 반품배송비 차감은 건드리지 않는다.

create or replace function public.admin_save_claim_fee_policy(p_values jsonb,p_revision bigint,p_operation uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare policy private.claim_fee_policy;prior public.audit_log;request jsonb;result jsonb;k text;begin
 perform private.purchase_confirmation_identity(p_actor,p_session,true);
 if jsonb_typeof(p_values) is distinct from 'object' then raise invalid_parameter_value;end if;
 if p_operation is null or p_revision is null or p_revision<1
  or not private.transaction_json_keys(p_values-array['evidence','confirmed'],array['enabled','returnAmount','exchangeAmount'])
  or jsonb_typeof(p_values->'enabled') is distinct from 'boolean'
  or p_values ? 'evidence' and(jsonb_typeof(p_values->'evidence') not in('string','null') or char_length(btrim(coalesce(p_values->>'evidence','')))>1000
   or coalesce(p_values->>'evidence','')~'[[:cntrl:]]')
  or p_values ? 'confirmed' and jsonb_typeof(p_values->'confirmed') not in('boolean','null') then raise invalid_parameter_value;end if;
 foreach k in array array['returnAmount','exchangeAmount'] loop
  if p_values->k<>'null'::jsonb and (jsonb_typeof(p_values->k)<>'number' or p_values->>k!~'^[1-9][0-9]*$' or (p_values->>k)::numeric>1000000) then raise invalid_parameter_value;end if;
 end loop;
 select * into policy from private.claim_fee_policy where singleton for update;
 request:=jsonb_build_object('values',p_values,'revision',p_revision,'sessionId',p_session);
 select * into prior from public.audit_log where id=p_operation;
 if found then
  if prior.actor_id is distinct from p_actor or prior.action<>'admin.claim_fee.policy' or prior.diff->'request' is distinct from request then raise sqlstate 'PT409';end if;
  return prior.diff->'result';end if;
 if policy.revision<>p_revision then raise sqlstate 'PT409' using message='claim_fee_changed';end if;
 if p_values->'enabled'='true'::jsonb and (private.claim_fee_policy_document()->>'accountReady')::boolean is distinct from true then raise sqlstate 'PT409' using message='claim_fee_account_missing';end if;
 -- 근거를 보내지 않았으면 저장돼 있던 근거를 그대로 둔다.
 update private.claim_fee_policy set revision=revision+1,enabled=(p_values->>'enabled')::boolean,return_amount=(p_values->>'returnAmount')::integer,
  exchange_amount=(p_values->>'exchangeAmount')::integer,evidence=coalesce(nullif(btrim(p_values->>'evidence'),''),policy.evidence),updated_at=clock_timestamp() where singleton;
 result:=private.claim_fee_policy_document();
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation,p_actor,'admin.claim_fee.policy','claim_fee',jsonb_build_object('request',request,'result',result));return result;
end $$;

-- 같은 시그니처를 다시 정의해 실행 권한은 그대로지만, 봉인을 한 번 더 적어 둔다(authenticated만 실행).
revoke all on function public.admin_save_claim_fee_policy(jsonb,bigint,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_claim_fee_policy(jsonb,bigint,uuid,uuid,uuid) to authenticated;

-- 다시 정의한 함수의 본문 지문을 운영자 계약에 재등록한다(권한·구분은 전과 같다).
select private.register_operator_rpc_contract('public.admin_save_claim_fee_policy(jsonb,bigint,uuid,uuid,uuid)'::regprocedure,'sales.manage','write',false);
