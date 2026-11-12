\set ON_ERROR_STOP on
-- 반품배송비 차감(QNA-033, ADR-0031). 한 트랜잭션 안에서 합성 주문을 만들고 끝에 되돌린다 — 실결제·결제사 호출 없음.
--  1. 스위치 OFF: 판정·화면 필드·일괄 금액·환불 원장·알림이 지금과 같다(결정 행 없음).
--  2. 스위치 ON(편도 3,000원): 단순 변심 반품 카드 결제 30,000원 → 접수 때 차감 3,000원·환불 27,000원 결정, 원장 27,000원,
--     부분 취소 확인 없이 finalizer가 확정하지 않고, 확인 뒤 환불 원장·결제·결정이 27,000원으로 맞는다.
--  3. 최초 무료배송 왕복(착불로 첫 배송비를 냈으면 편도), 정기배송 결제는 차감 없음, 하자 사유 없음, 나이스페이·결제액 이하 차감은 판정만(전액), 부분 취소 불가 → 전액 환불로 돌림.
--  4. 무통장 반품: 송금 대기 금액·송금 목록·계좌 열람 판정이 27,000원.
--  5. 배송비 청구 이중 청구 방지, 결정 불변, 스위치 감사·삭제 금지.
begin;
create function pg_temp.rd_id(kind text, n integer) returns uuid language sql immutable as $$select md5('refund-deduction:'||kind||':'||n)::uuid$$;
create function pg_temp.rd_error(q text, expected text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if sqlstate = expected or sqlerrm = expected then return; end if; raise; end;
 raise exception 'Expected refund deduction rejection: %', expected; end $$;
create function pg_temp.rd_auth(actor integer default 1) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub', '', true);
 perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.rd_id('user', actor),
  'session_id', pg_temp.rd_id('session', actor))::text, true);
end $$;
grant execute on function pg_temp.rd_id(text, integer), pg_temp.rd_error(text, text), pg_temp.rd_auth(integer) to authenticated, service_role;

insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
 select pg_temp.rd_id('user', n), 'authenticated', 'authenticated', 'refund-deduction-'||n||'@example.test', clock_timestamp(), '{}', '{}' from generate_series(1, 3) n;
insert into auth.sessions(id, user_id, created_at, updated_at)
 select pg_temp.rd_id('session', n), pg_temp.rd_id('user', n), clock_timestamp(), clock_timestamp() from generate_series(1, 3) n;
update public.profiles set nickname = 'TEST 반품배송비 '||right(id::text, 6),
 role = case when id = pg_temp.rd_id('user', 1) then 'admin'::public.user_role else 'user'::public.user_role end
 where id in (select pg_temp.rd_id('user', n) from generate_series(1, 3) n);
insert into private.operator_memberships(profile_id, manager_role) values (pg_temp.rd_id('user', 1), 'primary');
insert into public.fulfillment_origins(id, code, name, default_carrier, base_fee, return_address, is_active)
 values (pg_temp.rd_id('origin', 1), 'refund-deduction-origin', 'TEST 반품배송비 출고지', 'hanjin', 3000, 'TEST 반품 주소', true);
insert into public.ips(id, title, vertical_key) values ('refund-deduction-ip', 'TEST 반품배송비 IP', 'character');
insert into public.goods(id, ip_id, name, type, price, stock, stock_qty, origin_id)
 select 'refund-deduction-good-'||n, 'refund-deduction-ip', 'TEST 반품배송비 상품 '||n, '문구', 13500, 'ok', 10, pg_temp.rd_id('origin', 1)
 from generate_series(1, 9) n;

-- 주문 n: 1 토스 30,000원(배송비 3,000원) · 2 토스 무료배송 30,000원 · 3 토스 하자 반품 · 4 무통장 30,000원
--         5 나이스페이 · 6 토스 3,000원(차감 ≥ 결제액) · 7 토스(스위치 OFF 때 접수) · 8 토스(부분 취소 불가로 전액 환불)
insert into public.orders(id, user_id, status, total, shipping_fee, address, payment_method, created_at, delivered_at)
 select pg_temp.rd_id('order', n), pg_temp.rd_id('user', 2), 'delivered'::public.order_status,
  case when n = 6 then 3000 else 30000 end, case when n = 2 then 0 else 3000 end,
  '{"recipientName":"TEST 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
  (case when n = 4 then 'bank_transfer' else 'card' end)::public.order_payment_method,
  clock_timestamp() - interval '3 days', clock_timestamp() - interval '1 day' from generate_series(1, 8) n;
