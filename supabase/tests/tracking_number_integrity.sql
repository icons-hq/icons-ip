\set ON_ERROR_STOP on
-- 운송장 중복·형식 판정(원장 SHP-030·SHP-031·SHP-032·SHP-014, migration 20261118161000).
-- 리뷰 보완: 한진 14자리, 재출고·최근 배송완료 상자의 합배송 예외, 취소 주문의 쓰임 제외, 중복 확인 후 등록, 국가번호 82 전화,
-- 파일 안 추가 운송장 교차, 택배사 운송장 형식 편집.
-- 다른 주문이 쓰는 운송장(대표·추가·교환 재출고)은 어느 진입 경로로도 새로 등록하지 않는다. 같은 주문·합포장·같은 받는 분 합배송만
-- 함께 쓴다. 택배사 레지스트리의 번호 형식(한진 숫자 10~14자리, 우체국 숫자 13자리)을 등록 때 본다. 김포·표준 회신의 받는 분이 주문과
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
select pg_temp.ti_assert((select tracking_number_pattern='^[0-9]{10,14}$' and tracking_number_rule='숫자 10~14자리' from public.shipping_carriers where code='hanjin')
 and (select tracking_number_pattern='^[0-9]{13}$' and tracking_number_rule='숫자 13자리' from public.shipping_carriers where code='epost'),
 'registry carries carrier tracking formats');
select pg_temp.ti_assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in('tracking_phone_key','tracking_destination_key','tracking_number_lock_key','tracking_number_format_ok','tracking_shipments_related','tracking_number_conflict',
   'assert_tracking_registrable','tracking_batch_shipment','lock_tracking_batch','assert_reply_recipient')
  and(has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')))
 and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in('tracking_phone_key','tracking_destination_key','tracking_number_lock_key','tracking_number_format_ok','tracking_shipments_related','tracking_number_conflict',
   'assert_tracking_registrable','tracking_batch_shipment','lock_tracking_batch','assert_reply_recipient'))=10
 and (select relrowsecurity from pg_class where oid='private.tracking_duplicate_approvals'::regclass)
 and not has_table_privilege('authenticated','private.tracking_duplicate_approvals','select')
 and (select capability||':'||guard_kind from private.operator_rpc_contracts where signature='public.admin_register_shipment_tracking_duplicate(uuid,text,text,text)')='sales.dispatch:write'
 and (select capability||':'||guard_kind||':'||legacy_admin_only from private.operator_rpc_contracts
   where signature='public.admin_save_shipping_carrier_tracking_format(text,text,text,text,timestamp with time zone)')='platform.manage:write:true'
 and not has_function_privilege('anon','public.admin_register_shipment_tracking_duplicate(uuid,text,text,text)','execute')
 and not has_function_privilege('anon','public.admin_save_shipping_carrier_tracking_format(text,text,text,text,timestamp with time zone)','execute'),
 'judgment helpers, approvals and new RPCs are sealed');
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

-- 받는 분: A(합성가)·B(합성나)·C(합성다)·D(합성라). A2는 A와 전화·주소가 같은 가족(이름만 다르다) — 한 상자의 받는 분이다.
-- E(합성마)는 전화번호가 국가번호 82로 저장된 주문이다.
create function pg_temp.ti_address(dest text) returns jsonb language sql immutable as $$
 select jsonb_build_object('recipientName',case dest when 'A' then '합성가' when 'A2' then '합성가족' when 'B' then '합성나' when 'C' then '합성다' when 'E' then '합성마' else '합성라' end,
  'phone',case left(dest,1) when 'A' then '01011110001' when 'B' then '01022220002' when 'C' then '01033330003' when 'E' then '821055556666' else '01044440004' end,
  'postalCode','04524','address1','합성시 운송장로 1','address2',left(dest,1)||'동','deliveryNote','')$$;
