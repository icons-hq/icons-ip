\set ON_ERROR_STOP on
-- 재고 파일 대조 흐름(private.stock_reconcile_flows)을 배송 건(출고지) 기준으로 센다 — 웨이브 2 통합(T07 × T11a·T11b).
-- 김포·남양주 두 배송 건 하자 교환: 김포는 입고 확인 뒤 재출고하고, 남양주는 회수 생략을 결정한 뒤 회수 없이 재출고한다.
--   · 기준 시각 뒤 회수·회수 뒤 재고 미반영: 김포 품목은 김포 입고 시각에 돌아오고 김포 재출고 때 재고에 반영된다.
--     남양주 품목은 창고로 돌아오지 않으므로(회수 생략) 세지 않는다. 클레임 회수 완료 시각(남양주 결정 때)으로 세지 않는다.
--   · 기준 시각 뒤 출고(교환 재출고): 배송 건마다 그 재출고 시각이다(클레임 재출고 시각 = 첫 배송 건 시각이 아니다).
-- 합성 데이터만 쓰고 롤백한다. 결제사·택배사·저장소 API는 부르지 않는다.
begin;
load 'safeupdate';
create function pg_temp.sc_id(kind text,n integer) returns uuid language sql immutable as $$select md5('stock-claim-shipments:'||kind||':'||n)::uuid$$;
create function pg_temp.sc_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'stock reconcile claim shipments assertion: %',label;end if;end$$;
-- 옵션 하나의 네 흐름 값을 한 객체로 본다.
create function pg_temp.sc_flow(variant uuid,as_of timestamptz) returns jsonb language sql stable as $$
 select jsonb_build_object('pending',f.pending_qty,'shipped',f.shipped_since_qty,'returned',f.returned_since_qty,'awaiting',f.awaiting_return_qty)
 from private.stock_reconcile_flows(array[variant],as_of) f$$;
create function pg_temp.sc_flow_is(variant uuid,as_of timestamptz,pending bigint,shipped bigint,returned bigint,awaiting bigint) returns boolean language sql stable as $$
 select pg_temp.sc_flow(variant,as_of)=jsonb_build_object('pending',pending,'shipped',shipped,'returned',returned,'awaiting',awaiting)$$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.sc_id('user',n),'authenticated','authenticated','stock-claim-shipments-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3)n;
update public.profiles set nickname='TEST 재고 대조 '||right(id::text,6),
 role=case when id=pg_temp.sc_id('user',2) then 'user'::public.user_role else 'admin'::public.user_role end
 where id in(select pg_temp.sc_id('user',n) from generate_series(1,3)n);
insert into private.operator_memberships(profile_id,manager_role) select pg_temp.sc_id('user',3),'owner' where not exists(select 1 from private.operator_memberships where manager_role='owner');
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.sc_id('user',1),'primary');
update private.operator_access_state set configured=true where id;

insert into public.ips(id,title,vertical_key) values('sc-ip','TEST 재고 대조 출고지','character');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active) values
 (pg_temp.sc_id('origin',1),'sc-gimpo','TEST 대조 김포','hanjin',0,'TEST 김포 반송지',true),
 (pg_temp.sc_id('origin',2),'sc-namyangju','TEST 대조 남양주','hanjin',0,'TEST 남양주 반송지',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values
 ('sc-good-1','sc-ip','TEST 대조 김포 굿즈','문구',1000,'ok',10,pg_temp.sc_id('origin',1)),
 ('sc-good-2','sc-ip','TEST 대조 남양주 굿즈','문구',2000,'ok',10,pg_temp.sc_id('origin',2));
insert into public.goods_variants(id,good_id,name,price,stock_qty,sort_order) values
 (pg_temp.sc_id('variant',1),'sc-good-1','TEST 대조 김포 파랑',1000,5,1),
 (pg_temp.sc_id('variant',2),'sc-good-2','TEST 대조 남양주 빨강',2000,5,1);
create function pg_temp.sc_default(good text) returns uuid language sql stable as $$select id from public.goods_variants where good_id=good and is_default$$;
create function pg_temp.sc_stock(variant uuid) returns integer language sql stable as $$select stock_qty from public.goods_variants where id=variant$$;

-- 주문: 김포 1개(배송 건 1) + 남양주 2개(배송 건 2). 사흘 전 출고·이틀 전 배송완료.
insert into public.orders(id,user_id,status,total,shipping_fee,address,shipped_at,delivered_at) values
 (pg_temp.sc_id('order',1),pg_temp.sc_id('user',2),'delivered',5000,0,
  jsonb_build_object('recipientName','합성 고객','phone','010-0000-0000','postalCode','12345','address1','합성시 대조로 1','address2','101호'),
  now()-interval '3 days',now()-interval '2 days');
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot) values
 (pg_temp.sc_id('item',1),pg_temp.sc_id('order',1),'sc-good-1',pg_temp.sc_default('sc-good-1'),1,1000,'TEST 대조 김포 굿즈','문구','sc-ip'),
 (pg_temp.sc_id('item',2),pg_temp.sc_id('order',1),'sc-good-2',pg_temp.sc_default('sc-good-2'),2,2000,'TEST 대조 남양주 굿즈','문구','sc-ip');
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at) values
 (pg_temp.sc_id('shipment',1),pg_temp.sc_id('order',1),pg_temp.sc_id('origin',1),'TEST 대조 김포',0,'{}','delivered','hanjin','SCSALE000001',now()-interval '3 days',now()-interval '2 days'),
 (pg_temp.sc_id('shipment',2),pg_temp.sc_id('order',1),pg_temp.sc_id('origin',2),'TEST 대조 남양주',0,'{}','delivered','hanjin','SCSALE000002',now()-interval '3 days',now()-interval '2 days');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values
 (pg_temp.sc_id('order',1),pg_temp.sc_id('shipment',1),pg_temp.sc_id('item',1),1),
 (pg_temp.sc_id('order',1),pg_temp.sc_id('shipment',2),pg_temp.sc_id('item',2),2);
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type) values
 (pg_temp.sc_id('claim',1),pg_temp.sc_id('order',1),pg_temp.sc_id('user',2),'TEST 김포·남양주 하자 교환 재고 대조','exchange','requested','defect');

