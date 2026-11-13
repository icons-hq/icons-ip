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
 and has_function_privilege('authenticated','public.admin_waive_order_claim_collection(uuid,uuid,jsonb)','execute')
 and not has_function_privilege('anon','public.admin_waive_order_claim_collection(uuid,uuid,jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_waive_order_claim_collection(uuid,uuid,jsonb)','execute')
 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in('record_order_claim_shipment_reshipment','claim_reshipment_targets','claim_reshipment_delivery_pending','claim_reshipment_selections_match',
   'claim_reshipment_records_json','claim_reshipment_targets_json','order_claim_reshipment_parcels','claim_collection_waiver_values','claim_collection_waived',
   'ensure_claim_production_jobs','claim_production_ready','record_claim_collection_waiver','production_claim_collection_changed',
   'ensure_claim_ready_production_jobs','production_claim_ready_jobs','reopen_ineffective_collection_waivers','open_claim_production_job')
  and(has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')))
 and not has_table_privilege('authenticated','public.order_claim_collection_waivers','select')
 and not has_table_privilege('anon','public.order_claim_collection_waivers','select')
 and not has_table_privilege('service_role','public.order_claim_collection_waivers','select')
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

-- 재출고 1/2인 교환은 거부할 수 없다(보류에서의 거부 포함). 나간 소포의 재고 차감·배송 기록이 남는다.
select pg_temp.po_error(format('select public.admin_decide_order_claim(%L,''reject'',''TEST 일부 재출고 뒤 거부 시도'')',pg_temp.po_id('claim',1)),'claim_not_rejectable');
select public.admin_change_order_claim_hold(pg_temp.po_id('claim',1),pg_temp.po_id('hold-op',1),c.claim_revision,'exchange','hold','TEST 일부 재출고 뒤 보류 확인',pg_temp.po_id('user',1))->>'claimId'
 from public.order_cancellation_requests c where c.id=pg_temp.po_id('claim',1);
select pg_temp.po_error(format('select public.admin_decide_order_claim(%L,''reject'',''TEST 보류 중 거부 시도'')',pg_temp.po_id('claim',1)),'claim_not_rejectable');
select public.admin_change_order_claim_hold(pg_temp.po_id('claim',1),pg_temp.po_id('hold-op',2),c.claim_revision,'exchange','resume',null,pg_temp.po_id('user',1))->>'claimId'
 from public.order_cancellation_requests c where c.id=pg_temp.po_id('claim',1);
select pg_temp.po_assert((select stage='collecting' and decision_note is null and reshipped_at is not null from public.order_cancellation_requests where id=pg_temp.po_id('claim',1))
 and (select count(*)=1 from public.order_claim_reshipments where claim_id=pg_temp.po_id('claim',1))
 and pg_temp.po_stock(pg_temp.po_default('po-good-1'))=11 and pg_temp.po_stock(pg_temp.po_id('variant',1))=4,
 'partially reshipped exchange is never rejected, even from hold');

-- 회수 정보 정정은 배송 건마다 잠긴다: 재출고한 김포 행만 잠기고, 아직 보내지 않은 남양주는 계속 정정한다.
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.po_id('user',1),'role','authenticated','session_id',pg_temp.po_id('session',1))::text,true);
create function pg_temp.po_plan(op integer,shipment uuid,tracking text) returns jsonb language sql volatile as $$
 select public.admin_save_claim_collection_plan(pg_temp.po_id('claim',1),shipment,
  coalesce((select revision from private.claim_collection_plans where claim_id=pg_temp.po_id('claim',1) and shipment_id=shipment),0),
  (select claim_revision from public.order_cancellation_requests where id=pg_temp.po_id('claim',1)),
  jsonb_build_object('method','seller_arranged','carrier','hanjin','trackingNumber',tracking,'evidence','TEST 회수 접수 정정','confirmed',true),
  pg_temp.po_id('plan-op',op),pg_temp.po_id('user',1),pg_temp.po_id('session',1))$$;
select pg_temp.po_plan(1,pg_temp.po_id('shipment',2),'RETURN000002')::text as namyangju_plan \gset
select pg_temp.po_assert((:'namyangju_plan'::jsonb->>'editable')::boolean
 and (select (r->>'reshipped')::boolean from jsonb_array_elements(:'namyangju_plan'::jsonb->'rows') r where r->>'shipmentId'=pg_temp.po_id('shipment',1)::text)
 and (select not(r ? 'reshipped') and r->>'trackingNumber'='RETURN000002' from jsonb_array_elements(:'namyangju_plan'::jsonb->'rows') r
  where r->>'shipmentId'=pg_temp.po_id('shipment',2)::text),
 'remaining origin keeps its collection plan editable after the first reshipment');
select pg_temp.po_error(format('select pg_temp.po_plan(2,%L,''RETURN000001'')',pg_temp.po_id('shipment',1)),'claim_collection_blocked');
select set_config('request.jwt.claims','',true);

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
select pg_temp.po_assert((select reason='TEST 박스 파손 사진으로 회수 생략' and evidence_file_ids=array[pg_temp.po_id('file',1)] and waived_by=pg_temp.po_id('user',1)
  from public.order_claim_collection_waivers where claim_id=pg_temp.po_id('claim',1) and shipment_id=pg_temp.po_id('shipment',2))
 and private.claim_collection_waived(pg_temp.po_id('claim',1),pg_temp.po_id('shipment',2))
 and not exists(select 1 from public.order_claim_collection_waivers where claim_id=pg_temp.po_id('claim',1) and shipment_id=pg_temp.po_id('shipment',1)),
 'a waiver sent with the reshipment is recorded as that origin''s waiver decision');
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