-- 주문 n: (구매자, 받는 분, 출고지 1=김포 2=남양주 3=기타, 상태, 배송 건 상태·운송장)
create temporary table ti_orders(n integer,buyer integer,dest text,origin integer,order_status public.order_status,shipment_status text,tracking text) on commit drop;
insert into ti_orders values
 (1,3,'A',1,'confirmed','ready',null),(2,4,'B',1,'confirmed','ready',null),(3,3,'A',1,'confirmed','ready',null),
 (4,5,'C',1,'confirmed','ready',null),(5,3,'A',1,'shipping','shipping','500000000005'),(6,4,'B',1,'shipping','shipping','500000000005'),
 (7,6,'D',1,'confirmed','ready',null),(8,4,'B',2,'confirmed','ready',null),(9,5,'C',2,'confirmed','ready',null),
 (10,3,'A',1,'confirmed','ready',null),(11,4,'B',1,'confirmed','ready',null),(12,5,'C',3,'delivered','delivered','120000000012'),
 (13,6,'D',1,'confirmed','ready',null),(14,3,'A',1,'confirmed','ready',null),(15,6,'D',1,'confirmed','ready',null),
 (16,3,'A',1,'confirmed','ready',null),(17,3,'A',1,'confirmed','ready',null),(18,4,'B',1,'confirmed','ready',null),
 (19,4,'A2',1,'confirmed','ready',null),
 -- 20: 주문 12 교환 재출고와 같은 상자(같은 받는 분·출고지) · 21: 전화 82 저장 · 22: 배송완료된 합배송 상자의 늦은 줄
 -- 23: 취소된 주문의 운송장 · 24: 그 번호를 다시 쓰는 주문 · 25: 중복 확인 후 등록 · 26: 한진 14자리
 (20,5,'C',3,'confirmed','ready',null),(21,6,'E',1,'confirmed','ready',null),(22,3,'A',1,'confirmed','ready',null),
 (23,6,'D',1,'canceled','shipping','230000000023'),(24,4,'B',1,'confirmed','ready',null),(25,4,'B',1,'confirmed','ready',null),
 (26,6,'D',1,'confirmed','ready',null);
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
select pg_temp.ti_error(pg_temp.ti_dispatch(7,'hanjin','123456789012345'),'tracking_number_format_mismatch');
select pg_temp.ti_error(pg_temp.ti_dispatch(7,'hanjin','AB12345678'),'tracking_number_format_mismatch');
select pg_temp.ti_error(pg_temp.ti_dispatch(7,'epost','601234567890'),'tracking_number_format_mismatch');
select pg_temp.ti_error(pg_temp.ti_dispatch(7,'hanjin','12-34'),'invalid_tracking_input');
select pg_temp.ti_assert(pg_temp.ti_state(7)='ready:-','format rejections change nothing');
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',13),'shipping','ti_courier','TIABC12345');
select pg_temp.ti_assert(pg_temp.ti_state(13)='shipping:TIABC12345','a carrier without a format keeps the common rule');
-- 한진 공식 배송조회가 받는 14자리 운송장(리뷰 1)은 등록된다.
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',26),'shipping','hanjin','12345678901234');
select pg_temp.ti_assert(pg_temp.ti_state(26)='shipping:12345678901234','hanjin 14 digits are accepted');

-- 2. 수동 발송: 다른 주문(다른 받는 분)의 번호는 거절, 같은 받는 분·같은 출고지 합배송과 같은 주문의 분할 배송 건은 함께 쓴다.
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',1),'shipping','hanjin','100000000001');
select pg_temp.ti_error(pg_temp.ti_dispatch(2,'hanjin','100000000001'),'tracking_number_in_use');
select pg_temp.ti_assert(pg_temp.ti_state(2)='ready:-','another customer keeps waiting');
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',3),'shipping','hanjin','100000000001');
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',4),'shipping','hanjin','100000000004');
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',40),'shipping','hanjin','100000000004');
select pg_temp.ti_assert(pg_temp.ti_state(3)='shipping:100000000001' and pg_temp.ti_state(4)='shipping:100000000004'
 and pg_temp.ti_state(40)='shipping:100000000004','same recipient merged box and same-order split share a number');
