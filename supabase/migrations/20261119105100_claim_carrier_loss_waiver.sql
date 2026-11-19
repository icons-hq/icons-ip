-- 배송 분실(택배사 확인)의 회수 없는 반품 환불(ADR-0018 보완 2026-11-19, 원장 #15 SHP-095).
--
-- 원장 원문(SHP-095): 택배 분실 — 분실 전용 흐름 없음. 반품 환불은 회수 완료가 전제, 회수 생략 결정은 교환(하자) 접수에서만,
-- 발송된 주문은 운영자 전액 취소 불가. 재발송은 교환+회수 생략 경로를 빌려야 한다.
-- action: "분실 처리 표준 절차(교환 회수 생략 재발송 / 환불 경로) 확정".
--
-- 결정(가장 작은 안전한 방법 — 새 환불 경로를 만들지 않고 기존 반품 환불의 회수 전제를 배송 건 단위 결정으로 대신한다):
--  * 회수 생략 결정 표(public.order_claim_collection_waivers, ADR-0041 진실원)에 종류(kind)를 더한다. 기존 결정은 'defect'(하자·
--    오배송 교환 회수 생략)이고, 새 'carrier_loss'는 택배사가 분실을 확인한 배송 건의 회수 생략이다. 택배사 사고 번호·메모(사유
--    10~500자)·근거 사진 1~5장이 필요하고 감사 기록에 남는다. 결정은 고칠 수 없다(배송 건마다 한 번).
--  * 배송 분실 결정은 반품 클레임(고객 접수·운영자 대리 접수 모두)에서, 접수 사유와 상관없이(고객이 받지 못한 회사·택배 귀책
--    이므로 — 고객 반품의 기본 사유는 단순 변심이고 반품에는 사유 정정이 없다, 리뷰 P1), 발송된 배송 건(배송중·배송완료)의 아직
--    입고되지 않은 회수에만 기록한다. 효력 있는 분실 결정이 있는 반품에는 반품배송비 차감(ADR-0031)을 판정·결정·미리보기 모두
--    적용하지 않는다(return_fee_deduction_plan). 효력: 반품이면 사유와 상관없이, 교환이면 하자·오배송(판매자 귀책)일 때 — 교환의
--    회수 생략 재출고는 판매자 귀책 교환에서만 정의돼 있다(ADR-0041). 그래서 반품→교환 전환(분실 재발송)은 하자 교환이면 그대로
--    회수를 대신하고, 단순 변심 교환이면 효력을 잃어 수거중으로 돌아간다(교환 사유를 하자로 정정하면 다시 완료).
--  * 회수 완료 판정(claim_collections_complete)·재고 대조·일괄 회수·자동 회수 접수는 지금처럼 claim_collection_waived 하나를 읽는다.
--    효력 판정만 종류별로 넓힌다(private.claim_collection_waiver_effective). 유형·사유 정정으로 효력을 잃으면 기존 되돌림
--    트리거가 입고완료를 수거중으로 되돌리고, 다시 효력을 얻으면 회수 완료를 다시 적는다.
--  * 교환 회수 생략은 실제 입고가 하나도 없으면 재출고로 끝나지만, 반품은 환불이 회수 완료(입고완료)를 기다리므로 배송 분실
--    결정이 있으면 입고 없이도 회수 완료가 된다. 회수 완료일(환급 기한 기산일)은 입고일과 분실 결정일 가운데 늦은 날이다.
--  * 분실 품목은 실물이 없으므로 환불 확정 때 판매 재고로 되돌리지 않는다(늦게 도착해 입고를 확인해도 같다 — 교환 회수 생략과
--    같은 규칙, 다시 팔 수 있으면 재고 조정에서 반영). 되돌리지 않은 사실은 감사 기록(order.option_stock_lost_in_transit)에 남는다.
--  * 근거 사진은 교환과 같은 비공개 원장(claim_evidence_files)에 반품도 올릴 수 있게 연다.
--  * 진입점 public.admin_record_order_claim_carrier_loss(클레임, 배송 건, {reason, evidenceFileIds, accidentNumber}, 기대 리비전,
--    작업 id): sales.manage, 같은 작업 id 재전송은 같은 결과, 클레임 리비전이 바뀌었으면 거절한다.
--  * 분실 재발송(새 물건을 다시 보내기)은 새 경로를 만들지 않고 기존 교환(하자) + 회수 생략 재출고를 쓴다(런북 order-claim-intake).
begin;

create function private.o3e_patch_function(p_signature text, p_anchor text, p_replacement text)
returns void language plpgsql volatile set search_path = '' as $$
declare body text; found_count integer;
begin
  body := pg_get_functiondef(p_signature::regprocedure);
  found_count := (length(body) - length(replace(body, p_anchor, ''))) / length(p_anchor);
  if found_count <> 1 then raise exception 'o3e_anchor_changed: % (found %)', p_signature, found_count; end if;
  execute replace(body, p_anchor, p_replacement);
end $$;
revoke all on function private.o3e_patch_function(text, text, text) from public, anon, authenticated, service_role;

-- 1. 결정 표: 종류·택배사 사고 번호·작업 id. 기존 행은 모두 하자·오배송 교환 회수 생략('defect')이다.
alter table public.order_claim_collection_waivers
  add column kind text not null default 'defect',
  add column carrier_accident_number text,
  add column operation_id uuid,
  add constraint order_claim_collection_waivers_kind_check check (kind in ('defect', 'carrier_loss')),
  add constraint order_claim_collection_waivers_carrier_loss_shape check (
    (kind = 'carrier_loss') = (carrier_accident_number is not null and operation_id is not null)
    and (carrier_accident_number is null or (carrier_accident_number = btrim(carrier_accident_number)
      and char_length(carrier_accident_number) between 2 and 60 and carrier_accident_number !~ '[[:cntrl:]]')));
create unique index order_claim_collection_waivers_operation on public.order_claim_collection_waivers(operation_id) where operation_id is not null;

-- 2. 효력: 하자 결정은 하자·오배송 교환인 동안만, 배송 분실 결정은 반품(사유 무관)·하자·오배송 교환인 동안 회수를 대신한다.
create function private.claim_collection_waiver_effective(p_kind text, p_claim_type text, p_reason_type text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'defect' then p_claim_type = 'exchange' and p_reason_type = 'defect'
    when 'carrier_loss' then p_claim_type = 'return' or (p_claim_type = 'exchange' and p_reason_type = 'defect')
    else false end;
$$;
revoke all on function private.claim_collection_waiver_effective(text, text, text) from public, anon, authenticated, service_role;

select private.o3e_patch_function('private.claim_collection_waived(uuid,uuid)',
$a$and c.claim_type='exchange' and c.reason_type='defect');$a$,
$a$and private.claim_collection_waiver_effective(w.kind,c.claim_type,c.reason_type));$a$);

