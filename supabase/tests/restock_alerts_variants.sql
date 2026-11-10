\set ON_ERROR_STOP on

-- LFS 패리티 2차 L2 (#567) — PD-11 옵션 단위 재입고 알림 스모크.
-- 대상: 20261023010000_restock_alert_variants.
-- 검증 축: 스키마·ACL 계약 / 신청 RPC(옵션·굿즈 단위, 거절 코드, 계정 fence, 멱등) /
--          옵션 전이(다른 옵션 판매 중 + 옵션 B 0→양수) / 굿즈 전이와의 중복 없는 팬아웃 /
--          부모 굿즈 판매 가능 게이트 / 재고 트랜잭션(주문 생성·취소 환원) 안 무예외 /
--          팬아웃 실패 시 재고 쓰기 보존 / dedupe 키 / RLS / 굿즈 URL 변경·옵션 삭제 전파 /
--          예약판매 옵션의 실물 입고는 재입고가 아님·재고 판매 전환이 깨움 / 사용 중지 옵션 복원이 깨움 /
--          판매 기간이 닫힌 동안 깨우지 않음·판매 기간·결제수단이 다시 열리면 깨움 / IP 재공개는 청소 작업이 깨움.
-- 모든 단언은 이 파일의 픽스처 행으로만 센다(전역 개수 단언 없음). 끝은 rollback.

begin;

-- ── 1. 스키마·ACL 계약 ─────────────────────────────────────────────

select 1 / case when exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'restock_alerts'
    and column_name = 'variant_id' and data_type = 'uuid' and is_nullable = 'YES'
) then 1 else 0 end as assert_variant_key_column;

-- NULL(모든 옵션) 신청도 사용자×굿즈당 1행이어야 한다 — 평범한 unique 는 NULL 중복을 막지 못한다.
select 1 / case when (
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.restock_alerts'::regclass
      and conname = 'restock_alerts_user_good_variant_key'
      and pg_get_constraintdef(oid) = 'UNIQUE NULLS NOT DISTINCT (user_id, good_id, variant_id)'
  )
  and not exists (
    select 1 from pg_constraint
    where conrelid = 'public.restock_alerts'::regclass and conname = 'restock_alerts_user_good_key'
  )
) then 1 else 0 end as assert_variant_uniqueness_contract;

select 1 / case when exists (
  select 1 from pg_constraint
  where conrelid = 'public.restock_alerts'::regclass
    and conname = 'restock_alerts_variant_good_fkey'
    and confrelid = 'public.goods_variants'::regclass
    and condeferrable and condeferred
    and confupdtype = 'c' and confdeltype = 'c'
) then 1 else 0 end as assert_variant_belongs_to_good_fkey;

select 1 / case when exists (
  select 1 from pg_proc proc join pg_namespace ns on ns.oid = proc.pronamespace
  where ns.nspname = 'public' and proc.proname = 'request_variant_restock_alert'
    and pg_get_function_identity_arguments(proc.oid) = 'target_good_id text, target_variant_id uuid'
    and proc.prosecdef
) then 1 else 0 end as assert_variant_request_signature;

-- 권한 없는 호출은 선언으로 단언한다(CI 의 Postgres 패치 버전에 따라 런타임 거절 모양이 다르다).
select 1 / case when (
  not has_function_privilege('anon', 'public.request_variant_restock_alert(text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.request_variant_restock_alert(text,uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.request_variant_restock_alert(text,uuid)', 'execute')
  and not has_function_privilege('public', 'public.request_variant_restock_alert(text,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.request_restock_alert(text)', 'execute')
  and has_function_privilege('authenticated', 'public.request_restock_alert(text)', 'execute')
  and not has_function_privilege('service_role', 'public.request_restock_alert(text)', 'execute')
) then 1 else 0 end as assert_request_rpc_acl;

select 1 / case when (
  not has_function_privilege('anon', 'private.wake_restock_alerts(public.goods,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.wake_restock_alerts(public.goods,uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.wake_restock_alerts(public.goods,uuid)', 'execute')
  and not has_function_privilege('anon', 'private.notify_goods_variant_restock()', 'execute')
  and not has_function_privilege('authenticated', 'private.notify_goods_variant_restock()', 'execute')
  and not has_function_privilege('service_role', 'private.notify_goods_variant_restock()', 'execute')
  and not has_function_privilege('anon', 'private.notify_goods_restock()', 'execute')
  and not has_function_privilege('authenticated', 'private.notify_goods_restock()', 'execute')
  and not has_function_privilege('service_role', 'private.notify_goods_restock()', 'execute')
) then 1 else 0 end as assert_restock_internals_sealed;

-- 클라이언트는 여전히 읽기뿐이다(신청은 RPC, 전이는 트리거 소유).
select 1 / case when (
  has_table_privilege('authenticated', 'public.restock_alerts', 'select')
  and not has_table_privilege('authenticated', 'public.restock_alerts', 'insert')
  and not has_table_privilege('authenticated', 'public.restock_alerts', 'update')
  and not has_table_privilege('authenticated', 'public.restock_alerts', 'delete')
  and not has_table_privilege('anon', 'public.restock_alerts', 'select')
) then 1 else 0 end as assert_restock_table_acl_unchanged;

select 1 / case when exists (
  select 1 from pg_trigger
  where tgrelid = 'public.goods_variants'::regclass
    and tgname = 'goods_variants_restock_notify'
    and not tgisinternal
    and pg_get_triggerdef(oid) like 'CREATE TRIGGER goods_variants_restock_notify AFTER UPDATE OF stock_qty, archived_at, preorder_policy_id ON public.goods_variants FOR EACH ROW WHEN %'
    -- 재고로 살 수 있는 옵션 = 사용 중 · 재고 판매(예약판매 아님) · 재고 > 0. 전후 모두 이 술어로 본다.
    and pg_get_triggerdef(oid) like '%(new.preorder_policy_id IS NULL)%(old.preorder_policy_id IS NULL)%'
) then 1 else 0 end as assert_variant_transition_trigger;