-- 주문제작 상품이 있는 출고지의 회수 생략: 결정으로 교환품 제작을 먼저 열고, 제작이 끝난 뒤 회수 확인 없이 재출고한다.
-- 주문 4: 김포 주문제작 1개 + 남양주 일반 1개(하자 교환). 주문 5: 김포 주문제작 1개 + 남양주 일반 1개(단순 변심 교환).
insert into public.orders(id,user_id,status,total,shipping_fee,address,shipped_at,delivered_at)
 select pg_temp.po_id('order',n),pg_temp.po_id('user',2),'delivered',3000,0,
  jsonb_build_object('recipientName','합성 고객','phone','010-0000-0000','postalCode','12345','address1','합성시 출고지로 1','address2','101호'),
  now()-interval '12 days',now()-interval '2 days' from generate_series(4,5)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.po_id('item',n*10+1),pg_temp.po_id('order',n),'po-good-1',pg_temp.po_default('po-good-1'),1,1000,'TEST 김포 주문제작','문구','po-ip' from generate_series(4,5)n
 union all select pg_temp.po_id('item',n*10+2),pg_temp.po_id('order',n),'po-good-2',pg_temp.po_default('po-good-2'),1,2000,'TEST 남양주 굿즈','문구','po-ip' from generate_series(4,5)n;
-- 주문제작 조건·원주문 제작 완료·결제 확인은 이 시험의 전제라 트리거 없이 심는다(order_production.sql과 같은 결제 근거).
set session_replication_role=replica;
update public.order_items set production_terms_snapshot='{"leadDays":3,"dayBasis":"calendar"}' where id in(pg_temp.po_id('item',41),pg_temp.po_id('item',51));
insert into private.order_production_jobs(order_id,order_item_id,terms,state,basis_at,due_at,started_at,completed_at)
 select pg_temp.po_id('order',n),pg_temp.po_id('item',n*10+1),'{"leadDays":3,"dayBasis":"calendar"}','completed',now()-interval '12 days',now()-interval '9 days',now()-interval '11 days',now()-interval '10 days'
 from generate_series(4,5)n;
insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key)
 select pg_temp.po_id('payment',n),pg_temp.po_id('user',2),'order',pg_temp.po_id('order',n),'toss',3000,'paid','per-origin-paid-'||n from generate_series(4,5)n;
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 select pg_temp.po_id('attempt',n),'toss',pg_temp.po_id('user',2),'order',pg_temp.po_id('order',n),3000,'approved','per-origin-attempt-'||n,'per-origin-provider-'||n,'per-origin-code-'||n,
  pg_temp.po_id('payment',n),now()+interval '1 hour' from generate_series(4,5)n;
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) select pg_temp.po_id('attempt',n),'confirm',now() from generate_series(4,5)n;
set session_replication_role=origin;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at)
 select pg_temp.po_id('shipment',n*10+1),pg_temp.po_id('order',n),pg_temp.po_id('origin',1),'TEST 김포',0,'{}'::jsonb,'delivered','hanjin','POSALE0000'||n||'1',now()-interval '3 days',now()-interval '2 days' from generate_series(4,5)n
 union all select pg_temp.po_id('shipment',n*10+2),pg_temp.po_id('order',n),pg_temp.po_id('origin',2),'TEST 남양주',0,'{}'::jsonb,'delivered','hanjin','POSALE0000'||n||'2',now()-interval '3 days',now()-interval '2 days' from generate_series(4,5)n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
 select pg_temp.po_id('order',n),pg_temp.po_id('shipment',n*10+k),pg_temp.po_id('item',n*10+k),1 from generate_series(4,5)n cross join generate_series(1,2)k;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type) values
 (pg_temp.po_id('claim',4),pg_temp.po_id('order',4),pg_temp.po_id('user',2),'TEST 주문제작 인쇄 불량 교환','exchange','requested','defect'),
 (pg_temp.po_id('claim',5),pg_temp.po_id('order',5),pg_temp.po_id('user',2),'TEST 주문제작 단순 변심 교환','exchange','requested','change_of_mind');
select public.admin_decide_order_claim(pg_temp.po_id('claim',n),'approve',null) from generate_series(4,5)n;
insert into storage.objects(bucket_id,name,metadata) values
 ('claim-evidence-private',pg_temp.po_id('claim',4)||'/'||pg_temp.po_id('file',4)||'.jpg',jsonb_build_object('mimetype','image/jpeg','size',2048));
select public.admin_register_claim_evidence_file(pg_temp.po_id('claim',4),pg_temp.po_id('file',4),'image/jpeg',2048,repeat('d',64))->>'id' as evidence_four \gset
create function pg_temp.po_waiver(reason text default 'TEST 고객 사진으로 인쇄 불량 확인') returns jsonb language sql immutable as $$
 select jsonb_build_object('reason',reason,'evidenceFileIds',jsonb_build_array(pg_temp.po_id('file',4)))$$;
select pg_temp.po_assert(:'evidence_four'=pg_temp.po_id('file',4)::text
 and not exists(select 1 from private.order_production_jobs where claim_id in(pg_temp.po_id('claim',4),pg_temp.po_id('claim',5))),'approval alone opens no replacement production');

-- 재출고와 같은 요청의 회수 생략은 제작 전이라 거절되고, 결정·제작 작업도 남지 않는다.
select pg_temp.po_error(format('select pg_temp.po_reship(4,%L,41,%L::jsonb,%L,''[]'',%L::jsonb)',pg_temp.po_id('shipment',41),pg_temp.po_fresh(4)::text,'POMTO0000041',pg_temp.po_waiver()::text),'production_incomplete');
select pg_temp.po_assert(not exists(select 1 from public.order_claim_collection_waivers where claim_id=pg_temp.po_id('claim',4))
 and not exists(select 1 from private.order_production_jobs where claim_id=pg_temp.po_id('claim',4)),'inline waiver on a made-to-order origin leaves nothing behind');
