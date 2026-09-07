-- 팝업 ④ — 경계 통과 알림 (설계서 v2 §1-8)
--
-- 페이즈는 상태를 바꾸지 않으므로 정각에 DB 가 할 일은 없다. **캐시만 늦는다** —
-- 화면이 60초 캐시를 들고 있으면 1부가 시작해도 최대 1분간 프리뷰가 걸려 있다.
--
-- 그래서 이 잡은 **아무것도 바꾸지 않는다.** 경계를 지났다는 사실만 앱에 알려 캐시를
-- 버리게 하고 감사에 남긴다. 잡이 죽어도 데이터는 정확하고 화면만 최대 캐시 수명만큼
-- 늦는다 — 상태를 바꾸는 잡이었다면 잡이 죽는 순간 데이터가 틀린다.

create or replace view private.popup_boundaries as
  select phase.popup_id, lower(phase.during) as at, 'phase_start' as kind from public.popup_phases as phase
  union all
  select phase.popup_id, upper(phase.during), 'phase_end' from public.popup_phases as phase
  union all
  select popup.id, popup.starts_at, 'popup_start' from public.popups as popup
  union all
  select popup.id, popup.ends_at, 'popup_end' from public.popups as popup;

create or replace function public.popup_boundary_tick()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_site text;
  v_secret text;
  v_count integer := 0;
begin
  -- 설정이 없으면 아무 일도 하지 않는다. 실패로 적으면 로컬·미설정 환경에서 매분 빨간 줄이
  -- 쌓이고, 진짜 실패가 그 사이에 묻힌다.
  select decrypted_secret into v_site from vault.decrypted_secrets where name = 'popup_revalidate_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'popup_revalidate_secret';
  if v_site is null or v_secret is null then
    return 0;
  end if;

  for v_row in
    -- 지난 1분 안에 지난 경계. 반열림이라 정각은 「지났다」에 든다.
    select distinct boundary.popup_id, boundary.at, boundary.kind
    from private.popup_boundaries as boundary
    where boundary.at > now() - interval '1 minute' and boundary.at <= now()
  loop
    perform net.http_post(
      url := v_site,
      body := jsonb_build_object('popupId', v_row.popup_id, 'at', v_row.at, 'kind', v_row.kind),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-revalidate-secret', v_secret)
    );
    insert into public.audit_log (actor_id, action, target, diff)
    values (null, 'popup.boundary', 'popup:' || v_row.popup_id,
            jsonb_build_object('at', v_row.at, 'kind', v_row.kind));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function public.popup_boundary_tick() is
  '경계 통과 시 앱 캐시만 버리게 한다. **상태는 바꾸지 않는다** — 잡이 죽어도 데이터는 정확하다.';

revoke all on function public.popup_boundary_tick() from public, anon, authenticated;
grant execute on function public.popup_boundary_tick() to service_role;
revoke all on table private.popup_boundaries from public, anon, authenticated, service_role;

select cron.schedule('popup-boundary-tick', '* * * * *', $$select public.popup_boundary_tick();$$)
where not exists (select 1 from cron.job where jobname = 'popup-boundary-tick');
