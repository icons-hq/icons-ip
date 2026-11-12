\set ON_ERROR_STOP on
-- 상품별 반품/교환지(S36-040·QNA-031)와 교환·반품 가능/제한 표시(S36-044)의 DB 계약.
-- 1. 반품/교환지 주소록: platform.manage만 저장·삭제하고, catalog.read 운영자만 표를 읽는다. 고객은 공개 RPC로만 본다.
-- 2. 상품 반품지: 비우면 출고지 반품 주소. 공개 상세(get_good_shipping_policy)의 회수 주소는 상품 우선이다.
-- 3. 승인 때 회수 주소를 상품 우선으로 스냅샷하고, 한 배송 건 안에서 반품지가 갈리면 회수 묶음을 나눈다
--    (배송 건 × 반품지). 회수 확인은 묶음마다, 배송 건 행은 모든 묶음이 입고된 때 완료된다.
-- 4. 고객 회수 문서는 승인 뒤 배송 묶음마다 회수 주소를 싣고, 선물 주문은 받는 분에게만 보인다.
-- 5. 교환·반품 제한 상품도 신청은 받는다(제한 표시는 고지일 뿐 접수 차단이 아니다).
-- 합성 데이터만 쓰고 롤백한다. 결제사·택배사 API는 부르지 않는다.
begin;
load 'safeupdate';
create function pg_temp.ra_id(kind text,n integer) returns uuid language sql immutable as $$select md5('goods-return-address:'||kind||':'||n)::uuid$$;
create function pg_temp.ra_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'return-address assertion: %',label;end if;end$$;
create function pg_temp.ra_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected return-address rejection: %',expected;end$$;
create function pg_temp.ra_today() returns date language sql stable as $$select (clock_timestamp() at time zone 'Asia/Seoul')::date$$;
create function pg_temp.ra_as(n integer) returns void language sql as $$
 select set_config('request.jwt.claim.sub',pg_temp.ra_id('user',n)::text,true);
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ra_id('user',n),'role','authenticated','session_id',pg_temp.ra_id('session',n))::text,true);
$$;

-- 진입점·표의 권한.
select pg_temp.ra_assert(
 has_function_privilege('authenticated','public.admin_save_return_address(uuid,jsonb,timestamptz)','execute')
 and not has_function_privilege('anon','public.admin_save_return_address(uuid,jsonb,timestamptz)','execute')
 and not has_function_privilege('service_role','public.admin_save_return_address(uuid,jsonb,timestamptz)','execute')
 and has_function_privilege('authenticated','public.admin_delete_return_address(uuid,timestamptz)','execute')
 and not has_function_privilege('anon','public.admin_delete_return_address(uuid,timestamptz)','execute')
 and has_function_privilege('authenticated','public.admin_record_order_claim_collection_bundle(uuid,uuid,text,date)','execute')
 and not has_function_privilege('anon','public.admin_record_order_claim_collection_bundle(uuid,uuid,text,date)','execute')
 and not has_function_privilege('service_role','public.admin_record_order_claim_collection_bundle(uuid,uuid,text,date)','execute')
 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in('claim_shipment_return_lines','shipment_return_address_summary','claim_collection_bundles_json','record_order_claim_collection_bundle','prepare_claim_collections')
  and(has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')))
 and not has_table_privilege('authenticated','public.return_addresses','insert,update,delete')
 and not has_table_privilege('anon','public.return_addresses','select')
 and not has_table_privilege('service_role','public.return_addresses','select,insert,update,delete')
 and not has_table_privilege('authenticated','public.order_claim_collection_bundles','select,insert,update,delete')
 and not has_table_privilege('anon','public.order_claim_collection_bundles','select')
 and not has_table_privilege('service_role','public.order_claim_collection_bundles','select,insert,update,delete')
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_save_return_address(uuid,jsonb,timestamp with time zone)' and capability='platform.manage' and guard_kind='write' and legacy_admin_only)
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_delete_return_address(uuid,timestamp with time zone)' and capability='platform.manage' and guard_kind='write')
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_record_order_claim_collection_bundle(uuid,uuid,text,date)' and capability='sales.manage' and guard_kind='write')
 and exists(select 1 from private.operator_policy_contracts where table_name='return_addresses' and policy_name='return_addresses_catalog_read' and capability='catalog.read'),
 'entry points and tables are sealed and classified');
-- 이 기능 전의 배송 건 회수 행은 모두 묶음 하나로 옮겨졌다.
select pg_temp.ra_assert(not exists(select 1 from public.order_claim_collections x where not exists(select 1 from public.order_claim_collection_bundles b
 where b.claim_id=x.claim_id and b.shipment_id=x.shipment_id)),'every shipment collection has a bundle');

-- 사람: 1 primary(설정·판매·상품), 2 고객(구매자·선물 보낸 분), 3 선물 받은 분, 4 deputy(상품만), 5 owner.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.ra_id('user',n),'authenticated','authenticated','goods-return-address-'||n||'@example.test',now(),'{}','{}' from generate_series(1,5)n;
update public.profiles set nickname='TEST 반품지 '||right(id::text,6),
 role=case when id in(pg_temp.ra_id('user',2),pg_temp.ra_id('user',3)) then 'user'::public.user_role else 'admin'::public.user_role end
 where id in(select pg_temp.ra_id('user',n) from generate_series(1,5)n);
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) select pg_temp.ra_id('session',n),pg_temp.ra_id('user',n),now(),now(),'aal1',now()+interval '1 hour' from generate_series(1,5)n;
insert into private.operator_memberships(profile_id,manager_role) select pg_temp.ra_id('user',5),'owner' where not exists(select 1 from private.operator_memberships where manager_role='owner');
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.ra_id('user',1),'primary'),(pg_temp.ra_id('user',4),'deputy');
update private.operator_access_state set configured=true where id;