insert into public.order_items(id, order_id, good_id, variant_id, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot, qty, unit_price)
 select pg_temp.rd_id('item', n), pg_temp.rd_id('order', n), 'refund-deduction-good-'||n, v.id, 'TEST 반품배송비 상품', '문구', 'refund-deduction-ip', 2, 13500
 from generate_series(1, 8) n join public.goods_variants v on v.good_id = 'refund-deduction-good-'||n and v.is_default;
create function pg_temp.rd_shipments(n integer) returns void language plpgsql as $$declare lines jsonb; quote jsonb; begin
 select jsonb_agg(jsonb_build_object('origin_id', origin_id_snapshot, 'good_id', good_id, 'qty', qty, 'unit_price', unit_price,
  'fee_type', shipping_fee_type_snapshot, 'individual_fee', individual_fee_snapshot)) into lines
 from public.order_items where order_id = pg_temp.rd_id('order', n);
 quote := private.apply_shipping_region_quote(private.calculate_goods_shipping(lines), lines, '{"postalCode":"12345","address1":"TEST 합성 주소"}', clock_timestamp());
 -- 합성 주문의 배송비(무료배송 0원·편도 3,000원)를 배송 묶음 하나에 그대로 싣는다.
 update public.orders set shipping_fee_breakdown = jsonb_build_array(jsonb_set(quote->'groups'->0, '{totalFee}', to_jsonb(shipping_fee)))
  where id = pg_temp.rd_id('order', n);
 perform private.create_order_shipments(pg_temp.rd_id('order', n)); end $$;
select pg_temp.rd_shipments(n) from generate_series(1, 8) n;
insert into public.payments(id, user_id, provider, purpose, ref_id, amount, status, payment_key, idempotency_key, created_at)
 select pg_temp.rd_id('payment', n), pg_temp.rd_id('user', 2),
  (case when n = 4 then 'bank_transfer' when n = 5 then 'nicepay' else 'toss' end)::public.payment_provider,
  'order', pg_temp.rd_id('order', n), case when n = 6 then 3000 else 30000 end, 'paid'::public.payment_status,
  case when n = 4 then 'bank_transfer:'||pg_temp.rd_id('order', n) else 'TEST-RD-KEY-'||n end, 'refund-deduction-test-'||n,
  clock_timestamp() - interval '3 days' from generate_series(1, 8) n;
insert into public.payment_attempts(id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key, provider_order_id, provider_product_code, payment_id, expires_at)
 values (pg_temp.rd_id('attempt', 4), 'bank_transfer', pg_temp.rd_id('user', 2), 'order', pg_temp.rd_id('order', 4), 30000, 'KRW', 'approved',
  'refund-deduction-attempt-4', 'TEST-RD-ORDER-4', 'TEST-RD-PRODUCT-4', pg_temp.rd_id('payment', 4), clock_timestamp() + interval '1 hour');
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, reason_type, claim_type, stage, collection_policy, collected_at, requested_at)
 select pg_temp.rd_id('claim', n), pg_temp.rd_id('order', n), pg_temp.rd_id('user', 2), 'TEST 반품배송비 차감 검증',
  case when n = 3 then 'defect' else 'change_of_mind' end, 'return', 'collected', 'legacy',
  clock_timestamp() - interval '30 minutes', clock_timestamp() - interval '2 days' from generate_series(1, 8) n;
insert into private.claim_refund_accounts(claim_id, bank_name, account_number, account_holder, masked_account, masked_holder)
 values (pg_temp.rd_id('claim', 4), 'TEST 합성은행', '000000005678', 'TEST 합성구매자', 'TEST 합성은행 ********5678', 'T*********');

create function pg_temp.rd_file(n integer, method text default 'pg_cancel') returns text language sql as $$
 select public.admin_record_order_claim_refund(pg_temp.rd_id('claim', n), method, 'filed', null);$$;
create function pg_temp.rd_bank(operation integer, kind text) returns jsonb language plpgsql as $$
declare revision integer; begin
 revision := (public.admin_bank_transfer_refund_context(pg_temp.rd_id('order', 4), pg_temp.rd_id('claim', 4), pg_temp.rd_id('user', 1), pg_temp.rd_id('session', 1))->>'revision')::integer;
 return public.admin_record_bank_transfer_refund(pg_temp.rd_id('order', 4), pg_temp.rd_id('claim', 4), pg_temp.rd_id('operation', operation), kind, revision, 30000,
  clock_timestamp(), 'TEST 증빙', 'TEST-ONLY 합성 금융 검증. 실제 송금 없음.', true, pg_temp.rd_id('user', 1), pg_temp.rd_id('session', 1)); end $$;
