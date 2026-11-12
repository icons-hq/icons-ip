-- 반품·교환 회수 확인에 실제 입고일을 받는다(1027T-033·SHEET-049·SHEET-052, 2026-11-12 오케스트레이터 판단).
--
-- 근거: 가이드(lib/admin/guide/topics/claims.ts) "운영자가 확인 버튼을 늦게 누른 시각을 반환 시각으로 대신하지
-- 않습니다"와 현행 회수 확인 RPC의 클릭 시각(clock_timestamp()) 저장이 어긋난다(원장 정정 D). 회수 확인을 목록에서
-- 일괄로 하면 그 차이가 커지고, 약관 제16조 "굿즈를 반환받은 날부터 3영업일" 환급 기한 기산에 닿는다.
--
-- 모델
-- * public.order_claim_collections.received_on: 출고지(배송 건)마다 운영자가 적은 실제 입고일(KST 날짜). 기본은
--   오늘이고 미래 날짜와 주문일보다 이른 날짜는 거절한다. 이 migration 전에 확인한 행은 비어 있다(지어 넣지 않는다).
-- * public.order_cancellation_requests.collection_received_on: 그 클레임의 회수가 모두 끝난 날(실제 입고일).
--   출고지별 회수는 입고일 가운데 가장 늦은 날이다(입고일이 없는 옛 확인 행은 확인 시각의 KST 날짜). 레거시 회수는
--   입고 확인 때 받은 날이다. 환급 기한은 이 날부터 센다. 비어 있으면(옛 기록) 화면은 예전처럼 collected_at을 쓴다.
-- * collected_at(확인 시각)·collected_by는 그대로 처리 시각·처리자다. 지우거나 덮지 않는다.
-- * 진입점: admin_record_order_claim_origin_collection(uuid,uuid,text,date)·admin_record_order_claim_collection(uuid,text,date,text)를
--   새로 둔다. 옛 3·2인자 함수는 입고일 없이(=오늘) 새 함수를 부른다. DB가 앱보다 먼저 배포돼도 옛 앱이 그대로 동작한다.
-- * 회수 생략(ADR-0041)의 진실원은 결정 표다(private.claim_collection_waived — 재출고 전에 결정만 한 배송 건 포함,
--   재출고 행의 collection_waived는 사본이다). 결정한 배송 건의 늦은 입고 확인은 클레임이 열려 있는 동안 막지 않는다.
--   재고는 바꾸지 않는다(재출고는 결정대로 회수품을 복원하지 않는다). 운영 상세는 그 배송 건을 collectionWaived로
--   표시하고, 목록 일괄 회수 확인은 그 배송 건을 고르지 않는다. 결정한 배송 건이 아직 돌아오지 않았으면 회수 완료
--   알림은 "반송한 굿즈가 모두 입고"가 아니라 "반송이 필요한 굿즈가 모두 입고"이고 일부는 회수 없이 다시 보내드린다고 말한다.
-- * 클레임의 회수 완료일(collection_received_on)은 회수가 처음 끝날 때마다 확인된 출고지 행에서 다시 센다. 반품 전환·사유
--   정정으로 회수 생략 결정이 효력을 잃어 입고완료가 수거중으로 돌아가면(private.reopen_ineffective_collection_waivers,
--   collected_at을 비운다) 회수 완료일도 함께 비우고, 실제 입고로 다시 완료되면 새 완료일을 적고 회수 완료 알림을 다시
--   보낸다(중복 방지 키에 되돌림 회차를 담는다). 앱의 환급 기한은 collected_at이 있을 때만 센다.
-- * 회수 완료(입고완료·회수 완료일·알림)는 private.complete_order_claim_collection 하나로 적는다. 출고지 입고 확인, 다른
--   출고지 입고 뒤의 회수 생략 결정, 효력을 잃었던 결정이 다시 효력을 얻는 정정(하자로 되돌림·교환으로 되돌림) 어느 순서로
--   끝나도 같은 완료·알림이 한 번 된다. 실제로 입고된 배송 건이 없으면(모두 회수 생략) 완료하지 않는다.
-- * 레거시 회수 확인은 회수 근거 열이 없어, 함께 받은 근거(선택, 1~500자)를 감사 기록에 남긴다.
-- * 목록(admin_search_order_claims_console)과 운영 상세(admin_order_claim_detail)가 입고일을 함께 돌려준다.
begin;

