\set ON_ERROR_STOP on

-- S4 commerce core (#326) DB 심 스모크.
-- 대상: 20260828100000 goods_commerce_core · 20260828100100 wishlists ·
--       20260828100200 restock_alerts.
-- 검증 축: 스키마 계약(CHECK·유니크·시그니처) / ACL / RLS 본인 격리 /
--          위시 토글 멱등성 / 재입고 전이 트리거의 발화 조건과 팬아웃.

begin;

-- ── 1. goods 확장 계약 ──────────────────────────────────────────────

select 1 / case when exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'goods'
    and column_name = 'compare_at_price'
    and is_nullable = 'YES'
) then 1 else 0 end as assert_goods_compare_at_price_column;

-- 정가는 할인 표기 전용 — 판매가 이하의 값은 테이블 레벨에서 거부된다.
do $$
begin
  begin
    update public.goods set compare_at_price = price where id = 'g1';
    raise exception 'compare_at_price at or below price was accepted' using errcode = 'P7801';
  exception
    when check_violation then null;
  end;
end;
$$;

-- 배지·분류는 표준 값만 남는다(활성/보관 행 전부).
select 1 / case when not exists (
  select 1 from public.goods
  where badge is not null and badge not in ('NEW', 'EXCLUSIVE')
) then 1 else 0 end as assert_goods_badges_standardized;

select 1 / case when not exists (
  select 1 from public.goods
  where type not in ('피규어', '인형', '키링', '아크릴', '문구', '쿠션', '파우치', '세트')
) then 1 else 0 end as assert_goods_types_standardized;

select 1 / case when (
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.goods'::regclass
      and conname = 'goods_badge_check'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.goods'::regclass
      and conname = 'goods_type_check'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.goods'::regclass
      and conname = 'goods_compare_at_price_above_price'
  )
) then 1 else 0 end as assert_goods_value_constraints_exist;

-- admin_upsert_good 은 compare_at_price 를 맨 끝 default 인자로 받는다 —
-- 기존 positional 호출(다른 스모크 3곳)이 그대로 성립해야 한다.
select 1 / case when exists (
  select 1
  from pg_catalog.pg_proc proc
  join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
  where ns.nspname = 'public'
    and proc.proname = 'admin_upsert_good'
    and pg_catalog.pg_get_function_identity_arguments(proc.oid) =
      'target_id text, target_ip_id text, target_name text, target_type text, '
      || 'target_price integer, target_badge text, target_stock text, target_bg text, '
      || 'target_image_path text, target_notice_maker text, target_notice_origin text, '
      || 'target_notice_material text, target_notice_size text, target_notice_made_on text, '
      || 'target_notice_as_manager text, target_notice_as_contact text, target_description text, '
      || 'target_gallery_paths text[], target_detail_image_path text, target_previous_id text, '
      || 'target_compare_at_price integer'
    and proc.prosecdef
) then 1 else 0 end as assert_admin_upsert_good_signature;

select 1 / case when (
  not has_function_privilege(
    'anon',
    'public.admin_upsert_good(text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,integer)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.admin_upsert_good(text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,integer)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.admin_upsert_good(text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,integer)',
    'execute'
  )
) then 1 else 0 end as assert_admin_upsert_good_acl;

-- ── 2. 픽스처 ──────────────────────────────────────────────────────

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000002601', 'authenticated', 'authenticated',
   'commerce-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000002602', 'authenticated', 'authenticated',
   'commerce-other@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000002603', 'authenticated', 'authenticated',
   'commerce-staff@example.test', now(), '{}', '{}', now(), now());

insert into public.profiles (id, email, nickname, birth_date, role, consents, onboarded_at)
values
  ('00000000-0000-4000-8000-000000002601', 'commerce-buyer@example.test',
   'commerce_buyer', '2000-01-01', 'user', '{"terms":true,"privacy":true}'::jsonb, now()),
  ('00000000-0000-4000-8000-000000002602', 'commerce-other@example.test',
   'commerce_other', '2000-01-01', 'user', '{"terms":true,"privacy":true}'::jsonb, now()),
  ('00000000-0000-4000-8000-000000002603', 'commerce-staff@example.test',
   'commerce_staff', '2000-01-01', 'staff', '{"terms":true,"privacy":true}'::jsonb, now())
on conflict (id) do update set role = excluded.role;

insert into public.ips (id, title, vertical_key)
values ('commerce-smoke-ip', '커머스 스모크 IP', 'character');

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('commerce-smoke-good', 'commerce-smoke-ip', '커머스 스모크 굿즈', '키링', 12000, 'soldout', 0),
  ('commerce-smoke-good-b', 'commerce-smoke-ip', '커머스 스모크 굿즈 B', '문구', 8000, 'ok', 5);

