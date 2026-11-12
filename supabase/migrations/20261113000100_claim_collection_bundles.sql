-- 회수 묶음 = 배송 건 × 반품지(S36-040·QNA-031).
--
-- 접수 승인 때 회수 주소를 상품 우선으로 스냅샷한다. 한 배송 건 안에서 상품별 반품지가 갈리면 회수 묶음을
-- 반품지별로 나누고, 회수 확인(실제 입고)은 묶음마다 받는다.
--
-- 하위 호환: 배송 건 단위 회수 행(public.order_claim_collections, 키 = 클레임 × 배송 건)은 그대로 둔다. 회수 완료
-- 판정(claim_collections_complete·complete_order_claim_collection), 회수 생략(배송 건 단위 결정 표), 배송 건 재출고,
-- 교환품 제작 트리거, 회수 정정 계획은 계속 배송 건 행을 본다. 배송 건 행은 그 배송 건의 모든 묶음이 입고된 때
-- 회수 완료로 적힌다(입고일 = 묶음 가운데 가장 늦은 날). 묶음이 하나뿐인 배송 건(지금까지의 모든 클레임)은
-- 예전과 같은 키(클레임, 배송 건)로 확인할 수 있다. 재고 대조 흐름은 품목이 실제로 돌아온 묶음의 입고 시각을 쓴다.
begin;

create table public.order_claim_collection_bundles (
 id uuid primary key default gen_random_uuid(),
 claim_id uuid not null,
 shipment_id uuid not null,
 -- 주소록 id의 스냅샷이다(외래 키 없음 — 주소록을 지워도 이미 접수된 회수 묶음은 남는다). null = 출고지 반품 주소.
 return_address_id uuid,
 return_name_snapshot text not null default '' check(char_length(return_name_snapshot)<=60),
 return_address_snapshot text not null check(char_length(return_address_snapshot)<=500),
 return_phone_snapshot text not null default '' check(char_length(return_phone_snapshot)<=20),
 items_snapshot jsonb not null check(jsonb_typeof(items_snapshot)='array' and jsonb_array_length(items_snapshot)>0),
 collected_at timestamptz,
 collected_by uuid references public.profiles(id) on delete restrict,
 evidence text check(evidence is null or (evidence=btrim(evidence) and char_length(evidence) between 1 and 500 and translate(evidence,E'\n\r\t','') !~ '[[:cntrl:]]')),
 received_on date,
 created_at timestamptz not null default clock_timestamp(),
 constraint order_claim_collection_bundles_collection_fkey foreign key(claim_id,shipment_id)
  references public.order_claim_collections(claim_id,shipment_id) on delete cascade,
 constraint order_claim_collection_bundles_destination_key unique nulls not distinct(claim_id,shipment_id,return_address_id),
 constraint order_claim_collection_bundles_collected_check check((collected_at is null and collected_by is null and evidence is null and received_on is null)
  or (collected_at is not null and collected_by is not null and evidence is not null and btrim(return_address_snapshot)<>''))
);
comment on table public.order_claim_collection_bundles is '회수 묶음(배송 건 × 반품지). 회수 확인은 묶음마다 받고, 배송 건의 모든 묶음이 입고되면 order_claim_collections 행이 회수 완료가 된다.';
alter table public.order_claim_collection_bundles enable row level security;
revoke all on public.order_claim_collection_bundles from public,anon,authenticated,service_role;

-- 이미 만들어진 배송 건 회수 행은 묶음 하나(출고지 반품 주소)로 옮긴다. 입고 기록도 그대로 옮긴다.
insert into public.order_claim_collection_bundles(claim_id,shipment_id,return_address_id,return_name_snapshot,return_address_snapshot,
 return_phone_snapshot,items_snapshot,collected_at,collected_by,evidence,received_on,created_at)
select x.claim_id,x.shipment_id,null,'',x.return_address_snapshot,'',x.items_snapshot,x.collected_at,x.collected_by,x.evidence,x.received_on,
 coalesce(x.collected_at,clock_timestamp())
from public.order_claim_collections x;

