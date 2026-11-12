\set ON_ERROR_STOP on
-- 배송 건(출고지)별 교환 재출고와 회수 생략 재출고(TKT-166·QNA-039, ADR-0041).
-- 김포·남양주 두 배송 건 교환: 한 곳만 재출고하면 클레임은 열린 채 고객에게 그 송장이 바로 보이고, 두 곳 모두
-- 재출고하면 종결된다. 하자·오배송 교환은 사유·근거 사진이 있으면 회수 확인 없이 재출고하고 보낸 옵션만 뺀다.
-- 합성 데이터만 쓰고 롤백한다. 결제사·택배사·저장소 API는 부르지 않는다.
begin;
load 'safeupdate';
create function pg_temp.po_id(kind text,n integer) returns uuid language sql immutable as $$select md5('claim-per-origin:'||kind||':'||n)::uuid$$;
create function pg_temp.po_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'per-origin reshipment assertion: %',label;end if;end$$;
create function pg_temp.po_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected per-origin rejection: %',expected;end$$;
create function pg_temp.po_field() returns jsonb language sql immutable as $$select jsonb_build_object('v',1,'kid','k1','iv','AAAAAAAAAAAAAAAA','tag','AAAAAAAAAAAAAAAAAAAAAA','ct','YQ')$$;
create function pg_temp.po_address() returns jsonb language sql immutable as $$select jsonb_build_object('recipientName',pg_temp.po_field(),'phone',pg_temp.po_field(),'postalCode',pg_temp.po_field(),'address1',pg_temp.po_field(),'address2',pg_temp.po_field())$$;

-- 쓰기 경로와 원장은 봉인돼 있다(런타임 거절 대신 선언적 단언).
select pg_temp.po_assert(
 has_function_privilege('service_role','public.service_record_order_claim_shipment_reshipment(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,text,text,text,text,jsonb,jsonb,boolean)','execute')
 and not has_function_privilege('authenticated','public.service_record_order_claim_shipment_reshipment(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,text,text,text,text,jsonb,jsonb,boolean)','execute')
 and not has_function_privilege('anon','public.service_record_order_claim_shipment_reshipment(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,text,text,text,text,jsonb,jsonb,boolean)','execute')
 and has_function_privilege('authenticated','public.admin_record_order_claim_shipment_reshipment_delivery(uuid,uuid,text)','execute')
 and not has_function_privilege('anon','public.admin_record_order_claim_shipment_reshipment_delivery(uuid,uuid,text)','execute')
 and not has_function_privilege('service_role','public.admin_record_order_claim_shipment_reshipment_delivery(uuid,uuid,text)','execute')
 and has_function_privilege('authenticated','public.get_my_order_claim_reshipments(uuid)','execute')
 and not has_function_privilege('anon','public.get_my_order_claim_reshipments(uuid)','execute')
 and has_function_privilege('authenticated','public.admin_register_claim_evidence_file(uuid,uuid,text,integer,text)','execute')
 and not has_function_privilege('anon','public.admin_register_claim_evidence_file(uuid,uuid,text,integer,text)','execute')
 and not has_function_privilege('service_role','public.admin_register_claim_evidence_file(uuid,uuid,text,integer,text)','execute')
 and has_function_privilege('authenticated','public.admin_claim_evidence_file(uuid)','execute')
 and not has_function_privilege('anon','public.admin_claim_evidence_file(uuid)','execute')
 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in('record_order_claim_shipment_reshipment','claim_reshipment_targets','claim_reshipment_delivery_pending','claim_reshipment_selections_match',
   'claim_reshipment_records_json','claim_reshipment_targets_json','order_claim_reshipment_parcels')
  and(has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')))
 and not has_table_privilege('authenticated','public.order_claim_reshipments','select')
 and not has_table_privilege('anon','public.order_claim_reshipments','select')
 and not has_table_privilege('service_role','public.order_claim_reshipments','select')
 and not has_table_privilege('authenticated','private.claim_evidence_files','select')
 and (select not public and file_size_limit=10485760 from storage.buckets where id='claim-evidence-private')
 and not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and coalesce(qual,'')||coalesce(with_check,'') like '%claim-evidence-private%'),
 'writers, ledgers and the evidence bucket are sealed');

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.po_id('user',n),'authenticated','authenticated','claim-per-origin-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3)n;
update public.profiles set nickname='TEST 출고지 '||right(id::text,6),
 role=case when id=pg_temp.po_id('user',2) then 'user'::public.user_role else 'admin'::public.user_role end
 where id in(select pg_temp.po_id('user',n) from generate_series(1,3)n);
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) values(pg_temp.po_id('session',1),pg_temp.po_id('user',1),now(),now(),'aal1',now()+interval '1 hour');
insert into private.operator_memberships(profile_id,manager_role) select pg_temp.po_id('user',3),'owner' where not exists(select 1 from private.operator_memberships where manager_role='owner');
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.po_id('user',1),'primary');
update private.operator_access_state set configured=true where id;
update private.order_claim_contact_runtime set enabled=true where singleton;

