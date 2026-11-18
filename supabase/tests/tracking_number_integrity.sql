\set ON_ERROR_STOP on
-- 운송장 중복·형식 판정(원장 SHP-030·SHP-031·SHP-032·SHP-014, migration 20261118161000).
-- 다른 주문이 쓰는 운송장(대표·추가·교환 재출고)은 어느 진입 경로로도 새로 등록하지 않는다. 같은 주문·합포장·같은 받는 분 합배송만
-- 함께 쓴다. 택배사 레지스트리의 번호 형식(한진 숫자 10~12자리, 우체국 숫자 13자리)을 등록 때 본다. 김포·표준 회신의 받는 분이 주문과
-- 다르면 그 주문의 줄만 실패한다. 일괄·회신은 파일 전체가 아니라 그 줄(배송 건)만 실패한다.
-- 합성 계정·주문만 쓰고 끝에서 모두 되돌린다. legacy fixture 없이 돈다.
begin;
do $$ begin
 if to_regclass('private.operator_legacy_fixture_control') is not null then
  raise exception 'Tracking integrity tests must run without the legacy fixture helper';end if;
end $$;

create function pg_temp.ti_id(kind text,n integer) returns uuid language sql immutable as $$select md5('tracking-integrity:'||kind||':'||n)::uuid$$;
create function pg_temp.ti_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Tracking integrity assertion: %',label;end if;
end $$;
create function pg_temp.ti_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;
 exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected error % from %',expected,statement;
end $$;
create function pg_temp.ti_as(n integer) returns void language sql as $$
 select set_config('request.jwt.claim.sub',pg_temp.ti_id('user',n)::text,true);
$$;
create function pg_temp.ti_state(n integer) returns text language sql stable as $$
 select status||':'||coalesce(tracking_number,'-') from public.order_shipments where id=pg_temp.ti_id('shipment',n);
$$;
create function pg_temp.ti_dispatch(n integer,carrier text,tracking text) returns text language sql as $$
 select format('select public.admin_update_shipment_status(%L,%L,%L,%L)',pg_temp.ti_id('shipment',n),'shipping',carrier,tracking);
$$;

-- 0. 레지스트리·판정 함수 계약. 판정·잠금 도우미는 봉인돼 있고, 형식 정규식은 전체 일치·유효한 식만 받는다.
select pg_temp.ti_assert((select tracking_number_pattern='^[0-9]{10,12}$' and tracking_number_rule='숫자 10~12자리' from public.shipping_carriers where code='hanjin')
 and (select tracking_number_pattern='^[0-9]{13}$' and tracking_number_rule='숫자 13자리' from public.shipping_carriers where code='epost'),
 'registry carries carrier tracking formats');
select pg_temp.ti_assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in('tracking_destination_key','tracking_number_lock_key','tracking_number_format_ok','tracking_shipments_related','tracking_number_conflict',
   'assert_tracking_registrable','tracking_batch_shipment','lock_tracking_batch','assert_reply_recipient')
  and(has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')))
 and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in('tracking_destination_key','tracking_number_lock_key','tracking_number_format_ok','tracking_shipments_related','tracking_number_conflict',
   'assert_tracking_registrable','tracking_batch_shipment','lock_tracking_batch','assert_reply_recipient'))=9,
 'judgment helpers are sealed');
-- 모든 진입 경로가 같은 판정을 부른다(발송·정정·추가 운송장·서원 추가 운송장·교환 재출고).
select pg_temp.ti_assert((select bool_and(position('private.assert_tracking_registrable(' in pg_get_functiondef(f::regprocedure))>0) from unnest(array[
  'private.admin_update_shipment_status_before_delivery_methods(uuid,text,text,text)','private.admin_update_shipment_tracking_before_delivery_methods(uuid,text,text)',
  'public.admin_add_shipment_extra_tracking(uuid,text,text,text,uuid)','private.assert_reply_extra_trackings(jsonb)',
  'private.record_order_claim_shipment_reshipment(uuid,uuid,text,text,jsonb,jsonb)']) f),'every writer calls the shared judgment');