-- 배송 건 품목마다 지금 쓸 회수지: 상품 반품지(주소록)가 있으면 그것, 없으면 그 배송 건 출고지의 반품 주소.
create function private.claim_shipment_return_lines(p_order uuid)
returns table(shipment_id uuid,order_item_id uuid,item_name text,qty integer,return_address_id uuid,return_name text,return_address text,return_phone text)
language sql stable security invoker set search_path='' as $$
 select s.id,i.id,i.good_name_snapshot,link.qty,place.id,coalesce(place.name,''),coalesce(place.address,origin.return_address),coalesce(place.phone,'')
 from public.order_shipments s
 join public.fulfillment_origins origin on origin.id=s.origin_id
 join public.order_shipment_items link on link.shipment_id=s.id
 join public.order_items i on i.id=link.order_item_id
 left join public.goods good on good.id=i.good_id
 left join public.return_addresses place on place.id=good.return_address_id
 where s.order_id=p_order and s.delivery_method<>'digital';
$$;
revoke all on function private.claim_shipment_return_lines(uuid) from public,anon,authenticated,service_role;

-- 판매자 접수 화면의 '현재 반송지'(배송 건 하나): 품목의 회수지가 하나라도 비면 빈 값(등록 안내), 아니면 반품지들.
create function private.shipment_return_address_summary(p_shipment uuid) returns text
language sql stable security invoker set search_path='' as $$
 select case when bool_or(btrim(l.return_address)='') then '' else coalesce(string_agg(distinct l.return_address,' / '),'') end
 from public.order_shipments s cross join lateral private.claim_shipment_return_lines(s.order_id) l
 where s.id=p_shipment and l.shipment_id=p_shipment;
$$;
revoke all on function private.shipment_return_address_summary(uuid) from public,anon,authenticated,service_role;

-- 회수 묶음 읽기. 운영자(p_operator)는 근거·처리자·입고일과 주소 준비 여부까지, 고객은 반품지·품목 이름·수량·입고 여부만.
-- 묶음 행이 없는 배송 건 행(배포 경합으로 옛 본문 승인이 묶음 없이 남긴 행)은 배송 건 행 기준 기본 묶음 하나로 보인다.
-- 이 묶음의 id는 배송 건·클레임에서 정해지는 값이고, 묶음이 하나뿐인 배송 건은 화면이 묶음 id 대신 배송 건 키로 확인한다.
create function private.claim_collection_bundles_json(p_claim uuid,p_shipment uuid,p_operator boolean) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(case when p_operator then jsonb_build_object(
   'bundleId',b.id,'returnAddressId',b.return_address_id,'returnName',b.return_name_snapshot,'returnAddress',b.return_address_snapshot,
   'returnPhone',b.return_phone_snapshot,'items',b.items_snapshot,'collectedAt',b.collected_at,'collectedBy',b.collected_by,
   'collectorName',(select nickname from public.profiles where id=b.collected_by),'evidence',b.evidence,'receivedOn',b.received_on,
   'returnAddressReady',btrim(b.return_address_snapshot)<>'' or (b.return_address_id is null and exists(select 1 from public.order_claim_collections x
     join public.fulfillment_origins o on o.id=x.origin_id where x.claim_id=b.claim_id and x.shipment_id=b.shipment_id and coalesce(btrim(o.return_address),'')<>'')))
  else jsonb_build_object('bundleId',b.id,'returnName',b.return_name_snapshot,'returnAddress',b.return_address_snapshot,'returnPhone',b.return_phone_snapshot,
   'items',(select coalesce(jsonb_agg(jsonb_build_object('name',j.value->>'name','qty',(j.value->>'qty')::integer) order by j.ordinality),'[]'::jsonb)
     from jsonb_array_elements(b.items_snapshot) with ordinality j),
   'collectedAt',b.collected_at) end
  order by b.return_address_id is not null,b.return_name_snapshot,b.id),'[]'::jsonb)
 from(select r.id,r.claim_id,r.shipment_id,r.return_address_id,r.return_name_snapshot,r.return_address_snapshot,r.return_phone_snapshot,r.items_snapshot,
   r.collected_at,r.collected_by,r.evidence,r.received_on
  from public.order_claim_collection_bundles r where r.claim_id=p_claim and r.shipment_id=p_shipment
  union all
  select md5('claim-default-bundle:'||x.claim_id::text||':'||x.shipment_id::text)::uuid,x.claim_id,x.shipment_id,null,'',x.return_address_snapshot,'',x.items_snapshot,
   x.collected_at,x.collected_by,x.evidence,x.received_on
  from public.order_claim_collections x where x.claim_id=p_claim and x.shipment_id=p_shipment
   and not exists(select 1 from public.order_claim_collection_bundles r where r.claim_id=x.claim_id and r.shipment_id=x.shipment_id)) b;