insert into public.ips(id,title,vertical_key) values('po-ip','TEST 출고지별 재출고','character');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active) values
 (pg_temp.po_id('origin',1),'po-gimpo','TEST 김포','hanjin',0,'TEST 김포 반송지',true),
 (pg_temp.po_id('origin',2),'po-namyangju','TEST 남양주','hanjin',0,'TEST 남양주 반송지',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values
 ('po-good-1','po-ip','TEST 김포 굿즈','문구',1000,'ok',10,pg_temp.po_id('origin',1)),
 ('po-good-2','po-ip','TEST 남양주 굿즈','문구',2000,'ok',10,pg_temp.po_id('origin',2));
insert into public.goods_variants(id,good_id,name,price,stock_qty,sort_order) values
 (pg_temp.po_id('variant',1),'po-good-1','TEST 김포 파랑',1000,5,1),
 (pg_temp.po_id('variant',2),'po-good-2','TEST 남양주 빨강',2000,5,1);
create function pg_temp.po_default(good text) returns uuid language sql stable as $$select id from public.goods_variants where good_id=good and is_default$$;
create function pg_temp.po_stock(variant uuid) returns integer language sql stable as $$select stock_qty from public.goods_variants where id=variant$$;
select pg_temp.po_assert(pg_temp.po_stock(pg_temp.po_default('po-good-1'))=10 and pg_temp.po_stock(pg_temp.po_default('po-good-2'))=10
 and pg_temp.po_stock(pg_temp.po_id('variant',1))=5 and pg_temp.po_stock(pg_temp.po_id('variant',2))=5,'starting stock');

-- 주문 1: 김포 1개 + 남양주 2개(하자 교환). 주문 2: 김포 1개(단순 변심 교환, 옛 단일 계약 호환). 주문 3: 이 migration 전의 클레임 단위 재출고.
insert into public.orders(id,user_id,status,total,shipping_fee,address,shipped_at,delivered_at)
 select pg_temp.po_id('order',n),pg_temp.po_id('user',2),'delivered',5000,0,
  jsonb_build_object('recipientName','합성 고객','phone','010-0000-0000','postalCode','12345','address1','합성시 출고지로 1','address2','101호'),
  now()-interval '3 days',now()-interval '2 days' from generate_series(1,3)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot) values
 (pg_temp.po_id('item',1),pg_temp.po_id('order',1),'po-good-1',pg_temp.po_default('po-good-1'),1,1000,'TEST 김포 굿즈','문구','po-ip'),
 (pg_temp.po_id('item',2),pg_temp.po_id('order',1),'po-good-2',pg_temp.po_default('po-good-2'),2,2000,'TEST 남양주 굿즈','문구','po-ip'),
 (pg_temp.po_id('item',3),pg_temp.po_id('order',2),'po-good-1',pg_temp.po_default('po-good-1'),1,1000,'TEST 김포 굿즈','문구','po-ip'),
 (pg_temp.po_id('item',4),pg_temp.po_id('order',3),'po-good-1',pg_temp.po_default('po-good-1'),1,1000,'TEST 김포 굿즈','문구','po-ip');
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at) values
 (pg_temp.po_id('shipment',1),pg_temp.po_id('order',1),pg_temp.po_id('origin',1),'TEST 김포',0,'{}','delivered','hanjin','POSALE000001',now()-interval '3 days',now()-interval '2 days'),
 (pg_temp.po_id('shipment',2),pg_temp.po_id('order',1),pg_temp.po_id('origin',2),'TEST 남양주',0,'{}','delivered','hanjin','POSALE000002',now()-interval '3 days',now()-interval '2 days'),
 (pg_temp.po_id('shipment',3),pg_temp.po_id('order',2),pg_temp.po_id('origin',1),'TEST 김포',0,'{}','delivered','hanjin','POSALE000003',now()-interval '3 days',now()-interval '2 days'),
 (pg_temp.po_id('shipment',4),pg_temp.po_id('order',3),pg_temp.po_id('origin',1),'TEST 김포',0,'{}','delivered','hanjin','POSALE000004',now()-interval '3 days',now()-interval '2 days');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values
 (pg_temp.po_id('order',1),pg_temp.po_id('shipment',1),pg_temp.po_id('item',1),1),
 (pg_temp.po_id('order',1),pg_temp.po_id('shipment',2),pg_temp.po_id('item',2),2),
 (pg_temp.po_id('order',2),pg_temp.po_id('shipment',3),pg_temp.po_id('item',3),1),
 (pg_temp.po_id('order',3),pg_temp.po_id('shipment',4),pg_temp.po_id('item',4),1);
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type) values
 (pg_temp.po_id('claim',1),pg_temp.po_id('order',1),pg_temp.po_id('user',2),'TEST 김포·남양주 하자 교환','exchange','requested','defect'),
 (pg_temp.po_id('claim',2),pg_temp.po_id('order',2),pg_temp.po_id('user',2),'TEST 한 곳 교환','exchange','requested','change_of_mind');
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,status,collection_policy,collected_at,reship_carrier,reship_tracking_number,reshipped_at,completed_at) values
 (pg_temp.po_id('claim',3),pg_temp.po_id('order',3),pg_temp.po_id('user',2),'TEST 옛 교환','exchange','completed','completed','legacy',now()-interval '1 day','hanjin','POLEGACY0003',now()-interval '1 day',now()-interval '1 day');