-- ---------------------------------------------------------------------------
-- 1. 열
-- ---------------------------------------------------------------------------
alter table public.order_claim_collections add column received_on date;
alter table public.order_claim_collections add constraint order_claim_collections_received_on_check
 check(received_on is null or collected_at is not null);
alter table public.order_cancellation_requests add column collection_received_on date;

-- 클레임의 회수 완료일. 확인된 출고지 행의 입고일 가운데 가장 늦은 날이다.
create function private.claim_collection_received_on(p_claim uuid)
returns date language sql stable set search_path='' as $$
 select max(coalesce(x.received_on,(x.collected_at at time zone 'Asia/Seoul')::date))
 from public.order_claim_collections x where x.claim_id=p_claim and x.collected_at is not null;
$$;

-- ---------------------------------------------------------------------------
-- 2. 출고지별 회수 확인(입고일)과 회수 완료
-- ---------------------------------------------------------------------------
-- 회수 완료(입고완료·회수 완료일·알림)를 한 곳에서 적는다. 출고지 입고 확인(admin_record_order_claim_origin_collection),
-- 회수 생략 결정(admin_waive_order_claim_collection), 결정이 다시 효력을 얻는 유형·사유 정정(trigger
-- sync_claim_collection_completion)이 같은 규칙을 쓴다. 남은 반환 대상(효력 있는 회수 생략 결정이 없는 배송 건)이 모두
-- 입고됐고 실제로 입고된 배송 건이 하나 이상일 때만, 아직 완료 전(collected_at 없음)인 열린 클레임에 한 번 적는다(멱등).
-- 모든 배송 건을 회수 생략한 교환은 입고가 없으므로 여기서 완료하지 않고 재출고로 끝난다. 보류 중이면 보류 전 단계를
-- 입고완료로 바꾼다(되돌림 private.reopen_ineffective_collection_waivers와 대칭). 부르는 쪽이 클레임 행을 잠근다.
create function private.complete_order_claim_collection(p_claim_id uuid,p_cause text default null)
returns boolean language plpgsql set search_path='' as $$
declare claim public.order_cancellation_requests;completion_event text;
begin
 select * into claim from public.order_cancellation_requests where id=p_claim_id;
 if not found or claim.collected_at is not null or claim.collection_policy is distinct from 'origin' or not claim.collection_required
  or not(claim.stage in('collecting','collected','processing','needs_review')
   or claim.stage='on_hold' and claim.held_from in('collecting','collected','processing','needs_review'))
  or not exists(select 1 from public.order_claim_collections x where x.claim_id=p_claim_id and x.collected_at is not null)
  or not private.claim_collections_complete(p_claim_id) then return false;end if;
 -- 회수 완료일은 지금 확인된 출고지 행에서 다시 센다. 되돌림 뒤 다시 완료되는 경우에도 이전 완료일이 남지 않는다.
 update public.order_cancellation_requests set collected_at=clock_timestamp(),
   collection_received_on=private.claim_collection_received_on(p_claim_id),
   stage=case when stage='collecting' then 'collected' else stage end,
   held_from=case when stage='on_hold' and held_from='collecting' then 'collected' else held_from end,
   updated_at=clock_timestamp()
 where id=p_claim_id returning * into claim;
 -- 출고지 입고 확인은 그 감사 기록이 완료를 담는다. 결정·정정으로 끝난 완료는 따로 남긴다(되돌림 감사와 대칭).
 if p_cause is not null then
  insert into public.audit_log(actor_id,action,target,diff) values((select auth.uid()),'admin.order.claim_collection_completed','order:'||claim.order_id::text,
   jsonb_build_object('claimId',p_claim_id,'claimType',claim.claim_type,'reasonType',claim.reason_type,'stage',claim.stage,'heldFrom',claim.held_from,
    'receivedOn',claim.collection_received_on,'cause',p_cause));
 end if;
 -- 알림 중복 방지 키는 회차를 담는다(첫 회차는 예전 키 그대로). 되돌림 뒤 다시 끝난 때의 안내가 앞 회차의 안내에 막히지 않는다.
 select case when count(*)=0 then 'collected' else 'collected:'||(count(*)+1) end into completion_event
 from public.audit_log a where a.target='order:'||claim.order_id::text and a.action='admin.order.claim_collection_reopened'
  and a.diff->>'claimId'=p_claim_id::text;
 -- 효력 있는 회수 생략 결정의 배송 건이 아직 돌아오지 않았으면 "반송한 굿즈가 모두 입고"라고 알리지 않는다. 진실원은 결정
 -- 표다(재출고 전에 결정만 한 배송 건 포함).
 if exists(select 1 from public.order_claim_collections x
   where x.claim_id=p_claim_id and x.collected_at is null and private.claim_collection_waived(x.claim_id,x.shipment_id)) then
  perform private.notify_order_claim(p_claim_id,completion_event,'반송이 필요한 굿즈가 모두 입고됐어요',
   '반송이 필요한 굿즈의 입고가 모두 확인되어 후속 처리를 준비합니다. 일부 상품은 회수 없이 다시 보내드려요.');
 else
  perform private.notify_order_claim(p_claim_id,completion_event,'반송한 굿즈가 모두 입고됐어요','모든 출고지의 입고가 확인되어 후속 처리를 준비합니다.');
 end if;
 return true;