select pg_temp.ti_error($q$insert into public.shipping_carriers(code,label,tracking_url_template,tracking_number_pattern,tracking_number_rule)
 values('ti_bad','TEST 잘못된 형식','https://example.test/{trackingNumber}','[0-9]{10}','숫자 10자리')$q$,'23514');
select pg_temp.ti_error($q$insert into public.shipping_carriers(code,label,tracking_url_template,tracking_number_pattern,tracking_number_rule)
 values('ti_bad','TEST 형식만','https://example.test/{trackingNumber}','^[0-9]{10}$',null)$q$,'23514');
select pg_temp.ti_error($q$insert into public.shipping_carriers(code,label,tracking_url_template,tracking_number_pattern,tracking_number_rule)
 values('ti_bad','TEST 깨진 식','https://example.test/{trackingNumber}','^([0-9]$','깨진 식')$q$,'2201B');
-- 형식이 없는 택배사(계약 예정 택배사 등록 예시)는 공통 형식만 본다.
insert into public.shipping_carriers(code,label,tracking_url_template,sort_order) values('ti_courier','TEST 형식 없는 택배','https://example.test/{trackingNumber}',90);

-- 계정: 1 주매니저, 2 물류출고관리, 3~6 구매자.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.ti_id('user',n),'authenticated','authenticated','tracking-integrity-'||n||'@example.test',now(),'{}','{}',now(),now()
from generate_series(1,6) n;
update public.profiles set role=(case when id in(pg_temp.ti_id('user',1),pg_temp.ti_id('user',2)) then 'staff' else 'user' end)::public.user_role,
 nickname='tracking_integrity_'||left(id::text,6),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
where id in(select pg_temp.ti_id('user',n) from generate_series(1,6) n);
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.ti_id('user',1),'primary'),(pg_temp.ti_id('user',2),'logistics');

-- 출고지: 김포(wms_csv·한진)·남양주(서원·우체국)는 시드, 기타 출고지(표준·한진)를 더한다.
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values(pg_temp.ti_id('origin',3),'ti-standard','TEST 기타 출고지','hanjin',0,'TEST 반송지',true);
insert into public.ips(id,title,vertical_key) values('tracking-integrity-ip','TEST 운송장 판정 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('tracking-integrity-good','tracking-integrity-ip','TEST 운송장 판정 상품','문구',1000,'ok',100);

-- 받는 분: A(합성가)·B(합성나)·C(합성다)·D(합성라).
create function pg_temp.ti_address(dest text) returns jsonb language sql immutable as $$
 select jsonb_build_object('recipientName',case dest when 'A' then '합성가' when 'B' then '합성나' when 'C' then '합성다' else '합성라' end,
  'phone',case dest when 'A' then '01011110001' when 'B' then '01022220002' when 'C' then '01033330003' else '01044440004' end,
  'postalCode','04524','address1','합성시 운송장로 1','address2',dest||'동','deliveryNote','')$$;
-- 주문 n: (구매자, 받는 분, 출고지 1=김포 2=남양주 3=기타, 상태, 배송 건 상태·운송장)
create temporary table ti_orders(n integer,buyer integer,dest text,origin integer,order_status public.order_status,shipment_status text,tracking text) on commit drop;
insert into ti_orders values
 (1,3,'A',1,'confirmed','ready',null),(2,4,'B',1,'confirmed','ready',null),(3,3,'A',1,'confirmed','ready',null),
 (4,5,'C',1,'confirmed','ready',null),(5,3,'A',1,'shipping','shipping','500000000005'),(6,4,'B',1,'shipping','shipping','500000000005'),
 (7,6,'D',1,'confirmed','ready',null),(8,4,'B',2,'confirmed','ready',null),(9,5,'C',2,'confirmed','ready',null),
 (10,3,'A',1,'confirmed','ready',null),(11,4,'B',1,'confirmed','ready',null),(12,5,'C',3,'delivered','delivered','120000000012'),
 (13,6,'D',1,'confirmed','ready',null),(14,3,'A',1,'confirmed','ready',null),(15,6,'D',1,'confirmed','ready',null),
 (16,3,'A',1,'confirmed','ready',null),(17,3,'A',1,'confirmed','ready',null),(18,4,'B',1,'confirmed','ready',null);
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at,shipped_at,delivered_at)
select pg_temp.ti_id('order',n),pg_temp.ti_id('user',buyer),order_status,1000,0,pg_temp.ti_address(dest),now()-interval '3 days',
 case when order_status in('shipping','delivered') then now()-interval '2 days' end,case when order_status='delivered' then now()-interval '1 day' end