-- 남양주(일반)는 입고 뒤 먼저 재출고한다. 김포 주문제작의 제작이 남아도 막히지 않는다(제작 검사는 배송 건마다).
select public.admin_record_order_claim_origin_collection(pg_temp.po_id('claim',4),pg_temp.po_id('shipment',42),'TEST 남양주 입고');
select pg_temp.po_error(format('select public.admin_waive_order_claim_collection(%L,%L,%L::jsonb)',pg_temp.po_id('claim',4),pg_temp.po_id('shipment',42),pg_temp.po_waiver()::text),'collection_waiver_not_needed');
select pg_temp.po_reship(4,pg_temp.po_id('shipment',42),42,pg_temp.po_fresh(4),'POMTO0000042')->>'state' as normal_first \gset
select pg_temp.po_assert(:'normal_first'='saved'
 and (select stage='collecting' and reshipped_at is not null from public.order_cancellation_requests where id=pg_temp.po_id('claim',4))
 and not exists(select 1 from private.order_production_jobs where claim_id=pg_temp.po_id('claim',4)),'normal origin reships while the made-to-order origin waits');
select pg_temp.po_error(format('select public.admin_waive_order_claim_collection(%L,%L,%L::jsonb)',pg_temp.po_id('claim',5),pg_temp.po_id('shipment',51),pg_temp.po_waiver()::text),'collection_waiver_not_allowed');

-- 김포 회수 생략 결정: 결정 시각 기준 교환품 제작 작업이 생기고, 회수 없이도 제작을 시작할 수 있다. 재고는 그대로다.
select pg_temp.po_stock(pg_temp.po_default('po-good-1')) as gimpo_stock_before \gset
select public.admin_waive_order_claim_collection(pg_temp.po_id('claim',4),pg_temp.po_id('shipment',41),pg_temp.po_waiver())::text as waiver_decision \gset
select pg_temp.po_assert((:'waiver_decision'::jsonb->>'productionPending')::boolean and not(:'waiver_decision'::jsonb->>'replayed')::boolean
 and (select reason='TEST 고객 사진으로 인쇄 불량 확인' and evidence_file_ids=array[pg_temp.po_id('file',4)] and waived_by=pg_temp.po_id('user',1)
  from public.order_claim_collection_waivers where claim_id=pg_temp.po_id('claim',4) and shipment_id=pg_temp.po_id('shipment',41))
 and (select count(*)=1 and bool_and(state='pending' and basis_at is not null and due_at>basis_at and order_item_id=pg_temp.po_id('item',41))
  from private.order_production_jobs where claim_id=pg_temp.po_id('claim',4))
 and private.claim_collections_complete(pg_temp.po_id('claim',4))
 and (select (j->>'canStart')::boolean from jsonb_array_elements(private.order_production_document(pg_temp.po_id('order',4),true)->'jobs') j
  where j->>'claimId'=pg_temp.po_id('claim',4)::text)
 and (select t->'waiver'->>'reason'='TEST 고객 사진으로 인쇄 불량 확인' and t#>>'{waiver,evidence,0,id}'=pg_temp.po_id('file',4)::text
   and (t->>'productionRequired')::boolean and (t->>'productionPending')::boolean
  from jsonb_array_elements(public.admin_order_claim_detail(pg_temp.po_id('claim',4))#>'{claim,reshipmentTargets}') t where t->>'shipmentId'=pg_temp.po_id('shipment',41)::text)
 and exists(select 1 from public.audit_log where action='admin.order.claim_collection_waived' and diff->>'shipmentId'=pg_temp.po_id('shipment',41)::text)
 and pg_temp.po_stock(pg_temp.po_default('po-good-1'))=:gimpo_stock_before,
 'made-to-order waiver opens replacement production before the reshipment');
select pg_temp.po_assert((public.admin_waive_order_claim_collection(pg_temp.po_id('claim',4),pg_temp.po_id('shipment',41),pg_temp.po_waiver())->>'replayed')::boolean,
 'the same waiver decision replays');
select pg_temp.po_error(format('select public.admin_waive_order_claim_collection(%L,%L,%L::jsonb)',pg_temp.po_id('claim',4),pg_temp.po_id('shipment',41),
 pg_temp.po_waiver('TEST 다른 사유로 다시 회수 생략')::text),'collection_waiver_conflict');
select pg_temp.po_error(format('select pg_temp.po_reship(4,%L,43,%L::jsonb,%L,''[]'',%L::jsonb)',pg_temp.po_id('shipment',41),pg_temp.po_fresh(4)::text,'POMTO0000043',
 pg_temp.po_waiver('TEST 다른 사유로 다시 회수 생략')::text),'collection_waiver_conflict');
-- 제작 완료 전에는 재출고하지 않는다.
select pg_temp.po_error(format('select pg_temp.po_reship(4,%L,44,%L::jsonb,%L)',pg_temp.po_id('shipment',41),pg_temp.po_fresh(4)::text,'POMTO0000044'),'production_incomplete');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.po_id('user',1),'role','authenticated','session_id',pg_temp.po_id('session',1))::text,true);
select public.admin_change_order_production(id,'start',revision,pg_temp.po_id('production-op',1),pg_temp.po_id('user',1),pg_temp.po_id('session',1),'TEST 교환품 재제작 시작')->>'state' as production_started
 from private.order_production_jobs where claim_id=pg_temp.po_id('claim',4) \gset
select public.admin_change_order_production(id,'complete',revision,pg_temp.po_id('production-op',2),pg_temp.po_id('user',1),pg_temp.po_id('session',1),'TEST 교환품 재제작 완료')->>'state' as production_completed
 from private.order_production_jobs where claim_id=pg_temp.po_id('claim',4) \gset
