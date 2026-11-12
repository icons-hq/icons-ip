\set ON_ERROR_STOP on
-- T19(1027T-005·1027T-009·S36-038): 상품공지사항 '상세 하단' 위치, 배송 안내 템플릿
-- 도서산간 안내, 상품 상세 지역별 추가 배송비 요약. Prepend helpers/goods_kc_fixture.sql.
-- 우편번호·금액·주소·근거는 모두 합성값이며 모든 변경은 롤백한다.
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.t19_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'T19 assertion failed: %', label; end if; end $$;
create function pg_temp.t19_expect_error(statement text, wanted text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then if sqlerrm=wanted or sqlstate=wanted then return; end if; raise;
  end;
  raise exception 'Expected rejection: %', wanted;
end $$;
create function pg_temp.t19_items(good text, qty integer default 1) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('goodId',good_id,'variantId',id,'qty',qty))
  from public.goods_variants where good_id=good and is_default;
$$;
create function pg_temp.t19_destination(postal text, address text) returns jsonb language sql as $$
  select jsonb_build_object('postalCode',postal,'address1',address);
$$;

-- 운영자: 주매니저(설정 완료 DB). KC 합성 검토자도 명시 권한을 받는다.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('97190000-0000-4000-8000-000000000001','authenticated','authenticated','t19-primary@example.test',now(),'{}','{}');
update public.profiles set role='staff' where id='97190000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values ('97190000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;

insert into public.ips(id,title,vertical_key,published_at) values('t19-ip','T19 합성 IP','character',now());
insert into public.shipping_carriers(code,label,tracking_url_template,is_active)
 values('t19_other','TEST-ONLY 다른 택배사','https://example.test/{trackingNumber}',true);
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active) values
 ('97190000-0000-4000-8000-000000000101','t19-managed','합성 지역 출고지','hanjin',3000,30000,'배송 금지 합성 주소 A',true),
 ('97190000-0000-4000-8000-000000000102','t19-legacy','합성 미도입 출고지','hanjin',3000,null,'배송 금지 합성 주소 B',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('t19-policy','t19-ip','정책 굿즈','문구',10000,'ok',100,'97190000-0000-4000-8000-000000000101','policy',0),
 ('t19-free','t19-ip','무료 굿즈','문구',7000,'ok',100,'97190000-0000-4000-8000-000000000101','free',0),
 ('t19-individual','t19-ip','개별 굿즈','문구',5000,'ok',100,'97190000-0000-4000-8000-000000000101','individual',1200),
 ('t19-legacy','t19-ip','미도입 굿즈','문구',10000,'ok',100,'97190000-0000-4000-8000-000000000102','policy',0),
 ('t19-hidden','t19-ip','비공개 굿즈','문구',10000,'ok',100,'97190000-0000-4000-8000-000000000101','policy',0);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}'
 from public.goods where id in ('t19-policy','t19-free','t19-individual','t19-legacy');
update public.profiles set role='staff'
 where id in (select ('47c47700'||left(md5(id),24))::uuid from public.goods where id in ('t19-policy','t19-free','t19-individual','t19-legacy'));
insert into private.operator_memberships(profile_id,manager_role)
 select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id in ('t19-policy','t19-free','t19-individual','t19-legacy');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in ('t19-policy','t19-free','t19-individual','t19-legacy');

-- ---------------------------------------------------------------------------
-- A. 상품공지사항 노출 위치
-- ---------------------------------------------------------------------------
select jsonb_build_object('title','교환·반품·배송 안내','body','<p>공통 안내</p>','format','html','category','product','device','all',
 'enabled',true,'important',false,'allGoods',true,'goodIds','[]'::jsonb,'startsAt',null,'endsAt',null,
 'importantStartsAt',null,'importantEndsAt',null,'popupStartsAt',null,'popupEndsAt',null) as t19_notice \gset
select set_config('request.jwt.claim.sub','97190000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_save_goods_announcement_v2('97190000-0000-4000-8000-000000000201','97190000-0000-4000-8000-000000000301',0,
 :'t19_notice'::jsonb||'{"placement":"bottom"}','preserve',null) as bottom_saved \gset
select public.admin_save_goods_announcement_v2('97190000-0000-4000-8000-000000000202','97190000-0000-4000-8000-000000000302',0,
 :'t19_notice'::jsonb||'{"title":"상단 공지"}','preserve',null);