$$;
revoke all on function private.claim_collection_bundles_json(uuid,uuid,boolean) from public,anon,authenticated,service_role;

-- 그 배송 건의 회수 묶음 가운데 하나라도 입고됐는가. 배송 건 행(order_claim_collections.collected_at)은 모든 묶음이 입고된 때에야
-- 적히므로, 일부만 입고된 배송 건은 이 값으로 가린다(회수 생략 결정·회수 생략 재출고 관문).
create function private.claim_collection_partially_received(p_claim uuid,p_shipment uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.order_claim_collection_bundles b where b.claim_id=p_claim and b.shipment_id=p_shipment and b.collected_at is not null);
$$;
revoke all on function private.claim_collection_partially_received(uuid,uuid) from public,anon,authenticated,service_role;

-- 승인 스냅샷: 배송 건 행(지금까지와 같은 키)과 그 아래 반품지별 묶음을 함께 만든다.
create or replace function private.prepare_claim_collections(target_claim uuid,require_address boolean default true) returns void
language plpgsql security invoker set search_path='' as $$
declare claim public.order_cancellation_requests;
begin
 select * into claim from public.order_cancellation_requests where id=target_claim;
 if claim.collection_policy<>'origin' or not claim.collection_required then return; end if;
 -- Caller owns order → shipment → claim locks. 회수지 설정(출고지 반품 주소 → 상품 반품지 → 주소록)이 스냅샷 도중
 -- 바뀌지 않게 이 순서로 UUID·ID 순 공유 잠금한다. 상품 저장(admin_save_good_claim_policy)도 상품 → 주소록 순서다.
 perform o.id from public.fulfillment_origins o where o.id in(select s.origin_id from public.order_shipments s where s.order_id=claim.order_id and s.delivery_method<>'digital') order by o.id for share;
 perform g.id from public.goods g where g.id in(select i.good_id from public.order_items i where i.order_id=claim.order_id) order by g.id for share;
 perform r.id from public.return_addresses r where r.id in(select g.return_address_id from public.goods g join public.order_items i on i.good_id=g.id
  where i.order_id=claim.order_id) order by r.id for share;
 if require_address and exists(select 1 from private.claim_shipment_return_lines(claim.order_id) l where btrim(l.return_address)='') then
   raise check_violation using message='claim_return_address_required'; end if;
 insert into public.order_claim_collections(claim_id,shipment_id,origin_id,origin_name_snapshot,return_address_snapshot,items_snapshot)
 select claim.id,s.id,s.origin_id,s.origin_name_snapshot,
   coalesce((select string_agg(d.return_address,' / ' order by d.first_item) from(select l.return_address,min(l.order_item_id::text) first_item
     from private.claim_shipment_return_lines(claim.order_id) l where l.shipment_id=s.id and btrim(l.return_address)<>'' group by l.return_address) d),''),
   (select jsonb_agg(jsonb_build_object('orderItemId',i.id,'name',i.good_name_snapshot,'qty',link.qty) order by i.id)
    from public.order_shipment_items link join public.order_items i on i.id=link.order_item_id where link.shipment_id=s.id)
 from public.order_shipments s
 where s.order_id=claim.order_id and s.delivery_method<>'digital' and exists(select 1 from public.order_shipment_items i where i.shipment_id=s.id)
 on conflict(claim_id,shipment_id) do nothing;
 insert into public.order_claim_collection_bundles(claim_id,shipment_id,return_address_id,return_name_snapshot,return_address_snapshot,return_phone_snapshot,items_snapshot)
 select claim.id,l.shipment_id,l.return_address_id,min(l.return_name),min(l.return_address),min(l.return_phone),
   jsonb_agg(jsonb_build_object('orderItemId',l.order_item_id,'name',l.item_name,'qty',l.qty) order by l.order_item_id)
 from private.claim_shipment_return_lines(claim.order_id) l
 -- 묶음은 배송 건 행을 처음 만들 때 한 번만 나눈다(다시 불려도 이미 나눈 묶음에 품목을 겹쳐 넣지 않는다).
 where exists(select 1 from public.order_claim_collections x where x.claim_id=claim.id and x.shipment_id=l.shipment_id)
  and not exists(select 1 from public.order_claim_collection_bundles b where b.claim_id=claim.id and b.shipment_id=l.shipment_id)
 group by l.shipment_id,l.return_address_id
 on conflict on constraint order_claim_collection_bundles_destination_key do nothing;
 if require_address and not exists(select 1 from public.order_claim_collections where claim_id=target_claim) then
   raise check_violation using message='claim_collections_incomplete'; end if;
