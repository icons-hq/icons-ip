#!/usr/bin/env bash
set -euo pipefail

# 잔액이 정확히 1회 교환분인 사용자가 서로 다른 operation_id 두 개로 동시에
# 교환을 시도하는 경합.
#
# 멱등 키가 다르므로 advisory lock은 두 세션을 갈라놓지 않는다. 직렬화는
# `update coin_balances ... where balance >= cost`의 행 잠금이 한다 — 뒤에 온
# 세션은 잠금 해제 뒤 갱신된 행으로 조건을 다시 평가해 0행을 얻고 insufficient_coins로
# 끝나야 한다. 이 잠금이 사라지면 둘 다 성공해 잔액이 음수가 되거나(체크 제약
# 위반) 한 번 낸 코인으로 카드팩을 두 번 받는다.

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="coin-exchange-concurrency-$$"
user_id="00000000-0000-4000-8000-000000000851"
pool_id="00000000-0000-4000-8000-0000000008d2"
offer_id="00000000-0000-4000-8000-0000000008d1"
first_operation_id="00000000-0000-4000-8000-0000000008f1"
second_operation_id="00000000-0000-4000-8000-0000000008f2"
coin_cost=3
ticket_count=3
work_dir="$(mktemp -d)"
holder_log="${work_dir}/holder.log"
racer_log="${work_dir}/racer.log"
gate_restore_file="${work_dir}/gate.txt"

psql_exec() {
  docker exec -i "$db_container" psql \
    -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

psql_scalar() {
  docker exec -i "$db_container" psql \
    -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t -c "$1"
}

terminate_test_backends() {
  psql_exec -q <<SQL >/dev/null 2>&1 || true
select pg_catalog.pg_terminate_backend(pid)
from pg_catalog.pg_stat_activity
where application_name like '${test_prefix}-%'
  and pid <> pg_catalog.pg_backend_pid();
SQL
}

cleanup_fixtures() {
  # coin_ledger는 append-only 트리거가 직접 삭제를 막는다. 프로필을 지워
  # FK cascade로 정리한다(트리거가 그 경로만 예외로 허용한다).
  psql_exec -q <<SQL >/dev/null 2>&1 || true
delete from public.profiles where id = '${user_id}'::uuid;
delete from auth.users where id = '${user_id}'::uuid;
delete from public.coin_exchange_offers where id = '${offer_id}'::uuid;
delete from public.cards where id = 'coin-race-card';
-- pool_odds는 card_pools의 on delete cascade로 정리한다. 행 단위로 지우면
-- 합계 100% 제약(pool_odds_total_chk)이 중간 상태를 거부한다.
delete from public.card_pools where id = '${pool_id}'::uuid;
delete from public.ips where id = 'coin-race-ip';
SQL
}

restore_gate() {
  local previous
  previous="$(cat "$gate_restore_file" 2>/dev/null || echo '')"
  if [[ -z "$previous" ]]; then
    return 0
  fi
  psql_exec -q <<SQL >/dev/null 2>&1 || true
update private.card_reward_control set enabled = '${previous}'::boolean where singleton;
SQL
}

cleanup() {
  set +e
  terminate_test_backends
  cleanup_fixtures
  restore_gate
  rm -rf "$work_dir"
}
trap cleanup exit

wait_for_backend_wait() {
  local application_name="$1"
  local expected_wait_type="$2"
  local client_pid="$3"
  local log_file="$4"
  local observed=""

  for _ in $(seq 1 200); do
    observed="$(psql_scalar "
      select coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '')
      from pg_catalog.pg_stat_activity
      where application_name = '${application_name}'
    ")"

    if [[ "$observed" == "${expected_wait_type}:"* ]]; then
      return 0
    fi

    if ! kill -0 "$client_pid" 2>/dev/null; then
      echo "backend exited before ${expected_wait_type} wait: ${application_name}" >&2
      sed -n '1,160p' "$log_file" >&2
      return 1
    fi

    sleep 0.05
  done

  echo "timed out waiting for ${expected_wait_type}: ${application_name} (last=${observed})" >&2
  sed -n '1,160p' "$log_file" >&2
  return 1
}

terminate_test_backends
cleanup_fixtures

# 전역 카드 리워드 게이트가 OFF면 교환 자체가 성립하지 않는다(발급 행이 삼켜지고
# RPC가 전체를 롤백한다). 원래 값을 적어 두고 켠 뒤, 종료 시 되돌린다.
psql_scalar "select enabled from private.card_reward_control where singleton" > "$gate_restore_file"

psql_exec -q <<SQL >/dev/null
update private.card_reward_control set enabled = true where singleton;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '${user_id}', 'authenticated', 'authenticated',
  'coin-race@example.test', pg_catalog.now(),
  '{}', '{}', pg_catalog.now(), pg_catalog.now()
);

update public.profiles
set
  email = 'coin-race@example.test',
  nickname = 'coin_race',
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}',
  onboarded_at = pg_catalog.now()