from ti_orders;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select pg_temp.ti_id('item',n),pg_temp.ti_id('order',n),'tracking-integrity-good',v.id,1,1000,'TEST 운송장 판정 상품','문구','tracking-integrity-ip'
from ti_orders cross join (select id from public.goods_variants where good_id='tracking-integrity-good' and is_default) v;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,exported_at,status,carrier,tracking_number,shipped_at,delivered_at)
select pg_temp.ti_id('shipment',n),pg_temp.ti_id('order',n),
 case origin when 1 then '00000000-0000-4000-8000-000000042201'::uuid when 2 then '00000000-0000-4000-8000-000000042202'::uuid else pg_temp.ti_id('origin',3) end,
 case origin when 1 then '김포' when 2 then '남양주' else 'TEST 기타 출고지' end,0,'{}',now()-interval '2 days',shipment_status,
 case when tracking is not null then 'hanjin' end,tracking,case when shipment_status<>'ready' then now()-interval '2 days' end,
 case when shipment_status='delivered' then now()-interval '1 day' end
from ti_orders;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
select pg_temp.ti_id('order',n),pg_temp.ti_id('shipment',n),pg_temp.ti_id('item',n),1 from ti_orders;
-- 주문 4는 기타 출고지에도 배송 건이 있다(같은 주문의 분할 배송 건 40).
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select pg_temp.ti_id('item',40),pg_temp.ti_id('order',4),'tracking-integrity-good',v.id,1,1000,'TEST 운송장 판정 상품','문구','tracking-integrity-ip'
from public.goods_variants v where v.good_id='tracking-integrity-good' and v.is_default;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,exported_at)
values(pg_temp.ti_id('shipment',40),pg_temp.ti_id('order',4),pg_temp.ti_id('origin',3),'TEST 기타 출고지',0,'{}',now());
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(pg_temp.ti_id('order',4),pg_temp.ti_id('shipment',40),pg_temp.ti_id('item',40),1);
-- 주문 5·6(받는 분이 다른 두 주문)은 이미 같은 운송장으로 나간 합포장 묶음이다.
insert into private.shipment_packs(id,created_by) values(pg_temp.ti_id('pack',1),pg_temp.ti_id('user',1));
insert into private.shipment_pack_members(pack_id,shipment_id,identity_digest)
values(pg_temp.ti_id('pack',1),pg_temp.ti_id('shipment',5),'TEST'),(pg_temp.ti_id('pack',1),pg_temp.ti_id('shipment',6),'TEST');

set local role authenticated;
select pg_temp.ti_as(1);

-- 1. 택배사별 형식. 공통 형식(8~30자 영숫자)을 지나도 택배사 형식에 맞지 않으면 등록하지 않는다. 형식이 없는 택배사는 공통 형식만 본다.
select pg_temp.ti_error(pg_temp.ti_dispatch(7,'hanjin','12345678'),'tracking_number_format_mismatch');
select pg_temp.ti_error(pg_temp.ti_dispatch(7,'hanjin','1234567890123'),'tracking_number_format_mismatch');
select pg_temp.ti_error(pg_temp.ti_dispatch(7,'hanjin','AB12345678'),'tracking_number_format_mismatch');
select pg_temp.ti_error(pg_temp.ti_dispatch(7,'epost','601234567890'),'tracking_number_format_mismatch');
select pg_temp.ti_error(pg_temp.ti_dispatch(7,'hanjin','12-34'),'invalid_tracking_input');
select pg_temp.ti_assert(pg_temp.ti_state(7)='ready:-','format rejections change nothing');
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',13),'shipping','ti_courier','TIABC12345');
select pg_temp.ti_assert(pg_temp.ti_state(13)='shipping:TIABC12345','a carrier without a format keeps the common rule');