-- 효력 있는 배송 분실 결정이 있는 클레임(입고 없이 회수 완료가 되는 반품).
create function private.claim_has_effective_carrier_loss(p_claim uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists(select 1 from public.order_claim_collection_waivers w
    where w.claim_id = p_claim and w.kind = 'carrier_loss' and private.claim_collection_waived(w.claim_id, w.shipment_id));
$$;
revoke all on function private.claim_has_effective_carrier_loss(uuid) from public, anon, authenticated, service_role;

-- 반품 환불로 닫히는 주문의 품목 가운데 배송 분실로 회수를 생략한 배송 건의 품목(실물이 없어 판매 재고로 되돌리지 않는다).
create function private.order_item_lost_in_transit(p_order_item_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists(select 1 from public.order_claim_collection_waivers w
    join public.order_cancellation_requests c on c.id = w.claim_id
    join public.order_claim_collections x on x.claim_id = w.claim_id and x.shipment_id = w.shipment_id
    where w.kind = 'carrier_loss' and c.claim_type = 'return' and c.stage not in ('rejected', 'withdrawn')
      and private.claim_collection_waived(w.claim_id, w.shipment_id)
      and exists(select 1 from jsonb_array_elements(x.items_snapshot) j where (j->>'orderItemId')::uuid = p_order_item_id));
$$;
revoke all on function private.order_item_lost_in_transit(uuid) from public, anon, authenticated, service_role;

-- 3. 효력을 잃는 정정(유형·사유)이면 그 결정의 입고되지 않은 배송 건 때문에 입고완료를 수거중으로 되돌린다(종류별 효력 판정).
select private.o3e_patch_function('private.reopen_ineffective_collection_waivers()',
$a$ if old.claim_type='exchange' and old.reason_type='defect' and not(new.claim_type='exchange' and new.reason_type='defect')
  and(new.stage='collected' or new.stage='on_hold' and new.held_from='collected') then
  select array_agg(x.shipment_id order by x.shipment_id) into pending
  from public.order_claim_collection_waivers w join public.order_claim_collections x on x.claim_id=w.claim_id and x.shipment_id=w.shipment_id
  where w.claim_id=new.id and x.collected_at is null;$a$,
$a$ if (old.claim_type,old.reason_type) is distinct from (new.claim_type,new.reason_type)
  and(new.stage='collected' or new.stage='on_hold' and new.held_from='collected') then
  -- 2026-11-19: 결정 종류마다 효력이 다르다(하자 = 하자 교환, 배송 분실 = 반품(사유 무관)·하자 교환). 효력을 잃는 결정만 센다.
  select array_agg(x.shipment_id order by x.shipment_id) into pending
  from public.order_claim_collection_waivers w join public.order_claim_collections x on x.claim_id=w.claim_id and x.shipment_id=w.shipment_id
  where w.claim_id=new.id and x.collected_at is null
   and private.claim_collection_waiver_effective(w.kind,old.claim_type,old.reason_type)
   and not private.claim_collection_waiver_effective(w.kind,new.claim_type,new.reason_type);$a$);

-- 다시 효력을 얻는 정정(교환→반품 되돌림 포함)도 회수 완료를 다시 적는다. 완료 함수가 모든 조건을 다시 본다.
drop trigger sync_claim_collection_completion on public.order_cancellation_requests;
create trigger sync_claim_collection_completion after update of claim_type,reason_type on public.order_cancellation_requests
 for each row when((new.claim_type='exchange' and new.reason_type='defect' or new.claim_type='return') and new.collected_at is null
  and(old.claim_type is distinct from new.claim_type or old.reason_type is distinct from new.reason_type))
 execute function private.sync_claim_collection_completion();

-- 4. 회수 완료: 배송 분실 결정이 있으면 실제 입고가 없어도 끝난다(반품은 환불이 회수 완료를 기다린다). 알림 문구도 반품에 맞춘다.
select private.o3e_patch_function('private.complete_order_claim_collection(uuid,text)',
$a$  or not exists(select 1 from public.order_claim_collections x where x.claim_id=p_claim_id and x.collected_at is not null)$a$,
$a$  or not exists(select 1 from public.order_claim_collections x where x.claim_id=p_claim_id and x.collected_at is not null)
   -- 배송 분실(택배사 확인, 2026-11-19)로 회수를 생략한 배송 건은 입고 없이도 회수가 끝난 것이다.
   and not private.claim_has_effective_carrier_loss(p_claim_id)$a$);

select private.o3e_patch_function('private.complete_order_claim_collection(uuid,text)',
$a$if exists(select 1 from public.order_claim_collections x
   where x.claim_id=p_claim_id and x.collected_at is null and private.claim_collection_waived(x.claim_id,x.shipment_id)) then$a$,
$a$if claim.claim_type='return' and private.claim_has_effective_carrier_loss(p_claim_id) then
  -- 배송 분실 반품은 "다시 보내드려요"가 아니라 회수 없이 환불을 준비한다고 알린다.
  perform private.notify_order_claim(p_claim_id,completion_event,'반품 확인이 끝났어요',
   case when exists(select 1 from public.order_claim_collections x where x.claim_id=p_claim_id and x.collected_at is not null)
    then '반송한 굿즈의 입고와 배송 중 분실 확인이 모두 끝나 환불을 준비합니다. 분실된 굿즈는 반송하지 않아도 됩니다.'
    else '배송 중 분실이 확인되어 굿즈 회수 없이 환불을 준비합니다.' end);
 elsif exists(select 1 from public.order_claim_collections x
   where x.claim_id=p_claim_id and x.collected_at is null and private.claim_collection_waived(x.claim_id,x.shipment_id)) then$a$);

-- 회수 완료일(환급 기한 기산일): 입고일과 배송 분실 결정일 가운데 늦은 날.
select private.o3e_patch_function('private.claim_collection_received_on(uuid)',
$a$ select max(coalesce(x.received_on,(x.collected_at at time zone 'Asia/Seoul')::date))
 from public.order_claim_collections x where x.claim_id=p_claim and x.collected_at is not null;$a$,
$a$ select max(d) from (
  select coalesce(x.received_on,(x.collected_at at time zone 'Asia/Seoul')::date) d
  from public.order_claim_collections x where x.claim_id=p_claim and x.collected_at is not null
  union all
  -- 배송 분실(택배사 확인)로 회수를 생략한 배송 건은 결정한 날이 그 배송 건의 회수가 끝난 날이다(2026-11-19).
  select (w.waived_at at time zone 'Asia/Seoul')::date from public.order_claim_collection_waivers w
  where w.claim_id=p_claim and w.kind='carrier_loss' and private.claim_collection_waived(w.claim_id,w.shipment_id)) s;$a$);

-- 5. 재고: 배송 분실 품목은 환불 확정 때 판매 재고로 되돌리지 않는다(실물이 없다). 사실은 감사 기록에 한 번 남긴다.
select private.o3e_patch_function('private.restore_order_item_supply(uuid,text)',
$a$ affected:=target.hop_count>0 or physical.good_id<>item.good_id or exists(select 1 from private.group_claim_reshipment_allocations where order_item_id=item.id);$a$,
$a$ -- 배송 분실(택배사 확인, 2026-11-19): 회수 없이 환불한 배송 건의 품목은 실물이 없어 되돌리지 않는다. 늦게 도착해 입고를
 -- 확인해도 같다(교환 회수 생략과 같은 규칙 — 다시 팔 수 있으면 재고 조정에서 반영).
 if private.order_item_lost_in_transit(item.id) then
  if item.supply_source='preorder' then
   update private.goods_preorder_reservations set state='returned',released_at=clock_timestamp(),released_by=auth.uid(),release_reason=reason_value where order_item_id=item.id;
  end if;
  if not exists(select 1 from public.audit_log a where a.target='order:'||item.order_id::text and a.action='order.option_stock_lost_in_transit'
    and a.diff->>'orderItemId'=item.id::text) then
   insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'order.option_stock_lost_in_transit','order:'||item.order_id::text,
    jsonb_build_object('orderItemId',item.id,'goodId',item.good_id,'variantId',item.variant_id,'qty',item.qty,'supplySource',item.supply_source,'reason',p_reason));
  end if;
  return;
 end if;
 affected:=target.hop_count>0 or physical.good_id<>item.good_id or exists(select 1 from private.group_claim_reshipment_allocations where order_item_id=item.id);$a$);

-- 5-2. 반품배송비 차감(ADR-0031): 효력 있는 배송 분실 결정이 있는 반품은 회사·택배 귀책이라 차감하지 않는다. 판정 하나가 결정 기록
--      (record_return_fee_deduction)·미리보기(claim_refund_deduction_view)를 모두 받치므로 여기서 차감 대상이 아니라고 돌려준다.
--      앵커는 켠 시각 판정(20261119101000)이 고친 줄이 아니라 그 다음 줄이다.
select private.o3e_patch_function('private.return_fee_deduction_plan(uuid)',
$a$  select * into purchase from public.orders where id = claim.order_id;$a$,
$a$  if private.claim_has_effective_carrier_loss(claim.id) then return null; end if;
  select * into purchase from public.orders where id = claim.order_id;$a$);

-- 6. 근거 사진: 반품도 올린다(배송 분실 근거). 경로·형식·한도는 같다.
select private.o3e_patch_function('public.admin_register_claim_evidence_file(uuid,uuid,text,integer,text)',
$a$ if claim.claim_type<>'exchange' then raise check_violation using message='claim_evidence_unavailable';end if;$a$,
$a$ if claim.claim_type not in('exchange','return') then raise check_violation using message='claim_evidence_unavailable';end if;$a$);

-- 7. 읽기: 운영 상세는 배송 건마다 분실 기록(사고 번호·메모·사진·처리자)과 발송 여부를, 클레임은 리비전을 싣는다. 고객 회수 문서는
--    분실 배송 건임을 알린다(교환의 "다시 보내드려요" 문구를 반품에 쓰지 않게).
select private.o3e_patch_function('private.claim_collection_records(uuid)',
$a$  'collectionWaived',private.claim_collection_waived(x.claim_id,x.shipment_id),$a$,
$a$  'collectionWaived',private.claim_collection_waived(x.claim_id,x.shipment_id),
  'shipmentDispatched',exists(select 1 from public.order_shipments s where s.id=x.shipment_id and s.status in('shipping','delivered')
   and (s.shipped_at is not null or s.delivered_at is not null)),
  'carrierLoss',(select jsonb_build_object('accidentNumber',w.carrier_accident_number,'reason',w.reason,'evidenceFileIds',to_jsonb(w.evidence_file_ids),
   'recordedAt',w.waived_at,'recordedByName',(select nickname from public.profiles where id=w.waived_by))
   from public.order_claim_collection_waivers w where w.claim_id=x.claim_id and w.shipment_id=x.shipment_id and w.kind='carrier_loss'
    -- 효력을 잃은 분실 기록(단순 변심 교환으로 전환 등)은 '배송 분실·회수 없이 환불'로 보이지 않는다(리뷰 P2).
    and private.claim_collection_waived(w.claim_id,w.shipment_id)),$a$);

select private.o3e_patch_function('private.claim_collection_document(uuid)',
$a$then jsonb_build_object('collectionWaived',true) else '{}'::jsonb end order by s.id)$a$,
$a$then jsonb_build_object('collectionWaived',true)
   ||case when exists(select 1 from public.order_claim_collection_waivers w where w.claim_id=c.id and w.shipment_id=s.id and w.kind='carrier_loss')
    then jsonb_build_object('carrierLoss',true) else '{}'::jsonb end else '{}'::jsonb end order by s.id)$a$);

