\set ON_ERROR_STOP on
begin;
-- 10/14 회의 A3b·D7: 무통장 입금코드는 16자리 주문번호에서 만든다. 전부 합성 롤백 데이터다.

-- 1) TS bankTransferDepositCode와 같은 벡터(lib/payments/bank-transfer.test.ts).
select 1/case when array[
  private.bank_transfer_deposit_code_for_number('2026102710000001'),private.bank_transfer_deposit_code_for_number('2026102810123456'),
  private.bank_transfer_deposit_code_for_number('2026103110000001'),private.bank_transfer_deposit_code_for_number('2026110110000001'),
  private.bank_transfer_deposit_code_for_number('2000010110099999')]=array['600001','723456','000001','100001','099999']
 and private.bank_transfer_deposit_code_for_number('2026102720000001') is null
 and private.bank_transfer_legacy_deposit_code('9a3f21c0-1111-4000-8000-000000000abc')='9A3F21C0'
 then 1 else 0 end as assert_code_vectors_match_ts;

-- 2) 연속한 10일의 같은 일련번호도 코드가 다르다(입금 대기는 최대 48시간이라 주문일은 연속한 3일 안이다).
select 1/case when (select count(distinct private.bank_transfer_deposit_code_for_number(to_char(day,'YYYYMMDD')||'10000042'))
  from generate_series(date '2026-10-27',date '2026-11-05',interval '1 day') day)=10
 then 1 else 0 end as assert_ten_day_cycle_is_distinct;

-- 3) 은행 입금자명: 숫자 6자리라 한글 4자 이름과 붙여도 EUC-KR(UHC) 14바이트 안이다.
select 1/case when private.bank_transfer_deposit_code_for_number('2026102710000001') ~ '^[0-9]{6}$'
 and octet_length(convert_to('남궁길동'||private.bank_transfer_deposit_code_for_number('2026102710000001'),'UHC'))<=14
 then 1 else 0 end as assert_depositor_name_fits_bank_limit;

-- 4) 입금 대기 주문 사이 코드가 겹치지 않는다: 자정을 넘긴 사흘(같은 일련번호 포함)과 같은 날 여러 건.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000271501','authenticated','authenticated','deposit-code-buyer@example.test','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000271502','authenticated','authenticated','deposit-code-staff@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000271502';
insert into private.operator_memberships(profile_id,manager_role) values('00000000-0000-4000-8000-000000271502','primary');
insert into public.orders(id,user_id,status,total,address,payment_method,created_at,expires_at)
select ('5'||n||'000000-0000-4000-8000-0000002715'||lpad(n::text,2,'0'))::uuid,'00000000-0000-4000-8000-000000271501','pending',10000+n,
 jsonb_build_object('recipientName','입금 '||n),'bank_transfer',
 case when n<=3 then timestamptz '2031-01-30 23:59:00+09' when n<=6 then timestamptz '2031-01-31 23:59:00+09' else timestamptz '2031-02-01 00:01:00+09' end
  +make_interval(secs=>n),now()+interval '1 day'
from generate_series(1,9) n;
select 1/case when (select count(*)=9 and count(distinct private.bank_transfer_deposit_code(id))=9
   and bool_and(private.bank_transfer_deposit_code(id)=private.bank_transfer_deposit_code_for_number(order_number))
   and count(*) filter(where right(order_number,7)='0000001')=3
  from public.orders where id::text ~ '^5[1-9]000000-0000-4000-8000-0000002715')
 and (select count(*)=count(distinct private.bank_transfer_deposit_code(id)) from public.orders where status='pending' and payment_method='bank_transfer')
 then 1 else 0 end as assert_pending_codes_unique;

-- 5) 입금 제안·미입금 검색은 그 주문에 안내된 코드로 찾는다.
select private.bank_transfer_deposit_code('55000000-0000-4000-8000-000000271505') as new_code \gset
select 1/case when (select order_id from private.suggest_bank_deposit_order('입금 5'||:'new_code',10005))='55000000-0000-4000-8000-000000271505'
 and (select confidence from private.suggest_bank_deposit_order('입금 5 '||:'new_code',99))='code'
 then 1 else 0 end as assert_suggestion_by_issued_code;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000271502',true);
select 1/case when (select array_agg(order_id) from public.admin_unpaid_bank_transfer_orders_console(:'new_code'))=array['55000000-0000-4000-8000-000000271505'::uuid]
 and (select deposit_code from public.admin_unpaid_bank_transfer_orders_console(:'new_code'))=:'new_code'
 then 1 else 0 end as assert_unpaid_search_by_issued_code;
reset role;