-- 합배송 예외는 배송 중이거나 최근 7일 안에 배송완료된 상자다(리뷰 2·S3). 같은 상자의 늦은 줄은 받는다.
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',n),'delivered',null,null) from generate_series(1,3,2) n;
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',22),'shipping','hanjin','100000000001');
select pg_temp.ti_assert(pg_temp.ti_state(22)='shipping:100000000001','a late line of a recently delivered merged box registers');
-- 7일이 지난 옛 상자의 번호는 같은 받는 분의 새 주문에도 다시 쓰지 않는다.
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',22),'delivered',null,null);
reset role;
update public.order_shipments set delivered_at=now()-interval '8 days' where id in(pg_temp.ti_id('shipment',1),pg_temp.ti_id('shipment',3),pg_temp.ti_id('shipment',22));
set local role authenticated;
select pg_temp.ti_as(1);
select pg_temp.ti_error(pg_temp.ti_dispatch(10,'hanjin','100000000001'),'tracking_number_in_use');
-- 취소된 주문의 쓰임은 보지 않는다(리뷰 2).
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',24),'shipping','hanjin','230000000023');
select pg_temp.ti_assert(pg_temp.ti_state(24)='shipping:230000000023','a canceled order no longer owns its number');

-- 2-1. 중복 확인 후 등록(리뷰 2): 판정이 거절한 같은 상자를 운영자가 사유와 함께 등록한다. 형식 검사는 그대로이고 승인·감사가 남는다.
select pg_temp.ti_error(format('select public.admin_register_shipment_tracking_duplicate(%L,%L,%L,%L)',pg_temp.ti_id('shipment',25),'hanjin','100000000001','  '),'tracking_duplicate_reason_required');
select pg_temp.ti_error(format('select public.admin_register_shipment_tracking_duplicate(%L,%L,%L,%L)',pg_temp.ti_id('shipment',25),'hanjin','AB12345678','같은 상자 확인'),'tracking_number_format_mismatch');
select pg_temp.ti_error(format('select public.admin_register_shipment_tracking_duplicate(%L,%L,%L,%L)',pg_temp.ti_id('shipment',25),'hanjin','250000000025','같은 상자 확인'),'tracking_duplicate_not_needed');
select pg_temp.ti_error(pg_temp.ti_dispatch(25,'hanjin','100000000001'),'tracking_number_in_use');
select public.admin_register_shipment_tracking_duplicate(pg_temp.ti_id('shipment',25),'hanjin','1000-0000-0001','창고 확인: 주문 1과 같은 상자') as duplicate \gset
select pg_temp.ti_assert(:'duplicate'::jsonb->>'status'='dispatched' and pg_temp.ti_state(25)='shipping:100000000001','duplicate registration dispatches after confirmation');
select pg_temp.ti_error(pg_temp.ti_dispatch(18,'hanjin','100000000001'),'tracking_number_in_use');
reset role;
select pg_temp.ti_assert((select count(*) from private.tracking_duplicate_approvals where shipment_id=pg_temp.ti_id('shipment',25) and tracking_number='100000000001'
   and reason='창고 확인: 주문 1과 같은 상자' and actor_id=pg_temp.ti_id('user',1))=1
 and (select count(*) from public.audit_log where action='admin.shipment.tracking_duplicate_registered' and diff->>'shipmentId'=pg_temp.ti_id('shipment',25)::text
   and diff->>'outcome'='dispatched' and diff->>'otherSource' is not null)=1,'the approval and audit record the reason');
set local role authenticated;
select pg_temp.ti_as(1);
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

