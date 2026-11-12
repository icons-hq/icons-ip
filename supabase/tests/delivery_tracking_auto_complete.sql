\set ON_ERROR_STOP on
-- QNA-028 택배 추적 자동 배송완료. 스위치(private.delivery_tracking_settings)가 꺼져 있으면 조회 대상·이벤트·배송완료가 모두 막히고
-- 화면 표시도 비어 있다. 켜면 모든 운송장(대표 + 추가)의 기준 시각(coalesce(출고지시 전달 시각, 발주확인 시각, 발송 등록 시각)) 이후 최근 이벤트가
-- 배달완료인 택배 배송 건만 배송완료로 바꾸고, 배송완료 시각은 가장 늦은 도착 시각이다(지금보다 늦으면 지금).
-- 발주확인·출고지시 이전 이력(번호 재사용·오기)은 근거가 아니고, 회신 등록이 배달보다 늦거나 배달 뒤 추가 운송장을 붙여도 정상 배달 이벤트는 근거다. 틀린 이벤트는 그 운송장만 조회 오류로 남기고 나머지는 계속 기록한다.
-- 합성 계정·주문만 쓰고 끝에서 모두 되돌린다.
begin;
do $$ begin
 if to_regclass('private.operator_legacy_fixture_control') is not null then
  raise exception 'Delivery tracking tests must run without the legacy fixture helper';end if;
end $$;
update private.operator_access_state set configured=false,revision=1 where id;

create function pg_temp.dt_id(kind integer,n integer) returns uuid language sql immutable as $$
 select ('f13b0000-0000-'||lpad(kind::text,4,'0')||'-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.dt_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Delivery tracking assertion: %',label;end if;
end $$;
create function pg_temp.dt_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;
 exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected error % from %',expected,statement;
end $$;
create function pg_temp.dt_event(carrier text,tracking text,event_key text,status text,occurred timestamptz) returns jsonb language sql immutable as $$
 select jsonb_build_object('carrier',carrier,'trackingNumber',tracking,'outcome','ok','events',jsonb_build_array(jsonb_build_object(
  'eventKey',event_key,'status',status,'occurredAt',occurred,'description','합성 이벤트','location','합성 지점','raw',jsonb_build_object('code',status))));
$$;

-- 계정: 1 주매니저, 2 구매자. 주문 1~6·9는 발주확인·배송 중 택배(1 대표+추가, 2 대표만, 3 발송 전 옛 배달완료 이력, 4 미래 시각 도착,
-- 5 배달완료 뒤 반송, 6 다른 배송 건이 아직 준비 중인 주문, 9 회신 등록이 배달보다 늦고 배달 뒤에 추가 운송장을 붙인 건), 7은 운영자 배송완료, 8은 전이가 거절되는 건(보류).
-- 배송 건 9는 주문 6의 다른 출고지 배송 건(발송 전), 배송 건 10은 주문 9의 배송 건이다.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.dt_id(1,n),'authenticated','authenticated','delivery-tracking-'||n||'@example.test',now(),'{}','{}',now(),now()
from generate_series(1,2) n;
update public.profiles set role=(case when right(id::text,2)='02' then 'user' else 'staff' end)::public.user_role,
 nickname='delivery_tracking_'||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
where id::text like 'f13b0000-0000-0001-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values (pg_temp.dt_id(1,1),'primary');
insert into public.ips(id,title,vertical_key) values('delivery-tracking-ip','합성 추적 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('delivery-tracking-good','delivery-tracking-ip','합성 추적 상품','문구',1000,'ok',100);
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at)
select pg_temp.dt_id(2,n),pg_temp.dt_id(1,2),'confirmed'::public.order_status,5000,3000,
 jsonb_build_object('recipientName','합성수령인'||n,'phone','0105555000'||n,'postalCode','00123','address1','합성 주소','address2',n||'층','deliveryNote',''),now()-interval '3 days'
from generate_series(1,9) n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select pg_temp.dt_id(3,n),pg_temp.dt_id(2,case when n=9 then 6 when n=10 then 9 else n end),'delivery-tracking-good',v.id,1,1000,'합성 추적 상품','문구','delivery-tracking-ip'
from generate_series(1,10) n cross join (select id from public.goods_variants where good_id='delivery-tracking-good' and is_default) v;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,exported_at)
select pg_temp.dt_id(4,n),pg_temp.dt_id(2,case when n=9 then 6 when n=10 then 9 else n end),
 case when n=9 then '00000000-0000-4000-8000-000000042202'::uuid else '00000000-0000-4000-8000-000000042201'::uuid end,
 case when n=9 then '남양주' else '김포' end,3000,'{}',now()-interval '2 days'