-- 6) 전환 시각 전에 만든 주문은 그때 안내받은 옛 코드(UUID 앞 8자리)가 입금코드다. 고객은 자기 무통장 주문의 코드만 읽는다.
insert into public.orders(id,user_id,status,total,address,payment_method,created_at,expires_at) values
 ('a1b2c3d4-0000-4000-8000-000000271590','00000000-0000-4000-8000-000000271501','pending',15000,'{"recipientName":"전환 전"}','bank_transfer',
  (select switched_at from private.bank_transfer_deposit_code_switch)-interval '1 hour',now()+interval '1 day'),
 ('a1b2c3d4-0000-4000-8000-000000271591','00000000-0000-4000-8000-000000271501','pending',16000,'{"recipientName":"카드"}','card',now(),now()+interval '1 day');
select 1/case when private.bank_transfer_deposit_code('a1b2c3d4-0000-4000-8000-000000271590')='A1B2C3D4'
 and (select order_id from private.suggest_bank_deposit_order('전환 전 a1b2c3d4',15000))='a1b2c3d4-0000-4000-8000-000000271590'
 then 1 else 0 end as assert_pre_switch_orders_keep_issued_legacy_code;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000271501',true);
select 1/case when public.get_my_bank_transfer_deposit_code('a1b2c3d4-0000-4000-8000-000000271590')='A1B2C3D4'
 and public.get_my_bank_transfer_deposit_code('55000000-0000-4000-8000-000000271505')=:'new_code'
 and public.get_my_bank_transfer_deposit_code('a1b2c3d4-0000-4000-8000-000000271591') is null
 then 1 else 0 end as assert_owner_reads_issued_code;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000271502',true);
select 1/case when public.get_my_bank_transfer_deposit_code('a1b2c3d4-0000-4000-8000-000000271590') is null then 1 else 0 end as assert_other_user_reads_nothing;
reset role;

-- 6-1) 배포 순서 보호: DB가 먼저 바뀌고 앱이 몇 분 뒤 배포되는 동안 옛 앱은 옛 코드를 안내한다.
--      전환 시각부터 2시간 안에 만든 주문은 입금 제안·미입금 검색이 옛 코드도 받고, 그 뒤 주문은 공식 코드만 받는다.
insert into public.orders(id,user_id,status,total,address,payment_method,created_at,expires_at) values
 ('c0ffee12-0000-4000-8000-000000271592','00000000-0000-4000-8000-000000271501','pending',17000,'{"recipientName":"배포 사이"}','bank_transfer',
  (select switched_at from private.bank_transfer_deposit_code_switch)+interval '30 minutes',now()+interval '1 day'),
 ('c1ffee12-0000-4000-8000-000000271593','00000000-0000-4000-8000-000000271501','pending',18000,'{"recipientName":"구간 뒤"}','bank_transfer',
  (select switched_at from private.bank_transfer_deposit_code_switch)+interval '3 hours',now()+interval '1 day');
select 1/case when private.bank_transfer_deposit_code('c0ffee12-0000-4000-8000-000000271592')
   =private.bank_transfer_deposit_code_for_number((select order_number from public.orders where id='c0ffee12-0000-4000-8000-000000271592'))
 and private.bank_transfer_switch_grace_code('c0ffee12-0000-4000-8000-000000271592')='C0FFEE12'
 and private.bank_transfer_switch_grace_code('c1ffee12-0000-4000-8000-000000271593') is null
 and private.bank_transfer_switch_grace_code('a1b2c3d4-0000-4000-8000-000000271590') is null
 -- 옛 코드로 입금해도(금액이 달라도) 그 주문을 코드로 제안한다.
 and (select order_id from private.suggest_bank_deposit_order('배포 사이 C0FFEE12',99))='c0ffee12-0000-4000-8000-000000271592'
 and (select confidence from private.suggest_bank_deposit_order('배포사이c0ffee12',17000))='code_amount'
 and not exists(select 1 from private.suggest_bank_deposit_order('구간 뒤 C1FFEE12',99))
 then 1 else 0 end as assert_switch_grace_accepts_legacy_code;
select private.bank_transfer_deposit_code('c0ffee12-0000-4000-8000-000000271592') as grace_order_code \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000271502',true);
select 1/case when (select array_agg(order_id) from public.admin_unpaid_bank_transfer_orders_console('c0ffee12'))=array['c0ffee12-0000-4000-8000-000000271592'::uuid]
 and (select array_agg(order_id) from public.admin_unpaid_bank_transfer_orders('C0FFEE12'))=array['c0ffee12-0000-4000-8000-000000271592'::uuid]
 and not exists(select 1 from public.admin_unpaid_bank_transfer_orders_console('C1FFEE12'))
 and (select deposit_code from public.admin_unpaid_bank_transfer_orders_console('c0ffee12'))=:'grace_order_code'
 and (select array_agg(order_id) from public.admin_unpaid_bank_transfer_orders_console(:'grace_order_code'))=array['c0ffee12-0000-4000-8000-000000271592'::uuid]
 then 1 else 0 end as assert_unpaid_search_accepts_grace_legacy_code;