select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub',pg_temp.po_id('user',1)::text,true);
select public.admin_decide_order_claim(pg_temp.po_id('claim',n),'approve',null) from generate_series(1,2)n;
select pg_temp.po_assert((select count(*)=2 from public.order_claim_collections where claim_id=pg_temp.po_id('claim',1))
 and (select stage='collecting' from public.order_cancellation_requests where id=pg_temp.po_id('claim',1))
 and (select count(*)=2 from private.claim_reshipment_targets(pg_temp.po_id('claim',1)))
 and (select count(*)=1 from private.claim_reshipment_targets(pg_temp.po_id('claim',2))),'approval snapshots one reshipment target per origin');

create function pg_temp.po_context(n integer,command text default 'reshipment') returns jsonb language sql volatile as $$
 select public.service_get_order_claim_contact_context(pg_temp.po_id('order',n),pg_temp.po_id('claim',n),pg_temp.po_id('user',1),pg_temp.po_id('session',1),'reshipment',command)$$;
create function pg_temp.po_expected(ctx jsonb) returns jsonb language sql immutable as $$select ctx#>'{current,source}'||jsonb_build_object('addressHmac',repeat('a',64),'addressHmacKeyVersion','k1')$$;
create function pg_temp.po_destination(ctx jsonb,n integer) returns jsonb language sql immutable as $$
 select jsonb_build_object('piiVersion',pg_temp.po_id('destination-pii',n),'keyVersion','k1','address',pg_temp.po_address(),'addressHmac',repeat('a',64),'addressHmacKeyVersion','k1',
 'sourceKind',ctx#>'{current,source,sourceKind}','sourceId',ctx#>'{current,source,sourceId}','sourceRevision',ctx#>'{current,source,sourceRevision}',
 'sourcePlanRevision',ctx#>'{current,source,planRevision}','sourcePiiVersion',ctx#>'{current,source,piiVersion}')$$;
create function pg_temp.po_reship(n integer,shipment uuid,operation integer,ctx jsonb,tracking text,items jsonb default '[]',waiver jsonb default null) returns jsonb language sql volatile as $$
 select public.service_record_order_claim_shipment_reshipment(pg_temp.po_id('order',n),pg_temp.po_id('claim',n),shipment,pg_temp.po_id('user',1),pg_temp.po_id('session',1),
  pg_temp.po_id('operation',operation),(ctx->>'claimRevision')::integer,pg_temp.po_expected(ctx),pg_temp.po_destination(ctx,operation),
  lpad(to_hex(operation),64,'0'),'k1','hanjin',tracking,items,waiver,true)$$;
create function pg_temp.po_v2(n integer,operation integer,ctx jsonb,tracking text) returns jsonb language sql volatile as $$
 select public.service_record_order_claim_reshipment_v2(pg_temp.po_id('order',n),pg_temp.po_id('claim',n),pg_temp.po_id('user',1),pg_temp.po_id('session',1),
  pg_temp.po_id('operation',operation),(ctx->>'claimRevision')::integer,pg_temp.po_expected(ctx),pg_temp.po_destination(ctx,operation),
  lpad(to_hex(operation),64,'0'),'k1','hanjin',tracking,'[]',true)$$;
create temp table po_ctx(n integer primary key,value jsonb);
create temp table po_receipts(n integer primary key,value jsonb);
create function pg_temp.po_fresh(p_n integer) returns jsonb language plpgsql volatile as $$declare v jsonb:=pg_temp.po_context(p_n);begin
 insert into po_ctx as saved values(p_n,v) on conflict(n) do update set value=excluded.value;return v;end$$;

-- 하자 교환은 회수 생략이 가능해 회수 전에도 재출고 확인을 연다. 회수 생략 없이 보낸 재출고는 그 배송 건 회수가 먼저다.
select pg_temp.po_assert((pg_temp.po_fresh(1)->>'allowed')::boolean,'defect exchange opens per-shipment reshipment');
select pg_temp.po_assert(not(pg_temp.po_fresh(2)->>'allowed')::boolean,'change-of-mind exchange waits for a collected origin');
select pg_temp.po_error(format('select pg_temp.po_reship(1,%L,90,%L::jsonb,%L)',pg_temp.po_id('shipment',2),(select value::text from po_ctx where n=1),'POREJECT0001'),'claim_collections_incomplete');
select pg_temp.po_error(format('select private.record_order_claim_shipment_reshipment(%L,%L,''hanjin'',''POREJECT0002'',''[]'',%L::jsonb)',
 pg_temp.po_id('claim',2),pg_temp.po_id('shipment',3),jsonb_build_object('reason','TEST 단순 변심도 회수 생략 시도','evidenceFileIds',jsonb_build_array(pg_temp.po_id('file',9)))::text),'collection_waiver_not_allowed');

-- 김포 회수 확인 → 클레임은 수거중으로 남는다(남양주 미회수).
select public.admin_record_order_claim_origin_collection(pg_temp.po_id('claim',1),pg_temp.po_id('shipment',1),'TEST 김포 입고 1개 확인');
select pg_temp.po_assert((select stage='collecting' and collected_at is null from public.order_cancellation_requests where id=pg_temp.po_id('claim',1)),'one collected origin keeps the claim collecting');
select pg_temp.po_error(format('select private.record_order_claim_shipment_reshipment(%L,%L,''hanjin'',''POREJECT0003'',''[]'',%L::jsonb)',
 pg_temp.po_id('claim',1),pg_temp.po_id('shipment',1),jsonb_build_object('reason','TEST 입고된 배송 건 회수 생략','evidenceFileIds',jsonb_build_array(pg_temp.po_id('file',9)))::text),'collection_waiver_not_needed');

-- 김포만 먼저 재출고(파랑으로 교환): 회수품 +1, 보낸 옵션 −1, 클레임은 열린 채 '재출고 1/2'.
select pg_temp.po_fresh(1);
insert into po_receipts values(1,pg_temp.po_reship(1,pg_temp.po_id('shipment',1),1,(select value from po_ctx where n=1),'POGIMPO00001',
 jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.po_id('item',1),'variantId',pg_temp.po_id('variant',1)))));