select set_config('request.jwt.claims','',true);
-- 결정된 회수 생략은 재출고 요청에 다시 싣지 않아도 그 배송 건의 회수 생략이다. 회수품 재고는 복원하지 않는다.
select pg_temp.po_reship(4,pg_temp.po_id('shipment',41),45,pg_temp.po_fresh(4),'POMTO0000045')->>'state' as made_to_order_reship \gset
select pg_temp.po_assert(:'production_started'='started' and :'production_completed'='completed' and :'made_to_order_reship'='saved'
 and (select stage='completed' and completed_at is not null from public.order_cancellation_requests where id=pg_temp.po_id('claim',4))
 and (select collection_waived and waiver_reason='TEST 고객 사진으로 인쇄 불량 확인' and waiver_evidence_file_ids=array[pg_temp.po_id('file',4)]
  from public.order_claim_reshipments where claim_id=pg_temp.po_id('claim',4) and shipment_id=pg_temp.po_id('shipment',41))
 and pg_temp.po_stock(pg_temp.po_default('po-good-1'))=:gimpo_stock_before-1,
 'made-to-order origin reships without collection after production completes');

-- 회수 확인한 배송 건은 클레임 전체 입고를 기다리지 않고 그 배송 건의 교환품 제작을 연다(입고 시각 기준).
select public.admin_record_order_claim_origin_collection(pg_temp.po_id('claim',5),pg_temp.po_id('shipment',51),'TEST 김포 주문제작 입고');
select pg_temp.po_assert((select stage='collecting' from public.order_cancellation_requests where id=pg_temp.po_id('claim',5))
 and (select count(*)=1 and bool_and(basis_at=(select collected_at from public.order_claim_collections where claim_id=pg_temp.po_id('claim',5) and shipment_id=pg_temp.po_id('shipment',51)))
  from private.order_production_jobs where claim_id=pg_temp.po_id('claim',5))
 and (select (j->>'canStart')::boolean from jsonb_array_elements(private.order_production_document(pg_temp.po_id('order',5),true)->'jobs') j
  where j->>'claimId'=pg_temp.po_id('claim',5)::text),'a collected made-to-order origin opens its replacement production');
select public.admin_decide_order_claim(pg_temp.po_id('claim',5),'reject','TEST 단순 변심 교환 거부 확인');
select pg_temp.po_assert((select bool_and(state='canceled') from private.order_production_jobs where claim_id=pg_temp.po_id('claim',5)),
 'rejecting before any reshipment cancels the replacement production');

-- 교환품 제작의 막다른 길과 회수 생략 결정이 효력을 잃는 전환(리뷰 2차 minor).
-- 주문 6: 반품 중 김포 주문제작 입고 → 교환 전환(T3). 주문 7: 이 migration 전에 입고된 진행 중 교환(백필).
-- 주문 8: 회수 생략 결정 뒤 반품 전환(T2). 주문 9: 회수 생략 결정 뒤 사유 정정(T1). 주문 10·11: 교환→반품→교환 왕복(입고·결정 경로).
-- 모두 김포 주문제작 1개 + 남양주 일반 1개.
insert into public.orders(id,user_id,status,total,shipping_fee,address,shipped_at,delivered_at)
 select pg_temp.po_id('order',n),pg_temp.po_id('user',2),'delivered',3000,0,
  jsonb_build_object('recipientName','합성 고객','phone','010-0000-0000','postalCode','12345','address1','합성시 출고지로 1','address2','101호'),
  now()-interval '12 days',now()-interval '2 days' from generate_series(6,11)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.po_id('item',n*10+1),pg_temp.po_id('order',n),'po-good-1',pg_temp.po_default('po-good-1'),1,1000,'TEST 김포 주문제작','문구','po-ip' from generate_series(6,11)n
 union all select pg_temp.po_id('item',n*10+2),pg_temp.po_id('order',n),'po-good-2',pg_temp.po_default('po-good-2'),1,2000,'TEST 남양주 굿즈','문구','po-ip' from generate_series(6,11)n;
set session_replication_role=replica;
update public.order_items set production_terms_snapshot='{"leadDays":3,"dayBasis":"calendar"}' where id in(select pg_temp.po_id('item',n*10+1) from generate_series(6,11)n);
insert into private.order_production_jobs(order_id,order_item_id,terms,state,basis_at,due_at,started_at,completed_at)
 select pg_temp.po_id('order',n),pg_temp.po_id('item',n*10+1),'{"leadDays":3,"dayBasis":"calendar"}','completed',now()-interval '12 days',now()-interval '9 days',now()-interval '11 days',now()-interval '10 days'
 from generate_series(6,11)n;
insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key)
 select pg_temp.po_id('payment',n),pg_temp.po_id('user',2),'order',pg_temp.po_id('order',n),'toss',3000,'paid','per-origin-paid-'||n from generate_series(6,11)n;
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 select pg_temp.po_id('attempt',n),'toss',pg_temp.po_id('user',2),'order',pg_temp.po_id('order',n),3000,'approved','per-origin-attempt-'||n,'per-origin-provider-'||n,'per-origin-code-'||n,
  pg_temp.po_id('payment',n),now()+interval '1 hour' from generate_series(6,11)n;
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) select pg_temp.po_id('attempt',n),'confirm',now() from generate_series(6,11)n;
set session_replication_role=origin;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at)
 select pg_temp.po_id('shipment',n*10+1),pg_temp.po_id('order',n),pg_temp.po_id('origin',1),'TEST 김포',0,'{}'::jsonb,'delivered','hanjin','POSALE0000'||n||'1',now()-interval '3 days',now()-interval '2 days' from generate_series(6,11)n
 union all select pg_temp.po_id('shipment',n*10+2),pg_temp.po_id('order',n),pg_temp.po_id('origin',2),'TEST 남양주',0,'{}'::jsonb,'delivered','hanjin','POSALE0000'||n||'2',now()-interval '3 days',now()-interval '2 days' from generate_series(6,11)n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
 select pg_temp.po_id('order',n),pg_temp.po_id('shipment',n*10+k),pg_temp.po_id('item',n*10+k),1 from generate_series(6,11)n cross join generate_series(1,2)k;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type) values
 (pg_temp.po_id('claim',6),pg_temp.po_id('order',6),pg_temp.po_id('user',2),'TEST 주문제작 인쇄 불량 반품','return','requested','defect'),
 (pg_temp.po_id('claim',7),pg_temp.po_id('order',7),pg_temp.po_id('user',2),'TEST 주문제작 단순 변심 교환','exchange','requested','change_of_mind'),
 (pg_temp.po_id('claim',8),pg_temp.po_id('order',8),pg_temp.po_id('user',2),'TEST 주문제작 인쇄 불량 교환','exchange','requested','defect'),
 (pg_temp.po_id('claim',9),pg_temp.po_id('order',9),pg_temp.po_id('user',2),'TEST 주문제작 인쇄 불량 교환','exchange','requested','defect'),
 (pg_temp.po_id('claim',10),pg_temp.po_id('order',10),pg_temp.po_id('user',2),'TEST 주문제작 왕복 전환 교환','exchange','requested','defect'),
 (pg_temp.po_id('claim',11),pg_temp.po_id('order',11),pg_temp.po_id('user',2),'TEST 주문제작 결정 왕복 전환 교환','exchange','requested','defect');
select public.admin_decide_order_claim(pg_temp.po_id('claim',n),'approve',null) from generate_series(6,11)n;
insert into storage.objects(bucket_id,name,metadata)
 select 'claim-evidence-private',pg_temp.po_id('claim',n)||'/'||pg_temp.po_id('file',n)||'.jpg',jsonb_build_object('mimetype','image/jpeg','size',2048) from unnest(array[6,8,9,11])n;
select count(public.admin_register_claim_evidence_file(pg_temp.po_id('claim',n),pg_temp.po_id('file',n),'image/jpeg',2048,repeat('c',64))) as late_evidence from unnest(array[8,9,11])n \gset
create function pg_temp.po_late_waiver(n integer) returns jsonb language sql immutable as $$
 select jsonb_build_object('reason','TEST 고객 사진으로 인쇄 불량 확인','evidenceFileIds',jsonb_build_array(pg_temp.po_id('file',n)))$$;
create function pg_temp.po_can_start(n integer) returns boolean language sql stable as $$
 select coalesce((select (j->>'canStart')::boolean from jsonb_array_elements(private.order_production_document(pg_temp.po_id('order',n),true)->'jobs') j
  where j->>'claimId'=pg_temp.po_id('claim',n)::text and j->>'itemId'=pg_temp.po_id('item',n*10+1)::text),false)$$;
create function pg_temp.po_late_production(n integer,kind text,op integer) returns text language sql volatile as $$
 select public.admin_change_order_production(j.id,kind,j.revision,pg_temp.po_id('production-op',op),pg_temp.po_id('user',1),pg_temp.po_id('session',1),'TEST 교환품 재제작 '||kind)->>'state'
 from private.order_production_jobs j where j.claim_id=pg_temp.po_id('claim',n) and j.order_item_id=pg_temp.po_id('item',n*10+1)$$;
select pg_temp.po_assert(:late_evidence=3 and (select bool_and(stage='collecting') from public.order_cancellation_requests where id in(select pg_temp.po_id('claim',n) from generate_series(6,11)n)),
 'late made-to-order fixtures are collecting');

-- T3: 반품 중에 입고된 김포 주문제작은 교환 전환 때 그 입고 시각 기준 교환품 제작 작업이 생기고, 남양주를 회수 없이 보낸 뒤에도
-- 제작을 마치면 재출고된다(클레임이 입고완료가 되지 않아도 막히지 않는다).
select public.admin_record_order_claim_origin_collection(pg_temp.po_id('claim',6),pg_temp.po_id('shipment',61),'TEST 김포 주문제작 입고(반품 중)');
select pg_temp.po_assert(not exists(select 1 from private.order_production_jobs where claim_id=pg_temp.po_id('claim',6)),'a return claim opens no replacement production');
select public.admin_convert_order_claim_type(pg_temp.po_id('claim',6),pg_temp.po_id('conv-op',6),c.claim_revision,'exchange','TEST 고객 요청으로 교환 전환',true,null) is not null as t3_converted
 from public.order_cancellation_requests c where c.id=pg_temp.po_id('claim',6) \gset
select pg_temp.po_assert(:'t3_converted'::boolean
 and (select claim_type='exchange' and stage='collecting' from public.order_cancellation_requests where id=pg_temp.po_id('claim',6))
 and (select count(*)=1 and bool_and(state='pending' and order_item_id=pg_temp.po_id('item',61)
   and basis_at=(select collected_at from public.order_claim_collections where claim_id=pg_temp.po_id('claim',6) and shipment_id=pg_temp.po_id('shipment',61)))
  from private.order_production_jobs where claim_id=pg_temp.po_id('claim',6))
 and pg_temp.po_can_start(6),'converting to exchange opens production for the origin collected during the return');
