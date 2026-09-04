-- D-4 ② — 내보내기 RPC (설계서 v2 §1-7 RPC 표, 리서치 보고서 G §6)
--
-- 개인정보 열의 마스킹은 **DB 에서** 한다. 앱이 마스킹하면 원문이 이미 앱까지 나온 뒤라
-- 권한 검사가 늦다 — 권한 없는 요청자에게는 원문이 애초에 행으로 나오지 않는다.

create or replace function private.mask_name(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or pg_catalog.btrim(p_value) = '' then p_value
    when pg_catalog.length(pg_catalog.btrim(p_value)) = 1 then pg_catalog.btrim(p_value)
    when pg_catalog.length(pg_catalog.btrim(p_value)) = 2
      then pg_catalog.left(pg_catalog.btrim(p_value), 1) || '*'
    else pg_catalog.left(pg_catalog.btrim(p_value), 1)
      || pg_catalog.repeat('*', pg_catalog.length(pg_catalog.btrim(p_value)) - 2)
      || pg_catalog.right(pg_catalog.btrim(p_value), 1)
  end;
$$;

-- 뒷 4자리만 남긴다. 구분 기호는 지운 뒤 자릿수로만 판단한다(010-1234-5678 · 02-123-4567 모두).
create or replace function private.mask_phone(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or pg_catalog.btrim(p_value) = '' then p_value
    when pg_catalog.length(pg_catalog.regexp_replace(p_value, '[^0-9]', '', 'g')) < 4 then '****'
    else pg_catalog.repeat('*', pg_catalog.length(pg_catalog.regexp_replace(p_value, '[^0-9]', '', 'g')) - 4)
      || pg_catalog.right(pg_catalog.regexp_replace(p_value, '[^0-9]', '', 'g'), 4)
  end;
$$;

-- 시/군/구까지만 남긴다(배송 지역 통계·창고 판단에는 충분하고, 집을 특정하지 않는다).
create or replace function private.mask_address(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or pg_catalog.btrim(p_value) = '' then p_value
    else pg_catalog.array_to_string(
      (pg_catalog.string_to_array(pg_catalog.btrim(p_value), ' '))[1:2], ' '
    ) || ' ***'
  end;
$$;

revoke all on function private.mask_name(text), private.mask_phone(text), private.mask_address(text) from public;

-- ---------------------------------------------------------------------------
-- 행 소스 — 양식이 가리키는 대상에서 키셋으로 읽는다. 워커가 이 함수만 반복 호출한다.
-- ---------------------------------------------------------------------------
create or replace function public.admin_export_rows(
  p_template_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_after jsonb default null,
  p_limit integer default 1000
)
returns table (row_key jsonb, row_data jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_template public.export_templates;
  v_unmasked boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_after_at timestamptz := nullif(p_after ->> 'at', '')::timestamptz;
  v_after_id uuid := nullif(p_after ->> 'id', '')::uuid;
  v_from timestamptz := nullif(p_filters ->> 'from', '')::timestamptz;
  v_to timestamptz := nullif(p_filters ->> 'to', '')::timestamptz;
  v_status text := nullif(p_filters ->> 'status', '');
  v_location text := nullif(p_filters ->> 'location_id', '');
  v_unshipped boolean := coalesce((p_filters ->> 'unshipped_only')::boolean, false);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  select * into v_template from public.export_templates as template where template.id = p_template_id;
  if not found then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;
  -- 개인정보 양식이라도 권한이 없으면 마스킹된 행만 나간다. 요청 자체는 RPC 가 따로 막는다.
  v_unmasked := v_template.security_level = 'normal' or public.is_secure_exporter();

  if v_template.target <> 'order_items' then
    raise exception 'unsupported_export_target' using errcode = '22023';
  end if;

  return query
  select
    jsonb_build_object('at', ord.created_at, 'id', item.id),
    jsonb_build_object(
      'mall_name', 'XSQUARE몰',
      'order_no', ord.id::text,
      'item_no', item.id::text,
      'ordered_at', pg_catalog.to_char(ord.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
      'order_kind', '일반',
      'order_status', ord.status::text,
      'good_id', item.good_id,
      'good_name', coalesce(item.good_name_snapshot, good.name),
      'variant_code', coalesce(variant.custom_code, item.variant_code_snapshot),
      'option_summary', coalesce(item.option_summary_snapshot, ''),
      'qty', item.qty,
      'unit_price', item.unit_price,
      'line_total', item.qty::bigint * item.unit_price::bigint,
      'paid_total', item.qty::bigint * item.unit_price::bigint,
      'location_name', coalesce(location.name, item.location_id),
      'location_id', item.location_id,
      'carrier_label', coalesce(carrier.label, ord.shipping_carrier),
      'tracking_number', coalesce(ord.tracking_number, ''),
      'ship_by', pg_catalog.to_char((ord.created_at + interval '1 day') at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
      -- 합포장 묶음: 같은 수취인·연락처·주소면 한 배송이다. 상자 규격은 창고가 정한다.
      'shipment_group', pg_catalog.left(pg_catalog.md5(
        coalesce(ord.address ->> 'recipientName', '') || '|' ||
        coalesce(ord.address ->> 'phone', '') || '|' ||
        coalesce(ord.address ->> 'address1', '') || coalesce(ord.address ->> 'address2', '')
      ), 8),
      'box_kind', case when count(*) over (partition by ord.id) > 1 then '합포장' else '단품' end,
      'delivery_note', coalesce(ord.address ->> 'deliveryNote', ''),
      'orderer_name', case when v_unmasked then coalesce(ord.address ->> 'recipientName', '')
                           else private.mask_name(ord.address ->> 'recipientName') end,
      'orderer_phone', case when v_unmasked then coalesce(ord.address ->> 'phone', '')
                            else private.mask_phone(ord.address ->> 'phone') end,
      'recipient_name', case when v_unmasked then coalesce(ord.address ->> 'recipientName', '')
                             else private.mask_name(ord.address ->> 'recipientName') end,
      'recipient_phone', case when v_unmasked then coalesce(ord.address ->> 'phone', '')
                              else private.mask_phone(ord.address ->> 'phone') end,
      'recipient_postal_code', coalesce(ord.address ->> 'postalCode', ''),
      'recipient_address', case
        when v_unmasked then pg_catalog.btrim(coalesce(ord.address ->> 'address1', '') || ' ' || coalesce(ord.address ->> 'address2', ''))
        else private.mask_address(ord.address ->> 'address1')
      end
    )
  from public.order_items as item
  join public.orders as ord on ord.id = item.order_id
  join public.goods as good on good.id = item.good_id
  left join public.good_variants as variant on variant.id = item.variant_id
  left join public.stock_locations as location on location.id = item.location_id
  left join public.shipping_carriers as carrier on carrier.code = ord.shipping_carrier
  where (v_from is null or ord.created_at >= v_from)
    and (v_to is null or ord.created_at < v_to)
    and (v_status is null or ord.status::text = v_status)
    and (v_location is null or item.location_id = v_location)
    and (not v_unshipped or ord.status in ('paid', 'confirmed'))
    and (
      v_after_at is null or v_after_id is null
      or (ord.created_at, item.id) > (v_after_at, v_after_id)
    )
  order by ord.created_at, item.id
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- 요청 · 목록 · 취소 · 다운로드
-- ---------------------------------------------------------------------------
create or replace function public.admin_request_export(
  p_client_key uuid,
  p_template_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_reason text default null
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
    -- 하루 20건. 습관적 대량 추출을 막는 자율 상한(고시 §8 다운로드 확인 주기의 우리 판)
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

  insert into public.export_jobs (client_key, template_id, filters, requested_by, reason)
  values (p_client_key, p_template_id, coalesce(p_filters, '{}'::jsonb), v_actor, v_reason)
  returning id into v_job;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.export.requested', 'export_job:' || v_job::text,
          jsonb_build_object('template', v_template.key, 'security', v_template.security_level, 'reason', v_reason));
  return v_job;
end;
$$;

create or replace function public.admin_list_export_jobs(
  p_status text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  template_id uuid,
  template_key text,
  template_name text,
  security_level public.export_security_level,
  file_format text,
  status public.export_status,
  filters jsonb,
  reason text,
  row_count integer,
  file_bytes bigint,
  error text,
  requested_by uuid,
  requester_nickname text,
  created_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_admin boolean := private.is_admin_actor();
begin
  return query
  select
    job.id, job.template_id, template.key, template.name, template.security_level, template.file_format,
    job.status, job.filters, job.reason, job.row_count, job.file_bytes, job.error,
    job.requested_by, profile.nickname, job.created_at, job.finished_at, job.expires_at,
    count(*) over()::bigint
  from public.export_jobs as job
  join public.export_templates as template on template.id = job.template_id
  left join public.profiles as profile on profile.id = job.requested_by
  where (v_admin or job.requested_by = v_actor)
    and (p_status is null or job.status::text = p_status)
  order by job.created_at desc
  limit v_limit offset v_offset;
end;
$$;

create or replace function public.admin_cancel_export(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_job public.export_jobs;
begin
  select * into v_job from public.export_jobs as job where job.id = p_job_id for update;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;
  if v_job.requested_by <> v_actor and not private.is_admin_actor() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_job.status not in ('queued', 'running') then
    raise exception 'not_cancelable' using errcode = 'P0001';
  end if;

  update public.export_jobs set status = 'canceled', finished_at = now() where id = p_job_id;
  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.export.canceled', 'export_job:' || p_job_id::text, jsonb_build_object('from', v_job.status));
end;
$$;

-- 다운로드는 발급마다 기록한다 — 파일이 아니라 「내려받은 사건」이 감사 대상이다.
create or replace function public.admin_issue_export_download(
  p_job_id uuid,
  p_reason text default null,
  p_url_ttl_seconds integer default 600
)
returns table (file_path text, file_name text, row_count integer, url_expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_job public.export_jobs;
  v_template public.export_templates;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ttl integer := least(greatest(coalesce(p_url_ttl_seconds, 600), 60), 900);
  v_expires timestamptz := now() + make_interval(secs => v_ttl);
begin
  select * into v_job from public.export_jobs as job where job.id = p_job_id;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;
  if v_job.requested_by <> v_actor and not private.is_admin_actor() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_job.status <> 'done' or v_job.file_path is null then
    raise exception 'job_not_done' using errcode = 'P0001';
  end if;
  if v_job.expires_at is not null and v_job.expires_at <= now() then
    raise exception 'job_expired' using errcode = 'P0001';
  end if;

  select * into v_template from public.export_templates as template where template.id = v_job.template_id;
  if v_template.security_level = 'pii' then
    if not public.is_secure_exporter() then
      raise exception 'secure_export_required' using errcode = '42501';
    end if;
    if v_reason is null or char_length(v_reason) < 2 then
      raise exception 'reason_required' using errcode = '22023';
    end if;
  end if;

  insert into public.export_download_logs (job_id, template_id, actor_id, reason, row_count, file_sha256, url_expires_at)
  values (p_job_id, v_job.template_id, v_actor, coalesce(v_reason, '일반 양식'), v_job.row_count, v_job.file_sha256, v_expires);

  return query
  select
    v_job.file_path,
    v_template.key || '_' || to_char(v_job.created_at at time zone 'Asia/Seoul', 'YYYYMMDD_HH24MI') || '.' || v_template.file_format,
    v_job.row_count,
    v_expires;
end;
$$;

-- ---------------------------------------------------------------------------
-- 양식 · 권한
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_export_template(
  p_id uuid,
  p_name text,
  p_target public.export_target,
  p_columns jsonb,
  p_sort jsonb default '[]'::jsonb,
  p_default_filters jsonb default '{}'::jsonb,
  p_security_level public.export_security_level default 'normal',
  p_file_format text default 'csv',
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid := p_id;
begin
  if v_name is null or char_length(v_name) > 60 then
    raise exception 'invalid_template_name' using errcode = '22023';
  end if;
  if jsonb_typeof(p_columns) <> 'array' or jsonb_array_length(p_columns) not between 1 and 100 then
    raise exception 'invalid_columns' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_columns) as column_def
    where column_def ->> 'key' is null or column_def ->> 'header' is null
  ) then
    raise exception 'invalid_columns' using errcode = '22023';
  end if;
  -- 개인정보 열로 정렬하면 파일이 정렬 자체로 사람을 줄 세운다(카페24도 금지).
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_sort, '[]'::jsonb)) as sort_def
    join jsonb_array_elements(p_columns) as column_def on column_def ->> 'key' = sort_def ->> 'key'
    where column_def ->> 'mask' is not null
  ) then
    raise exception 'invalid_columns' using errcode = '22023';
  end if;

  if v_id is not null then
    if exists (select 1 from public.export_templates as template where template.id = v_id and template.is_system) then
      raise exception 'system_template_readonly' using errcode = 'P0001';
    end if;
    update public.export_templates
    set name = v_name, description = nullif(btrim(coalesce(p_description, '')), ''), target = p_target,
        columns = p_columns, sort = coalesce(p_sort, '[]'::jsonb),
        default_filters = coalesce(p_default_filters, '{}'::jsonb),
        security_level = p_security_level, file_format = p_file_format
    where id = v_id;
    if not found then
      raise exception 'template_not_found' using errcode = 'P0002';
    end if;
  else
    insert into public.export_templates (
      name, description, target, columns, sort, default_filters, security_level, file_format, created_by
    )
    values (
      v_name, nullif(btrim(coalesce(p_description, '')), ''), p_target, p_columns,
      coalesce(p_sort, '[]'::jsonb), coalesce(p_default_filters, '{}'::jsonb),
      p_security_level, p_file_format, v_actor
    )
    returning id into v_id;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.export_template.upsert', 'export_template:' || v_id::text,
          jsonb_build_object('name', v_name, 'columns', jsonb_array_length(p_columns), 'security', p_security_level));
  return v_id;
end;
$$;

create or replace function public.admin_set_admin_permission(
  target_user_id uuid,
  target_permission text,
  target_granted boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
begin
  -- 권한을 주는 일은 관리자만 한다. 스태프가 스스로에게 개인정보 권한을 줄 수 없어야 한다.
  if not private.is_admin_actor() then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if target_permission <> 'secure_export' then
    raise exception 'invalid_permission' using errcode = '22023';
  end if;

  insert into public.admin_permissions (user_id, permission, granted_by, revoked_at)
  values (target_user_id, target_permission, v_actor, case when target_granted then null else now() end)
  on conflict (user_id, permission) do update set
    granted_by = v_actor,
    granted_at = case when target_granted then now() else public.admin_permissions.granted_at end,
    revoked_at = case when target_granted then null else now() end;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.permission.' || case when target_granted then 'granted' else 'revoked' end,
          'profile:' || target_user_id::text, jsonb_build_object('permission', target_permission));
end;
$$;

-- ---------------------------------------------------------------------------
-- 워커 · cron 전용(private) — service role 만 닿는다
-- ---------------------------------------------------------------------------
create or replace function private.claim_export_job(p_worker text)
returns public.export_jobs
language plpgsql
set search_path = ''
as $$
declare
  v_job public.export_jobs;
begin
  select * into v_job
  from public.export_jobs as job
  where job.status = 'queued'
  order by job.created_at
  limit 1
  for update skip locked;
  if not found then
    return null;
  end if;

  update public.export_jobs
  set status = 'running', attempts = attempts + 1, locked_at = pg_catalog.now(), worker_id = p_worker
  where id = v_job.id
  returning * into v_job;
  return v_job;
end;
$$;

create or replace function private.finish_export_job(
  p_job_id uuid,
  p_file_path text,
  p_row_count integer,
  p_file_bytes bigint,
  p_file_sha256 text
)
returns void
language sql
set search_path = ''
as $$
  update public.export_jobs
  set status = 'done', file_path = p_file_path, row_count = p_row_count, file_bytes = p_file_bytes,
      file_sha256 = p_file_sha256, finished_at = pg_catalog.now(),
      expires_at = pg_catalog.now() + interval '7 days', error = null
  where id = p_job_id;
$$;

create or replace function private.fail_export_job(p_job_id uuid, p_error text)
returns void
language sql
set search_path = ''
as $$
  update public.export_jobs
  set status = case when attempts >= 3 then 'failed'::public.export_status else 'queued'::public.export_status end,
      error = pg_catalog.left(p_error, 500),
      locked_at = null,
      finished_at = case when attempts >= 3 then pg_catalog.now() end
  where id = p_job_id;
$$;

-- 워커가 죽어도 큐가 멈추지 않게 한다. 10분 넘게 running 이면 되돌리고, 3회 실패하면 접는다.
create or replace function private.requeue_stale_export_jobs()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  with stale as (
    update public.export_jobs
    set status = case when attempts >= 3 then 'failed'::public.export_status else 'queued'::public.export_status end,
        error = case when attempts >= 3 then '워커 응답 없음(3회)' else error end,
        locked_at = null,
        finished_at = case when attempts >= 3 then pg_catalog.now() end
    where status = 'running'
      and locked_at is not null
      and locked_at < pg_catalog.now() - interval '10 minutes'
    returning 1
  )
  select count(*)::integer into v_count from stale;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- ACL
-- ---------------------------------------------------------------------------
do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_export_rows(uuid, jsonb, jsonb, integer)',
    'public.admin_request_export(uuid, uuid, jsonb, text)',
    'public.admin_list_export_jobs(text, integer, integer)',
    'public.admin_cancel_export(uuid)',
    'public.admin_issue_export_download(uuid, text, integer)',
    'public.admin_upsert_export_template(uuid, text, public.export_target, jsonb, jsonb, jsonb, public.export_security_level, text, text)',
    'public.admin_set_admin_permission(uuid, text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
  end loop;

  foreach v_signature in array array[
    'private.claim_export_job(text)',
    'private.finish_export_job(uuid, text, integer, bigint, text)',
    'private.fail_export_job(uuid, text)',
    'private.requeue_stale_export_jobs()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end;
$$;
