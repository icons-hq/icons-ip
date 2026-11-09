-- ERP 데이터 읽기 — AX 서버(ERPNext 연동)가 몰 업무 표를 하나의 길로 읽는다.
-- 기본은 public·private 의 모든 업무 표 + auth.users 의 회원 칸. 비밀 칸(토큰·비밀번호·해시·다이제스트·논스·
-- 서명·자격 증명·결제 키)과 비밀 표(빌링 자격 증명·선물 링크 토큰·운영자 초대·내부 계약·성인 인증 세션·
-- 원본 결제·메일 증거·시험 도구)는 몰 쪽에서 막는다. 개인정보 칸은 보내되 AX 가 따로 두고 가린다.
-- 읽기 전용이고 service_role 만 부른다(내부 라우트 /api/internal/erp/data 가 Bearer 비밀 값을 확인한 뒤).
-- 커서는 (updated_at 또는 created_at, 기본 키) 키셋, 둘 다 없으면 기본 키만(받는 쪽이 통째로 다시 읽음).

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
      || 'billing_key|api_key|private_key)$'))
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
      'email_provider_events', 'staging_test_tools'
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

-- 조건: 이어 읽기(p_after = 앞 응답의 next) + 칸 값 거르기(p_where = {"칸": [값, …]}, 칸마다 1,000개까지).
create or replace function private.erp_read_where(
  p_rel regclass, p_order text[], p_cursor text, p_after jsonb, p_where jsonb
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
    select format('(%s) > (%s)',
        string_agg(format('t.%I', o.col), ', ' order by o.ord),
        string_agg(format('%L::%s', case when o.col = p_cursor then p_after->>'at'
                                         else p_after->'key'->>o.col end, c.type), ', ' order by o.ord))
      into v_after
    from unnest(p_order) with ordinality as o(col, ord)
    join private.erp_read_columns(p_rel) as c on c.name = o.col;
    v_parts := v_parts || v_after;
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

create or replace function public.service_erp_read(
  p_table text default null,
  p_columns text[] default null,
  p_after jsonb default null,
  p_where jsonb default null,
  p_limit integer default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_table record;
  v_order text[];
  v_select text;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_rows jsonb;
  v_last jsonb;
begin
  if p_table is null then
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
  execute format('select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from '
      || '(select %s from %s as t where %s order by %s limit %s) as r',
      v_select, v_table.rel,
      private.erp_read_where(v_table.rel, v_order, v_table.cursor_column, p_after, p_where),
      (select string_agg(format('t.%I', col), ', ') from unnest(v_order) as col), v_limit)
    into v_rows;
  v_last := v_rows->-1;
  return jsonb_build_object(
    'table', v_table.name,
    'key', to_jsonb(v_table.key_columns),
    'cursor', v_table.cursor_column,
    'rows', v_rows,
    'next', case when jsonb_array_length(v_rows) < v_limit then null else jsonb_build_object(
      'at', v_last->v_table.cursor_column,
      'key', (select jsonb_object_agg(k, v_last->k) from unnest(v_table.key_columns) as k)) end
  );
end;
$$;

revoke all on function private.erp_read_tables() from public, anon, authenticated, service_role;
revoke all on function private.erp_read_columns(regclass) from public, anon, authenticated, service_role;
revoke all on function private.erp_read_catalog() from public, anon, authenticated, service_role;
revoke all on function private.erp_read_where(regclass, text[], text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.service_erp_read(text, text[], jsonb, jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.service_erp_read(text, text[], jsonb, jsonb, integer) to service_role;
select private.register_operator_internal_contract(
  'public.service_erp_read(text,text[],jsonb,jsonb,integer)'::regprocedure);
notify pgrst, 'reload schema';
