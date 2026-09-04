-- D-4 ④ — 워커용 함수를 public 으로 옮긴다 (설계서 v2 §1-7)
--
-- PostgREST 는 `public`·`graphql_public` 만 노출한다(supabase/config.toml). 워커는 HTTP 로 RPC 를 부르므로
-- private 스키마에 두면 닿지 않는다. 대신 **권한으로 가둔다** — service_role 에게만 execute 를 준다.
-- 선례: `expire_stale_checkouts`(매분 크론, service role 전용)도 public 에 있고 grant 로만 잠겨 있다.

create or replace function public.claim_export_job(p_worker text)
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

create or replace function public.finish_export_job(
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

create or replace function public.fail_export_job(p_job_id uuid, p_error text)
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

create or replace function public.requeue_stale_export_jobs()
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

create or replace function public.export_rows_for_job(
  p_job_id uuid,
  p_after jsonb default null,
  p_limit integer default 1000
)
returns table (row_key jsonb, row_data jsonb)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_job public.export_jobs;
  v_unmasked boolean;
begin
  select * into v_job from public.export_jobs as job where job.id = p_job_id;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;
  -- 마스킹 여부는 파일을 만드는 손(워커)이 아니라 받는 손(요청자)의 권한으로 정한다.
  select exists (
    select 1
    from public.admin_permissions as permission
    where permission.user_id = v_job.requested_by
      and permission.permission = 'secure_export'
      and permission.revoked_at is null
  ) into v_unmasked;
  return query select * from private.export_rows(v_job.template_id, v_job.filters, p_after, p_limit, v_unmasked);
end;
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.claim_export_job(text)',
    'public.finish_export_job(uuid, text, integer, bigint, text)',
    'public.fail_export_job(uuid, text)',
    'public.requeue_stale_export_jobs()',
    'public.export_rows_for_job(uuid, jsonb, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end;
$$;

-- 크론이 부르는 자리도 옮긴다.
select cron.unschedule('requeue-stale-exports');
select cron.schedule(
  'requeue-stale-exports',
  '* * * * *',
  $cron$select public.requeue_stale_export_jobs();$cron$
);

drop function if exists private.claim_export_job(text);
drop function if exists private.finish_export_job(uuid, text, integer, bigint, text);
drop function if exists private.fail_export_job(uuid, text);
drop function if exists private.requeue_stale_export_jobs();
drop function if exists private.export_rows_for_job(uuid, jsonb, integer);

-- 140200 에서 admin_export_rows 를 다시 만들며 ACL 이 기본값으로 돌아갔다 — 인증 경로만 남긴다.
revoke all on function public.admin_export_rows(uuid, jsonb, jsonb, integer) from public, anon, service_role;
grant execute on function public.admin_export_rows(uuid, jsonb, jsonb, integer) to authenticated;
