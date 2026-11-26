begin;

-- 화면과 같은 관리자 권한을 사용한다. 사진은 유효한 본인 로그인 세션에만 전달한다.
create or replace function private.overseas_reviewer(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_user is not null and p_user = (select auth.uid())
    and private.has_operator_capability(p_user, 'platform.manage', true)
    and exists (
      select 1 from auth.sessions s
      where s.user_id = p_user and s.id::text = (select auth.jwt()->>'session_id')
        and (s.not_after is null or s.not_after > clock_timestamp())
    );
$$;

create or replace function private.overseas_intake_open() returns boolean
language sql stable security definer set search_path='' as $$
  select exists (select 1 from private.overseas_adult_policy where effective_at <= now())
    and private.adult_goods_storefront_enabled()
    and exists (
      select 1 from private.overseas_adult_goods a
      join public.goods g on g.id = a.good_id join public.ips i on i.id = g.ip_id
      where g.sale_restriction = 'adult' and g.published_at is not null and g.archived_at is null
        and i.published_at is not null and i.archived_at is null
    )
    and exists (
      select 1 from public.profiles p where p.role in ('admin', 'staff') and p.suspended_at is null
        and private.has_operator_capability(p.id, 'platform.manage', true)
    );
$$;

create or replace function public.overseas_adult_management() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.overseas_reviewer((select auth.uid())) then raise insufficient_privilege; end if;
  -- 전환 중인 구버전 화면도 빈 담당자 목록으로 렌더할 수 있다.
  return jsonb_build_object('operators', '[]'::jsonb, 'goods', coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'enabled', a.good_id is not null) order by g.name, g.id)
    from public.goods g left join private.overseas_adult_goods a on a.good_id = g.id
    where g.sale_restriction = 'adult' and g.archived_at is null
  ), '[]'::jsonb));
end $$;

-- 기존 상품 지정 호출의 인자와 감사 기록을 유지한다.
create or replace function public.configure_overseas_adult_review(p_kind text,p_target text,p_enabled boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid := (select auth.uid());
begin
  if not private.overseas_reviewer(actor) then raise insufficient_privilege; end if;
  if p_kind is distinct from 'good' or p_target is null or p_enabled is null then return false; end if;
  if p_enabled then
    perform 1 from public.goods where id = p_target and sale_restriction = 'adult' and archived_at is null for update;
    if not found then return false; end if;
    insert into private.overseas_adult_goods(good_id) values(p_target) on conflict do nothing;
  else
    delete from private.overseas_adult_goods where good_id = p_target;
  end if;
  insert into public.audit_log(actor_id,action,target,diff)
    values(actor,'admin.overseas_adult.good',p_target,jsonb_build_object('enabled',p_enabled));
  return true;
end $$;

drop function private.overseas_policy_manager(uuid);
revoke all on function private.overseas_reviewer(uuid), private.overseas_intake_open(),
  public.overseas_adult_management(), public.configure_overseas_adult_review(text,text,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.overseas_adult_management(), public.configure_overseas_adult_review(text,text,boolean)
  to authenticated;
select private.register_operator_internal_contract('private.overseas_reviewer(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.overseas_intake_open()'::regprocedure);
select private.register_operator_rpc_contract('public.overseas_adult_management()'::regprocedure,'platform.manage','read',true);
select private.register_operator_rpc_contract('public.configure_overseas_adult_review(text,text,boolean)'::regprocedure,'platform.manage','write',true);

commit;
