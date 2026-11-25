-- 반품 사유 정정(CLM-029)·일괄 환불 확인창의 부분 반품 금액(CLM-136) — 2026-11-25 오픈 전 수정 트랙 T4.
--
-- CLM-029(검증 CONFIRMED, 높음): 반품배송비 차감(운영 켜짐: 단순 변심 편도 3,000원, 최초 무료배송 주문 왕복 6,000원)이 고객이 고른
-- 사유만으로 정해졌다. 사유 정정은 교환만 받아(order_claim_reason_blocker → claim_reason_type_unavailable) 실제 하자·오배송을 고객이
-- '단순 변심'으로 고르면 판매자 부담 반품배송비를 고객이 냈고, 운영자 우회는 거절 후 재신청·교환 전환 꼼수뿐이었다.
--  * 같은 정정 RPC(admin_change_order_claim_reason)가 반품(주문 전체·부분 반품)의 사유도 받는다. 허용 단계·잠금 순서·행 버전·작업 ID
--    멱등·원래 접수일 기준 기한 재검사·고객 협의 근거(2~500자)·이력은 교환과 같다.
--  * 경계는 '환불 접수 전'이다. 환불 접수(입고완료 → 처리중)가 반품배송비 차감을 결정하고(주문 전체 반품: claim_refund_deductions·
--    order_cancellation_claims·refunds, 부분 반품: order_partial_cancellations) 그 금액으로 결제사 부분 취소·계좌 송금이 나간다.
--    ADR-0031 결정 4는 '접수 뒤에는 사유 정정이 막혀 근거가 바뀌지 않는다'를 전제로 금액을 바꾸지 않는다 — 접수 뒤에 사유를 바꾸면
--    결제사 잔액·원장·송금액이 어긋난다(돈은 안전한 쪽). 그래서 접수 단계 칸(처리중 이후)과 위 원장이 있으면 막는다.
--  * 반품배송비 차감 계획은 사유를 읽는 판정 함수(return_fee_deduction_plan·order_partial_return_plan)가 매번 다시 계산하므로, 정정이
--    곧 재계산이다. 정정 이력·감사·영수증에 정정 전후 차감액을 남기고, 고객 알림에 바뀐 차감을 한 문장으로 알린다.
--  * 사유가 바뀌면 기존 트리거(invalidate_claim_fee_basis)가 같은 요청의 배송비 청구를 무효(입금 확인분은 돌려줄 금액)로 돌린다 —
--    이중 청구·차감 판정의 'claim_fee_invoiced'가 정정 뒤 사유로 다시 정해진다.
--  * 정정 사유(내부 고객 협의 근거)는 보호된 정정 이력(private.order_claim_reason_operations, 처리자·전후 사유 포함)에 남고, 일반 감사
--    로그(audit_log, id = 작업 ID)에는 기존 계약대로 복사하지 않는다.
--  * 선물 주문의 정정 알림(교환·반품)은 기존 선물 클레임 알림 규칙(notify_order_claim — 보낸 분·받는 분 모두, 일반 문구·/gifts/ 링크)을
--    따른다. 이전에는 교환 정정이 보낸 분에게만 운영자 설명 원문과 /orders/ 링크로 갔다(고객 이력 읽기의 선물 가림을 알림이 우회했다).
-- CLM-136(검증 ADJUST, 낮음): 일괄 환불 확인창 문맥(order_claim_bulk_context_row)이 부분 반품을 구분하지 않아 남은 결제 금액 전체를
-- 환불액으로 보였다(실제 송금은 고른 몫). 부분 반품이면 접수 뒤에는 부분 환불 원장, 접수 전에는 부분 반품 계산의 환불액·차감액을 싣고,
-- 계산할 수 없거나 이미 접수된 부분 반품은 일괄 환불에서 이유와 함께 뺀다(상세에서 처리).
--
-- 기존 함수는 원래 정의를 바꾸지 않는 범위에서: 정정 RPC 묶음(이 기능만 쓰는 함수)은 전체 재정의, 일괄 문맥은 현재 정의
-- (pg_get_functiondef)에서 앵커만 치환한다(앵커 개수가 다르면 실패). 재정의한 함수의 운영자 계약은 끝에서 다시 등록한다.
begin;