where id = '${user_id}'::uuid;

insert into public.ips (id, title, vertical_key)
values ('coin-race-ip', '코인 경합 IP', 'character');

insert into public.card_pools (id, ip_id, name)
values ('${pool_id}'::uuid, 'coin-race-ip', '코인 경합 풀');

insert into public.pool_odds (pool_id, rarity, probability)
values
  ('${pool_id}'::uuid, 'N', 1),
  ('${pool_id}'::uuid, 'R', 0),
  ('${pool_id}'::uuid, 'SR', 0),
  ('${pool_id}'::uuid, 'SSR', 0),
  ('${pool_id}'::uuid, 'HOLO', 0);

insert into public.cards (id, ip_id, name, no, rarity, pool_id)
values ('coin-race-card', 'coin-race-ip', '코인 경합 카드', '001', 'N', '${pool_id}'::uuid);

insert into public.coin_exchange_offers (id, pool_id, label, coin_cost, ticket_count, status)
values ('${offer_id}'::uuid, '${pool_id}'::uuid, '경합 카드팩', ${coin_cost}, ${ticket_count}, 'active');

-- 원장과 캐시를 함께 시드해 두 값이 어긋난 상태에서 시작하지 않게 한다.
insert into public.coin_ledger (user_id, amount, reason, attended_on)
values ('${user_id}'::uuid, ${coin_cost}, 'attendance', current_date);

insert into public.coin_balances (user_id, balance)
values ('${user_id}'::uuid, ${coin_cost});
SQL

holder_application="${test_prefix}-holder"
racer_application="${test_prefix}-racer"

# 첫 세션: 교환을 끝낸 채 커밋을 잠깐 지연한다(coin_balances 행 잠금 보유).
docker exec -e PGAPPNAME="$holder_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$holder_log" 2>&1 <<SQL &
begin;
select pg_catalog.set_config('request.jwt.claim.sub', '${user_id}', true);
set local role authenticated;
select public.exchange_coins_for_draw_tickets(
  '${first_operation_id}'::uuid, '${offer_id}'::uuid
);
select pg_catalog.pg_sleep(3);
commit;
SQL
holder_client_pid=$!
wait_for_backend_wait "$holder_application" "Timeout" "$holder_client_pid" "$holder_log"

# 두 번째 세션: 다른 멱등 키로 같은 잔액을 노린다 — 행 잠금 뒤에 줄을 서야 한다.
docker exec -e PGAPPNAME="$racer_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$racer_log" 2>&1 <<SQL &
begin;
select pg_catalog.set_config('request.jwt.claim.sub', '${user_id}', true);
set local role authenticated;
select public.exchange_coins_for_draw_tickets(
  '${second_operation_id}'::uuid, '${offer_id}'::uuid
);
commit;
SQL
racer_client_pid=$!
wait_for_backend_wait "$racer_application" "Lock" "$racer_client_pid" "$racer_log"

if ! wait "$holder_client_pid"; then
  echo "first exchange should have committed" >&2
  sed -n '1,160p' "$holder_log" >&2
  exit 1
fi

if wait "$racer_client_pid"; then
  echo "second exchange should have failed after the balance was consumed" >&2
  sed -n '1,160p' "$racer_log" >&2
  exit 1
fi

if ! grep -q 'insufficient_coins' "$racer_log"; then
  echo "second exchange failed for an unexpected reason" >&2
  sed -n '1,160p' "$racer_log" >&2
  exit 1
fi

final_state="$(psql_scalar "
  select case when
    (select balance from public.coin_balances where user_id = '${user_id}'::uuid) = 0
    and (
      select count(*) from public.coin_ledger
      where user_id = '${user_id}'::uuid and reason = 'exchange'
    ) = 1
    and (
      select count(*) from public.coin_ledger
      where operation_id = '${first_operation_id}'::uuid
    ) = 1
    and not exists (
      select 1 from public.coin_ledger
      where operation_id = '${second_operation_id}'::uuid
    )
    and (
      select count(*) from public.draw_tickets
      where source = 'coin_exchange' and source_id = '${first_operation_id}'::uuid
    ) = ${ticket_count}
    and not exists (
      select 1 from public.draw_tickets
      where source = 'coin_exchange' and source_id = '${second_operation_id}'::uuid
    )
  then 'ok' else 'invalid' end
")"

if [[ "$final_state" != "ok" ]]; then
  echo "coin balance was not serialized by the balance row lock" >&2
  psql_scalar "
    select 'balance=' || coalesce((
      select balance::text from public.coin_balances where user_id = '${user_id}'::uuid
    ), 'none')
      || ' ledger=' || (
        select count(*)::text from public.coin_ledger where user_id = '${user_id}'::uuid
      )
      || ' tickets=' || (
        select count(*)::text from public.draw_tickets
        where source = 'coin_exchange' and user_id = '${user_id}'::uuid
      )
  " >&2
  exit 1
fi

echo "PASS=coin-exchange-balance-race"