end $$;
revoke all on function private.prepare_claim_collections(uuid,boolean) from public,anon,authenticated,service_role;

-- 회수 확인의 단일 지점. 묶음 id가 없으면 배송 건의 유일한 묶음을 확인한다(묶음이 둘 이상이면 묶음을 골라야 한다).
-- 배송 건의 모든 묶음이 입고되면 배송 건 행을 회수 완료로 적고, 클레임 회수 완료는 private.complete_order_claim_collection이 정한다.
create function private.record_order_claim_collection_bundle(p_claim_id uuid,p_shipment_id uuid,p_bundle_id uuid,p_evidence text,p_received_on date)
returns text language plpgsql security invoker set search_path='' as $$
declare actor uuid:=(select auth.uid());claim public.order_cancellation_requests;collection public.order_claim_collections;
 bundle public.order_claim_collection_bundles;order_key uuid;shipment_key uuid:=p_shipment_id;address_value text;bundle_count integer;
 order_day date;today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;received date;shipment_collected boolean:=false;
begin
 if p_evidence is null or p_evidence<>btrim(p_evidence) or char_length(p_evidence) not between 1 and 500 or translate(p_evidence,E'\n\r\t','') ~ '[[:cntrl:]]' then
   raise check_violation using message='invalid_collection_evidence'; end if;
 select order_id into order_key from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found'; end if;
 select (created_at at time zone 'Asia/Seoul')::date into order_day from public.orders where id=order_key for update;
 perform id from public.order_shipments where order_id=order_key order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
 if claim.collection_policy<>'origin' or not claim.collection_required then raise check_violation using message='claim_type_has_no_collection'; end if;
 if p_bundle_id is not null then
   select b.shipment_id into shipment_key from public.order_claim_collection_bundles b where b.id=p_bundle_id and b.claim_id=p_claim_id;
   if not found or (p_shipment_id is not null and shipment_key<>p_shipment_id) then raise no_data_found using message='claim_collection_not_found'; end if;
 end if;
 -- 잠금 순서: 주문 → 배송 건 → 클레임 → 배송 건 회수 행 → 묶음(다른 클레임 함수의 배송 건 회수 행 잠금과 같은 순서).
 select * into collection from public.order_claim_collections where claim_id=p_claim_id and shipment_id=shipment_key for update;
 if not found then raise no_data_found using message='claim_collection_not_found'; end if;
 if p_bundle_id is null then
   select count(*) into bundle_count from public.order_claim_collection_bundles where claim_id=p_claim_id and shipment_id=shipment_key;
   if bundle_count=0 then
     -- 묶음 없이 남은 배송 건 행(배포 경합으로 옛 본문 승인이 만든 행)은 잠근 배송 건 행으로 기본 묶음 하나를 만든다(백필과 같은 값).
     insert into public.order_claim_collection_bundles(claim_id,shipment_id,return_address_id,return_name_snapshot,return_address_snapshot,
      return_phone_snapshot,items_snapshot) values(p_claim_id,shipment_key,null,'',collection.return_address_snapshot,'',collection.items_snapshot)
     on conflict on constraint order_claim_collection_bundles_destination_key do nothing;
     bundle_count:=1;
   end if;
   if bundle_count>1 then raise check_violation using message='claim_collection_bundle_required'; end if;
   select * into bundle from public.order_claim_collection_bundles where claim_id=p_claim_id and shipment_id=shipment_key for update;
 else
   select * into bundle from public.order_claim_collection_bundles where id=p_bundle_id for update;
 end if;
 if bundle.id is null then raise no_data_found using message='claim_collection_not_found'; end if;
 if bundle.collected_at is not null then
   -- 같은 근거·같은 입고일의 재전송은 멱등하다. 입고일 없이 부르는 옛 경로는 근거만 맞춰 본다.
   if bundle.evidence=p_evidence and (p_received_on is null or bundle.received_on is not distinct from p_received_on) then
     return case when private.claim_collections_complete(p_claim_id) then 'collected' else 'collecting' end; end if;
   raise unique_violation using message='claim_collection_conflict';
 end if;
 received:=coalesce(p_received_on,today);
 if received>today or received<order_day then raise check_violation using message='invalid_collection_received_on'; end if;
 if claim.stage not in ('collecting','collected','processing','needs_review') then raise exception using message='claim_not_collectable'; end if;
 address_value:=bundle.return_address_snapshot;
 if btrim(address_value)='' then
   -- 승인 때 출고지 반품 주소가 비어 있던 출고지 기본 묶음(이 기능 전 클레임 포함)만 지금 출고지 주소로 채운다.
   -- 상품 반품지 묶음은 주소록이 주소를 요구하므로 비지 않는다.
   select return_address into address_value from public.fulfillment_origins where id=collection.origin_id for share;
   if coalesce(btrim(address_value),'')='' then raise check_violation using message='claim_return_address_required'; end if;
 end if;
 update public.order_claim_collection_bundles set return_address_snapshot=address_value,collected_at=clock_timestamp(),collected_by=actor,
  evidence=p_evidence,received_on=received where id=bundle.id;
 if not exists(select 1 from public.order_claim_collection_bundles where claim_id=p_claim_id and shipment_id=shipment_key and collected_at is null) then
   shipment_collected:=true;
   update public.order_claim_collections set
     return_address_snapshot=case when btrim(return_address_snapshot)<>'' then return_address_snapshot
       else (select string_agg(distinct b.return_address_snapshot,' / ') from public.order_claim_collection_bundles b where b.claim_id=p_claim_id and b.shipment_id=shipment_key) end,
     collected_at=clock_timestamp(),collected_by=actor,evidence=p_evidence,
     received_on=(select max(coalesce(b.received_on,(b.collected_at at time zone 'Asia/Seoul')::date)) from public.order_claim_collection_bundles b
       where b.claim_id=p_claim_id and b.shipment_id=shipment_key)
   where claim_id=p_claim_id and shipment_id=shipment_key and collected_at is null;
 end if;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.claim_origin_collected','order:'||order_key::text,
  jsonb_build_object('claimId',p_claim_id,'shipmentId',shipment_key,'bundleId',bundle.id,'returnAddressId',bundle.return_address_id,
   'originId',collection.origin_id,'items',bundle.items_snapshot,'returnAddress',address_value,'evidence',p_evidence,
   'receivedOn',received,'shipmentCollected',shipment_collected,'collectionWaived',private.claim_collection_waived(p_claim_id,shipment_key)));
 -- 회수 완료는 회수가 끝날 때 한 번 적고 알린다(private.complete_order_claim_collection, ADR-0041 회수 생략 규칙 포함).
 perform private.complete_order_claim_collection(p_claim_id);
 return case when private.claim_collections_complete(p_claim_id) then 'collected' else 'collecting' end;