select pg_temp.po_assert((select value->>'state'='saved' and value->>'command'='reshipment' from po_receipts where n=1)
 and (select stage='collecting' and reshipped_at is not null and completed_at is null and reship_carrier is null and reship_tracking_number is null
  from public.order_cancellation_requests where id=pg_temp.po_id('claim',1))
 and (select count(*)=1 from public.order_claim_reshipments where claim_id=pg_temp.po_id('claim',1))
 and (select shipment_id=pg_temp.po_id('shipment',1) and origin_name_snapshot='TEST 김포' and not collection_waived and carrier='hanjin'
  from public.order_claim_reshipments where claim_id=pg_temp.po_id('claim',1))
 and (select reshipment_id is not null and variant_id=pg_temp.po_id('variant',1) and source_variant_id=pg_temp.po_default('po-good-1')
  from public.order_claim_reshipment_items where claim_id=pg_temp.po_id('claim',1) and order_item_id=pg_temp.po_id('item',1))
 and not exists(select 1 from public.order_claim_reshipment_items where claim_id=pg_temp.po_id('claim',1) and order_item_id=pg_temp.po_id('item',2))
 and pg_temp.po_stock(pg_temp.po_default('po-good-1'))=11 and pg_temp.po_stock(pg_temp.po_id('variant',1))=4
 and pg_temp.po_stock(pg_temp.po_default('po-good-2'))=10 and pg_temp.po_stock(pg_temp.po_id('variant',2))=5
 and (select count(*)=1 from private.order_claim_reshipment_destinations d join public.order_claim_reshipments r on r.id=d.reshipment_id where d.claim_id=pg_temp.po_id('claim',1)),
 'first origin reships alone and moves only its own stock');
