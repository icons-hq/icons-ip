-- 반품·교환·취소 목록의 단계 일괄 처리(회수 확인·환불 완료 확정·재출고)가 읽는 클레임 사실
-- (1027T-033·SHEET-049·SHEET-052, 2026-11-11 사용자 결정 "회수·환불·재출고 일괄 (Recommended)").
--
-- 결정 원문: "선택 건에 회수 확인·환불 완료 확정(건별 순차 결제 취소)·교환 재출고(행별 택배사·송장) 일괄, 확인창에
-- 건수·환불 합계, 무통장·가상계좌는 제외 사유 표시."
--
-- 이 함수는 읽기만 한다. 처리는 건마다 기존 단건 경로(회수 확인 RPC, 환불 접수·완료 확정 액션 → 결제사 취소
-- 오케스트레이터 → finalizer, 배송 건 재출고 service RPC)를 그대로 탄다. 여기서 정하는 것은 확인창에 보일 사실이다.
-- * refundAmount: [환불 완료 확정]이 결제사에 취소를 발행할 금액(환불 원장 금액, 원장이 아직 없으면 결제 금액).
--   확인창의 환불 합계는 서버가 이 값을 더한 것이고, 실행 직전에 건마다 다시 읽어 확인한 금액과 다르면 처리하지 않는다.
-- * refundBlocker: 일괄 환불 완료 확정에서 뺄 사유 코드(없으면 null). 무통장(계좌 송금 절차)·가상계좌(환불계좌 필요)·
--   코페이(취소 API 없음, drain 전용 수동 확인)·결제 없음·회수 미완료·보류·종결 등. 최종 판정은 처리 RPC·
--   오케스트레이터가 다시 한다.
-- * collections: 출고지(배송 건)별 회수 사실. 회수 생략으로 이미 재출고한 배송 건(waived)과 반송 주소가 없는 배송 건은
--   앱이 일괄 회수 확인 대상에서 뺀다.
-- 운영자(sales.manage)만 부른다. 결제 증빙 원장(private)의 결제수단은 가상계좌 판정에만 쓰고 그대로 내보내지 않는다.
begin;

create function private.order_claim_bulk_context_row(p_claim_id uuid)
returns jsonb language plpgsql stable set search_path='' as $function$
declare c public.order_cancellation_requests;pay record;ref record;virtual_account boolean:=false;complete boolean;blocker text;
begin
 select * into c from public.order_cancellation_requests where id=p_claim_id;
 if not found then return null;end if;
 -- 운영 상세(admin_order_claim_detail)와 같은 결제·환불 행을 고른다.
 select p.id,p.provider::text provider,p.status::text status,p.amount into pay from public.payments p
  where p.purpose='order' and p.ref_id=c.order_id and p.status<>'failed' order by p.created_at desc,p.id desc limit 1;
 select r.status,r.amount,r.method,r.filed_at,r.completed_at into ref from public.refunds r join public.payments p on p.id=r.payment_id
  where p.purpose='order' and p.ref_id=c.order_id order by r.created_at desc,r.id desc limit 1;
 if pay.id is not null then
  virtual_account:=exists(select 1 from public.payment_attempts a join private.payment_provider_evidence e on e.payment_attempt_id=a.id
   where a.purpose='order' and a.ref_id=c.order_id and (e.payment_method='가상계좌' or e.result_code='DONE_virtual_account'));
 end if;
 complete:=private.claim_collections_complete(c.id);
 blocker:=case
  when c.claim_type='exchange' then 'exchange_has_no_refund'
  when c.stage='on_hold' then 'claim_on_hold'
  when c.stage in ('requested','in_review') then 'claim_not_approved'
  when c.stage in ('rejected','withdrawn') then 'claim_closed'
  when c.stage='completed' then case when ref.completed_at is not null then 'refund_completed' else 'refund_record_only' end
  when c.stage='collecting' or (c.stage='collected' and not complete) then 'claim_collections_incomplete'
  when pay.id is null then 'payment_missing'
  when pay.provider='bank_transfer' then 'bank_transfer'
  when pay.provider='korpay' then 'korpay'
  when virtual_account then 'virtual_account'
  when pay.provider not in ('toss','nicepay') then 'provider_unsupported'
  when ref.method='bank_transfer' then 'refund_method_bank_transfer'
  when ref.completed_at is not null then 'refund_completed'
  when c.stage in ('processing','needs_review') and ref.status is null then 'refund_ledger_missing'
  when c.stage not in ('collected','processing','needs_review') then 'claim_not_refundable'
  else null end;
 return jsonb_build_object('claimId',c.id,'reference',c.reference,'orderId',c.order_id,'claimType',c.claim_type,'stage',c.stage,
  'heldFrom',c.held_from,'collectionPolicy',c.collection_policy,'collectionRequired',c.collection_required,'collectionComplete',complete,
  'collectedAt',c.collected_at,'collectionReceivedOn',c.collection_received_on,
  'collections',coalesce((select jsonb_agg(jsonb_build_object('shipmentId',x.shipment_id,'originName',x.origin_name_snapshot,
    'collectedAt',x.collected_at,'receivedOn',x.received_on,
    'waived',exists(select 1 from public.order_claim_reshipments r where r.claim_id=x.claim_id and r.shipment_id=x.shipment_id and r.collection_waived),
    'returnAddressReady',btrim(x.return_address_snapshot)<>'' or exists(select 1 from public.fulfillment_origins o where o.id=x.origin_id and coalesce(btrim(o.return_address),'')<>''))
    order by x.origin_name_snapshot,x.shipment_id) from public.order_claim_collections x where x.claim_id=c.id),'[]'::jsonb),
  'paymentProvider',pay.provider,'paymentStatus',pay.status,
  'refundMethod',ref.method,'refundFiledAt',ref.filed_at,'refundCompletedAt',ref.completed_at,
  'refundAmount',case when pay.id is null then null else coalesce(ref.amount,pay.amount) end,
  'refundBlocker',blocker);
end $function$;

create function public.admin_order_claim_bulk_context(p_claim_ids uuid[])
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;
  if auth.uid() is null then raise insufficient_privilege using message='staff required'; end if;
  if p_claim_ids is null or cardinality(p_claim_ids) not between 1 and 50 or array_position(p_claim_ids,null) is not null then
    raise check_violation using message='invalid_claim_bulk_ids'; end if;
  -- 고른 순서대로, 같은 요청은 한 번만, 없는 요청은 빼고 돌려준다.
  return coalesce((select jsonb_agg(private.order_claim_bulk_context_row(picked.id) order by picked.position)
    from (select distinct on (u.id) u.id,u.position from unnest(p_claim_ids) with ordinality u(id,position) order by u.id,u.position) picked
    where exists(select 1 from public.order_cancellation_requests c where c.id=picked.id)),'[]'::jsonb);
end $function$;

revoke all on function private.order_claim_bulk_context_row(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_order_claim_bulk_context(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_claim_bulk_context(uuid[]) to authenticated;
select private.register_operator_rpc_contract('public.admin_order_claim_bulk_context(uuid[])'::regprocedure,'sales.manage','read',false);

commit;
notify pgrst,'reload schema';