-- 2. 수동 발송: 다른 주문(다른 받는 분)의 번호는 거절, 같은 받는 분·같은 출고지 합배송과 같은 주문의 분할 배송 건은 함께 쓴다.
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',1),'shipping','hanjin','100000000001');
select pg_temp.ti_error(pg_temp.ti_dispatch(2,'hanjin','100000000001'),'tracking_number_in_use');
select pg_temp.ti_assert(pg_temp.ti_state(2)='ready:-','another customer keeps waiting');
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',3),'shipping','hanjin','100000000001');
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',4),'shipping','hanjin','100000000004');
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',40),'shipping','hanjin','100000000004');
select pg_temp.ti_assert(pg_temp.ti_state(3)='shipping:100000000001' and pg_temp.ti_state(4)='shipping:100000000004'
 and pg_temp.ti_state(40)='shipping:100000000004','same recipient merged box and same-order split share a number');
-- 합배송 예외는 배송 중인 상자뿐이다. 배송완료된 옛 상자의 번호는 같은 받는 분의 새 주문에도 다시 쓰지 않는다.
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',n),'delivered',null,null) from generate_series(1,3,2) n;
select pg_temp.ti_error(pg_temp.ti_dispatch(10,'hanjin','100000000001'),'tracking_number_in_use');
-- 옛 단일 주문 RPC도 같은 판정을 지난다.
select pg_temp.ti_error(format('select public.admin_update_order_status(%L,%L,%L,%L)',pg_temp.ti_id('order',7),'shipping','hanjin','100000000004'),'tracking_number_in_use');

-- 3. 운송장 정정: 다른 주문의 번호로 바꾸지 않는다. 합포장은 구성원이 함께 새 번호로 바뀐다(묶음 안의 공유는 허용).
select pg_temp.ti_error(format('select public.admin_update_shipment_tracking(%L,%L,%L)',pg_temp.ti_id('shipment',4),'hanjin','100000000001'),'tracking_number_in_use');
select pg_temp.ti_assert(pg_temp.ti_state(4)='shipping:100000000004','rejected correction keeps the old number');
select public.admin_update_shipment_tracking(pg_temp.ti_id('shipment',5),'hanjin','500000000055');
select pg_temp.ti_assert(pg_temp.ti_state(5)='shipping:500000000055' and pg_temp.ti_state(6)='shipping:500000000055','a pack corrects together');
select pg_temp.ti_error(pg_temp.ti_dispatch(7,'hanjin','500000000055'),'tracking_number_in_use');
-- 이미 등록된 번호를 다시 적는 정정·배송완료 처리는 판정하지 않는다(소급 없음).
select public.admin_update_shipment_tracking(pg_temp.ti_id('shipment',4),'hanjin','100000000004');
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',40),'delivered',null,null);

-- 4. 추가 운송장(운영자): 다른 주문의 번호·택배사 형식을 거절하고 같은 주문의 다른 배송 건 번호는 받는다.
select pg_temp.ti_error(format('select public.admin_add_shipment_extra_tracking(%L,%L,%L,%L,%L)',pg_temp.ti_id('shipment',4),'hanjin','100000000001','다른 고객 상자',pg_temp.ti_id('op',1)),'tracking_number_in_use');
select pg_temp.ti_error(format('select public.admin_add_shipment_extra_tracking(%L,%L,%L,%L,%L)',pg_temp.ti_id('shipment',4),'hanjin','AB12345678','형식',pg_temp.ti_id('op',2)),'tracking_number_format_mismatch');
select pg_temp.ti_assert((public.admin_add_shipment_extra_tracking(pg_temp.ti_id('shipment',40),'hanjin','100000000044','분할 배송 둘째 상자',pg_temp.ti_id('op',3)))->>'status'='added','extra tracking added');
select pg_temp.ti_error(pg_temp.ti_dispatch(7,'hanjin','100000000044'),'tracking_number_in_use');