reset role;
-- 옛 코드가 다른 입금 대기 주문의 공식 코드와 겹치면(같은 입금자명에 두 주문이 맞으면) 여전히 제안하지 않는다.
select 1/case when not exists(select 1 from private.suggest_bank_deposit_order('배포 사이 C0FFEE12 '||:'new_code',17000))
 then 1 else 0 end as assert_grace_code_keeps_ambiguity_rule;

-- 7) 오래 남은 입금 대기 주문(예: 결제 확인 필요)과 코드가 겹치면 코드로 제안하지 않고 사람이 고른다.
select day::date as cycle_day from generate_series(date '2036-01-01',date '2036-01-10',interval '1 day') day
 where (day::date - date '2000-01-01') % 10 = 0 limit 1 \gset
insert into public.orders(id,user_id,status,total,address,payment_method,created_at,expires_at) values
 ('b1000000-0000-4000-8000-000000271581','00000000-0000-4000-8000-000000271501','pending',21000,'{"recipientName":"오래 대기"}','bank_transfer',
  (:'cycle_day'::date)::timestamp at time zone 'Asia/Seoul'+interval '10 hours',now()-interval '9 days'),
 ('b2000000-0000-4000-8000-000000271582','00000000-0000-4000-8000-000000271501','pending',22000,'{"recipientName":"새 주문"}','bank_transfer',
  (:'cycle_day'::date+10)::timestamp at time zone 'Asia/Seoul'+interval '10 hours',now()+interval '1 day'),
 ('b3000000-0000-4000-8000-000000271583','00000000-0000-4000-8000-000000271501','pending',23000,'{"recipientName":"전날"}','bank_transfer',
  (:'cycle_day'::date+9)::timestamp at time zone 'Asia/Seoul'+interval '10 hours',now()+interval '1 day');
select private.bank_transfer_deposit_code('b2000000-0000-4000-8000-000000271582') as shared_code \gset
select 1/case when private.bank_transfer_deposit_code('b1000000-0000-4000-8000-000000271581')=:'shared_code' and :'shared_code'='000001'
 and not exists(select 1 from private.suggest_bank_deposit_order('새 주문'||:'shared_code',22000))
 then 1 else 0 end as assert_ambiguous_code_is_not_suggested;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000271502',true);
-- 6자리 코드 검색은 코드가 정확히 같은 주문만 찾는다. 주문번호 일부(…10000001)에 든 숫자로는 찾지 않는다.
select 1/case when (select array_agg(order_id order by order_id) from public.admin_unpaid_bank_transfer_orders_console(:'shared_code'))
   =array['b1000000-0000-4000-8000-000000271581'::uuid,'b2000000-0000-4000-8000-000000271582'::uuid]
 and (select array_agg(order_id) from public.admin_unpaid_bank_transfer_orders_console(
   (select order_number from public.orders where id='b3000000-0000-4000-8000-000000271583')))=array['b3000000-0000-4000-8000-000000271583'::uuid]
 and (select count(*) from public.admin_unpaid_bank_transfer_orders_console(left((select order_number from public.orders where id='b3000000-0000-4000-8000-000000271583'),8)))>=1
 then 1 else 0 end as assert_numeric_search_is_code_exact_or_number_prefix;
reset role;

-- 8) 코드 함수는 서버 내부 전용이고 고객용 조회만 로그인 사용자에게 열린다.
select 1/case when not has_function_privilege('anon','private.bank_transfer_deposit_code(uuid)','execute')
 and not has_function_privilege('authenticated','private.bank_transfer_deposit_code(uuid)','execute')
 and not has_function_privilege('service_role','private.bank_transfer_deposit_code(uuid)','execute')
 and not has_function_privilege('authenticated','private.bank_transfer_deposit_code_for_number(text)','execute')
 and not has_function_privilege('authenticated','private.bank_transfer_legacy_deposit_code(uuid)','execute')
 and not has_function_privilege('authenticated','private.bank_transfer_switch_grace_code(uuid)','execute')
 and has_function_privilege('authenticated','public.get_my_bank_transfer_deposit_code(uuid)','execute')
 and not has_function_privilege('anon','public.get_my_bank_transfer_deposit_code(uuid)','execute')
 then 1 else 0 end as assert_code_functions_private;
rollback;
