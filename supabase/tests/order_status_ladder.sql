\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- ICONS · 주문 상태 사다리 (#250)
--
--   pending → paid → confirmed → shipping → delivered → done (+ canceled)
--
-- 어드민이 미는 전이는 세 개(발주확인·발송처리·배송완료)뿐이고, 거래확정(done)은
-- settle_delivered_orders()가 delivered + 8일에 만든다. 이 스모크는 허용 전이,
-- 금지 전이, 활성 클레임 중 발주확인 거부, 운송장 없는 발송 거부, 자동 확정의
-- 8일 경계·멱등·클레임 보류를 DB 안에서 고정한다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 계약: 사다리 순서와 자동 확정 잡의 실행 권한
-- ---------------------------------------------------------------------------
select 1 / case when (
  (
    select array_agg(value::text order by value)
    from unnest(enum_range(null::public.order_status)) as t(value)
  ) = array[
    'pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled'
  ]
) then 1 else 0 end as assert_ladder_enum_is_ordered;

-- 자동 확정은 스케줄러(postgres)와 수동 운영(service_role)만 실행한다.
select 1 / case when (
  not has_function_privilege('anon', 'public.settle_delivered_orders()', 'execute')
  and not has_function_privilege('authenticated', 'public.settle_delivered_orders()', 'execute')
  and has_function_privilege('service_role', 'public.settle_delivered_orders()', 'execute')
) then 1 else 0 end as assert_settlement_rpc_is_service_only;

-- pg_cron 등록이 마이그레이션에 남아 있어야 재적용/새 환경에서도 확정이 돈다.
select 1 / case when (
  exists (
    select 1
    from cron.job
    where jobname = 'settle-delivered-orders'
      and schedule = '0 18 * * *'
      and command = 'select public.settle_delivered_orders()'
  )
) then 1 else 0 end as assert_settlement_job_is_scheduled;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000901',
    'authenticated', 'authenticated', 'ladder-buyer@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000902',
    'authenticated', 'authenticated', 'ladder-staff@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000901',
    'ladder-buyer@example.test', 'ladder_buyer', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000902',
    'ladder-staff@example.test', 'ladder_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  role = excluded.role;

insert into public.ips (id, title, vertical_key)
values ('order-ladder-ip', '주문 사다리 IP', 'character');

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('order-ladder-goods', 'order-ladder-ip', '사다리 굿즈', '테스트', 10000, 'ok', 20);

insert into public.orders (
  id, user_id, status, total, address, expires_at, shipped_at, delivered_at
)
values
  -- A: 사다리 전 구간을 걷는다
  (
    '40000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000901', 'paid', 10000, '{}'::jsonb, null, null, null
  ),
  -- B: 활성 취소 요청이 붙은 신규주문 — 발주확인이 막혀야 한다
  (
    '40000000-0000-4000-8000-000000000902',
    '00000000-0000-4000-8000-000000000901', 'paid', 10000, '{}'::jsonb, null, null, null
  ),
  -- C: 금지 전이 확인용 신규주문
  (
    '40000000-0000-4000-8000-000000000903',
    '00000000-0000-4000-8000-000000000901', 'paid', 10000, '{}'::jsonb, null, null, null
  ),
  -- D: 배송완료 + 7일 23시간 — 아직 변심 철회 창이 열려 있다
  (
    '40000000-0000-4000-8000-000000000904',
    '00000000-0000-4000-8000-000000000901', 'delivered', 10000, '{}'::jsonb, null,
    now() - interval '10 days', now() - interval '7 days 23 hours'
  ),
  -- E: 배송완료 + 8일 1분 — 확정 대상
  (
    '40000000-0000-4000-8000-000000000905',
    '00000000-0000-4000-8000-000000000901', 'delivered', 10000, '{}'::jsonb, null,
    now() - interval '12 days', now() - interval '8 days 1 minute'
  ),
  -- F: 기한은 지났지만 승인된 claim이 남아 있다
  (
    '40000000-0000-4000-8000-000000000906',
    '00000000-0000-4000-8000-000000000901', 'delivered', 10000, '{}'::jsonb, null,
    now() - interval '14 days', now() - interval '10 days'
  ),
  -- G: 기한은 지났지만 처리 중인 취소 요청이 있다
  (
    '40000000-0000-4000-8000-000000000907',
    '00000000-0000-4000-8000-000000000901', 'delivered', 10000, '{}'::jsonb, null,
    now() - interval '14 days', now() - interval '10 days'
  ),
  -- H: 배송완료 시점이 없는 주문은 기한이 시작하지 않았다
  (
    '40000000-0000-4000-8000-000000000908',
    '00000000-0000-4000-8000-000000000901', 'delivered', 10000, '{}'::jsonb, null,
    now() - interval '30 days', null
  ),
  -- I: 승인된 claim이 붙은 신규주문 — 발주확인이 막혀야 한다
  (
    '40000000-0000-4000-8000-000000000909',
    '00000000-0000-4000-8000-000000000901', 'paid', 10000, '{}'::jsonb, null, null, null
  );

insert into public.order_cancellation_requests (
  order_id, requested_by, reason, reason_type, status
)
values
  (
    '40000000-0000-4000-8000-000000000902',
    '00000000-0000-4000-8000-000000000901', '주문 취소 요청', 'change_of_mind', 'requested'
  ),
  (
    '40000000-0000-4000-8000-000000000907',
    '00000000-0000-4000-8000-000000000901', '수령 후 반품 요청', 'change_of_mind', 'processing'
  );

insert into public.order_cancellation_claims (order_id, requested_by, previous_status)
values
  (
    '40000000-0000-4000-8000-000000000906',
    '00000000-0000-4000-8000-000000000901',
    'delivered'
  ),
  (
    '40000000-0000-4000-8000-000000000909',
    '00000000-0000-4000-8000-000000000901',
    'paid'
  );

-- claim의 원상태 CHECK가 새 단계를 받아야 승인 자체가 통과한다.
select 1 / case when (
  (select previous_status from public.order_cancellation_claims
   where order_id = '40000000-0000-4000-8000-000000000906') = 'delivered'
) then 1 else 0 end as assert_claim_accepts_new_ladder_previous_status;

-- ---------------------------------------------------------------------------
-- 허용 전이 — paid → confirmed → shipping → delivered
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000902', true);

select public.admin_update_order_status(
  '40000000-0000-4000-8000-000000000901', 'confirmed', null, null
);

-- 발주확인은 시점만 남긴다. 운송장도 공급일도 아직 없다.
select 1 / case when (
  select status = 'confirmed'
    and confirmed_at is not null
    and shipped_at is null
    and delivered_at is null
    and done_at is null
  from public.orders
  where id = '40000000-0000-4000-8000-000000000901'
) then 1 else 0 end as assert_confirmation_records_confirmed_at_only;

-- 발송처리는 운송장 없이 통과하지 못한다(#178 계약 유지).
do $$
begin
  begin
    perform public.admin_update_order_status(
      '40000000-0000-4000-8000-000000000901', 'shipping', null, null
    );
  exception when check_violation then
    if sqlerrm = 'tracking_required' then return; end if;
    raise;
  end;
  raise exception 'shipping without a waybill should be rejected';
end;
$$;

select 1 / case when (
  (select status from public.orders where id = '40000000-0000-4000-8000-000000000901') = 'confirmed'
) then 1 else 0 end as assert_missing_waybill_keeps_the_order_confirmed;

select public.admin_update_order_status(
  '40000000-0000-4000-8000-000000000901', 'shipping', 'hanjin', 'LD00000000901'
);

select 1 / case when (
  select status = 'shipping'
    and shipped_at is not null
    and shipped_at >= confirmed_at
    and delivered_at is null
  from public.orders
  where id = '40000000-0000-4000-8000-000000000901'
) then 1 else 0 end as assert_dispatch_records_shipped_at_only;

select public.admin_update_order_status(
  '40000000-0000-4000-8000-000000000901', 'delivered', null, null
);

-- 청약철회 기산점은 done이 아니라 delivered 전이가 확정한다(#250).
select 1 / case when (
  select status = 'delivered'
    and delivered_at is not null
    and delivered_at >= shipped_at
    and done_at is null
    and shipping_carrier = 'hanjin'
    and tracking_number = 'LD00000000901'
  from public.orders
  where id = '40000000-0000-4000-8000-000000000901'
) then 1 else 0 end as assert_delivery_records_delivered_at_and_keeps_the_waybill;

-- 세 전이가 모두 감사된다.
select 1 / case when (
  (select count(*) from public.audit_log
    where actor_id = '00000000-0000-4000-8000-000000000902'
      and action = 'admin.order.status_updated'
      and target = 'order:40000000-0000-4000-8000-000000000901') = 3
  and exists (
    select 1 from public.audit_log
    where target = 'order:40000000-0000-4000-8000-000000000901'
      and diff->>'from' = 'paid'
      and diff->>'to' = 'confirmed'
  )
  and exists (
    select 1 from public.audit_log
    where target = 'order:40000000-0000-4000-8000-000000000901'
      and diff->>'from' = 'shipping'
      and diff->>'to' = 'delivered'
  )
) then 1 else 0 end as assert_every_ladder_transition_is_audited;

-- 배송완료는 구매자에게 알린다. 발주확인은 내부 단계라 알리지 않는다.
-- notifications는 소유자만 읽으므로 staff 세션을 벗어나서 확인한다.
reset role;

select 1 / case when (
  exists (
    select 1 from public.notifications
    where user_id = '00000000-0000-4000-8000-000000000901'
      and type = 'order_delivered'
      and dedupe_key = 'order:delivered:40000000-0000-4000-8000-000000000901'
      and link_path = '/orders/40000000-0000-4000-8000-000000000901'
  )
  and not exists (
    select 1 from public.notifications
    where user_id = '00000000-0000-4000-8000-000000000901'
      and type not in ('order_shipping', 'order_delivered')
      and dedupe_key like 'order:%40000000-0000-4000-8000-000000000901'
  )
) then 1 else 0 end as assert_delivery_notifies_the_buyer;

-- ---------------------------------------------------------------------------
-- 금지 전이 — 건너뛰기·역행·어드민 거래확정
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000902', true);

-- paid에서 발송으로 건너뛸 수 없다.
do $$
begin
  begin
    perform public.admin_update_order_status(
      '40000000-0000-4000-8000-000000000903', 'shipping', 'hanjin', 'LD00000000903'
    );
  exception when others then
    if sqlerrm = 'invalid_order_transition' then return; end if;
    raise;
  end;
  raise exception 'paid order should not skip 발주확인';
end;
$$;

-- paid에서 배송완료로 건너뛸 수 없다.
do $$
begin
  begin
    perform public.admin_update_order_status(
      '40000000-0000-4000-8000-000000000903', 'delivered', null, null
    );
  exception when others then
    if sqlerrm = 'invalid_order_transition' then return; end if;
    raise;
  end;
  raise exception 'paid order should not skip to delivered';
end;
$$;

-- 거래확정은 어드민 전이가 아니다. done은 화이트리스트에서 빠진다.
do $$
begin
  begin
    perform public.admin_update_order_status(
      '40000000-0000-4000-8000-000000000901', 'done', null, null
    );
  exception when check_violation then
    if sqlerrm = 'invalid_order_status' then return; end if;
    raise;
  end;
  raise exception 'done should not be an admin transition';
end;
$$;

-- 취소도 어드민 상태 전이로 만들지 않는다(청약철회 경로가 유일하다).
do $$
begin
  begin
    perform public.admin_update_order_status(
      '40000000-0000-4000-8000-000000000903', 'canceled', null, null
    );
  exception when check_violation then
    if sqlerrm = 'invalid_order_status' then return; end if;
    raise;
  end;
  raise exception 'canceled should not be an admin transition';
end;
$$;

-- 배송완료된 주문을 배송중으로 되돌릴 수 없다.
do $$
begin
  begin
    perform public.admin_update_order_status(
      '40000000-0000-4000-8000-000000000901', 'shipping', 'hanjin', 'LD00000000901'
    );
  exception when others then
    if sqlerrm = 'invalid_order_transition' then return; end if;
    raise;
  end;
  raise exception 'delivered order should not transition backwards';
end;
$$;

select 1 / case when (
  (select status from public.orders where id = '40000000-0000-4000-8000-000000000903') = 'paid'
  and (select status from public.orders where id = '40000000-0000-4000-8000-000000000901') = 'delivered'
) then 1 else 0 end as assert_rejected_transitions_leave_the_ladder_untouched;

-- ---------------------------------------------------------------------------
-- 취소 처리 중인 주문은 발주확인으로도 밀지 않는다
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    perform public.admin_update_order_status(
      '40000000-0000-4000-8000-000000000902', 'confirmed', null, null
    );
  exception when check_violation then
    if sqlerrm = 'order cancellation in progress' then return; end if;
    raise;
  end;
  raise exception 'confirmation should be blocked while a cancellation is active';
end;
$$;

-- 요청 행이 이미 닫힌 뒤에도 승인이 남긴 durable claim이 사다리를 잠근다.
-- claim은 finalizer가 지울 때까지 "환불 예정"이라는 뜻이다.
do $$
begin
  begin
    perform public.admin_update_order_status(
      '40000000-0000-4000-8000-000000000909', 'confirmed', null, null
    );
  exception when check_violation then
    if sqlerrm = 'order cancellation in progress' then return; end if;
    raise;
  end;
  raise exception 'confirmation should be blocked while a claim is open';
end;
$$;

select 1 / case when (
  (select status from public.orders where id = '40000000-0000-4000-8000-000000000902') = 'paid'
  and (select status from public.orders where id = '40000000-0000-4000-8000-000000000909') = 'paid'
) then 1 else 0 end as assert_active_cancellation_blocks_confirmation;

reset role;

-- ---------------------------------------------------------------------------
-- 자동 거래확정 — 8일 경계 · 활성 클레임 보류 · 멱등
-- ---------------------------------------------------------------------------
set local role service_role;

select 1 / case when (
  public.settle_delivered_orders() = 1
) then 1 else 0 end as assert_settlement_confirms_only_the_matured_order;

reset role;

-- 8일 1분이 지난 주문만 확정되고, done_at이 남는다.
select 1 / case when (
  select status = 'done' and done_at is not null
  from public.orders
  where id = '40000000-0000-4000-8000-000000000905'
) then 1 else 0 end as assert_matured_order_is_settled_with_done_at;

-- 7일 23시간은 아직 변심 철회 창 안이다.
select 1 / case when (
  select status = 'delivered' and done_at is null
  from public.orders
  where id = '40000000-0000-4000-8000-000000000904'
) then 1 else 0 end as assert_seven_day_boundary_is_not_settled;

-- 승인된 claim·처리 중인 요청이 있으면 기한이 지나도 확정하지 않는다.
select 1 / case when (
  (select status from public.orders where id = '40000000-0000-4000-8000-000000000906') = 'delivered'
  and (select status from public.orders where id = '40000000-0000-4000-8000-000000000907') = 'delivered'
) then 1 else 0 end as assert_active_claims_hold_settlement;

-- 공급일이 없으면 기한이 시작하지 않는다(#189의 판단을 그대로 잇는다).
select 1 / case when (
  select status = 'delivered' and done_at is null
  from public.orders
  where id = '40000000-0000-4000-8000-000000000908'
) then 1 else 0 end as assert_missing_delivery_date_never_settles;

-- 멱등: 다시 돌려도 확정 대상이 없고 done_at도 바뀌지 않는다.
create temporary table order_ladder_settled_at on commit drop as
select done_at from public.orders where id = '40000000-0000-4000-8000-000000000905';

set local role service_role;

select 1 / case when (
  public.settle_delivered_orders() = 0
) then 1 else 0 end as assert_settlement_is_idempotent;

reset role;

select 1 / case when (
  (select done_at from public.orders where id = '40000000-0000-4000-8000-000000000905')
    = (select done_at from order_ladder_settled_at)
) then 1 else 0 end as assert_rerun_does_not_rewrite_done_at;

-- ---------------------------------------------------------------------------
-- done은 "클레임 불가"가 아니라 "변심 철회 창 종료"다
-- ---------------------------------------------------------------------------
-- 하자·오배송은 공급받은 날부터 3개월이므로 확정된 주문에서도 접수된다.
set local role service_role;

select 1 / case when (
  public.request_order_cancellation(
    '40000000-0000-4000-8000-000000000905',
    '00000000-0000-4000-8000-000000000901',
    '수령 후 파손 확인',
    'defect'
  ) = 'requested'
) then 1 else 0 end as assert_defect_claim_survives_settlement;

reset role;

-- 같은 주문의 변심 철회는 7일이 지나 이미 닫혀 있다.
select 1 / case when (
  public.order_withdrawal_deadline_passed(
    (select delivered_at from public.orders where id = '40000000-0000-4000-8000-000000000905'),
    'change_of_mind',
    now()
  )
  and not public.order_withdrawal_deadline_passed(
    (select delivered_at from public.orders where id = '40000000-0000-4000-8000-000000000905'),
    'defect',
    now()
  )
) then 1 else 0 end as assert_settlement_matches_the_change_of_mind_window;

rollback;