-- 근거 사진은 교환 클레임에만 올린다 — 교환으로 바뀐 뒤 등록한다.
select public.admin_register_claim_evidence_file(pg_temp.po_id('claim',6),pg_temp.po_id('file',6),'image/jpeg',2048,repeat('c',64))->>'id' as t3_evidence \gset
select pg_temp.po_reship(6,pg_temp.po_id('shipment',62),61,pg_temp.po_fresh(6),'POCONV000062','[]',pg_temp.po_late_waiver(6))->>'state' as t3_waived \gset
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.po_id('user',1),'role','authenticated','session_id',pg_temp.po_id('session',1))::text,true);
select pg_temp.po_late_production(6,'start',61) as t3_started \gset
select pg_temp.po_late_production(6,'complete',62) as t3_completed \gset
select set_config('request.jwt.claims','',true);
select pg_temp.po_reship(6,pg_temp.po_id('shipment',61),62,pg_temp.po_fresh(6),'POCONV000061')->>'state' as t3_gimpo \gset
select pg_temp.po_assert(:'t3_waived'='saved' and :'t3_started'='started' and :'t3_completed'='completed' and :'t3_gimpo'='saved'
 and (select stage='completed' from public.order_cancellation_requests where id=pg_temp.po_id('claim',6)),
 'the converted exchange finishes after its replacement production');

-- 백필: 이 migration 전에 입고돼(제작 작업 없이) 진행 중인 교환도 같은 함수가 입고 시각 기준 작업을 만든다. 다시 불러도 하나다.
set session_replication_role=replica;
update public.order_claim_collections set collected_at=now()-interval '1 day',collected_by=pg_temp.po_id('user',1),evidence='TEST 이전 입고'
 where claim_id=pg_temp.po_id('claim',7) and shipment_id=pg_temp.po_id('shipment',71);
set session_replication_role=origin;
select pg_temp.po_assert(not exists(select 1 from private.order_production_jobs where claim_id=pg_temp.po_id('claim',7)),'a pre-migration collection has no replacement job');
select private.ensure_claim_ready_production_jobs(pg_temp.po_id('claim',7));
select private.ensure_claim_ready_production_jobs(pg_temp.po_id('claim',7));
select pg_temp.po_assert((select count(*)=1 and bool_and(order_item_id=pg_temp.po_id('item',71) and state='pending'
   and basis_at=(select collected_at from public.order_claim_collections where claim_id=pg_temp.po_id('claim',7) and shipment_id=pg_temp.po_id('shipment',71)))
  from private.order_production_jobs where claim_id=pg_temp.po_id('claim',7)) and pg_temp.po_can_start(7),
 'backfill opens production for an origin collected before this migration, once');

-- T2: 김포 회수 생략 결정 뒤 남양주 입고로 입고완료가 된 교환을 반품으로 바꾸면, 김포는 다시 회수가 필요하므로 수거중으로 되돌리고
-- 회수 완료 시각을 비운다(감사 기록). 남양주 입고 기록과 결정 기록은 그대로다.
select public.admin_waive_order_claim_collection(pg_temp.po_id('claim',8),pg_temp.po_id('shipment',81),pg_temp.po_late_waiver(8))->>'productionPending' as t2_pending \gset
select public.admin_record_order_claim_origin_collection(pg_temp.po_id('claim',8),pg_temp.po_id('shipment',82),'TEST 남양주 입고');
select pg_temp.po_assert(:'t2_pending'::boolean and (select stage='collected' and collected_at is not null from public.order_cancellation_requests where id=pg_temp.po_id('claim',8)),
 'a waiver plus the other origin completes the collection');
select public.admin_convert_order_claim_type(pg_temp.po_id('claim',8),pg_temp.po_id('conv-op',8),c.claim_revision,'return','TEST 고객 요청으로 반품 전환',true,null) is not null as t2_converted
 from public.order_cancellation_requests c where c.id=pg_temp.po_id('claim',8) \gset
select pg_temp.po_assert(:'t2_converted'::boolean
 and (select claim_type='return' and stage='collecting' and status='requested' and collected_at is null from public.order_cancellation_requests where id=pg_temp.po_id('claim',8))
 and not private.claim_collections_complete(pg_temp.po_id('claim',8))
 and (select collected_at is not null from public.order_claim_collections where claim_id=pg_temp.po_id('claim',8) and shipment_id=pg_temp.po_id('shipment',82))
 and exists(select 1 from public.order_claim_collection_waivers where claim_id=pg_temp.po_id('claim',8) and shipment_id=pg_temp.po_id('shipment',81))
 and (select bool_and(state='canceled') from private.order_production_jobs where claim_id=pg_temp.po_id('claim',8))
 and (select diff->'shipmentIds'=jsonb_build_array(pg_temp.po_id('shipment',81)) and diff->>'cause'='collection_waiver_ineffective'
  from public.audit_log where action='admin.order.claim_collection_reopened' and diff->>'claimId'=pg_temp.po_id('claim',8)::text),
 'converting a waived exchange to a return reopens the collection');
select pg_temp.po_error(format('select public.admin_record_order_claim_refund(%L,''pg_cancel'',''filed'',null)',pg_temp.po_id('claim',8)),'claim_collections_incomplete');
select public.admin_record_order_claim_origin_collection(pg_temp.po_id('claim',8),pg_temp.po_id('shipment',81),'TEST 김포 실제 반송 입고');
select pg_temp.po_assert((select stage='collected' and collected_at is not null from public.order_cancellation_requests where id=pg_temp.po_id('claim',8)),
 'the real return of the waived origin completes the return collection again');

-- T1: 결정 뒤 사유를 단순 변심으로 정정하면 결정이 효력을 잃어 수거중으로 되돌아가고 김포는 회수가 먼저다. 하자로 되돌리면 결정이 다시 효력이 있다.
select public.admin_waive_order_claim_collection(pg_temp.po_id('claim',9),pg_temp.po_id('shipment',91),pg_temp.po_late_waiver(9))->>'productionPending' as t1_pending \gset
select public.admin_record_order_claim_origin_collection(pg_temp.po_id('claim',9),pg_temp.po_id('shipment',92),'TEST 남양주 입고');
select pg_temp.po_assert(:'t1_pending'::boolean and pg_temp.po_can_start(9) and (select stage='collected' from public.order_cancellation_requests where id=pg_temp.po_id('claim',9)),
 'the waived made-to-order origin can start production');
