\set ON_ERROR_STOP on
begin;

create function pg_temp.expect_error(statement text, expected_message text, expected_code text)
returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if position(expected_message in sqlerrm) = 0 or sqlstate <> expected_code then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %', expected_message;
end $$;

select 1 / case when to_regclass('public.order_cancellation_requests') is not null
  and has_function_privilege('authenticated', 'public.admin_record_order_claim_operational_fee(uuid,text,bigint,text,text,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.admin_record_order_claim_operational_fee(uuid,text,bigint,text,text,timestamptz)', 'execute')
  and not has_column_privilege('authenticated','public.order_cancellation_requests','operational_fee_evidence','select')
  and not has_column_privilege('authenticated','public.order_cancellation_requests','operational_fee_note','select')
  then 1 else 0 end as assert_claim_cost_writer_acl;

insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000049111', 'authenticated', 'authenticated', 'claim-cost-staff@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;
update public.profiles set role = 'staff', nickname = '비용 확인 CS' where id = '00000000-0000-4000-8000-000000049111';
insert into public.verticals(key, label, color) values ('claim-cost-tests', '클레임 비용 검증', '#000000') on conflict (key) do nothing;
insert into public.ips(id, title, vertical_key, published_at)
values ('claim-cost-tests', '클레임 비용 검증', 'claim-cost-tests', now()) on conflict (id) do nothing;
insert into public.goods(id, ip_id, name, type, price, stock, stock_qty, origin_id, shipping_fee_type, individual_fee)
values ('claim-cost-good', 'claim-cost-tests', '클레임 비용 상품', '키링', 1000, 'ok', 1,
  '00000000-0000-4000-8000-000000042201', 'policy', 0) on conflict (id) do nothing;
insert into public.orders(id, user_id, status, total, address)
values ('00000000-0000-4000-8000-000000049112', '00000000-0000-4000-8000-000000049111', 'delivered', 1000, '{}'::jsonb)
on conflict (id) do nothing;
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, reason_type, status, claim_type, stage)
values ('00000000-0000-4000-8000-000000049113', '00000000-0000-4000-8000-000000049112',
  '00000000-0000-4000-8000-000000049111', '반품 비용 확인', 'change_of_mind', 'requested', 'return', 'requested')
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000049111', true);
select public.admin_save_good_claim_policy('claim-cost-good',
  '{"returnAllowed":false,"exchangeAllowed":true,"restrictionReason":"포장 훼손 시 제한","returnFee":0,"exchangeFee":3500}'::jsonb,
  (select updated_at from public.goods where id = 'claim-cost-good')) as saved_good \gset
select 1 / case when exists(select 1 from public.goods where id = 'claim-cost-good'
  and claim_return_allowed = false and claim_exchange_allowed = true and claim_return_fee = 0 and claim_exchange_fee = 3500)
  then 1 else 0 end as assert_product_claim_policy_preserves_null_zero_semantics;

select updated_at as claim_updated_at from public.order_cancellation_requests
 where id = '00000000-0000-4000-8000-000000049113' \gset
select public.admin_record_order_claim_operational_fee(
  '00000000-0000-4000-8000-000000049113', 'return_shipping', 0, '무료 반품 확인', '택배사 회신 문서', :'claim_updated_at'::timestamptz
) as saved_fee \gset
reset role;
select 1 / case when (:'saved_fee'::jsonb->>'amount') = '0'
  and exists(select 1 from public.order_cancellation_requests where id = '00000000-0000-4000-8000-000000049113'
    and operational_fee_amount = 0 and operational_fee_confirmed_by = '00000000-0000-4000-8000-000000049111')
  then 1 else 0 end as assert_operational_fee_audited;
set local role authenticated;

do $$ begin
  begin
    perform public.admin_record_order_claim_operational_fee(
      '00000000-0000-4000-8000-000000049113', 'return_shipping', 1200, '다른 근거', '택배 회신', '2000-01-01T00:00:00Z'::timestamptz
    );
    raise exception 'stale operational fee accepted';
  exception when sqlstate 'PT409' then null;
  end;
end $$;

select 1 / case when not exists(select 1 from public.refunds where payment_id in (select id from public.payments where ref_id = '00000000-0000-4000-8000-000000049112'))
  and (select stage from public.order_cancellation_requests where id = '00000000-0000-4000-8000-000000049113') = 'requested'
  then 1 else 0 end as assert_cost_does_not_refund_or_block_claim;
reset role;
rollback;