create function private.t4_patch_function(p_function regprocedure, p_anchor text, p_replacement text, p_expected integer default 1)
returns void language plpgsql volatile set search_path = '' as $$
declare body text := pg_catalog.pg_get_functiondef(p_function); found_count integer;
begin
  found_count := (pg_catalog.length(body) - pg_catalog.length(pg_catalog.replace(body, p_anchor, ''))) / pg_catalog.length(p_anchor);
  if found_count <> p_expected then
    raise exception 't4_anchor_changed: % (found %, expected %)', p_function, found_count, p_expected;
  end if;
  execute pg_catalog.replace(body, p_anchor, p_replacement);
end $$;
revoke all on function private.t4_patch_function(regprocedure, text, text, integer) from public, anon, authenticated, service_role;

-- 1. 정정 이력: 요청 유형과 반품배송비 차감 전후(반품만). 이전 이력은 모두 교환 요청의 정정이다(차단 함수가 교환만 받았다).
alter table private.order_claim_reason_operations
  add column claim_type text,
  add column from_return_fee_deduction bigint check (from_return_fee_deduction is null or from_return_fee_deduction >= 0),
  add column to_return_fee_deduction bigint check (to_return_fee_deduction is null or to_return_fee_deduction >= 0);
update private.order_claim_reason_operations set claim_type = 'exchange' where claim_type is null;
alter table private.order_claim_reason_operations
  alter column claim_type set not null,
  add constraint order_claim_reason_operations_claim_type check (claim_type in ('exchange', 'return')),
  add constraint order_claim_reason_operations_return_fee check (
    claim_type = 'return' or (from_return_fee_deduction is null and to_return_fee_deduction is null));

-- 2. 지금 사유로 정한 반품배송비 차감액(환불 접수 전 판정). 반품이 아니면 null, 차감하지 않으면 0.
--    주문 전체 반품은 return_fee_deduction_plan(스위치·켠 시각·결제 수단·배송비 청구·배송 분실 판정 포함), 부분 반품은 부분 반품 계산의
--    반품배송비 차감. 부분 반품 계산이 막히면(결제사·배분 판정) null — 정정은 막지 않고 금액은 환불 접수 때 다시 정해진다.
create function private.claim_reason_return_fee_deduction(p_claim_id uuid) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare claim public.order_cancellation_requests; plan jsonb;
begin
  select * into claim from public.order_cancellation_requests where id = p_claim_id;
  if not found or claim.claim_type <> 'return' then return null; end if;
  if private.claim_is_partial_return(claim.id) then
    begin
      plan := private.order_partial_return_plan(claim.id);
    exception when check_violation or no_data_found then
      return null;
    end;
    return coalesce((plan->>'returnFeeDeduction')::bigint, 0);
  end if;
  plan := private.return_fee_deduction_plan(claim.id);
  return case when plan is not null and (plan->>'applicable')::boolean then (plan->>'deductionAmount')::bigint else 0 end;
end $$;
revoke all on function private.claim_reason_return_fee_deduction(uuid) from public, anon, authenticated, service_role;

-- 3. 차단: 교환과 반품. 반품은 환불 접수가 금액을 정한 뒤(차감 결정·부분 환불 원장)도 금전 시작으로 본다.
create or replace function private.order_claim_reason_blocker(p_claim public.order_cancellation_requests) returns text
language sql stable security definer set search_path = '' as $$
 select case
 when p_claim.claim_type not in('exchange','return') or p_claim.reason_type not in('change_of_mind','defect') then 'claim_reason_type_unavailable'
 when p_claim.stage='on_hold' and p_claim.held_from is null then 'claim_reason_stage_unavailable'
 when (case when p_claim.stage='on_hold' then p_claim.held_from else p_claim.stage end)
  not in('requested','in_review','collecting','collected') then 'claim_reason_stage_unavailable'
 when p_claim.reshipped_at is not null or p_claim.reship_tracking_number is not null
  or exists(select 1 from private.claim_reshipment_items_read(p_claim.id)) then 'claim_reason_reshipped'
 when exists(select 1 from public.order_cancellation_claims where order_id=p_claim.order_id)
  or exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.purpose='order' and p.ref_id=p_claim.order_id)
  or exists(select 1 from public.orders where id=p_claim.order_id and status='canceled')
  -- 반품: 환불 접수가 반품배송비 차감·환불액을 정했다(ADR-0031 결정 4 — 정한 금액은 바뀌지 않는다).
  or exists(select 1 from private.claim_refund_deductions d where d.claim_id=p_claim.id)
  or exists(select 1 from private.order_partial_cancellations h where h.claim_id=p_claim.id) then 'claim_reason_finance_started'
 else null end;
