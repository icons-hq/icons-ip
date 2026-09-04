-- D-4b ① — 보안 엑셀 비밀번호 · 업로드(재고·송장 회신) (설계서 v2 §1-7, 리서치 보고서 G §4·§5)
--
-- 비밀번호는 저장하지 않는다. 워커가 파일을 만들 때 한 번 쓰고 지우는 임시 보관함에만 두고,
-- 잡 원장에는 sha256 만 남겨 「이 파일에 암호가 걸렸다」는 사실만 확인할 수 있게 한다.
--
-- 업로드는 파일 하나 = 잡 하나다. 같은 파일을 다시 올리면 새로 적용하지 않고 이전 리포트를 돌려준다
-- (사람은 실패한 줄만 고쳐 다시 올린다 — 그때는 내용이 달라 sha256 도 달라진다).

alter table public.export_jobs add column password_hash text;
comment on column public.export_jobs.password_hash is '파일 열기 암호의 sha256. 원문은 보관하지 않는다 — 여기 값은 「암호가 걸렸다」는 표시일 뿐이다.';

-- 워커가 한 번 읽고 지우는 임시 보관함. 어느 앱 역할도 닿지 못한다.
create table private.export_job_secrets (
  job_id uuid primary key references public.export_jobs (id) on delete cascade,
  password text not null,
  created_at timestamptz not null default now()
);
revoke all on table private.export_job_secrets from public, anon, authenticated, service_role;

create or replace function public.consume_export_job_secret(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_password text;
begin
  delete from private.export_job_secrets as secret
  where secret.job_id = p_job_id
  returning secret.password into v_password;
  return v_password;
end;
$$;
revoke all on function public.consume_export_job_secret(uuid) from public, anon, authenticated;
grant execute on function public.consume_export_job_secret(uuid) to service_role;

-- 요청 RPC 에 비밀번호를 받는 자리를 만든다. 개인정보 양식을 xlsx 로 뽑을 때만 필요하다.
create or replace function public.admin_request_export(
  p_client_key uuid,
  p_template_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_reason text default null,
  p_password text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_template public.export_templates;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_password text := nullif(p_password, '');
  v_existing uuid;
  v_today integer;
  v_job uuid;
begin
  if p_client_key is null then
    raise exception 'invalid_client_key' using errcode = '22004';
  end if;

  select job.id into v_existing from public.export_jobs as job where job.client_key = p_client_key;
  if found then
    return v_existing;
  end if;

  select * into v_template from public.export_templates as template where template.id = p_template_id;
  if not found or v_template.archived_at is not null then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;

  if v_template.security_level = 'pii' then
    if not public.is_secure_exporter() then
      raise exception 'secure_export_required' using errcode = '42501';
    end if;
    if v_reason is null or char_length(v_reason) < 2 then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    -- 개인정보를 엑셀로 내보내면 파일 자체에 열기 암호를 건다(고시 제2025-9호 §7 저장 시 암호화).
    if v_template.file_format = 'xlsx' and (v_password is null or char_length(v_password) < 8) then
      raise exception 'password_required' using errcode = '22023';
    end if;
    select count(*) into v_today
    from public.export_jobs as job
    join public.export_templates as template on template.id = job.template_id
    where job.requested_by = v_actor
      and template.security_level = 'pii'
      and job.created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
    if v_today >= 20 then
      raise exception 'daily_quota_exceeded' using errcode = 'P0001';
    end if;
  end if;

  insert into public.export_jobs (client_key, template_id, filters, requested_by, reason, password_hash)
  values (
    p_client_key, p_template_id, coalesce(p_filters, '{}'::jsonb), v_actor, v_reason,
    case when v_password is not null then encode(extensions.digest(v_password, 'sha256'), 'hex') end
  )
  returning id into v_job;

  if v_password is not null then
    insert into private.export_job_secrets (job_id, password) values (v_job, v_password);
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.export.requested', 'export_job:' || v_job::text,
          jsonb_build_object('template', v_template.key, 'security', v_template.security_level,
                             'reason', v_reason, 'encrypted', v_password is not null));
  return v_job;
end;
$$;
revoke all on function public.admin_request_export(uuid, uuid, jsonb, text, text) from public, anon, service_role;
grant execute on function public.admin_request_export(uuid, uuid, jsonb, text, text) to authenticated;
drop function if exists public.admin_request_export(uuid, uuid, jsonb, text);

-- ---------------------------------------------------------------------------
-- 업로드 — 파일 하나 = 잡 하나. 검증(리포트) → 적용 두 단계.
-- ---------------------------------------------------------------------------
create type public.import_kind as enum ('stock_set', 'tracking');
create type public.import_status as enum ('validated', 'applied', 'failed');

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  kind public.import_kind not null,
  file_name text,
  file_sha256 text not null,
  requested_by uuid not null references public.profiles (id),
  status public.import_status not null default 'validated',
  atomic boolean not null default false,
  total_rows integer not null default 0,
  ok_rows integer not null default 0,
  failed_rows integer not null default 0,
  report jsonb not null default '[]'::jsonb,
  applied_rows integer,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (kind, file_sha256, requested_by)
);
comment on table public.import_jobs is '업로드 원장. 같은 사람이 같은 종류의 같은 파일을 다시 올리면 새로 적용하지 않고 이전 리포트를 돌려준다.';
create index import_jobs_requester_idx on public.import_jobs (requested_by, created_at desc);

