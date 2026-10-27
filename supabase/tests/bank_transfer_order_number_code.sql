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

-- 5) 입금 제안·미입금 검색은 새 코드와 옛 코드(이전에 안내받은 입금)를 모두 받는다.
select private.bank_transfer_deposit_code('55000000-0000-4000-8000-000000271505') as new_code \gset
select private.bank_transfer_legacy_deposit_code('55000000-0000-4000-8000-000000271505') as legacy_code \gset
select 1/case when (select order_id from private.suggest_bank_deposit_order('입금 5'||:'new_code',10005))='55000000-0000-4000-8000-000000271505'
 and (select confidence from private.suggest_bank_deposit_order('입금 5 '||lower(:'legacy_code'),10005))='code_amount'
 and (select order_id from private.suggest_bank_deposit_order('입금 5 '||:'legacy_code',99))='55000000-0000-4000-8000-000000271505'
 then 1 else 0 end as assert_suggestion_accepts_new_and_legacy_codes;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000271502',true);
select 1/case when (select array_agg(order_id) from public.admin_unpaid_bank_transfer_orders_console(:'new_code'))=array['55000000-0000-4000-8000-000000271505'::uuid]
 and (select array_agg(order_id) from public.admin_unpaid_bank_transfer_orders_console(lower(:'legacy_code')))=array['55000000-0000-4000-8000-000000271505'::uuid]
 and (select deposit_code from public.admin_unpaid_bank_transfer_orders_console(:'new_code'))=:'new_code'
 and (select array_agg(order_id) from public.admin_unpaid_bank_transfer_orders(:'legacy_code'))=array['55000000-0000-4000-8000-000000271505'::uuid]
 then 1 else 0 end as assert_unpaid_search_accepts_new_and_legacy_codes;
reset role;

-- 6) 코드 함수는 서버 내부 전용이다.
select 1/case when not has_function_privilege('anon','private.bank_transfer_deposit_code(uuid)','execute')
 and not has_function_privilege('authenticated','private.bank_transfer_deposit_code(uuid)','execute')
 and not has_function_privilege('service_role','private.bank_transfer_deposit_code(uuid)','execute')
 and not has_function_privilege('authenticated','private.bank_transfer_deposit_code_for_number(text)','execute')
 and not has_function_privilege('authenticated','private.bank_transfer_legacy_deposit_code(uuid)','execute')
 then 1 else 0 end as assert_code_functions_private;
rollback;