-- 5. 세 칸·표준 양식이 지나는 일괄 등록: 그 줄만 실패한다. 한 파일 안의 관계없는 두 배송 건에 같은 번호가 있으면 둘 다 멈춘다.
select public.admin_import_shipment_tracking_batch(jsonb_build_array(
 jsonb_build_object('line',1,'reference',pg_temp.ti_id('shipment',7),'carrier','hanjin','trackingNumber','100000000001'),
 jsonb_build_object('line',2,'reference',pg_temp.ti_id('shipment',2),'carrier','hanjin','trackingNumber','200000000002'),
 jsonb_build_object('line',3,'reference',pg_temp.ti_id('shipment',14),'carrier','hanjin','trackingNumber','140000000015'),
 jsonb_build_object('line',4,'reference',pg_temp.ti_id('shipment',15),'carrier','hanjin','trackingNumber','1400-0000-0015'),
 jsonb_build_object('line',5,'reference',pg_temp.ti_id('shipment',16),'carrier','hanjin','trackingNumber','160000000016'),
 jsonb_build_object('line',6,'reference',pg_temp.ti_id('shipment',17),'carrier','hanjin','trackingNumber','160000000016'),
 jsonb_build_object('line',7,'reference',pg_temp.ti_id('shipment',18),'carrier','hanjin','trackingNumber','18000000001'))) as generic \gset
select pg_temp.ti_assert((select jsonb_agg(coalesce(value->>'error','ok') order by (value->>'line')::integer) from jsonb_array_elements(:'generic'::jsonb))
 = '["tracking_number_in_use","ok","tracking_number_shared_in_reply","tracking_number_shared_in_reply","ok","ok","ok"]'::jsonb,'generic batch fails only the conflicting rows');
select pg_temp.ti_assert(pg_temp.ti_state(7)='ready:-' and pg_temp.ti_state(2)='shipping:200000000002' and pg_temp.ti_state(14)='ready:-' and pg_temp.ti_state(15)='ready:-'
 and pg_temp.ti_state(16)='shipping:160000000016' and pg_temp.ti_state(17)='shipping:160000000016' and pg_temp.ti_state(18)='shipping:18000000001',
 'only valid rows dispatched; same-recipient rows of one file share a merged box');

-- 6. 김포 21열 회신: 받는 분 이름·전화가 주문과 다르면(뒤바뀐 회신 의심) 그 주문의 줄만 실패한다. 접미사·앞자리 0 유실은 같은 사람이다.
select public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042201',jsonb_build_array(
 jsonb_build_object('line',2,'reference',pg_temp.ti_id('order',10)::text,'trackingNumber','100000000010','recipientName','합성나','recipientPhone','010-2222-0002'),
 jsonb_build_object('line',3,'reference',pg_temp.ti_id('order',14)::text,'trackingNumber','140000000014','recipientName','합성가','recipientPhone','010-9999-0001'),
 jsonb_build_object('line',4,'reference',pg_temp.ti_id('order',7)::text,'trackingNumber','100000000001'),
 jsonb_build_object('line',5,'reference',pg_temp.ti_id('order',15)::text,'trackingNumber','150000000015','recipientName','합성라01','recipientPhone','1044440004'))) as gimpo \gset
select pg_temp.ti_assert((select jsonb_agg(coalesce(value->>'error','ok') order by (value->>'line')::integer) from jsonb_array_elements(:'gimpo'::jsonb))
 = '["tracking_reply_recipient_mismatch","tracking_reply_recipient_mismatch","tracking_number_in_use","ok"]'::jsonb,'gimpo reply fails only mismatched or reused orders');
select pg_temp.ti_assert(pg_temp.ti_state(10)='ready:-' and pg_temp.ti_state(14)='ready:-' and pg_temp.ti_state(7)='ready:-' and pg_temp.ti_state(15)='shipping:150000000015',
 'gimpo reply dispatched only the matching order');