end $$;
revoke all on function private.record_order_claim_collection_bundle(uuid,uuid,uuid,text,date) from public,anon,authenticated,service_role;

-- 배송 건 키(지금까지의 계약): 묶음이 하나인 배송 건을 확인한다.
create or replace function public.admin_record_order_claim_origin_collection(p_claim_id uuid, p_shipment_id uuid, p_evidence text, p_received_on date)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare actor uuid:=(select auth.uid());
begin
 perform private.require_operator_capability('sales.manage',false);
 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required'; end if;
 if p_shipment_id is null then raise no_data_found using message='claim_collection_not_found'; end if;
 return private.record_order_claim_collection_bundle(p_claim_id,p_shipment_id,null,p_evidence,p_received_on);
end $function$;

-- 회수 묶음 키: 반품지가 갈린 배송 건은 묶음마다 확인한다.
create function public.admin_record_order_claim_collection_bundle(p_claim_id uuid, p_bundle_id uuid, p_evidence text, p_received_on date)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare actor uuid:=(select auth.uid());
begin
 perform private.require_operator_capability('sales.manage',false);
 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required'; end if;
 if p_bundle_id is null then raise no_data_found using message='claim_collection_not_found'; end if;
 return private.record_order_claim_collection_bundle(p_claim_id,null,p_bundle_id,p_evidence,p_received_on);
end $function$;