-- 재고 외 판매 가능 조건 판정·청소 작업도 봉인이다.
select 1 / case when (
  not has_function_privilege('anon', 'private.restock_parent_open(public.goods)', 'execute')
  and not has_function_privilege('authenticated', 'private.restock_parent_open(public.goods)', 'execute')
  and not has_function_privilege('service_role', 'private.restock_parent_open(public.goods)', 'execute')
  and not has_function_privilege('anon', 'private.sweep_restock_alerts()', 'execute')
  and not has_function_privilege('authenticated', 'private.sweep_restock_alerts()', 'execute')
  and not has_function_privilege('service_role', 'private.sweep_restock_alerts()', 'execute')
) then 1 else 0 end as assert_restock_gate_and_sweep_sealed;

-- 굿즈 트리거는 재고 외 판매 가능 조건을 바꾸는 칸에도 발화한다.
select 1 / case when exists (
  select 1 from pg_trigger
  where tgrelid = 'public.goods'::regclass
    and tgname = 'trg_goods_notify_restock'
    and not tgisinternal
    and pg_get_triggerdef(oid) = 'CREATE TRIGGER trg_goods_notify_restock AFTER UPDATE OF stock, stock_qty, archived_at, published_at, sale_restriction, allow_card_payment, allow_bank_transfer, sale_starts_at, sale_ends_at ON public.goods FOR EACH ROW EXECUTE FUNCTION private.notify_goods_restock()'
) then 1 else 0 end as assert_goods_trigger_watches_parent_gate_columns;

-- 행이 바뀌지 않는 전이(IP 재공개, 판매 기간 시작 시각)는 5분 주기 청소 작업이 맡는다.
select 1 / case when (
  select count(*) = 1 from cron.job
  where jobname = 'sweep-restock-alerts' and schedule = '*/5 * * * *'
    and command = 'select private.sweep_restock_alerts()'
) then 1 else 0 end as assert_restock_sweep_scheduled;

-- 옵션 전이 트리거는 재고 캐시 갱신 트리거 뒤에 돈다(같은 시점 AFTER 트리거는 이름순).
select 1 / case when 'goods_variants_refresh_stock' < 'goods_variants_restock_notify'
  then 1 else 0 end as assert_variant_trigger_runs_after_stock_refresh;

-- ── 2. 픽스처 ──────────────────────────────────────────────────────

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000056701', 'authenticated', 'authenticated', 'restock-variant-a@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000056702', 'authenticated', 'authenticated', 'restock-variant-b@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000056703', 'authenticated', 'authenticated', 'restock-variant-fenced@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000056704', 'authenticated', 'authenticated', 'restock-variant-operator@example.test', now(), '{}', '{}', now(), now());

update public.profiles
set nickname = 'restock_variant_' || right(id::text, 2), birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}'::jsonb, onboarded_at = now()
where id in ('00000000-0000-4000-8000-000000056701', '00000000-0000-4000-8000-000000056702', '00000000-0000-4000-8000-000000056703');

-- 탈퇴 신청으로 쓰기가 봉인된 계정(fence 행이 요청 행을 FK 로 문다).
insert into private.account_deletion_requests (deletion_event_id, subject_user_id, idempotency_key, status)
values ('00000000-0000-4000-8000-000000056790', '00000000-0000-4000-8000-000000056703',
  '00000000-0000-4000-8000-000000056791', 'blocked_active_obligation');
insert into private.account_action_fences (subject_user_id, deletion_event_id)
values ('00000000-0000-4000-8000-000000056703', '00000000-0000-4000-8000-000000056790');

insert into public.ips (id, title, vertical_key, published_at)
values ('restock-variant-ip', '옵션 재입고 스모크 IP', 'character', now());

-- KC 픽스처 검토자에게 운영 권한을 준다. 러너(with-legacy-operator-fixtures)의 레거시 픽스처 안에서는
-- staff 역할이 그대로 운영자로 잡히므로 손대지 않고, 그 밖(격리 스택 단독 실행)에서는 검토자별
-- 명시 멤버십을 둔다(goods_sale_period.sql 과 같은 방식). 어느 쪽이든 이 트랜잭션과 함께 되돌아간다.
do $$
declare
  fixture_good text;
  reviewer uuid;
begin
  if to_regclass('private.operator_legacy_fixture_control') is not null then
    return;
  end if;
  update private.operator_access_state set configured = true where id;
  foreach fixture_good in array array['restock-variant-good', 'restock-variant-soldout', 'restock-variant-archived-stock',
    'restock-variant-preorder', 'restock-variant-restore', 'restock-variant-gate'] loop
    reviewer := ('47c47700' || left(md5(fixture_good), 24))::uuid;
    insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values (reviewer, 'authenticated', 'authenticated', 'restock-variant-kc-' || left(md5(fixture_good), 8) || '@example.test',
      '{"testFixture":"goods-kc"}', now(), now());
    insert into private.operator_memberships (profile_id, manager_role) values (reviewer, 'primary');
  end loop;
  -- 재고 판매 전환(admin_use_stock_supply)을 실행할 관리자.
  insert into private.operator_memberships (profile_id, manager_role)
  values ('00000000-0000-4000-8000-000000056704', 'primary');
end $$;

-- 레거시 픽스처 안에서는 이 역할 변경이 운영자 코호트로 잡히고, 밖에서는 위 멤버십이 권한을 준다.
update public.profiles set role = 'admin', nickname = 'restock_variant_op'
where id = '00000000-0000-4000-8000-000000056704';

-- 굿즈 1: 옵션 A 판매 중(20) · B 품절(0) · C 품절(0) · 보관 옵션 Z.
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, published_at)
values ('restock-variant-good', 'restock-variant-ip', '옵션 재입고 굿즈', '키링', 10000, 'ok', 20, null);
update public.goods_variants set name = '옵션 A'
where good_id = 'restock-variant-good' and is_default;
insert into public.goods_variants (id, good_id, name, price, stock_qty, sort_order)
values
  ('00000000-0000-4000-8000-000000056711', 'restock-variant-good', '옵션 B', 11000, 0, 1),
  ('00000000-0000-4000-8000-000000056712', 'restock-variant-good', '옵션 C', 12000, 0, 2);
