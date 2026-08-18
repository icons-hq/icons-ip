\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- ICONS · 클레임 도메인(취소·반품·교환) (#252)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · 새 RPC의 실행 권한 봉인과 환불계좌의 service_role 전용 격리
--   · stage → status 투영 — 레거시 writer가 status만 바꿔도 두 값이 갈라지지 않는다
--   · 접수 게이트(반품·교환은 delivered 이후 · 기한 · 주문당 1건)
--   · paid 변심 취소의 자동 승인 경계 — confirmed와 하자는 자동 승인되지 않는다
--   · 반품 절차 수거 → 입고 → 환불 접수, 그 시점에 durable claim이 생긴다
--   · 환불 완료는 클레임이 completed일 때만 기록된다 (재고 복원 없는 "환불 완료" 금지)
--   · 교환 재출고는 환불도 재고 복원도 카드팩 회수도 하지 않는다
--   · 보류(on_hold)와 provider 정합화 실패(needs_review)는 서로 다른 값으로 남는다
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 계약: 실행 권한
-- ---------------------------------------------------------------------------
-- 접수는 서버(service_role)만, 운영 결정은 staff 세션(authenticated)만.
select 1 / case when (
  not has_function_privilege(
    'anon',
    'public.request_order_claim(uuid,uuid,text,text,text,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.request_order_claim(uuid,uuid,text,text,text,text,text,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.request_order_claim(uuid,uuid,text,text,text,text,text,text)',
    'execute'
  )
) then 1 else 0 end as assert_claim_intake_is_service_only;

select 1 / case when (
  not has_function_privilege('anon', 'public.admin_decide_order_claim(uuid,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_decide_order_claim(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_record_order_claim_collection(uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_record_order_claim_collection(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_record_order_claim_refund(uuid,text,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_record_order_claim_refund(uuid,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_record_order_claim_reshipment(uuid,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_record_order_claim_reshipment(uuid,text,text)', 'execute')
) then 1 else 0 end as assert_claim_operations_are_staff_session_only;

-- 환불계좌 원문은 브라우저 역할이 어떤 방식으로도 닿을 수 없다.
select 1 / case when (
  not has_table_privilege('anon', 'private.claim_refund_accounts', 'select')
  and not has_any_column_privilege('anon', 'private.claim_refund_accounts', 'select')
  and not has_table_privilege('authenticated', 'private.claim_refund_accounts', 'select')
  and not has_any_column_privilege('authenticated', 'private.claim_refund_accounts', 'select')
  and has_table_privilege('service_role', 'private.claim_refund_accounts', 'select')
  and not has_table_privilege('service_role', 'private.claim_refund_accounts', 'delete')
) then 1 else 0 end as assert_refund_accounts_are_service_only_and_never_deleted;

-- 파기 잡은 마이그레이션에 등록돼 있어야 새 환경에서도 돈다.
select 1 / case when (
  exists (
    select 1
    from cron.job
    where jobname = 'purge-expired-claim-refund-accounts'
      and command = 'select public.purge_expired_claim_refund_accounts()'
  )
) then 1 else 0 end as assert_refund_account_purge_is_scheduled;

-- 알림 타입은 DB CHECK와 lib/notifications.ts의 union이 같은 목록이어야 한다.
-- 한쪽만 넓히면 클레임 알림이 CHECK로 막히거나 화면이 타입을 못 읽는다.
select 1 / case when (
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_check
    where constraint_check.conrelid = 'public.notifications'::regclass
      and constraint_check.conname = 'notifications_type_check'
      and pg_catalog.pg_get_constraintdef(constraint_check.oid) like '%claim_updated%'
  )
) then 1 else 0 end as assert_claim_updated_is_an_accepted_notification_type;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000c01',
    'authenticated', 'authenticated', 'claim-buyer@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000c02',
    'authenticated', 'authenticated', 'claim-staff@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