select public.admin_change_order_claim_reason(pg_temp.po_id('claim',9),pg_temp.po_id('reason-op',9),c.claim_revision,pg_temp.po_id('user',1),'change_of_mind',
 'TEST 단순 변심으로 정정','TEST 고객과 통화로 확인',true,true) is not null as t1_changed from public.order_cancellation_requests c where c.id=pg_temp.po_id('claim',9) \gset
select pg_temp.po_assert(:'t1_changed'::boolean
 and (select reason_type='change_of_mind' and stage='collecting' and collected_at is null from public.order_cancellation_requests where id=pg_temp.po_id('claim',9))
 and not private.claim_collection_waived(pg_temp.po_id('claim',9),pg_temp.po_id('shipment',91)) and not pg_temp.po_can_start(9)
 and exists(select 1 from public.audit_log where action='admin.order.claim_collection_reopened' and diff->>'claimId'=pg_temp.po_id('claim',9)::text),
 'a reason change that voids the waiver reopens the collection and closes production');
select pg_temp.po_error(format('select pg_temp.po_reship(9,%L,91,%L::jsonb,%L)',pg_temp.po_id('shipment',91),pg_temp.po_fresh(9)::text,'POREASON0091'),'claim_collections_incomplete');
select public.admin_change_order_claim_reason(pg_temp.po_id('claim',9),pg_temp.po_id('reason-op',10),c.claim_revision,pg_temp.po_id('user',1),'defect',
 'TEST 하자로 다시 정정','TEST 고객과 다시 통화',true,true) is not null as t1_back from public.order_cancellation_requests c where c.id=pg_temp.po_id('claim',9) \gset
select pg_temp.po_assert(:'t1_back'::boolean and private.claim_collection_waived(pg_temp.po_id('claim',9),pg_temp.po_id('shipment',91)) and pg_temp.po_can_start(9),
 'restoring the defect reason makes the waiver count again');

-- 교환→반품→교환 왕복(입고 경로, 리뷰 3차): 김포 입고로 일찍 생긴 작업을 시작한 뒤 반품으로 바꾸면 취소되고, 다시 교환으로
-- 바꾸면 대기로 되살아난다(시작은 다시 기록, 납기는 되살린 때부터 새로 — T11b가 open_claim_production_job을 앵커 치환).
-- 남양주 입고·제작 완료 뒤 두 출고지 모두 재출고돼 종결된다.
select public.admin_record_order_claim_origin_collection(pg_temp.po_id('claim',10),pg_temp.po_id('shipment',101),'TEST 김포 주문제작 입고');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.po_id('user',1),'role','authenticated','session_id',pg_temp.po_id('session',1))::text,true);
select pg_temp.po_late_production(10,'start',101) as flip_started \gset
select set_config('request.jwt.claims','',true);
select revision as flip_revision_started from private.order_production_jobs where claim_id=pg_temp.po_id('claim',10) \gset
select public.admin_convert_order_claim_type(pg_temp.po_id('claim',10),pg_temp.po_id('conv-op',10),c.claim_revision,'return','TEST 반품으로 전환',true,null) is not null as flip_to_return
 from public.order_cancellation_requests c where c.id=pg_temp.po_id('claim',10) \gset
select pg_temp.po_assert(:'flip_started'='started' and :'flip_to_return'::boolean
 and (select state='canceled' and started_at is not null from private.order_production_jobs where claim_id=pg_temp.po_id('claim',10)),
 'converting to a return cancels the started replacement job');
select public.admin_convert_order_claim_type(pg_temp.po_id('claim',10),pg_temp.po_id('conv-op',11),c.claim_revision,'exchange','TEST 다시 교환으로 전환',true,null) is not null as flip_back
 from public.order_cancellation_requests c where c.id=pg_temp.po_id('claim',10) \gset
select pg_temp.po_assert(:'flip_back'::boolean
 and (select count(*)=1 and bool_and(state='pending' and started_at is null and completed_at is null and revision>:flip_revision_started
   and basis_at>=(select collected_at from public.order_claim_collections where claim_id=pg_temp.po_id('claim',10) and shipment_id=pg_temp.po_id('shipment',101))
   and basis_at>=now() and due_at>=now()+interval '3 days')
  from private.order_production_jobs where claim_id=pg_temp.po_id('claim',10))
 and pg_temp.po_can_start(10)
 and (select count(*)=1 from private.order_production_events e join private.order_production_jobs j on j.id=e.job_id where j.claim_id=pg_temp.po_id('claim',10) and e.kind='start'),
 'flipping back to exchange revives the canceled job as pending and keeps its history');
select public.admin_record_order_claim_origin_collection(pg_temp.po_id('claim',10),pg_temp.po_id('shipment',102),'TEST 남양주 입고');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.po_id('user',1),'role','authenticated','session_id',pg_temp.po_id('session',1))::text,true);
select pg_temp.po_late_production(10,'start',102) as flip_restarted \gset
select pg_temp.po_late_production(10,'complete',103) as flip_completed \gset
select set_config('request.jwt.claims','',true);
select pg_temp.po_reship(10,pg_temp.po_id('shipment',101),101,pg_temp.po_fresh(10),'POFLIP000101')->>'state' as flip_gimpo \gset
select pg_temp.po_reship(10,pg_temp.po_id('shipment',102),102,pg_temp.po_fresh(10),'POFLIP000102')->>'state' as flip_namyangju \gset
select pg_temp.po_assert(:'flip_restarted'='started' and :'flip_completed'='completed' and :'flip_gimpo'='saved' and :'flip_namyangju'='saved'
 and (select stage='completed' from public.order_cancellation_requests where id=pg_temp.po_id('claim',10)),
 'the round-tripped exchange reships both origins after production');