insert into public.goods_variants (id, good_id, name, price, stock_qty, sort_order, archived_at)
values ('00000000-0000-4000-8000-000000056719', 'restock-variant-good', '옵션 Z(중지)', 10000, 0, 9, now());
select pg_temp.publish_goods_kc_fixture('restock-variant-good');

-- 굿즈 2: 모든 옵션 품절(D 기본 0 · E 0).
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, published_at)
values ('restock-variant-soldout', 'restock-variant-ip', '전부 품절 굿즈', '키링', 9000, 'ok', 0, null);
update public.goods_variants set name = '옵션 D'
where good_id = 'restock-variant-soldout' and is_default;
insert into public.goods_variants (id, good_id, name, price, stock_qty, sort_order)
values ('00000000-0000-4000-8000-000000056721', 'restock-variant-soldout', '옵션 E', 9500, 0, 1);
select pg_temp.publish_goods_kc_fixture('restock-variant-soldout');

-- 굿즈 3: 사용 중 옵션 F 품절(0) + 보관 옵션 G 재고 3. 캐시(goods.stock_qty=3)는 판매 가능처럼 보이지만
-- 공개 화면은 품절이다.
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, published_at)
values ('restock-variant-archived-stock', 'restock-variant-ip', '보관 재고 굿즈', '키링', 8000, 'ok', 0, null);
update public.goods_variants set name = '옵션 F'
where good_id = 'restock-variant-archived-stock' and is_default;
insert into public.goods_variants (id, good_id, name, price, stock_qty, sort_order, archived_at)
values ('00000000-0000-4000-8000-000000056731', 'restock-variant-archived-stock', '옵션 G(중지)', 8000, 3, 1, now());
select pg_temp.publish_goods_kc_fixture('restock-variant-archived-stock');

select 1 / case when (
  (select stock_qty from public.goods where id = 'restock-variant-good') = 20
  and (select stock_qty from public.goods where id = 'restock-variant-soldout') = 0
  and (select stock_qty from public.goods where id = 'restock-variant-archived-stock') = 3
  and (select count(*) from public.goods where id like 'restock-variant-%' and published_at is not null) = 3
) then 1 else 0 end as assert_fixture_ready;

-- ── 3. 신청 RPC ─────────────────────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056701', true);

-- 굿즈는 판매 중이고 옵션 B 만 품절 — 옵션 신청이 성립한다. 두 번 눌러도 1행.
select public.request_variant_restock_alert('restock-variant-good', '00000000-0000-4000-8000-000000056711');
select public.request_variant_restock_alert('restock-variant-good', '00000000-0000-4000-8000-000000056711');

-- 판매 중인 굿즈의 굿즈 단위 신청은 성립하지 않는다(기존 계약 유지).
do $$ begin
  perform public.request_restock_alert('restock-variant-good');
  raise exception 'goods-level request on a sellable good was accepted' using errcode = 'P5671';
exception when sqlstate '22023' then null; end $$;

-- 판매 중인 옵션 A 의 옵션 신청은 성립하지 않는다.
do $$ begin
  perform public.request_variant_restock_alert('restock-variant-good',
    (select id from public.goods_variants where good_id = 'restock-variant-good' and is_default));
  raise exception 'variant request on a sellable option was accepted' using errcode = 'P5672';
exception when sqlstate '22023' then null; end $$;

-- 다른 굿즈의 옵션·보관 옵션·없는 옵션은 good/variant missing 이다.
do $$ begin
  perform public.request_variant_restock_alert('restock-variant-good', '00000000-0000-4000-8000-000000056721');
  raise exception 'variant of another good was accepted' using errcode = 'P5673';
exception when sqlstate 'P0002' then null; end $$;
do $$ begin
  perform public.request_variant_restock_alert('restock-variant-good', '00000000-0000-4000-8000-000000056719');
  raise exception 'archived variant was accepted' using errcode = 'P5674';
exception when sqlstate 'P0002' then null; end $$;
do $$ begin
  perform public.request_variant_restock_alert('restock-variant-missing', '00000000-0000-4000-8000-000000056711');
  raise exception 'variant of a missing good was accepted' using errcode = 'P5675';
exception when sqlstate 'P0002' then null; end $$;
do $$ begin
  perform public.request_variant_restock_alert('restock-variant-good', null);
  raise exception 'null variant was accepted' using errcode = 'P5676';
exception when sqlstate 'P0002' then null; end $$;

-- 전부 품절 굿즈: A 는 굿즈 단위(모든 옵션), B 는 옵션 E 단위로 신청한다.
select public.request_restock_alert('restock-variant-soldout');
select public.request_restock_alert('restock-variant-soldout');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056702', true);
select public.request_variant_restock_alert('restock-variant-soldout', '00000000-0000-4000-8000-000000056721');
-- B 는 굿즈 1 의 옵션 C 도 기다린다.
select public.request_variant_restock_alert('restock-variant-good', '00000000-0000-4000-8000-000000056712');

-- 보관 옵션에만 재고가 남은 굿즈는 공개 화면처럼 품절로 보고 굿즈 단위 신청을 받는다.
select public.request_restock_alert('restock-variant-archived-stock');

-- 로그인 없는 호출은 auth_required(28000).
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  perform public.request_variant_restock_alert('restock-variant-good', '00000000-0000-4000-8000-000000056711');
  raise exception 'anonymous variant request was accepted' using errcode = 'P5677';
exception when sqlstate '28000' then null; end $$;

-- 탈퇴 신청으로 봉인된 계정은 어느 쪽도 신청하지 못한다(계정 fence 관례).
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056703', true);
do $$ begin
  perform public.request_variant_restock_alert('restock-variant-good', '00000000-0000-4000-8000-000000056711');
  raise exception 'fenced account variant request was accepted' using errcode = 'P5678';
exception when sqlstate '55000' then null; end $$;
do $$ begin
  perform public.request_restock_alert('restock-variant-soldout');
  raise exception 'fenced account goods request was accepted' using errcode = 'P5679';
exception when sqlstate '55000' then null; end $$;

-- RLS: 본인 행만 보인다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056702', true);
select 1 / case when (
  (select count(*) from public.restock_alerts where user_id = '00000000-0000-4000-8000-000000056701') = 0
  and (select count(*) from public.restock_alerts where user_id = '00000000-0000-4000-8000-000000056702') = 3
) then 1 else 0 end as assert_rls_self_only;