end $$;

create function public.admin_record_order_claim_origin_collection(p_claim_id uuid, p_shipment_id uuid, p_evidence text, p_received_on date)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare actor uuid:=(select auth.uid());claim public.order_cancellation_requests;collection public.order_claim_collections;order_key uuid;address_value text;
 order_day date;today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;received date;
begin
  perform private.require_operator_capability('sales.manage',false);

 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required'; end if;
 if p_evidence is null or p_evidence<>btrim(p_evidence) or char_length(p_evidence) not between 1 and 500 or translate(p_evidence,E'\n\r\t','') ~ '[[:cntrl:]]' then
   raise check_violation using message='invalid_collection_evidence'; end if;
 select order_id into order_key from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found'; end if;
 select (created_at at time zone 'Asia/Seoul')::date into order_day from public.orders where id=order_key for update;
 perform id from public.order_shipments where order_id=order_key order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
 if claim.collection_policy<>'origin' or not claim.collection_required then raise check_violation using message='claim_type_has_no_collection'; end if;
 select * into collection from public.order_claim_collections where claim_id=p_claim_id and shipment_id=p_shipment_id for update;
 if not found then raise no_data_found using message='claim_collection_not_found'; end if;
 if collection.collected_at is not null then
   -- 같은 근거·같은 입고일의 재전송은 멱등하다. 입고일 없이 부르는 옛 경로는 근거만 맞춰 본다.
   if collection.evidence=p_evidence and (p_received_on is null or collection.received_on is not distinct from p_received_on) then
     return case when private.claim_collections_complete(p_claim_id) then 'collected' else 'collecting' end; end if;
   raise unique_violation using message='claim_collection_conflict';
 end if;
 received:=coalesce(p_received_on,today);
 if received>today or received<order_day then raise check_violation using message='invalid_collection_received_on'; end if;
 if claim.stage not in ('collecting','collected','processing','needs_review') then raise exception using message='claim_not_collectable'; end if;
 address_value:=collection.return_address_snapshot;
 if btrim(address_value)='' then
   select return_address into address_value from public.fulfillment_origins where id=collection.origin_id for share;
   if coalesce(btrim(address_value),'')='' then raise check_violation using message='claim_return_address_required'; end if;
 end if;
 update public.order_claim_collections set return_address_snapshot=address_value,collected_at=clock_timestamp(),collected_by=actor,evidence=p_evidence,received_on=received
 where claim_id=p_claim_id and shipment_id=p_shipment_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.claim_origin_collected','order:'||order_key::text,
  jsonb_build_object('claimId',p_claim_id,'shipmentId',p_shipment_id,'originId',collection.origin_id,'items',collection.items_snapshot,'returnAddress',address_value,'evidence',p_evidence,
   'receivedOn',received,'collectionWaived',private.claim_collection_waived(p_claim_id,p_shipment_id)));
 -- 회수 완료는 회수가 끝날 때 한 번 적고 알린다(private.complete_order_claim_collection). 회수 생략 배송 건은 회수가 끝난
 -- 것으로 보므로(ADR-0041) 그 배송 건이 늦게 도착해 확인돼도 완료일·단계·알림을 다시 만들지 않는다. 회수 생략 결정이 효력을
 -- 잃어 수거중으로 돌아간 클레임(감사 admin.order.claim_collection_reopened)은 실제 입고로 다시 끝날 때 새 회차로 적고 알린다.
 perform private.complete_order_claim_collection(p_claim_id);
 return case when private.claim_collections_complete(p_claim_id) then 'collected' else 'collecting' end;
