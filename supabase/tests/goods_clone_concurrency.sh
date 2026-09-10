#!/usr/bin/env bash
# Explicit, isolated test database only. No fallback connection, payment approval,
# upload, or external fulfillment is performed. Each checkout uses the real RPC.
set -euo pipefail
if [[ $# -lt 2 || $# -gt 3 || ! "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ || ! "$2" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  printf '%s\n' 'Usage: bash supabase/tests/goods_clone_concurrency.sh <explicit-test-container> <explicit-test-database> [/absolute/evidence-directory]' >&2
  exit 64
fi
clone_test_container="$1"
clone_test_database="$2"
if [[ -n "${3:-}" ]]; then
  if [[ "$3" != /* ]]; then printf '%s\n' 'Evidence directory must be absolute.' >&2; exit 64; fi
  mkdir -p "$3"
  clone_test_logs="$(mktemp -d "${3%/}/goods-clone-race.XXXXXX")"
else
  clone_test_logs="$(mktemp -d /tmp/icons-goods-clone-race.XXXXXX)"
fi
clone_fixture_created=false
clone_background_pid=''
clone_kc_helper="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/helpers/goods_kc_fixture.sql"
clone_db() { docker exec -i "$clone_test_container" psql -X -q -U postgres -d "$clone_test_database" -v ON_ERROR_STOP=1 "$@"; }
clone_owner_db() { docker exec -i "$clone_test_container" psql -X -q -U supabase_admin -d "$clone_test_database" -v ON_ERROR_STOP=1 "$@"; }
clone_with_kc() { { cat "$clone_kc_helper"; cat; } | clone_db "$@"; }
clone_owner_with_kc() { { cat "$clone_kc_helper"; cat; } | clone_owner_db "$@"; }
clone_cleanup() {
  local clone_exit=$?
  if [[ -n "$clone_background_pid" ]]; then wait "$clone_background_pid" 2>/dev/null || true; fi
  if [[ "$clone_fixture_created" == true ]]; then
    if ! clone_owner_with_kc >"$clone_test_logs/cleanup.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='20s';
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  if exists(select 1 from auth.users where id in ('00000000-0000-4000-8000-000000047911','00000000-0000-4000-8000-000000047912',
    '00000000-0000-4000-8000-000000047913','00000000-0000-4000-8000-000000047914')
      and raw_app_meta_data->>'testFixture' is distinct from 'goods-clone-race') then
    raise exception 'Refusing to remove an account outside this fixture'; end if;
  if exists(select 1 from public.goods where id in ('goods-clone-race-source','goods-clone-race-first','goods-clone-race-existing',
    'goods-clone-race-copy-a','goods-clone-race-copy-b') and ip_id is distinct from 'goods-clone-race') then
    raise exception 'Refusing to remove a good outside this fixture'; end if;
  if exists(select 1 from public.orders where user_id in ('00000000-0000-4000-8000-000000047911','00000000-0000-4000-8000-000000047912',
    '00000000-0000-4000-8000-000000047913') and checkout_key not in ('00000000-0000-4000-8000-000000047931',
      '00000000-0000-4000-8000-000000047932','00000000-0000-4000-8000-000000047933')) then
    raise exception 'Refusing to remove an order outside this fixture'; end if;
  if exists(select 1 from public.payment_attempts where user_id in ('00000000-0000-4000-8000-000000047911','00000000-0000-4000-8000-000000047912',
    '00000000-0000-4000-8000-000000047913')) or exists(select 1 from public.payments where user_id in ('00000000-0000-4000-8000-000000047911',
      '00000000-0000-4000-8000-000000047912','00000000-0000-4000-8000-000000047913')) then
    raise exception 'Unexpected payment state: retain the fixture for inspection'; end if;
end $$;
delete from public.audit_log where actor_id in ('00000000-0000-4000-8000-000000047911','00000000-0000-4000-8000-000000047912',
 '00000000-0000-4000-8000-000000047913','00000000-0000-4000-8000-000000047914')
 or target in ('goods:goods-clone-race-source','goods:goods-clone-race-first','goods:goods-clone-race-existing',
   'goods:goods-clone-race-copy-a','goods:goods-clone-race-copy-b')
 or target in(select 'order:'||id from public.orders where user_id in ('00000000-0000-4000-8000-000000047911',
   '00000000-0000-4000-8000-000000047912','00000000-0000-4000-8000-000000047913'));
delete from public.notifications where user_id in ('00000000-0000-4000-8000-000000047911','00000000-0000-4000-8000-000000047912',
 '00000000-0000-4000-8000-000000047913','00000000-0000-4000-8000-000000047914');
delete from public.cart_items where user_id in ('00000000-0000-4000-8000-000000047911','00000000-0000-4000-8000-000000047912','00000000-0000-4000-8000-000000047913');
delete from private.store_credit_checkout_intents where user_id in ('00000000-0000-4000-8000-000000047911','00000000-0000-4000-8000-000000047912','00000000-0000-4000-8000-000000047913');
delete from public.orders where user_id in ('00000000-0000-4000-8000-000000047911','00000000-0000-4000-8000-000000047912','00000000-0000-4000-8000-000000047913');
select pg_temp.cleanup_goods_kc_fixture(id) from public.goods where id in ('goods-clone-race-source','goods-clone-race-first','goods-clone-race-existing',
 'goods-clone-race-copy-a','goods-clone-race-copy-b');
delete from public.goods where id in ('goods-clone-race-source','goods-clone-race-first','goods-clone-race-existing','goods-clone-race-copy-a','goods-clone-race-copy-b');
delete from public.ips where id='goods-clone-race';
delete from public.verticals where key='goods-clone-race';
delete from public.fulfillment_origins where id='00000000-0000-4000-8000-000000047930';
delete from auth.users where id in ('00000000-0000-4000-8000-000000047911','00000000-0000-4000-8000-000000047912',
 '00000000-0000-4000-8000-000000047913','00000000-0000-4000-8000-000000047914');
commit;
SQL
    then clone_exit=1; printf 'Owned fixture cleanup failed: %s/cleanup.log\n' "$clone_test_logs" >&2; fi
  fi
  printf 'Evidence preserved: %s\n' "$clone_test_logs"
  if [[ "$clone_exit" != 0 ]]; then
    for clone_log in "$clone_test_logs"/*.log; do
      if rg --quiet 'ERROR|FATAL' "$clone_log"; then tail -22 "$clone_log" >&2; fi
    done
  fi
  exit "$clone_exit"
}
trap clone_cleanup EXIT
clone_with_kc >"$clone_test_logs/setup.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='20s';
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  if exists(select 1 from public.goods where id in ('goods-clone-race-source','goods-clone-race-first','goods-clone-race-existing',
    'goods-clone-race-copy-a','goods-clone-race-copy-b'))
    or exists(select 1 from public.ips where id='goods-clone-race')
    or exists(select 1 from auth.users where id in ('00000000-0000-4000-8000-000000047911','00000000-0000-4000-8000-000000047912',
      '00000000-0000-4000-8000-000000047913','00000000-0000-4000-8000-000000047914')) then
    raise exception 'Clone concurrency fixture already exists; no cleanup or overwrite attempted'; end if;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000047911','authenticated','authenticated','goods-clone-race-a@example.test',now(),'{"testFixture":"goods-clone-race"}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000047912','authenticated','authenticated','goods-clone-race-b@example.test',now(),'{"testFixture":"goods-clone-race"}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000047913','authenticated','authenticated','goods-clone-race-c@example.test',now(),'{"testFixture":"goods-clone-race"}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000047914','authenticated','authenticated','goods-clone-race-admin@example.test',now(),'{"testFixture":"goods-clone-race"}','{}',now(),now());
update public.profiles set nickname='클론경쟁'||right(id::text,4),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id in ('00000000-0000-4000-8000-000000047911','00000000-0000-4000-8000-000000047912','00000000-0000-4000-8000-000000047913');
update public.profiles set role='admin',nickname='클론관리7914' where id='00000000-0000-4000-8000-000000047914';
insert into public.verticals(key,label,color) values('goods-clone-race','합성 복사 경쟁','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('goods-clone-race','합성 복사 경쟁','goods-clone-race',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('00000000-0000-4000-8000-000000047930','goods-clone-race','합성 경쟁 출고지','hanjin',3000,'배송 금지 검증 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at,origin_id,image_path,
 notice_maker,notice_origin,notice_material,notice_size,notice_made_on,notice_as_manager,notice_as_contact) values
 ('goods-clone-race-source','goods-clone-race','TEST-ONLY 원본 상품','문구',10000,'ok',10,null,'00000000-0000-4000-8000-000000047930',
  'public-media/goods-clone-race-fixture.webp','합성 제조사','한국','종이','A5','2026-09','합성 CS','02-0000'),
 ('goods-clone-race-first','goods-clone-race','TEST-ONLY 앞선 상품','문구',10000,'ok',10,null,'00000000-0000-4000-8000-000000047930',
  'public-media/goods-clone-race-fixture.webp','합성 제조사','한국','종이','A5','2026-09','합성 CS','02-0000'),
 ('goods-clone-race-existing','goods-clone-race','TEST-ONLY 기존 대상','문구',10000,'ok',10,null,'00000000-0000-4000-8000-000000047930',
  'public-media/goods-clone-race-fixture.webp','합성 제조사','한국','종이','A5','2026-09','합성 CS','02-0000');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in ('goods-clone-race-source','goods-clone-race-first','goods-clone-race-existing');
insert into public.cart_items(user_id,good_id,variant_id,qty)
 select '00000000-0000-4000-8000-000000047911',good_id,id,1 from public.goods_variants where good_id='goods-clone-race-source' and is_default;
insert into public.cart_items(user_id,good_id,variant_id,qty)
 select '00000000-0000-4000-8000-000000047912',good_id,id,1 from public.goods_variants where good_id in ('goods-clone-race-first','goods-clone-race-source') and is_default;
insert into public.cart_items(user_id,good_id,variant_id,qty)
 select '00000000-0000-4000-8000-000000047913',good_id,id,1 from public.goods_variants where good_id='goods-clone-race-existing' and is_default;
commit;
SQL
clone_fixture_created=true
clone_wait_marker() {
  local clone_marker_log="$1" clone_marker="$2"
  for ((clone_poll=0;clone_poll<100;clone_poll++)); do
    if rg --quiet "$clone_marker" "$clone_marker_log"; then return 0; fi
    sleep 0.1
  done
  tail -30 "$clone_marker_log" >&2
  printf 'Missing test marker: %s\n' "$clone_marker" >&2
  return 1
}

# A: force the checkout's goods lock before its normal IP SHARE acquisition.
# The old clone takes IP UPDATE first and creates a real two-session deadlock.
clone_db >"$clone_test_logs/a-checkout.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout='15s';
set local deadlock_timeout='500ms';
select id from public.goods where id='goods-clone-race-source' for update;
\echo CLONE_A_CHECKOUT_HAS_SOURCE
select pg_sleep(3);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047911',true);
select public.place_order('{"recipientName":"합성 A","phone":"01000000000","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000047931'::uuid,'card'::public.order_payment_method);
commit;
SQL
clone_background_pid=$!
clone_wait_marker "$clone_test_logs/a-checkout.log" CLONE_A_CHECKOUT_HAS_SOURCE
clone_a_status=0
if clone_db >"$clone_test_logs/a-clone.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='15s';
set local deadlock_timeout='500ms';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047914',true);
select public.admin_clone_good('00000000-0000-4000-8000-000000047921','goods-clone-race-source','goods-clone-race-copy-a',null,'TEST-ONLY A 복사');
commit;
SQL
then :; else clone_a_status=1; fi
if wait "$clone_background_pid"; then :; else clone_a_status=1; fi
clone_background_pid=''
if [[ "$clone_a_status" != 0 ]]; then printf '%s\n' 'A failed: checkout and clone must both complete without a deadlock.' >&2; exit 1; fi
clone_db >"$clone_test_logs/a-assert.log" 2>&1 <<'SQL'
select 1/case when exists(select 1 from public.orders where checkout_key='00000000-0000-4000-8000-000000047931' and status='pending' and total=13000)
 and (select stock_qty from public.goods where id='goods-clone-race-source')=9
 and exists(select 1 from public.goods where id='goods-clone-race-copy-a' and published_at is null and stock_qty=0)
 then 1 else 0 end as assert_a_checkout_and_clone_complete;
SQL
printf '%s\n' 'CLONE_CASE_A_PASS'

# B: emulate the stable prefix of a two-item checkout: first goods row, then its
# shared IP, before reaching the source goods row. The clone must release its
# source lock through PT409 rather than wait on the IP while checkout waits on it.
clone_db >"$clone_test_logs/b-checkout.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout='15s';
select id from public.goods where id='goods-clone-race-first' for update;
select id from public.ips where id='goods-clone-race' for share;
\echo CLONE_B_CHECKOUT_HAS_FIRST_AND_IP
select pg_sleep(4);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047912',true);
select public.place_order('{"recipientName":"합성 B","phone":"01000000000","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000047932'::uuid,'card'::public.order_payment_method);
commit;
SQL
clone_background_pid=$!
clone_wait_marker "$clone_test_logs/b-checkout.log" CLONE_B_CHECKOUT_HAS_FIRST_AND_IP
clone_b_status=0
if clone_db >"$clone_test_logs/b-clone-busy.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='10s';
set local lock_timeout='1500ms';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047914',true);
do $$ declare started timestamptz:=clock_timestamp(); begin
  begin
    perform public.admin_clone_good('00000000-0000-4000-8000-000000047922','goods-clone-race-source','goods-clone-race-copy-b',null,'TEST-ONLY B 복사');
    raise exception 'Expected goods_clone_source_busy before checkout releases its IP';
  exception when sqlstate 'PT409' then
    if sqlerrm<>'goods_clone_source_busy' then raise; end if;
  end;
  if clock_timestamp()-started>=interval '2 seconds' then raise exception 'Clone did not release the contended source promptly'; end if;
end $$;
select 1/case when not exists(select 1 from public.goods where id='goods-clone-race-copy-b')
 and not exists(select 1 from public.audit_log where id='00000000-0000-4000-8000-000000047922')
 then 1 else 0 end as assert_b_busy_has_no_partial_clone_or_operation;
commit;
SQL
then :; else clone_b_status=1; fi
if wait "$clone_background_pid"; then :; else clone_b_status=1; fi
clone_background_pid=''
if [[ "$clone_b_status" != 0 ]]; then printf '%s\n' 'B failed: clone must promptly return PT409 while checkout completes.' >&2; exit 1; fi
clone_db >"$clone_test_logs/b-retry.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='15s';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047914',true);
select public.admin_clone_good('00000000-0000-4000-8000-000000047922','goods-clone-race-source','goods-clone-race-copy-b',null,'TEST-ONLY B 복사') as first_result \gset
select 1/case when public.admin_clone_good('00000000-0000-4000-8000-000000047922','goods-clone-race-source','goods-clone-race-copy-b',null,'TEST-ONLY B 복사')=:'first_result'::jsonb
 and (select count(*) from public.goods where id='goods-clone-race-copy-b')=1
 and (select count(*) from public.audit_log where id='00000000-0000-4000-8000-000000047922')=1
 then 1 else 0 end as assert_b_same_operation_retries_create_one_copy;
commit;
SQL
printf '%s\n' 'CLONE_CASE_B_PASS'

# C: a manually selected target is another existing good, locked by checkout.
# A plain existence check must reject it before attempting an IP UPDATE lock.
clone_db >"$clone_test_logs/c-checkout.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout='15s';
select id from public.goods where id='goods-clone-race-existing' for update;
select id from public.ips where id='goods-clone-race' for share;
\echo CLONE_C_CHECKOUT_HAS_TARGET_AND_IP
select pg_sleep(4);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047913',true);
select public.place_order('{"recipientName":"합성 C","phone":"01000000000","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000047933'::uuid,'card'::public.order_payment_method);
commit;
SQL
clone_background_pid=$!
clone_wait_marker "$clone_test_logs/c-checkout.log" CLONE_C_CHECKOUT_HAS_TARGET_AND_IP
clone_c_status=0
if clone_db >"$clone_test_logs/c-existing-target.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='10s';
set local lock_timeout='1500ms';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047914',true);
do $$ declare started timestamptz:=clock_timestamp(); begin
  begin
    perform public.admin_clone_good('00000000-0000-4000-8000-000000047923','goods-clone-race-source','goods-clone-race-existing',null,'TEST-ONLY 충돌 복사');
    raise exception 'Expected catalog_id_taken before the IP lock';
  exception when unique_violation then
    if sqlerrm<>'catalog_id_taken' then raise; end if;
  end;
  if clock_timestamp()-started>=interval '2 seconds' then raise exception 'Existing target was not rejected promptly'; end if;
end $$;
commit;
SQL
then :; else clone_c_status=1; fi
if wait "$clone_background_pid"; then :; else clone_c_status=1; fi
clone_background_pid=''
if [[ "$clone_c_status" != 0 ]]; then printf '%s\n' 'C failed: an existing target must be rejected before blocking checkout.' >&2; exit 1; fi
clone_db >"$clone_test_logs/final-assert.log" 2>&1 <<'SQL'
select 1/case when (select count(*) from public.orders where user_id in ('00000000-0000-4000-8000-000000047911',
 '00000000-0000-4000-8000-000000047912','00000000-0000-4000-8000-000000047913'))=3
 and (select sum(total) from public.orders where user_id in ('00000000-0000-4000-8000-000000047911',
 '00000000-0000-4000-8000-000000047912','00000000-0000-4000-8000-000000047913'))=49000
 and (select stock_qty from public.goods where id='goods-clone-race-source')=8
 and (select stock_qty from public.goods where id='goods-clone-race-first')=9
 and (select stock_qty=9 and name='TEST-ONLY 기존 대상' from public.goods where id='goods-clone-race-existing')
 and (select count(*) from public.goods where id in ('goods-clone-race-copy-a','goods-clone-race-copy-b') and published_at is null and stock_qty=0)=2
 and not exists(select 1 from public.audit_log where id='00000000-0000-4000-8000-000000047923')
 and not exists(select 1 from public.order_shipment_email_jobs job join public.orders purchase on purchase.id=job.order_id
   where purchase.user_id in ('00000000-0000-4000-8000-000000047911','00000000-0000-4000-8000-000000047912','00000000-0000-4000-8000-000000047913'))
 then 1 else 0 end as assert_three_checkouts_two_draft_copies_and_no_dispatch_effect;
SQL
printf '%s\n' 'CLONE_CASE_C_PASS' 'All three clone/checkout races passed.'
