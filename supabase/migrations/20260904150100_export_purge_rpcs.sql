-- D-4b ② — 만료 파일 정리 RPC (설계서 v2 §1-7)
--
-- DB 는 보관함(Storage)에 닿지 못한다. 그래서 지울 목록은 DB 가 주고, 지우는 일은 서버가 하고,
-- 지웠다는 사실은 다시 DB 에 알린다 — 파일을 지우기 전에 포인터를 먼저 지우면 고아 객체가 남는다.

create or replace function public.list_expired_export_files(p_limit integer default 100)
returns table (job_id uuid, file_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select job.id, job.file_path
  from public.export_jobs as job
  where job.status = 'expired' and job.file_path is not null
  order by job.finished_at nulls last, job.created_at
  -- least·greatest 는 함수가 아니라 SQL 구문이라 스키마 한정이 안 된다(coalesce 와 같다).
  limit least(greatest(coalesce(p_limit, 100), 1), 1000);
$$;

create or replace function public.mark_export_files_removed(p_job_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with cleared as (
    update public.export_jobs
    set file_path = null
    where id = any(coalesce(p_job_ids, '{}'::uuid[])) and status = 'expired'
    returning 1
  )
  select count(*)::integer into v_count from cleared;
  return v_count;
end;
$$;

revoke all on function public.list_expired_export_files(integer) from public, anon, authenticated;
revoke all on function public.mark_export_files_removed(uuid[]) from public, anon, authenticated;
grant execute on function public.list_expired_export_files(integer) to service_role;
grant execute on function public.mark_export_files_removed(uuid[]) to service_role;
