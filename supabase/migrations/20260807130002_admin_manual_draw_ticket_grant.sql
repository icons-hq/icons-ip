-- 운영자 수동 뽑기권 발급 (#185).
--
-- 발급 트리거가 order_paid 하나뿐이라 소급 발급 경로가 없었다. 첫 판매에서 카드 리워드
-- 루프를 끄기로 한 결정(계획 D3)의 대가다 — 나중에 카드풀을 만들어도 이미 결제된 주문에는
-- 뽑기권이 나가지 않는다. 지금까지는 service role로 SQL을 직접 넣는 것이 유일한 방법이었다.
--
-- source를 'admin_grant'로 분리해 자동 발급과 섞이지 않게 한다. 수동 발급은 정책에 매달지
-- 않으므로(reward_policy_id = null) 발급 정책 콘솔의 발급/사용 가능/개봉/회수 집계에도
-- 자동으로 포함되지 않는다. 섞이면 정책 효과를 측정할 수 없다.

alter table public.draw_tickets
  drop constraint draw_tickets_source_check;

alter table public.draw_tickets
  add constraint draw_tickets_source_check
    check (source in ('order_paid', 'admin_grant'));

create index draw_tickets_admin_grant_idx
  on public.draw_tickets (source_id, created_at desc)
  where source = 'admin_grant';

-- 수동 발급은 남용 여지가 크므로 한 번에 낼 수 있는 수량을 묶어둔다.
-- 자동 발급 정책의 tickets_per_grant(1~100)보다 낮게 잡는다 — 정책은 조건을 통과한
-- 주문에만 발동하지만 수동 발급은 조건 없이 임의 사용자에게 나간다.
create or replace function public.admin_grant_draw_tickets(
  target_operation_id uuid,
  target_profile_id uuid,
  target_pool_id uuid,
  target_quantity integer,
  target_reason text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_reason text;
  requested_diff jsonb;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
  recipient record;
  pool_record public.card_pools%rowtype;
  pool_is_ready boolean := false;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  -- 발급 정책 콘솔과 같은 권한선을 쓴다. staff는 이미 조건 없는 자동 발급 정책을 만들 수
  -- 있으므로 수동 발급만 admin으로 좁히는 것은 실질 방어가 되지 않는다. 대신 수량 상한과
  -- 감사 기록으로 막는다.
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'invalid_operation_id' using errcode = '22004';
  end if;

  if target_quantity is null or target_quantity not between 1 and 10 then
    raise exception 'invalid_grant_quantity' using errcode = '22023';
  end if;

  normalized_reason := btrim(coalesce(target_reason, ''), E' \t\n\r\f\v');
  if char_length(normalized_reason) < 1 or char_length(normalized_reason) > 200 then
    raise exception 'invalid_grant_reason' using errcode = '22023';
  end if;

  -- 응답이 유실된 재시도는 먼저 커밋된 감사 기록을 관측한 뒤에 판단해야 한다.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_draw_ticket_grant:' || target_operation_id::text, 0)
  );

  requested_diff := jsonb_build_object(
    'poolId', target_pool_id,
    'quantity', target_quantity,
    'reason', normalized_reason
  );

  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.draw_ticket.granted'
      and existing_target = 'profiles:' || target_profile_id::text
      and existing_diff = requested_diff
    then
      return (existing_diff ->> 'quantity')::integer;
    end if;

    raise exception 'grant_conflict' using errcode = '23505';
  end if;

  select profile.id, profile.suspended_at
    into recipient
  from public.profiles as profile
  where profile.id = target_profile_id
  for key share;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  -- 정지 계정은 개봉 자체가 막혀 있다(trg_draw_tickets_active_consumption).
  -- 열 수 없는 티켓을 쌓아두지 않는다.
  if recipient.suspended_at is not null then
    raise exception 'recipient_suspended' using errcode = '55000';
  end if;

  select pool.*
    into pool_record
  from public.card_pools as pool
  where pool.id = target_pool_id
  for share;

  if not found then
    raise exception 'pool_not_found' using errcode = 'P0002';
  end if;

  if pool_record.active_to is not null and now() >= pool_record.active_to then
    raise exception 'reward_pool_not_ready' using errcode = '55000';
  end if;

  -- 발급 정책 콘솔과 같은 준비 판정이다. 확률 합이 100%가 아니거나 확률이 양수인 등급에
  -- 카드가 없으면 개봉이 'pool has no card of rarity'로 실패한다 — 열 수 없는 티켓을
  -- 만들지 않는다.
  select
    count(*) = 5
    and coalesce(sum(pool_odd.probability), 0) = 1
    and coalesce(bool_and(pool_odd.probability between 0 and 1), false)
    and not exists (
      select 1
      from public.pool_odds as positive_odd
      where positive_odd.pool_id = target_pool_id
        and positive_odd.probability > 0
        and not exists (
          select 1
          from public.cards as card
          where card.pool_id = target_pool_id
            and card.rarity = positive_odd.rarity
        )
    )
    into pool_is_ready
  from public.pool_odds as pool_odd
  where pool_odd.pool_id = target_pool_id;

  if not pool_is_ready then
    raise exception 'reward_pool_not_ready' using errcode = '55000';
  end if;

  -- source_id = operation_id 라서 unique (source, source_id, ordinal)이 재시도 이중 발급을
  -- DB 레벨에서 한 번 더 막는다. reward_policy_id는 비워 정책 집계와 분리한다.
  insert into public.draw_tickets (
    user_id,
    pool_id,
    source,
    source_id,
    ordinal
  )
  select
    target_profile_id,
    target_pool_id,
    'admin_grant',
    target_operation_id,
    grant_series.n
  from generate_series(1, target_quantity) as grant_series(n)
  on conflict (source, source_id, ordinal) do nothing;

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_operation_id,
    actor_id,
    'admin.draw_ticket.granted',
    'profiles:' || target_profile_id::text,
    requested_diff
  );

  return target_quantity;
