-- ERP 데이터 읽기 — AX 서버(ERPNext 연동)가 몰 업무 표를 하나의 길로 읽는다.
-- 기본은 public·private 의 모든 업무 표 + auth.users 의 회원 칸. 비밀 칸(토큰·비밀번호·해시·다이제스트·논스·
-- 서명·자격 증명·결제 키·원본 결제 응답)과 비밀 표(빌링 자격 증명·선물 링크 토큰·운영자 초대·내부 계약·성인 인증 세션·
-- 원본 결제·메일 증거·시험 도구·이 읽기의 접근 기록)는 몰 쪽에서 막는다. 개인정보 칸은 보내되 AX 가 따로 두고 가린다.
-- service_role 만 부른다(내부 라우트 /api/internal/erp/data 가 Bearer 비밀 값을 확인한 뒤).
-- 커서는 (updated_at 또는 created_at, 기본 키) 키셋, 둘 다 없으면 기본 키만(받는 쪽이 통째로 다시 읽음).
--
-- 안전 경계: updated_at 은 대부분 트랜잭션 시작 시각(now())이다. 먼저 시작해 늦게 커밋한 줄은 이미 지나간 커서 앞에
-- 놓일 수 있으므로, 이어 읽기는 "아직 진행 중인 트랜잭션이 없음이 확인된 시각"(settled_before) 앞의 줄만 돌려준다.
-- 근거: 그 시각 앞으로 새 줄이 커밋될 수 없다(xact_start ≤ 쓰는 줄의 시각). 경계를 먼저 구하고 그 뒤에 새 스냅숏으로
-- 읽어야 하므로 service_erp_read 는 VOLATILE 이다(STABLE 은 호출 문장의 스냅숏을 재사용한다).
--
-- 접근 기록: 표·칸·거른 칸 이름·돌려준 줄 수를 읽기와 같은 트랜잭션에 남긴다(기록 실패 = 읽기 실패, 값은 저장하지 않는다).

create table private.erp_read_access_log (
  id bigint generated always as identity primary key,
  read_at timestamptz not null default clock_timestamp(),
  -- 요청값을 믿지 않고 함수가 고정한다(결제 재조정 route 의 고정 actor 와 같은 원칙).
  actor text not null default 'ax-erp-sync',
  outcome text not null check (outcome in ('ok', 'rejected', 'failed')),
  table_name text,            -- null = 표 목록
  column_names text[],        -- 호출자가 고른 칸(null = 허용 칸 전체)
  filter_columns text[],      -- where 칸 이름만. 값은 메일·전화번호일 수 있어 저장하지 않는다
  row_count integer
);
create index erp_read_access_log_read_at_idx on private.erp_read_access_log (read_at);

-- 줄이 나가지 않은 빈 이어 읽기(10분마다 표 338개 × 대부분 0줄)와 인증 실패는 건건이 쌓지 않고 집계만 한다.
create table private.erp_read_access_rollup (
  bucket timestamptz not null,   -- idle = KST 하루, denied = 1분
  table_name text not null default '',
  outcome text not null check (outcome in ('idle', 'denied')),
  calls bigint not null,
  last_at timestamptz not null,
  primary key (bucket, table_name, outcome)
);

alter table private.erp_read_access_log enable row level security;
alter table private.erp_read_access_rollup enable row level security;
revoke all on private.erp_read_access_log from public, anon, authenticated, service_role;
revoke all on private.erp_read_access_rollup from public, anon, authenticated, service_role;