-- ---------------------------------------------------------------------------
-- 1. 주소록
-- ---------------------------------------------------------------------------
select pg_temp.ra_as(4);
set local role authenticated;
select pg_temp.ra_error($q$select public.admin_save_return_address(null,'{"name":"권한 없음","address":"합성 주소","phone":"02-0000-0000"}',null)$q$,'42501');
reset role;
select pg_temp.ra_as(1);
set local role authenticated;
select public.admin_save_return_address(null,jsonb_build_object('name','서울 반품지','address','서울특별시 합성구 반품로 1 TEST','phone','02-1234-5678'),null)->>'id' as seoul_id \gset
select public.admin_save_return_address(null,jsonb_build_object('name','부산 반품지','address','부산광역시 합성구 반품로 2 TEST','phone','051-123-4567'),null)->>'id' as busan_id \gset
select pg_temp.ra_error($q$select public.admin_save_return_address(null,'{"name":"서울 반품지","address":"다른 주소","phone":"02-0000-0000"}',null)$q$,'return_address_name_taken');
select pg_temp.ra_error($q$select public.admin_save_return_address(null,'{"name":"연락처 오류","address":"합성 주소","phone":"02--1234"}',null)$q$,'invalid_return_address');
select pg_temp.ra_error($q$select public.admin_save_return_address(null,'{"name":"키 오류","address":"합성 주소","phone":"0212345678","memo":"x"}',null)$q$,'invalid_return_address');
select pg_temp.ra_error(format($q$select public.admin_save_return_address(%L,'{"name":"서울 반품지","address":"오래된 화면","phone":"02-1234-5678"}','2001-01-01T00:00:00Z')$q$,:'seoul_id'),'return_address_conflict');
-- 같은 값 저장은 멱등이고 감사를 남기지 않는다.
select pg_temp.ra_assert((public.admin_save_return_address(:'busan_id',jsonb_build_object('name','부산 반품지','address','부산광역시 합성구 반품로 2 TEST','phone','051-123-4567'),
 (select updated_at from public.return_addresses where id=:'busan_id'))->>'replayed')::boolean,'unchanged save replays');
reset role;
select pg_temp.ra_assert((select count(*) from public.audit_log where action='admin.return_address.saved' and target in('return_addresses:'||:'seoul_id','return_addresses:'||:'busan_id'))=2,
 'one saved audit per new address');