end;
$$;

-- 수동 발급 이력. 사유·실행자·수령자를 한 화면에서 확인해 중복 발급을 막는다.
create or replace function public.admin_list_draw_ticket_grants(
  target_limit integer default 20
)
returns table (
  operation_id uuid,
  granted_at timestamptz,
  actor_nickname text,
  recipient_id uuid,
  recipient_nickname text,
  recipient_masked_email text,
  pool_id uuid,
  pool_name text,
  quantity bigint,
  opened_count bigint,
  revoked_count bigint,
  reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_limit integer := least(greatest(coalesce(target_limit, 20), 1), 100);
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    grant_group.source_id,
    grant_group.granted_at,
    coalesce(
      nullif(btrim(actor_profile.nickname, E' \t\n\r\f\v'), ''),
      'staff_' || left(coalesce(audit.actor_id::text, ''), 6)
    ),
    grant_group.user_id,
    coalesce(
      nullif(btrim(recipient_profile.nickname, E' \t\n\r\f\v'), ''),
      'fan_' || left(grant_group.user_id::text, 6)
    ),
    case
      when nullif(btrim(coalesce(recipient_profile.email, '')), '') is null
        then '이메일 없음'::text
      when strpos(recipient_profile.email, '@') > 1
        then left(split_part(recipient_profile.email, '@', 1), 1)
          || '***@'
          || split_part(recipient_profile.email, '@', 2)
      else '***'::text
    end,
    grant_group.pool_id,
    pool.name,
    grant_group.quantity,
    grant_group.opened_count,
    grant_group.revoked_count,
    coalesce(audit.diff ->> 'reason', '사유 기록 없음')
  from (
    select
      ticket.source_id,
      ticket.user_id,
      ticket.pool_id,
      min(ticket.created_at) as granted_at,
      count(*)::bigint as quantity,
      count(*) filter (where ticket.consumed_at is not null)::bigint as opened_count,
      count(*) filter (where ticket.revoked_at is not null)::bigint as revoked_count
    from public.draw_tickets as ticket
    where ticket.source = 'admin_grant'
    group by ticket.source_id, ticket.user_id, ticket.pool_id
  ) as grant_group
  left join public.audit_log as audit
    on audit.id = grant_group.source_id
    and audit.action = 'admin.draw_ticket.granted'
  left join public.profiles as actor_profile on actor_profile.id = audit.actor_id
  left join public.profiles as recipient_profile on recipient_profile.id = grant_group.user_id
  left join public.card_pools as pool on pool.id = grant_group.pool_id
  order by grant_group.granted_at desc, grant_group.source_id
  limit normalized_limit;
end;
$$;

-- ⚠️ Supabase default privileges는 신규 함수에 anon/authenticated/service_role execute를
--    자동 부여한다. public만 revoke해서는 봉인되지 않는다.
revoke all on function public.admin_grant_draw_tickets(uuid, uuid, uuid, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_grant_draw_tickets(uuid, uuid, uuid, integer, text)
  to authenticated;

revoke all on function public.admin_list_draw_ticket_grants(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_draw_ticket_grants(integer)
  to authenticated;