-- 전화·주소가 같은 받는 분(이름만 다른 가족)의 같은 출고지 배송 건은 배송 중인 상자의 번호를 함께 쓴다(서원 합배송 기준과 같다).
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',19),'shipping','hanjin','160000000016');
select pg_temp.ti_assert(pg_temp.ti_state(19)='shipping:160000000016','same phone and address share a merged box');

-- 5-1. 뒤바뀐 운송장 맞바꾸기: 정정으로는 서로의 번호로 바꿀 수 없으므로 두 배송 건을 한 번에 맞바꾼다. 화면이 본 번호와 지금 값이 같아야
--      하므로 같은 요청을 다시 보내도 되돌아가지 않는다. 같은 합포장 안·발송 전 배송 건은 맞바꾸지 않는다.
select pg_temp.ti_error(format('select public.admin_update_shipment_tracking(%L,%L,%L)',pg_temp.ti_id('shipment',2),'ti_courier','TIABC12345'),'tracking_number_in_use');
select shipment_number as s13_number from public.order_shipments where id=pg_temp.ti_id('shipment',13) \gset
create function pg_temp.ti_swap(expected text,other text,expected_other text,reason text) returns text language sql as $$
 select format('select public.admin_swap_shipment_trackings(%L,%L,%L,%L,%L)',pg_temp.ti_id('shipment',2),expected,other,expected_other,reason);
$$;
select pg_temp.ti_error(pg_temp.ti_swap('200000000002',:'s13_number','TIABC12345','  '),'tracking_swap_reason_required');
select pg_temp.ti_error(pg_temp.ti_swap('200000000002',:'s13_number','TIABC99999','창고 회신 뒤바뀜'),'shipment_tracking_changed');
select pg_temp.ti_error(pg_temp.ti_swap('200000000002',pg_temp.ti_id('shipment',7)::text,'-','창고 회신 뒤바뀜'),'order_not_shipped');
select public.admin_swap_shipment_trackings(pg_temp.ti_id('shipment',2),'2000-0000-0002',:'s13_number','tiabc12345','창고 회신 뒤바뀜') as swapped \gset
select pg_temp.ti_assert(:'swapped'::jsonb->>'status'='swapped'
 and pg_temp.ti_state(2)='shipping:TIABC12345' and pg_temp.ti_state(13)='shipping:200000000002'
 and (select carrier from public.order_shipments where id=pg_temp.ti_id('shipment',2))='ti_courier','swap exchanges both carriers and numbers');
select pg_temp.ti_error(pg_temp.ti_swap('200000000002',:'s13_number','TIABC12345','같은 요청 재전송'),'shipment_tracking_changed');
select pg_temp.ti_assert(pg_temp.ti_state(2)='shipping:TIABC12345' and pg_temp.ti_state(13)='shipping:200000000002','a replay never swaps back');
-- 맞바꾼 번호를 다른 주문이 함께 쓰고 있으면(같은 받는 분 합배송 상자의 다른 배송 건) 맞바꾸지 않는다.
select pg_temp.ti_error(format('select public.admin_swap_shipment_trackings(%L,%L,%L,%L,%L)',pg_temp.ti_id('shipment',13),'200000000002',pg_temp.ti_id('shipment',16)::text,'160000000016','합배송 상자'),'tracking_number_in_use');
select pg_temp.ti_error(format('select public.admin_swap_shipment_trackings(%L,%L,%L,%L,%L)',pg_temp.ti_id('shipment',5),'500000000055',pg_temp.ti_id('shipment',6)::text,'500000000055','묶음 안'),'tracking_swap_same_pack');
reset role;
select pg_temp.ti_assert((select count(*) from public.audit_log where action='admin.shipment.tracking_updated' and diff->>'reason'='창고 회신 뒤바뀜'
  and diff->>'swappedWithShipmentId' in (pg_temp.ti_id('shipment',2)::text,pg_temp.ti_id('shipment',13)::text))=2
 and (select capability||':'||guard_kind from private.operator_rpc_contracts where signature='public.admin_swap_shipment_trackings(uuid,text,text,text,text)')='sales.dispatch:write'
 and not has_function_privilege('anon','public.admin_swap_shipment_trackings(uuid,text,text,text,text)','execute'),'swap is audited and guarded');