create or replace function private.erp_read_columns(p_rel regclass)
returns table(name text, type text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.attname::text, pg_catalog.format_type(a.atttypid, a.atttypmod)
  from pg_catalog.pg_attribute as a
  where a.attrelid = p_rel and a.attnum > 0 and not a.attisdropped
    and (a.attname ~ '^is_' or a.attname !~ ('(^|_)(token|secret|password|passwd|nonce|salt|hmac|signature|'
      || 'credential|credentials|digest|hash|envelope|encrypted|otp)(_|$)|(^|_)(payment_key|customer_key|'
      || 'billing_key|api_key|private_key)$|^raw$'))
    and (p_rel <> 'auth.users'::regclass or a.attname in (
      'id', 'email', 'phone', 'created_at', 'updated_at', 'last_sign_in_at', 'email_confirmed_at',
      'phone_confirmed_at', 'banned_until', 'deleted_at', 'is_anonymous', 'raw_user_meta_data'))
  order by a.attnum;
$$;

create or replace function private.erp_read_tables()
returns table(rel regclass, name text, key_columns text[], cursor_column text, row_estimate bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.oid::regclass,
    n.nspname || '.' || c.relname,
    (select array_agg(a.attname::text order by k.ord)
       from pg_catalog.pg_index as i
       cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
       join pg_catalog.pg_attribute as a on a.attrelid = i.indrelid and a.attnum = k.attnum
      where i.indrelid = c.oid and i.indisprimary),
    (select a.attname::text from pg_catalog.pg_attribute as a
      where a.attrelid = c.oid and a.attname in ('updated_at', 'created_at') and not a.attisdropped
        and a.attnotnull and a.atttypid = 'pg_catalog.timestamptz'::pg_catalog.regtype
      order by a.attname desc limit 1),
    nullif(greatest(c.reltuples, -1)::bigint, -1)
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and not c.relispartition
    and (n.nspname in ('public', 'private') or (n.nspname = 'auth' and c.relname = 'users'))
    and exists (select 1 from pg_catalog.pg_index as i where i.indrelid = c.oid and i.indisprimary)
    and not exists (
      select 1 from pg_catalog.pg_index as i
      cross join lateral unnest(i.indkey) as k(attnum)
      join pg_catalog.pg_attribute as a on a.attrelid = i.indrelid and a.attnum = k.attnum
      where i.indrelid = c.oid and i.indisprimary
        and a.attname::text not in (select x.name from private.erp_read_columns(c.oid::regclass) as x))
    and c.relname not in (
      'billing_credentials', 'fake_billing_credentials', 'fake_billing_operations', 'fake_billing_payments',
      'gift_link_tokens', 'operator_invitations', 'operator_internal_contracts', 'operator_rpc_contracts',
      'operator_policy_contracts', 'adult_verification_sessions', 'payment_migration_evidence',
      'email_provider_events', 'staging_test_tools', 'erp_read_access_log', 'erp_read_access_rollup'
    );
$$;

create or replace function private.erp_read_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('tables', coalesce(jsonb_agg(jsonb_build_object(
    'name', t.name,
    'key', to_jsonb(t.key_columns),
    'cursor', t.cursor_column,
    'rows', t.row_estimate,
    'columns', (select jsonb_agg(jsonb_build_object('name', c.name, 'type', c.type))
                from private.erp_read_columns(t.rel) as c)
  ) order by t.name), '[]'::jsonb))
  from private.erp_read_tables() as t;
$$;

-- 진행 중 트랜잭션이 더는 앞에 끼어들 수 없는 시각. 인터넷 공개 자료가 아니라 PostgreSQL 공식 동작에 근거한다:
-- pg_stat_activity.xact_start 가 now() 와 같은 값이고, 다른 세션의 값은 pg_read_all_stats 권한이 있어야 보인다.
-- 1시간 넘게 잡힌 트랜잭션은 경계를 더 잡아 두지 않는다(AX 하루 전수 대사가 남은 차이를 고친다).
create or replace function private.erp_read_settled_before()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_oldest timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if current_setting('transaction_isolation') <> 'read committed'
     or not pg_has_role(current_user, 'pg_read_all_stats', 'member') then
    raise exception 'erp_read_horizon_unavailable' using errcode = '55000';
  end if;
  perform pg_stat_clear_snapshot();
  select min(a.xact_start) into v_oldest
  from pg_catalog.pg_stat_activity as a
  where a.datname = current_database() and a.xact_start is not null and a.backend_type <> 'autovacuum worker';
  if v_oldest is null then
    raise exception 'erp_read_horizon_unavailable' using errcode = '55000';
  end if;
  return greatest(v_oldest, v_now - interval '1 hour') - interval '5 seconds';
end;
$$;

-- 조건: 이어 읽기(p_after = 앞 응답의 next) + 칸 값 거르기(p_where = {"칸": [값, …]}, 칸마다 1,000개까지)
-- + 안전 경계(p_settled_before 앞의 줄만). 커서 칸이 하나라도 비면 0줄 "끝"처럼 보이지 않게 거절한다.
create or replace function private.erp_read_where(
  p_rel regclass, p_order text[], p_cursor text, p_after jsonb, p_where jsonb, p_settled_before timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := array['true'];
  v_after text;
  v_filter text;
begin
  if p_after is not null then
    if jsonb_typeof(p_after) <> 'object' or jsonb_typeof(p_after->'key') is distinct from 'object' or exists (
      select 1 from unnest(p_order) as o(col)
      where (case when o.col = p_cursor then p_after->>'at' else p_after->'key'->>o.col end) is null
    ) then
      raise exception 'erp_read_invalid_cursor' using errcode = '22023';
    end if;
    select format('(%s) > (%s)',
        string_agg(format('t.%I', o.col), ', ' order by o.ord),
        string_agg(format('%L::%s', case when o.col = p_cursor then p_after->>'at'
                                         else p_after->'key'->>o.col end, c.type), ', ' order by o.ord))
      into v_after
    from unnest(p_order) with ordinality as o(col, ord)
    join private.erp_read_columns(p_rel) as c on c.name = o.col;
    v_parts := v_parts || v_after;
  end if;
  if p_settled_before is not null and p_cursor is not null then
    v_parts := v_parts || format('t.%I < %L::timestamptz', p_cursor, p_settled_before);
  end if;
  if p_where is null then
    return array_to_string(v_parts, ' and ');
  end if;
  if jsonb_typeof(p_where) <> 'object' or exists (
    select 1 from jsonb_each(p_where) as w
    where jsonb_typeof(w.value) <> 'array' or jsonb_array_length(w.value) > 1000
      or w.key not in (select c.name from private.erp_read_columns(p_rel) as c)
  ) then
    raise exception 'erp_read_invalid_where' using errcode = '22023';
  end if;
  select string_agg(format('t.%I = any(%L::%s[])', c.name,
      (select array_agg(v) from jsonb_array_elements_text(w.value) as v)::text, c.type), ' and ')
    into v_filter
  from jsonb_each(p_where) as w
  join private.erp_read_columns(p_rel) as c on c.name = w.key;
  return array_to_string(v_parts || coalesce(v_filter, 'true'), ' and ');
end;
$$;

-- 한 응답의 크기 한도. Vercel 함수 응답 한도(4.5 MB) 안에 들도록, 이전까지 쌓인 양이 2 MB 를 넘으면 그 줄부터 다음 쪽으로
-- 넘기고, 한 줄이 그 자체로 2 MB 를 넘으면 커서 칸만 담은 자리표시 줄을 보낸다(최악 4 MB + 봉투). 큰 줄 하나가 표 전체를 막지 않는다.
create or replace function private.erp_read_trim(p_rows jsonb, p_keep text[])
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(d.doc order by d.ord) filter (where d.before < 2097152), '[]'::jsonb)
  from (
    select s.doc, s.ord,
      coalesce(sum(octet_length(s.doc::text)) over (order by s.ord rows between unbounded preceding and 1 preceding), 0) as before
    from (
      select case when octet_length(e.value::text) > 2097152
        then (select jsonb_object_agg(k, e.value->k) from unnest(p_keep) as k)
          || jsonb_build_object('_erp_read_omitted', 'oversize_row')
        else e.value end as doc,
        e.ordinality as ord
      from jsonb_array_elements(p_rows) with ordinality as e
    ) as s
  ) as d;
$$;

create or replace function public.service_erp_read(
  p_table text default null,
  p_columns text[] default null,
  p_after jsonb default null,
  p_where jsonb default null,
  p_limit integer default 500,
  p_settled boolean default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_table record;
  v_order text[];
  v_select text;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_settled_before timestamptz;
  v_rows jsonb;
  v_kept jsonb;
  v_last jsonb;
  v_filters text[];
begin
  if p_table is null then
    insert into private.erp_read_access_log (outcome, row_count) values ('ok', null);
    return private.erp_read_catalog();
  end if;
  select * into v_table from private.erp_read_tables() as t where t.name = p_table;
  if not found then
    raise exception 'erp_read_unknown_table' using errcode = '22023';
  end if;
  v_order := case when v_table.cursor_column is null then v_table.key_columns
                  else array[v_table.cursor_column] || v_table.key_columns end;
  select string_agg(format('t.%I', c.name), ', ') into v_select
  from private.erp_read_columns(v_table.rel) as c
  where p_columns is null or c.name = any(p_columns) or c.name = any(v_order);
  -- 값으로 거른 다시 읽기는 지금 보이는 것을 그대로, 이어 읽기(커서 진행)만 안전 경계를 쓴다.
  if v_table.cursor_column is not null and coalesce(p_settled, p_where is null) then
    v_settled_before := private.erp_read_settled_before();
  end if;
  begin
    execute format('select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from '
        || '(select %s from %s as t where %s order by %s limit %s) as r',
        v_select, v_table.rel,
        private.erp_read_where(v_table.rel, v_order, v_table.cursor_column, p_after, p_where, v_settled_before),
        (select string_agg(format('t.%I', col), ', ') from unnest(v_order) as col), v_limit)
      into v_rows;
  exception when data_exception then
    raise exception 'erp_read_invalid_value' using errcode = '22023';
  end;
  v_kept := private.erp_read_trim(v_rows, v_order);
  v_last := v_kept->-1;
  if p_where is not null then
    select array_agg(k order by k) into v_filters from jsonb_object_keys(p_where) as k;
  end if;
  -- 읽기와 같은 트랜잭션: 기록이 실패하면 이 호출 전체가 실패하고 줄도 나가지 않는다.
  if jsonb_array_length(v_kept) > 0 or p_where is not null then
    insert into private.erp_read_access_log (outcome, table_name, column_names, filter_columns, row_count)
    values ('ok', v_table.name, p_columns, v_filters, jsonb_array_length(v_kept));
  else
    insert into private.erp_read_access_rollup (bucket, table_name, outcome, calls, last_at)
    values (date_trunc('day', clock_timestamp(), 'Asia/Seoul'), v_table.name, 'idle', 1, clock_timestamp())
    on conflict (bucket, table_name, outcome)
    do update set calls = private.erp_read_access_rollup.calls + 1, last_at = excluded.last_at;
  end if;
  return jsonb_build_object(
    'table', v_table.name,
    'key', to_jsonb(v_table.key_columns),
    'cursor', v_table.cursor_column,
    'rows', v_kept,
    'settled_before', v_settled_before,
    'next', case when jsonb_array_length(v_rows) < v_limit and jsonb_array_length(v_kept) = jsonb_array_length(v_rows)
      then null else jsonb_build_object(
        'at', v_last->v_table.cursor_column,
        'key', (select jsonb_object_agg(k, v_last->k) from unnest(v_table.key_columns) as k)) end
  );
end;
$$;

-- 데이터가 나가지 않는 경로의 기록(거절·실패·인증 실패). 읽기와 달리 이 기록의 실패가 응답을 바꾸지 않는다.
-- 칸·표 이름은 식별자 모양만 받아, 값이 이름 자리로 흘러 들어와도 남지 않게 한다.
create or replace function public.service_erp_note_access(
  p_outcome text,
  p_table text default null,
  p_columns text[] default null,
  p_filters text[] default null,
  p_count integer default 1
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_outcome = 'denied' then
    insert into private.erp_read_access_rollup (bucket, table_name, outcome, calls, last_at)
    values (date_trunc('minute', clock_timestamp()), '', 'denied', greatest(1, least(coalesce(p_count, 1), 100000)), clock_timestamp())
    on conflict (bucket, table_name, outcome)
    do update set calls = private.erp_read_access_rollup.calls + excluded.calls, last_at = excluded.last_at;
    return;
  end if;
  if p_outcome is null or p_outcome not in ('rejected', 'failed') then
    raise exception 'erp_read_invalid_outcome' using errcode = '22023';
  end if;
  insert into private.erp_read_access_log (outcome, table_name, column_names, filter_columns)
  values (
    p_outcome,
    case when p_table ~ '^(public|private|auth)\.[a-z_][a-z0-9_]{0,62}$' then p_table end,
    (select array_agg(u.c order by u.ord) from unnest(p_columns) with ordinality as u(c, ord)
      where u.c ~ '^[a-z_][a-z0-9_]{0,62}$' and u.ord <= 400),
    (select array_agg(u.c order by u.ord) from unnest(p_filters) with ordinality as u(c, ord)
      where u.c ~ '^[a-z_][a-z0-9_]{0,62}$' and u.ord <= 400)
  );
end;
$$;

revoke all on function private.erp_read_tables() from public, anon, authenticated, service_role;
revoke all on function private.erp_read_columns(regclass) from public, anon, authenticated, service_role;
revoke all on function private.erp_read_catalog() from public, anon, authenticated, service_role;
revoke all on function private.erp_read_settled_before() from public, anon, authenticated, service_role;
revoke all on function private.erp_read_where(regclass, text[], text, jsonb, jsonb, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.erp_read_trim(jsonb, text[]) from public, anon, authenticated, service_role;
revoke all on function public.service_erp_read(text, text[], jsonb, jsonb, integer, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.service_erp_read(text, text[], jsonb, jsonb, integer, boolean) to service_role;
revoke all on function public.service_erp_note_access(text, text, text[], text[], integer)
  from public, anon, authenticated, service_role;
grant execute on function public.service_erp_note_access(text, text, text[], text[], integer) to service_role;

-- 개인정보 안전성 확보조치 기준 제8조의 접속기록 보관(1년 이상, 해당 시 2년 이상) 중 긴 쪽을 쓴다.
select cron.schedule('erp-read-access-retention', '43 3 * * *',
  $job$delete from private.erp_read_access_log where read_at < now() - interval '2 years';
       delete from private.erp_read_access_rollup where bucket < now() - interval '2 years'$job$);

select private.register_operator_internal_contract('private.erp_read_columns(regclass)'::regprocedure);
select private.register_operator_internal_contract('private.erp_read_tables()'::regprocedure);
select private.register_operator_internal_contract('private.erp_read_catalog()'::regprocedure);
select private.register_operator_internal_contract('private.erp_read_settled_before()'::regprocedure);
select private.register_operator_internal_contract(
  'private.erp_read_where(regclass,text[],text,jsonb,jsonb,timestamp with time zone)'::regprocedure);
select private.register_operator_internal_contract('private.erp_read_trim(jsonb,text[])'::regprocedure);
select private.register_operator_internal_contract(
  'public.service_erp_read(text,text[],jsonb,jsonb,integer,boolean)'::regprocedure);
select private.register_operator_internal_contract(
  'public.service_erp_note_access(text,text,text[],text[],integer)'::regprocedure);
notify pgrst, 'reload schema';