revoke all on function public.admin_record_order_claim_origin_collection(uuid,uuid,text,date) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_origin_collection(uuid,uuid,text,date) to authenticated;
revoke all on function public.admin_record_order_claim_collection_bundle(uuid,uuid,text,date) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_collection_bundle(uuid,uuid,text,date) to authenticated;
select private.register_operator_rpc_contract('public.admin_record_order_claim_collection_bundle(uuid,uuid,text,date)'::regprocedure,'sales.manage','write',false);

-- 앵커 치환(재정의 최소화). 각 앵커는 정확히 한 번 나와야 한다.
create function pg_temp.patch_function(p_function regprocedure,p_anchor text,p_replacement text) returns void language plpgsql as $$
declare definition text:=pg_get_functiondef(p_function);
begin
 if (length(definition)-length(replace(definition,p_anchor,'')))/length(p_anchor)<>1 then
  raise exception '% anchor must appear once',p_function;end if;
 execute replace(definition,p_anchor,p_replacement);
end $$;

-- 운영 상세(admin_order_claim_detail → claim.collections): 배송 건 회수 행마다 반품지별 묶음.
select pg_temp.patch_function('private.claim_collection_records(uuid)'::regprocedure,
 $a$'collectionWaived',private.claim_collection_waived(x.claim_id,x.shipment_id))$a$,
 $a$'collectionWaived',private.claim_collection_waived(x.claim_id,x.shipment_id),
  'bundles',private.claim_collection_bundles_json(x.claim_id,x.shipment_id,true))$a$);

-- 단계 일괄 처리 사실(admin_order_claim_bulk_context): 일괄 회수 확인의 단위가 묶음이다.
select pg_temp.patch_function('private.order_claim_bulk_context_row(uuid)'::regprocedure,
 $a$and coalesce(btrim(o.return_address),'')<>''))$a$,
 $a$and coalesce(btrim(o.return_address),'')<>''),
    'bundles',private.claim_collection_bundles_json(x.claim_id,x.shipment_id,true))$a$);

-- 고객·운영 회수 문서(read_my_claim_collection_plan·admin_read_claim_collection_plan): 키는 회수 생략 결정이 있는 배송 건에만
-- 더한다(이전 앱의 정확 키 파서가 기존 문서를 그대로 읽는다). 승인 뒤 배송 묶음마다 회수 주소(returnBundles)는 이 문서에
-- 키를 더하지 않고 아래 별도 읽기 RPC가 내보낸다 — 백필로 승인된 모든 클레임의 문서 모양이 배포 순간에 바뀌지 않게 한다.
select pg_temp.patch_function('private.claim_collection_document(uuid)'::regprocedure,
 $a$then jsonb_build_object('reshipped',true) else '{}'::jsonb end order by s.id)$a$,
 $a$then jsonb_build_object('reshipped',true) else '{}'::jsonb end
  ||case when x.claim_id is not null and private.claim_collection_waived(c.id,s.id) then jsonb_build_object('collectionWaived',true) else '{}'::jsonb end order by s.id)$a$);

-- 회수 묶음의 회수 주소 읽기(승인 뒤 배송 건마다). 본인(선물이면 받는 분)·운영자만, 보낸 분은 null. 묶음이 생기기 전(승인 전)은 빈 배열이다.
create function public.read_my_claim_return_bundles(p_claim uuid,p_actor uuid,p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare viewer text;begin
 perform private.purchase_confirmation_identity(p_actor,p_session,false);
 select case when g.recipient_id=p_actor then 'recipient' when g.sender_id=p_actor then 'sender' when g.id is null and o.user_id=p_actor then 'buyer' end
 into viewer from public.order_cancellation_requests c join public.orders o on o.id=c.order_id left join private.gift_intents g on g.order_id=o.id where c.id=p_claim;
 if viewer is null then raise no_data_found using message='claim_not_found';end if;
 if viewer='sender' then return null;end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('shipmentId',x.shipment_id,'returnBundles',private.claim_collection_bundles_json(x.claim_id,x.shipment_id,false)) order by x.shipment_id),'[]'::jsonb)
  from public.order_claim_collections x where x.claim_id=p_claim);