end $function$;

create or replace function public.admin_record_order_claim_origin_collection(p_claim_id uuid, p_shipment_id uuid, p_evidence text)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform private.require_operator_capability('sales.manage',false);
  return public.admin_record_order_claim_origin_collection(p_claim_id,p_shipment_id,p_evidence,null::date);
end $function$;

-- ---------------------------------------------------------------------------
-- 3. 레거시 회수 확인(출고지별 회수 이전 클레임, 입고일)
-- ---------------------------------------------------------------------------
create function public.admin_record_order_claim_collection(p_claim_id uuid, p_stage text, p_received_on date, p_evidence text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_claim record;
  v_order_day date;
  v_today date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
  v_received date;
begin
  perform private.require_operator_capability('sales.manage',false);

  if v_actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_stage not in ('collecting', 'collected') then
    raise check_violation using message = 'invalid collection stage';
  end if;
  -- 레거시 회수에는 근거 열이 없어 감사 기록에만 남긴다. 출고지별 회수 확인 근거와 같은 규칙이다.
  if p_evidence is not null and (p_evidence <> btrim(p_evidence) or char_length(p_evidence) not between 1 and 500
    or translate(p_evidence, E'\n\r\t', '') ~ '[[:cntrl:]]') then
    raise check_violation using message = 'invalid_collection_evidence';
  end if;

  select (o.created_at at time zone 'Asia/Seoul')::date into v_order_day
  from public.orders o join public.order_cancellation_requests c on c.order_id=o.id where c.id=p_claim_id for update of o;
  perform s.id from public.order_shipments s join public.order_cancellation_requests c on c.order_id=s.order_id where c.id=p_claim_id order by s.id for update of s;

  select request.*
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id
  for update;

  if not found then
    raise no_data_found using message = 'claim_not_found';
  end if;

  if v_claim.collection_policy='origin' and p_stage='collected' then raise check_violation using message='origin_collection_required'; end if;

  if v_claim.claim_type = 'cancel' then
    raise exception using message = 'claim_type_has_no_collection';
  end if;

  -- 수거 시작은 승인이 이미 만든다. 같은 값으로 다시 부르면 멱등하게 통과하고,
  -- 그 밖의 단계에서 부르면 거절한다 — 뒤로 감는 전이를 만들지 않는다.
  if p_stage = 'collecting' then
    if v_claim.stage = 'collecting' then
      return 'collecting';
    end if;
    raise exception using message = 'claim_not_collectable';
  end if;

  if v_claim.stage = 'collected' then
    return 'collected';
  end if;
  if v_claim.stage <> 'collecting' then
    raise exception using message = 'claim_not_collectable';
  end if;

  -- 실제 입고일(KST 날짜). 비우면 오늘이다. 미래와 주문일보다 이른 날은 받지 않는다.
  v_received := coalesce(p_received_on, v_today);
  if v_received > v_today or v_received < v_order_day then
    raise check_violation using message = 'invalid_collection_received_on';
  end if;

  update public.order_cancellation_requests
  set
    stage = p_stage,
    collected_at = case when p_stage = 'collected' then now() else collected_at end,
    collection_received_on = v_received,
    updated_at = now()
  where id = p_claim_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.claim_collected',
    'order:' || v_claim.order_id::text,
    jsonb_build_object(
      'claimId', p_claim_id,
      'claimType', v_claim.claim_type,
      'from', v_claim.stage,
      'to', p_stage,
      'receivedOn', v_received,
      'evidence', p_evidence
    )
  );

  perform private.notify_order_claim(
    p_claim_id,
    'collected',
    '반송한 굿즈가 입고됐어요',
    case
      when v_claim.claim_type = 'exchange'
        then '입고가 확인됐습니다. 교환 상품 재출고를 준비합니다.'
      else '입고가 확인됐습니다. 영업일 기준 3일 이내에 환급 절차를 진행합니다.'
    end
  );

  return p_stage;