-- staff 로 compare_at_price 를 저장·거부해 본다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000002603', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select public.admin_upsert_good(
  'commerce-smoke-good-b', 'commerce-smoke-ip', '커머스 스모크 굿즈 B', '문구',
  8000, 'NEW', 'ok', null, null,
  '(주)아이콘즈', '대한민국', 'PVC', '80x80x30mm / 120g', '2026-07', '아이콘즈 CS', '02-000-0000',
  null, null, null,
  'commerce-smoke-good-b', 12000
);

do $$
begin
  begin
    perform public.admin_upsert_good(
      'commerce-smoke-good-b', 'commerce-smoke-ip', '커머스 스모크 굿즈 B', '문구',
      8000, 'NEW', 'ok', null, null,
      '(주)아이콘즈', '대한민국', 'PVC', '80x80x30mm / 120g', '2026-07', '아이콘즈 CS', '02-000-0000',
      null, null, null,
      'commerce-smoke-good-b', 8000
    );
    raise exception 'compare_at_price at price was accepted by rpc' using errcode = 'P7802';
  exception
    when sqlstate '23514' then null;
  end;
end;
$$;

reset role;

select 1 / case when (
  select compare_at_price = 12000
  from public.goods
  where id = 'commerce-smoke-good-b'
) then 1 else 0 end as assert_rpc_persists_compare_at_price;

-- ── 3. wishlists — RLS 격리와 토글 멱등성 ─────────────────────────

select 1 / case when (
  not has_table_privilege('anon', 'public.wishlists', 'select')
  and has_table_privilege('authenticated', 'public.wishlists', 'select')
  and has_table_privilege('authenticated', 'public.wishlists', 'insert')
  and has_table_privilege('authenticated', 'public.wishlists', 'delete')
  and not has_table_privilege('authenticated', 'public.wishlists', 'update')
) then 1 else 0 end as assert_wishlists_table_acl;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000002601', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- 같은 담기를 두 번 반복해도 1행 — 토글 on 의 멱등성.
insert into public.wishlists (user_id, good_id)
values ('00000000-0000-4000-8000-000000002601', 'commerce-smoke-good')
on conflict (user_id, good_id) do nothing;
insert into public.wishlists (user_id, good_id)
values ('00000000-0000-4000-8000-000000002601', 'commerce-smoke-good')
on conflict (user_id, good_id) do nothing;

select 1 / case when (
  select count(*) = 1 from public.wishlists
  where user_id = '00000000-0000-4000-8000-000000002601'
) then 1 else 0 end as assert_wishlist_toggle_idempotent;

-- 타인 명의 행은 with check 에 막힌다.
do $$
begin
  begin
    insert into public.wishlists (user_id, good_id)
    values ('00000000-0000-4000-8000-000000002602', 'commerce-smoke-good');
    raise exception 'cross-user wishlist insert was accepted' using errcode = 'P7803';
  exception
    when insufficient_privilege or check_violation then null;
    when others then
      if sqlstate <> '42501' then raise; end if;
  end;
end;
$$;

-- 다른 사용자에게는 보이지 않고, 지울 수도 없다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000002602', true);

select 1 / case when (
  select count(*) = 0 from public.wishlists
) then 1 else 0 end as assert_wishlist_hidden_from_others;

delete from public.wishlists
where user_id = '00000000-0000-4000-8000-000000002601';

reset role;

select 1 / case when (
  select count(*) = 1 from public.wishlists
  where user_id = '00000000-0000-4000-8000-000000002601'
) then 1 else 0 end as assert_wishlist_delete_scoped_to_owner;

-- ── 4. restock_alerts — 신청·재신청과 전이 트리거 ─────────────────

-- 클라이언트는 읽기뿐이다 — status·notified_at 은 트리거 소유 상태라, 자기 행이라도
-- 직접 update 로 notified 를 조작(알림 자기 억제·가짜 발송 사이클)할 수 없어야 한다.
-- 이메일 producer 는 service role 로 notified 행을 읽는다(BYPASSRLS 는 privilege 면제가 아니다).
select 1 / case when (
  not has_table_privilege('anon', 'public.restock_alerts', 'select')
  and has_table_privilege('authenticated', 'public.restock_alerts', 'select')
  and not has_table_privilege('authenticated', 'public.restock_alerts', 'insert')
  and not has_table_privilege('authenticated', 'public.restock_alerts', 'update')
  and not has_table_privilege('authenticated', 'public.restock_alerts', 'delete')
  and has_table_privilege('service_role', 'public.restock_alerts', 'select')
) then 1 else 0 end as assert_restock_alerts_table_acl;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_proc proc
  join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
  where ns.nspname = 'public'
    and proc.proname = 'request_restock_alert'
    and pg_catalog.pg_get_function_identity_arguments(proc.oid) = 'target_good_id text'
    and proc.prosecdef
) then 1 else 0 end as assert_request_restock_alert_signature;

