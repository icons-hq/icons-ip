\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 자동 발주확인 — 가상계좌 입금 직후 1시간 대기 (20261125180000, ADR-0025 보강)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · 가상계좌 주문은 마지막 입금 확인이 실행 마감 1시간 전보다 늦으면 신규주문에 남고 사유 deposit_settling이 남는다
--     (정확히 1시간 전은 대상, 1초 늦으면 제외). 다음 날 실행이 확정한다.
--   · 마지막 입금 확인 = 결제완료 시각과 재입금 확인(deposit_confirmed)으로 풀린 되돌림 보류 해제 시각 중 늦은 쪽
--   · 열린 입금 되돌림 보류는 기존 사유(fulfillment_hold)가 먼저다
--   · 카드 등 가상계좌가 아닌 결제는 마감 직전 결제도 그대로 확정한다
--   · 운영 화면 문서가 새 사유를 그대로 싣는다
--   · 새 함수는 어느 역할에도 실행 권한이 없다(선언적 확인)
-- 실행 날짜는 2031-04로 고정해 실제 매분 틱(오늘 날짜)·다른 스모크(2031-03)와 겹치지 않는다.
-- ============================================================================

select 1/case when (
  not has_function_privilege('authenticated','private.order_virtual_account_deposit_confirmed_at(uuid)','execute')
  and not has_function_privilege('service_role','private.order_virtual_account_deposit_confirmed_at(uuid)','execute')
  and not has_function_privilege('anon','private.order_virtual_account_deposit_confirmed_at(uuid)','execute')
  and not has_function_privilege('authenticated','private.auto_order_confirmation_run_blocker(uuid,timestamptz)','execute')
  and not has_function_privilege('service_role','private.auto_order_confirmation_run_blocker(uuid,timestamptz)','execute')
  and not has_function_privilege('anon','private.auto_order_confirmation_run_blocker(uuid,timestamptz)','execute')
  and position('auto_order_confirmation_run_blocker(candidate.id,run.cutoff_at)' in
    pg_get_functiondef('private.run_auto_order_confirmation(timestamptz,integer)'::regprocedure))>0
  and position('auto_order_confirmation_blocker(candidate.id)' in
    pg_get_functiondef('private.run_auto_order_confirmation(timestamptz,integer)'::regprocedure))=0
) then 1 else 0 end as assert_sealed_and_run_uses_new_blocker;

-- ---------------------------------------------------------------------------
-- Fixtures (합성 값)
-- ---------------------------------------------------------------------------
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('a0c30000-0000-4000-8000-000000000002','authenticated','authenticated','auto-confirm-va-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 가상계좌 자동 발주확인',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id='a0c30000-0000-4000-8000-000000000002';
insert into public.ips(id,title,vertical_key) values('auto-confirm-va-ip','TEST 가상계좌 자동 발주확인 IP','character');
insert into public.goods(id,ip_id,name,price,stock,stock_qty) values('auto-confirm-va-goods','auto-confirm-va-ip','TEST 가상계좌 자동 발주확인 상품',10000,'ok',100);
insert into public.fulfillment_origins(id,code,name,base_fee,return_address)
 values('a0c30000-0000-4000-8000-0000000000f1','auto-confirm-va-origin','TEST 가상계좌 자동 발주확인 창고',0,'합성 반송 주소');

-- n번 주문을 paid로 만든다. va면 승인된 가상계좌 결제 시도와 계좌 원장을 붙인다.
create function pg_temp.paid_order(n integer,paid timestamptz,va boolean) returns uuid language plpgsql as $$
declare oid uuid:=('a0c30000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid;item uuid;sid uuid:=gen_random_uuid();attempt uuid;
begin
 insert into public.orders(id,user_id,status,total,address) values(oid,'a0c30000-0000-4000-8000-000000000002','paid',10000,
  '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}');
 insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_ip_id_snapshot,variant_id)
  values(oid,'auto-confirm-va-goods',1,10000,'TEST 가상계좌 자동 발주확인 상품','auto-confirm-va-ip',
   (select id from public.goods_variants where good_id='auto-confirm-va-goods' and is_default))
  returning id into item;
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
  values(sid,oid,'a0c30000-0000-4000-8000-0000000000f1','TEST 가상계좌 자동 발주확인 창고',0,'{}');
 insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,sid,item,1);
 insert into public.payments(user_id,purpose,ref_id,provider,amount,status,payment_key,idempotency_key)
  values('a0c30000-0000-4000-8000-000000000002','order',oid,'toss',10000,'paid','pk-auto-confirm-va-'||n,'idem-auto-confirm-va-'||n);
 insert into public.payment_attempts(provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,expires_at)
  values('toss','a0c30000-0000-4000-8000-000000000002','order',oid,10000,'approved','attempt-auto-confirm-va-'||n,
   'order-auto-confirm-va-'||n,'product-auto-confirm-va-'||n,paid+interval '1 day')
  returning id into attempt;
 if va then
  insert into private.payment_attempt_virtual_accounts(attempt_id,order_id,provider_payment_key,bank_code,account_number,due_at)
   values(attempt,oid,'pk-auto-confirm-va-'||n,'088','X0000000000'||n,paid+interval '1 day');
 end if;
 insert into private.order_paid_marks(order_id,paid_at) values(oid,paid);
 return oid;
end $$;