alter table public.import_jobs enable row level security;
create policy import_jobs_read on public.import_jobs for select to authenticated
  using (requested_by = (select auth.uid()) or (select private.is_admin_actor()));
grant select on public.import_jobs to authenticated;
revoke insert, update, delete, truncate on public.import_jobs from anon, authenticated;
revoke all on public.import_jobs from anon;

/*
 * 검증만 한다 — 여기서는 아무것도 바뀌지 않는다. 운영자가 리포트를 보고 적용을 누른다.
 * 행 모양: 재고 = {ref, location_id?, on_hand_qty, safety_qty?} · 송장 = {order_ref, carrier, tracking}
 */
create or replace function public.admin_register_import(
  p_kind public.import_kind,
  p_file_name text,
  p_file_sha256 text,
  p_rows jsonb,
  p_atomic boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_existing uuid;
  v_row record;
  v_report jsonb := '[]'::jsonb;
  v_ok integer := 0;
  v_failed integer := 0;
  v_total integer;
  v_job uuid;
  v_seen text[] := '{}';
  v_key text;
  v_variant uuid;
  v_candidates integer;
  v_order uuid;
  v_carrier text;
  v_tracking text;
begin
  if p_file_sha256 is null or char_length(p_file_sha256) <> 64 then
    raise exception 'invalid_file' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid_rows' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total < 1 or v_total > 1000 then
    raise exception 'invalid_rows' using errcode = '22023';
  end if;

  select job.id into v_existing
  from public.import_jobs as job
  where job.kind = p_kind and job.file_sha256 = p_file_sha256 and job.requested_by = v_actor;
  if found then
    return v_existing;
  end if;

  for v_row in
    -- 줄 번호는 파일의 줄이다. 파서가 실어 보낸 값이 있으면 그것을 쓰고, 없으면 배열 순서를 쓴다 —
    -- 리포트를 보는 사람은 배열이 아니라 파일을 열어 고친다.
    select element.value as row, coalesce((element.value ->> 'line')::integer, element.ordinality::integer) as line
    from jsonb_array_elements(p_rows) with ordinality as element(value, ordinality)
  loop
    if p_kind = 'stock_set' then
      v_key := nullif(btrim(coalesce(v_row.row ->> 'ref', '')), '');
      if v_key is null then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'ref_missing');
        v_failed := v_failed + 1;
        continue;
      end if;
      select variant.id into v_variant from public.good_variants as variant where variant.custom_code = v_key;
      if v_variant is null then
        select variant.id into v_variant from public.good_variants as variant where variant.code = v_key;
      end if;
      if v_variant is null then
        select count(*), min(variant.id::text)::uuid into v_candidates, v_variant
        from public.good_variants as variant
        where variant.good_id = v_key and variant.archived_at is null;
        if v_candidates > 1 then
          v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'variant_ambiguous');
          v_failed := v_failed + 1;
          continue;
        end if;
      end if;
      if v_variant is null then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'variant_not_found');
        v_failed := v_failed + 1;
        continue;
      end if;
      if jsonb_typeof(v_row.row -> 'on_hand_qty') <> 'number'
        or (v_row.row ->> 'on_hand_qty')::numeric < 0
        or (v_row.row ->> 'on_hand_qty')::numeric <> floor((v_row.row ->> 'on_hand_qty')::numeric)
      then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'invalid_qty');
        v_failed := v_failed + 1;
        continue;
      end if;
      v_ok := v_ok + 1;

    else
      v_key := nullif(btrim(coalesce(v_row.row ->> 'order_ref', '')), '');
      v_carrier := nullif(btrim(coalesce(v_row.row ->> 'carrier', '')), '');
      v_tracking := nullif(btrim(coalesce(v_row.row ->> 'tracking', '')), '');
      if v_key is null or v_carrier is null or v_tracking is null then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'missing_cell');
        v_failed := v_failed + 1;
        continue;
      end if;
      if v_tracking !~ '^[0-9A-Za-z-]{6,40}$' then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'invalid_tracking');
        v_failed := v_failed + 1;
        continue;
      end if;
      select ord.id into v_order
      from public.orders as ord
      where ord.id::text = lower(v_key)
         or right(ord.id::text, 8) = lower(replace(v_key, '-', ''));
      if v_order is null then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'order_not_found');
        v_failed := v_failed + 1;
        continue;
      end if;
      if not exists (
        select 1 from public.shipping_carriers as carrier
        where carrier.is_active and (carrier.code = lower(v_carrier) or carrier.label = v_carrier)
      ) then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'carrier_not_found');
        v_failed := v_failed + 1;
        continue;
      end if;
      -- 같은 주문에 두 송장이 적히면 어느 쪽이 맞는지 파일을 만든 사람만 안다 — 둘 다 거절한다.
      if v_order::text = any(v_seen) then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'duplicate_order');
        v_failed := v_failed + 1;
        continue;
      end if;
      v_seen := v_seen || v_order::text;
      v_ok := v_ok + 1;
    end if;
  end loop;

  insert into public.import_jobs (
    kind, file_name, file_sha256, requested_by, atomic, total_rows, ok_rows, failed_rows, report,
    status
  )
  values (
    p_kind, nullif(btrim(coalesce(p_file_name, '')), ''), p_file_sha256, v_actor, coalesce(p_atomic, false),
    v_total, v_ok, v_failed, v_report,
    'validated'
  )
  returning id into v_job;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.import.registered', 'import_job:' || v_job::text,
          jsonb_build_object('kind', p_kind, 'total', v_total, 'ok', v_ok, 'failed', v_failed));
  return v_job;
