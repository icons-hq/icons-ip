-- QA 라운드 2 수정 묶음 A1(클레임·환불·회수) — 부분 취소된 주문의 클레임 경로와 운영자 전액 취소·유형 전환의 빈틈.
--
-- 1. 반품·교환 상세(admin_order_claim_detail)에 품목별 '적용된 재고 부족 부분 취소 수량'(partialCancels)을 싣는다.
--    상세의 품목 목록은 살아 있는 수량이고 모두 취소된 품목은 빠진다(20261112224600). 앱(lib/admin/claims.server.ts)은 버전 2 주문의
--    원 거래 영수증 줄을 '원 수량 − 이 수량'으로 대조한다 — 지금까지는 원 수량과 그대로 비교해 부분 취소된 주문의 클레임 상세·
--    일괄 환불 확정·일괄 재출고가 모두 막혔다(QA2 B1). 대조를 느슨하게 하지 않는다: 영수증이 실제로 어긋나면 앱이 계속 막는다.
--    수량은 살아 있는 수량과 같은 원장(private.order_item_partial_cancel_totals, 적용된 부분 취소만)에서 읽는다.
-- 2. 운영자 전액 취소: 결제사 확인을 기다리는 부분 취소가 있으면 'order_claim_in_progress'(진행 중인 클레임) 대신 전용 코드
--    'partial_cancel_in_progress'로 거절한다. 실제 클레임이 없는데 클레임을 처리하라는 안내로 운영자가 막다른 길에 섰다(QA2 S-T12b-07).
-- 3. 반품·교환 유형 전환: 이 요청에 저장된 '불량' 선택(planned, QNA-035)을 지운다. 반품이 아니게 되면 쓸모가 없고, 반품으로 다시
--    바뀌면 이전 반품 때 저장한 선택이 기본값으로 되살아났다(QA2 S-T14b-03). 선택은 반품인 동안에만 저장되므로(admin_plan_claim_defective_stock)
--    어느 방향의 전환이든 그 시점의 planned 행은 이전 반품 단계의 것이다. 기록된(recorded) 불량 원장은 건드리지 않는다(불변).
--    지운 건수는 전환 감사(diff.defectivePlanCleared)에 남는다.
-- 앵커 치환만 쓴다. 앵커가 정확히 한 번 나오지 않으면 실패한다. 바꾼 함수의 운영자 계약은 끝에서 다시 등록한다(drift 0).
begin;

create function private.qa2a_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 'qa2a patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 1. 클레임 상세: 품목별 적용된 부분 취소 수량.
select private.qa2a_patch_function('public.admin_order_claim_detail(uuid)'::regprocedure, array[
$a$(select order_number from public.orders where id=(result#>>'{order,id}')::uuid)));$a$,
$a$(select order_number from public.orders where id=(result#>>'{order,id}')::uuid),
      -- 적용된 재고 부족 부분 취소 수량(ADR-0032). 품목 목록(items)은 살아 있는 수량이고 모두 취소된 품목은 빠지므로, 앱은 원 거래
      -- 영수증 줄을 '원 수량 − 이 수량'으로 대조한다. 부분 취소가 없으면 빈 배열이다.
      'partialCancels',coalesce((select jsonb_agg(jsonb_build_object('orderItemId',item.id,'canceledQty',totals.qty) order by item.id)
        from public.order_items item cross join lateral private.order_item_partial_cancel_totals(item.id) totals
        where item.order_id=(result#>>'{order,id}')::uuid and totals.qty>0),'[]'::jsonb)));$a$
]);

-- 2. 운영자 전액 취소: 결제사 확인을 기다리는 부분 취소는 전용 코드로 거절한다.
select private.qa2a_patch_function('public.admin_start_order_cancellation(uuid,text,text,boolean)'::regprocedure, array[
$a$  ) or private.order_partial_cancel_in_flight(p_order_id) then
    raise check_violation using message = 'order_claim_in_progress';
  end if;$a$,
$a$  ) then
    raise check_violation using message = 'order_claim_in_progress';
  end if;
  -- 결제사 확인을 기다리는 재고 부족 부분 취소(ADR-0032). 클레임이 아니라 그 부분 취소의 결제 확인을 먼저 마쳐야 한다.
  if private.order_partial_cancel_in_flight(p_order_id) then
    raise check_violation using message = 'partial_cancel_in_progress';
  end if;$a$
]);

-- 3. 유형 전환: 저장된 불량 선택(planned)을 지우고 건수를 감사에 남긴다.
select private.qa2a_patch_function('public.admin_convert_order_claim_type(uuid,uuid,integer,text,text,boolean,jsonb)'::regprocedure, array[
$a$field text;happened timestamptz;$a$,
$a$field text;happened timestamptz;defective_plans_cleared integer:=0;$a$,
$a$ update public.order_cancellation_requests set claim_type=p_to_type,updated_at=happened where id=p_claim_id;$a$,
$a$ update public.order_cancellation_requests set claim_type=p_to_type,updated_at=happened where id=p_claim_id;
 -- 반품 불량 재고(QNA-035): 이전 반품 단계에 저장한 '불량' 선택은 전환 뒤에 남기지 않는다. 다시 반품이 되면 기본(판매 재고 복원)부터 고른다.
 delete from private.claim_defective_stock where claim_id=p_claim_id and state='planned';
 get diagnostics defective_plans_cleared=row_count;$a$,
$a$'accountSupplied',account_digest is not null));$a$,
$a$'accountSupplied',account_digest is not null,'defectivePlanCleared',defective_plans_cleared));$a$
]);

do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'public.admin_order_claim_detail(uuid)'::regprocedure,
    'public.admin_start_order_cancellation(uuid,text,text,boolean)'::regprocedure,
    'public.admin_convert_order_claim_type(uuid,uuid,integer,text,text,boolean,jsonb)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    else
      raise exception 'qa2a contract missing for %', fn;
    end if;
  end loop;
end $$;

drop function private.qa2a_patch_function(regprocedure, text[]);

commit;
notify pgrst, 'reload schema';
