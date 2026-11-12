#!/usr/bin/env bash
set -euo pipefail
# 상품 단위 예약 일정 일괄 변경(QNA-040)의 접수 중 조건 교체와 주문 접수의 잠금 순서를 두 세션으로 확인한다.
#  1) 일괄 변경(교체)이 먼저 잠그면 주문 접수는 기다렸다가 새 날짜 조건으로 예약된다(옛 날짜 주문이 생기지 않는다).
#  2) 주문 접수가 먼저 잠그면 일괄 변경은 기다렸다가 대상이 바뀐 것을 보고 거절된다(교착 없음). 다시 미리 보면 그 주문도 대상이다.
# 선택한 로컬 테스트 컨테이너의 postgres DB를 일회용 DB로 복제해 그 안에서만 쓴다.
test_container="${SUPABASE_DB_CONTAINER:?Select a CI or disposable local test container}"
test_scope="${PREORDER_SCHEDULE_TEST_SCOPE:?Set ci or isolated-local}"
case "$test_scope" in ci|isolated-local) ;; *) echo 'Unsupported test scope' >&2; exit 1;; esac
case "$test_container" in supabase_db_*) ;; *) echo 'Expected an explicitly selected local Supabase DB container' >&2; exit 1;; esac
test_database="icons_preorder_schedule_race_$(date +%s)_$$"
test_dir="$(mktemp -d)"
test_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
test_created=false
race_pid=''
cleanup() {
  local result=$?
  if [[ -n "$race_pid" ]]; then wait "$race_pid" 2>/dev/null || true; fi
  if "$test_created"; then
    if ! docker exec "$test_container" dropdb -U postgres --force "$test_database"; then
      echo "Failed to clean disposable database: $test_database" >&2
      result=1
    fi
  fi
  if [[ "$result" != 0 ]]; then
    for log in "$test_dir"/*.log; do [[ -f "$log" ]] && { echo "== $log" >&2; tail -20 "$log" >&2; }; done
  fi
  rm -rf "$test_dir"
  exit "$result"
}
trap cleanup EXIT
docker exec "$test_container" pg_dump -U postgres -d postgres -Fc > "$test_dir/base.dump"
docker exec -i "$test_container" pg_restore -l < "$test_dir/base.dump" > "$test_dir/restore.list"
python3 - "$test_dir/restore.list" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
path.write_text('\n'.join(line for line in path.read_text().splitlines() if not any(word in line.split() for word in ('cron', 'pg_cron'))) + '\n')
PY
docker exec "$test_container" createdb -U postgres "$test_database"
test_created=true
docker cp "$test_dir/restore.list" "$test_container:/tmp/$test_database.list" >/dev/null
docker exec -i "$test_container" pg_restore -U supabase_admin -d "$test_database" --exit-on-error -L "/tmp/$test_database.list" < "$test_dir/base.dump"
docker exec "$test_container" rm "/tmp/$test_database.list"

db() { docker exec -i "$test_container" psql -X -q -U postgres -d "$test_database" -v ON_ERROR_STOP=1 "$@"; }
wait_marker() {
  local log="$1" marker="$2"
  for ((poll=0;poll<150;poll++)); do
    if grep -q "$marker" "$log" 2>/dev/null; then return 0; fi
    sleep 0.1
  done
  echo "Missing marker: $marker" >&2; return 1
}

operator='00000000-0000-4000-8000-000000071401'
{ cat "$test_script_dir/helpers/goods_kc_fixture.sql"; cat <<'SQL'; } | db > "$test_dir/setup.log" 2>&1
begin;
set local statement_timeout='30s';
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('00000000-0000-4000-8000-00000007140'||n)::uuid,'authenticated','authenticated','schedule-race-'||n||'@example.test',now(),'{}','{}',now(),now()
 from generate_series(1,4) n;
update public.profiles set role='staff',nickname='일정경쟁운영' where id='00000000-0000-4000-8000-000000071401';
insert into private.operator_memberships(profile_id,manager_role) values('00000000-0000-4000-8000-000000071401','primary');
update public.profiles set nickname='일정경쟁'||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id in ('00000000-0000-4000-8000-000000071402','00000000-0000-4000-8000-000000071403','00000000-0000-4000-8000-000000071404');
insert into public.verticals(key,label,color) values('schedule-race','일정 경쟁 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('schedule-race','일정 경쟁 검증','schedule-race',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('00000000-0000-4000-8000-000000071430','schedule-race','합성 예약 출고지','hanjin',3000,'배송 금지 검증 주소',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000071401',true);
select public.admin_save_good('{"id":"schedule-race-good","ip_id":"schedule-race","name":"일정 경쟁 예약","price":10000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"SCHEDULE-RACE","attributes":{},"extraPrice":0,"stockQty":0}]}');
select public.admin_save_goods_preorder('schedule-race-good',(select id from public.goods_variants where good_id='schedule-race-good' and is_default),null,
 jsonb_build_object('state','active','capacityQty',10,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour',
 'expectedShipDate',(now() at time zone 'Asia/Seoul')::date+7,'approvalReference','TEST-ONLY 일정 경쟁 승인'));
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.goods set type='문구',image_path='public-media/schedule-race-fixture.webp',notice_maker='제조사',notice_origin='한국',notice_material='종이',
 notice_size='A5',notice_made_on='2026-09',notice_as_manager='CS',notice_as_contact='02-000',origin_id='00000000-0000-4000-8000-000000071430'
 where id='schedule-race-good';
-- KC 합성 검토자도 레거시 fixture 없이 운영자 멤버십으로 검토한다(helpers/goods_kc_fixture.sql의 같은 식별자).
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(('47c47700'||left(md5('schedule-race-good'),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5('schedule-race-good')||'@example.test',
  now(),'{"testFixture":"goods-kc"}','{}',now(),now());
update public.profiles set role='staff' where id=('47c47700'||left(md5('schedule-race-good'),24))::uuid;
insert into private.operator_memberships(profile_id,manager_role) values(('47c47700'||left(md5('schedule-race-good'),24))::uuid,'primary');
select pg_temp.publish_goods_kc_fixture('schedule-race-good');
update private.order_delay_notice_delivery_control set enabled=true where singleton;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000071402',true);
select public.set_cart_item_quantity('schedule-race-good',(select id from public.goods_variants where good_id='schedule-race-good' and is_default),1);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000071403',true);
select public.set_cart_item_quantity('schedule-race-good',(select id from public.goods_variants where good_id='schedule-race-good' and is_default),1);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000071404',true);
select public.set_cart_item_quantity('schedule-race-good',(select id from public.goods_variants where good_id='schedule-race-good' and is_default),1);
set local role service_role;
select public.place_order('00000000-0000-4000-8000-000000071402'::uuid,'{"recipientName":"일정 경쟁","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000071420'::uuid,'card'::public.order_payment_method);
commit;
SQL

preview() { # $1 = days after today
  db -At <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub','$operator',false);
select public.admin_preview_goods_preorder_schedule_change('schedule-race-good',null,(now() at time zone 'Asia/Seoul')::date+$1)->>'fingerprint';
SQL
}
apply_sql() { # $1 request, $2 days, $3 fingerprint
  cat <<SQL
set local role authenticated;
select set_config('request.jwt.claim.sub','$operator',true);
select public.admin_apply_goods_preorder_schedule_change('$1'::uuid,'schedule-race-good',null,(now() at time zone 'Asia/Seoul')::date+$2,
 'TEST-ONLY 공급 지연','예약 주문 발송 일정 변경 안내','발송 예정일이 바뀌었습니다.','$3','{}'::uuid[],false,'replace')->>'shipmentCount';
SQL
}
place_sql() { # $1 buyer, $2 checkout key
  cat <<SQL
set local role service_role;
select public.place_order('$1'::uuid,'{"recipientName":"일정 경쟁","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '$2'::uuid,'card'::public.order_payment_method);
SQL
}

# 1) 일괄 변경(접수 중 조건 교체)이 먼저: 주문 접수는 기다렸다가 새 날짜 조건으로 예약된다.
fingerprint="$(preview 20 | tail -1)"
{ echo "begin; set local statement_timeout='20s';"; apply_sql '00000000-0000-4000-8000-000000071450' 20 "$fingerprint"; echo '\echo SCHEDULE_REPLACED'; echo 'select pg_sleep(2);'; echo 'commit;'; } \
  | db > "$test_dir/race1-apply.log" 2>&1 &
race_pid=$!
wait_marker "$test_dir/race1-apply.log" SCHEDULE_REPLACED
{ echo "begin; set local statement_timeout='20s';"; place_sql '00000000-0000-4000-8000-000000071403' '00000000-0000-4000-8000-000000071421'; echo 'commit;'; } \
  | db > "$test_dir/race1-order.log" 2>&1
wait "$race_pid"; race_pid=''
db > "$test_dir/race1-assert.log" 2>&1 <<'SQL'
select 1/case when (select count(*) from private.goods_preorder_schedule_changes where id='00000000-0000-4000-8000-000000071450' and policy_action='replaced')=1
 and (select item.preorder_expected_ship_date=(now() at time zone 'Asia/Seoul')::date+20
   and item.preorder_policy_id=(select preorder_policy_id from public.goods_variants where good_id='schedule-race-good')
   from public.order_items item join public.orders o on o.id=item.order_id where o.checkout_key='00000000-0000-4000-8000-000000071421')
 and (select s.expected_ship_date=(now() at time zone 'Asia/Seoul')::date+20 from public.order_shipments s join public.orders o on o.id=s.order_id
   where o.checkout_key='00000000-0000-4000-8000-000000071420')
 then 1 else 0 end as assert_order_after_replacement_uses_new_date;
SQL

# 2) 주문 접수가 먼저: 일괄 변경은 기다렸다가 대상이 바뀐 것을 보고 거절된다. 교착은 없다.
fingerprint="$(preview 25 | tail -1)"
{ echo "begin; set local statement_timeout='20s';"; place_sql '00000000-0000-4000-8000-000000071404' '00000000-0000-4000-8000-000000071422'; echo '\echo ORDER_RESERVED'; echo 'select pg_sleep(2);'; echo 'commit;'; } \
  | db > "$test_dir/race2-order.log" 2>&1 &
race_pid=$!
wait_marker "$test_dir/race2-order.log" ORDER_RESERVED
if { echo "begin; set local statement_timeout='20s';"; apply_sql '00000000-0000-4000-8000-000000071451' 25 "$fingerprint"; echo 'commit;'; } \
  | db > "$test_dir/race2-apply.log" 2>&1; then echo 'Bulk change accepted an order it did not preview' >&2; exit 1; fi
wait "$race_pid"; race_pid=''
grep -q 'preorder_schedule_stale' "$test_dir/race2-apply.log"
if grep -q 'deadlock' "$test_dir"/*.log; then echo 'Deadlock detected' >&2; exit 1; fi
fingerprint="$(preview 25 | tail -1)"
{ echo 'begin;'; apply_sql '00000000-0000-4000-8000-000000071452' 25 "$fingerprint"; echo 'commit;'; } | db > "$test_dir/race2-retry.log" 2>&1
db > "$test_dir/race2-assert.log" 2>&1 <<'SQL'
select 1/case when not exists(select 1 from private.goods_preorder_schedule_changes where id='00000000-0000-4000-8000-000000071451')
 and (select shipment_count from private.goods_preorder_schedule_changes where id='00000000-0000-4000-8000-000000071452')=3
 and (select count(*) from public.order_shipments s join public.orders o on o.id=s.order_id where o.checkout_key in
   ('00000000-0000-4000-8000-000000071420','00000000-0000-4000-8000-000000071421','00000000-0000-4000-8000-000000071422')
   and s.expected_ship_date=(now() at time zone 'Asia/Seoul')::date+25)=3
 and (select expected_ship_date=(now() at time zone 'Asia/Seoul')::date+25 from private.goods_preorder_policies
   where id=(select preorder_policy_id from public.goods_variants where good_id='schedule-race-good'))
 then 1 else 0 end as assert_stale_bulk_then_retry_includes_new_order;
SQL
echo 'PASS goods_preorder_schedule_concurrency: replacement-first order waits and gets the new date; order-first bulk change is rejected as stale without deadlock'