$$;
revoke all on function private.order_claim_reason_blocker(public.order_cancellation_requests) from public, anon, authenticated, service_role;

-- 4. 영수증: 요청 유형과 반품배송비 차감 전후를 싣는다(교환은 null). 같은 작업 ID의 다시 부름은 저장된 값을 그대로 돌려준다.
create or replace function private.order_claim_reason_receipt(p_operation_id uuid,p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'actorId',actor_id,'claimId',claim_id,'orderId',order_id,
  'revision',expected_revision,'resultRevision',result_revision,'fromReasonType',from_reason_type,'fromReason',from_reason,
  'toReasonType',to_reason_type,'toReason',to_reason,'agreement',agreement,'feeReviewed',fee_reviewed,
  'changed',changed,'stage',from_stage,'requestedAt',requested_at,'createdAt',created_at,
  'claimType',claim_type,'fromReturnFeeDeduction',from_return_fee_deduction,'toReturnFeeDeduction',to_return_fee_deduction)
 from private.order_claim_reason_operations where id=p_operation_id and actor_id=p_actor;
$$;
revoke all on function private.order_claim_reason_receipt(uuid,uuid) from public,anon,authenticated,service_role;

-- 5. 운영자 문맥: 반품이면 지금 사유의 반품배송비 차감액·부분 반품 여부·차감 정책·열린 배송비 청구를 싣는다(returnFee, 교환은 null).
create or replace function public.admin_order_claim_reason_context(p_claim_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();claim public.order_cancellation_requests;purchase public.orders;blocker text;original private.order_claim_reason_operations;
 settings private.return_fee_deduction_settings;
begin
 if actor is null or not private.has_operator_capability(actor,'sales.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 select * into claim from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found';end if;
 select * into purchase from public.orders where id=claim.order_id;
 select * into original from private.order_claim_reason_operations where claim_id=claim.id and changed order by created_at,id limit 1;
 select * into settings from private.return_fee_deduction_settings where singleton;
 blocker:=private.order_claim_reason_blocker(claim);
 return jsonb_build_object('actorId',actor,'claimId',claim.id,'orderId',claim.order_id,'claimType',claim.claim_type,
  'stage',claim.stage,'revision',claim.claim_revision,'reasonType',claim.reason_type,'reason',claim.reason,
  'originalReasonType',coalesce(original.from_reason_type,claim.reason_type),'originalReason',coalesce(original.from_reason,claim.reason),
  'requestedAt',claim.requested_at,'deliveredAt',purchase.delivered_at,'allowed',blocker is null,'blocker',blocker,
  'canUseChangeOfMind',not public.order_withdrawal_deadline_passed(purchase.delivered_at,'change_of_mind',claim.requested_at),
  'canUseDefect',not public.order_withdrawal_deadline_passed(purchase.delivered_at,'defect',claim.requested_at),
  'fee',case when claim.operational_fee_amount is null then null else jsonb_build_object('kind',claim.operational_fee_kind,
    'amount',claim.operational_fee_amount,'note',claim.operational_fee_note,'confirmedAt',claim.operational_fee_confirmed_at) end,
  'returnFee',case when claim.claim_type='return' then jsonb_build_object(
    'enabled',coalesce(settings.enabled,false),'oneWayAmount',settings.one_way_amount,
    'partialReturn',private.claim_is_partial_return(claim.id),
    'deductionAmount',case when blocker is null then private.claim_reason_return_fee_deduction(claim.id) end,
    'feeInvoiceOpen',exists(select 1 from private.claim_fee_invoices i where i.claim_id=claim.id and i.state in('unpaid','reported','paid'))) end,
  'history',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'claimId',claim_id,'actorId',actor_id,
   'fromReasonType',from_reason_type,'fromReason',from_reason,'toReasonType',to_reason_type,'toReason',to_reason,
   'requestedAt',requested_at,'createdAt',created_at,'agreement',agreement) order by created_at,id),'[]'::jsonb)
   from private.order_claim_reason_operations where claim_id=claim.id and changed));