reset role;

select 1 / case when (
  (select count(*) from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056701' and good_id = 'restock-variant-good'
      and variant_id = '00000000-0000-4000-8000-000000056711' and status = 'pending') = 1
  and (select count(*) from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056701' and good_id = 'restock-variant-soldout'
      and variant_id is null and status = 'pending') = 1
  and (select count(*) from public.restock_alerts where user_id = '00000000-0000-4000-8000-000000056703') = 0
) then 1 else 0 end as assert_requests_idempotent_single_rows;

-- ── 4. 옵션 A 판매 중 + 옵션 B 0→양수 ───────────────────────────────
-- 굿즈 행은 전후 모두 판매 가능이라 굿즈 단위 전이는 깨우지 않는다. 옵션 행의 전이가 B 신청만 깨운다.
-- 재고 변경은 주문 생성·취소 환원·재고 조정이 함께 쓰는 내부 쓰기 경로로 한다.
select private.change_goods_variant_stock('restock-variant-good', '00000000-0000-4000-8000-000000056711', 3);

select 1 / case when (
  (select status from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056701' and variant_id = '00000000-0000-4000-8000-000000056711') = 'notified'
  and (select status from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056702' and variant_id = '00000000-0000-4000-8000-000000056712') = 'pending'
) then 1 else 0 end as assert_variant_transition_wakes_only_that_option;

select 1 / case when (
  select count(*) = 1 from public.notifications
  where user_id = '00000000-0000-4000-8000-000000056701'
    and type = 'restock_available'
    and source_id = 'restock-variant-good'
    and title = '재입고 알림'
    and body = '옵션 재입고 굿즈 · 옵션 B 옵션이 다시 판매를 시작했어요.'
    and link_path = '/shop/restock-variant-good?variant=00000000-0000-4000-8000-000000056711'
    and dedupe_key ~ '^restock:00000000-0000-4000-8000-000000056711:[0-9]+$'
) then 1 else 0 end as assert_variant_notification_names_the_option;

select 1 / case when (
  select count(*) = 0 from public.notifications
  where user_id = '00000000-0000-4000-8000-000000056702' and source_id = 'restock-variant-good'
) then 1 else 0 end as assert_other_option_subscriber_not_notified;

-- 판매 가능 상태 안의 재고 변화와 재품절→재입고(재신청 없음)는 다시 보내지 않는다.
select private.change_goods_variant_stock('restock-variant-good', '00000000-0000-4000-8000-000000056711', 2);
select private.change_goods_variant_stock('restock-variant-good', '00000000-0000-4000-8000-000000056711', -5);
select private.change_goods_variant_stock('restock-variant-good', '00000000-0000-4000-8000-000000056711', 4);

select 1 / case when (
  select count(*) = 1 from public.notifications
  where user_id = '00000000-0000-4000-8000-000000056701' and source_id = 'restock-variant-good'
) then 1 else 0 end as assert_no_refire_without_new_request;

-- 같은 신청을 두 번 깨워도(직접 두 번 불러도) 전이·알림은 한 번이다.
select 1 / case when private.wake_restock_alerts(
  (select good from public.goods as good where good.id = 'restock-variant-good'),
  '00000000-0000-4000-8000-000000056711'
) = 0 then 1 else 0 end as assert_second_wake_is_noop;

-- 재품절 → 재신청 → 재입고 사이클은 새 알림이다(사이클마다 다른 dedupe 키).
select private.change_goods_variant_stock('restock-variant-good', '00000000-0000-4000-8000-000000056711', -4);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056701', true);
select public.request_variant_restock_alert('restock-variant-good', '00000000-0000-4000-8000-000000056711');
reset role;
select 1 / case when (
  select status = 'pending' and notified_at is null from public.restock_alerts
  where user_id = '00000000-0000-4000-8000-000000056701' and variant_id = '00000000-0000-4000-8000-000000056711'
) then 1 else 0 end as assert_rerequest_restores_pending;
select pg_catalog.pg_sleep(0.005);
select private.change_goods_variant_stock('restock-variant-good', '00000000-0000-4000-8000-000000056711', 1);
select 1 / case when (
  select count(*) = 2 and count(distinct dedupe_key) = 2 from public.notifications
  where user_id = '00000000-0000-4000-8000-000000056701' and source_id = 'restock-variant-good'
) then 1 else 0 end as assert_second_cycle_notifies_again;

-- ── 5. 부모 굿즈의 재고 외 판매 가능 게이트 ─────────────────────────
-- B 를 다시 품절시키고 재신청한 뒤, 굿즈를 품절 표시(stock='soldout')로 내린 채 B 를 채운다 → 깨우지 않는다.
select private.change_goods_variant_stock('restock-variant-good', '00000000-0000-4000-8000-000000056711', -1);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056701', true);
select public.request_variant_restock_alert('restock-variant-good', '00000000-0000-4000-8000-000000056711');
reset role;
update public.goods set stock = 'soldout' where id = 'restock-variant-good';
select private.change_goods_variant_stock('restock-variant-good', '00000000-0000-4000-8000-000000056711', 2);
select 1 / case when (
  select status = 'pending' from public.restock_alerts
  where user_id = '00000000-0000-4000-8000-000000056701' and variant_id = '00000000-0000-4000-8000-000000056711'
) then 1 else 0 end as assert_parent_soldout_flag_holds_variant_alert;

-- 굿즈가 다시 판매 가능해지면(굿즈 단위 전이) 지금 살 수 있는 옵션의 신청을 깨운다.
-- 옵션 C 는 여전히 품절이라 그 신청은 남는다.
update public.goods set stock = 'ok' where id = 'restock-variant-good';
select 1 / case when (
  (select status from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056701' and variant_id = '00000000-0000-4000-8000-000000056711') = 'notified'
  and (select status from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056702' and variant_id = '00000000-0000-4000-8000-000000056712') = 'pending'
  and (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056701' and source_id = 'restock-variant-good') = 3
) then 1 else 0 end as assert_goods_transition_wakes_purchasable_option_alerts;

-- 비공개(초안)로 내린 굿즈의 옵션이 채워져도 깨우지 않는다.
update public.goods set published_at = null where id = 'restock-variant-good';
select private.change_goods_variant_stock('restock-variant-good', '00000000-0000-4000-8000-000000056712', 2);
select 1 / case when (
  select status = 'pending' from public.restock_alerts
  where user_id = '00000000-0000-4000-8000-000000056702' and variant_id = '00000000-0000-4000-8000-000000056712'
) then 1 else 0 end as assert_unpublished_parent_holds_variant_alert;
update public.goods set published_at = clock_timestamp() where id = 'restock-variant-good';
select 1 / case when (
  (select status from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056702' and variant_id = '00000000-0000-4000-8000-000000056712') = 'notified'
  and exists (select 1 from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056702'
      and link_path = '/shop/restock-variant-good?variant=00000000-0000-4000-8000-000000056712'
      and body = '옵션 재입고 굿즈 · 옵션 C 옵션이 다시 판매를 시작했어요.')
) then 1 else 0 end as assert_republish_wakes_waiting_option;

-- ── 6. 모든 옵션 품절 → 옵션 E 0→양수 (굿즈 전이와 옵션 전이가 함께 일어난다) ─
select private.change_goods_variant_stock('restock-variant-soldout', '00000000-0000-4000-8000-000000056721', 4);

select 1 / case when (
  (select status from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056701' and good_id = 'restock-variant-soldout' and variant_id is null) = 'notified'
  and (select status from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056702' and variant_id = '00000000-0000-4000-8000-000000056721') = 'notified'
) then 1 else 0 end as assert_goods_and_variant_alerts_both_woken;

-- 두 갈래가 같은 신청을 함께 보았어도 신청마다 알림은 정확히 하나다.
select 1 / case when (
  (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056701' and source_id = 'restock-variant-soldout'
      and link_path = '/shop/restock-variant-soldout'
      and body = '전부 품절 굿즈 굿즈가 다시 판매를 시작했어요.'
      and dedupe_key ~ '^restock:restock-variant-soldout:[0-9]+$') = 1
  and (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056701' and source_id = 'restock-variant-soldout') = 1
  and (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056702' and source_id = 'restock-variant-soldout'
      and link_path = '/shop/restock-variant-soldout?variant=00000000-0000-4000-8000-000000056721') = 1
  and (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056702' and source_id = 'restock-variant-soldout') = 1
) then 1 else 0 end as assert_single_notification_per_alert;

-- ── 7. 보관 옵션 재고만 남은 굿즈 — 사용 중 옵션 F 0→양수가 "모든 옵션" 신청을 깨운다 ─
-- 캐시(goods.stock_qty)는 3→5 로 판매 가능→판매 가능이라 굿즈 단위 전이는 없다.
select private.change_goods_variant_stock('restock-variant-archived-stock',
  (select id from public.goods_variants where good_id = 'restock-variant-archived-stock' and is_default), 2);
select 1 / case when (
  (select status from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056702' and good_id = 'restock-variant-archived-stock') = 'notified'
  and (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056702' and source_id = 'restock-variant-archived-stock') = 1
) then 1 else 0 end as assert_active_option_restock_wakes_all_options_alert;

-- ── 8. 재고 트랜잭션 안에서 예외를 던지지 않는다 ─────────────────────
-- 8a. 실제 주문 생성(재고 차감)과 취소 환원(재고 복원) 경로에 pending 옵션 신청이 걸린 채로 돈다.
--     옵션 C 를 품절까지 사고(2개), 그 사이 B(판매자 A)가 C 를 다시 신청한 뒤, 주문 품목을 환원한다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056701', true);
select public.set_cart_item_quantity('restock-variant-good', '00000000-0000-4000-8000-000000056712', 2);
reset role;
select public.place_order('00000000-0000-4000-8000-000000056701',
  '{"recipientName":"테스트","phone":"01012345678","postalCode":"00000","address1":"배송 금지 테스트 주소"}',
  '00000000-0000-4000-8000-000000056780', 'card') as restock_order_id \gset
select 1 / case when (
  select stock_qty = 0 from public.goods_variants where id = '00000000-0000-4000-8000-000000056712'
) then 1 else 0 end as assert_order_consumed_option_stock;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056702', true);
select public.request_variant_restock_alert('restock-variant-good', '00000000-0000-4000-8000-000000056712');
reset role;

select private.restore_order_item_supply(item.id, '재입고 스모크 환원')
from public.order_items as item
where item.order_id = :'restock_order_id' and item.variant_id = '00000000-0000-4000-8000-000000056712';

select 1 / case when (
  (select stock_qty from public.goods_variants where id = '00000000-0000-4000-8000-000000056712') = 2
  and (select status from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056702' and variant_id = '00000000-0000-4000-8000-000000056712') = 'notified'
  and (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056702'
      and link_path = '/shop/restock-variant-good?variant=00000000-0000-4000-8000-000000056712') = 2
) then 1 else 0 end as assert_cancellation_restore_wakes_without_exception;

-- 8b. 팬아웃이 실패해도 재고 쓰기는 커밋 경로에 남고 신청은 pending 으로 남는다.
--     (이 트랜잭션 안에서만 알림함에 재입고 알림을 거부하는 제약을 걸어 실패를 만든다.)
select private.change_goods_variant_stock('restock-variant-good', '00000000-0000-4000-8000-000000056712', -2);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056702', true);
select public.request_variant_restock_alert('restock-variant-good', '00000000-0000-4000-8000-000000056712');
reset role;
alter table public.notifications
  add constraint restock_variants_smoke_reject check (type <> 'restock_available') not valid;
select private.change_goods_variant_stock('restock-variant-good', '00000000-0000-4000-8000-000000056712', 5);
select 1 / case when (
  (select stock_qty from public.goods_variants where id = '00000000-0000-4000-8000-000000056712') = 5
  and (select status from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056702' and variant_id = '00000000-0000-4000-8000-000000056712') = 'pending'
) then 1 else 0 end as assert_failed_fanout_keeps_stock_and_pending_alert;
alter table public.notifications drop constraint restock_variants_smoke_reject;

-- ── 9. 메일 dedupe 키 — 옵션 키 형식이 클레임 게이트를 통과하고 같은 키는 다시 열리지 않는다 ─
set local role service_role;
select 1 / case when (
  public.claim_email_delivery(
    'restock_alert:00000000-0000-4000-8000-0000000567aa:00000000-0000-4000-8000-000000056711:2026-10-23T01:00:00.123456+00:00',
    'restock_alert', 'restock-variant-a@example.test', '[ICONS] 재입고 알림 — 옵션 재입고 굿즈 · 옵션 B')
  and not public.claim_email_delivery(
    'restock_alert:00000000-0000-4000-8000-0000000567aa:00000000-0000-4000-8000-000000056711:2026-10-23T01:00:00.123456+00:00',
    'restock_alert', 'restock-variant-a@example.test', '[ICONS] 재입고 알림 — 옵션 재입고 굿즈 · 옵션 B')
) then 1 else 0 end as assert_variant_email_key_claims_once;

-- 메일 producer(service role)는 goods_variants 를 직접 읽지 못한다. 봉인된 RPC 가 notified 옵션 신청이
-- 가리키는 옵션 이름만 돌려준다(pending 인 옵션 C 신청은 아직 메일 대상이 아니다).
select 1 / case when (
  select array_agg(option_name order by option_name) = array['옵션 B']
  from public.service_restock_alert_option_names('restock-variant-good')
) then 1 else 0 end as assert_service_option_names_for_notified_alerts;
reset role;

select 1 / case when (
  has_function_privilege('service_role', 'public.service_restock_alert_option_names(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.service_restock_alert_option_names(text)', 'execute')
  and not has_function_privilege('anon', 'public.service_restock_alert_option_names(text)', 'execute')
  and not has_function_privilege('public', 'public.service_restock_alert_option_names(text)', 'execute')
  and not has_table_privilege('service_role', 'public.goods_variants', 'select')
) then 1 else 0 end as assert_service_option_names_sealed;

-- ── 10. 굿즈 URL 변경·옵션 삭제가 옵션 신청을 따라간다 ───────────────
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, published_at)
values ('restock-variant-draft', 'restock-variant-ip', '초안 굿즈', '키링', 7000, 'ok', 0, null);
insert into public.goods_variants (id, good_id, name, price, stock_qty, sort_order)
values
  ('00000000-0000-4000-8000-000000056741', 'restock-variant-draft', '옵션 H', 7000, 0, 1),
  ('00000000-0000-4000-8000-000000056742', 'restock-variant-draft', '옵션 I', 7000, 0, 2);
insert into public.restock_alerts (user_id, good_id, variant_id)
values
  ('00000000-0000-4000-8000-000000056701', 'restock-variant-draft', '00000000-0000-4000-8000-000000056741'),
  ('00000000-0000-4000-8000-000000056701', 'restock-variant-draft', '00000000-0000-4000-8000-000000056742'),
  ('00000000-0000-4000-8000-000000056701', 'restock-variant-draft', null);

-- NULL(모든 옵션) 신청은 사용자×굿즈당 하나다.
do $$ begin
  insert into public.restock_alerts (user_id, good_id, variant_id)
  values ('00000000-0000-4000-8000-000000056701', 'restock-variant-draft', null);
  raise exception 'duplicate all-options alert was accepted' using errcode = 'P5680';
exception when unique_violation then null; end $$;

-- 다른 굿즈의 옵션을 가리키는 신청은 (커밋 시점 검사를 즉시로 당겨) 거부된다.
do $$ begin
  insert into public.restock_alerts (user_id, good_id, variant_id)
  values ('00000000-0000-4000-8000-000000056702', 'restock-variant-draft', '00000000-0000-4000-8000-000000056711');
  set constraints restock_alerts_variant_good_fkey immediate;
  raise exception 'variant of another good was accepted by the table' using errcode = 'P5681';
exception when foreign_key_violation then null; end $$;
set constraints restock_alerts_variant_good_fkey deferred;

update public.goods set id = 'restock-variant-renamed' where id = 'restock-variant-draft';
set constraints restock_alerts_variant_good_fkey immediate;
select 1 / case when (
  (select count(*) from public.restock_alerts where good_id = 'restock-variant-renamed') = 3
  and (select count(*) from public.restock_alerts where good_id = 'restock-variant-draft') = 0
  and exists (select 1 from public.restock_alerts
    where good_id = 'restock-variant-renamed' and variant_id = '00000000-0000-4000-8000-000000056741')
) then 1 else 0 end as assert_good_rename_carries_variant_alerts;
set constraints restock_alerts_variant_good_fkey deferred;

delete from public.goods_variants where id = '00000000-0000-4000-8000-000000056742';
select 1 / case when (
  (select count(*) from public.restock_alerts where good_id = 'restock-variant-renamed') = 2
  and not exists (select 1 from public.restock_alerts where variant_id = '00000000-0000-4000-8000-000000056742')
) then 1 else 0 end as assert_variant_delete_cascades_its_alerts;

-- ── 11. 예약판매 옵션의 실물 입고는 재입고가 아니다 — 재고 판매로 바꿀 때 깨운다 ─
-- 굿즈 5: 옵션 A(기본) 재고 0 · 옵션 B 재고 0. 모든 옵션이 품절이다.
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, published_at)
values ('restock-variant-preorder', 'restock-variant-ip', '예약 전환 굿즈', '키링', 10000, 'ok', 0, null);
update public.goods_variants set name = '옵션 A'
where good_id = 'restock-variant-preorder' and is_default;
insert into public.goods_variants (id, good_id, name, price, stock_qty, sort_order)
values ('00000000-0000-4000-8000-000000056751', 'restock-variant-preorder', '옵션 B', 10000, 0, 1);
select pg_temp.publish_goods_kc_fixture('restock-variant-preorder');

-- A 는 굿즈 단위(모든 옵션), B 는 옵션 B 단위로 기다린다(B 가 아직 재고 판매일 때 받은 신청).
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056701', true);
select public.request_restock_alert('restock-variant-preorder');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056702', true);
select public.request_variant_restock_alert('restock-variant-preorder', '00000000-0000-4000-8000-000000056751');
reset role;

-- 운영자가 옵션 B 를 예약판매로 열었다가 중지했다(정책 행과 옵션의 공급 선택은 픽스처로 둔다).
insert into private.goods_preorder_policies (id, variant_id, state, capacity_qty, starts_at, ends_at, expected_ship_date,
  approval_reference, created_by, activated_by, activated_at, stopped_by, stopped_at)
values ('00000000-0000-4000-8000-000000056759', '00000000-0000-4000-8000-000000056751', 'stopped', 10,
  now() - interval '2 days', now() + interval '5 days', current_date + 30, 'TEST-ONLY 재입고 스모크 예약 승인',
  '00000000-0000-4000-8000-000000056704', '00000000-0000-4000-8000-000000056704', now() - interval '2 days',
  '00000000-0000-4000-8000-000000056704', now() - interval '1 day');
update public.goods_variants set preorder_policy_id = '00000000-0000-4000-8000-000000056759'
where id = '00000000-0000-4000-8000-000000056751';

-- 예약 물량이 실물로 들어와 할당 전에 실재고를 올린다(admin_allocate_goods_preorders 가 요구하는 순서,
-- admin_adjust_stock 과 같은 내부 쓰기). 굿즈 행은 재고 캐시 0→10 으로 판매 가능 전이(①)를 하지만 재고로
-- 살 수 있는 옵션은 없고, B 는 예약판매라 옵션 전이(②)도 아니다 — 아무 신청도 깨우지 않는다.
select private.change_goods_variant_stock('restock-variant-preorder', '00000000-0000-4000-8000-000000056751', 10);
select 1 / case when (
  (select stock_qty from public.goods where id = 'restock-variant-preorder') = 10
  and (select count(*) from public.restock_alerts
    where good_id = 'restock-variant-preorder' and status = 'pending') = 2
  and not exists (select 1 from public.notifications where source_id = 'restock-variant-preorder')
) then 1 else 0 end as assert_preorder_physical_receipt_is_not_a_restock;

-- 공개 화면은 품절이다(옵션 A 재고 0, 옵션 B 는 중지된 예약판매라 구매 가능 수량 0). 굿즈 단위 신청을
-- 받는다 — 예약판매 옵션의 실물 입고분을 판매 재고로 세면 good_available 로 거절됐다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056702', true);
select public.request_restock_alert('restock-variant-preorder');
-- 예약판매 옵션의 옵션 신청은 여전히 받지 않는다(이미 받아 둔 신청은 남는다).
do $$ begin
  perform public.request_variant_restock_alert('restock-variant-preorder', '00000000-0000-4000-8000-000000056751');
  raise exception 'preorder option request was accepted' using errcode = 'P5682';
exception when sqlstate '22023' then null; end $$;
reset role;
select 1 / case when (
  select count(*) = 3 from public.restock_alerts
  where good_id = 'restock-variant-preorder' and status = 'pending'
) then 1 else 0 end as assert_goods_request_ignores_preorder_physical_stock;

-- 운영자가 B 를 재고 판매로 바꾼다(실재고 10 이 남아 있다). 그 순간이 B 의 재입고다 — B 신청과
-- 굿즈 단위 신청이 깨어나고, 신청마다 알림은 하나다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056704', true);
select public.admin_use_stock_supply('restock-variant-preorder', '00000000-0000-4000-8000-000000056751',
  '00000000-0000-4000-8000-000000056759', 1) ->> 'changed' as stock_supply_selected;
reset role;
select 1 / case when (
  (select preorder_policy_id is null and stock_qty = 10 from public.goods_variants
    where id = '00000000-0000-4000-8000-000000056751')
  and (select count(*) from public.restock_alerts
    where good_id = 'restock-variant-preorder' and status = 'notified') = 3
  and (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056701' and source_id = 'restock-variant-preorder'
      and link_path = '/shop/restock-variant-preorder'
      and body = '예약 전환 굿즈 굿즈가 다시 판매를 시작했어요.') = 1
  and (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056701' and source_id = 'restock-variant-preorder') = 1
  and (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056702' and source_id = 'restock-variant-preorder'
      and link_path = '/shop/restock-variant-preorder?variant=00000000-0000-4000-8000-000000056751'
      and body = '예약 전환 굿즈 · 옵션 B 옵션이 다시 판매를 시작했어요.') = 1
  and (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056702' and source_id = 'restock-variant-preorder') = 2
) then 1 else 0 end as assert_stock_supply_switch_wakes_option_and_goods_alerts;

-- ── 12. 사용 중지 옵션의 복원도 재고로 살 수 있게 되는 전이다 ─────────
-- 굿즈 6: 기본 옵션 A 재고 0(사용 중) · 옵션 B 재고 5. B 를 사용 중지(재고 보존)하면 공개 화면은 품절이다.
-- 사용 중지·복원은 admin_set_goods_variant_active 의 쓰기(archived_at)와 같다. 복원 뒤 메일은 앱이 보낸다.
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, published_at)
values ('restock-variant-restore', 'restock-variant-ip', '복원 재입고 굿즈', '키링', 10000, 'ok', 0, null);
update public.goods_variants set name = '옵션 A'
where good_id = 'restock-variant-restore' and is_default;
insert into public.goods_variants (id, good_id, name, price, stock_qty, sort_order)
values ('00000000-0000-4000-8000-000000056761', 'restock-variant-restore', '옵션 B', 10000, 5, 1);
select pg_temp.publish_goods_kc_fixture('restock-variant-restore');
update public.goods_variants set archived_at = now() where id = '00000000-0000-4000-8000-000000056761';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056701', true);
select public.request_restock_alert('restock-variant-restore');
reset role;

update public.goods_variants set archived_at = null where id = '00000000-0000-4000-8000-000000056761';
select 1 / case when (
  (select status from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056701' and good_id = 'restock-variant-restore') = 'notified'
  and (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056701' and source_id = 'restock-variant-restore'
      and link_path = '/shop/restock-variant-restore') = 1
) then 1 else 0 end as assert_variant_restore_wakes_all_options_alert;

-- ── 13. 판매 기간·결제수단·IP 공개 — 닫혀 있는 동안 깨우지 않고, 다시 열리면 깨운다 ─
-- 굿즈 7: 별도 IP, 기본 옵션 A 재고 0(모든 옵션 품절). 재고 외 조건을 하나씩 닫은 채 재고를 넣고, 그 조건이
-- 다시 열릴 때 깨어나는지 본다.
insert into public.ips (id, title, vertical_key, published_at)
values ('restock-variant-gate-ip', '옵션 재입고 게이트 IP', 'character', now());
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, published_at)
values ('restock-variant-gate', 'restock-variant-gate-ip', '게이트 재입고 굿즈', '키링', 10000, 'ok', 0, null);
update public.goods_variants set name = '옵션 A'
where good_id = 'restock-variant-gate' and is_default;
select pg_temp.publish_goods_kc_fixture('restock-variant-gate');

-- 13a. 판매 기간이 아직 시작하지 않았다(예약된 판매) — 재고가 들어와도 깨우지 않는다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056701', true);
select public.request_restock_alert('restock-variant-gate');
reset role;
update public.goods set sale_starts_at = now() + interval '1 day', sale_ends_at = now() + interval '2 days'
where id = 'restock-variant-gate';
select private.change_goods_variant_stock('restock-variant-gate',
  (select id from public.goods_variants where good_id = 'restock-variant-gate' and is_default), 3);
select 1 / case when (
  (select status from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056701' and good_id = 'restock-variant-gate') = 'pending'
  and (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056701' and source_id = 'restock-variant-gate') = 0
) then 1 else 0 end as assert_closed_sale_window_holds_alert;

-- 청소 작업도 닫힌 판매 기간에는 깨우지 않는다.
select private.sweep_restock_alerts();
select 1 / case when (
  select status = 'pending' from public.restock_alerts
  where user_id = '00000000-0000-4000-8000-000000056701' and good_id = 'restock-variant-gate'
) then 1 else 0 end as assert_sweep_respects_closed_sale_window;

-- 13b. 판매 기간을 지금으로 당기는 편집은 굿즈 트리거가 바로 깨운다.
update public.goods set sale_starts_at = now() - interval '1 hour', sale_ends_at = now() + interval '1 day'
where id = 'restock-variant-gate';
select 1 / case when (
  (select status from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056701' and good_id = 'restock-variant-gate') = 'notified'
  and (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056701' and source_id = 'restock-variant-gate'
      and link_path = '/shop/restock-variant-gate') = 1
) then 1 else 0 end as assert_opening_sale_window_wakes_alert;

-- 13c. 결제수단이 모두 닫힌 채 재고가 들어오면 깨우지 않고, 무통장을 다시 허용하면 깨운다.
select private.change_goods_variant_stock('restock-variant-gate',
  (select id from public.goods_variants where good_id = 'restock-variant-gate' and is_default), -3);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056702', true);
select public.request_restock_alert('restock-variant-gate');
reset role;
update public.goods set allow_card_payment = false, allow_bank_transfer = false where id = 'restock-variant-gate';
select private.change_goods_variant_stock('restock-variant-gate',
  (select id from public.goods_variants where good_id = 'restock-variant-gate' and is_default), 2);
select 1 / case when (
  select status = 'pending' from public.restock_alerts
  where user_id = '00000000-0000-4000-8000-000000056702' and good_id = 'restock-variant-gate'
) then 1 else 0 end as assert_closed_payment_methods_hold_alert;
update public.goods set allow_bank_transfer = true where id = 'restock-variant-gate';
select 1 / case when (
  (select status from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056702' and good_id = 'restock-variant-gate') = 'notified'
  and (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056702' and source_id = 'restock-variant-gate') = 1
) then 1 else 0 end as assert_reopening_payment_method_wakes_alert;

-- 13d. IP 가 비공개인 동안 재고가 들어오면 깨우지 않는다. IP 재공개는 굿즈 행을 바꾸지 않으므로 트리거가
--      보지 못하고, 청소 작업이 깨운다. 두 번째 청소는 이 신청에 아무 일도 하지 않는다.
select private.change_goods_variant_stock('restock-variant-gate',
  (select id from public.goods_variants where good_id = 'restock-variant-gate' and is_default), -2);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056701', true);
select public.request_restock_alert('restock-variant-gate');
reset role;
update public.ips set published_at = null where id = 'restock-variant-gate-ip';
select private.change_goods_variant_stock('restock-variant-gate',
  (select id from public.goods_variants where good_id = 'restock-variant-gate' and is_default), 2);
update public.ips set published_at = now() where id = 'restock-variant-gate-ip';
select 1 / case when (
  select status = 'pending' from public.restock_alerts
  where user_id = '00000000-0000-4000-8000-000000056701' and good_id = 'restock-variant-gate'
) then 1 else 0 end as assert_ip_republish_alone_does_not_fire_trigger;
select private.sweep_restock_alerts();
select 1 / case when (
  (select status from public.restock_alerts
    where user_id = '00000000-0000-4000-8000-000000056701' and good_id = 'restock-variant-gate') = 'notified'
  and (select count(*) from public.notifications
    where user_id = '00000000-0000-4000-8000-000000056701' and source_id = 'restock-variant-gate') = 2
) then 1 else 0 end as assert_sweep_wakes_after_ip_republish;
select private.sweep_restock_alerts();
select 1 / case when (
  select count(*) = 2 from public.notifications
  where user_id = '00000000-0000-4000-8000-000000056701' and source_id = 'restock-variant-gate'
) then 1 else 0 end as assert_second_sweep_is_noop_for_woken_alert;

-- 13e. 청소 작업은 대상이 아직 품절이면 깨우지 않는다(옵션 신청 기준).
select private.change_goods_variant_stock('restock-variant-gate',
  (select id from public.goods_variants where good_id = 'restock-variant-gate' and is_default), -2);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056702', true);
select public.request_variant_restock_alert('restock-variant-gate',
  (select id from public.goods_variants where good_id = 'restock-variant-gate' and is_default));
reset role;
select private.sweep_restock_alerts();
select 1 / case when (
  select status = 'pending' from public.restock_alerts
  where user_id = '00000000-0000-4000-8000-000000056702' and good_id = 'restock-variant-gate'
    and variant_id is not null
) then 1 else 0 end as assert_sweep_skips_still_soldout_target;

rollback;