end;
$function$;

create or replace function public.admin_record_order_claim_collection(p_claim_id uuid, p_stage text)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform private.require_operator_capability('sales.manage',false);
  return public.admin_record_order_claim_collection(p_claim_id,p_stage,null::date,null::text);
end $function$;

-- ---------------------------------------------------------------------------
-- 4. 운영 상세: 출고지별 입고일·회수 생략 표시, 클레임 회수 완료일
-- ---------------------------------------------------------------------------
create or replace function private.claim_collection_records(target_claim uuid)
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$
 select coalesce(jsonb_agg(jsonb_build_object('shipmentId',x.shipment_id,'originId',x.origin_id,'originName',x.origin_name_snapshot,
  'returnAddress',x.return_address_snapshot,'items',x.items_snapshot,'collectedAt',x.collected_at,'collectedBy',x.collected_by,'collectorName',(select nickname from public.profiles where id=x.collected_by),'evidence',x.evidence,
  'receivedOn',x.received_on,
  'collectionWaived',private.claim_collection_waived(x.claim_id,x.shipment_id))
  order by x.origin_id,x.shipment_id),'[]') from public.order_claim_collections x where x.claim_id=target_claim;
$function$;

-- 다른 트랙이 같은 함수를 이어 고치므로 앵커 치환으로 최소 변경한다.
do $patch$
declare definition text:=pg_get_functiondef('public.admin_order_claim_detail(uuid)'::regprocedure);
 anchor text:='  return result || jsonb_build_object(''sellerIntake'', private.seller_claim_intake_json(p_claim_id),''gift'',private.gift_admin_claim_party(p_claim_id));';
 replacement text:='  -- 실제 입고일(1027T-033): 클레임의 회수 완료일. 환급 기한은 이 날부터 센다(비어 있으면 옛 기록이라 collectedAt).
  if jsonb_typeof(result->''claim'')=''object'' then
    result:=jsonb_set(result,''{claim}'',(result->''claim'')||jsonb_build_object(''collectionReceivedOn'',
      (select c.collection_received_on from public.order_cancellation_requests c where c.id=p_claim_id)));
  end if;
  return result || jsonb_build_object(''sellerIntake'', private.seller_claim_intake_json(p_claim_id),''gift'',private.gift_admin_claim_party(p_claim_id));';