from generate_series(1,10) n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
select pg_temp.dt_id(2,case when n=9 then 6 when n=10 then 9 else n end),pg_temp.dt_id(4,n),pg_temp.dt_id(3,n),1 from generate_series(1,10) n;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dt_id(1,1)::text,true);
select pg_temp.dt_assert(bool_and((value->>'ok')::boolean),'fixture dispatch') from jsonb_array_elements(public.admin_import_shipment_tracking_batch(
 (select jsonb_agg(jsonb_build_object('line',n,'reference',pg_temp.dt_id(4,n)::text,'carrier','hanjin','trackingNumber','DT'||lpad(n::text,8,'0'))) from (select generate_series(1,8) n union all select 10) numbers)));
select public.admin_add_shipment_extra_tracking(pg_temp.dt_id(4,1),'hanjin','DT10000001','분리배송 연결 송장',pg_temp.dt_id(5,1));
reset role;
-- 발송 시각을 이틀 전으로 맞춘다(출고지시도 이틀 전). 주문 1의 추가 운송장은 회신 때 함께 붙은 것처럼 발송 1분 뒤에 붙인 것으로 둔다.
update public.order_shipments set shipped_at=now()-interval '2 days' where id in (select pg_temp.dt_id(4,n) from generate_series(1,10) n) and status='shipping';
update public.order_shipment_extra_trackings set created_at=now()-interval '2 days'+interval '1 minute' where shipment_id=pg_temp.dt_id(4,1);
-- 배송 건 10(r7): 회신 등록이 실제 배달보다 늦다(발송 등록 = 1시간 전, 출고지시 = 이틀 전). 추가 운송장도 배달 뒤 지금 붙인다.
update public.order_shipments set shipped_at=now()-interval '1 hour' where id=pg_temp.dt_id(4,10);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dt_id(1,1)::text,true);
select public.admin_add_shipment_extra_tracking(pg_temp.dt_id(4,10),'hanjin','DT10000009','김포 분리배송 추가',pg_temp.dt_id(5,2));
reset role;
-- 주문 8: 배송완료 전이가 거절되는 배송 건(이 시험 안에서만 쓰는 가드) — 자동 배송완료가 보류되고 다른 건은 계속된다.
create function public.dt_block_delivery_for_test() returns trigger language plpgsql as $$begin
 if new.id='f13b0000-0000-0004-8000-000000000008'::uuid and new.status='delivered' then raise check_violation using message='synthetic_delivery_block';end if;
 return new;end $$;
create trigger dt_block_delivery_for_test before update on public.order_shipments for each row execute function public.dt_block_delivery_for_test();
update private.purchase_confirmation_policy set auto_enabled=true,auto_after_days=8 where singleton;

-- A. 스위치는 기본 꺼짐이고, 서비스 경로는 service_role만 부른다.
select pg_temp.dt_assert((select not auto_delivery_enabled and provider is null and enabled_at is null from private.delivery_tracking_settings where singleton)
 and not has_function_privilege('authenticated','public.service_delivery_tracking_targets(integer)','execute')
 and not has_function_privilege('authenticated','public.service_record_delivery_tracking(text,jsonb)','execute')
 and not has_function_privilege('authenticated','public.service_complete_tracked_deliveries(integer)','execute')
 and has_function_privilege('service_role','public.service_complete_tracked_deliveries(integer)','execute')
 and not has_table_privilege('service_role','private.shipment_tracking_events','select'),'switch defaults off and service-only entry');

