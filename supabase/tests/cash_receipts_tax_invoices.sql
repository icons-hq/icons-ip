\set ON_ERROR_STOP on

-- D-3 — 현금영수증 · 세금계산서 (설계서 v2 §1-3)

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-00000000b001', 'authenticated', 'authenticated', 'cash-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-00000000b002', 'authenticated', 'authenticated', 'cash-staff@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-00000000b001', 'cash-buyer@example.test', 'cash_buyer', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-00000000b002', 'cash-staff@example.test', 'cash_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff')
on conflict (id) do update set
  email = excluded.email, nickname = excluded.nickname, birth_date = excluded.birth_date,
  consents = excluded.consents, onboarded_at = excluded.onboarded_at, role = excluded.role;

insert into public.verticals (key, label, color) values ('cash-test', '증빙 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('cash-ip', '증빙 테스트 IP', 'cash-test') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('cash-g1', 'cash-ip', '증빙 테스트 굿즈', '문구', 120000, 'ok', 20)
on conflict (id) do nothing;

insert into public.cart_items (user_id, good_id, qty) values ('00000000-0000-4000-8000-00000000b001', 'cash-g1', 1);
select public.place_order(
  '00000000-0000-4000-8000-00000000b001'::uuid,
  '{"recipientName":"정증빙","phone":"01033334444","postalCode":"06236","address1":"서울특별시 강남구 테헤란로 4","address2":"9층"}'::jsonb,
  '00000000-0000-4000-8000-00000000b010'::uuid
) as cash_order \gset
select set_config('cash.order', :'cash_order', true);
update public.orders set status = 'paid', payment_method = 'bank_transfer', confirmed_at = now()
where id = current_setting('cash.order')::uuid;

-- ---------------------------------------------------------------------------
-- A. 의무발행 대상 — 증빙이 없는 현금성 거래가 목록에 뜬다
-- ---------------------------------------------------------------------------
select 1 / case when (
  select mandatory from public.cash_receipt_pending_view where order_id = current_setting('cash.order')::uuid
) then 1 else 0 end as assert_pending_view_flags_mandatory_orders;

-- ---------------------------------------------------------------------------
-- B. 발급 신청 — 식별번호 원문은 원장에 남지 않는다
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b002', true);

select public.admin_request_cash_receipt(
  current_setting('cash.order')::uuid, 'income_deduction', '010-3333-4444'
) as receipt \gset
reset role;
select set_config('cash.receipt', :'receipt', true);

select 1 / case when (
  (select status from public.cash_receipts where id = current_setting('cash.receipt')::uuid) = 'queued'
  and (select identity_masked from public.cash_receipts where id = current_setting('cash.receipt')::uuid) = '*******4444'
  -- 원문은 private 표에만 있다.
  and (select identity_number from private.cash_receipt_identities where receipt_id = current_setting('cash.receipt')::uuid) = '01033334444'
  -- 발급 대기가 생기면 의무발행 목록에서 빠진다.
  and not exists (select 1 from public.cash_receipt_pending_view where order_id = current_setting('cash.order')::uuid)
) then 1 else 0 end as assert_request_masks_identity_and_clears_pending;

-- 한 주문에 살아 있는 영수증은 하나다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b002', true);
do $$
begin
  perform public.admin_request_cash_receipt(current_setting('cash.order')::uuid, 'income_deduction', '010-3333-4444');
  raise exception 'duplicate active receipt must fail';
exception when others then
  if sqlerrm <> 'cash_receipt_already_active' then raise; end if;
end $$;

-- 세금계산서 신청이 있으면 현금영수증을 낼 수 없다(같은 거래에 증빙은 하나다).
do $$
begin
  perform public.admin_record_tax_invoice_request(
    current_setting('cash.order')::uuid, '123-45-67890', '테스트 상사', '김대표', 'biz@example.test'
  );
  raise exception 'tax invoice must not coexist with a cash receipt';
exception when others then
  if sqlerrm <> 'cash_receipt_exists' then raise; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- C. 발급 결과 — 워커가 적고, 그 순간 원문 번호가 사라진다
-- ---------------------------------------------------------------------------
select public.record_cash_receipt_result(
  current_setting('cash.receipt')::uuid, 'issued', 'RK-TEST-1', '123456789', 'https://example.test/receipt', null, null
);
select 1 / case when (
  (select status from public.cash_receipts where id = current_setting('cash.receipt')::uuid) = 'issued'
  and (select issued_at from public.cash_receipts where id = current_setting('cash.receipt')::uuid) is not null
  and (select count(*) from private.cash_receipt_identities where receipt_id = current_setting('cash.receipt')::uuid) = 0
) then 1 else 0 end as assert_issue_records_and_forgets_identity;

-- 취소하면 다시 발급할 수 있다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b002', true);
select public.admin_cancel_cash_receipt(current_setting('cash.receipt')::uuid, '주문 취소') as canceled \gset
select public.admin_request_cash_receipt(
  current_setting('cash.order')::uuid, 'self_issued', null
) as reissued \gset
reset role;
select set_config('cash.reissued', :'reissued', true);
select 1 / case when :'canceled' = 'canceled'
  -- 자진발급은 국세청 지정번호로 나간다. 상대 번호를 받지 않았다는 사실이 그대로 보인다.
  and (select identity_masked from public.cash_receipts where id = current_setting('cash.reissued')::uuid) = '*******1234'
  and (select kind from public.cash_receipts where id = current_setting('cash.reissued')::uuid)::text = 'self_issued'
  then 1 else 0 end as assert_cancel_allows_reissue;

-- ---------------------------------------------------------------------------
-- D. 세금계산서 — 신청 → 승인 → 발행 기록(승인번호는 사람이 적는다)
-- ---------------------------------------------------------------------------
insert into public.cart_items (user_id, good_id, qty) values ('00000000-0000-4000-8000-00000000b001', 'cash-g1', 1);
select public.place_order(
  '00000000-0000-4000-8000-00000000b001'::uuid,
  '{"recipientName":"정증빙","phone":"01033334444","postalCode":"06236","address1":"서울특별시 강남구 테헤란로 4","address2":"9층"}'::jsonb,
  '00000000-0000-4000-8000-00000000b011'::uuid
) as invoice_order \gset
select set_config('cash.invoice_order', :'invoice_order', true);
update public.orders set status = 'paid', payment_method = 'bank_transfer' where id = current_setting('cash.invoice_order')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b002', true);
select public.admin_record_tax_invoice_request(
  current_setting('cash.invoice_order')::uuid, '123-45-67890', '테스트 상사', '김대표', 'biz@example.test'
) as invoice \gset
select set_config('cash.invoice', :'invoice', true);

-- 승인 전에는 승인번호를 적을 수 없다. 발행은 스마트빌에서 사람이 하고 우리는 결과만 받는다.
do $$
begin
  perform public.admin_record_tax_invoice_issued(current_setting('cash.invoice')::uuid, 'AP-0001', null);
  raise exception 'issued must require approval first';
exception when others then
  if sqlerrm <> 'tax_invoice_not_approved' then raise; end if;
end $$;

select public.admin_decide_tax_invoice(current_setting('cash.invoice')::uuid, 'approve', '사업자 확인 완료') as decided \gset
select public.admin_record_tax_invoice_issued(current_setting('cash.invoice')::uuid, 'AP-0001', null) as issued \gset
reset role;

select 1 / case when :'decided' = 'approved' and :'issued' = 'issued'
  and (select business_number from public.tax_invoice_requests where id = current_setting('cash.invoice')::uuid) = '1234567890'
  and (select approval_number from public.tax_invoice_requests where id = current_setting('cash.invoice')::uuid) = 'AP-0001'
  -- 세금계산서를 신청한 주문은 현금영수증 의무발행 목록에 뜨지 않는다.
  and not exists (select 1 from public.cash_receipt_pending_view where order_id = current_setting('cash.invoice_order')::uuid)
  then 1 else 0 end as assert_tax_invoice_flow;

-- 승인번호는 유일하다 — 같은 번호가 두 건에 붙으면 어느 쪽이 진짜인지 알 수 없다.
-- 표 직접 삽입은 스태프 역할 밖에서 한다(표 자체에는 쓰기 권한이 없다).
insert into public.tax_invoice_requests (order_id, business_number, business_name, status)
values (current_setting('cash.order')::uuid, '9876543210', '다른 상사', 'approved')
returning id as other_invoice \gset
select set_config('cash.other_invoice', :'other_invoice', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b002', true);
do $$
begin
  perform public.admin_record_tax_invoice_issued(current_setting('cash.other_invoice')::uuid, 'AP-0001', null);
  raise exception 'approval number must be unique';
exception when others then
  if sqlerrm <> 'approval_number_taken' then raise; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- E. 권한 — 워커 함수는 service_role 만, 발급 신청은 스태프만
-- ---------------------------------------------------------------------------
select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_request_cash_receipt(uuid,public.cash_receipt_kind,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_request_cash_receipt(uuid,public.cash_receipt_kind,text)', 'execute')
  and has_function_privilege('service_role', 'public.record_cash_receipt_result(uuid,public.cash_receipt_status,text,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_cash_receipt_result(uuid,public.cash_receipt_status,text,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.consume_cash_receipt_identity(uuid)', 'execute')
  and not has_table_privilege('authenticated', 'private.cash_receipt_identities', 'select')
  and not has_table_privilege('anon', 'public.cash_receipts', 'select')
) then 1 else 0 end as assert_cash_receipt_acl;

rollback;
