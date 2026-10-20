-- Configurable loyalty criteria; keep the 90-day window, paid/canceled triggers,
-- manual floor, upgrade-only coupon issuance and one-coupon checkout contract.
create function private.loyalty_criteria_valid(tiers jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare entry jsonb; i integer:=0; disabled boolean:=false; last_amount bigint:=0; last_count bigint:=0;
  amount numeric; item_count numeric; names text[]:=array['silver','gold','platinum'];
begin
  if jsonb_typeof(tiers) is distinct from 'array' then return false; end if;
  if jsonb_array_length(tiers)<>3 then return false; end if;
  for entry in select value from jsonb_array_elements(tiers) loop
    i:=i+1;
    if jsonb_typeof(entry) is distinct from 'object' then return false; end if;
    if not entry ?& array['grade','enabled','amount','itemCount'] or (select count(*) from jsonb_object_keys(entry))<>4
      or entry->>'grade' is distinct from names[i] or jsonb_typeof(entry->'enabled') is distinct from 'boolean'
      or jsonb_typeof(entry->'amount') not in ('number','null') or jsonb_typeof(entry->'itemCount') not in ('number','null') then return false; end if;
    amount:=(entry->>'amount')::numeric; item_count:=(entry->>'itemCount')::numeric;
    if (amount is not null and (amount<>trunc(amount) or amount<1 or amount>1000000000000))
      or (item_count is not null and (item_count<>trunc(item_count) or item_count<1 or item_count>1000000)) then return false; end if;
    if not (entry->>'enabled')::boolean then disabled:=true; continue; end if;
    if disabled or (amount is null and item_count is null)
      or (amount is not null and amount<=last_amount) or (item_count is not null and item_count<=last_count) then return false; end if;
    if amount is not null then last_amount:=amount::bigint; end if;
    if item_count is not null then last_count:=item_count::bigint; end if;
  end loop;
  return true;
end $$;
revoke all on function private.loyalty_criteria_valid(jsonb) from public,anon,authenticated,service_role;

create table public.loyalty_settings (
  singleton boolean primary key default true check(singleton),
  tiers jsonb not null check(private.loyalty_criteria_valid(tiers)),
  revision integer not null default 1 check(revision>0),
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.loyalty_settings(tiers) values
  ('[{"grade":"silver","enabled":true,"amount":100000,"itemCount":null},{"grade":"gold","enabled":true,"amount":300000,"itemCount":null},{"grade":"platinum","enabled":true,"amount":1000000,"itemCount":null}]');
alter table public.loyalty_settings enable row level security;
revoke all on public.loyalty_settings from public,anon,authenticated,service_role;
-- No direct API writes or reads; validated, authenticated RPCs below are the boundary.

create function private.loyalty_grade_for_activity(p_spend bigint,p_item_count bigint,p_tiers jsonb)
returns public.loyalty_grade language sql immutable set search_path='' as $$
  select coalesce(max((entry->>'grade')::public.loyalty_grade),'welcome'::public.loyalty_grade)
  from jsonb_array_elements(p_tiers) entry
  where (entry->>'enabled')::boolean and
    (p_spend >= (entry->>'amount')::bigint or p_item_count >= (entry->>'itemCount')::bigint);
$$;
revoke all on function private.loyalty_grade_for_activity(bigint,bigint,jsonb) from public,anon,authenticated,service_role;

create function private.loyalty_activity(p_user_id uuid)
returns table(spend bigint,item_count bigint) language sql stable set search_path='' as $$
  select coalesce(sum(o.total),0)::bigint,
    coalesce(sum((select count(*) from public.order_items item where item.order_id=o.id)),0)::bigint
  from public.orders o where o.user_id=p_user_id
    and o.status in ('paid','confirmed','shipping','delivered','done')
    and o.created_at >= now()-interval '90 days';
$$;
revoke all on function private.loyalty_activity(uuid) from public,anon,authenticated,service_role;

-- Retain the historical helper signature for internal callers, with current policy.
create or replace function private.loyalty_grade_for_spend(p_spend bigint)
returns public.loyalty_grade language sql stable set search_path='' as $$
  select private.loyalty_grade_for_activity(p_spend,0,tiers) from public.loyalty_settings where singleton;
$$;
revoke all on function private.loyalty_grade_for_spend(bigint) from public,anon,authenticated,service_role;

create or replace function private.recalculate_loyalty_grade(p_user_id uuid)
returns public.loyalty_grade
language plpgsql
volatile
set search_path = ''
as $$
declare
  c_window constant interval := interval '90 days';
  v_current public.loyalty_grade;
  v_spend bigint;
  v_item_count bigint;
  v_policy public.loyalty_settings;
  v_manual_floor public.loyalty_grade;
  v_next public.loyalty_grade;
begin
  -- 같은 유저의 동시 재산정(두 주문이 동시에 paid)을 직렬화한다.
  select profile.loyalty_grade
  into v_current
  from public.profiles as profile
  where profile.id = p_user_id
  for update;

  if not found then
    return null;
  end if;

  select * into strict v_policy from public.loyalty_settings where singleton for share;
  select activity.spend, activity.item_count into v_spend, v_item_count
    from private.loyalty_activity(p_user_id) activity;

  -- 창 안의 수동 보정은 재산정의 바닥이다 — 오프라인 실적 보정이 다음 온라인
  -- 주문 한 건에 지워지면 안 된다(감사 이벤트가 그 근거다). 창을 벗어난 보정은
  -- 온라인 실적과 같은 규칙으로 소멸한다.
  select event.next_grade
  into v_manual_floor
  from public.loyalty_grade_events as event
  where event.user_id = p_user_id
    and event.reason = 'manual_adjustment'
    and event.created_at >= now() - c_window
  order by event.created_at desc
  limit 1;

  v_next := greatest(
    private.loyalty_grade_for_activity(v_spend, v_item_count, v_policy.tiers),
    coalesce(v_manual_floor, 'welcome'::public.loyalty_grade)
  );

  if v_next = v_current then
    return v_current;
  end if;

  update public.profiles
  set loyalty_grade = v_next
  where id = p_user_id;

  insert into public.loyalty_grade_events (user_id, previous_grade, next_grade, reason, basis)
  values (
    p_user_id, v_current, v_next, 'recalculation',
    jsonb_build_object('spend', v_spend, 'itemCount', v_item_count, 'windowDays', 90, 'policyRevision', v_policy.revision, 'criteria', v_policy.tiers)
  );

  if v_next > v_current then
    perform private.grant_grade_benefit_coupons(p_user_id, v_current, v_next);

    -- 강등 후 재승급도 알림 가치가 있다 — 같은 dedupe 키는 재부상시킨다.
    insert into public.notifications (
      user_id, type, title, body, link_path, source_type, source_id, dedupe_key
    )
    values (
      p_user_id,
      'loyalty_grade_upgraded',
      '회원 등급이 올랐어요',
      format('%s 등급이 되었어요. 등급 혜택 쿠폰은 쿠폰함에서 확인할 수 있어요.', upper(v_next::text)),
      '/my/coupons',
      'profile',
      p_user_id::text,
      'loyalty:upgrade:' || p_user_id::text || ':' || v_next::text
    )
    on conflict (user_id, dedupe_key) do update set
      read_at = null,
      created_at = now();
  end if;

  return v_next;
end;
$$;


revoke all on function private.recalculate_loyalty_grade(uuid) from public,anon,authenticated,service_role;

create function public.admin_get_loyalty_policy() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin' and suspended_at is null)
    then raise insufficient_privilege using message='admin_required'; end if;
  return jsonb_build_object('policy',(select jsonb_build_object('tiers',tiers,'revision',revision,'updatedAt',updated_at) from public.loyalty_settings where singleton),
    'coupons',coalesce((select jsonb_agg(jsonb_build_object('code',code,'name',name,'grade',grade_benefit,'status',status) order by grade_benefit,code)
      from public.coupons where grade_benefit in ('silver','gold','platinum')),'[]'::jsonb));
end $$;
revoke all on function public.admin_get_loyalty_policy() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_loyalty_policy() to authenticated;

create function public.admin_save_loyalty_policy(p_tiers jsonb,p_expected_revision integer,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); previous public.loyalty_settings; saved public.loyalty_settings; existing public.audit_log; result jsonb;
begin
  perform 1 from public.profiles where id=actor and role='admin' and suspended_at is null for share;
  if not found or private.is_account_write_fenced(actor) then raise insufficient_privilege using message='admin_required'; end if;
  if p_operation_id is null or p_expected_revision is null or p_expected_revision<1 or not coalesce(private.loyalty_criteria_valid(p_tiers),false)
    then raise invalid_parameter_value using message='invalid_loyalty_policy'; end if;
  select * into strict previous from public.loyalty_settings where singleton for update;
  select * into existing from public.audit_log where id=p_operation_id;
  if found then
    if existing.actor_id=actor and existing.action='commerce.loyalty.policy_updated' and existing.target='loyalty_settings'
      and existing.diff->'after'=p_tiers and (existing.diff->>'expectedRevision')::integer=p_expected_revision then return existing.diff->'result'; end if;
    raise unique_violation using message='operation_conflict';
  end if;
  if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='loyalty_policy_changed'; end if;
  update public.loyalty_settings set tiers=p_tiers,revision=revision+1,updated_at=clock_timestamp() where singleton returning * into saved;
  result:=jsonb_build_object('revision',saved.revision,'updatedAt',saved.updated_at);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'commerce.loyalty.policy_updated','loyalty_settings',
    jsonb_build_object('before',previous.tiers,'after',saved.tiers,'expectedRevision',p_expected_revision,'result',result));
  return result;
end $$;
revoke all on function public.admin_save_loyalty_policy(jsonb,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_loyalty_policy(jsonb,integer,uuid) to authenticated;

-- Self-only aggregate; avoids the Data API row limit and never mutates a grade.
create function public.get_my_loyalty_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); grade public.loyalty_grade; activity record; policy public.loyalty_settings;
begin
  if actor is null then raise insufficient_privilege using message='auth_required'; end if;
  select loyalty_grade into grade from public.profiles where id=actor;
  if not found then return null; end if;
  select * into activity from private.loyalty_activity(actor);
  select * into strict policy from public.loyalty_settings where singleton;
  return jsonb_build_object('grade',grade,'windowSpend',activity.spend,'windowItemCount',activity.item_count,
    'policy',jsonb_build_object('tiers',policy.tiers,'revision',policy.revision,'updatedAt',policy.updated_at));
end $$;
revoke all on function public.get_my_loyalty_status() from public,anon,authenticated,service_role;
grant execute on function public.get_my_loyalty_status() to authenticated;
notify pgrst,'reload schema';