end $$;
create function public.admin_read_claim_return_bundles(p_claim uuid,p_actor uuid,p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.purchase_confirmation_identity(p_actor,p_session,true);
 return(select coalesce(jsonb_agg(jsonb_build_object('shipmentId',x.shipment_id,'returnBundles',private.claim_collection_bundles_json(x.claim_id,x.shipment_id,false)) order by x.shipment_id),'[]'::jsonb)
  from public.order_claim_collections x where x.claim_id=p_claim);
end $$;
revoke all on function public.read_my_claim_return_bundles(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_my_claim_return_bundles(uuid,uuid,uuid) to authenticated;
revoke all on function public.admin_read_claim_return_bundles(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_claim_return_bundles(uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_read_claim_return_bundles(uuid,uuid,uuid)'::regprocedure,'sales.manage','read',false);

-- 일부만 입고된 배송 건은 회수 생략을 거절한다(회수 생략 결정·회수 생략 재출고 둘 다). 배송 건 행 입고는 기존 collection_waiver_not_needed가,
-- 묶음 일부 입고는 collection_waiver_partially_received가 막는다 — 입고된 묶음 품목이 재고 대조 회수 수량에서 사라지지 않게 한다.
select pg_temp.patch_function('private.record_claim_collection_waiver(public.order_cancellation_requests,uuid,text,uuid[],uuid,timestamptz)'::regprocedure,
 $a$if target.collected_at is not null then raise check_violation using message='collection_waiver_not_needed';end if;$a$,
 $a$if target.collected_at is not null then raise check_violation using message='collection_waiver_not_needed';end if;
 if private.claim_collection_partially_received(p_claim.id,p_shipment_id) then raise check_violation using message='collection_waiver_partially_received';end if;$a$);
select pg_temp.patch_function('private.record_order_claim_shipment_reshipment(uuid,uuid,text,text,jsonb,jsonb)'::regprocedure,
 $a$if target.collected_at is not null then raise check_violation using message='collection_waiver_not_needed';end if;$a$,
 $a$if target.collected_at is not null then raise check_violation using message='collection_waiver_not_needed';end if;
  if private.claim_collection_partially_received(p_claim_id,p_shipment_id) then raise check_violation using message='collection_waiver_partially_received';end if;$a$);

-- 재고 대조 흐름의 묶음 단위 회수 시각은 20261113001400_claim_collection_bundle_stock_flows.sql이 맡는다(배송 건 기준 통합
-- migration 20261113120000 뒤에 적용돼야 한다).

-- 철회 차단: 묶음 하나라도 입고되면 회수가 시작된 것이다(배송 건 행은 모든 묶음이 입고된 뒤에야 적힌다).
select pg_temp.patch_function('private.order_claim_withdrawal_blocker(public.order_cancellation_requests)'::regprocedure,
 $a$or exists(select 1 from public.order_claim_collections where claim_id=p_claim.id and collected_at is not null)$a$,
 $a$or exists(select 1 from public.order_claim_collections where claim_id=p_claim.id and collected_at is not null)
   or exists(select 1 from public.order_claim_collection_bundles where claim_id=p_claim.id and collected_at is not null)$a$);

-- 판매자 접수 화면의 현재 반송지도 상품 우선으로 보인다.
select pg_temp.patch_function('private.seller_claim_collection_targets(uuid)'::regprocedure,
 $a$'returnAddress', origin.return_address,$a$,
 $a$'returnAddress', private.shipment_return_address_summary(s.id),$a$);

-- 재정의한 함수의 등록된 계약을 새 본문·ACL로 다시 적는다(분류는 기존 행 그대로).
do $$declare fn regprocedure;contract record;begin
 foreach fn in array array[
  'public.admin_record_order_claim_origin_collection(uuid,uuid,text,date)'::regprocedure,
  'private.prepare_claim_collections(uuid,boolean)'::regprocedure,
  'private.claim_collection_records(uuid)'::regprocedure,
  'private.order_claim_bulk_context_row(uuid)'::regprocedure,
  'private.claim_collection_document(uuid)'::regprocedure,
  'private.order_claim_withdrawal_blocker(public.order_cancellation_requests)'::regprocedure,
  'private.seller_claim_collection_targets(uuid)'::regprocedure,
  'private.record_claim_collection_waiver(public.order_cancellation_requests,uuid,text,uuid[],uuid,timestamptz)'::regprocedure,
  'private.record_order_claim_shipment_reshipment(uuid,uuid,text,text,jsonb,jsonb)'::regprocedure] loop
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);
  elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);
  end if;
 end loop;
end $$;

commit;
notify pgrst,'reload schema';