select private.o3e_patch_function('public.admin_order_claim_detail(uuid)',
$a$      (select c.collection_received_on from public.order_cancellation_requests c where c.id=p_claim_id)));$a$,
$a$      (select c.collection_received_on from public.order_cancellation_requests c where c.id=p_claim_id),
      -- 배송 분실 기록(2026-11-19)의 동시성 가드가 쓰는 클레임 리비전.
      'claimRevision',(select c.claim_revision from public.order_cancellation_requests c where c.id=p_claim_id)));$a$);

-- 8. 진입점: 배송 분실 기록(반품, 배송 건 단위).
create function public.admin_record_order_claim_carrier_loss(p_claim_id uuid, p_shipment_id uuid, p_loss jsonb, p_expected_revision integer, p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); order_key uuid; buyer uuid; order_state public.order_status; claim public.order_cancellation_requests;
  decision public.order_claim_collection_waivers; ship public.order_shipments; collection public.order_claim_collections;
  reason text; evidence uuid[]; accident text; at_value timestamptz := clock_timestamp();
begin
  perform private.require_operator_capability('sales.manage', false);
  if actor is null then raise insufficient_privilege using message = 'staff required'; end if;
  if p_claim_id is null or p_shipment_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise invalid_parameter_value using message = 'invalid_carrier_loss';
  end if;
  if jsonb_typeof(p_loss) is distinct from 'object' or not (p_loss ?& array['reason', 'evidenceFileIds', 'accidentNumber'])
    or (select count(*) from jsonb_object_keys(p_loss)) <> 3 or jsonb_typeof(p_loss->'accidentNumber') is distinct from 'string' then
    raise check_violation using message = 'invalid_carrier_loss';
  end if;
  -- 사유(메모)·근거 사진은 교환 회수 생략과 같은 검사다.
  select v.reason, v.evidence into reason, evidence from private.claim_collection_waiver_values(p_loss - 'accidentNumber') v;
  accident := p_loss->>'accidentNumber';
  if accident <> btrim(accident) or char_length(accident) not between 2 and 60 or accident ~ '[[:cntrl:]]' then
    raise check_violation using message = 'invalid_carrier_accident_number';
  end if;
  select c.order_id, o.user_id into order_key, buyer from public.order_cancellation_requests c join public.orders o on o.id = c.order_id where c.id = p_claim_id;
  if order_key is null then raise no_data_found using message = 'claim_not_found'; end if;
  -- 계정 울타리 → 주문 → 배송 건 → 클레임 순으로 잠근다(보류·전환·회수 확인과 같은 순서).
  perform private.lock_operator_subjects(array[actor, buyer]);
  perform private.require_actor_operator_capability(actor, 'sales.manage', false);
  select status into order_state from public.orders where id = order_key for update;
  perform 1 from public.order_shipments where order_id = order_key order by id for update;
  select * into claim from public.order_cancellation_requests where id = p_claim_id for update;
  select * into decision from public.order_claim_collection_waivers where claim_id = p_claim_id and shipment_id = p_shipment_id;
  if found then
    -- 같은 작업의 재전송만 같은 결과다. 다른 결정(하자 회수 생략·다른 사고 번호)이 이미 있으면 거절한다.
    if decision.kind = 'carrier_loss' and decision.operation_id = p_operation_id and decision.reason = reason
      and decision.evidence_file_ids = evidence and decision.carrier_accident_number = accident then
      return jsonb_build_object('claimId', p_claim_id, 'shipmentId', p_shipment_id, 'recordedAt', decision.waived_at, 'replayed', true,
        'collectionComplete', private.claim_collections_complete(p_claim_id), 'claimRevision', claim.claim_revision);
    end if;
    raise unique_violation using message = 'collection_waiver_conflict';
  end if;
  if exists(select 1 from public.order_claim_collection_waivers where operation_id = p_operation_id) then
    raise unique_violation using message = 'collection_waiver_conflict';
  end if;
  if claim.claim_revision <> p_expected_revision then raise sqlstate 'PT409' using message = 'claim_changed'; end if;
  if claim.claim_type <> 'return' then raise check_violation using message = 'carrier_loss_return_only'; end if;
  if claim.collection_policy <> 'origin' or not claim.collection_required then raise check_violation using message = 'collection_waiver_unavailable'; end if;
  if claim.stage not in ('collecting', 'collected') or order_state not in ('shipping', 'delivered', 'done')
    or exists(select 1 from public.order_cancellation_claims where order_id = order_key) then
    raise check_violation using message = 'claim_not_collectable';
  end if;
  select * into collection from public.order_claim_collections where claim_id = p_claim_id and shipment_id = p_shipment_id;
  if not found then raise no_data_found using message = 'claim_collection_not_found'; end if;
  if collection.collected_at is not null then raise check_violation using message = 'collection_waiver_not_needed'; end if;
  if private.claim_collection_partially_received(p_claim_id, p_shipment_id) then
    raise check_violation using message = 'collection_waiver_partially_received';
  end if;
  -- 나가지 않은 물건은 잃어버릴 수 없다(발송 전 몫은 재고 부족 부분 취소·운영자 전액 취소의 몫이다).
  select * into ship from public.order_shipments where id = p_shipment_id and order_id = order_key;
  if ship.id is null or ship.status not in ('shipping', 'delivered') or (ship.shipped_at is null and ship.delivered_at is null) then
    raise check_violation using message = 'carrier_loss_shipment_not_dispatched';
  end if;
  if (select count(*) from private.claim_evidence_files f where f.id = any(evidence) and f.claim_id = p_claim_id) <> cardinality(evidence) then
    raise check_violation using message = 'collection_waiver_evidence_required';
  end if;
  insert into public.order_claim_collection_waivers(claim_id, shipment_id, order_id, reason, evidence_file_ids, waived_by, waived_at,
    kind, carrier_accident_number, operation_id)
  values (p_claim_id, p_shipment_id, order_key, reason, evidence, actor, at_value, 'carrier_loss', accident, p_operation_id)
  returning * into decision;
  update public.order_cancellation_requests set updated_at = at_value where id = p_claim_id;
  insert into public.audit_log(actor_id, action, target, diff) values (actor, 'admin.order.claim_carrier_loss_recorded', 'order:' || order_key::text,
    jsonb_build_object('claimId', p_claim_id, 'claimType', claim.claim_type, 'shipmentId', p_shipment_id, 'originName', collection.origin_name_snapshot,
      'carrier', ship.carrier, 'trackingNumber', ship.tracking_number, 'accidentNumber', accident, 'reason', reason,
      'evidenceFileIds', to_jsonb(evidence), 'items', collection.items_snapshot, 'operationId', p_operation_id));
  -- 회수 완료(입고완료·회수 완료일·알림)는 공용 완료 함수가 한 번 적는다(다른 출고지가 아직이면 아무것도 하지 않는다).
  perform private.complete_order_claim_collection(p_claim_id, 'carrier_loss_recorded');
  return jsonb_build_object('claimId', p_claim_id, 'shipmentId', p_shipment_id, 'recordedAt', decision.waived_at, 'replayed', false,
    'collectionComplete', private.claim_collections_complete(p_claim_id),
    'claimRevision', (select c.claim_revision from public.order_cancellation_requests c where c.id = p_claim_id));
