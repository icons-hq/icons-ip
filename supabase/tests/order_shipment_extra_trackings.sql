\set ON_ERROR_STOP on
-- QNA-019 배송 건 추가(연결) 운송장. 서원 회신의 같은 배송 건 다른 송장번호는 '대표 + 추가'로 저장하고, 운영자는 사유와 함께
-- 추가·삭제한다. 다른 고객의 배송 건 번호는 받지 않고(개인정보), 고객은 자기 주문의 추가 운송장만 읽는다.
-- 합성 계정·주문만 쓰고 끝에서 모두 되돌린다. legacy fixture 없이 역할 설정 전 DB에서 돈다.
begin;
do $$ begin
 if to_regclass('private.operator_legacy_fixture_control') is not null then
  raise exception 'Extra tracking tests must run without the legacy fixture helper';end if;
end $$;
update private.operator_access_state set configured=false,revision=1 where id;

create function pg_temp.xt_id(kind integer,n integer) returns uuid language sql immutable as $$
 select ('f13a0000-0000-'||lpad(kind::text,4,'0')||'-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.xt_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Extra tracking assertion: %',label;end if;
end $$;
create function pg_temp.xt_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;
 exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected error % from %',expected,statement;
end $$;
create function pg_temp.xt_as(n integer) returns void language sql as $$
 select set_config('request.jwt.claim.sub',pg_temp.xt_id(1,n)::text,true);
$$;

-- 계정: 1 주매니저, 2 물류출고관리, 3 부매니저(판매 권한 없음), 4·5 구매자.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.xt_id(1,n),'authenticated','authenticated','extra-tracking-'||n||'@example.test',now(),'{}','{}',now(),now()
from generate_series(1,5) n;
update public.profiles set role=(case when right(id::text,2) in ('04','05') then 'user' else 'staff' end)::public.user_role,
 nickname='extra_tracking_'||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
where id::text like 'f13a0000-0000-0001-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values
 (pg_temp.xt_id(1,1),'primary'),(pg_temp.xt_id(1,2),'logistics'),(pg_temp.xt_id(1,3),'deputy');

-- 주문: 1·2·4 남양주(서원) 발주확인·출고지시 전달, 3 김포. 1·3·4는 구매자 4, 2는 구매자 5.
insert into public.ips(id,title,vertical_key) values('extra-tracking-ip','합성 추가 운송장 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('extra-tracking-good','extra-tracking-ip','합성 대형 상품','문구',1000,'ok',100);
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at)
select pg_temp.xt_id(2,n),pg_temp.xt_id(1,case when n=2 then 5 else 4 end),'confirmed'::public.order_status,5000,3000,
 jsonb_build_object('recipientName','합성수령인'||n,'phone','0109876543'||n,'postalCode','00123','address1','합성 주소','address2',n||'층','deliveryNote',''),now()
from generate_series(1,4) n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select pg_temp.xt_id(3,n),pg_temp.xt_id(2,n),'extra-tracking-good',v.id,1,1000,'합성 대형 상품','문구','extra-tracking-ip'
from generate_series(1,4) n cross join (select id from public.goods_variants where good_id='extra-tracking-good' and is_default) v;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,exported_at)
select pg_temp.xt_id(4,n),pg_temp.xt_id(2,n),
 case when n=3 then '00000000-0000-4000-8000-000000042201'::uuid else '00000000-0000-4000-8000-000000042202'::uuid end,
 case when n=3 then '김포' else '남양주' end,3000,'{}',now()
from generate_series(1,4) n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
select pg_temp.xt_id(2,n),pg_temp.xt_id(4,n),pg_temp.xt_id(3,n),1 from generate_series(1,4) n;

-- A. 표·권한 계약. 추가 운송장 표는 RLS로 읽기만 열고, 쓰기는 RPC만이다. 운영자 RPC는 출고 권한(sales.dispatch)이다.
select pg_temp.xt_assert((select relrowsecurity from pg_class where oid='public.order_shipment_extra_trackings'::regclass)
 and has_table_privilege('authenticated','public.order_shipment_extra_trackings','select')
 and not has_table_privilege('authenticated','public.order_shipment_extra_trackings','insert,update,delete')
 and not has_table_privilege('anon','public.order_shipment_extra_trackings','select')
 and not has_table_privilege('authenticated','private.order_shipment_tracking_changes','select'),'extra tracking table grants');