select pg_temp.ti_assert(public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042201',jsonb_build_array(
 jsonb_build_object('line',2,'reference',pg_temp.ti_id('order',10)::text,'trackingNumber','100000000010','recipientName',7)))#>>'{0,error}'='invalid_tracking_row',
 'recipient cells must be text');
-- 같은 파일에서 김포 회신 두 주문이 같은 번호를 받으면 둘 다 멈춘다(받는 분이 다르다).
select public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042201',jsonb_build_array(
 jsonb_build_object('line',2,'reference',pg_temp.ti_id('order',10)::text,'trackingNumber','100000000077'),
 jsonb_build_object('line',3,'reference',pg_temp.ti_id('order',7)::text,'trackingNumber','100000000077'))) as gimpo_shared \gset
select pg_temp.ti_assert((select bool_and(value->>'error'='tracking_number_shared_in_reply') from jsonb_array_elements(:'gimpo_shared'::jsonb))
 and pg_temp.ti_state(10)='ready:-' and pg_temp.ti_state(7)='ready:-','gimpo cross-order number in one file stops both');

-- 7. ICONS 표준 양식(상품주문번호): 수취인·연락처가 주문과 다르면 그 배송 건의 줄만 실패한다.
select public.admin_import_item_tracking_batch(jsonb_build_array(
 jsonb_build_object('line',2,'reference',pg_temp.ti_id('item',11)::text,'carrier','hanjin','trackingNumber','110000000011','recipientName','합성다','recipientPhone','01033330003'),
 jsonb_build_object('line',3,'reference',pg_temp.ti_id('item',10)::text,'carrier','hanjin','trackingNumber','100000000010','recipientName','합성 가','recipientPhone','010-1111-0001'))) as standard \gset
select pg_temp.ti_assert((select jsonb_agg(coalesce(value->>'error','ok') order by (value->>'line')::integer) from jsonb_array_elements(:'standard'::jsonb))
 = '["tracking_reply_recipient_mismatch","ok"]'::jsonb and pg_temp.ti_state(11)='ready:-' and pg_temp.ti_state(10)='shipping:100000000010',
 'standard reply checks the recipient per shipment');

-- 8. 서원 회신(남양주·우체국 13자리): 파일 안 교차 번호는 둘 다 멈추고, 다른 주문 번호·형식 오류는 그 줄만 실패한다.
select public.admin_import_seowon_tracking_batch('00000000-0000-4000-8000-000000042202',jsonb_build_array(
 jsonb_build_object('line',2,'reference',pg_temp.ti_id('shipment',8)::text,'carrier','epost','trackingNumber','6000000000008'),
 jsonb_build_object('line',3,'reference',pg_temp.ti_id('shipment',9)::text,'carrier','epost','trackingNumber','6000000000008'))) as seowon_shared \gset
select pg_temp.ti_assert((select bool_and(value->>'error'='tracking_number_shared_in_reply') from jsonb_array_elements(:'seowon_shared'::jsonb))
 and pg_temp.ti_state(8)='ready:-' and pg_temp.ti_state(9)='ready:-','seowon cross-order number in one file stops both');
select public.admin_import_seowon_tracking_batch('00000000-0000-4000-8000-000000042202',jsonb_build_array(
 jsonb_build_object('line',2,'reference',pg_temp.ti_id('shipment',8)::text,'carrier','epost','trackingNumber','6000000000008'))) as seowon_one \gset
select public.admin_import_seowon_tracking_batch('00000000-0000-4000-8000-000000042202',jsonb_build_array(
 jsonb_build_object('line',3,'reference',pg_temp.ti_id('shipment',9)::text,'carrier','epost','trackingNumber','6000000000008'))) as seowon_reused \gset
select public.admin_import_seowon_tracking_batch('00000000-0000-4000-8000-000000042202',jsonb_build_array(
 jsonb_build_object('line',3,'reference',pg_temp.ti_id('shipment',9)::text,'carrier','epost','trackingNumber','600000000009'))) as seowon_format \gset
