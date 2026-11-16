-- ============================================================================
-- 예약 일정 일괄 변경 기록에 '조건상 제외' 건수를 남긴다(2026-11-16, 원장 재작업 알려진 후속 5).
--
-- 확정 직후 결과 화면은 '바꾸지 않은 배송 건 N건(조건상 제외 A건 · 선택 해제 B건)'을 미리보기 값으로 보이지만, DB 기록에는
-- 선택 해제(excluded_shipment_ids)만 저장돼 발송관리 지연 탭 이력에서 연 같은 결과는 B건만 보였다(합계가 달랐다).
--
-- 바꾸는 것: 확정 때의 계획(지문을 다시 맞춘 계획)에서 사유별 조건상 제외 건수(excludedCounts)를 condition_excluded_counts로 남기고,
-- 변경 문서가 conditionExcludedCount(합계)·conditionExcludedCounts(사유별)를 싣는다. 이 migration 전 기록은 알 수 없으므로 null로 둔다
-- (화면은 그때처럼 '선택을 해제한 배송 건'만 말한다).
-- 기존 함수는 pg_get_functiondef 앵커 치환으로만 고친다(앵커가 1회가 아니면 migration을 멈춘다). 끝에서 운영자 계약을 다시 등록한다.
-- ============================================================================
begin;

alter table private.goods_preorder_schedule_changes add column condition_excluded_counts jsonb
  check (condition_excluded_counts is null or jsonb_typeof(condition_excluded_counts) = 'object');

create function private.preorder_condition_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 'preorder condition patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

select private.preorder_condition_patch_function('public.admin_apply_goods_preorder_schedule_change(uuid,text,uuid,date,text,text,text,text,uuid[],boolean,text)'::regprocedure, array[
$a$   preview_fingerprint,excluded_shipment_ids,shipment_count,order_count,sms_queued,policy_action,policies,created_at)
   values(p_request_id,good.id,p_variant_id,p_expected_ship_date,btrim(p_reason),actor,notice,digest,p_preview_fingerprint,excluded,
    cardinality(target_ids),order_total,sms,policy_action,policy_record,changed_at);$a$,
$a$   preview_fingerprint,excluded_shipment_ids,shipment_count,order_count,sms_queued,policy_action,policies,created_at,condition_excluded_counts)
   values(p_request_id,good.id,p_variant_id,p_expected_ship_date,btrim(p_reason),actor,notice,digest,p_preview_fingerprint,excluded,
    cardinality(target_ids),order_total,sms,policy_action,policy_record,changed_at,coalesce(plan->'excludedCounts','{}'::jsonb));$a$
]);

select private.preorder_condition_patch_function('private.goods_preorder_schedule_change_document(uuid)'::regprocedure, array[
$a$'excludedCount',cardinality(c.excluded_shipment_ids),$a$,
$a$'excludedCount',cardinality(c.excluded_shipment_ids),
  'conditionExcludedCount',case when c.condition_excluded_counts is null then null
    else (select coalesce(sum(counted.value::integer),0) from jsonb_each_text(c.condition_excluded_counts) counted) end,
  'conditionExcludedCounts',c.condition_excluded_counts,$a$
]);

drop function private.preorder_condition_patch_function(regprocedure, text[]);

do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'public.admin_apply_goods_preorder_schedule_change(uuid,text,uuid,date,text,text,text,text,uuid[],boolean,text)'::regprocedure,
    'private.goods_preorder_schedule_change_document(uuid)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