select pg_temp.t19_assert(public.admin_get_goods_announcement_editor_context('97190000-0000-4000-8000-000000000301')#>>'{announcement,placement}'='bottom'
 and public.admin_get_goods_announcement_editor_context('97190000-0000-4000-8000-000000000302')#>>'{announcement,placement}'='top',
 'editor reads the saved placement and a missing key creates a top notice');
select pg_temp.t19_assert((select count(*)=2 and bool_and(row->>'placement'=case row->>'id' when '97190000-0000-4000-8000-000000000301' then 'bottom' else 'top' end)
 from jsonb_array_elements(public.admin_list_goods_announcements()->'rows') row
 where row->>'id' in ('97190000-0000-4000-8000-000000000301','97190000-0000-4000-8000-000000000302')), 'list rows carry placement');
-- 같은 요청 다시 저장은 첫 결과를 돌려준다.
select pg_temp.t19_assert(public.admin_save_goods_announcement_v2('97190000-0000-4000-8000-000000000201','97190000-0000-4000-8000-000000000301',0,
 :'t19_notice'::jsonb||'{"placement":"bottom"}','preserve',null)=:'bottom_saved'::jsonb, 'replayed operation returns the first result');
-- 위치 키가 없는 수정(배포 사이 이전 화면·보관된 요청)은 저장된 위치를 지킨다.
select public.admin_save_goods_announcement_v2('97190000-0000-4000-8000-000000000203','97190000-0000-4000-8000-000000000301',1,
 :'t19_notice'::jsonb||'{"title":"하단 공지 수정"}','preserve',null);
select pg_temp.t19_assert(public.admin_get_goods_announcement_editor_context('97190000-0000-4000-8000-000000000301')#>>'{announcement,placement}'='bottom'
 and public.admin_get_goods_announcement_editor_context('97190000-0000-4000-8000-000000000301')#>>'{announcement,title}'='하단 공지 수정',
 'update without placement keeps bottom');
select public.admin_save_goods_announcement_v2('97190000-0000-4000-8000-000000000204','97190000-0000-4000-8000-000000000301',2,
 :'t19_notice'::jsonb||'{"placement":"top"}','preserve',null);