-- B. 꺼져 있으면 아무것도 고르지 않고, 이벤트를 받지 않고, 이미 남은 배달완료 이벤트가 있어도 배송완료로 바꾸지 않는다.
set local role service_role;
select pg_temp.dt_assert(public.service_delivery_tracking_targets(50)='{"enabled":false}'::jsonb,'targets off');
select pg_temp.dt_error(format('select public.service_record_delivery_tracking(%L,%L::jsonb)','fake',jsonb_build_array(pg_temp.dt_event('hanjin','DT00000002','e1','delivered',now()))),'delivery_tracking_disabled');
reset role;
insert into private.shipment_tracking_events(provider,carrier,tracking_number,event_key,status,occurred_at,payload)
values ('fake','hanjin','DT00000002','stray','delivered',now()-interval '1 hour','{}');
set local role service_role;
select pg_temp.dt_assert(public.service_complete_tracked_deliveries(50)='{"held":[],"enabled":false,"skipped":0,"completed":[]}'::jsonb,'completion off');
reset role;
select pg_temp.dt_assert((select status from public.order_shipments where id=pg_temp.dt_id(4,2))='shipping'
 and not exists(select 1 from private.shipment_auto_deliveries),'switch off changes nothing');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dt_id(1,1)::text,true);
select pg_temp.dt_assert(public.admin_shipment_tracking_summaries(array[pg_temp.dt_id(4,2)])#>array['shipments',pg_temp.dt_id(4,2)::text]
 ='{"tracking":null,"deliveredBy":null,"extraTrackings":[]}'::jsonb,'summaries hide tracking while off');
reset role;
delete from private.shipment_tracking_events where event_key='stray';