begin
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'admin_order_claim_detail anchor must appear once';end if;
 execute replace(definition,anchor,replacement);
end $patch$;

-- 회수 생략 결정이 효력을 잃어 입고완료를 수거중으로 되돌릴 때(ADR-0041) 클레임의 회수 완료일도 비운다. 실제 입고로 다시
-- 완료되면 회수 확인이 확인된 출고지 행에서 다시 센다. 다른 트랙의 트리거 함수라 앵커 치환으로 한 줄만 더한다.
do $patch$
declare definition text:=pg_get_functiondef('private.reopen_ineffective_collection_waivers()'::regprocedure);
 anchor text:=$a$new.collected_at:=null;$a$;
 replacement text:=$a$new.collected_at:=null;new.collection_received_on:=null;$a$;
begin
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'reopen_ineffective_collection_waivers anchor must appear once';end if;
 execute replace(definition,anchor,replacement);
end $patch$;

-- 회수 생략을 다른 출고지 입고 뒤에 결정해도 회수 완료가 된다(입고 → 결정 순서). 결정 순서와 상관없이 같은 완료·알림이
-- 되도록 결정 뒤에 공용 완료를 부른다(같은 결정의 재전송은 이미 완료면 아무것도 하지 않는다). 다른 트랙의 함수라 앵커 치환으로
-- 한 줄만 더한다. 재출고와 같은 요청의 회수 생략(private.record_order_claim_shipment_reshipment)은 연락처 작업 영수증이
-- 클레임 버전을 정확히 1 올리는 계약이라 여기서 완료하지 않는다(그 교환은 재출고로 끝난다).
do $patch$
declare definition text:=pg_get_functiondef('public.admin_waive_order_claim_collection(uuid,uuid,jsonb)'::regprocedure);
 anchor text:=$a$select * into target from private.claim_reshipment_targets(p_claim_id) t where t.shipment_id=p_shipment_id;$a$;
 replacement text:=$a$perform private.complete_order_claim_collection(p_claim_id,'collection_waiver_decided');
 select * into target from private.claim_reshipment_targets(p_claim_id) t where t.shipment_id=p_shipment_id;$a$;
begin
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'admin_waive_order_claim_collection anchor must appear once';end if;
 execute replace(definition,anchor,replacement);
end $patch$;

-- 반품 전환·사유 정정으로 효력을 잃었던 회수 생략 결정이 다시 효력을 얻으면(하자로 되돌림·교환으로 되돌림) 되돌림과 대칭으로
-- 회수 완료를 적는다. 행이 바뀐 뒤(AFTER) 새 유형·사유로 판정하고, 완료는 같은 행의 다음 갱신이다. 그 갱신은 claim_type·
-- reason_type을 쓰지 않아 이 트리거·되돌림 트리거가 다시 돌지 않는다(재귀 없음). 같은 클레임 행은 바깥 갱신이 이미 잠갔다(교착
-- 없음). 이름을 production_claim_ready_jobs 뒤로 두어, 교환으로 되돌릴 때 교환품 제작 작업을 그 규칙(준비된 시각 기준)으로 먼저
-- 되살린 뒤 입고완료를 적는다.
create function private.sync_claim_collection_completion() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.complete_order_claim_collection(new.id,'collection_waiver_effective');
 return null;
end $$;
create trigger sync_claim_collection_completion after update of claim_type,reason_type on public.order_cancellation_requests
 for each row when(new.claim_type='exchange' and new.reason_type='defect' and new.collected_at is null
  and(old.claim_type is distinct from new.claim_type or old.reason_type is distinct from new.reason_type))
 execute function private.sync_claim_collection_completion();