select pg_temp.t19_assert(public.admin_get_goods_announcement_editor_context('97190000-0000-4000-8000-000000000301')#>>'{announcement,placement}'='top', 'explicit move to top');
select public.admin_save_goods_announcement_v2('97190000-0000-4000-8000-000000000205','97190000-0000-4000-8000-000000000301',3,
 :'t19_notice'::jsonb||'{"placement":"bottom"}','preserve',null);
select pg_temp.t19_expect_error(format('select public.admin_save_goods_announcement_v2(%L,%L,0,%L::jsonb,%L,null)',
 '97190000-0000-4000-8000-000000000206','97190000-0000-4000-8000-000000000303',:'t19_notice'::jsonb||'{"placement":"middle"}','preserve'),'invalid_goods_announcement');
select pg_temp.t19_expect_error(format('select public.admin_save_goods_announcement_v2(%L,%L,0,%L::jsonb,%L,null)',
 '97190000-0000-4000-8000-000000000207','97190000-0000-4000-8000-000000000303',:'t19_notice'::jsonb||'{"placement":true}','preserve'),'invalid_goods_announcement');
-- 구 3인자 저장은 위치를 받지 않고 고치지도 않는다.
select pg_temp.t19_expect_error(format('select public.admin_save_goods_announcement(%L,4,%L::jsonb)','97190000-0000-4000-8000-000000000301',
 (:'t19_notice'::jsonb-array['importantStartsAt','importantEndsAt','popupStartsAt','popupEndsAt'])||'{"placement":"top"}'),'invalid_goods_announcement');
select public.admin_save_goods_announcement('97190000-0000-4000-8000-000000000301',4,
 (:'t19_notice'::jsonb-array['importantStartsAt','importantEndsAt','popupStartsAt','popupEndsAt'])||'{"title":"구 저장 수정"}');
select pg_temp.t19_assert(public.admin_get_goods_announcement_editor_context('97190000-0000-4000-8000-000000000301')#>>'{announcement,placement}'='bottom', 'legacy save keeps placement');
reset role;
select pg_temp.t19_assert(exists(select 1 from public.audit_log where id='97190000-0000-4000-8000-000000000205'
 and diff#>>'{before,placement}'='top' and diff#>>'{after,placement}'='bottom'), 'audit records the placement change');
select pg_temp.t19_assert(not exists(select 1 from public.goods_announcements where placement not in ('top','bottom')), 'placement domain');
set local role anon;
select public.get_good_announcements('t19-policy') as public_notices \gset
select pg_temp.t19_assert((select count(*)=2
  and bool_and(item->>'placement'=case item->>'id' when '97190000-0000-4000-8000-000000000301' then 'bottom' else 'top' end)
  and bool_and(not (item ? 'revision') and not (item ? 'created_by'))
 from jsonb_array_elements(:'public_notices'::jsonb->'items') item
 where item->>'id' in ('97190000-0000-4000-8000-000000000301','97190000-0000-4000-8000-000000000302')), 'public items carry placement only');
reset role;

-- ---------------------------------------------------------------------------
-- B. 배송 안내 템플릿 도서산간 안내
-- ---------------------------------------------------------------------------
select pg_temp.t19_assert(has_function_privilege('authenticated','public.admin_save_shipping_notice_template_v2(uuid,text,integer,text,text,text,text,text,text,text,timestamptz)','execute')
 and not has_function_privilege('anon','public.admin_save_shipping_notice_template_v2(uuid,text,integer,text,text,text,text,text,text,text,timestamptz)','execute')
 and not has_function_privilege('service_role','public.admin_save_shipping_notice_template_v2(uuid,text,integer,text,text,text,text,text,text,text,timestamptz)','execute'),
 'template v2 is an authenticated operator RPC');
select pg_temp.t19_assert(exists(select 1 from private.operator_rpc_contracts where signature='public.admin_save_shipping_notice_template_v2(uuid,text,integer,text,text,text,text,text,text,text,timestamp with time zone)'
 and capability='catalog.manage' and guard_kind='write'), 'template v2 contract registered');
select set_config('request.jwt.claim.sub','97190000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_save_shipping_notice_template_v2(null,'t19-remote',1,'도서산간 검증','배송 안내 합성','교환 안내 합성',
 E'  제주·도서산간은 추가 배송비가 있습니다.\n일부 도서 지역은 배송이 제한될 수 있습니다.  ','합성 고객센터','02-0000-0000','',null) as template_saved \gset
select pg_temp.t19_assert((select remote_area_notice=E'제주·도서산간은 추가 배송비가 있습니다.\n일부 도서 지역은 배송이 제한될 수 있습니다.'
 from public.shipping_notice_templates where id=(:'template_saved'::jsonb->>'id')::uuid), 'v2 stores the trimmed remote area notice');
-- 구 10인자 저장은 도서산간 안내를 읽지도 지우지도 않는다.
select public.admin_save_shipping_notice_template((:'template_saved'::jsonb->>'id')::uuid,'t19-remote',1,'도서산간 검증 수정','배송 안내 합성','교환 안내 합성',
 '합성 고객센터','02-0000-0000','',(:'template_saved'::jsonb->>'updatedAt')::timestamptz) as template_legacy \gset
select pg_temp.t19_assert((select name='도서산간 검증 수정' and remote_area_notice like '제주·도서산간은%'
 from public.shipping_notice_templates where id=(:'template_saved'::jsonb->>'id')::uuid), 'legacy save keeps the remote area notice');
select pg_temp.t19_expect_error(format('select public.admin_save_shipping_notice_template_v2(null,%L,1,%L,%L,%L,%L,%L,%L,%L,null)',
 't19-remote-bad','제어 문자','배송','교환',E'도서\u0001산간','센터','02',''),'invalid_shipping_notice_template');
select pg_temp.t19_expect_error(format('select public.admin_save_shipping_notice_template_v2(null,%L,1,%L,%L,%L,%L,%L,%L,%L,null)',
 't19-remote-long','너무 김','배송','교환',repeat('가',4001),'센터','02',''),'invalid_shipping_notice_template');
select public.admin_activate_shipping_notice_template((:'template_saved'::jsonb->>'id')::uuid,(:'template_legacy'::jsonb->>'updatedAt')::timestamptz,'TEST-ONLY 합성 근거') as template_active \gset
select pg_temp.t19_expect_error(format('select public.admin_save_shipping_notice_template_v2(%L,%L,1,%L,%L,%L,%L,%L,%L,%L,%L)',
 :'template_saved'::jsonb->>'id','t19-remote','활성 수정','배송','교환','도서','센터','02','',:'template_active'::jsonb->>'updatedAt'),'shipping_notice_template_active_immutable');
select updated_at as policy_good_stamp from public.goods where id='t19-policy' \gset
select public.admin_apply_shipping_notice_template('t19-policy',(:'template_saved'::jsonb->>'id')::uuid,:'policy_good_stamp'::timestamptz);
reset role;
select pg_temp.t19_expect_error(format('update public.shipping_notice_templates set remote_area_notice=%L where id=%L','바꿈',:'template_saved'::jsonb->>'id'),
 'shipping_notice_template_active_immutable');
select pg_temp.t19_assert((select shipping_notice_snapshot->>'remoteAreaNotice' like '제주·도서산간은%' from public.goods where id='t19-policy'),
 'applied snapshot carries the remote area notice');
set local role anon;
select pg_temp.t19_assert(public.get_good_shipping_policy('t19-policy')->>'remoteAreaNotice'=E'제주·도서산간은 추가 배송비가 있습니다.\n일부 도서 지역은 배송이 제한될 수 있습니다.'
 and public.get_good_shipping_policy('t19-free')->>'remoteAreaNotice'=''
 and not (public.get_good_shipping_policy('t19-policy') ? 'confirmationEvidence'), 'public policy exposes only the snapshot notice');
reset role;

-- ---------------------------------------------------------------------------
-- C. 상품 상세 지역별 추가 배송비 요약
-- ---------------------------------------------------------------------------
select pg_temp.t19_assert(has_function_privilege('anon','public.get_good_shipping_region_fees(text)','execute')
 and has_function_privilege('authenticated','public.get_good_shipping_region_fees(text)','execute')
 and not has_function_privilege('service_role','public.get_good_shipping_region_fees(text)','execute')
 and not has_function_privilege('anon','private.good_shipping_region_probe_fee(public.goods,public.goods,jsonb,bigint,boolean,timestamptz)','execute')
 and not has_function_privilege('authenticated','private.good_shipping_region_probe_fee(public.goods,public.goods,jsonb,bigint,boolean,timestamptz)','execute'),
 'public summary RPC and private probe grants');
set local role anon;
select pg_temp.t19_assert((public.get_good_shipping_region_fees('t19-policy')->>'state')='none'
 and jsonb_array_length(public.get_good_shipping_region_fees('t19-policy')->'regions')=0, 'origin without adoption lists no regional fee');
reset role;

select private.normalize_shipping_region_policy(jsonb_build_object(
 'originId','97190000-0000-4000-8000-000000000101','carrierCode','hanjin','name','TEST-ONLY T19 지역 정책',
 'startsAt',now()-interval '1 day','endsAt',now()+interval '3 days','openEnded',false,'sourceEvidence','TEST-ONLY:not-a-real-carrier-reply',
 'unlistedDisposition','standard','feeUnit','per_shipment','chargePolicyGoods',true,'waivePolicyThreshold',true,
 'chargeFreeGoods',false,'chargeIndividualGoods',true,'noRulesConfirmed',false,
 'rules',jsonb_build_array(
  jsonb_build_object('id',null,'postalFrom','63000','postalTo','63644','addressPrefix','','regionLabel','제주','disposition','surcharge','amount',3000),
  jsonb_build_object('id',null,'postalFrom','23100','postalTo','23136','addressPrefix','','regionLabel','도서산간','disposition','surcharge','amount',5000),
  jsonb_build_object('id',null,'postalFrom','40200','postalTo','40240','addressPrefix','','regionLabel','도서산간','disposition','surcharge','amount',7000),
  jsonb_build_object('id',null,'postalFrom','54000','postalTo','54010','addressPrefix','합성시 검증구','regionLabel','합성 주소 조건','disposition','surcharge','amount',2500),
  jsonb_build_object('id',null,'postalFrom','54000','postalTo','54010','addressPrefix','합성시 다른구','regionLabel','합성 다른 주소','disposition','unavailable','amount',null),
  jsonb_build_object('id',null,'postalFrom','10000','postalTo','10010','addressPrefix','','regionLabel','합성 0원 구간','disposition','surcharge','amount',0),
  jsonb_build_object('id',null,'postalFrom','10021','postalTo','10030','addressPrefix','','regionLabel','합성 배송 불가','disposition','unavailable','amount',null),
  jsonb_build_object('id',null,'postalFrom','10031','postalTo','10040','addressPrefix','','regionLabel','합성 개별 확인','disposition','manual_review','amount',null)))) as region_config \gset
select private.assert_shipping_region_policy_complete(:'region_config'::jsonb);
insert into private.shipping_region_policies(origin_id,carrier_code,version,status,configuration,starts_at,ends_at,confirmed_by,confirmed_at,updated_by)
 values('97190000-0000-4000-8000-000000000101','hanjin',1,'active',:'region_config'::jsonb,(:'region_config'::jsonb->>'startsAt')::timestamptz,
  (:'region_config'::jsonb->>'endsAt')::timestamptz,'97190000-0000-4000-8000-000000000001',now(),'97190000-0000-4000-8000-000000000001')
 returning id as region_policy_id \gset
insert into private.shipping_region_adoptions(origin_id,managed_from) values('97190000-0000-4000-8000-000000000101',now()-interval '1 day');

set local role anon;
select public.get_good_shipping_region_fees('t19-policy') as fees_policy \gset
select public.get_good_shipping_region_fees('t19-individual') as fees_individual \gset
select public.get_good_shipping_region_fees('t19-free') as fees_free \gset
select public.get_good_shipping_region_fees('t19-legacy') as fees_legacy \gset
select pg_temp.t19_assert(:'fees_policy'::jsonb->>'state'='listed'
 and :'fees_policy'::jsonb->'regions'=jsonb_build_array(
  jsonb_build_object('label','합성 주소 조건','minFee',2500,'maxFee',2500),
  jsonb_build_object('label','제주','minFee',3000,'maxFee',3000),
  jsonb_build_object('label','도서산간','minFee',5000,'maxFee',7000))
 and :'fees_policy'::jsonb->>'feeUnit'='per_shipment'
 and :'fees_policy'::jsonb->>'waivedAtFreeThreshold'='true'
 and :'fees_policy'::jsonb->>'truncated'='false'
 and (:'fees_policy'::jsonb->>'nextChangeAt')::timestamptz=(:'region_config'::jsonb->>'endsAt')::timestamptz,
 'policy good lists surcharge regions only, cheapest first, with unit, waiver and the next policy boundary');
select pg_temp.t19_assert((select array_agg(key order by key) from jsonb_object_keys(:'fees_policy'::jsonb) key)
  =array['feeUnit','nextChangeAt','regions','state','truncated','waivedAtFreeThreshold']
 and (select bool_and((select array_agg(key order by key) from jsonb_object_keys(region) key)=array['label','maxFee','minFee'])
  from jsonb_array_elements(:'fees_policy'::jsonb->'regions') region), 'minimal public projection');
select pg_temp.t19_assert(:'fees_individual'::jsonb->'regions'=:'fees_policy'::jsonb->'regions'
 and :'fees_individual'::jsonb->>'waivedAtFreeThreshold'='false', 'individual fee good is charged and not waived by the free threshold');
select pg_temp.t19_assert(:'fees_free'::jsonb->>'state'='none' and jsonb_array_length(:'fees_free'::jsonb->'regions')=0
 and :'fees_free'::jsonb->'feeUnit'='null'::jsonb, 'free shipping good is not charged under this policy');
select pg_temp.t19_assert(:'fees_legacy'::jsonb->>'state'='none' and :'fees_legacy'::jsonb->'nextChangeAt'='null'::jsonb,
 'origin without a region policy keeps the plain sentence');
select pg_temp.t19_assert(public.get_good_shipping_region_fees('t19-hidden') is null and public.get_good_shipping_region_fees('t19-missing') is null,
 'unpublished or missing goods have no summary');
-- 주문서 계산과 같다: 같은 주소의 주소 견적(기존 주문 경로)이 같은 지역 추가 배송비를 붙인다.
select pg_temp.t19_assert(
 (public.quote_goods_shipping_for_address(pg_temp.t19_items('t19-policy'),pg_temp.t19_destination('63100','제주특별자치도 합성시 합성로 1'))#>>'{groups,0,regionalFee}')::int=3000
 and (public.quote_goods_shipping_for_address(pg_temp.t19_items('t19-policy'),pg_temp.t19_destination('23120','인천광역시 합성군 합성면 1'))#>>'{groups,0,regionalFee}')::int=5000
 and (public.quote_goods_shipping_for_address(pg_temp.t19_items('t19-policy'),pg_temp.t19_destination('40230','경상북도 합성군 합성읍 1'))#>>'{groups,0,regionalFee}')::int=7000
 and (public.quote_goods_shipping_for_address(pg_temp.t19_items('t19-policy'),pg_temp.t19_destination('54005','합성시 검증구 검증로 2'))#>>'{groups,0,regionalFee}')::int=2500
 and (public.quote_goods_sales_for_address(pg_temp.t19_items('t19-policy'),pg_temp.t19_destination('63100','제주특별자치도 합성시 합성로 1'))#>>'{shipping,groups,0,regionalFee}')::int=3000
 and (public.quote_goods_sales_for_address(pg_temp.t19_items('t19-individual'),pg_temp.t19_destination('40230','경상북도 합성군 합성읍 1'))#>>'{shipping,groups,0,regionalFee}')::int=7000
 and (public.quote_goods_sales_for_address(pg_temp.t19_items('t19-free'),pg_temp.t19_destination('63100','제주특별자치도 합성시 합성로 1'))#>>'{shipping,groups,0,regionalFee}')::int=0,
 'listed amounts equal the checkout quote for an address in each region');
-- 무료배송 기준(30,000원)을 채우면 정책 굿즈의 지역 추가 배송비가 면제된다(waivedAtFreeThreshold).
select pg_temp.t19_assert((public.quote_goods_shipping_for_address(pg_temp.t19_items('t19-policy',3),pg_temp.t19_destination('63100','제주특별자치도 합성시 합성로 1'))#>>'{groups,0,regionalFee}')::int=0
 and (public.quote_goods_shipping_for_address(pg_temp.t19_items('t19-individual',6),pg_temp.t19_destination('63100','제주특별자치도 합성시 합성로 1'))#>>'{groups,0,regionalFee}')::int=3000,
 'the waiver flag matches the checkout at the free threshold');
reset role;

-- 굿즈마다 부과하는 정책은 단위를 바꿔 싣는다.
savepoint t19_per_good;
update private.shipping_region_policies set configuration=configuration||'{"feeUnit":"per_good"}' where id=:'region_policy_id';
set local role anon;
select pg_temp.t19_assert(public.get_good_shipping_region_fees('t19-policy')->>'feeUnit'='per_good'
 and public.get_good_shipping_region_fees('t19-policy')->'regions'=:'fees_policy'::jsonb->'regions', 'per-good unit');
reset role;
rollback to savepoint t19_per_good;

-- 출고지 기본 택배사가 정책 택배사와 다르면 주문서가 막히므로 금액을 싣지 않는다.
savepoint t19_carrier;
update public.fulfillment_origins set default_carrier='t19_other' where id='97190000-0000-4000-8000-000000000101';
set local role anon;
select pg_temp.t19_assert(public.get_good_shipping_region_fees('t19-policy')->>'state'='none', 'carrier mismatch lists nothing');
reset role;
rollback to savepoint t19_carrier;

-- 19금 굿즈는 인증 전 세션에 상세 데이터가 없다.
savepoint t19_adult;
update public.goods set sale_restriction='adult' where id='t19-policy';
set local role anon;
select pg_temp.t19_assert(public.get_good_shipping_region_fees('t19-policy') is null, 'restricted good is hidden from unverified sessions');
reset role;
rollback to savepoint t19_adult;

-- 새 거래 런타임이 켜져 있으면 그 계산 함수의 금액을 싣는다(같은 단순 굿즈는 같은 금액).
savepoint t19_runtime;
update private.goods_transaction_runtime set enabled=true where singleton;
set local role anon;
select pg_temp.t19_assert(public.get_good_shipping_region_fees('t19-policy')=:'fees_policy'::jsonb
 and public.get_good_shipping_region_fees('t19-free')->>'state'='none', 'transaction runtime yields the same summary for simple goods');
reset role;
rollback to savepoint t19_runtime;

-- 지역 후보는 30개까지만 견적한다.
savepoint t19_many;
update private.shipping_region_policies set configuration=jsonb_set(configuration,'{rules}',(configuration->'rules')||(
 select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'postalFrom',lpad((70000+n*10)::text,5,'0'),'postalTo',lpad((70000+n*10+5)::text,5,'0'),
  'addressPrefix','','regionLabel','합성 섬 '||lpad(n::text,2,'0'),'disposition','surcharge','amount',4000+n))
 from generate_series(1,32) n)) where id=:'region_policy_id';
set local role anon;
select pg_temp.t19_assert(public.get_good_shipping_region_fees('t19-policy')->>'truncated'='true'
 and jsonb_array_length(public.get_good_shipping_region_fees('t19-policy')->'regions') between 1 and 30, 'candidate cap');
reset role;
rollback to savepoint t19_many;

rollback;
