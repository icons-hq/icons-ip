-- D-4 ⑧ — 빈 큐를 빈 결과로 돌려준다 (설계서 v2 §1-7)
--
-- `returns public.export_jobs` 는 잡이 없을 때 "모든 열이 null 인 행" 하나로 나온다.
-- PostgREST 는 그걸 JSON null 이 아니라 `{"id":null,...}` 객체로 내보내므로, 워커는
-- 빈 큐를 잡 하나로 착각하고 null 을 uuid 로 조회하다 실패한다(크론은 대부분 빈 큐를 만난다).
-- `setof` 로 바꾸면 없음 = 빈 배열이라 착각할 여지가 사라진다.

drop function if exists public.claim_export_job(text);

create function public.claim_export_job(p_worker text)
returns setof public.export_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select job.id into v_id
  from public.export_jobs as job
  where job.status = 'queued'
  order by job.created_at
  limit 1
  for update skip locked;
  if not found then
    return;
  end if;

  return query
  update public.export_jobs
  set status = 'running', attempts = attempts + 1, locked_at = pg_catalog.now(), worker_id = p_worker
  where id = v_id
  returning *;
end;
$$;

revoke all on function public.claim_export_job(text) from public, anon, authenticated;
grant execute on function public.claim_export_job(text) to service_role;