grant execute on function pg_temp.rd_file(integer, text), pg_temp.rd_bank(integer, text) to authenticated;

-- 1. 스위치 OFF ---------------------------------------------------------------------------------------------------------
select 1/case when (select not enabled and one_way_amount is null and revision = 1 from private.return_fee_deduction_settings)
 and private.return_fee_deduction_plan(pg_temp.rd_id('claim', 1)) is null
 and private.claim_refund_deduction_field(pg_temp.rd_id('claim', 1)) = '{}'::jsonb
 and public.get_return_fee_deduction_policy() = '{"enabled": false, "oneWayAmount": null}'::jsonb
 then 1 else 0 end as switch_off_by_default;

set local role authenticated;
select pg_temp.rd_auth();
select 1/case when not (public.admin_order_claim_detail(pg_temp.rd_id('claim', 1)) ? 'refundDeduction')
 and not (public.admin_bank_transfer_refund_context(pg_temp.rd_id('order', 4), pg_temp.rd_id('claim', 4), pg_temp.rd_id('user', 1), pg_temp.rd_id('session', 1)) ? 'refundDeduction')
 and (select (row->>'refundAmount')::bigint = 30000 and not (row ? 'refundDeduction')
   from jsonb_array_elements(public.admin_order_claim_bulk_context(array[pg_temp.rd_id('claim', 1)])) row)
 then 1 else 0 end as switch_off_documents_unchanged;
select pg_temp.rd_file(7);
reset role;
select 1/case when (select amount = 30000 and status = 'requested' from public.refunds where payment_id = pg_temp.rd_id('payment', 7))
 and not exists(select 1 from private.claim_refund_deductions where claim_id = pg_temp.rd_id('claim', 7))
 and (select body = '환불 절차를 시작했습니다. 결제사 취소가 확인되면 다시 알려드립니다.' from public.notifications
   where source_id = pg_temp.rd_id('claim', 7)::text order by created_at desc limit 1)
 and not exists(select 1 from public.audit_log where target = 'order:'||pg_temp.rd_id('order', 7) and diff ? 'refundDeduction')
 then 1 else 0 end as switch_off_filing_full_amount;
select public.complete_order_cancellation_request(pg_temp.rd_id('claim', 7), array['TEST-RD-KEY-7'], pg_temp.rd_id('user', 1));
select 1/case when (select amount = 30000 and status = 'done' from public.refunds where payment_id = pg_temp.rd_id('payment', 7))
 and (select status = 'refunded' from public.payments where id = pg_temp.rd_id('payment', 7))
 and (select body = '결제 금액 전액을 결제사에서 취소했습니다. 카드사 처리 일정에 따라 환급 반영 시점이 다를 수 있습니다.'
   from public.notifications where source_id = pg_temp.rd_id('claim', 7)::text and title = '결제 취소가 완료됐어요')
 then 1 else 0 end as switch_off_completion_full_amount;

-- 2. 스위치 켜기(운영에서는 후속 migration) -----------------------------------------------------------------------------
select pg_temp.rd_error('update private.return_fee_deduction_settings set enabled = true where singleton', '23514');
update private.return_fee_deduction_settings set enabled = true, one_way_amount = 3000, evidence = 'TEST 배송·반품 정책 개정 공지',
 enabled_at = clock_timestamp() where singleton;
