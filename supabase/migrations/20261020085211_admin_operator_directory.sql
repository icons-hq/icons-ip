-- Operator duty is an internal label, never an authorization grant.
create table public.operator_assignments (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  duty text not null check(duty in ('sales','marketing','cs','design_content','logistics','accounting','management','other')),
  revision integer not null default 1 check(revision>0),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.operator_assignments enable row level security;
revoke all on public.operator_assignments from public,anon,authenticated,service_role;

create function public.admin_search_operators(p_query text default '',p_role text default 'operators',p_status text default 'all',p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q text:=btrim(coalesce(p_query,'')); result jsonb;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin' and suspended_at is null)
    then raise insufficient_privilege using message='admin_required'; end if;
  if length(q)>100 or p_role is null or p_role not in ('all','operators','user','staff','admin')
    or p_status is null or p_status not in ('all','active','suspended') or p_page is null or p_page<1 or p_page>1000000
    or p_page_size is null or p_page_size not in (20,50,100) then raise invalid_parameter_value using message='invalid_operator_filter'; end if;
  with filtered as materialized (
    select p.id,coalesce(nullif(btrim(p.nickname),''),'fan_'||left(p.id::text,6)) as nickname,
      case when nullif(btrim(coalesce(p.email,'')),'') is null then '이메일 없음'
        when strpos(p.email,'@')>1 then left(split_part(p.email,'@',1),1)||'***@'||split_part(p.email,'@',2) else '***' end as masked_email,
      p.role,p.created_at,p.suspended_at,a.duty,coalesce(a.revision,0) as duty_revision
    from public.profiles p left join public.operator_assignments a on a.profile_id=p.id
    where (p_role='all' or (p_role='operators' and p.role in ('staff','admin')) or p.role::text=p_role)
      and (p_status='all' or (p_status='active' and p.suspended_at is null) or (p_status='suspended' and p.suspended_at is not null))
      and (q='' or strpos(lower(coalesce(p.nickname,'')),lower(q))>0 or strpos(lower(coalesce(p.email,'')),lower(q))>0 or strpos(p.id::text,lower(q))>0)
  ), page_rows as (
    select * from filtered order by created_at desc,id desc limit p_page_size offset (p_page-1)*p_page_size
  ) select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'nickname',nickname,'maskedEmail',masked_email,'role',role,'createdAt',created_at,'suspendedAt',suspended_at,'duty',duty,'dutyRevision',duty_revision)
    order by created_at desc,id desc) from page_rows),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function public.admin_search_operators(text,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_operators(text,text,text,integer,integer) to authenticated;

create function public.admin_set_operator_duty(p_profile_id uuid,p_duty text,p_expected_revision integer,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); previous public.operator_assignments; saved public.operator_assignments; existing public.audit_log; result jsonb;
begin
  if actor is null or p_profile_id is null then raise insufficient_privilege using message='admin_required'; end if;
  -- Stable role checks without introducing a new role or changing access.
  perform 1 from public.profiles where id in (actor,p_profile_id) order by id for share;
  if not exists(select 1 from public.profiles where id=actor and role='admin' and suspended_at is null)
    or private.is_account_write_fenced(actor) then raise insufficient_privilege using message='admin_required'; end if;
  if not exists(select 1 from public.profiles where id=p_profile_id and role in ('staff','admin')) then raise invalid_parameter_value using message='operator_required'; end if;
  if p_duty is null or p_duty not in ('sales','marketing','cs','design_content','logistics','accounting','management','other')
    or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null then raise invalid_parameter_value using message='invalid_operator_duty'; end if;
  perform pg_advisory_xact_lock(hashtextextended('operator-duty:'||p_profile_id::text,0));
  select * into previous from public.operator_assignments where profile_id=p_profile_id for update;
  select * into existing from public.audit_log where id=p_operation_id;
  if found then
    if existing.actor_id=actor and existing.action='admin.operator.duty_updated' and existing.target='profile:'||p_profile_id::text
      and existing.diff->>'after'=p_duty and (existing.diff->>'expectedRevision')::integer=p_expected_revision then return existing.diff->'result'; end if;
    raise unique_violation using message='operation_conflict';
  end if;
  if coalesce(previous.revision,0)<>p_expected_revision then raise sqlstate 'PT409' using message='operator_duty_changed'; end if;
  insert into public.operator_assignments(profile_id,duty) values(p_profile_id,p_duty)
    on conflict(profile_id) do update set duty=excluded.duty,revision=operator_assignments.revision+1,updated_at=clock_timestamp() returning * into saved;
  result:=jsonb_build_object('revision',saved.revision,'duty',saved.duty);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.operator.duty_updated','profile:'||p_profile_id::text,
    jsonb_build_object('before',previous.duty,'after',p_duty,'expectedRevision',p_expected_revision,'result',result));
  return result;
end $$;
revoke all on function public.admin_set_operator_duty(uuid,text,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_set_operator_duty(uuid,text,integer,uuid) to authenticated;
notify pgrst,'reload schema';