end;
$$;

-- 적용. 검증에서 통과한 줄만 적용하고, `atomic` 이면 오류가 하나라도 있으면 아무것도 적용하지 않는다.
create or replace function public.admin_apply_import(p_job_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_job public.import_jobs;
  v_failed_lines integer[];
  v_row record;
  v_applied integer := 0;
  v_stock_rows jsonb := '[]'::jsonb;
  v_result jsonb;
  v_order uuid;
  v_carrier text;
begin
  select * into v_job from public.import_jobs as job where job.id = p_job_id for update;
  if not found then
    raise exception 'import_not_found' using errcode = 'P0002';
  end if;
  if v_job.requested_by <> v_actor and not private.is_admin_actor() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_job.status <> 'validated' then
    raise exception 'not_validated' using errcode = 'P0001';
  end if;
  if v_job.atomic and v_job.failed_rows > 0 then
    raise exception 'atomic_has_errors' using errcode = 'P0001';
  end if;

  select coalesce(array_agg((entry ->> 'line')::integer), '{}')
    into v_failed_lines
  from jsonb_array_elements(v_job.report) as entry;

  for v_row in
    select element.value as row, coalesce((element.value ->> 'line')::integer, element.ordinality::integer) as line
    from jsonb_array_elements(p_rows) with ordinality as element(value, ordinality)
  loop
    if v_row.line = any(v_failed_lines) then
      continue;
    end if;

    if v_job.kind = 'stock_set' then
      v_stock_rows := v_stock_rows || v_row.row;
    else
      select ord.id into v_order
      from public.orders as ord
      where ord.id::text = lower(v_row.row ->> 'order_ref')
         or right(ord.id::text, 8) = lower(replace(v_row.row ->> 'order_ref', '-', ''));
      select carrier.code into v_carrier
      from public.shipping_carriers as carrier
      where carrier.is_active
        and (carrier.code = lower(v_row.row ->> 'carrier') or carrier.label = v_row.row ->> 'carrier');
      if v_order is not null and v_carrier is not null then
        perform public.admin_update_order_tracking(v_order, v_carrier, v_row.row ->> 'tracking');
        v_applied := v_applied + 1;
      end if;
    end if;
  end loop;

  if v_job.kind = 'stock_set' and jsonb_array_length(v_stock_rows) > 0 then
    -- 재고는 이미 있는 절대값 일괄 RPC 를 그대로 쓴다 — 잠금 순서·이동 기록·경고 규칙이 한 곳에만 있다.
    v_result := public.admin_set_variant_stock_bulk(
      p_job_id, 'excel', v_stock_rows, 'excel_set', v_job.file_name
    );
    v_applied := coalesce((v_result ->> 'applied')::integer, 0);
  end if;

  update public.import_jobs
  set status = 'applied',
      applied_rows = v_applied,
      -- 일괄 RPC 가 「전부 성공 아니면 전부 실패」라 0줄 적용이 나올 수 있다. 이유를 남긴다.
      error = case
        when v_result is not null and jsonb_array_length(coalesce(v_result -> 'errors', '[]'::jsonb)) > 0
          then '재고 일괄 반영 거부: ' || (v_result -> 'errors')::text
      end,
      finished_at = now()
  where id = p_job_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.import.applied', 'import_job:' || p_job_id::text,
          jsonb_build_object('kind', v_job.kind, 'applied', v_applied));
  return jsonb_build_object('applied', v_applied, 'skipped', v_job.failed_rows);
end;
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_register_import(public.import_kind, text, text, jsonb, boolean)',
    'public.admin_apply_import(uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 만료 파일 — 매일 새벽 표시만 하고, 실제 삭제는 보관함에 닿는 워커가 한다.
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_export_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.export_jobs
    set status = 'expired'
    where status = 'done' and expires_at is not null and expires_at <= pg_catalog.now()
    returning 1
  )
  select count(*)::integer into v_count from expired;
  return v_count;
end;
$$;
revoke all on function public.expire_stale_export_jobs() from public, anon, authenticated;
grant execute on function public.expire_stale_export_jobs() to service_role;

select cron.schedule(
  'expire-stale-exports',
  '0 19 * * *',  -- UTC 19:00 = KST 04:00
  $cron$select public.expire_stale_export_jobs();$cron$
);