end $$;
revoke all on function public.admin_order_claim_reason_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_claim_reason_context(uuid) to authenticated;

-- 6. 정정: 반품이면 정정 전후의 반품배송비 차감액을 다시 계산해 이력·감사·영수증·고객 알림에 남긴다. 그 밖은 교환 정정과 같다.
create or replace function public.admin_change_order_claim_reason(p_claim_id uuid,p_operation_id uuid,p_expected_revision integer,
 p_expected_actor_id uuid,p_reason_type text,p_reason text,p_agreement text,p_confirmed boolean,p_fee_reviewed boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();claim public.order_cancellation_requests;purchase public.orders;previous private.order_claim_reason_operations;
 order_key uuid;buyer uuid;reason_text text:=btrim(p_reason);agreement_text text:=btrim(p_agreement);blocker text;happened timestamptz;
 changed boolean;result_revision integer;fee_before bigint;fee_after bigint;notice text;
begin
 if actor is null or actor is distinct from p_expected_actor_id or not private.has_operator_capability(actor,'sales.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';end if;
 if p_claim_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0
  or p_reason_type is null or p_reason_type not in('change_of_mind','defect') or p_confirmed is distinct from true or p_fee_reviewed is null
  or reason_text is null or char_length(reason_text) not between 1 and 200 or p_reason~'[[:cntrl:]]'
  or agreement_text is null or char_length(agreement_text) not between 2 and 500 or p_agreement~'[[:cntrl:]]' then
  raise invalid_parameter_value using message='invalid_claim_reason_change';end if;
 select c.order_id,o.user_id into order_key,buyer from public.order_cancellation_requests c join public.orders o on o.id=c.order_id where c.id=p_claim_id;
 if order_key is null then raise no_data_found using message='claim_not_found';end if;
 perform private.lock_operator_subjects(array[actor,buyer]);
 perform private.require_actor_operator_capability(actor,'sales.manage',false);
 perform pg_advisory_xact_lock(hashtextextended('claim-reason-change:'||p_operation_id::text,0));
 select * into previous from private.order_claim_reason_operations where id=p_operation_id;
 if found then
  if previous.actor_id<>actor or previous.claim_id<>p_claim_id or previous.expected_revision<>p_expected_revision
   or previous.to_reason_type<>p_reason_type or previous.to_reason<>reason_text or previous.agreement<>agreement_text
   or previous.fee_reviewed<>p_fee_reviewed then raise unique_violation using message='claim_reason_request_conflict';end if;
  return private.order_claim_reason_receipt(p_operation_id,actor);
 end if;
 select * into purchase from public.orders where id=order_key for update;
 perform id from public.order_shipments where order_id=order_key order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
 perform shipment_id from public.order_claim_collections where claim_id=p_claim_id order by shipment_id for update;
 if claim.claim_revision<>p_expected_revision or claim.order_id is distinct from order_key or purchase.user_id is distinct from buyer then
  raise sqlstate 'PT409' using message='claim_changed';end if;
 blocker:=private.order_claim_reason_blocker(claim);
 if blocker is not null then raise check_violation using message=blocker;end if;
 if claim.operational_fee_amount is not null and not p_fee_reviewed then raise check_violation using message='claim_reason_fee_review_required';end if;
 -- The new classification is evaluated at original intake, never the edit time.
 if claim.reason_type<>p_reason_type and public.order_withdrawal_deadline_passed(purchase.delivered_at,p_reason_type,claim.requested_at) then
  raise check_violation using message='claim_reason_original_deadline_expired';end if;
 changed:=(claim.reason_type,claim.reason) is distinct from(p_reason_type,reason_text);
 happened:=clock_timestamp();result_revision:=claim.claim_revision;
 -- 반품배송비 차감은 사유를 읽는 판정이 정한다 — 정정 전 금액을 적고, 바꾼 뒤 같은 판정으로 다시 계산한다(CLM-029).
 if claim.claim_type='return' then fee_before:=private.claim_reason_return_fee_deduction(p_claim_id);end if;
 fee_after:=fee_before;
 if changed then
  update public.order_cancellation_requests set reason_type=p_reason_type,reason=reason_text,updated_at=happened
   where id=p_claim_id returning claim_revision into result_revision;
  if claim.claim_type='return' then fee_after:=private.claim_reason_return_fee_deduction(p_claim_id);end if;
 end if;
 insert into private.order_claim_reason_operations(id,claim_id,order_id,actor_id,expected_revision,result_revision,
  from_reason_type,from_reason,to_reason_type,to_reason,agreement,fee_reviewed,changed,from_stage,requested_at,delivered_at,created_at,
  claim_type,from_return_fee_deduction,to_return_fee_deduction)
 values(p_operation_id,p_claim_id,order_key,actor,p_expected_revision,result_revision,claim.reason_type,claim.reason,
  p_reason_type,reason_text,agreement_text,p_fee_reviewed,changed,claim.stage,claim.requested_at,purchase.delivered_at,happened,
  claim.claim_type,fee_before,fee_after);
 if changed then
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.order.claim_reason_changed','order:'||order_key,
   jsonb_build_object('claimId',p_claim_id,'claimType',claim.claim_type,'fromReasonType',claim.reason_type,'toReasonType',p_reason_type,
    'descriptionChanged',claim.reason<>reason_text,'customerConfirmed',true,'feeReviewed',p_fee_reviewed)
   ||case when claim.claim_type='return' then jsonb_build_object('partialReturn',private.claim_is_partial_return(p_claim_id),
     'fromReturnFeeDeduction',fee_before,'toReturnFeeDeduction',fee_after) else '{}'::jsonb end);
  if exists(select 1 from private.gift_intents g where g.order_id=order_key) then
   -- 선물 주문(교환·반품 모두): 기존 선물 클레임 알림 규칙을 따른다 — 보낸 분·받는 분 모두에게 일반 문구와 /gifts/ 링크만 보낸다
   -- (private.notify_order_claim). 운영자가 쓴 설명 원문은 보내지 않는다 — 고객 이력 읽기도 선물 주문 설명을 일반 분류로 가린다.
   -- 선물 주문은 반품배송비를 자동 차감하지 않아(gift_order) 차감 문장도 없다.
   perform private.notify_order_claim(p_claim_id,'reason_changed',
    case when claim.claim_type='return' then '반품 요청 사유가 정정됐어요' else '교환 요청 사유가 정정됐어요' end,
    case p_reason_type when 'defect' then '상품 하자' else '단순 변심' end);
  else
   notice:=case when claim.claim_type='return' and fee_before is not null and fee_after is not null and fee_before<>fee_after then
     case when fee_after=0 then format(' 반품배송비 %s을 빼지 않고 환불합니다.',private.format_krw(fee_before))
      else format(' 환불 금액에서 반품배송비 %s을 뺍니다.',private.format_krw(fee_after)) end else '' end;
   insert into public.notifications(user_id,type,title,body,link_path,source_type,source_id,dedupe_key)
    values(buyer,'claim_updated',case when claim.claim_type='return' then '반품 요청 사유가 정정됐어요' else '교환 요청 사유가 정정됐어요' end,
     case p_reason_type when 'defect' then '상품 하자·오배송' else '단순 변심' end||': '||reason_text||notice,
     '/orders/'||order_key,'order_claim',p_claim_id::text,'claim:reason_changed:'||p_operation_id)
    on conflict(user_id,dedupe_key) do nothing;
  end if;
 end if;
 return private.order_claim_reason_receipt(p_operation_id,actor);
end $$;
revoke all on function public.admin_change_order_claim_reason(uuid,uuid,integer,uuid,text,text,text,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_change_order_claim_reason(uuid,uuid,integer,uuid,text,text,text,boolean,boolean) to authenticated;

-- 7. 일괄 환불 확인창(CLM-136): 부분 반품의 환불액·차감액. 접수 뒤에는 살아 있는 부분 환불 원장, 접수 전에는 부분 반품 계산(운영 상세의
--    미리보기와 같은 함수). 계산이 막히면 null — 일괄 문맥이 이유와 함께 뺀다.
create function private.claim_bulk_partial_return_refund(p_claim_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare head private.order_partial_cancellations; plan jsonb;
begin
  select * into head from private.order_partial_cancellations h where h.claim_id = p_claim_id and h.state <> 'rejected';
  if found then
    return jsonb_build_object('source', 'ledger', 'refundAmount', head.refund_amount, 'deductionAmount', head.return_fee_deduction);
  end if;
  begin
    plan := private.order_partial_return_plan(p_claim_id);
  exception when check_violation or no_data_found then
    return null;
  end;
  if plan->>'refundAmount' is null then return null; end if;
  return jsonb_build_object('source', 'plan', 'refundAmount', (plan->>'refundAmount')::bigint,
    'deductionAmount', coalesce((plan->>'returnFeeDeduction')::bigint, 0));
end $$;
revoke all on function private.claim_bulk_partial_return_refund(uuid) from public, anon, authenticated, service_role;

select private.t4_patch_function('private.order_claim_bulk_context_row(uuid)'::regprocedure,
 $a$declare c public.order_cancellation_requests;pay record;ref record;virtual_account boolean:=false;complete boolean;blocker text;$a$,
 $a$declare c public.order_cancellation_requests;pay record;ref record;virtual_account boolean:=false;complete boolean;blocker text;
 partial_return boolean:=false;partial_refund jsonb;$a$);
select private.t4_patch_function('private.order_claim_bulk_context_row(uuid)'::regprocedure,
 $a$ complete:=private.claim_collections_complete(c.id);$a$,
 $a$ complete:=private.claim_collections_complete(c.id);
 -- 부분 반품(ADR-0047)의 환불액은 남은 결제 금액이 아니라 고른 상품 몫이다(CLM-136). 단건 [환불 접수]와 같은 계산·원장을 읽는다.
 partial_return:=c.claim_type='return' and private.claim_is_partial_return(c.id);
 if partial_return and pay.id is not null then partial_refund:=private.claim_bulk_partial_return_refund(c.id);end if;$a$);
select private.t4_patch_function('private.order_claim_bulk_context_row(uuid)'::regprocedure,
 $a$  when c.stage in ('processing','needs_review') and ref.status is null then 'refund_ledger_missing'$a$,
 $a$  when partial_return and c.stage in ('processing','needs_review') then 'partial_return_in_progress'
  when partial_return and partial_refund is null then 'partial_return_plan_unavailable'
  when c.stage in ('processing','needs_review') and ref.status is null then 'refund_ledger_missing'$a$);
select private.t4_patch_function('private.order_claim_bulk_context_row(uuid)'::regprocedure,
 $a$coalesce(ref.amount,pay.amount-private.payment_partial_refunded_amount(pay.id)-private.claim_refund_preview_deduction(c.id,pay.id))$a$,
 $a$case when partial_return then (partial_refund->>'refundAmount')::bigint
  else coalesce(ref.amount,pay.amount-private.payment_partial_refunded_amount(pay.id)-private.claim_refund_preview_deduction(c.id,pay.id)) end$a$);
select private.t4_patch_function('private.order_claim_bulk_context_row(uuid)'::regprocedure,
 $a$'refundBlocker',blocker)||private.claim_refund_deduction_field(c.id);$a$,
 $a$'refundBlocker',blocker)||private.claim_refund_deduction_field(c.id)
  ||case when partial_return then jsonb_build_object('partialReturn',true)
   ||case when coalesce((partial_refund->>'deductionAmount')::bigint,0)>0 then jsonb_build_object('refundDeduction',
     jsonb_build_object('source','partial_return','applicable',true,'deductionAmount',(partial_refund->>'deductionAmount')::bigint))
    else '{}'::jsonb end
  else '{}'::jsonb end;$a$);

-- 8. 재정의한 함수의 등록된 계약을 새 본문·ACL로 다시 적는다(분류는 기존 행 그대로).
do $register$
declare fn regprocedure; contract record;
begin
  foreach fn in array array[
    'private.order_claim_reason_blocker(public.order_cancellation_requests)'::regprocedure,
    'private.order_claim_reason_receipt(uuid,uuid)'::regprocedure,
    'public.admin_order_claim_reason_context(uuid)'::regprocedure,
    'public.admin_change_order_claim_reason(uuid,uuid,integer,uuid,text,text,text,boolean,boolean)'::regprocedure,
    'private.order_claim_bulk_context_row(uuid)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then
      perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    end if;
    if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $register$;

drop function private.t4_patch_function(regprocedure, text, text, integer);

commit;
notify pgrst, 'reload schema';
