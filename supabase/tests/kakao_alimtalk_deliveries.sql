\set ON_ERROR_STOP on
-- 카카오 알림톡 주문 안내 — 받는 사람 판정과 한 번만 보내기 클레임.
begin;
create function pg_temp.alimtalk_error(q text, wanted text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if position(wanted in sqlerrm)>0 then return; end if; raise; end;
 raise exception 'Expected error %', wanted;
end $$;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
 select ('a1a17a10-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.oid(n integer) returns uuid language sql immutable as $$
 select ('a1a17a11-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.sid(n integer) returns uuid language sql immutable as $$
 select ('a1a17a12-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.uid(n),'authenticated','authenticated','alimtalk-'||n||'@example.test',now(),'{}','{}',now(),now()
 from generate_series(1,4) n;
update public.profiles set nickname='TEST 알림톡'||right(id::text,2), birth_date='1990-01-01',
 consents='{"terms":true,"privacy":true}', onboarded_at=now() where id::text like 'a1a17a10-%';
insert into private.member_phone_numbers(user_id,phone_e164,verified_at) values
 (pg_temp.uid(1),'+821012345678',now()), (pg_temp.uid(3),'+14155550123',now()), (pg_temp.uid(4),'+821044445555',now());

insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,export_template,is_active)
 values(pg_temp.uid(9),'alimtalk-origin','TEST 알림톡 출고지','hanjin',3000,50000,'standard',true);
-- 주문 1·5는 인증 번호가 있는 회원 1, 2는 번호 없는 회원 2, 3은 해외 번호 회원 3, 4는 정지된 회원 4.
insert into public.orders(id,user_id,status,total,shipping_fee,address)
 select pg_temp.oid(n), pg_temp.uid(case when n=5 then 1 else n end), 'paid', 10000, 3000,
  '{"recipientName":"TEST 받는분","phone":"01000000000","postalCode":"00123","address1":"합성 주소"}'
 from generate_series(1,5) n;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot) values
 (pg_temp.sid(1),pg_temp.oid(1),pg_temp.uid(9),'TEST 알림톡 출고지',3000,'{}'),
 (pg_temp.sid(5),pg_temp.oid(5),pg_temp.uid(9),'TEST 알림톡 출고지',3000,'{}');
-- 정지 회원은 새 주문을 만들 수 없으므로 주문을 만든 뒤 정지한다.
update public.profiles set suspended_at=now(), suspension_reason='TEST 정지' where id=pg_temp.uid(4);

-- 봉인: 두 함수는 service_role에만 열리고, 장부는 어떤 API 롤에도 열리지 않는다.
select 1/case when has_function_privilege('service_role','public.service_claim_kakao_alimtalk_delivery(text,uuid,uuid)','execute')
 and has_function_privilege('service_role','public.service_complete_kakao_alimtalk_delivery(uuid,uuid,text,text,text)','execute')
 and not has_function_privilege('authenticated','public.service_claim_kakao_alimtalk_delivery(text,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.service_claim_kakao_alimtalk_delivery(text,uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.service_complete_kakao_alimtalk_delivery(uuid,uuid,text,text,text)','execute')
 and not has_function_privilege('anon','public.service_complete_kakao_alimtalk_delivery(uuid,uuid,text,text,text)','execute')
 and not has_table_privilege('service_role','private.kakao_alimtalk_deliveries','select,insert,update,delete')
 and not has_table_privilege('authenticated','private.kakao_alimtalk_deliveries','select,insert,update,delete')
 then 1 else 0 end as sealed;

set local role service_role;

-- 요청 모양: 발송 안내에만 배송 건이 있다.
select pg_temp.alimtalk_error(format($q$select public.service_claim_kakao_alimtalk_delivery('order_shipped',%L)$q$, pg_temp.oid(1)), 'invalid_alimtalk_delivery_request');
select pg_temp.alimtalk_error(format($q$select public.service_claim_kakao_alimtalk_delivery('order_confirmation',%L,%L)$q$, pg_temp.oid(1), pg_temp.sid(1)), 'invalid_alimtalk_delivery_request');
select pg_temp.alimtalk_error(format($q$select public.service_claim_kakao_alimtalk_delivery('restock_alert',%L)$q$, pg_temp.oid(1)), 'invalid_alimtalk_delivery_request');

-- 받는 사람 판정: 주문·배송 건·계정·인증 번호·국내 휴대폰. 거절은 장부에 행을 남기지 않는다.
select 1/case when public.service_claim_kakao_alimtalk_delivery('order_confirmation', pg_temp.uid(99))->>'reason'='order_missing'
 and public.service_claim_kakao_alimtalk_delivery('order_shipped', pg_temp.oid(1), pg_temp.sid(5))->>'reason'='shipment_missing'
 and public.service_claim_kakao_alimtalk_delivery('order_confirmation', pg_temp.oid(2))->>'reason'='no_verified_phone'
 and public.service_claim_kakao_alimtalk_delivery('order_confirmation', pg_temp.oid(3))->>'reason'='unsupported_number'
 and public.service_claim_kakao_alimtalk_delivery('order_confirmation', pg_temp.oid(4))->>'reason'='account_unavailable'
 then 1 else 0 end as recipient_rules;
reset role;
select 1/case when not exists(select 1 from private.kakao_alimtalk_deliveries) then 1 else 0 end as refusals_leave_no_rows;

-- 첫 클레임: 국내 형식 번호를 돌려주고 장부에는 번호 없이 회원·주문만 남긴다. 진행 중에는 다시 클레임되지 않는다.
set local role service_role;
select public.service_claim_kakao_alimtalk_delivery('order_confirmation', pg_temp.oid(1)) as first \gset
select 1/case when (:'first'::jsonb)->>'ok'='true' and (:'first'::jsonb)->>'recipientNo'='01012345678'
 and public.service_claim_kakao_alimtalk_delivery('order_confirmation', pg_temp.oid(1))->>'reason'='in_progress'
 then 1 else 0 end as first_claim;
reset role;
select 1/case when (select count(*) from private.kakao_alimtalk_deliveries)=1
 and (select status='pending' and recipient_user_id=pg_temp.uid(1) and attempt_count=1 and dedupe_key='order_confirmation:'||pg_temp.oid(1)
   from private.kakao_alimtalk_deliveries where order_id=pg_temp.oid(1))
 and not exists(select 1 from information_schema.columns where table_schema='private' and table_name='kakao_alimtalk_deliveries'
   and column_name ~ '(phone|recipient_no|body|text)')
 then 1 else 0 end as ledger_without_phone;

-- 결과 기록: 클레임 토큰이 맞는 pending 행만 닫는다. sent에는 오류가 없고, 실패에는 오류 코드가 있어야 한다.
set local role service_role;
select pg_temp.alimtalk_error(format($q$select public.service_complete_kakao_alimtalk_delivery(%L,%L,'sent',null,'provider_http_400')$q$,
 (:'first'::jsonb)->>'deliveryId', (:'first'::jsonb)->>'claimToken'), 'invalid_alimtalk_delivery_result');
select pg_temp.alimtalk_error(format($q$select public.service_complete_kakao_alimtalk_delivery(%L,%L,'unknown')$q$,
 (:'first'::jsonb)->>'deliveryId', (:'first'::jsonb)->>'claimToken'), 'invalid_alimtalk_delivery_result');
select pg_temp.alimtalk_error(format($q$select public.service_complete_kakao_alimtalk_delivery(%L,%L,'failed',null,'Provider HTTP 400')$q$,
 (:'first'::jsonb)->>'deliveryId', (:'first'::jsonb)->>'claimToken'), 'invalid_alimtalk_delivery_result');
select 1/case when not public.service_complete_kakao_alimtalk_delivery(((:'first'::jsonb)->>'deliveryId')::uuid, pg_temp.uid(98), 'failed', null, 'provider_http_400')
 and public.service_complete_kakao_alimtalk_delivery(((:'first'::jsonb)->>'deliveryId')::uuid, ((:'first'::jsonb)->>'claimToken')::uuid, 'failed', null, 'provider_http_400')
 and not public.service_complete_kakao_alimtalk_delivery(((:'first'::jsonb)->>'deliveryId')::uuid, ((:'first'::jsonb)->>'claimToken')::uuid, 'sent', 'req-1', null)
 then 1 else 0 end as complete_once;

-- 확실한 실패는 다시 클레임된다(새 토큰, 시도 2). 보낸 뒤에는 다시 보내지 않는다.
select public.service_claim_kakao_alimtalk_delivery('order_confirmation', pg_temp.oid(1)) as retry \gset
select 1/case when (:'retry'::jsonb)->>'ok'='true' and (:'retry'::jsonb)->>'deliveryId'=(:'first'::jsonb)->>'deliveryId'
 and (:'retry'::jsonb)->>'claimToken'<>(:'first'::jsonb)->>'claimToken'
 and public.service_complete_kakao_alimtalk_delivery(((:'retry'::jsonb)->>'deliveryId')::uuid, ((:'retry'::jsonb)->>'claimToken')::uuid, 'sent', '20261119-ABC.def_1:x', null)
 and public.service_claim_kakao_alimtalk_delivery('order_confirmation', pg_temp.oid(1))->>'reason'='already_sent'
 then 1 else 0 end as retry_then_sent;
reset role;
select 1/case when (select status='sent' and attempt_count=2 and provider_request_id='20261119-ABC.def_1:x' and error_code is null and completed_at is not null
 from private.kakao_alimtalk_deliveries where order_id=pg_temp.oid(1)) then 1 else 0 end as sent_recorded;

-- 결과를 모르는 발송(시간 초과)과 15분 넘게 결과가 없는 클레임은 자동으로 다시 보내지 않는다.
set local role service_role;
select public.service_claim_kakao_alimtalk_delivery('order_shipped', pg_temp.oid(1), pg_temp.sid(1)) as shipped \gset
select 1/case when (:'shipped'::jsonb)->>'ok'='true'
 and public.service_complete_kakao_alimtalk_delivery(((:'shipped'::jsonb)->>'deliveryId')::uuid, ((:'shipped'::jsonb)->>'claimToken')::uuid, 'unknown', null, 'provider_network')
 and public.service_claim_kakao_alimtalk_delivery('order_shipped', pg_temp.oid(1), pg_temp.sid(1))->>'reason'='outcome_unknown'
 then 1 else 0 end as unknown_not_resent;
select public.service_claim_kakao_alimtalk_delivery('order_shipped', pg_temp.oid(5), pg_temp.sid(5)) as stale \gset
reset role;
update private.kakao_alimtalk_deliveries set claimed_at=now()-interval '16 minutes' where id=((:'stale'::jsonb)->>'deliveryId')::uuid;
set local role service_role;
select 1/case when (:'stale'::jsonb)->>'ok'='true'
 and public.service_claim_kakao_alimtalk_delivery('order_shipped', pg_temp.oid(5), pg_temp.sid(5))->>'reason'='outcome_unknown'
 and not public.service_complete_kakao_alimtalk_delivery(((:'stale'::jsonb)->>'deliveryId')::uuid, ((:'stale'::jsonb)->>'claimToken')::uuid, 'sent', 'late', null)
 and public.service_claim_kakao_alimtalk_delivery('order_shipped', pg_temp.oid(5), pg_temp.sid(5))->>'reason'='outcome_unknown'
 then 1 else 0 end as stale_claim_is_unknown;
reset role;
select 1/case when (select status='unknown' and error_code='claim_expired' from private.kakao_alimtalk_deliveries where id=((:'stale'::jsonb)->>'deliveryId')::uuid)
 then 1 else 0 end as stale_recorded;

-- 확실한 실패도 다섯 번까지만 다시 보낸다.
set local role service_role;
select public.service_claim_kakao_alimtalk_delivery('order_confirmation', pg_temp.oid(5)) as capped \gset
select public.service_complete_kakao_alimtalk_delivery(((:'capped'::jsonb)->>'deliveryId')::uuid, ((:'capped'::jsonb)->>'claimToken')::uuid, 'failed', null, 'recipient_result_3018');
reset role;
update private.kakao_alimtalk_deliveries set attempt_count=5 where id=((:'capped'::jsonb)->>'deliveryId')::uuid;
set local role service_role;
select 1/case when public.service_claim_kakao_alimtalk_delivery('order_confirmation', pg_temp.oid(5))->>'reason'='attempts_exhausted'
 then 1 else 0 end as attempts_capped;
reset role;

rollback;