select pg_temp.po_assert(pg_temp.po_reship(1,pg_temp.po_id('shipment',1),1,(select value from po_ctx where n=1),'POGIMPO00001',
 jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.po_id('item',1),'variantId',pg_temp.po_id('variant',1)))) = (select value from po_receipts where n=1)
 and pg_temp.po_stock(pg_temp.po_id('variant',1))=4,'exact replay returns the frozen receipt without moving stock');
select pg_temp.po_error(format('select pg_temp.po_reship(1,%L,2,%L::jsonb,%L)',pg_temp.po_id('shipment',2),(select value::text from po_ctx where n=1),'POSTALE00002'),'claim_contact_changed');
-- 다음 소포는 새 확인이 필요하다. 이미 보낸 배송 건에 새 작업을 덧대지 않는다.
select pg_temp.po_assert((pg_temp.po_fresh(1)->>'allowed')::boolean and not(pg_temp.po_context(1,'change')->>'allowed')::boolean,'remaining origin stays open; confirmed address is frozen');
select pg_temp.po_error(format('select pg_temp.po_reship(1,%L,3,%L::jsonb,%L)',pg_temp.po_id('shipment',1),(select value::text from po_ctx where n=1),'POGIMPO00009'),'reshipment_conflict');
select pg_temp.po_error(format('select pg_temp.po_v2(1,4,%L::jsonb,%L)',(select value::text from po_ctx where n=1),'POLEGACY0001'),'reshipment_shipment_required');
select pg_temp.po_error(format('select private.record_order_claim_reshipment_physical(%L,''hanjin'',''POLEGACY0002'',''[]'')',pg_temp.po_id('claim',1)),'reshipment_conflict');

-- 고객은 열린 클레임의 첫 송장을 바로 본다(출고지 이름·처리 근거는 싣지 않는다).
select set_config('request.jwt.claim.sub',pg_temp.po_id('user',2)::text,true);
select pg_temp.po_assert(jsonb_array_length(public.get_my_order_claim_reshipments(pg_temp.po_id('order',1)))=1
 and public.get_my_order_claim_reshipments(pg_temp.po_id('order',1))#>>'{0,trackingNumber}'='POGIMPO00001'
 and public.get_my_order_claim_reshipments(pg_temp.po_id('order',1))#>>'{0,items,0,variantName}'='TEST 김포 파랑'
 and not(public.get_my_order_claim_reshipments(pg_temp.po_id('order',1))->0 ?| array['originName','reshippedBy','waiverReason','deliveryEvidence']),
 'customer sees the first parcel at once');