set local role authenticated;
select pg_temp.ti_as(1);

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

-- 국가번호 82로 저장된 주문 전화(리뷰 3): 내려받은 값 그대로 돌아온 회신도, 국내 표기로 돌아온 회신도 같은 번호다.
select public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042201',jsonb_build_array(
 jsonb_build_object('line',2,'reference',pg_temp.ti_id('order',21)::text,'trackingNumber','210000000021','recipientName','합성마','recipientPhone','821055556666'),
 jsonb_build_object('line',3,'reference',pg_temp.ti_id('order',21)::text,'trackingNumber','210000000021','recipientName','합성마','recipientPhone','010-5555-6666'))) as gimpo82 \gset
select pg_temp.ti_assert((select bool_and(value->>'ok'='true') from jsonb_array_elements(:'gimpo82'::jsonb)) and pg_temp.ti_state(21)='shipping:210000000021',
 'stored 82 phone matches the same reply phone');
reset role;
select pg_temp.ti_assert(private.tracking_phone_key('821055556666')=private.tracking_phone_key('010-5555-6666') and private.tracking_phone_key('1055556666')='1055556666'
 and private.tracking_phone_key(' ') is null,'phone key normalizes country code and leading zero');
set local role authenticated;
select pg_temp.ti_as(1);

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
-- 한 줄의 추가 운송장이 다른 줄(다른 받는 분)의 대표 운송장과 같아도 파일 안 교차다(리뷰 4·S5). 두 줄 모두 멈추고 아무것도 붙지 않는다.
select public.admin_import_seowon_tracking_batch('00000000-0000-4000-8000-000000042202',jsonb_build_array(
 jsonb_build_object('line',2,'reference',pg_temp.ti_id('shipment',8)::text,'carrier','epost','trackingNumber','6000000000081','extraTrackingNumbers',jsonb_build_array('6000000000092')),
 jsonb_build_object('line',3,'reference',pg_temp.ti_id('shipment',9)::text,'carrier','epost','trackingNumber','6000000000092'))) as seowon_extra_shared \gset
select pg_temp.ti_assert((select bool_and(value->>'error'='tracking_number_shared_in_reply') from jsonb_array_elements(:'seowon_extra_shared'::jsonb))
 and pg_temp.ti_state(8)='ready:-' and pg_temp.ti_state(9)='ready:-'
 and not exists(select 1 from public.order_shipment_extra_trackings where tracking_number='6000000000092'),'an extra crossing another row stops both rows');
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

-- 교환 재출고 상자에 같은 받는 분·같은 출고지의 새 주문을 함께 넣었으면 같은 번호를 받는다(리뷰 2·S2 — 재출고가 먼저 기록돼도).
set local role authenticated;
select pg_temp.ti_as(1);
select public.admin_update_shipment_status(pg_temp.ti_id('shipment',20),'shipping','hanjin','120000000099');
select pg_temp.ti_assert(pg_temp.ti_state(20)='shipping:120000000099','a same-recipient order shares the reshipment box');
reset role;

-- 10. 같은 번호의 등록은 advisory lock으로 줄 선다(트랜잭션 끝까지 잡힌다). 실제 두 세션 경합은 tracking_number_integrity_concurrency.sh가 본다.
select count(*) as locks_before from pg_locks where locktype='advisory' and pid=pg_backend_pid() \gset
select private.assert_tracking_registrable('hanjin','900000000009',array[pg_temp.ti_id('shipment',7)],null);
select pg_temp.ti_assert((select count(*) from pg_locks where locktype='advisory' and pid=pg_backend_pid())=:'locks_before'::bigint+1
 and exists(select 1 from pg_locks where locktype='advisory' and pid=pg_backend_pid() and granted
  and ((classid::bigint<<32)|objid::bigint)=private.tracking_number_lock_key('hanjin','900000000009')),
 'the registration takes the number lock');