select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub',pg_temp.sc_id('user',1)::text,true);
select public.admin_decide_order_claim(pg_temp.sc_id('claim',1),'approve',null);
select pg_temp.sc_assert((select count(*)=2 from public.order_claim_collections where claim_id=pg_temp.sc_id('claim',1))
 and (select stage='collecting' from public.order_cancellation_requests where id=pg_temp.sc_id('claim',1)),'approval snapshots one collection per origin');
-- 클레임 전: 두 품목 모두 사흘 전에 창고를 떠났고 돌아온 것이 없다.
select clock_timestamp() as t0 \gset
select pg_sleep(0.02);
select pg_temp.sc_assert(pg_temp.sc_flow_is(pg_temp.sc_default('sc-good-1'),:'t0',0,0,0,0)
 and pg_temp.sc_flow_is(pg_temp.sc_default('sc-good-2'),:'t0',0,0,0,0),'nothing returned before the claim');

-- 1) 김포 입고 확인: 클레임은 수거중(남양주 미회수)이어도 김포 품목은 김포 입고 시각에 창고로 돌아왔다. 재출고 전이라 재고 미반영.
select public.admin_record_order_claim_origin_collection(pg_temp.sc_id('claim',1),pg_temp.sc_id('shipment',1),'TEST 김포 입고 1개 확인');
select pg_sleep(0.02);
select clock_timestamp() as t1 \gset
select pg_sleep(0.02);
select pg_temp.sc_assert((select stage='collecting' and collected_at is null from public.order_cancellation_requests where id=pg_temp.sc_id('claim',1))
 and pg_temp.sc_flow_is(pg_temp.sc_default('sc-good-1'),:'t0',0,0,1,1)
 and pg_temp.sc_flow_is(pg_temp.sc_default('sc-good-1'),:'t1',0,0,0,1)
 and pg_temp.sc_flow_is(pg_temp.sc_default('sc-good-2'),:'t0',0,0,0,0),
 'the collected origin returns at its own intake while the claim is still collecting');

-- 2) 남양주 회수 생략 결정: 다른 출고지가 입고됐으므로 클레임 회수가 끝난다(입고완료). 남양주 품목은 돌아오지 않았다.
insert into storage.objects(bucket_id,name,metadata) values
 ('claim-evidence-private',pg_temp.sc_id('claim',1)||'/'||pg_temp.sc_id('file',1)||'.jpg',jsonb_build_object('mimetype','image/jpeg','size',2048));
select public.admin_register_claim_evidence_file(pg_temp.sc_id('claim',1),pg_temp.sc_id('file',1),'image/jpeg',2048,repeat('c',64))->>'id' as evidence_one \gset
select public.admin_waive_order_claim_collection(pg_temp.sc_id('claim',1),pg_temp.sc_id('shipment',2),
 jsonb_build_object('reason','TEST 박스 파손 사진으로 회수 생략','evidenceFileIds',jsonb_build_array(pg_temp.sc_id('file',1))))->>'claimId' as waived_claim \gset