end $$;
revoke all on function public.admin_record_order_claim_carrier_loss(uuid, uuid, jsonb, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_record_order_claim_carrier_loss(uuid, uuid, jsonb, integer, uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_record_order_claim_carrier_loss(uuid,uuid,jsonb,integer,uuid)'::regprocedure, 'sales.manage', 'write', false);

-- 재정의한 함수의 등록된 계약을 새 본문·ACL로 다시 적는다(분류는 기존 행 그대로).
do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'private.claim_collection_waived(uuid,uuid)'::regprocedure,
    'private.reopen_ineffective_collection_waivers()'::regprocedure,
    'private.complete_order_claim_collection(uuid,text)'::regprocedure,
    'private.claim_collection_received_on(uuid)'::regprocedure,
    'private.return_fee_deduction_plan(uuid)'::regprocedure,
    'private.restore_order_item_supply(uuid,text)'::regprocedure,
    'public.admin_register_claim_evidence_file(uuid,uuid,text,integer,text)'::regprocedure,
    'private.claim_collection_records(uuid)'::regprocedure,
    'private.claim_collection_document(uuid)'::regprocedure,
    'public.admin_order_claim_detail(uuid)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only); end if;
    if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

drop function private.o3e_patch_function(text, text, text);

commit;
notify pgrst, 'reload schema';
