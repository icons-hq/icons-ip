-- 팝업 ⑤ — 목록 RPC (설계서 v2 §1-8)
--
-- 목록이 「지금 어느 페이즈인가」를 함께 준다. 화면이 스스로 계산하면 서버 시계와 갈라진다.

create or replace function public.admin_list_popups()
returns table (
  id text, ip_id text, ip_title text, title text, status text,
  display_state text, starts_at timestamptz, ends_at timestamptz,
  phase_count integer, link_count integer, current_phase text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  return query
  select popup.id, popup.ip_id, ip.title, popup.title, popup.status,
         public.popup_display_state(popup, now()),
         popup.starts_at, popup.ends_at,
         (select count(*)::integer from public.popup_phases as phase where phase.popup_id = popup.id),
         (select count(*)::integer from public.popup_links as link where link.popup_id = popup.id),
         (select phase.key from public.popup_current_phase(popup.id, now()) as phase)
  from public.popups as popup
  left join public.ips as ip on ip.id = popup.ip_id
  order by
    -- 진행 중인 것이 위로. 그다음 예정, 그다음 끝난 것.
    case public.popup_display_state(popup, now())
      when 'live' then 0 when 'upcoming' then 1 when 'paused' then 2
      when 'draft' then 3 when 'ended' then 4 else 5 end,
    popup.starts_at desc, popup.id;
end;
$$;

revoke all on function public.admin_list_popups() from public, anon, service_role;
grant execute on function public.admin_list_popups() to authenticated;