select pg_temp.ti_assert(:'seowon_one'::jsonb#>>'{0,ok}'='true' and :'seowon_reused'::jsonb#>>'{0,error}'='tracking_number_in_use'
 and :'seowon_format'::jsonb#>>'{0,error}'='tracking_number_format_mismatch' and pg_temp.ti_state(8)='shipping:6000000000008' and pg_temp.ti_state(9)='ready:-',
 'seowon rows fail one by one');
-- 서원 분리배송 추가 운송장도 다른 주문의 번호를 받지 않는다(반입 전 검사라 호출 전체가 거절된다).
select pg_temp.ti_error(format('select public.admin_import_seowon_tracking_batch(%L,%L::jsonb)','00000000-0000-4000-8000-000000042202',
 jsonb_build_array(jsonb_build_object('line',3,'reference',pg_temp.ti_id('shipment',9)::text,'carrier','epost','trackingNumber','6000000000009','extraTrackingNumbers',jsonb_build_array('6000000000008')))),
 'tracking_number_in_use');
select pg_temp.ti_assert(pg_temp.ti_state(9)='ready:-','rejected seowon extras change nothing');

-- 9. 교환 재출고: 다른 주문의 번호·택배사 형식을 거절하고, 등록된 재출고 번호는 다른 주문의 등록을 막는다.
reset role;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type)
values(pg_temp.ti_id('claim',12),pg_temp.ti_id('order',12),pg_temp.ti_id('user',5),'TEST 단순 변심 교환','exchange','requested','change_of_mind');
select set_config('request.jwt.claim.role','service_role',true);
select pg_temp.ti_as(1);
select public.admin_decide_order_claim(pg_temp.ti_id('claim',12),'approve',null);
select public.admin_record_order_claim_origin_collection(pg_temp.ti_id('claim',12),pg_temp.ti_id('shipment',12),'TEST 기타 출고지 입고 확인');
create function pg_temp.ti_reship(tracking text) returns text language sql as $$
 select format('select private.record_order_claim_shipment_reshipment(%L,%L,%L,%L,%L::jsonb)',pg_temp.ti_id('claim',12),pg_temp.ti_id('shipment',12),'hanjin',tracking,
  jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.ti_id('item',12),'variantId',(select id from public.goods_variants where good_id='tracking-integrity-good' and is_default))));
$$;
select pg_temp.ti_error(pg_temp.ti_reship('100000000001'),'tracking_number_in_use');
select pg_temp.ti_error(pg_temp.ti_reship('AB12345678'),'tracking_number_format_mismatch');
select pg_temp.ti_assert(not exists(select 1 from public.order_claim_reshipments where claim_id=pg_temp.ti_id('claim',12)),'rejected reshipments record nothing');
do $$ begin execute pg_temp.ti_reship('120000000099'); end $$;
select pg_temp.ti_assert(exists(select 1 from public.order_claim_reshipments where claim_id=pg_temp.ti_id('claim',12) and tracking_number='120000000099'),'reshipment recorded');
select pg_temp.ti_error(pg_temp.ti_dispatch(7,'hanjin','120000000099'),'tracking_number_in_use');
select pg_temp.ti_assert(private.tracking_number_conflict('hanjin','120000000099',array[pg_temp.ti_id('shipment',7)],null)->>'source'='reshipment',
 'a reshipment number counts as a use');

-- 10. 같은 번호의 등록은 advisory lock으로 줄 선다(트랜잭션 끝까지 잡힌다). 실제 두 세션 경합은 tracking_number_integrity_concurrency.sh가 본다.
select count(*) as locks_before from pg_locks where locktype='advisory' and pid=pg_backend_pid() \gset
select private.assert_tracking_registrable('hanjin','900000000009',array[pg_temp.ti_id('shipment',7)],null);
select pg_temp.ti_assert((select count(*) from pg_locks where locktype='advisory' and pid=pg_backend_pid())=:'locks_before'::bigint+1
 and exists(select 1 from pg_locks where locktype='advisory' and pid=pg_backend_pid() and granted
  and ((classid::bigint<<32)|objid::bigint)=private.tracking_number_lock_key('hanjin','900000000009')),
 'the registration takes the number lock');

rollback;
