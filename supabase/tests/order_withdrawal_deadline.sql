\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- ICONS · 청약철회 기한 (#189)
-- 기한 판정의 기준 시점은 "재화를 공급받은 날"이다. 배송 완료 전이가 그 시점을
-- 기록하고, 기록이 없으면 기한은 아직 시작하지 않은 것으로 본다.
-- ============================================================================

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000801',
    'authenticated', 'authenticated', 'withdrawal-deadline-buyer@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000802',
    'authenticated', 'authenticated', 'withdrawal-deadline-staff@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000801',
    'withdrawal-deadline-buyer@example.test', 'withdrawal_buyer', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000802',
    'withdrawal-deadline-staff@example.test', 'withdrawal_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  role = excluded.role;

insert into public.ips (id, title, vertical_key)
values ('withdrawal-deadline-ip', '청약철회 기한 IP', 'character');

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('withdrawal-deadline-goods', 'withdrawal-deadline-ip', '기한 판정 굿즈', '문구', 10000, 'ok', 9);

insert into public.orders (id, user_id, status, total, address, expires_at)
values (
  '40000000-0000-4000-8000-000000000801',
  '00000000-0000-4000-8000-000000000801', 'paid', 10000, '{}'::jsonb, null
);

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
values (
  '40000000-0000-4000-8000-000000000801', 'withdrawal-deadline-goods', 1, 10000,
  '기한 판정 굿즈', '문구', 'withdrawal-deadline-ip'
);

-- 발송 전에는 두 시점 모두 비어 있다.
select 1 / case when (
  select shipped_at is null and delivered_at is null
  from public.orders
  where id = '40000000-0000-4000-8000-000000000801'
) then 1 else 0 end as assert_shipment_timestamps_start_empty;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000802', true);

-- 사다리가 늘어 발송 전에 발주확인을 거친다(#250).
select public.admin_update_order_status(
  '40000000-0000-4000-8000-000000000801',
  'confirmed',
  null,
  null
);

select public.admin_update_order_status(
  '40000000-0000-4000-8000-000000000801',
  'shipping',
  'hanjin',
  'WD00000000801'
);

reset role;

-- 발송은 shipped_at만 남긴다. 공급일은 아직 확정되지 않았다.
select 1 / case when (
  select shipped_at is not null and delivered_at is null
  from public.orders
  where id = '40000000-0000-4000-8000-000000000801'
) then 1 else 0 end as assert_shipping_transition_records_shipped_at;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000802', true);

-- 공급일은 이제 배송완료(delivered) 전이가 확정한다(#250). done은 거래확정이다.
select public.admin_update_order_status(
  '40000000-0000-4000-8000-000000000801',
  'delivered',
  null,
  null
);

reset role;

-- 배송 완료가 기한 기산점을 확정한다.
select 1 / case when (
  select delivered_at is not null and delivered_at >= shipped_at
  from public.orders
  where id = '40000000-0000-4000-8000-000000000801'
) then 1 else 0 end as assert_delivered_transition_records_delivered_at;

-- ----------------------------------------------------------------------------
-- 기한 평가. 단순 변심은 공급일부터 7일, 하자·오배송은 3개월이다.
-- 공급일이 기록되지 않은 주문은 기한이 아직 시작하지 않은 것으로 본다.
-- ----------------------------------------------------------------------------

insert into public.orders (id, user_id, status, total, address, expires_at, shipped_at, delivered_at)
values
  (
    '40000000-0000-4000-8000-000000000802',
    '00000000-0000-4000-8000-000000000801', 'done', 10000, '{}'::jsonb, null,
    now() - interval '10 days', now() - interval '8 days'
  ),
  (
    '40000000-0000-4000-8000-000000000803',
    '00000000-0000-4000-8000-000000000801', 'done', 10000, '{}'::jsonb, null,
    now() - interval '10 days', now() - interval '8 days'
  ),
  (
    '40000000-0000-4000-8000-000000000804',
    '00000000-0000-4000-8000-000000000801', 'done', 10000, '{}'::jsonb, null,
    now() - interval '4 months', now() - interval '4 months'
  ),
  (
    '40000000-0000-4000-8000-000000000805',
    '00000000-0000-4000-8000-000000000801', 'shipping', 10000, '{}'::jsonb, null,
    now() - interval '30 days', null
  );

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
values
  ('40000000-0000-4000-8000-000000000802', 'withdrawal-deadline-goods', 1, 10000, '기한 판정 굿즈', '문구', 'withdrawal-deadline-ip'),
  ('40000000-0000-4000-8000-000000000803', 'withdrawal-deadline-goods', 1, 10000, '기한 판정 굿즈', '문구', 'withdrawal-deadline-ip'),
  ('40000000-0000-4000-8000-000000000804', 'withdrawal-deadline-goods', 1, 10000, '기한 판정 굿즈', '문구', 'withdrawal-deadline-ip'),
  ('40000000-0000-4000-8000-000000000805', 'withdrawal-deadline-goods', 1, 10000, '기한 판정 굿즈', '문구', 'withdrawal-deadline-ip');

set local role service_role;

-- 공급 8일 뒤의 단순 변심은 기한을 넘겼다.
select 1 / case when public.request_order_cancellation(
  '40000000-0000-4000-8000-000000000802',
  '00000000-0000-4000-8000-000000000801',
  '단순 변심 청약철회',
  'change_of_mind'
) = 'deadline_expired' then 1 else 0 end as assert_change_of_mind_expires_after_seven_days;

-- 같은 시점이라도 하자·오배송은 열려 있어야 한다. 기한 판정이 사유를 가리지
-- 않으면 환급 의무가 남은 요청까지 막힌다.
select 1 / case when public.request_order_cancellation(
  '40000000-0000-4000-8000-000000000803',
  '00000000-0000-4000-8000-000000000801',
  '상품 하자 청약철회',
  'defect'
) = 'requested' then 1 else 0 end as assert_defect_survives_seven_day_deadline;

-- 하자도 무기한은 아니다. 공급일부터 3개월이 상한이다.
select 1 / case when public.request_order_cancellation(
  '40000000-0000-4000-8000-000000000804',
  '00000000-0000-4000-8000-000000000801',
  '상품 하자 청약철회',
  'defect'
) = 'deadline_expired' then 1 else 0 end as assert_defect_expires_after_three_months;

-- 공급일이 없으면 기한은 시작하지 않는다. 운영자가 배송 완료를 기록하지 않은
-- 사이에 고객 권리가 소멸하면 안 된다.
select 1 / case when public.request_order_cancellation(
  '40000000-0000-4000-8000-000000000805',
  '00000000-0000-4000-8000-000000000801',
  '단순 변심 청약철회',
  'change_of_mind'
) = 'requested' then 1 else 0 end as assert_deadline_does_not_start_without_delivery;

reset role;

-- 접수된 요청은 사유 구분을 함께 남긴다. 운영자 판단과 감사 추적의 근거다.
select 1 / case when (
  select reason_type = 'defect'
  from public.order_cancellation_requests
  where order_id = '40000000-0000-4000-8000-000000000803'
) then 1 else 0 end as assert_request_records_reason_type;

-- ----------------------------------------------------------------------------
-- 승인 경로. 요청 RPC를 우회해 접수된 요청도 승인 단계에서 다시 막힌다.
-- 판정 기준 시각은 요청 시점이다 — 운영자 검토가 늦어졌다는 이유로 고객의
-- 적법한 요청이 사라지면 안 된다.
-- ----------------------------------------------------------------------------

insert into public.orders (id, user_id, status, total, address, expires_at, shipped_at, delivered_at)
values
  (
    '40000000-0000-4000-8000-000000000806',
    '00000000-0000-4000-8000-000000000801', 'done', 10000, '{}'::jsonb, null,
    now() - interval '12 days', now() - interval '10 days'
  ),
  (
    '40000000-0000-4000-8000-000000000807',
    '00000000-0000-4000-8000-000000000801', 'done', 10000, '{}'::jsonb, null,
    now() - interval '22 days', now() - interval '20 days'
  );

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
values
  ('40000000-0000-4000-8000-000000000806', 'withdrawal-deadline-goods', 1, 10000, '기한 판정 굿즈', '문구', 'withdrawal-deadline-ip'),
  ('40000000-0000-4000-8000-000000000807', 'withdrawal-deadline-goods', 1, 10000, '기한 판정 굿즈', '문구', 'withdrawal-deadline-ip');

-- 요청 RPC를 거치지 않고 직접 접수된 기한 초과 요청(폼 우회 시뮬레이션).
insert into public.order_cancellation_requests (
  id, order_id, requested_by, reason, reason_type, status, requested_at
)
values
  (
    '70000000-0000-4000-8000-000000000806',
    '40000000-0000-4000-8000-000000000806',
    '00000000-0000-4000-8000-000000000801',
    '단순 변심 청약철회', 'change_of_mind', 'requested', now()
  ),
  -- 기한 안에 접수됐지만 검토가 늦어진 요청.
  (
    '70000000-0000-4000-8000-000000000807',
    '40000000-0000-4000-8000-000000000807',
    '00000000-0000-4000-8000-000000000801',
    '단순 변심 청약철회', 'change_of_mind', 'requested', now() - interval '18 days'
  );

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000802', true);

do $$
begin
  begin
    perform public.admin_decide_order_cancellation(
      '70000000-0000-4000-8000-000000000806',
      'approve',
      null
    );
    raise exception 'expired request should not be approvable';
  exception
    when check_violation then
      if sqlerrm <> 'withdrawal_deadline_expired' then raise; end if;
  end;
end;
$$;

-- 기한 초과 요청도 거절은 언제든 가능해야 한다. 그러지 않으면 요청이 영원히
-- 미결 상태로 남아 주문의 다른 전이까지 막는다.
select public.admin_decide_order_cancellation(
  '70000000-0000-4000-8000-000000000806',
  'reject',
  '청약철회 기한이 지난 요청입니다'
);

-- 요청 시점이 기한 안이었다면 승인이 늦어져도 통과한다.
select public.admin_decide_order_cancellation(
  '70000000-0000-4000-8000-000000000807',
  'approve',
  null
);

reset role;

select 1 / case when (
  select status = 'rejected'
  from public.order_cancellation_requests
  where id = '70000000-0000-4000-8000-000000000806'
) then 1 else 0 end as assert_expired_request_stays_rejectable;

select 1 / case when (
  select status = 'processing'
  from public.order_cancellation_requests
  where id = '70000000-0000-4000-8000-000000000807'
) then 1 else 0 end as assert_timely_request_survives_late_review;

rollback;