-- n번 주문에 입금 되돌림 보류를 남긴다. released가 있으면 재입금 확인으로 풀린 보류다.
create function pg_temp.reversal_hold(oid uuid,released timestamptz) returns void language sql as $$
 insert into private.order_fulfillment_holds(order_id,reason,evidence_key,payment_attempt_id,released_at,release_kind)
 select oid,'deposit_reversed','deposit_reversed:'||a.id||':'||md5(oid::text||coalesce(released::text,'open')),a.id,
  released,case when released is not null then 'deposit_confirmed' end
 from public.payment_attempts a where a.purpose='order' and a.ref_id=oid;
$$;

-- 켠 시각 2031-04-13 10:00, 마감 16:30 (KST) → 가상계좌 기준선 15:30.
update private.auto_order_confirmation_settings set enabled=true,run_time='16:30',enabled_at='2031-04-13 10:00:00+09',revision=1 where singleton;
select pg_temp.paid_order(1,'2031-04-14 15:29:59+09',true) as va_early \gset
select pg_temp.paid_order(2,'2031-04-14 15:30:00+09',true) as va_boundary \gset
select pg_temp.paid_order(3,'2031-04-14 15:30:01+09',true) as va_late \gset
select pg_temp.paid_order(4,'2031-04-14 16:20:00+09',false) as card_late \gset
select pg_temp.paid_order(5,'2031-04-14 10:00:00+09',true) as va_redeposit_late \gset
select pg_temp.paid_order(6,'2031-04-14 09:00:00+09',true) as va_redeposit_early \gset
select pg_temp.paid_order(7,'2031-04-14 10:00:00+09',true) as va_open_reversal \gset
select pg_temp.reversal_hold(:'va_redeposit_late','2031-04-14 16:00:00+09');
select pg_temp.reversal_hold(:'va_redeposit_early','2031-04-14 15:00:00+09');
select pg_temp.reversal_hold(:'va_open_reversal',null);

select 1/case when private.order_virtual_account_deposit_confirmed_at(:'card_late') is null
 and private.order_virtual_account_deposit_confirmed_at(:'va_late')='2031-04-14 15:30:01+09'
 and private.order_virtual_account_deposit_confirmed_at(:'va_redeposit_late')='2031-04-14 16:00:00+09'
 and private.order_virtual_account_deposit_confirmed_at(:'va_redeposit_early')='2031-04-14 15:00:00+09'
 then 1 else 0 end as assert_last_deposit_confirmation;

-- ---------------------------------------------------------------------------
-- 4/14 실행(묶음 2건씩 — 여러 틱에 걸쳐도 같은 마감으로 판정한다)
-- ---------------------------------------------------------------------------
select private.run_auto_order_confirmation('2031-04-14 16:31:00+09',2)->>'status' as batch_one \gset
select private.run_auto_order_confirmation('2031-04-14 17:45:00+09',2)->>'status' as batch_two \gset
select private.run_auto_order_confirmation('2031-04-14 18:00:00+09',2)->>'status' as batch_three \gset
select private.run_auto_order_confirmation('2031-04-14 18:01:00+09',2)->>'status' as batch_four \gset
select 1/case when :'batch_one'='continuing' and :'batch_two'='continuing' and :'batch_three'='continuing' and :'batch_four'='finished'
 then 1 else 0 end as assert_batches_finish;
select 1/case when (select jsonb_object_agg(order_id,outcome) from private.auto_order_confirmation_outcomes
   where run_date='2031-04-14' and order_id in(:'va_early',:'va_boundary',:'va_late',:'card_late',:'va_redeposit_late',:'va_redeposit_early',:'va_open_reversal'))
  =jsonb_build_object(:'va_early','confirmed',:'va_boundary','confirmed',:'va_late','deposit_settling',:'card_late','confirmed',
   :'va_redeposit_late','deposit_settling',:'va_redeposit_early','confirmed',:'va_open_reversal','fulfillment_hold')
 then 1 else 0 end as assert_virtual_account_waits_one_hour;
select 1/case when (select count(*)=4 from public.orders where status='confirmed' and confirmed_at is not null
   and id in(:'va_early',:'va_boundary',:'card_late',:'va_redeposit_early'))
 and (select count(*)=3 from public.orders where status='paid' and id in(:'va_late',:'va_redeposit_late',:'va_open_reversal'))
 then 1 else 0 end as assert_waiting_orders_stay_new;

-- 운영 화면 문서가 새 사유를 싣는다(앱 파서가 아는 값이어야 화면이 깨지지 않는다).
select 1/case when (select count(*)=2 from jsonb_array_elements(private.auto_order_confirmation_document('2031-04-14 18:02:00+09')->'lastExclusions') e
   where e->>'outcome'='deposit_settling' and e->>'orderId' in(:'va_late',:'va_redeposit_late'))
 then 1 else 0 end as assert_screen_document_carries_reason;

-- ---------------------------------------------------------------------------
-- 4/15 실행: 기다린 가상계좌 주문을 확정한다. 열린 되돌림 보류는 계속 빠진다.
-- ---------------------------------------------------------------------------
select private.run_auto_order_confirmation('2031-04-15 16:31:00+09');
select 1/case when (select count(*)=2 from public.orders where status='confirmed' and id in(:'va_late',:'va_redeposit_late'))
 and (select outcome='fulfillment_hold' from private.auto_order_confirmation_outcomes where run_date='2031-04-15' and order_id=:'va_open_reversal')
 and (select status='paid' from public.orders where id=:'va_open_reversal')
 then 1 else 0 end as assert_next_day_confirms_waited_orders;

rollback;