-- 교환→반품→교환 왕복(결정 경로): 회수 생략 결정으로 생긴 작업을 완료한 뒤 왕복하면 완료 그대로 되살아나 다시 만들지 않고,
-- 결정이 다시 효력을 얻어 김포는 회수 없이, 남양주는 입고 뒤 재출고된다.
select public.admin_waive_order_claim_collection(pg_temp.po_id('claim',11),pg_temp.po_id('shipment',111),pg_temp.po_late_waiver(11))->>'productionPending' as flip_waiver \gset
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.po_id('user',1),'role','authenticated','session_id',pg_temp.po_id('session',1))::text,true);
select pg_temp.po_late_production(11,'start',111) as flip_waiver_started \gset
select pg_temp.po_late_production(11,'complete',112) as flip_waiver_completed \gset
select set_config('request.jwt.claims','',true);
select completed_at::text as flip_completed_at from private.order_production_jobs where claim_id=pg_temp.po_id('claim',11) \gset
select public.admin_convert_order_claim_type(pg_temp.po_id('claim',11),pg_temp.po_id('conv-op',12),c.claim_revision,'return','TEST 반품으로 전환',true,null) is not null as flip_waiver_return
 from public.order_cancellation_requests c where c.id=pg_temp.po_id('claim',11) \gset
select pg_temp.po_assert(:'flip_waiver'::boolean and :'flip_waiver_started'='started' and :'flip_waiver_completed'='completed' and :'flip_waiver_return'::boolean
 and (select state='canceled' and completed_at is not null from private.order_production_jobs where claim_id=pg_temp.po_id('claim',11)),
 'converting to a return cancels even the completed replacement job');
select public.admin_convert_order_claim_type(pg_temp.po_id('claim',11),pg_temp.po_id('conv-op',13),c.claim_revision,'exchange','TEST 다시 교환으로 전환',true,null) is not null as flip_waiver_back
 from public.order_cancellation_requests c where c.id=pg_temp.po_id('claim',11) \gset
select pg_temp.po_assert(:'flip_waiver_back'::boolean and private.claim_collection_waived(pg_temp.po_id('claim',11),pg_temp.po_id('shipment',111))
 and (select state='completed' and completed_at::text=:'flip_completed_at' and started_at is not null from private.order_production_jobs where claim_id=pg_temp.po_id('claim',11)),
 'a job completed before the round trip comes back completed');
select public.admin_record_order_claim_origin_collection(pg_temp.po_id('claim',11),pg_temp.po_id('shipment',112),'TEST 남양주 입고');
select pg_temp.po_reship(11,pg_temp.po_id('shipment',111),111,pg_temp.po_fresh(11),'POFLIP000111')->>'state' as flip_waived_gimpo \gset
select pg_temp.po_reship(11,pg_temp.po_id('shipment',112),112,pg_temp.po_fresh(11),'POFLIP000112')->>'state' as flip_waived_namyangju \gset
select pg_temp.po_assert(:'flip_waived_gimpo'='saved' and :'flip_waived_namyangju'='saved'
 and (select stage='completed' from public.order_cancellation_requests where id=pg_temp.po_id('claim',11))
 and (select collection_waived from public.order_claim_reshipments where claim_id=pg_temp.po_id('claim',11) and shipment_id=pg_temp.po_id('shipment',111)),
 'the waived made-to-order origin reships without remaking after the round trip');

-- 선물 받은 분은 배송 건 재출고 소포(운송장)를 받는다. 보낸 분과 옛 한 쌍 재출고만 있는 선물에는 새 키를 싣지 않는다.
set session_replication_role=replica;
insert into private.gift_intents(id,sender_id,recipient_id,state,sender_label,expires_at,accepted_at,order_id,ordered_source_revision) values
 (pg_temp.po_id('gift',1),pg_temp.po_id('user',2),pg_temp.po_id('user',3),'ordered','TEST 보낸 분',now()+interval '7 days',now(),pg_temp.po_id('order',1),'r1'),
 (pg_temp.po_id('gift',3),pg_temp.po_id('user',2),pg_temp.po_id('user',3),'ordered','TEST 보낸 분',now()+interval '7 days',now(),pg_temp.po_id('order',3),'r3');
set session_replication_role=origin;
select pg_temp.po_assert(jsonb_array_length(private.gift_claim_context(pg_temp.po_id('user',3),pg_temp.po_id('gift',1))->'reshipmentParcels')=2
 and (select count(*)=2 from jsonb_array_elements(private.gift_claim_context(pg_temp.po_id('user',3),pg_temp.po_id('gift',1))->'reshipmentParcels') p
  where p->>'reshipmentId' is not null and p->>'trackingNumber' in('POGIMPO00001','PONAMYANG001') and not(p ? 'originName'))
 and private.gift_claim_context(pg_temp.po_id('user',3),pg_temp.po_id('gift',1))#>'{claim,reshipTrackingNumber}'='null'::jsonb
 and not(private.gift_claim_context(pg_temp.po_id('user',2),pg_temp.po_id('gift',1)) ? 'reshipmentParcels')
 and not(private.gift_claim_context(pg_temp.po_id('user',3),pg_temp.po_id('gift',3)) ? 'reshipmentParcels')
 and private.gift_claim_context(pg_temp.po_id('user',3),pg_temp.po_id('gift',3))#>>'{claim,reshipTrackingNumber}'='POLEGACY0003',
 'gift recipient sees every per-origin parcel; sender and legacy-only gifts keep the old shape');
rollback;