select set_config('request.jwt.claim.sub',pg_temp.po_id('user',3)::text,true);
select pg_temp.po_error(format('select public.get_my_order_claim_reshipments(%L)',pg_temp.po_id('order',1)),'order_not_found');
select set_config('request.jwt.claim.sub',pg_temp.po_id('user',1)::text,true);
select pg_temp.po_assert(jsonb_array_length(public.admin_order_claim_detail(pg_temp.po_id('claim',1))#>'{claim,reshipmentTargets}')=2
 and (select count(*)=1 from jsonb_array_elements(public.admin_order_claim_detail(pg_temp.po_id('claim',1))#>'{claim,reshipmentTargets}') t where (t->>'reshipped')::boolean)
 and public.admin_order_claim_detail(pg_temp.po_id('claim',1))#>>'{claim,reshipments,0,originName}'='TEST 김포'
 and public.admin_order_claim_detail(pg_temp.po_id('claim',1))#>>'{claim,reshipments,0,trackingNumber}'='POGIMPO00001'
 and (public.admin_order_claim_detail(pg_temp.po_id('claim',1))#>>'{claim,collectionWaiverAllowed}')::boolean
 and not(public.admin_order_claim_detail(pg_temp.po_id('claim',2))#>>'{claim,collectionWaiverAllowed}')::boolean,
 'operator detail lists every origin and its reshipment');

-- 배송완료 확인은 송장마다다. 보내지 않은 배송 건은 확인할 수 없다.
-- 한 문장의 하위 조회는 그 문장 시작 시점을 보므로, 쓰기 호출과 확인을 나눈다.
select public.admin_record_order_claim_shipment_reshipment_delivery(pg_temp.po_id('claim',1),pg_temp.po_id('shipment',1),'TEST 김포 교환품 수령 확인') as first_delivery \gset
select pg_temp.po_assert(:'first_delivery'='delivered'
 and public.admin_record_order_claim_shipment_reshipment_delivery(pg_temp.po_id('claim',1),pg_temp.po_id('shipment',1),'TEST 김포 교환품 수령 확인')='delivered'
 and (select delivered_at is not null and delivered_by=pg_temp.po_id('user',1) from public.order_claim_reshipments where claim_id=pg_temp.po_id('claim',1))
 and (select reship_delivered_at is null from public.order_cancellation_requests where id=pg_temp.po_id('claim',1)),'first parcel delivery confirmed while the other origin is pending');
select pg_temp.po_error(format('select public.admin_record_order_claim_shipment_reshipment_delivery(%L,%L,''다른 근거'')',pg_temp.po_id('claim',1),pg_temp.po_id('shipment',1)),'reshipment_delivery_conflict');
select pg_temp.po_error(format('select public.admin_record_order_claim_shipment_reshipment_delivery(%L,%L,''보내지 않은 배송 건'')',pg_temp.po_id('claim',1),pg_temp.po_id('shipment',2)),'claim_reshipment_not_dispatched');
select pg_temp.po_error(format('select public.admin_record_order_claim_reshipment_delivery(%L,''옛 단일 확인'')',pg_temp.po_id('claim',1)),'reshipment_shipment_required');

-- 회수 생략 근거 사진: 저장소 객체를 대조해 원장에 남긴다.
insert into storage.objects(bucket_id,name,metadata) values
 ('claim-evidence-private',pg_temp.po_id('claim',1)||'/'||pg_temp.po_id('file',1)||'.jpg',jsonb_build_object('mimetype','image/jpeg','size',2048)),
 ('claim-evidence-private',pg_temp.po_id('claim',2)||'/'||pg_temp.po_id('file',2)||'.png',jsonb_build_object('mimetype','image/png','size',1024));
select public.admin_register_claim_evidence_file(pg_temp.po_id('claim',1),pg_temp.po_id('file',1),'image/jpeg',2048,repeat('e',64))->>'id' as evidence_one \gset
select public.admin_register_claim_evidence_file(pg_temp.po_id('claim',2),pg_temp.po_id('file',2),'image/png',1024,repeat('f',64))->>'claimId' as evidence_two \gset
select pg_temp.po_assert(:'evidence_one'=pg_temp.po_id('file',1)::text and :'evidence_two'=pg_temp.po_id('claim',2)::text
 and public.admin_register_claim_evidence_file(pg_temp.po_id('claim',1),pg_temp.po_id('file',1),'image/jpeg',2048,repeat('e',64))->>'id'=pg_temp.po_id('file',1)::text
 and (select count(*)=2 from private.claim_evidence_files where claim_id in(pg_temp.po_id('claim',1),pg_temp.po_id('claim',2)))
 and public.admin_claim_evidence_file(pg_temp.po_id('file',1))->>'path'=pg_temp.po_id('claim',1)||'/'||pg_temp.po_id('file',1)||'.jpg',
 'evidence photo registered once against the stored object');
select pg_temp.po_error(format('select public.admin_register_claim_evidence_file(%L,%L,''image/jpeg'',2048,%L)',pg_temp.po_id('claim',1),pg_temp.po_id('file',1),repeat('0',64)),'claim_evidence_conflict');
select pg_temp.po_error(format('select public.admin_register_claim_evidence_file(%L,%L,''image/jpeg'',2048,%L)',pg_temp.po_id('claim',1),pg_temp.po_id('file',3),repeat('e',64)),'claim_evidence_unverified');

-- 회수 생략 재출고의 사유·근거 제한.
select pg_temp.po_fresh(1);
select pg_temp.po_error(format('select pg_temp.po_reship(1,%L,5,%L::jsonb,%L,''[]'',%L::jsonb)',pg_temp.po_id('shipment',2),(select value::text from po_ctx where n=1),'PONAMYANG001',
 jsonb_build_object('reason','짧음','evidenceFileIds',jsonb_build_array(pg_temp.po_id('file',1)))::text),'invalid_collection_waiver_reason');
select pg_temp.po_error(format('select pg_temp.po_reship(1,%L,6,%L::jsonb,%L,''[]'',%L::jsonb)',pg_temp.po_id('shipment',2),(select value::text from po_ctx where n=1),'PONAMYANG001',
 jsonb_build_object('reason','TEST 박스 파손 사진으로 회수 생략','evidenceFileIds','[]'::jsonb)::text),'collection_waiver_evidence_required');
select pg_temp.po_error(format('select pg_temp.po_reship(1,%L,7,%L::jsonb,%L,''[]'',%L::jsonb)',pg_temp.po_id('shipment',2),(select value::text from po_ctx where n=1),'PONAMYANG001',
 jsonb_build_object('reason','TEST 다른 클레임 사진으로 회수 생략','evidenceFileIds',jsonb_build_array(pg_temp.po_id('file',2)))::text),'collection_waiver_evidence_required');

-- 남양주는 회수 없이 재출고(빨강 2개): 회수품 복원 없이 보낸 옵션만 −2, 두 곳 모두 재출고돼 종결.
insert into po_receipts values(2,pg_temp.po_reship(1,pg_temp.po_id('shipment',2),8,(select value from po_ctx where n=1),'PONAMYANG001',
 jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.po_id('item',2),'variantId',pg_temp.po_id('variant',2))),
 jsonb_build_object('reason','TEST 박스 파손 사진으로 회수 생략','evidenceFileIds',jsonb_build_array(pg_temp.po_id('file',1)))));
select pg_temp.po_assert((select stage='completed' and status='completed' and completed_at is not null and collected_at is null
  and reship_carrier is null and reship_tracking_number is null and reship_delivered_at is null from public.order_cancellation_requests where id=pg_temp.po_id('claim',1))
 and (select collection_waived and waiver_reason='TEST 박스 파손 사진으로 회수 생략' and waiver_evidence_file_ids=array[pg_temp.po_id('file',1)]
  from public.order_claim_reshipments where claim_id=pg_temp.po_id('claim',1) and shipment_id=pg_temp.po_id('shipment',2))
 and (select collected_at is null from public.order_claim_collections where claim_id=pg_temp.po_id('claim',1) and shipment_id=pg_temp.po_id('shipment',2))
 and private.claim_collections_complete(pg_temp.po_id('claim',1))
 and pg_temp.po_stock(pg_temp.po_default('po-good-2'))=10 and pg_temp.po_stock(pg_temp.po_id('variant',2))=3
 and pg_temp.po_stock(pg_temp.po_default('po-good-1'))=11 and pg_temp.po_stock(pg_temp.po_id('variant',1))=4
 and (select diff->>'collectionWaived'='true' and diff->>'to'='completed' and diff->>'reshippedCount'='2' and diff->>'targetCount'='2'
  from public.audit_log where action='admin.order.claim_reshipped' and target='order:'||pg_temp.po_id('order',1) and diff->>'shipmentId'=pg_temp.po_id('shipment',2)::text)
 and exists(select 1 from public.notifications where user_id=pg_temp.po_id('user',2) and title='교환 상품을 회수 없이 다시 보내드려요')
 and exists(select 1 from public.notifications where user_id=pg_temp.po_id('user',2) and title='교환 상품 일부가 먼저 재출고됐어요'),
 'waived origin reships without restoring the kept item and completes the claim');
select pg_temp.po_assert(not(pg_temp.po_fresh(1)->>'allowed')::boolean,'completed claim closes reshipment');
select pg_temp.po_assert(public.admin_order_claim_detail(pg_temp.po_id('claim',1))#>>'{claim,reshipments,1,waiverEvidence,0,id}'=pg_temp.po_id('file',1)::text
 and jsonb_array_length(public.admin_order_claim_detail(pg_temp.po_id('claim',1))#>'{claim,reshipments}')=2,'operator sees the waiver evidence per origin');

-- 주문 배송완료 판정은 모든 송장의 배송완료 확인을 기다린다.
select pg_temp.po_assert(not private.order_all_items_delivered(pg_temp.po_id('order',1)) and private.contact_order_reshipment_pending(pg_temp.po_id('order',1))
 and not private.order_return_intake_eligible(pg_temp.po_id('order',1)),'pending replacement parcel blocks the delivered judgement');
select public.admin_record_order_claim_shipment_reshipment_delivery(pg_temp.po_id('claim',1),pg_temp.po_id('shipment',2),'TEST 남양주 교환품 수령 확인');
select pg_temp.po_assert(private.order_all_items_delivered(pg_temp.po_id('order',1)) and not private.contact_order_reshipment_pending(pg_temp.po_id('order',1))
 and private.order_return_intake_eligible(pg_temp.po_id('order',1)),'every parcel delivered reopens the delivered judgement');
select set_config('request.jwt.claim.sub',pg_temp.po_id('user',2)::text,true);
select pg_temp.po_assert(jsonb_array_length(public.get_my_order_claim_reshipments(pg_temp.po_id('order',1)))=2
 and (public.get_my_order_claim_reshipments(pg_temp.po_id('order',1))#>>'{1,collectionWaived}')::boolean
 and public.get_my_order_claim_reshipments(pg_temp.po_id('order',1))#>>'{1,trackingNumber}'='PONAMYANG001'
 and (select count(*)=2 from jsonb_array_elements(public.get_my_order_claim_reshipments(pg_temp.po_id('order',1))) p where p->>'deliveredAt' is not null),
 'customer sees two parcels with their delivery state');
select set_config('request.jwt.claim.sub',pg_temp.po_id('user',1)::text,true);

-- 배송 건이 하나인 교환은 옛 단일 계약 그대로다(옛 열에도 같은 송장·배송완료).
select public.admin_record_order_claim_origin_collection(pg_temp.po_id('claim',2),pg_temp.po_id('shipment',3),'TEST 김포 한 곳 입고');
insert into po_receipts values(9,pg_temp.po_v2(2,9,pg_temp.po_fresh(2),'POSINGLE0001'));
select pg_temp.po_assert((select stage='completed' and reship_carrier='hanjin' and reship_tracking_number='POSINGLE0001' and reshipped_at is not null
  from public.order_cancellation_requests where id=pg_temp.po_id('claim',2))
 and (select count(*)=1 from public.order_claim_reshipments where claim_id=pg_temp.po_id('claim',2) and shipment_id=pg_temp.po_id('shipment',3))
 and pg_temp.po_stock(pg_temp.po_default('po-good-1'))=11,'single-origin exchange keeps the legacy pair');
select pg_temp.po_assert(public.admin_record_order_claim_reshipment(pg_temp.po_id('claim',2),'hanjin','POSINGLE0001')='completed','legacy replay of a single-origin record');
select pg_temp.po_error(format('select public.admin_record_order_claim_reshipment(%L,''hanjin'',''POSINGLE0009'')',pg_temp.po_id('claim',2)),'reshipment_conflict');
select public.admin_record_order_claim_reshipment_delivery(pg_temp.po_id('claim',2),'TEST 한 곳 수령 확인') as single_delivery \gset
select pg_temp.po_assert(:'single_delivery'='delivered'
 and (select reship_delivered_at is not null and reship_delivery_evidence='TEST 한 곳 수령 확인' from public.order_cancellation_requests where id=pg_temp.po_id('claim',2))
 and (select delivered_at is not null from public.order_claim_reshipments where claim_id=pg_temp.po_id('claim',2)),'legacy delivery confirmation writes the row and the legacy pair');

-- 이 migration 전의 클레임 단위 재출고는 그대로 한 소포로 읽히고 배송 건 기록을 덧대지 않는다.
select set_config('request.jwt.claim.sub',pg_temp.po_id('user',2)::text,true);
select pg_temp.po_assert(jsonb_array_length(public.get_my_order_claim_reshipments(pg_temp.po_id('order',3)))=1
 and public.get_my_order_claim_reshipments(pg_temp.po_id('order',3))#>>'{0,trackingNumber}'='POLEGACY0003'
 and public.get_my_order_claim_reshipments(pg_temp.po_id('order',3))#>'{0,reshipmentId}'='null'::jsonb
 and jsonb_array_length(public.get_my_order_claim_reshipments(pg_temp.po_id('order',2)))=1,'legacy pair reads as one parcel; single-origin record is not duplicated');
select set_config('request.jwt.claim.sub',pg_temp.po_id('user',1)::text,true);
select pg_temp.po_assert(private.contact_order_reshipment_pending(pg_temp.po_id('order',3)),'legacy pair still waits for its delivery confirmation');
select pg_temp.po_error(format('select private.record_order_claim_shipment_reshipment(%L,%L,''hanjin'',''POLEGACY0009'',''[]'',null)',pg_temp.po_id('claim',3),pg_temp.po_id('shipment',4)),'reshipment_conflict');
rollback;