select pg_temp.xt_assert((select capability from private.operator_rpc_contracts where signature='public.admin_add_shipment_extra_tracking(uuid,text,text,text,uuid)')='sales.dispatch'
 and (select capability from private.operator_rpc_contracts where signature='public.admin_remove_shipment_extra_tracking(uuid,text,uuid)')='sales.dispatch'
 and not has_function_privilege('anon','public.admin_add_shipment_extra_tracking(uuid,text,text,text,uuid)','execute')
 and not has_function_privilege('authenticated','private.assert_reply_extra_trackings(jsonb)','execute'),'operator RPC contracts');

-- B. 서원 회신: 같은 배송 건의 다른 송장번호를 대표 + 추가로 저장한다(물류출고관리 권한).
set local role authenticated;
select pg_temp.xt_as(2);
select public.admin_import_seowon_tracking_batch('00000000-0000-4000-8000-000000042202',jsonb_build_array(
 jsonb_build_object('line',2,'reference',pg_temp.xt_id(4,1)::text,'carrier','epost','trackingNumber','XT10000001','extraTrackingNumbers',jsonb_build_array('xt-1000-0002')))) as reply_one \gset
select pg_temp.xt_assert(:'reply_one'::jsonb#>>'{0,ok}'='true' and :'reply_one'::jsonb#>>'{0,dispatched}'='true'
 and :'reply_one'::jsonb#>'{0,extraTrackingNumbers}'='["XT10000002"]'::jsonb and :'reply_one'::jsonb#>>'{0,extraTrackingsAdded}'='1','seowon reply stores representative and extra');
reset role;
select pg_temp.xt_assert((select status||':'||tracking_number from public.order_shipments where id=pg_temp.xt_id(4,1))='shipping:XT10000001'
 and (select array_agg(carrier||':'||tracking_number||':'||source) from public.order_shipment_extra_trackings where shipment_id=pg_temp.xt_id(4,1))=array['epost:XT10000002:warehouse_reply']
 and (select count(*) from private.order_shipment_tracking_changes where shipment_id=pg_temp.xt_id(4,1) and action='added' and source='warehouse_reply' and actor_id=pg_temp.xt_id(1,2))=1
 and (select count(*) from public.audit_log where action='admin.shipment.extra_tracking_added' and target='order:'||pg_temp.xt_id(2,1) and diff->>'trackingNumber'='XT10000002')=1
 and (select count(*) from public.order_shipment_email_jobs where shipment_id=pg_temp.xt_id(4,1))=1,
 'representative stays on the shipment, extra is recorded with history, audit and one shipped mail');

-- 같은 회신을 다시 올리면(다른 운영자가 먼저 등록) 아무것도 바꾸지 않는다. 회신에 없던 추가 번호는 덮어쓰거나 더하지 않는다.
set local role authenticated;
select pg_temp.xt_as(1);
select public.admin_import_seowon_tracking_batch('00000000-0000-4000-8000-000000042202',jsonb_build_array(
 jsonb_build_object('line',2,'reference',pg_temp.xt_id(4,1)::text,'carrier','epost','trackingNumber','XT10000001','extraTrackingNumbers',jsonb_build_array('XT10000002')))) as reply_again \gset
select pg_temp.xt_assert(:'reply_again'::jsonb#>>'{0,ok}'='true' and :'reply_again'::jsonb#>>'{0,dispatched}'='false'
 and :'reply_again'::jsonb#>>'{0,extraTrackingsAdded}'='0','same reply is unchanged');
select pg_temp.xt_error(format('select public.admin_import_seowon_tracking_batch(%L,%L::jsonb)','00000000-0000-4000-8000-000000042202',
 jsonb_build_array(jsonb_build_object('line',2,'reference',pg_temp.xt_id(4,1)::text,'carrier','epost','trackingNumber','XT10000001','extraTrackingNumbers',jsonb_build_array('XT10000009')))),
 'shipment_tracking_conflict');
-- 다른 고객의 배송 건이 쓰는 번호(대표·추가)는 추가 운송장으로 받지 않는다. 형식·중복·대표와 같은 번호도 거절한다.
select pg_temp.xt_error(format('select public.admin_import_seowon_tracking_batch(%L,%L::jsonb)','00000000-0000-4000-8000-000000042202',
 jsonb_build_array(jsonb_build_object('line',3,'reference',pg_temp.xt_id(4,2)::text,'carrier','epost','trackingNumber','XT20000001','extraTrackingNumbers',jsonb_build_array('XT10000002')))),
 'tracking_number_in_use');
select pg_temp.xt_error(format('select public.admin_import_seowon_tracking_batch(%L,%L::jsonb)','00000000-0000-4000-8000-000000042202',
 jsonb_build_array(jsonb_build_object('line',3,'reference',pg_temp.xt_id(4,2)::text,'carrier','epost','trackingNumber','XT20000001','extraTrackingNumbers',jsonb_build_array('XT10000001')))),
 'tracking_number_in_use');
select pg_temp.xt_error(format('select public.admin_import_seowon_tracking_batch(%L,%L::jsonb)','00000000-0000-4000-8000-000000042202',
 jsonb_build_array(jsonb_build_object('line',3,'reference',pg_temp.xt_id(4,2)::text,'carrier','epost','trackingNumber','XT20000001','extraTrackingNumbers',jsonb_build_array('XT20000001')))),
 'invalid_tracking_row');
select pg_temp.xt_error(format('select public.admin_import_seowon_tracking_batch(%L,%L::jsonb)','00000000-0000-4000-8000-000000042202',
 jsonb_build_array(jsonb_build_object('line',3,'reference',pg_temp.xt_id(4,2)::text,'carrier','epost','trackingNumber','XT20000001','extraTrackingNumbers',jsonb_build_array('XT20000002','XT20000002')))),
 'invalid_tracking_row');
select pg_temp.xt_error(format('select public.admin_import_seowon_tracking_batch(%L,%L::jsonb)','00000000-0000-4000-8000-000000042202',
 jsonb_build_array(jsonb_build_object('line',3,'reference',pg_temp.xt_id(4,2)::text,'carrier','epost','trackingNumber','XT20000001','extraTrackingNumbers',jsonb_build_array('짧음')))),
 'invalid_tracking_input');
-- 추가 운송장 없는 회신은 지금과 같다(결과 행에 추가 운송장 키가 없다).
select public.admin_import_seowon_tracking_batch('00000000-0000-4000-8000-000000042202',jsonb_build_array(
 jsonb_build_object('line',3,'reference',pg_temp.xt_id(4,2)::text,'carrier','epost','trackingNumber','XT20000001'))) as reply_plain \gset
select pg_temp.xt_assert(:'reply_plain'::jsonb#>>'{0,dispatched}'='true' and not (:'reply_plain'::jsonb->0 ? 'extraTrackingNumbers'),'plain reply unchanged');
reset role;
select pg_temp.xt_assert((select count(*) from public.order_shipment_extra_trackings where shipment_id in (pg_temp.xt_id(4,1),pg_temp.xt_id(4,2)))=1
 and (select tracking_number from public.order_shipments where id=pg_temp.xt_id(4,2))='XT20000001','rejected rows changed nothing');

-- C. 회신 대조 후보는 추가 운송장 번호를 싣고, 이미 쓰인 번호 목록에 추가 운송장도 넣는다.
set local role authenticated;
select pg_temp.xt_as(2);
select public.admin_origin_tracking_candidates('00000000-0000-4000-8000-000000042202',array['XT10000002'],array['01098765431']) as candidates \gset
select pg_temp.xt_assert(:'candidates'::jsonb#>'{shipments,0,extraTrackingNumbers}'='["XT10000002"]'::jsonb
 and :'candidates'::jsonb#>'{usedTracking}'=jsonb_build_array(jsonb_build_object('trackingNumber','XT10000002','shipmentId',pg_temp.xt_id(4,1)::text)),
 'reply candidates carry extras');

-- D. 운영자 추가·삭제(사유 필수, operation ID 재전송, 감사). 김포 배송 건은 일반 회신으로 발송한 뒤 추가한다.
select pg_temp.xt_as(1);
select public.admin_import_shipment_tracking_batch(jsonb_build_array(jsonb_build_object('line',1,'reference',pg_temp.xt_id(4,3)::text,'carrier','hanjin','trackingNumber','XT30000001'))) as gimpo \gset
select pg_temp.xt_assert(:'gimpo'::jsonb#>>'{0,dispatched}'='true','gimpo shipment dispatched');
select public.admin_add_shipment_extra_tracking(pg_temp.xt_id(4,3),'hanjin','xt3000-0002','분리배송 연결 송장 확인',pg_temp.xt_id(5,1)) as added \gset
select pg_temp.xt_assert(:'added'::jsonb->>'status'='added','operator adds extra');
select pg_temp.xt_assert((public.admin_add_shipment_extra_tracking(pg_temp.xt_id(4,3),'hanjin','XT30000002','분리배송 연결 송장 확인',pg_temp.xt_id(5,1)))->>'status'='unchanged',
 'same operation replays');
select pg_temp.xt_error(format('select public.admin_add_shipment_extra_tracking(%L,%L,%L,%L,%L)',pg_temp.xt_id(4,3),'hanjin','XT30000003','다른 번호',pg_temp.xt_id(5,1)),'extra_tracking_operation_conflict');
select pg_temp.xt_error(format('select public.admin_add_shipment_extra_tracking(%L,%L,%L,%L,%L)',pg_temp.xt_id(4,3),'hanjin','XT30000002','중복',pg_temp.xt_id(5,2)),'extra_tracking_duplicate');
select pg_temp.xt_error(format('select public.admin_add_shipment_extra_tracking(%L,%L,%L,%L,%L)',pg_temp.xt_id(4,3),'hanjin','XT30000001','대표',pg_temp.xt_id(5,3)),'extra_tracking_is_representative');
select pg_temp.xt_error(format('select public.admin_add_shipment_extra_tracking(%L,%L,%L,%L,%L)',pg_temp.xt_id(4,3),'epost','XT20000001','다른 고객 번호',pg_temp.xt_id(5,4)),'tracking_number_in_use');
select pg_temp.xt_error(format('select public.admin_add_shipment_extra_tracking(%L,%L,%L,%L,%L)',pg_temp.xt_id(4,3),'hanjin','XT30000004','  ',pg_temp.xt_id(5,5)),'extra_tracking_reason_required');
select pg_temp.xt_error(format('select public.admin_add_shipment_extra_tracking(%L,%L,%L,%L,%L)',pg_temp.xt_id(4,3),'hanjin','12','형식',pg_temp.xt_id(5,6)),'invalid_tracking_input');
-- 발송 전 배송 건에는 붙이지 않는다(대표 운송장이 먼저다).
select pg_temp.xt_error(format('select public.admin_add_shipment_extra_tracking(%L,%L,%L,%L,%L)',pg_temp.xt_id(4,4),'epost','XT40000002','발송 전',pg_temp.xt_id(5,7)),'order_not_shipped');
-- 판매 권한이 없는 운영자는 쓰지 못한다.
select pg_temp.xt_as(3);
select pg_temp.xt_error(format('select public.admin_add_shipment_extra_tracking(%L,%L,%L,%L,%L)',pg_temp.xt_id(4,3),'hanjin','XT30000005','권한 없음',pg_temp.xt_id(5,8)),'42501');
select pg_temp.xt_error(format('select public.admin_shipment_tracking_summaries(array[%L]::uuid[])',pg_temp.xt_id(4,3)),'42501');
-- 물류출고관리는 지울 수 있다(사유 필수).
select pg_temp.xt_as(2);
reset role;
select id as gimpo_extra from public.order_shipment_extra_trackings where shipment_id=pg_temp.xt_id(4,3) \gset
set local role authenticated;
select pg_temp.xt_as(2);
select pg_temp.xt_error(format('select public.admin_remove_shipment_extra_tracking(%L,%L,%L)',:'gimpo_extra','',pg_temp.xt_id(5,9)),'extra_tracking_reason_required');
select pg_temp.xt_assert((public.admin_remove_shipment_extra_tracking(:'gimpo_extra','회신 오기 정정',pg_temp.xt_id(5,10)))->>'status'='removed','logistics removes extra');
select pg_temp.xt_assert((public.admin_remove_shipment_extra_tracking(:'gimpo_extra','회신 오기 정정',pg_temp.xt_id(5,10)))->>'status'='unchanged','removal replays');
select pg_temp.xt_error(format('select public.admin_remove_shipment_extra_tracking(%L,%L,%L)',:'gimpo_extra','다시',pg_temp.xt_id(5,11)),'extra_tracking_not_found');
reset role;
select pg_temp.xt_assert(not exists(select 1 from public.order_shipment_extra_trackings where shipment_id=pg_temp.xt_id(4,3))
 and (select array_agg(action||':'||tracking_number||':'||coalesce(reason,'') order by created_at,action) from private.order_shipment_tracking_changes where shipment_id=pg_temp.xt_id(4,3))
  =array['added:XT30000002:분리배송 연결 송장 확인','removed:XT30000002:회신 오기 정정']
 and (select count(*) from public.audit_log where target='order:'||pg_temp.xt_id(2,3) and action in ('admin.shipment.extra_tracking_added','admin.shipment.extra_tracking_removed'))=2
 and (select tracking_number from public.order_shipments where id=pg_temp.xt_id(4,3))='XT30000001','operator changes keep history and never touch the representative');

-- E. 고객은 자기 주문의 추가 운송장만 읽는다. 판매 권한 없는 운영자도 읽지 못한다.
set local role authenticated;
select pg_temp.xt_as(4);
select pg_temp.xt_assert((select array_agg(tracking_number) from public.order_shipment_extra_trackings)=array['XT10000002'],'buyer reads own extra');
select pg_temp.xt_as(5);
select pg_temp.xt_assert(not exists(select 1 from public.order_shipment_extra_trackings),'other buyer reads nothing');
select pg_temp.xt_as(3);
select pg_temp.xt_assert(not exists(select 1 from public.order_shipment_extra_trackings),'operator without order read reads nothing');
select pg_temp.xt_as(1);
select pg_temp.xt_assert((select count(*) from public.order_shipment_extra_trackings)>=1,'order reader reads extras');

-- F. 검색: 배송현황·주문 통합검색·상품주문별 조회의 운송장번호(또는 전체) 칸이 추가 운송장도 찾는다.
select pg_temp.xt_assert((public.admin_search_shipments_console('transit',p_query=>'XT10000002',p_field=>'tracking')#>>'{rows,0,id}')=pg_temp.xt_id(4,1)::text
 and (public.admin_search_shipments_console('transit',p_query=>'xt1000-0002')->>'total')='1'
 and (select count(*) from public.admin_search_orders_console(p_query=>'XT10000002',p_field=>'tracking'))=1
 and (select id from public.admin_search_orders_console(p_query=>'XT10000002',p_field=>'tracking'))=pg_temp.xt_id(2,1)
 and (select array_agg(id) from public.admin_search_orders_console(p_query=>'xt1000-0002',p_field=>'all'))=array[pg_temp.xt_id(2,1)]
 and (public.admin_sales_order_counts(p_query=>'XT10000002',p_field=>'tracking')->>'shipping')='1'
 and (public.admin_search_order_items_console(p_query=>'XT10000002',p_field=>'tracking')->>'total')='1'
 and (public.admin_search_order_items_console(p_query=>'xt1000-0002',p_field=>'all')#>>'{rows,0,orderId}')=pg_temp.xt_id(2,1)::text,
 'search finds extra tracking');
-- 다른 항목 검색은 추가 운송장을 보지 않는다: 연락처·수취인·상품·주문번호로 추가 운송장 번호를 찾아도 아무것도 나오지 않는다.
select pg_temp.xt_assert(not exists(select 1 from public.admin_search_orders_console(p_query=>'10000002',p_field=>'phone'))
 and not exists(select 1 from public.admin_search_orders_console(p_query=>'XT10000002',p_field=>'recipient'))
 and not exists(select 1 from public.admin_search_orders_console(p_query=>'XT10000002',p_field=>'product'))
 and not exists(select 1 from public.admin_search_orders_console(p_query=>'XT10000002',p_field=>'order'))
 and (select sum(value::integer) from jsonb_each_text(public.admin_sales_order_counts(p_query=>'10000002',p_field=>'phone')))=0
 and (select sum(value::integer) from jsonb_each_text(public.admin_sales_order_counts(p_query=>'XT10000002',p_field=>'recipient')))=0
 and (public.admin_search_order_items_console(p_query=>'10000002',p_field=>'phone')->>'total')='0'
 and (public.admin_search_order_items_console(p_query=>'XT10000002',p_field=>'product')->>'total')='0',
 'other search fields never match extra trackings');

-- G. 배송현황 표시 읽기: 추가 운송장은 늘 싣고, 자동 배송완료 표시는 스위치가 꺼져 있으면 비운다.
select public.admin_shipment_tracking_summaries(array[pg_temp.xt_id(4,1),pg_temp.xt_id(4,2)]) as summaries \gset
select pg_temp.xt_assert(:'summaries'::jsonb->>'autoDelivery'='false'
 and :'summaries'::jsonb#>>array['shipments',pg_temp.xt_id(4,1)::text,'extraTrackings','0','trackingNumber']='XT10000002'
 and :'summaries'::jsonb#>array['shipments',pg_temp.xt_id(4,2)::text,'extraTrackings']='[]'::jsonb
 and :'summaries'::jsonb#>array['shipments',pg_temp.xt_id(4,1)::text,'deliveredBy']='null'::jsonb
 and :'summaries'::jsonb#>array['shipments',pg_temp.xt_id(4,1)::text,'tracking']='null'::jsonb,'summaries without tracking switch');
reset role;

-- H. 합포장의 다른 구성원 행이 묶음을 먼저 발송해 이 행이 '그대로'(dispatched=false)로 끝나도, 반입 전 검사를 통과한 이번 회신의
-- 추가 운송장은 이 배송 건에 붙는다(반입 함수 안쪽 단계 직접 확인).
select private.attach_reply_extra_trackings(
 jsonb_build_array(jsonb_build_object('line',3,'reference',pg_temp.xt_id(4,2)::text,'carrier','epost','trackingNumber','XT20000001','extraTrackingNumbers',jsonb_build_array('XT20000003'))),
 jsonb_build_array(jsonb_build_object('line',3,'reference',pg_temp.xt_id(4,2)::text,'ok',true,'dispatched',false,'shipmentId',pg_temp.xt_id(4,2)::text))) as sibling \gset
select pg_temp.xt_assert(:'sibling'::jsonb#>>'{0,extraTrackingsAdded}'='1'
 and (select array_agg(tracking_number) from public.order_shipment_extra_trackings where shipment_id=pg_temp.xt_id(4,2))=array['XT20000003'],
 'pack sibling rows attach their extras too');
-- 실패한 행에는 붙이지 않는다.
select pg_temp.xt_assert(private.attach_reply_extra_trackings(
 jsonb_build_array(jsonb_build_object('line',4,'reference',pg_temp.xt_id(4,4)::text,'carrier','epost','trackingNumber','XT40000001','extraTrackingNumbers',jsonb_build_array('XT40000002'))),
 jsonb_build_array(jsonb_build_object('line',4,'reference',pg_temp.xt_id(4,4)::text,'ok',false,'error','shipment_not_exported')))->0->>'extraTrackingsAdded' is null
 and not exists(select 1 from public.order_shipment_extra_trackings where shipment_id=pg_temp.xt_id(4,4)),'failed rows attach nothing');

-- I. 한 회신에서 여러 개를 붙여도 표시 순서는 회신에 나온 순서다(같은 트랜잭션이라도 행마다 시각이 다르다).
set local role authenticated;
select pg_temp.xt_as(2);
select public.admin_import_seowon_tracking_batch('00000000-0000-4000-8000-000000042202',jsonb_build_array(
 jsonb_build_object('line',4,'reference',pg_temp.xt_id(4,4)::text,'carrier','epost','trackingNumber','XT40000001',
  'extraTrackingNumbers',jsonb_build_array('XT40000009','XT40000005','XT40000002','XT40000007')))) as reply_order \gset
select pg_temp.xt_assert(:'reply_order'::jsonb#>>'{0,extraTrackingsAdded}'='4'
 and :'reply_order'::jsonb#>'{0,extraTrackingNumbers}'='["XT40000009","XT40000005","XT40000002","XT40000007"]'::jsonb
 and (select jsonb_agg(value->>'trackingNumber') from jsonb_array_elements(public.admin_shipment_tracking_summaries(array[pg_temp.xt_id(4,4)])
  #>array['shipments',pg_temp.xt_id(4,4)::text,'extraTrackings']))='["XT40000009","XT40000005","XT40000002","XT40000007"]'::jsonb,'display order follows the reply');
reset role;
select pg_temp.xt_assert(private.shipment_extra_tracking_numbers(pg_temp.xt_id(4,4))='["XT40000009","XT40000005","XT40000002","XT40000007"]'::jsonb
 and (select count(distinct created_at) from public.order_shipment_extra_trackings where shipment_id=pg_temp.xt_id(4,4))=4,'extras keep distinct times');

-- J. 선물 주문: 상자를 받는 수령인 화면(선물 상세)에만 추가 운송장을 싣는다. 보내는 분 화면과 주문 본인의 직접 읽기는 지금처럼
-- 운송장을 보지 않고(배송지 비공개 선물), 추가 운송장이 없는 배송 건은 키 자체가 없다(이 변경 전 앱이 읽는 모양 그대로).
-- 주문 2(구매자 5 → 수령인 4, 대표 XT20000001 + 추가 XT20000003)와 주문 3(구매자 4 → 수령인 5, 추가 운송장 없음).
insert into private.gift_intents(id,sender_id,recipient_id,state,sender_label,expires_at,accepted_at,order_id,ordered_source_revision) values
 (pg_temp.xt_id(6,1),pg_temp.xt_id(1,5),pg_temp.xt_id(1,4),'ordered','보내는 분',now()+interval '1 day',now(),pg_temp.xt_id(2,2),'extra-tracking-gift'),
 (pg_temp.xt_id(6,2),pg_temp.xt_id(1,4),pg_temp.xt_id(1,5),'ordered','보내는 분',now()+interval '1 day',now(),pg_temp.xt_id(2,3),'extra-tracking-gift');
insert into private.order_delivery_private_snapshots(order_id,gift_id,recipient_id,address,gift_address_revision,source_revision,shipping_evidence) values
 (pg_temp.xt_id(2,2),pg_temp.xt_id(6,1),pg_temp.xt_id(1,4),'{}',1,'extra-tracking-gift','{}'),
 (pg_temp.xt_id(2,3),pg_temp.xt_id(6,2),pg_temp.xt_id(1,5),'{}',1,'extra-tracking-gift','{}');
select pg_temp.xt_assert(private.gift_detail(pg_temp.xt_id(1,4),pg_temp.xt_id(6,1))#>'{shipments,0}'@>
  '{"trackingNumber":"XT20000001","extraTrackings":[{"carrier":"epost","trackingNumber":"XT20000003"}]}'::jsonb
 and not (private.gift_detail(pg_temp.xt_id(1,5),pg_temp.xt_id(6,1))#>'{shipments,0}' ? 'extraTrackings')
 and private.gift_detail(pg_temp.xt_id(1,5),pg_temp.xt_id(6,1))#>'{shipments,0,trackingNumber}'='null'::jsonb
 and not (private.gift_detail(pg_temp.xt_id(1,5),pg_temp.xt_id(6,2))#>'{shipments,0}' ? 'extraTrackings')
 and private.gift_detail(pg_temp.xt_id(1,5),pg_temp.xt_id(6,2))#>>'{shipments,0,trackingNumber}'='XT30000001','gift recipient alone sees extras');
set local role authenticated;
select pg_temp.xt_as(5);
select pg_temp.xt_assert(not exists(select 1 from public.order_shipment_extra_trackings),'gift sender cannot read extras directly');
select pg_temp.xt_as(4);
select pg_temp.xt_assert((select array_agg(tracking_number order by tracking_number) from public.order_shipment_extra_trackings)
 =array['XT10000002','XT40000002','XT40000005','XT40000007','XT40000009'],'gift recipient reads only own orders directly');
reset role;
rollback;