select pg_sleep(0.02);
select clock_timestamp() as t2 \gset
select pg_sleep(0.02);
select pg_temp.sc_assert(:'evidence_one'=pg_temp.sc_id('file',1)::text and :'waived_claim'=pg_temp.sc_id('claim',1)::text
 and (select stage='collected' and collected_at>:'t1'::timestamptz from public.order_cancellation_requests where id=pg_temp.sc_id('claim',1))
 and private.claim_collection_waived(pg_temp.sc_id('claim',1),pg_temp.sc_id('shipment',2)),'waiver completes the claim collection');
-- 클레임 회수 완료 시각(t1 뒤)이 아니라 김포 입고 시각으로 센다. 남양주 2개는 회수에도 재고 미반영에도 들지 않는다.
select pg_temp.sc_assert(pg_temp.sc_flow_is(pg_temp.sc_default('sc-good-1'),:'t0',0,0,1,1)
 and pg_temp.sc_flow_is(pg_temp.sc_default('sc-good-1'),:'t1',0,0,0,1)
 and pg_temp.sc_flow_is(pg_temp.sc_default('sc-good-2'),:'t0',0,0,0,0)
 and pg_temp.sc_flow_is(pg_temp.sc_default('sc-good-2'),:'t1',0,0,0,0),
 'per-origin intake time and the waived origin stay out of returned flows');

-- 3) 김포 재출고(파랑으로 교환): 회수품 +1, 파랑 −1. 김포 품목은 재고에 반영됐고 파랑 1개가 지금 나갔다.
select private.record_order_claim_shipment_reshipment(pg_temp.sc_id('claim',1),pg_temp.sc_id('shipment',1),'hanjin','SCGIMPO00001',
 jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.sc_id('item',1),'variantId',pg_temp.sc_id('variant',1)))) as first_reship \gset
select pg_sleep(0.02);
select clock_timestamp() as t3 \gset
select pg_sleep(0.02);
select pg_temp.sc_assert(:'first_reship'='reshipped'
 and pg_temp.sc_stock(pg_temp.sc_default('sc-good-1'))=11 and pg_temp.sc_stock(pg_temp.sc_id('variant',1))=4
 and pg_temp.sc_flow_is(pg_temp.sc_default('sc-good-1'),:'t0',0,0,1,0)
 and pg_temp.sc_flow_is(pg_temp.sc_id('variant',1),:'t2',0,1,0,0)
 and pg_temp.sc_flow_is(pg_temp.sc_id('variant',1),:'t3',0,0,0,0),
 'the first origin reshipment restores its own return and ships at its own time');

-- 4) 남양주 회수 없이 재출고(빨강 2개): 회수품 복원 없이 빨강 −2, 두 곳 모두 재출고돼 종결. 클레임 재출고 시각은 김포(첫) 시각이지만
--    빨강 2개는 남양주 재출고 시각(t3 뒤)에 나갔다.
select private.record_order_claim_shipment_reshipment(pg_temp.sc_id('claim',1),pg_temp.sc_id('shipment',2),'hanjin','SCNAMYANG001',
 jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.sc_id('item',2),'variantId',pg_temp.sc_id('variant',2)))) as second_reship \gset
select pg_temp.sc_assert(:'second_reship'='completed'
 and (select stage='completed' and reshipped_at<:'t3'::timestamptz from public.order_cancellation_requests where id=pg_temp.sc_id('claim',1))
 and (select collection_waived from public.order_claim_reshipments where claim_id=pg_temp.sc_id('claim',1) and shipment_id=pg_temp.sc_id('shipment',2))
 and pg_temp.sc_stock(pg_temp.sc_default('sc-good-2'))=10 and pg_temp.sc_stock(pg_temp.sc_id('variant',2))=3
 and pg_temp.sc_flow_is(pg_temp.sc_id('variant',2),:'t3',0,2,0,0)
 and pg_temp.sc_flow_is(pg_temp.sc_id('variant',2),:'t0',0,2,0,0)
 and pg_temp.sc_flow_is(pg_temp.sc_id('variant',1),:'t3',0,0,0,0)
 and pg_temp.sc_flow_is(pg_temp.sc_default('sc-good-2'),:'t0',0,0,0,0)
 and pg_temp.sc_flow_is(pg_temp.sc_default('sc-good-1'),:'t0',0,0,1,0),
 'the waived origin reships at its own time and never counts as returned');

-- 여러 옵션을 한 번에 물어도 옵션마다 같은 값이다(재고 대조 미리보기는 옵션 묶음으로 부른다).
select pg_temp.sc_assert((select count(*)=4 and sum(shipped_since_qty)=3 and sum(returned_since_qty)=1 and sum(awaiting_return_qty)=0
 from private.stock_reconcile_flows(array[pg_temp.sc_default('sc-good-1'),pg_temp.sc_default('sc-good-2'),pg_temp.sc_id('variant',1),pg_temp.sc_id('variant',2)],:'t0')),
 'batched variants keep per-variant flows');

rollback;