select 1 / case when (
  not has_function_privilege('anon', 'public.request_restock_alert(text)', 'execute')
  and has_function_privilege('authenticated', 'public.request_restock_alert(text)', 'execute')
  and not has_function_privilege('service_role', 'public.request_restock_alert(text)', 'execute')
) then 1 else 0 end as assert_request_restock_alert_acl;

select 1 / case when (
  not has_function_privilege('anon', 'private.notify_goods_restock()', 'execute')
  and not has_function_privilege('authenticated', 'private.notify_goods_restock()', 'execute')
  and not has_function_privilege('service_role', 'private.notify_goods_restock()', 'execute')
) then 1 else 0 end as assert_restock_trigger_function_sealed;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000002601', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- 판매 중인 굿즈에는 신청이 성립하지 않는다 — 전이 조건이 영영 참이 안 된다.
do $$
begin
  begin
    perform public.request_restock_alert('commerce-smoke-good-b');
    raise exception 'restock request on a sellable good was accepted' using errcode = 'P7804';
  exception
    when sqlstate '22023' then null;
  end;
end;
$$;

select public.request_restock_alert('commerce-smoke-good');

reset role;

select 1 / case when (
  select count(*) = 1 from public.restock_alerts
  where user_id = '00000000-0000-4000-8000-000000002601'
    and good_id = 'commerce-smoke-good'
    and status = 'pending'
) then 1 else 0 end as assert_rpc_created_pending_alert;

-- 판매 불가 상태 안에서의 변화(품절 유지)는 발화하지 않는다.
update public.goods set stock_qty = 0, stock = 'soldout'
where id = 'commerce-smoke-good';

select 1 / case when (
  select count(*) = 0 from public.notifications where type = 'restock_available'
) then 1 else 0 end as assert_no_notification_without_transition;

-- 품절 → 판매 가능 전이: pending 이 notified 로 넘어가고 알림함에 쌓인다.
update public.goods set stock = 'ok', stock_qty = 10
where id = 'commerce-smoke-good';

select 1 / case when (
  select status = 'notified' and notified_at is not null
  from public.restock_alerts
  where user_id = '00000000-0000-4000-8000-000000002601'
    and good_id = 'commerce-smoke-good'
) then 1 else 0 end as assert_alert_flipped_to_notified;

select 1 / case when (
  select count(*) = 1
  from public.notifications
  where user_id = '00000000-0000-4000-8000-000000002601'
    and type = 'restock_available'
    and link_path = '/shop/commerce-smoke-good'
) then 1 else 0 end as assert_restock_notification_fanned_out;

-- 판매 가능 상태 안에서의 재고 변화는 재발화하지 않는다.
update public.goods set stock_qty = 20 where id = 'commerce-smoke-good';

select 1 / case when (
  select count(*) = 1 from public.notifications where type = 'restock_available'
) then 1 else 0 end as assert_no_refire_while_sellable;

-- 재품절 → 재신청 → 재입고 사이클이 성립한다(dedupe 키가 사이클마다 다르다).
update public.goods set stock = 'soldout', stock_qty = 0
where id = 'commerce-smoke-good';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000002601', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select public.request_restock_alert('commerce-smoke-good');

reset role;

select 1 / case when (
  select count(*) = 1 from public.restock_alerts
  where user_id = '00000000-0000-4000-8000-000000002601'
    and good_id = 'commerce-smoke-good'
    and status = 'pending'
) then 1 else 0 end as assert_reapply_restores_pending_single_row;

update public.goods set stock = 'ok', stock_qty = 3
where id = 'commerce-smoke-good';

select 1 / case when (
  select count(*) = 2
  from public.notifications
  where user_id = '00000000-0000-4000-8000-000000002601'
    and type = 'restock_available'
) then 1 else 0 end as assert_second_cycle_notifies_again;

-- ── 5. 발송 채널 계약 — 알림 type 과 메일 template ─────────────────

select 1 / case when exists (
  select 1
  from pg_constraint
  where conrelid = 'public.notifications'::regclass
    and conname = 'notifications_type_check'
    and pg_get_constraintdef(oid) like '%restock_available%'
) then 1 else 0 end as assert_notifications_type_includes_restock;

select 1 / case when exists (
  select 1
  from pg_constraint
  where conrelid = 'public.email_deliveries'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%restock_alert%'
) then 1 else 0 end as assert_email_template_includes_restock;

set local role service_role;

select 1 / case when (
  select public.claim_email_delivery(
    'restock:commerce-smoke-claim',
    'restock_alert',
    'commerce-buyer@example.test',
    '재입고 알림'
  )
) then 1 else 0 end as assert_claim_accepts_restock_template;

reset role;

rollback;