-- ---------------------------------------------------------------------------
-- 5. 목록: 회수 완료일 열을 더한다(표시 열만 더하는 얇은 바깥 함수라 다시 만든다)
-- ---------------------------------------------------------------------------
drop function public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text);
create function public.admin_search_order_claims_console(p_claim_type text default null::text, p_stage text default null::text,
 p_reason_type text default null::text, p_from date default null::date, p_to date default null::date, p_query text default null::text,
 p_limit integer default 20, p_offset integer default 0, p_field text default 'all'::text, p_date_field text default 'requested'::text,
 p_sort text default 'newest'::text)
 returns table(id uuid, reference bigint, order_id uuid, claim_type text, stage text, reason_type text, staff_reason_code text,
  buyer_id uuid, buyer_name text, buyer_email text, order_status public.order_status, order_total bigint,
  requested_at timestamp with time zone, collected_at timestamp with time zone, completed_at timestamp with time zone,
  refund_method text, handler_name text, total_count bigint, order_number text, collection_received_on date)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
      begin
        if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
        return query select source.id,source.reference,source.order_id,source.claim_type,source.stage,source.reason_type,source.staff_reason_code,source.buyer_id,source.buyer_name,source.buyer_email,source.order_status,source.order_total,source.requested_at,source.collected_at,source.completed_at,source.refund_method,source.handler_name,source.total_count,purchase.order_number,request.collection_received_on from private.admin_search_order_claims_console_before_numbers(p_claim_type,p_stage,p_reason_type,p_from,p_to,p_query,p_limit,p_offset,p_field,p_date_field,p_sort) with ordinality source
          join public.orders purchase on purchase.id=source.order_id
          join public.order_cancellation_requests request on request.id=source.id order by source.ordinality;
      end $function$;

-- ---------------------------------------------------------------------------
-- 6. 권한 봉인과 운영자 계약
-- ---------------------------------------------------------------------------
revoke all on function private.claim_collection_received_on(uuid) from public,anon,authenticated,service_role;
revoke all on function private.claim_collection_records(uuid) from public,anon,authenticated,service_role;
revoke all on function private.reopen_ineffective_collection_waivers() from public,anon,authenticated,service_role;
revoke all on function private.complete_order_claim_collection(uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.sync_claim_collection_completion() from public,anon,authenticated,service_role;
revoke all on function public.admin_waive_order_claim_collection(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_waive_order_claim_collection(uuid,uuid,jsonb) to authenticated;
revoke all on function public.admin_record_order_claim_origin_collection(uuid,uuid,text,date) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_origin_collection(uuid,uuid,text,date) to authenticated;
revoke all on function public.admin_record_order_claim_origin_collection(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_origin_collection(uuid,uuid,text) to authenticated;
revoke all on function public.admin_record_order_claim_collection(uuid,text,date,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_collection(uuid,text,date,text) to authenticated;
revoke all on function public.admin_record_order_claim_collection(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_collection(uuid,text) to authenticated;
revoke all on function public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text) to authenticated;

select private.register_operator_rpc_contract('public.admin_record_order_claim_origin_collection(uuid,uuid,text,date)'::regprocedure,'sales.manage','write',false);
select private.register_operator_rpc_contract('public.admin_record_order_claim_collection(uuid,text,date,text)'::regprocedure,'sales.manage','write',false);
select private.register_operator_rpc_contract('public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text)'::regprocedure,'sales.manage','read',false);

-- 재정의한 함수의 등록된 계약을 새 본문·ACL로 다시 적는다(분류는 기존 행 그대로).
do $$declare fn regprocedure;contract record;begin
 foreach fn in array array[
  'public.admin_record_order_claim_origin_collection(uuid,uuid,text)'::regprocedure,
  'public.admin_record_order_claim_collection(uuid,text)'::regprocedure,
  'private.claim_collection_records(uuid)'::regprocedure,
  'private.reopen_ineffective_collection_waivers()'::regprocedure,
  'public.admin_waive_order_claim_collection(uuid,uuid,jsonb)'::regprocedure,
  'public.admin_order_claim_detail(uuid)'::regprocedure] loop
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);
  elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);
  end if;
 end loop;
end $$;

commit;
notify pgrst,'reload schema';