-- 11. 택배사 운송장 형식 편집(리뷰 1): 최고 관리자만, 확인용 번호가 새 형식에 맞아야 저장하고, 감사 기록을 남긴다. 저장한 형식은 바로 등록 판정에 쓰인다.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values(pg_temp.ti_id('user',7),'authenticated','authenticated','tracking-integrity-7@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='tracking_integrity_admin',birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id=pg_temp.ti_id('user',7);
insert into private.operator_memberships(profile_id,manager_role) select pg_temp.ti_id('user',7),'owner'
 where not exists(select 1 from private.operator_memberships where manager_role='owner');
insert into private.operator_memberships(profile_id,manager_role) select pg_temp.ti_id('user',7),'primary'
 where not exists(select 1 from private.operator_memberships where profile_id=pg_temp.ti_id('user',7));
select updated_at as hanjin_stamp from public.shipping_carriers where code='hanjin' \gset
create function pg_temp.ti_format(pattern text,rule text,sample text,stamp text) returns text language sql as $$
 select format('select public.admin_save_shipping_carrier_tracking_format(%L,%L,%L,%L,%L)','hanjin',pattern,rule,sample,stamp);
$$;
set local role authenticated;
select pg_temp.ti_as(2);
select pg_temp.ti_error(pg_temp.ti_format('^[0-9]{12}$','숫자 12자리','123456789012',:'hanjin_stamp'),'42501');
select pg_temp.ti_as(7);
select pg_temp.ti_error(pg_temp.ti_format('[0-9]{12}','숫자 12자리','123456789012',:'hanjin_stamp'),'invalid_tracking_number_format');
select pg_temp.ti_error(pg_temp.ti_format('^([0-9]$','깨진 식','123456789012',:'hanjin_stamp'),'invalid_tracking_number_format');
select pg_temp.ti_error(pg_temp.ti_format('^[0-9]{12}$','','123456789012',:'hanjin_stamp'),'invalid_tracking_number_format');
select pg_temp.ti_error(pg_temp.ti_format('^[0-9]{12}$','숫자 12자리','1234567890',:'hanjin_stamp'),'tracking_number_format_sample_mismatch');
select pg_temp.ti_error(pg_temp.ti_format('^[0-9]{12}$','숫자 12자리','123456789012','2000-01-01 00:00:00+00'),'store_settings_conflict');
select public.admin_save_shipping_carrier_tracking_format('hanjin','^([0-9]{12}|[0-9]{14})$','숫자 12·14자리','1234-5678-9012-34',:'hanjin_stamp') as hanjin_stamp2 \gset
select pg_temp.ti_as(1);
select pg_temp.ti_error(pg_temp.ti_dispatch(7,'hanjin','1234567890'),'tracking_number_format_mismatch');
select pg_temp.ti_as(7);
-- 형식과 안내를 함께 비우면 공통 형식만 본다.
select public.admin_save_shipping_carrier_tracking_format('hanjin','','','',:'hanjin_stamp2') as hanjin_stamp3 \gset
reset role;
select pg_temp.ti_assert((select tracking_number_pattern is null and tracking_number_rule is null from public.shipping_carriers where code='hanjin')
 and (select count(*) from public.audit_log where action='admin.shipping_carrier.saved' and target='shipping_carriers:hanjin' and actor_id=pg_temp.ti_id('user',7))=2
 and (select diff#>>'{after,tracking_number_pattern}' from public.audit_log where action='admin.shipping_carrier.saved' and target='shipping_carriers:hanjin'
   and diff#>>'{before,tracking_number_pattern}'='^[0-9]{10,14}$')='^([0-9]{12}|[0-9]{14})$','format edits are audited and clear together');

rollback;