-- 표 읽기: 상품 운영자(catalog.read)는 보고, 고객은 보지 못한다.
select pg_temp.ra_as(4);
set local role authenticated;
select pg_temp.ra_assert((select count(*) from public.return_addresses where id in(:'seoul_id',:'busan_id'))=2,'catalog operator reads the address book');
reset role;
select pg_temp.ra_as(2);
set local role authenticated;
select pg_temp.ra_assert(not exists(select 1 from public.return_addresses),'customer cannot read the address book');
reset role;

-- ---------------------------------------------------------------------------
-- 2. 상품 반품지와 공개 상세
-- ---------------------------------------------------------------------------
insert into public.ips(id,title,vertical_key,published_at) values('ra-ip','TEST 반품지','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active) values
 (pg_temp.ra_id('origin',1),'ra-gimpo','TEST 김포','hanjin',0,'TEST 김포 출고지 반품 주소',true),
 (pg_temp.ra_id('origin',2),'ra-namyangju','TEST 남양주','hanjin',0,'TEST 남양주 출고지 반품 주소',true),
 (pg_temp.ra_id('origin',3),'ra-empty','TEST 반품 주소 없는 출고지','hanjin',0,'',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values
 ('ra-good-a','ra-ip','TEST 서울 반품 굿즈','문구',1000,'ok',20,pg_temp.ra_id('origin',1)),
 ('ra-good-b','ra-ip','TEST 출고지 반품 굿즈','문구',1000,'ok',20,pg_temp.ra_id('origin',1)),
 ('ra-good-c','ra-ip','TEST 남양주 굿즈','문구',1000,'ok',20,pg_temp.ra_id('origin',2)),
 ('ra-good-d','ra-ip','TEST 빈 출고지·부산 반품 굿즈','문구',1000,'ok',20,pg_temp.ra_id('origin',3)),
 ('ra-good-e','ra-ip','TEST 빈 출고지 굿즈','문구',1000,'ok',20,pg_temp.ra_id('origin',3)),
 ('ra-good-r','ra-ip','TEST 반품 제한 굿즈','문구',1000,'ok',20,pg_temp.ra_id('origin',1));
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}'
 from public.goods where id like 'ra-good-%';
update public.profiles set role='staff' where id in(select ('47c47700'||left(md5(id),24))::uuid from public.goods where id like 'ra-good-%');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id like 'ra-good-%';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'ra-good-%' order by id;
create function pg_temp.ra_variant(good text) returns uuid language sql stable as $$select id from public.goods_variants where good_id=good and is_default$$;

select pg_temp.ra_as(1);
set local role authenticated;
select public.admin_save_good_claim_policy('ra-good-a',jsonb_build_object('returnAddressId',:'seoul_id'),(select updated_at from public.goods where id='ra-good-a'));
select public.admin_save_good_claim_policy('ra-good-d',jsonb_build_object('returnAddressId',:'busan_id'),(select updated_at from public.goods where id='ra-good-d'));
select public.admin_save_good_claim_policy('ra-good-r',jsonb_build_object('returnAllowed',false,'exchangeAllowed',false,'restrictionReason','포장을 뜯으면 반품할 수 없습니다'),
 (select updated_at from public.goods where id='ra-good-r'));
select pg_temp.ra_error(format($q$select public.admin_save_good_claim_policy('ra-good-b','{"returnAddressId":"%s"}',(select updated_at from public.goods where id='ra-good-b'))$q$,
 pg_temp.ra_id('missing',1)),'return_address_not_found');
select pg_temp.ra_error($q$select public.admin_save_good_claim_policy('ra-good-b','{"returnAddressId":"서울"}',(select updated_at from public.goods where id='ra-good-b'))$q$,'invalid_good_claim_policy');
-- 반품지 키가 없는 저장(배송정보 템플릿 적용·이전 화면)은 반품지를 바꾸지 않는다.
select public.admin_save_good_claim_policy('ra-good-a','{"returnAllowed":true}',(select updated_at from public.goods where id='ra-good-a'));
reset role;
select pg_temp.ra_assert((select return_address_id from public.goods where id='ra-good-a')=:'seoul_id'::uuid
 and (select return_address_id from public.goods where id='ra-good-b') is null
 and (select claim_return_allowed from public.goods where id='ra-good-a'),'policy save keeps the return address when the key is absent');
-- 상품 복사본은 원본의 반품지를 그대로 가진다.
select pg_temp.ra_as(1);
set local role authenticated;
select public.admin_clone_good(pg_temp.ra_id('clone-op',1),'ra-good-a','ra-good-a-copy','RA-GOOD-A-COPY','TEST 서울 반품 굿즈 복사');
reset role;
select pg_temp.ra_assert((select return_address_id from public.goods where id='ra-good-a-copy')=:'seoul_id'::uuid,'a cloned good keeps the return address');
select pg_temp.ra_assert(exists(select 1 from public.audit_log where action='catalog.good.claim_policy_updated' and target='goods:ra-good-a'
 and diff#>>'{after,returnAddressId}'=:'seoul_id' and diff#>'{before,returnAddressId}'='null'::jsonb),'return address change is audited');
-- 공개 상세: A는 서울 반품지, 비운 B는 출고지 반품 주소, 제한 상품은 조건을 그대로 싣는다.
select pg_temp.ra_assert(public.get_good_shipping_policy('ra-good-a')->>'returnAddress'='서울특별시 합성구 반품로 1 TEST'
 and public.get_good_shipping_policy('ra-good-b')->>'returnAddress'='TEST 김포 출고지 반품 주소'
 and public.get_good_shipping_policy('ra-good-d')->>'returnAddress'='부산광역시 합성구 반품로 2 TEST'
 and public.get_good_shipping_policy('ra-good-r')#>'{claimPolicy,returnAllowed}'='false'::jsonb
 and public.get_good_shipping_policy('ra-good-r')#>>'{claimPolicy,restrictionReason}'='포장을 뜯으면 반품할 수 없습니다'
 and public.get_good_shipping_policy('ra-good-a')#>'{claimPolicy,returnAllowed}'='true'::jsonb,'public detail resolves the product return address first');
-- 상품이 고른 주소는 지울 수 없다.
select pg_temp.ra_as(1);
set local role authenticated;
select pg_temp.ra_error(format('select public.admin_delete_return_address(%L,%L)',:'seoul_id',(select updated_at from public.return_addresses where id=:'seoul_id')),'return_address_in_use');
reset role;

-- ---------------------------------------------------------------------------
-- 3. 승인 스냅샷과 회수 묶음
-- ---------------------------------------------------------------------------
-- 주문 1: 김포 배송 건 하나에 A(서울 반품지)·B(출고지), 남양주 배송 건에 C. 주문 2: 선물(A). 주문 3: 반품 제한 굿즈.
-- 주문 4: 반품 주소 없는 출고지의 D(부산 반품지). 주문 5: 같은 출고지의 E(반품지 없음).
insert into public.orders(id,user_id,status,total,shipping_fee,address,shipped_at,delivered_at,created_at)
 select pg_temp.ra_id('order',n),pg_temp.ra_id('user',2),'delivered',3000,0,
  jsonb_build_object('recipientName','합성 고객','phone','010-0000-0000','postalCode','12345','address1','합성시 반품로 1','address2','101호'),
  now()-interval '4 days',now()-interval '3 days',now()-interval '5 days' from generate_series(1,5)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.ra_id('item',item),pg_temp.ra_id('order',purchase),good,pg_temp.ra_variant(good),1,1000,name,'문구','ra-ip'
 from (values(1,1,'ra-good-a','TEST 서울 반품 굿즈'),(2,1,'ra-good-b','TEST 출고지 반품 굿즈'),(3,1,'ra-good-c','TEST 남양주 굿즈'),
  (4,2,'ra-good-a','TEST 서울 반품 굿즈'),(5,3,'ra-good-r','TEST 반품 제한 굿즈'),(6,4,'ra-good-d','TEST 빈 출고지·부산 반품 굿즈'),(7,5,'ra-good-e','TEST 빈 출고지 굿즈')) spec(item,purchase,good,name);
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at)
 select pg_temp.ra_id('shipment',shipment),pg_temp.ra_id('order',purchase),pg_temp.ra_id('origin',origin),label,0,'{}','delivered','hanjin','RASALE'||lpad(shipment::text,6,'0'),
  now()-interval '4 days',now()-interval '3 days'
 from (values(1,1,1,'TEST 김포'),(2,1,2,'TEST 남양주'),(3,2,1,'TEST 김포'),(4,3,1,'TEST 김포'),(5,4,3,'TEST 반품 주소 없는 출고지'),(6,5,3,'TEST 반품 주소 없는 출고지')) spec(shipment,purchase,origin,label);
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
 select pg_temp.ra_id('order',purchase),pg_temp.ra_id('shipment',shipment),pg_temp.ra_id('item',item),1
 from (values(1,1,1),(1,1,2),(1,2,3),(2,3,4),(3,4,5),(4,5,6),(5,6,7)) spec(purchase,shipment,item);
insert into private.gift_intents(id,sender_id,recipient_id,state,sender_label,recipient_label,expires_at,order_id,ordered_source_revision)
 values(pg_temp.ra_id('gift',2),pg_temp.ra_id('user',2),pg_temp.ra_id('user',3),'ordered','TEST 보낸 분','TEST 받는 분',now()+interval '1 day',pg_temp.ra_id('order',2),'1:synthetic');

-- 반품 제한 굿즈도 신청은 받는다(S36-044 — 표시는 고지일 뿐이다).
select pg_temp.ra_assert(public.request_order_claim(pg_temp.ra_id('order',3),pg_temp.ra_id('user',2),'return','TEST 제한 굿즈 반품','change_of_mind')='requested',
 'a restricted good still accepts a return request');
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type)
 select pg_temp.ra_id('claim',n),pg_temp.ra_id('order',n),pg_temp.ra_id('user',2),'TEST 반품지 반품 '||n,'return','requested','change_of_mind' from unnest(array[1,2,4,5])n;
-- 승인 전 회수 문서에는 묶음 키가 없다(이전 앱의 정확 키 파서와 호환).
select pg_temp.ra_as(2);
set local role authenticated;
select pg_temp.ra_assert(not exists(select 1 from jsonb_array_elements(public.read_my_claim_collection_plan(pg_temp.ra_id('claim',1),pg_temp.ra_id('user',2),pg_temp.ra_id('session',2))->'rows') r
 where r ? 'returnBundles' or r ? 'collectionWaived'),'pre-approval document keeps the old row keys');
reset role;

select pg_temp.ra_as(1);
select public.admin_decide_order_claim(pg_temp.ra_id('claim',n),'approve',null) from unnest(array[1,2,4])n;
select pg_temp.ra_error(format('select public.admin_decide_order_claim(%L,''approve'',null)',pg_temp.ra_id('claim',5)),'claim_return_address_required');
select pg_temp.ra_assert((select count(*) from public.order_claim_collections where claim_id=pg_temp.ra_id('claim',1))=2
 and (select count(*) from public.order_claim_collection_bundles where claim_id=pg_temp.ra_id('claim',1) and shipment_id=pg_temp.ra_id('shipment',1))=2
 and (select count(*) from public.order_claim_collection_bundles where claim_id=pg_temp.ra_id('claim',1) and shipment_id=pg_temp.ra_id('shipment',2))=1
 and exists(select 1 from public.order_claim_collection_bundles where claim_id=pg_temp.ra_id('claim',1) and shipment_id=pg_temp.ra_id('shipment',1)
   and return_address_id=:'seoul_id'::uuid and return_name_snapshot='서울 반품지' and return_address_snapshot='서울특별시 합성구 반품로 1 TEST'
   and return_phone_snapshot='02-1234-5678' and items_snapshot=jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.ra_id('item',1),'name','TEST 서울 반품 굿즈','qty',1)))
 and exists(select 1 from public.order_claim_collection_bundles where claim_id=pg_temp.ra_id('claim',1) and shipment_id=pg_temp.ra_id('shipment',1)
   and return_address_id is null and return_name_snapshot='' and return_address_snapshot='TEST 김포 출고지 반품 주소'
   and items_snapshot=jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.ra_id('item',2),'name','TEST 출고지 반품 굿즈','qty',1)))
 and (select return_address_snapshot from public.order_claim_collections where claim_id=pg_temp.ra_id('claim',1) and shipment_id=pg_temp.ra_id('shipment',1))
   like '%서울특별시 합성구 반품로 1 TEST%TEST 김포 출고지 반품 주소%'
 and (select count(*) from public.order_claim_collection_bundles where claim_id=pg_temp.ra_id('claim',4) and return_address_id=:'busan_id'::uuid
   and return_address_snapshot='부산광역시 합성구 반품로 2 TEST')=1,
 'approval splits one shipment into a bundle per return address, product first');