select pg_temp.rd_error('delete from private.return_fee_deduction_settings where singleton', 'return_fee_deduction_settings_required');
select 1/case when (select revision = 2 from private.return_fee_deduction_settings)
 and exists(select 1 from public.audit_log where action = 'system.return_fee_deduction.settings_changed'
   and diff#>>'{after,enabled}' = 'true' and diff#>>'{after,one_way_amount}' = '3000' and diff#>>'{before,enabled}' = 'false')
 and public.get_return_fee_deduction_policy() = '{"enabled": true, "oneWayAmount": 3000}'::jsonb
 then 1 else 0 end as switch_on_audited;

select 1/case when private.return_fee_deduction_plan(pg_temp.rd_id('claim', 1)) @> '{"applicable": true, "basis": "one_way", "deductionAmount": 3000, "paymentAmount": 30000, "refundAmount": 27000}'
 and private.return_fee_deduction_plan(pg_temp.rd_id('claim', 2)) @> '{"applicable": true, "basis": "round_trip", "deductionAmount": 6000, "refundAmount": 24000}'
 and private.return_fee_deduction_plan(pg_temp.rd_id('claim', 3)) is null
 and private.claim_refund_deduction_view(pg_temp.rd_id('claim', 3)) is null
 and private.return_fee_deduction_plan(pg_temp.rd_id('claim', 5)) @> '{"applicable": false, "reason": "partial_cancel_unsupported", "refundAmount": 30000}'
 and private.return_fee_deduction_plan(pg_temp.rd_id('claim', 6)) @> '{"applicable": false, "reason": "fee_exceeds_payment", "refundAmount": 3000}'
 and private.claim_refund_deduction_view(pg_temp.rd_id('claim', 7)) is null
 then 1 else 0 end as plans_follow_reason_provider_and_amount;

set local role authenticated;
select pg_temp.rd_auth();
select 1/case when public.admin_order_claim_detail(pg_temp.rd_id('claim', 1))->'refundDeduction' @> '{"source": "plan", "applicable": true, "deductionAmount": 3000, "refundAmount": 27000}'
 and not (public.admin_order_claim_detail(pg_temp.rd_id('claim', 3)) ? 'refundDeduction')
 and (select (row->>'refundAmount')::bigint = 27000 and row->'refundDeduction' @> '{"deductionAmount": 3000}'
   from jsonb_array_elements(public.admin_order_claim_bulk_context(array[pg_temp.rd_id('claim', 1)])) row)
 and (select (row->>'refundAmount')::bigint = 30000
   from jsonb_array_elements(public.admin_order_claim_bulk_context(array[pg_temp.rd_id('claim', 3)])) row)
 then 1 else 0 end as admin_documents_show_plan_before_filing;

-- 3. 카드 단순 변심 반품: 접수 때 결정, 부분 취소 확인 뒤에만 확정 ---------------------------------------------------------
select pg_temp.rd_file(1);
select pg_temp.rd_file(3);
select pg_temp.rd_file(8);
reset role;
select 1/case when (select state = 'planned' and deduction_amount = 3000 and refund_amount = 27000 and basis = 'one_way'
   and decided_by = pg_temp.rd_id('user', 1) from private.claim_refund_deductions where claim_id = pg_temp.rd_id('claim', 1))
 and (select amount = 27000 and status = 'requested' from public.refunds where payment_id = pg_temp.rd_id('payment', 1))
 and (select amount = 30000 from public.refunds where payment_id = pg_temp.rd_id('payment', 3))
 and not exists(select 1 from private.claim_refund_deductions where claim_id = pg_temp.rd_id('claim', 3))
 and exists(select 1 from public.audit_log where action = 'admin.order.claim_refund_deduction_decided' and diff->>'claimId' = pg_temp.rd_id('claim', 1)::text)
 and exists(select 1 from public.audit_log where action = 'admin.order.claim_refund_filed' and target = 'order:'||pg_temp.rd_id('order', 1)
   and diff#>>'{refundDeduction,refundAmount}' = '27000')
 and (select body like '%결제 금액 30,000원에서 반품배송비 3,000원을 뺀 27,000원을 환불합니다%' from public.notifications
   where source_id = pg_temp.rd_id('claim', 1)::text order by created_at desc limit 1)
 then 1 else 0 end as filing_decides_deduction_once;
select pg_temp.rd_error('update private.claim_refund_deductions set refund_amount = 28000, deduction_amount = 2000 where claim_id = pg_temp.rd_id(''claim'', 1)', 'refund_deduction_immutable');
select pg_temp.rd_error('delete from private.claim_refund_deductions where claim_id = pg_temp.rd_id(''claim'', 1)', 'refund_deduction_immutable');

-- 배송비 청구와 이중으로 받지 않는다.
update private.claim_fee_policy set enabled = true where singleton;
select 1/case when (private.claim_fee_document(pg_temp.rd_id('claim', 1), pg_temp.rd_id('user', 1), true)->>'canIssue')::boolean = false
 and (private.claim_fee_document(pg_temp.rd_id('claim', 3), pg_temp.rd_id('user', 1), true)->>'canIssue')::boolean = true
 then 1 else 0 end as deduction_blocks_second_fee_invoice;

-- 부분 취소 확인 없이는 finalizer가 확정하지 않는다.
select pg_temp.rd_error(format('select public.complete_order_cancellation_request(%L, array[''TEST-RD-KEY-1''], %L)', pg_temp.rd_id('claim', 1), pg_temp.rd_id('user', 1)), 'refund_deduction_evidence_required');
set local role service_role;
select pg_temp.rd_error(format('select public.service_record_order_claim_partial_refund(%L, %L, 30000, ''TEST-RD-KEY-1'', ''TX-1'', %L)', pg_temp.rd_id('claim', 1), pg_temp.rd_id('payment', 1), pg_temp.rd_id('user', 1)), 'refund_deduction_evidence_mismatch');
select pg_temp.rd_error(format('select public.service_record_order_claim_partial_refund(%L, %L, 27000, ''OTHER-KEY'', ''TX-1'', %L)', pg_temp.rd_id('claim', 1), pg_temp.rd_id('payment', 1), pg_temp.rd_id('user', 1)), 'refund_deduction_evidence_mismatch');
select pg_temp.rd_error(format('select public.service_record_order_claim_partial_refund(%L, %L, 27000, ''TEST-RD-KEY-1'', ''TX-1'', %L)', pg_temp.rd_id('claim', 1), pg_temp.rd_id('payment', 1), pg_temp.rd_id('user', 2)), '42501');
select 1/case when public.service_record_order_claim_partial_refund(pg_temp.rd_id('claim', 1), pg_temp.rd_id('payment', 1), 27000, 'TEST-RD-KEY-1', 'TX-PARTIAL-1', pg_temp.rd_id('user', 1)) = 'provider_confirmed'
 then 1 else 0 end as partial_cancel_evidence_recorded;
-- 같은 확인의 재전송(오케스트레이터 재시도)은 같은 결과다. STABLE 읽기는 앞 문장의 기록을 보도록 문장을 나눈다.
select 1/case when public.service_record_order_claim_partial_refund(pg_temp.rd_id('claim', 1), pg_temp.rd_id('payment', 1), 27000, 'TEST-RD-KEY-1', 'TX-PARTIAL-1', pg_temp.rd_id('user', 1)) = 'provider_confirmed'
 then 1 else 0 end as partial_cancel_evidence_is_idempotent;
select 1/case when public.service_order_claim_refund_deduction(pg_temp.rd_id('claim', 1)) @> '{"state": "provider_confirmed", "refundAmount": 27000, "deductionAmount": 3000}'
 then 1 else 0 end as service_reads_confirmed_decision;
select pg_temp.rd_error(format('select public.service_fallback_order_claim_refund_deduction(%L, %L, %L)', pg_temp.rd_id('claim', 1), pg_temp.rd_id('payment', 1), pg_temp.rd_id('user', 1)), 'refund_deduction_already_confirmed');
select public.complete_order_cancellation_request(pg_temp.rd_id('claim', 1), array['TEST-RD-KEY-1'], pg_temp.rd_id('user', 1));
reset role;
set local role authenticated;
select pg_temp.rd_auth();
select public.admin_record_order_claim_refund(pg_temp.rd_id('claim', 1), 'pg_cancel', 'completed', null);
reset role;
select 1/case when (select amount = 27000 and status = 'done' and method = 'pg_cancel' and completed_at is not null from public.refunds where payment_id = pg_temp.rd_id('payment', 1))
 and (select status = 'refunded' and amount = 30000 from public.payments where id = pg_temp.rd_id('payment', 1))
 and (select status = 'canceled' from public.orders where id = pg_temp.rd_id('order', 1))
 and (select state = 'applied' and applied_at is not null and provider_transaction_key = 'TX-PARTIAL-1' from private.claim_refund_deductions where claim_id = pg_temp.rd_id('claim', 1))
 and (select body = '결제 금액 30,000원 가운데 반품배송비 3,000원을 뺀 27,000원을 결제사에서 취소했습니다. 카드 부분 취소는 카드사 처리에 영업일 기준 3~4일이 걸릴 수 있습니다.'
   from public.notifications where source_id = pg_temp.rd_id('claim', 1)::text and title = '결제 취소가 완료됐어요')
 and exists(select 1 from public.audit_log where action = 'admin.order.cancellation_completed' and target = 'order:'||pg_temp.rd_id('order', 1)
   and diff#>>'{refundDeduction,state}' = 'applied')
 and exists(select 1 from public.audit_log where action = 'admin.order.claim_refund_completed' and target = 'order:'||pg_temp.rd_id('order', 1)
   and diff#>>'{refundDeduction,refundAmount}' = '27000')
 and (select sum(r.amount) = 27000 from public.refunds r where r.payment_id = pg_temp.rd_id('payment', 1) and r.status = 'done')
 then 1 else 0 end as card_partial_refund_ledger_matches_provider;

-- 구매자 주문 상세: 본인 주문만.
set local role authenticated;
select pg_temp.rd_auth(2);
select 1/case when public.get_my_order_claim_refund_deduction(pg_temp.rd_id('order', 1)) @> '{"state": "applied", "paymentAmount": 30000, "deductionAmount": 3000, "refundAmount": 27000, "basis": "one_way"}'
 and public.get_my_order_claim_refund_deduction(pg_temp.rd_id('order', 3)) is null
 then 1 else 0 end as buyer_reads_own_deduction;
select pg_temp.rd_auth(3);
select 1/case when public.get_my_order_claim_refund_deduction(pg_temp.rd_id('order', 1)) is null then 1 else 0 end as other_user_reads_nothing;
reset role;

-- 부분 취소를 받지 않는 결제는 돈이 움직이기 전에 전액 환불로 돌린다.
set local role service_role;
select 1/case when public.service_fallback_order_claim_refund_deduction(pg_temp.rd_id('claim', 8), pg_temp.rd_id('payment', 8), pg_temp.rd_id('user', 1)) = 'not_applied'
 and public.service_fallback_order_claim_refund_deduction(pg_temp.rd_id('claim', 8), pg_temp.rd_id('payment', 8), pg_temp.rd_id('user', 1)) = 'not_applied'
 then 1 else 0 end as fallback_is_idempotent;
select pg_temp.rd_error(format('select public.service_record_order_claim_partial_refund(%L, %L, 27000, ''TEST-RD-KEY-8'', null, %L)', pg_temp.rd_id('claim', 8), pg_temp.rd_id('payment', 8), pg_temp.rd_id('user', 1)), 'refund_deduction_not_planned');
select public.complete_order_cancellation_request(pg_temp.rd_id('claim', 8), array['TEST-RD-KEY-8'], pg_temp.rd_id('user', 1));
reset role;
select 1/case when (select state = 'not_applied' and not_applied_reason = 'partial_cancel_unavailable' from private.claim_refund_deductions where claim_id = pg_temp.rd_id('claim', 8))
 and (select amount = 30000 and status = 'done' from public.refunds where payment_id = pg_temp.rd_id('payment', 8))
 and private.claim_refund_deduction_view(pg_temp.rd_id('claim', 8)) @> '{"state": "not_applied", "applicable": false, "reason": "partial_cancel_unavailable", "refundAmount": 30000}'
 and (private.claim_fee_document(pg_temp.rd_id('claim', 8), pg_temp.rd_id('user', 1), true)->>'canIssue')::boolean is distinct from true
 and (select body = '결제 금액 전액을 결제사에서 취소했습니다. 카드사 처리 일정에 따라 환급 반영 시점이 다를 수 있습니다.'
   from public.notifications where source_id = pg_temp.rd_id('claim', 8)::text and title = '결제 취소가 완료됐어요')
 then 1 else 0 end as unavailable_partial_cancel_refunds_in_full;

-- 4. 무통장 단순 변심 반품: 송금액 = 결제액 − 차감액 ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.rd_auth();
select 1/case when public.admin_bank_transfer_refund_context(pg_temp.rd_id('order', 4), pg_temp.rd_id('claim', 4), pg_temp.rd_id('user', 1), pg_temp.rd_id('session', 1))
   @> '{"amount": 30000, "refundDeduction": {"source": "plan", "applicable": true, "refundAmount": 27000, "deductionAmount": 3000}}'
 then 1 else 0 end as bank_context_shows_transfer_amount;
select pg_temp.rd_bank(41, 'file_transfer');
select pg_temp.rd_bank(42, 'confirm_cancellation');
select 1/case when exists(select 1 from jsonb_array_elements(public.admin_list_bank_transfer_refunds_numbered(100, 0)->'rows') row
   where row->>'claimId' = pg_temp.rd_id('claim', 4)::text and (row->>'amount')::bigint = 27000)
 and public.admin_bank_transfer_refund_context(pg_temp.rd_id('order', 4), pg_temp.rd_id('claim', 4), pg_temp.rd_id('user', 1), pg_temp.rd_id('session', 1))
   @> '{"phase": "awaiting_transfer", "refundDeduction": {"source": "decision", "state": "planned", "refundAmount": 27000}}'
 then 1 else 0 end as bank_pending_queue_amount_after_deduction;
reset role;
select 1/case when (select amount = 27000 and state = 'awaiting_transfer' from private.bank_transfer_claim_refunds where claim_id = pg_temp.rd_id('claim', 4))
 and (select amount = 27000 and status = 'awaiting_transfer' and method = 'bank_transfer' from public.refunds where payment_id = pg_temp.rd_id('payment', 4))
 and (select status = 'canceled' from public.orders where id = pg_temp.rd_id('order', 4))
 and (select body like '%반품배송비 3,000원을 뺀 27,000원을 등록하신 환불계좌로 송금하도록 접수했습니다.%' from public.notifications
   where source_id = pg_temp.rd_id('claim', 4)::text and title = '환불 접수가 완료됐어요')
 then 1 else 0 end as bank_ledger_and_lifecycle_use_transfer_amount;
-- 송금 엑셀(T03)의 계좌 열람 판정도 같은 송금액을 기준으로 한다.
set local role service_role;
select 1/case when (public.service_export_bank_transfer_refund_accounts(pg_temp.rd_id('user', 1), pg_temp.rd_id('session', 1), pg_temp.rd_id('export', 1),
   jsonb_build_array(jsonb_build_object('claimId', pg_temp.rd_id('claim', 4), 'orderId', pg_temp.rd_id('order', 4),
    'revision', (select claim_revision from public.order_cancellation_requests where id = pg_temp.rd_id('claim', 4)))))#>>'{rows,0,status}') = 'revealed'
 then 1 else 0 end as transfer_export_reveals_account_for_deducted_amount;
reset role;
set local role authenticated;
select pg_temp.rd_auth();
select pg_temp.rd_bank(43, 'complete_transfer');
reset role;
select 1/case when (select state = 'completed' and amount = 27000 from private.bank_transfer_claim_refunds where claim_id = pg_temp.rd_id('claim', 4))
 and (select amount = 27000 and status = 'done' and completed_at is not null from public.refunds where payment_id = pg_temp.rd_id('payment', 4))
 and (select status = 'refunded' and amount = 30000 from public.payments where id = pg_temp.rd_id('payment', 4))
 and (select state = 'applied' from private.claim_refund_deductions where claim_id = pg_temp.rd_id('claim', 4))
 and exists(select 1 from public.audit_log where action = 'admin.order.bank_refund_confirm_cancellation' and target = 'order:'||pg_temp.rd_id('order', 4)
   and diff#>>'{refundDeduction,refundAmount}' = '27000' and (diff->>'amount')::bigint = 30000)
 then 1 else 0 end as bank_transfer_completes_with_deducted_amount;

-- 4b. 첫 배송비를 낸 방식과 결제 경로에 따른 판정 --------------------------------------------------------------------------
-- 주문 9: 착불로 첫 배송비 3,000원을 낸 주문(선결제 배송비 0원). 무료배송이 아니므로 편도다.
-- 주문 10: 정기배송(billing) 결제. 결제사 부분 취소 계약이 없어 차감하지 않는다.
reset role;
insert into public.orders(id, user_id, status, total, shipping_fee, shipping_collect_total, address, payment_method, created_at, delivered_at)
 select pg_temp.rd_id('order', n), pg_temp.rd_id('user', 2), 'delivered'::public.order_status, 27000, 0, case when n = 9 then 3000 else 0 end,
  '{"recipientName":"TEST 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}', 'card'::public.order_payment_method,
  clock_timestamp() - interval '3 days', clock_timestamp() - interval '1 day' from generate_series(9, 10) n;
insert into public.order_items(id, order_id, good_id, variant_id, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot, qty, unit_price)
 select pg_temp.rd_id('item', n), pg_temp.rd_id('order', n), 'refund-deduction-good-9', v.id, 'TEST 반품배송비 상품', '문구', 'refund-deduction-ip', 2, 13500
 from generate_series(9, 10) n join public.goods_variants v on v.good_id = 'refund-deduction-good-9' and v.is_default;
insert into public.payments(id, user_id, provider, purpose, ref_id, amount, status, payment_key, idempotency_key, created_at)
 select pg_temp.rd_id('payment', n), pg_temp.rd_id('user', 2), 'toss'::public.payment_provider, 'order', pg_temp.rd_id('order', n), 27000,
  'paid'::public.payment_status, 'TEST-RD-KEY-'||n, 'refund-deduction-test-'||n, clock_timestamp() - interval '3 days' from generate_series(9, 10) n;
insert into public.payment_attempts(id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key, provider_order_id, provider_product_code, payment_id, expires_at)
 values (pg_temp.rd_id('attempt', 10), 'toss', pg_temp.rd_id('user', 2), 'order', pg_temp.rd_id('order', 10), 27000, 'KRW', 'approved',
  'refund-deduction-attempt-10', 'TEST-RD-ORDER-10', 'TEST-RD-PRODUCT-10', pg_temp.rd_id('payment', 10), clock_timestamp() + interval '1 hour');
-- billing 바인딩은 구독 주기·프로필 원장이 필요한 무거운 행이라 FK·트리거를 끄고 합성한다(이 트랜잭션에서만).
set local session_replication_role = replica;
insert into private.payment_provider_bindings(attempt_id, integration, owner_id, profile_id, merchant_id, environment, credential_id, cycle_id, write_key_version, first_dispatched_at)
 values (pg_temp.rd_id('attempt', 10), 'toss_billing', pg_temp.rd_id('user', 2), pg_temp.rd_id('profile', 10), 'TEST-MID', 'test',
  pg_temp.rd_id('credential', 10), pg_temp.rd_id('cycle', 10), 'v1', clock_timestamp());
set local session_replication_role = origin;
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, reason_type, claim_type, stage, collection_policy, collected_at, requested_at)
 select pg_temp.rd_id('claim', n), pg_temp.rd_id('order', n), pg_temp.rd_id('user', 2), 'TEST 반품배송비 차감 검증', 'change_of_mind', 'return', 'collected', 'legacy',
  clock_timestamp() - interval '30 minutes', clock_timestamp() - interval '2 days' from generate_series(9, 10) n;
-- 착불 첫 배송비는 왕복이 아니라 편도: 3,000원 차감·24,000원 환불. 근거(최초 배송비)에는 착불분이 남는다.
select 1/case when private.return_fee_deduction_plan(pg_temp.rd_id('claim', 9)) @> '{"applicable": true, "basis": "one_way", "deductionAmount": 3000, "refundAmount": 24000, "initialShippingFee": 3000, "paymentAmount": 27000}'
 then 1 else 0 end as collect_shipping_is_one_way_not_free_shipping;
-- 정기배송 결제는 차감 결정이 없고 전액 환불로 간다.
select 1/case when private.return_fee_deduction_plan(pg_temp.rd_id('claim', 10)) @> '{"applicable": false, "reason": "partial_cancel_unsupported", "refundAmount": 27000}'
 and private.claim_refund_deduction_notice(pg_temp.rd_id('claim', 10), 'filed') is null
 then 1 else 0 end as billing_payment_is_not_deducted;
select pg_temp.rd_auth();
set local role authenticated;
select public.admin_record_order_claim_refund(pg_temp.rd_id('claim', 9), 'pg_cancel', 'filed', null);
select public.admin_record_order_claim_refund(pg_temp.rd_id('claim', 10), 'pg_cancel', 'filed', null);
reset role;
select 1/case when (select basis = 'one_way' and deduction_amount = 3000 and refund_amount = 24000 and initial_shipping_fee = 3000
   from private.claim_refund_deductions where claim_id = pg_temp.rd_id('claim', 9))
 and not exists(select 1 from private.claim_refund_deductions where claim_id = pg_temp.rd_id('claim', 10))
 and (select amount = 27000 from public.refunds where payment_id = pg_temp.rd_id('payment', 10))
 and not exists(select 1 from public.notifications where source_id = pg_temp.rd_id('claim', 10)::text and body like '%반품배송비%')
 then 1 else 0 end as collect_decision_one_way_and_billing_has_no_decision;

-- 5. 스위치를 다시 꺼도 이미 정한 결정은 그대로, 새 판정은 없다 ------------------------------------------------------------
update private.return_fee_deduction_settings set enabled = false where singleton;
select 1/case when private.return_fee_deduction_plan(pg_temp.rd_id('claim', 2)) is null
 and private.claim_refund_deduction_view(pg_temp.rd_id('claim', 2)) is null
 and private.claim_refund_deduction_view(pg_temp.rd_id('claim', 1)) @> '{"source": "decision", "state": "applied", "refundAmount": 27000}'
 and (select revision = 3 from private.return_fee_deduction_settings)
 then 1 else 0 end as switch_off_keeps_decisions_and_stops_new_plans;

rollback;