-- profiles.role은 user_role enum이다. text 리터럴을 그대로 넣으면 타입 오류가 난다.
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000c01',
    'claim-buyer@example.test', 'claim_buyer', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role
  ),
  (
    '00000000-0000-4000-8000-000000000c02',
    'claim-staff@example.test', 'claim_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'::public.user_role
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  role = excluded.role;

insert into public.ips (id, title, vertical_key)
values ('order-claim-ip', '클레임 IP', 'character');

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('order-claim-goods', 'order-claim-ip', '클레임 굿즈', '테스트', 10000, 'ok', 20);

insert into public.orders (id, user_id, status, total, address, expires_at, shipped_at, delivered_at)
values
  -- A: paid 변심 취소 — 자동 승인 대상
  (
    '41000000-0000-4000-8000-000000000c01',
    '00000000-0000-4000-8000-000000000c01', 'paid', 10000, '{}'::jsonb, null, null, null
  ),
  -- B: confirmed — 자동 승인되지 않는다
  (
    '41000000-0000-4000-8000-000000000c02',
    '00000000-0000-4000-8000-000000000c01', 'confirmed', 10000, '{}'::jsonb, null, null, null
  ),
  -- C: delivered — 반품 클레임 전 구간
  (
    '41000000-0000-4000-8000-000000000c03',
    '00000000-0000-4000-8000-000000000c01', 'delivered', 10000, '{}'::jsonb, null,
    now() - interval '3 days', now() - interval '1 day'
  ),
  -- D: delivered — 교환 클레임
  (
    '41000000-0000-4000-8000-000000000c04',
    '00000000-0000-4000-8000-000000000c01', 'delivered', 10000, '{}'::jsonb, null,
    now() - interval '3 days', now() - interval '1 day'
  ),
  -- E: shipping — 반품·교환 접수 거부(회수할 물건이 아직 고객에게 없다)
  (
    '41000000-0000-4000-8000-000000000c05',
    '00000000-0000-4000-8000-000000000c01', 'shipping', 10000, '{}'::jsonb, null,
    now() - interval '1 day', null
  ),
  -- F: 변심 기한이 지난 배송완료 주문
  (
    '41000000-0000-4000-8000-000000000c06',
    '00000000-0000-4000-8000-000000000c01', 'delivered', 10000, '{}'::jsonb, null,
    now() - interval '20 days', now() - interval '15 days'
  ),
  -- G: 보류·재개 확인용
  (
    '41000000-0000-4000-8000-000000000c07',
    '00000000-0000-4000-8000-000000000c01', 'delivered', 10000, '{}'::jsonb, null,
    now() - interval '3 days', now() - interval '1 day'
  );

insert into public.order_items (
  order_id, good_id, qty, unit_price, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
select
  order_record.id, 'order-claim-goods', 1, 10000, '클레임 굿즈', '테스트', 'order-claim-ip'
from public.orders as order_record
where order_record.id in (
  '41000000-0000-4000-8000-000000000c01',
  '41000000-0000-4000-8000-000000000c02',
  '41000000-0000-4000-8000-000000000c03',
  '41000000-0000-4000-8000-000000000c04',
  '41000000-0000-4000-8000-000000000c05',
  '41000000-0000-4000-8000-000000000c06',
  '41000000-0000-4000-8000-000000000c07'
);

insert into public.payments (
  id, user_id, purpose, ref_id, amount, status, payment_key, idempotency_key
)
values
  (
    '42000000-0000-4000-8000-000000000c01',
    '00000000-0000-4000-8000-000000000c01', 'order',
    '41000000-0000-4000-8000-000000000c01', 10000, 'paid', 'pk_claim_c01', 'idem_claim_c01'
  ),
  (
    '42000000-0000-4000-8000-000000000c03',
    '00000000-0000-4000-8000-000000000c01', 'order',
    '41000000-0000-4000-8000-000000000c03', 10000, 'paid', 'pk_claim_c03', 'idem_claim_c03'
  ),
  (
    '42000000-0000-4000-8000-000000000c04',
    '00000000-0000-4000-8000-000000000c01', 'order',
    '41000000-0000-4000-8000-000000000c04', 10000, 'paid', 'pk_claim_c04', 'idem_claim_c04'
  );

-- 교환 주문에 미개봉 카드팩을 하나 붙여 둔다. 교환은 이 카드팩을 회수하지 않아야 한다.
insert into public.card_pools (id, ip_id, name, active_from)
values ('43000000-0000-4000-8000-000000000c01', 'order-claim-ip', '클레임 풀', now() - interval '1 day');

-- 카드 리워드 전역 게이트가 꺼져 있으면 guard_draw_ticket_issuance(BEFORE ROW)가
-- 뽑기권 insert를 조용히 삼킨다(NULL 반환). 게이트를 켜지 않으면 아래 픽스처가
-- 0행으로 남아 "교환은 카드팩을 회수하지 않는다" 검증이 공허해진다.
update private.card_reward_control set enabled = true where singleton;

insert into public.draw_tickets (user_id, pool_id, source, source_id, ordinal)
values (
  '00000000-0000-4000-8000-000000000c01',
  '43000000-0000-4000-8000-000000000c01',
  'order_paid', '41000000-0000-4000-8000-000000000c04', 1
);

-- ---------------------------------------------------------------------------
-- 접수 게이트
-- ---------------------------------------------------------------------------
set local role service_role;

-- 반품·교환은 배송이 끝난 뒤에만 받는다. shipping 주문에는 회수할 물건이 없다.
select 1 / case when (
  public.request_order_claim(
    '41000000-0000-4000-8000-000000000c05',
    '00000000-0000-4000-8000-000000000c01',
    'return', '반품 요청', 'change_of_mind'
  ) = 'not_claimable'
) then 1 else 0 end as assert_return_requires_delivery;

select 1 / case when (
  public.request_order_claim(
    '41000000-0000-4000-8000-000000000c05',
    '00000000-0000-4000-8000-000000000c01',
    'exchange', '교환 요청', 'change_of_mind'
  ) = 'not_claimable'
) then 1 else 0 end as assert_exchange_requires_delivery;

-- 접수 자체가 실패했으므로 행이 남지 않는다.
select 1 / case when (
  not exists (
    select 1 from public.order_cancellation_requests
    where order_id = '41000000-0000-4000-8000-000000000c05'
  )
) then 1 else 0 end as assert_rejected_intake_leaves_no_claim_row;

-- 교환도 청약철회 기한을 준용한다(변심 7일).
select 1 / case when (
  public.request_order_claim(
    '41000000-0000-4000-8000-000000000c06',
    '00000000-0000-4000-8000-000000000c01',
    'exchange', '교환 요청', 'change_of_mind'
  ) = 'deadline_expired'
) then 1 else 0 end as assert_exchange_inherits_the_withdrawal_deadline;

-- 남의 주문에는 접수할 수 없다.
select 1 / case when (
  public.request_order_claim(
    '41000000-0000-4000-8000-000000000c03',
    '00000000-0000-4000-8000-000000000c02',
    'return', '반품 요청', 'change_of_mind'
  ) = 'not_found'
) then 1 else 0 end as assert_claim_intake_checks_ownership;

-- ---------------------------------------------------------------------------
-- 자동 승인 경계 — paid 변심 취소만
-- ---------------------------------------------------------------------------
select 1 / case when (
  public.request_order_claim(
    '41000000-0000-4000-8000-000000000c01',
    '00000000-0000-4000-8000-000000000c01',
    'cancel', '주문 취소', 'change_of_mind'
  ) = 'auto_approved'
) then 1 else 0 end as assert_paid_change_of_mind_cancel_is_auto_approved;

select 1 / case when (
  select request.stage = 'processing'
    and request.status = 'processing'
    and request.decided_by is null
    and request.decided_at is not null
  from public.order_cancellation_requests as request
  where request.order_id = '41000000-0000-4000-8000-000000000c01'
) then 1 else 0 end as assert_auto_approval_needs_no_operator;

-- 자동 승인도 durable claim과 환불 intent를 남긴다 — 승인 분기와 같은 실질이다.
select 1 / case when (
  exists (
    select 1 from public.order_cancellation_claims
    where order_id = '41000000-0000-4000-8000-000000000c01'
  )
  and exists (
    select 1 from public.refunds
    where payment_id = '42000000-0000-4000-8000-000000000c01'
      and status = 'requested'
  )
) then 1 else 0 end as assert_auto_approval_opens_the_refund_ledger;

-- 발주확인된 주문은 사람이 판단한다.
select 1 / case when (
  public.request_order_claim(
    '41000000-0000-4000-8000-000000000c02',
    '00000000-0000-4000-8000-000000000c01',
    'cancel', '주문 취소', 'change_of_mind'
  ) = 'requested'
) then 1 else 0 end as assert_confirmed_orders_are_not_auto_approved;

-- 주문당 활성 클레임은 하나다. 수거 중인 반품이 있는데 취소가 또 들어오면 안 된다.
select 1 / case when (
  public.request_order_claim(
    '41000000-0000-4000-8000-000000000c02',
    '00000000-0000-4000-8000-000000000c01',
    'cancel', '다시 취소', 'change_of_mind'
  ) = 'already_requested'
) then 1 else 0 end as assert_one_active_claim_per_order;

-- ---------------------------------------------------------------------------
-- 환불계좌 — 마스킹만 남고 원문은 private에 격리된다
-- ---------------------------------------------------------------------------
select public.request_order_claim(
  '41000000-0000-4000-8000-000000000c03',
  '00000000-0000-4000-8000-000000000c01',
  'return', '반품 요청', 'change_of_mind',
  '국민은행', '110-1234-567890', '홍길동'
);

-- private 테이블은 RLS가 켜져 있고 정책이 없다. 읽기 검증은 소유자 세션에서 한다 —
-- service_role로 읽어 0행이 나오면 "격리됐다"와 "저장되지 않았다"를 구분할 수 없다.
reset role;

select 1 / case when (
  select account.masked_account = '국민은행 *********7890'
    and account.masked_holder = '홍**'
    and account.account_number = '110-1234-567890'
    and account.purged_at is null
  from private.claim_refund_accounts as account
  join public.order_cancellation_requests as request on request.id = account.claim_id
  where request.order_id = '41000000-0000-4000-8000-000000000c03'
) then 1 else 0 end as assert_refund_account_is_masked_at_write_time;

-- ---------------------------------------------------------------------------
-- 반품 절차 — 승인 → 수거 → 입고 → 환불 접수
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000c02', true);

select 1 / case when (
  public.admin_decide_order_claim(
    (select id from public.order_cancellation_requests
     where order_id = '41000000-0000-4000-8000-000000000c03'),
    'approve', null
  ) = 'collecting'
) then 1 else 0 end as assert_return_approval_starts_collection;

-- 반품 승인은 아직 durable claim을 만들지 않는다. 물건이 돌아오지 않았기 때문이다.
-- claims 테이블은 service_role 전용이라 소유자 세션에서 읽는다.
reset role;

select 1 / case when (
  not exists (
    select 1 from public.order_cancellation_claims
    where order_id = '41000000-0000-4000-8000-000000000c03'
  )
) then 1 else 0 end as assert_return_approval_defers_the_durable_claim;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000c02', true);

select 1 / case when (
  public.admin_record_order_claim_collection(
    (select id from public.order_cancellation_requests
     where order_id = '41000000-0000-4000-8000-000000000c03'),
    'collected'
  ) = 'collected'
) then 1 else 0 end as assert_return_records_warehouse_intake;

-- SLA 기산점(약관 제16조 "반환받은 날")이 남는다.
select 1 / case when (
  select request.collected_at is not null and request.status = 'requested'
  from public.order_cancellation_requests as request
  where request.order_id = '41000000-0000-4000-8000-000000000c03'
) then 1 else 0 end as assert_collected_stage_projects_to_the_legacy_active_status;

select 1 / case when (
  public.admin_record_order_claim_refund(
    (select id from public.order_cancellation_requests
     where order_id = '41000000-0000-4000-8000-000000000c03'),
    'pg_cancel', 'filed', null
  ) = 'filed'
) then 1 else 0 end as assert_return_refund_can_be_filed_after_intake;

-- 입고 확인 뒤에야 durable claim이 생긴다(D11을 명시 상태로 승격한 결과).
reset role;

select 1 / case when (
  exists (
    select 1 from public.order_cancellation_claims
    where order_id = '41000000-0000-4000-8000-000000000c03'
  )
  and (
    select request.stage = 'processing' and request.status = 'processing'
    from public.order_cancellation_requests as request
    where request.order_id = '41000000-0000-4000-8000-000000000c03'
  )
) then 1 else 0 end as assert_refund_filing_opens_the_durable_claim;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000c02', true);

reset role;

select 1 / case when (
  select refund.method = 'pg_cancel'
    and refund.handled_by = '00000000-0000-4000-8000-000000000c02'
    and refund.filed_at is not null
    and refund.completed_at is null
  from public.refunds as refund
  where refund.payment_id = '42000000-0000-4000-8000-000000000c03'
) then 1 else 0 end as assert_refund_ledger_records_method_and_handler;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000c02', true);

-- 재고 복원 없이 "환불 완료"를 적을 수 없다. 완료는 finalizer를 지난 클레임에만 허용된다.
do $$
begin
  begin
    perform public.admin_record_order_claim_refund(
      (select id from public.order_cancellation_requests
       where order_id = '41000000-0000-4000-8000-000000000c03'),
      'pg_cancel', 'completed', null
    );
  exception when others then
    if sqlerrm = 'claim_refund_finalization_required' then return; end if;
    raise;
  end;
  raise exception 'refund completion must require a finalized claim';
end;
$$;

select 1 / case when (
  select stock_qty = 20 from public.goods where id = 'order-claim-goods'
) then 1 else 0 end as assert_refund_annotation_never_touches_stock;

-- ---------------------------------------------------------------------------
-- 교환 절차 — 회수 후 재출고, 환불 없음
-- ---------------------------------------------------------------------------
reset role;
set local role service_role;

select public.request_order_claim(
  '41000000-0000-4000-8000-000000000c04',
  '00000000-0000-4000-8000-000000000c01',
  'exchange', '사이즈 교환', 'change_of_mind'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000c02', true);

select public.admin_decide_order_claim(
  (select id from public.order_cancellation_requests
   where order_id = '41000000-0000-4000-8000-000000000c04'),
  'approve', null
);
select public.admin_record_order_claim_collection(
  (select id from public.order_cancellation_requests
   where order_id = '41000000-0000-4000-8000-000000000c04'),
  'collected'
);

-- 교환에는 환불 원장이 없다.
do $$
begin
  begin
    perform public.admin_record_order_claim_refund(
      (select id from public.order_cancellation_requests
       where order_id = '41000000-0000-4000-8000-000000000c04'),
      'pg_cancel', 'filed', null
    );
  exception when others then
    if sqlerrm = 'exchange_has_no_refund' then return; end if;
    raise;
  end;
  raise exception 'an exchange claim must not open a refund';
end;
$$;

select 1 / case when (
  public.admin_record_order_claim_reshipment(
    (select id from public.order_cancellation_requests
     where order_id = '41000000-0000-4000-8000-000000000c04'),
    'hanjin', 'LD00000000C04'
  ) = 'completed'
) then 1 else 0 end as assert_exchange_completes_with_a_new_waybill;

-- 교환은 재고를 복원하지 않고 카드팩도 회수하지 않는다. 주문은 살아 있다.
reset role;

select 1 / case when (
  (select stock_qty = 20 from public.goods where id = 'order-claim-goods')
  and (
    select count(*) = 1
    from public.draw_tickets
    where source_id = '41000000-0000-4000-8000-000000000c04'
      and revoked_at is null
  )
  and (
    select status = 'delivered'
    from public.orders
    where id = '41000000-0000-4000-8000-000000000c04'
  )
  and not exists (
    select 1 from public.refunds as refund
    where refund.payment_id = '42000000-0000-4000-8000-000000000c04'
  )
) then 1 else 0 end as assert_exchange_restores_nothing_and_revokes_nothing;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000c02', true);

-- 재출고는 교환 전용이다.
do $$
begin
  begin
    perform public.admin_record_order_claim_reshipment(
      (select id from public.order_cancellation_requests
       where order_id = '41000000-0000-4000-8000-000000000c03'),
      'hanjin', 'LD00000000C03'
    );
  exception when others then
    if sqlerrm = 'claim_type_has_no_reshipment' then return; end if;
    raise;
  end;
  raise exception 'only exchange claims may record a reshipment';
end;
$$;

-- ---------------------------------------------------------------------------
-- 보류와 재개 — needs_review와 다른 값으로 남는다
-- ---------------------------------------------------------------------------
reset role;
set local role service_role;
select public.request_order_claim(
  '41000000-0000-4000-8000-000000000c07',
  '00000000-0000-4000-8000-000000000c01',
  'return', '반품 요청', 'change_of_mind'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000c02', true);

select public.admin_decide_order_claim(
  (select id from public.order_cancellation_requests
   where order_id = '41000000-0000-4000-8000-000000000c07'),
  'approve', null
);

-- 보류 사유는 필수다.
do $$
begin
  begin
    perform public.admin_decide_order_claim(
      (select id from public.order_cancellation_requests
       where order_id = '41000000-0000-4000-8000-000000000c07'),
      'hold', '짧음'
    );
  exception when check_violation then
    if sqlerrm = 'invalid hold reason' then return; end if;
    raise;
  end;
  raise exception 'a hold must carry a reason';
end;
$$;

select 1 / case when (
  public.admin_decide_order_claim(
    (select id from public.order_cancellation_requests
     where order_id = '41000000-0000-4000-8000-000000000c07'),
    'hold', '반품 배송비 정산이 확인되지 않았습니다'
  ) = 'on_hold'
) then 1 else 0 end as assert_hold_records_an_operational_pause;

-- 보류는 운영 판단이고 needs_review는 provider 정합화 실패다. 두 값을 섞지 않는다.
-- held_from·hold_reason은 운영 내부 정보라 authenticated에 grant하지 않는다.
-- 구매자 화면이 읽는 것은 stage까지다 — 그래서 소유자 세션에서 확인한다.
reset role;

select 1 / case when (
  select request.stage = 'on_hold'
    and request.status = 'requested'
    and request.held_from = 'collecting'
    and request.hold_reason is not null
  from public.order_cancellation_requests as request
  where request.order_id = '41000000-0000-4000-8000-000000000c07'
) then 1 else 0 end as assert_hold_is_distinct_from_provider_needs_review;

-- 반대로 구매자가 보류 사유를 읽을 수는 없어야 한다.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000c01', true);

do $$
declare
  leaked boolean := false;
begin
  begin
    perform request.hold_reason
    from public.order_cancellation_requests as request
    where request.order_id = '41000000-0000-4000-8000-000000000c07';
    leaked := true;
  exception
    when insufficient_privilege then
      leaked := false;
  end;

  if leaked then
    raise exception 'hold_reason should not be readable by the buyer';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000c02', true);

-- 재개는 처음이 아니라 보류 직전 단계로 돌아간다.
select 1 / case when (
  public.admin_decide_order_claim(
    (select id from public.order_cancellation_requests
     where order_id = '41000000-0000-4000-8000-000000000c07'),
    'resume', null
  ) = 'collecting'
) then 1 else 0 end as assert_resume_returns_to_the_stage_before_the_hold;

-- 거절에는 사유가 필요하고, 거절된 클레임은 다시 결정할 수 없다.
select public.admin_decide_order_claim(
  (select id from public.order_cancellation_requests
   where order_id = '41000000-0000-4000-8000-000000000c07'),
  'reject', '반송 굿즈가 사용 흔적으로 재판매 불가합니다'
);

do $$
begin
  begin
    perform public.admin_decide_order_claim(
      (select id from public.order_cancellation_requests
       where order_id = '41000000-0000-4000-8000-000000000c07'),
      'approve', null
    );
  exception when others then
    if sqlerrm = 'claim_not_decidable' then return; end if;
    raise;
  end;
  raise exception 'a rejected claim must not be decidable again';
end;
$$;

-- ---------------------------------------------------------------------------
-- stage → status 투영 — 레거시 writer가 두 값을 갈라놓지 못한다
-- ---------------------------------------------------------------------------
reset role;

-- mark_order_cancellation_needs_review 같은 레거시 경로는 status만 쓴다.
update public.order_cancellation_requests
set status = 'needs_review'
where order_id = '41000000-0000-4000-8000-000000000c03';

select 1 / case when (
  select stage = 'needs_review'
  from public.order_cancellation_requests
  where order_id = '41000000-0000-4000-8000-000000000c03'
) then 1 else 0 end as assert_legacy_status_writes_promote_the_stage;

-- 정합화 재시도로 processing으로 돌아가도 절차 단계가 처음으로 감기지 않는다.
update public.order_cancellation_requests
set status = 'processing'
where order_id = '41000000-0000-4000-8000-000000000c03';

select 1 / case when (
  select stage = 'processing' and collected_at is not null
  from public.order_cancellation_requests
  where order_id = '41000000-0000-4000-8000-000000000c03'
) then 1 else 0 end as assert_reconciliation_retry_keeps_the_collection_history;

-- 투영을 어기는 조합은 CHECK가 거절한다.
do $$
begin
  begin
    update public.order_cancellation_requests
    set stage = 'collecting', status = 'processing'
    where order_id = '41000000-0000-4000-8000-000000000c03';
  exception when check_violation then
    return;
  end;
  raise exception 'stage and status must never diverge';
end;
$$;

-- ---------------------------------------------------------------------------
-- 콘솔 조회 — staff만, 그리고 0건 단계도 행으로 돌려준다
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000c01', true);

do $$
begin
  begin
    perform public.admin_search_order_claims('cancel', null, null, null, null, null, 20, 0);
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'the claim console must reject non-staff sessions';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000c02', true);

select 1 / case when (
  (select count(*) from public.admin_order_claim_stage_counts(null::text)) = 9
) then 1 else 0 end as assert_stage_counts_include_zero_rows;

select 1 / case when (
  (
    select count(*)
    from public.admin_search_order_claims('exchange', null, null, null, null, null, 20, 0)
  ) = 1
) then 1 else 0 end as assert_claim_search_filters_by_type;

-- 상세는 뽑기권 발급 여부와 마스킹된 환불계좌를 함께 싣는다. 원문은 싣지 않는다.
select 1 / case when (
  select detail -> 'cardPacks' ->> 'issued' = '1'
    and detail -> 'refundAccount' = 'null'::jsonb
  from public.admin_order_claim_detail(
    (select id from public.order_cancellation_requests
     where order_id = '41000000-0000-4000-8000-000000000c04')
  ) as detail
) then 1 else 0 end as assert_claim_detail_carries_card_pack_context;

select 1 / case when (
  select detail -> 'refundAccount' ->> 'maskedAccount' = '국민은행 *********7890'
    and detail -> 'refundAccount' -> 'accountNumber' is null
  from public.admin_order_claim_detail(
    (select id from public.order_cancellation_requests
     where order_id = '41000000-0000-4000-8000-000000000c03')
  ) as detail
) then 1 else 0 end as assert_claim_detail_never_returns_the_raw_account;

reset role;

-- ---------------------------------------------------------------------------
-- 환불계좌 파기 — 원문만 비우고 수집 사실은 남긴다
-- ---------------------------------------------------------------------------
update private.claim_refund_accounts as account
set purge_after = now() - interval '1 day'
where account.claim_id = (
  select id from public.order_cancellation_requests
  where order_id = '41000000-0000-4000-8000-000000000c03'
);

select public.purge_expired_claim_refund_accounts();

select 1 / case when (
  select account.bank_name is null
    and account.account_number is null
    and account.account_holder is null
    and account.purged_at is not null
    and account.masked_account = '국민은행 *********7890'
  from private.claim_refund_accounts as account
  join public.order_cancellation_requests as request on request.id = account.claim_id
  where request.order_id = '41000000-0000-4000-8000-000000000c03'
) then 1 else 0 end as assert_purge_clears_the_raw_account_and_keeps_the_evidence;

rollback;