-- C. 켠다(후속 migration과 같은 문장). 변경은 감사 기록에 남는다. 켤 때는 서비스 이름과 시각이 필요하다.
select pg_temp.dt_error('update private.delivery_tracking_settings set auto_delivery_enabled=true where singleton','23514');
update private.delivery_tracking_settings set auto_delivery_enabled=true,provider='fake',enabled_at=now() where singleton;
select pg_temp.dt_assert((select count(*) from public.audit_log where action='system.delivery_tracking.settings_changed'
 and diff#>>'{after,auto_delivery_enabled}'='true' and diff#>>'{before,auto_delivery_enabled}'='false')=1,'switch change audited');
select pg_temp.dt_error('delete from private.delivery_tracking_settings','delivery_tracking_settings_required');

-- D. 조회 대상: 배송 중 택배 건의 대표·추가 운송장(같은 번호는 하나), 오래 조회하지 않은 것부터.
set local role service_role;
select public.service_delivery_tracking_targets(200) as targets \gset
select pg_temp.dt_assert(:'targets'::jsonb->>'enabled'='true' and :'targets'::jsonb->>'provider'='fake'
 and (select count(*) from jsonb_array_elements(:'targets'::jsonb->'targets') t where t->>'trackingNumber' like 'DT%')=11
 and exists(select 1 from jsonb_array_elements(:'targets'::jsonb->'targets') t where t->>'trackingNumber'='DT10000001'),'targets include representative and extra trackings');
select pg_temp.dt_error(format('select public.service_record_delivery_tracking(%L,%L::jsonb)','other',jsonb_build_array(pg_temp.dt_event('hanjin','DT00000002','e1','delivered',now()))),'delivery_tracking_provider_mismatch');
select pg_temp.dt_error(format('select public.service_record_delivery_tracking(%L,%L::jsonb)','fake','{"not":"array"}'),'invalid_delivery_tracking_results');

-- D2. 틀린 결과·이벤트는 그 운송장만 조회 오류(invalid_event)로 남기고 같은 회차의 정상 결과는 기록한다. 8KB를 넘는 원본은 잘렸다는 표시로 남긴다.
select public.service_record_delivery_tracking('fake',jsonb_build_array(
 jsonb_build_object('carrier','hanjin','trackingNumber','DT00000006','outcome','ok','events',jsonb_build_array(
  jsonb_build_object('eventKey','bad','status','teleported','occurredAt',now()-interval '1 hour','raw','{}'::jsonb))),
 pg_temp.dt_event('hanjin','DT00000005','future','delivered',now()+interval '2 days'),
 jsonb_build_object('trackingNumber','DT00000004','outcome','ok'),
 jsonb_build_object('carrier','hanjin','trackingNumber','DT00000004','outcome','ok','events',jsonb_build_array(
  jsonb_build_object('eventKey','big','status','in_transit','occurredAt',now()-interval '1 day','raw',jsonb_build_object('note',repeat('x',9000))))))) as tolerant \gset
select pg_temp.dt_assert(:'tolerant'::jsonb='{"recorded":1,"duplicates":0,"ignored":0,"invalid":3}'::jsonb,'bad results do not block the good one');
reset role;
select pg_temp.dt_assert((select last_outcome||':'||last_error_code from private.shipment_tracking_polls where tracking_number='DT00000006')='error:invalid_event'
 and (select last_outcome||':'||last_error_code from private.shipment_tracking_polls where tracking_number='DT00000005')='error:invalid_event'
 and not exists(select 1 from private.shipment_tracking_events where tracking_number in ('DT00000005','DT00000006'))
 and (select payload from private.shipment_tracking_events where event_key='big')='{"truncated":true}'::jsonb,'invalid tracking recorded as poll error, oversized raw truncated');

-- E. 이벤트 기록: 대표만 배달완료인 주문 1은 그대로, 주문 2는 배송완료. 같은 이벤트는 한 번만, 모르는 운송장은 무시한다.
-- 주문 3은 출고지시(이틀 전)·발주확인(사흘 전)보다 이른 '배달완료' 이력뿐이다(번호 재사용·오기; 출고지시와 발주확인 사이도 근거 아님).
-- 주문 9(배송 건 10)는 발송 등록(1시간 전)보다 이르지만 출고지시 뒤인 정상 배달 이벤트라 대표·추가 모두 근거다.
set local role service_role;
select public.service_record_delivery_tracking('fake',jsonb_build_array(
 pg_temp.dt_event('hanjin','DT00000001','d1','delivered',now()-interval '6 hours'),
 pg_temp.dt_event('hanjin','DT10000001','t1','in_transit',now()-interval '20 hours'),
 pg_temp.dt_event('hanjin','DT00000002','d2','delivered',now()-interval '3 hours'),
 pg_temp.dt_event('hanjin','DT00000003','d3','delivered',now()-interval '42 days'),
 pg_temp.dt_event('hanjin','DT00000003','d3mid','delivered',now()-interval '60 hours'),
 pg_temp.dt_event('hanjin','DT00000004','d4','delivered',now()+interval '30 minutes'),
 pg_temp.dt_event('hanjin','DT00000005','d5','delivered',now()-interval '4 hours'),
 pg_temp.dt_event('hanjin','DT00000006','d6','delivered',now()-interval '4 hours'),
 pg_temp.dt_event('hanjin','DT00000008','d8','delivered',now()-interval '2 hours'),
 pg_temp.dt_event('hanjin','DT00000010','d10','delivered',now()-interval '5 hours'),
 pg_temp.dt_event('hanjin','DT10000009','d10x','delivered',now()-interval '3 hours'),
 pg_temp.dt_event('hanjin','DT99999999','x','delivered',now()),
 jsonb_build_object('carrier','hanjin','trackingNumber','DT00000007','outcome','error','errorCode','rate_limited'))) as recorded \gset
select pg_temp.dt_assert(:'recorded'::jsonb='{"recorded":11,"duplicates":0,"ignored":1,"invalid":0}'::jsonb,'events recorded once, unknown ignored');
select pg_temp.dt_assert(public.service_record_delivery_tracking('fake',jsonb_build_array(pg_temp.dt_event('hanjin','DT00000002','d2','delivered',now()-interval '3 hours')))
 ='{"recorded":0,"duplicates":1,"ignored":0,"invalid":0}'::jsonb,'duplicate event');
-- 주문 5: 배달완료 뒤 반송 이벤트가 오면 최근 이벤트가 배달완료가 아니라 바꾸지 않는다.
select public.service_record_delivery_tracking('fake',jsonb_build_array(pg_temp.dt_event('hanjin','DT00000005','r5','returned',now()-interval '1 hour')));
reset role;
select pg_temp.dt_assert((select last_outcome||':'||last_error_code||':'||consecutive_failures from private.shipment_tracking_polls where tracking_number='DT00000007')='error:rate_limited:1'
 and (select last_outcome||':'||coalesce(last_error_code,'')||':'||consecutive_failures from private.shipment_tracking_polls where tracking_number='DT00000005')='ok::0'
 and (select count(*) from private.shipment_tracking_events where provider='fake' and tracking_number like 'DT%')=13,'poll state and raw events');
-- 운영자가 주문 7을 배송완료로 처리한다(수동).
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dt_id(1,1)::text,true);
select pg_temp.dt_assert(public.admin_complete_shipments(array[pg_temp.dt_id(4,7)])#>>'{0,ok}'='true','manual completion');
reset role;

set local role service_role;
select public.service_complete_tracked_deliveries(50) as run_one \gset
reset role;
select pg_temp.dt_assert((select array_agg(value->>'shipmentId' order by value->>'shipmentId') from jsonb_array_elements(:'run_one'::jsonb->'completed'))
 =array[pg_temp.dt_id(4,2)::text,pg_temp.dt_id(4,4)::text,pg_temp.dt_id(4,6)::text,pg_temp.dt_id(4,10)::text]
 and (select array_agg(value->>'shipmentId') from jsonb_array_elements(:'run_one'::jsonb->'held'))=array[pg_temp.dt_id(4,8)::text]
 and :'run_one'::jsonb->>'skipped'='0',
 'only fully delivered shipments complete, blocked ones are held');
select pg_temp.dt_assert((select status from public.order_shipments where id=pg_temp.dt_id(4,1))='shipping'
 and (select status from public.order_shipments where id=pg_temp.dt_id(4,3))='shipping'
 and (select status from public.order_shipments where id=pg_temp.dt_id(4,5))='shipping'
 and (select status from public.order_shipments where id=pg_temp.dt_id(4,6))='delivered'
 and (select status from public.orders where id=pg_temp.dt_id(2,6))='shipping'
 and (select status from public.order_shipments where id=pg_temp.dt_id(4,8))='shipping'
 and (select status from public.order_shipments where id=pg_temp.dt_id(4,10))='delivered'
 and (select state||':'||attempts from private.shipment_auto_deliveries where shipment_id=pg_temp.dt_id(4,8))='held:1',
 'partial trackings, pre-baseline history, returned parcels and blocked orders stay; reply-lag shipment completes');
-- r7: 회신 등록(발송 1시간 전)보다 이른 배달도 근거라 배송완료 시각은 가장 늦은 도착이되 등록 시각 밑으로 내려가지 않는다.
select pg_temp.dt_assert((select abs(extract(epoch from delivered_at-(now()-interval '1 hour')))<1 from public.order_shipments where id=pg_temp.dt_id(4,10))
 and (select jsonb_array_length(basis) from private.shipment_auto_deliveries where shipment_id=pg_temp.dt_id(4,10))=2,'reply-lag delivery counted with both trackings');
-- 배송완료 시각: 도착 시각 그대로(2), 미래면 처리 시각(4). 주문 배송완료·구매확정 기한이 그 시각을 따른다.
select pg_temp.dt_assert((select abs(extract(epoch from delivered_at-(now()-interval '3 hours')))<1 from public.order_shipments where id=pg_temp.dt_id(4,2))
 and (select delivered_at<=clock_timestamp() and delivered_at>now()-interval '1 minute' from public.order_shipments where id=pg_temp.dt_id(4,4))
 and (select o.status='delivered' and o.delivered_at=s.delivered_at from public.orders o join public.order_shipments s on s.order_id=o.id where o.id=pg_temp.dt_id(2,2))
 and (select c.auto_due_at=o.delivered_at+interval '8 days' from private.order_purchase_confirmations c join public.orders o on o.id=c.order_id where o.id=pg_temp.dt_id(2,2)),
 'delivered time follows the arrival, clamped to now');
select pg_temp.dt_assert((select count(*) from public.audit_log where action='system.shipment.tracking_delivered' and actor_id is null
 and target in ('order:'||pg_temp.dt_id(2,2),'order:'||pg_temp.dt_id(2,4),'order:'||pg_temp.dt_id(2,6)))=3
 and (select basis->0->>'trackingNumber' from private.shipment_auto_deliveries where shipment_id=pg_temp.dt_id(4,2))='DT00000002','auto delivery audit and basis');
-- 발주확인·출고지시 이전 이력만 있는 운송장은 계속 조회 대상이다(조회 간격만 지나면). 배달 확인된 배송 건 10의 번호는 더 조회하지 않는다.
delete from private.shipment_tracking_polls where tracking_number in ('DT00000003','DT10000009');
set local role service_role;
select public.service_delivery_tracking_targets(200)->'targets' as still_polled \gset
reset role;
select pg_temp.dt_assert(:'still_polled'::jsonb@>'[{"carrier":"hanjin","trackingNumber":"DT00000003"}]'::jsonb
 and not :'still_polled'::jsonb@>'[{"carrier":"hanjin","trackingNumber":"DT10000009"}]'::jsonb,
 'pre-baseline history keeps the tracking polled');

-- F. 기준 시각 이후 도착이 오면 바뀐다: 주문 1은 추가 운송장까지 도착해 늦은 쪽 시각, 주문 3은 새 배달완료 시각.
set local role service_role;
select public.service_record_delivery_tracking('fake',jsonb_build_array(pg_temp.dt_event('hanjin','DT10000001','d1x','delivered',now()-interval '90 minutes'),
 pg_temp.dt_event('hanjin','DT00000003','d3new','delivered',now()-interval '1 hour')));
select public.service_complete_tracked_deliveries(50) as run_two \gset
select pg_temp.dt_assert((select array_agg(value->>'shipmentId' order by value->>'shipmentId') from jsonb_array_elements(:'run_two'::jsonb->'completed'))
 =array[pg_temp.dt_id(4,1)::text,pg_temp.dt_id(4,3)::text]
 and :'run_two'::jsonb->'held'='[]'::jsonb,'second run completes after post-dispatch arrivals only (held one waits)');
select pg_temp.dt_assert(public.service_complete_tracked_deliveries(50)->'completed'='[]'::jsonb,'idempotent run');
reset role;
select pg_temp.dt_assert((select abs(extract(epoch from delivered_at-(now()-interval '90 minutes')))<1 from public.order_shipments where id=pg_temp.dt_id(4,1))
 and (select jsonb_array_length(basis) from private.shipment_auto_deliveries where shipment_id=pg_temp.dt_id(4,1))=2
 and (select abs(extract(epoch from delivered_at-(now()-interval '1 hour')))<1 from public.order_shipments where id=pg_temp.dt_id(4,3)),
 'latest post-baseline arrival wins');

-- G. 배송현황 표시: 자동·수동 구분과 추적 진행(도착 수)을 기준 시각 이후 이벤트로 싣는다.
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dt_id(1,1)::text,true);
select public.admin_shipment_tracking_summaries(array[pg_temp.dt_id(4,1),pg_temp.dt_id(4,5),pg_temp.dt_id(4,7),pg_temp.dt_id(4,8),pg_temp.dt_id(4,10)]) as shown \gset
select pg_temp.dt_assert(:'shown'::jsonb->>'autoDelivery'='true'
 and :'shown'::jsonb#>>array['shipments',pg_temp.dt_id(4,1)::text,'deliveredBy']='tracking'
 and :'shown'::jsonb#>>array['shipments',pg_temp.dt_id(4,7)::text,'deliveredBy']='manual'
 and :'shown'::jsonb#>array['shipments',pg_temp.dt_id(4,5)::text,'tracking']@>'{"total":1,"delivered":0,"latestStatus":"returned","held":false}'::jsonb
 and :'shown'::jsonb#>>array['shipments',pg_temp.dt_id(4,10)::text,'deliveredBy']='tracking'
 and :'shown'::jsonb#>array['shipments',pg_temp.dt_id(4,8)::text,'tracking']@>'{"total":1,"delivered":1,"held":true}'::jsonb,'summaries with tracking switch');
reset role;

-- H. 다시 끄면 즉시 멈춘다(남은 배달완료 이벤트가 있어도 바꾸지 않는다).
update private.delivery_tracking_settings set auto_delivery_enabled=false where singleton;
update private.shipment_auto_deliveries set updated_at=now()-interval '7 hours' where shipment_id=pg_temp.dt_id(4,8);
drop trigger dt_block_delivery_for_test on public.order_shipments;
set local role service_role;
select pg_temp.dt_assert(public.service_complete_tracked_deliveries(50)->>'enabled'='false','switched off again');
reset role;
select pg_temp.dt_assert((select status from public.order_shipments where id=pg_temp.dt_id(4,8))='shipping','nothing changes after switching off');
rollback;
