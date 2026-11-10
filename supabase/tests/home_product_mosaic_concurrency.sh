#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 2 || ! "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ || ! "$2" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  printf '%s\n' 'Usage: bash supabase/tests/home_product_mosaic_concurrency.sh <test-container> <test-database>' >&2
  exit 64
fi
db_container="$1"; db_database="$2"
actor_id="00000000-0000-4000-8000-000000013581"
work_dir="$(mktemp -d /tmp/icons-mosaic-race.XXXXXX)"
fixtures_created=false; first_pid=''; second_pid=''
psql_exec() { docker exec -i "$db_container" psql -X -U postgres -d "$db_database" -v ON_ERROR_STOP=1 "$@"; }
cleanup() {
  local result=$?
  if [[ -n "$first_pid" ]]; then wait "$first_pid" 2>/dev/null || true; fi
  if [[ -n "$second_pid" ]]; then wait "$second_pid" 2>/dev/null || true; fi
  if [[ "$fixtures_created" == true ]]; then
    if ! psql_exec -q >"$work_dir/cleanup.log" 2>&1 <<SQL
begin;
set local statement_timeout='15s';
do \$\$ begin
 if not exists(select 1 from auth.users where id='$actor_id' and raw_app_meta_data->>'testFixture'='home-product-mosaic-race')
 or exists(select 1 from public.home_curations
   where id in(select ('00000000-0000-4000-8000-00000001359'||i)::uuid from generate_series(1,6) i)
     and (kind<>'product_mosaic' or title not in('race fixture','concurrent')))
 then raise exception 'Refusing cleanup outside owned mosaic fixture'; end if;
end \$\$;
delete from public.audit_log where actor_id='$actor_id';
delete from public.home_curations where id in(select ('00000000-0000-4000-8000-00000001359'||i)::uuid from generate_series(1,6) i);
delete from public.profiles where id='$actor_id';
delete from auth.users where id='$actor_id';
commit;
SQL
    then result=1; fi
  fi
  printf 'Evidence: %s\n' "$work_dir"
  if [[ "$result" != 0 ]]; then for file in "$work_dir"/*.log; do [[ -f "$file" ]] && tail -12 "$file" >&2; done; fi
  exit "$result"
}
trap cleanup EXIT
psql_exec -q >"$work_dir/setup.log" 2>&1 <<SQL
begin;
set local statement_timeout='15s';
do \$\$ begin
 if exists(select 1 from public.home_curations where kind in('product_mosaic','product_collection'))
 then raise exception 'Requires an isolated database without existing free product groups'; end if;
 if exists(select 1 from auth.users where id='$actor_id' or email='mosaic-race@example.test')
 or exists(select 1 from public.profiles where id='$actor_id')
 or exists(select 1 from public.home_curations where id in(select ('00000000-0000-4000-8000-00000001359'||i)::uuid from generate_series(1,6) i))
 or exists(select 1 from public.audit_log where actor_id='$actor_id' or target in(select 'home_curations:00000000-0000-4000-8000-00000001359'||i from generate_series(1,6) i))
 then raise exception 'Fixture already exists; no overwrite'; end if;
end \$\$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values('$actor_id','authenticated','authenticated','mosaic-race@example.test','{"testFixture":"home-product-mosaic-race"}','{}');
insert into public.profiles(id,email,nickname,birth_date,consents,onboarded_at,role) values('$actor_id','mosaic-race@example.test','mosaic_race','2000-01-01','{"terms":true,"privacy":true}',now(),'staff') on conflict(id) do update set role='staff';
insert into public.home_curations(id,kind,title,link_path,display_order,active_from,enabled,payload)
select ('00000000-0000-4000-8000-00000001359'||i)::uuid,'product_mosaic','race fixture','/shop',0,'2020-01-01',false,
 jsonb_build_object('mosaic_title','','mosaic_subtitle','','slots',(select jsonb_agg(jsonb_build_object('good_id',null,'image_path',null)) from generate_series(1,8)))
from generate_series(1,4) i;
commit;
SQL
fixtures_created=true
for writer in 5 6; do
  cat >"$work_dir/$writer.sql" <<SQL
begin;
set local statement_timeout='15s';
set local role authenticated;
select set_config('request.jwt.claim.sub','$actor_id',true);
select public.admin_upsert_home_curation(gen_random_uuid(),'00000000-0000-4000-8000-00000001359$writer','product_mosaic',null,'concurrent','', '/shop',0,'2020-01-01',null,false,null,
 jsonb_build_object('mosaic_title','','mosaic_subtitle','','slots',(select jsonb_agg(jsonb_build_object('good_id',null,'image_path',null)) from generate_series(1,8))));
select pg_sleep(1);
commit;
SQL
done
psql_exec <"$work_dir/5.sql" >"$work_dir/5.log" 2>&1 & first_pid=$!
psql_exec <"$work_dir/6.sql" >"$work_dir/6.log" 2>&1 & second_pid=$!
first_status=0; second_status=0
wait "$first_pid" || first_status=$?
wait "$second_pid" || second_status=$?
first_pid=''; second_pid=''
if [[ "$first_status" == 0 && "$second_status" != 0 ]] || [[ "$first_status" != 0 && "$second_status" == 0 ]]; then
  if [[ "$(psql_exec -Atc "select count(*) from public.home_curations where kind in('product_mosaic','product_collection')")" == 5 ]] && rg -q 'home_free_product_limit' "$work_dir"/*.log; then
    echo 'PASS: simultaneous fifth/sixth mosaic creation commits exactly one writer'; exit 0
  fi
fi
cat "$work_dir/5.log" "$work_dir/6.log" >&2
exit 1