-- 다시 불려도(보류 해제 등) 이미 나눈 묶음에 품목을 겹쳐 넣지 않는다.
select private.prepare_claim_collections(pg_temp.ra_id('claim',1));
select pg_temp.ra_assert((select count(*) from public.order_claim_collection_bundles where claim_id=pg_temp.ra_id('claim',1))=3,'prepare is idempotent');

-- 운영 상세·일괄 처리 사실·판매자 접수 화면이 묶음을 본다.
select public.admin_order_claim_detail(pg_temp.ra_id('claim',1))#>'{claim,collections}' as detail_collections \gset
select pg_temp.ra_assert((select jsonb_array_length(c->'bundles') from jsonb_array_elements(:'detail_collections'::jsonb) c where c->>'shipmentId'=pg_temp.ra_id('shipment',1)::text)=2
 and (select c#>>'{bundles,0,returnAddress}' from jsonb_array_elements(:'detail_collections'::jsonb) c where c->>'shipmentId'=pg_temp.ra_id('shipment',1)::text)='TEST 김포 출고지 반품 주소'
 and (select c#>>'{bundles,1,returnName}' from jsonb_array_elements(:'detail_collections'::jsonb) c where c->>'shipmentId'=pg_temp.ra_id('shipment',1)::text)='서울 반품지'
 and (select jsonb_array_length(c->'bundles') from jsonb_array_elements(:'detail_collections'::jsonb) c where c->>'shipmentId'=pg_temp.ra_id('shipment',2)::text)=1,
 'admin claim detail lists two return bundles for the split shipment');
select pg_temp.ra_assert((select bool_and((b->>'returnAddressReady')::boolean) and count(*)=3
 from jsonb_array_elements(public.admin_order_claim_bulk_context(array[pg_temp.ra_id('claim',1)])->0->'collections') c cross join jsonb_array_elements(c->'bundles') b),
 'bulk context exposes each bundle as a collect target');
select pg_temp.ra_assert((select t->>'returnAddress' from jsonb_array_elements(private.seller_claim_collection_targets(pg_temp.ra_id('order',1))) t
 where t->>'shipmentId'=pg_temp.ra_id('shipment',1)::text) like '%서울특별시 합성구 반품로 1 TEST%'
 and (select t->>'returnAddress' from jsonb_array_elements(private.seller_claim_collection_targets(pg_temp.ra_id('order',5))) t)='',
 'seller intake shows the product-first return addresses and flags a missing one');

-- 고객 회수 문서: 배송 묶음마다 회수 주소. 내부 근거·처리자는 싣지 않는다. 선물은 받는 분에게만.
select pg_temp.ra_as(2);
set local role authenticated;
select public.read_my_claim_collection_plan(pg_temp.ra_id('claim',1),pg_temp.ra_id('user',2),pg_temp.ra_id('session',2)) as buyer_doc \gset
select pg_temp.ra_assert((select jsonb_array_length(r->'returnBundles') from jsonb_array_elements(:'buyer_doc'::jsonb->'rows') r where r->>'shipmentId'=pg_temp.ra_id('shipment',1)::text)=2
 and (select r#>>'{returnBundles,1,returnAddress}' from jsonb_array_elements(:'buyer_doc'::jsonb->'rows') r where r->>'shipmentId'=pg_temp.ra_id('shipment',1)::text)='서울특별시 합성구 반품로 1 TEST'
 and (select r#>>'{returnBundles,1,returnPhone}' from jsonb_array_elements(:'buyer_doc'::jsonb->'rows') r where r->>'shipmentId'=pg_temp.ra_id('shipment',1)::text)='02-1234-5678'
 and (select r#>'{returnBundles,1,items}' from jsonb_array_elements(:'buyer_doc'::jsonb->'rows') r where r->>'shipmentId'=pg_temp.ra_id('shipment',1)::text)
   =jsonb_build_array(jsonb_build_object('name','TEST 서울 반품 굿즈','qty',1))
 and not exists(select 1 from jsonb_array_elements(:'buyer_doc'::jsonb->'rows') r cross join jsonb_array_elements(r->'returnBundles') b
   where b ?| array['evidence','collectedBy','collectorName','returnAddressId','receivedOn']),
 'buyer sees a return address per bundle without internal fields');
select pg_temp.ra_assert(public.read_my_claim_collection_plan(pg_temp.ra_id('claim',2),pg_temp.ra_id('user',2),pg_temp.ra_id('session',2)) is null,
 'gift sender does not see the return address');
reset role;
select pg_temp.ra_as(3);
set local role authenticated;
select pg_temp.ra_assert(public.read_my_claim_collection_plan(pg_temp.ra_id('claim',2),pg_temp.ra_id('user',3),pg_temp.ra_id('session',3))#>>'{rows,0,returnBundles,0,returnAddress}'
 ='서울특별시 합성구 반품로 1 TEST','gift recipient sees the return address');
reset role;

-- 승인 뒤 주소록·상품 반품지를 바꿔도 스냅샷은 그대로다.
select pg_temp.ra_as(1);
set local role authenticated;
select public.admin_save_return_address(:'seoul_id',jsonb_build_object('name','서울 반품지','address','서울특별시 합성구 이전한 반품로 9 TEST','phone','02-1234-5678'),
 (select updated_at from public.return_addresses where id=:'seoul_id'));
select public.admin_save_good_claim_policy('ra-good-a','{"returnAddressId":null}',(select updated_at from public.goods where id='ra-good-a'));
reset role;
select pg_temp.ra_assert((select return_address_snapshot from public.order_claim_collection_bundles where claim_id=pg_temp.ra_id('claim',1) and return_address_id=:'seoul_id'::uuid)
 ='서울특별시 합성구 반품로 1 TEST' and public.get_good_shipping_policy('ra-good-a')->>'returnAddress'='TEST 김포 출고지 반품 주소',
 'approved snapshots do not follow later address book or product changes');

-- ---------------------------------------------------------------------------
-- 4. 묶음별 회수 확인
-- ---------------------------------------------------------------------------
select id as seoul_bundle from public.order_claim_collection_bundles where claim_id=pg_temp.ra_id('claim',1) and return_address_id=:'seoul_id'::uuid \gset
select id as origin_bundle from public.order_claim_collection_bundles where claim_id=pg_temp.ra_id('claim',1) and shipment_id=pg_temp.ra_id('shipment',1) and return_address_id is null \gset
select pg_temp.ra_as(4);
set local role authenticated;
select pg_temp.ra_error(format('select public.admin_record_order_claim_collection_bundle(%L,%L,%L,%L)',pg_temp.ra_id('claim',1),:'seoul_bundle','권한 없는 입고',pg_temp.ra_today()),'42501');
reset role;
select pg_temp.ra_as(1);
set local role authenticated;
-- 반품지가 갈린 배송 건은 배송 건 키로 확인할 수 없다(어느 창고에 도착했는지 묶음을 골라야 한다).
select pg_temp.ra_error(format('select public.admin_record_order_claim_origin_collection(%L,%L,%L,%L)',pg_temp.ra_id('claim',1),pg_temp.ra_id('shipment',1),'배송 건 키 입고',pg_temp.ra_today()),
 'claim_collection_bundle_required');
select pg_temp.ra_error(format('select public.admin_record_order_claim_collection_bundle(%L,%L,%L,%L)',pg_temp.ra_id('claim',2),:'seoul_bundle','다른 클레임 묶음',pg_temp.ra_today()),
 'claim_collection_not_found');
select pg_temp.ra_assert(public.admin_record_order_claim_collection_bundle(pg_temp.ra_id('claim',1),:'seoul_bundle','서울 반품지 1개 입고',pg_temp.ra_today()-2)='collecting',
 'first bundle keeps the claim collecting');
-- 같은 근거·같은 입고일은 멱등, 다른 근거는 충돌.
select pg_temp.ra_assert(public.admin_record_order_claim_collection_bundle(pg_temp.ra_id('claim',1),:'seoul_bundle','서울 반품지 1개 입고',pg_temp.ra_today()-2)='collecting','bundle replay');
select pg_temp.ra_error(format('select public.admin_record_order_claim_collection_bundle(%L,%L,%L,%L)',pg_temp.ra_id('claim',1),:'seoul_bundle','다른 근거',pg_temp.ra_today()-2),'claim_collection_conflict');
reset role;
select pg_temp.ra_assert((select collected_at is null from public.order_claim_collections where claim_id=pg_temp.ra_id('claim',1) and shipment_id=pg_temp.ra_id('shipment',1))
 and (select stage='collecting' from public.order_cancellation_requests where id=pg_temp.ra_id('claim',1))
 and private.order_claim_withdrawal_blocker((select c from public.order_cancellation_requests c where c.id=pg_temp.ra_id('claim',1)))='claim_withdrawal_collection_started'
 and (select count(*) from public.audit_log where action='admin.order.claim_origin_collected' and diff->>'claimId'=pg_temp.ra_id('claim',1)::text)=1,
 'one bundle of a shipment is a physical receipt but not the shipment receipt');
-- 재고 대조 흐름: 서울 묶음의 A만 돌아왔다. B는 아직이다.
select pg_temp.ra_assert((select returned_since_qty from private.stock_reconcile_flows(array[pg_temp.ra_variant('ra-good-a')],now()-interval '1 hour'))=1
 and (select returned_since_qty from private.stock_reconcile_flows(array[pg_temp.ra_variant('ra-good-b')],now()-interval '1 hour'))=0,
 'stock reconcile counts the returned item when its own bundle arrives');
select pg_temp.ra_as(1);
set local role authenticated;
select pg_temp.ra_assert(public.admin_record_order_claim_collection_bundle(pg_temp.ra_id('claim',1),:'origin_bundle','김포 출고지 1개 입고',pg_temp.ra_today()-1)='collecting',
 'second bundle completes the shipment but not the claim');
select pg_temp.ra_assert(public.admin_record_order_claim_origin_collection(pg_temp.ra_id('claim',1),pg_temp.ra_id('shipment',2),'남양주 1개 입고',pg_temp.ra_today()-2)='collected',
 'single-bundle shipment keeps the shipment key');
reset role;
select pg_temp.ra_assert((select collected_at is not null and received_on=pg_temp.ra_today()-1 and evidence='김포 출고지 1개 입고'
  from public.order_claim_collections where claim_id=pg_temp.ra_id('claim',1) and shipment_id=pg_temp.ra_id('shipment',1))
 and (select stage='collected' and collection_received_on=pg_temp.ra_today()-1 from public.order_cancellation_requests where id=pg_temp.ra_id('claim',1))
 and (select count(*) from public.audit_log where action='admin.order.claim_origin_collected' and diff->>'claimId'=pg_temp.ra_id('claim',1)::text)=3
 and (select count(*) from public.notifications where source_id=pg_temp.ra_id('claim',1)::text and dedupe_key like 'claim:collected%')=1
 and (select returned_since_qty from private.stock_reconcile_flows(array[pg_temp.ra_variant('ra-good-b')],now()-interval '1 hour'))=1,
 'all bundles collected: latest received date, one completion notice');

-- 상품이 고르지 않게 된 주소는 지울 수 있고, 이미 만든 회수 묶음은 남는다.
update public.goods set return_address_id=null where return_address_id=:'busan_id';
select pg_temp.ra_as(1);
set local role authenticated;
select pg_temp.ra_assert(public.admin_delete_return_address(:'busan_id',(select updated_at from public.return_addresses where id=:'busan_id')),'unused address deletes');
reset role;
select pg_temp.ra_assert(not exists(select 1 from public.return_addresses where id=:'busan_id')
 and exists(select 1 from public.order_claim_collection_bundles where claim_id=pg_temp.ra_id('claim',4) and return_address_snapshot='부산광역시 합성구 반품로 2 TEST')
 and exists(select 1 from public.audit_log where action='admin.return_address.deleted' and target='return_addresses:'||:'busan_id'),
 'deleting an address keeps claim snapshots and is audited');

rollback;
