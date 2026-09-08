-- #410 / #437: IP 보관은 공개 시각을 비운다. 복원은 반드시 초안이며 재공개는 별도 액션이다.
-- 기존 archive RPC의 행 잠금·자식/운영/큐레이션 가드와 감사 경계는 유지한다.
-- 이미 보관된 행도 정리해 배포 이전 보관분이 복원과 동시에 재노출되지 않게 한다.
update public.ips set published_at = null
where archived_at is not null and published_at is not null;

create or replace function private.set_catalog_archived(
  target_kind text,
  target_id text,
  archive_requested boolean
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  selected_archived_at timestamptz;
  transition_at timestamptz;
  audit_action text;
  audit_target text;
begin
  if actor_id is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;

  if not public.is_staff() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if target_kind = 'ip' then
    select ip.archived_at
      into selected_archived_at
    from public.ips as ip
    where ip.id = target_id
    for update of ip;

    if not found then
      raise no_data_found using message = 'catalog_not_found';
    end if;
    if archive_requested = (selected_archived_at is not null) then
      return false;
    end if;

    if archive_requested and exists (
      select 1
      from public.home_curations as curation
      where curation.kind = 'featured_ip'
        and curation.ip_id = target_id
        and curation.enabled
        and (curation.active_to is null or curation.active_to > pg_catalog.now())
    ) then
      raise check_violation using message = 'ip_has_active_home_curation';
    end if;

    transition_at := case when archive_requested then pg_catalog.clock_timestamp() else null end;
    update public.ips
    set archived_at = transition_at, published_at = null
    where id = target_id;
    audit_action := case when archive_requested then 'catalog.ip.archived' else 'catalog.ip.unarchived' end;
    audit_target := 'ips:' || target_id;

  elsif target_kind = 'good' then
    select good.archived_at
      into selected_archived_at
    from public.goods as good
    where good.id = target_id
    for update of good;

    if not found then
      raise no_data_found using message = 'catalog_not_found';
    end if;
    if archive_requested = (selected_archived_at is not null) then
      return false;
    end if;

    if archive_requested and exists (
      select 1
      from public.goods as good
      where good.id = target_id
        and good.stock_qty > 0
    ) then
      raise check_violation using message = 'good_has_stock';
    end if;

    if archive_requested and exists (
      select 1
      from public.reward_policies as policy
      where policy.target_good_id = target_id
        and policy.active
        and (policy.active_to is null or policy.active_to > pg_catalog.now())
    ) then
      raise check_violation using message = 'good_has_active_policy';
    end if;

    transition_at := case when archive_requested then pg_catalog.clock_timestamp() else null end;
    update public.goods set archived_at = transition_at where id = target_id;
    audit_action := case when archive_requested then 'catalog.good.archived' else 'catalog.good.unarchived' end;
    audit_target := 'goods:' || target_id;

  elsif target_kind = 'card' then
    select card.archived_at
      into selected_archived_at
    from public.cards as card
    where card.id = target_id
    for update of card;

    if not found then
      raise no_data_found using message = 'catalog_not_found';
    end if;
    if archive_requested = (selected_archived_at is not null) then
      return false;
    end if;

    if archive_requested and exists (
      select 1
      from public.cards as card
      join public.card_pools as pool on pool.id = card.pool_id
      where card.id = target_id
        and (pool.active_to is null or pool.active_to > pg_catalog.now())
    ) then
      raise check_violation using message = 'card_has_open_pool';
    end if;

    if archive_requested and exists (
      select 1
      from public.cards as card
      join public.draw_tickets as ticket on ticket.pool_id = card.pool_id
      where card.id = target_id
        and ticket.consumed_at is null
        and ticket.revoked_at is null
    ) then
      raise check_violation using message = 'card_has_open_tickets';
    end if;

    transition_at := case when archive_requested then pg_catalog.clock_timestamp() else null end;
    update public.cards set archived_at = transition_at where id = target_id;
    audit_action := case when archive_requested then 'catalog.card.archived' else 'catalog.card.unarchived' end;
    audit_target := 'cards:' || target_id;

  elsif target_kind = 'event' then
    select event_record.archived_at
      into selected_archived_at
    from public.events as event_record
    where event_record.id = target_id
    for update of event_record;

    if not found then
      raise no_data_found using message = 'catalog_not_found';
    end if;
    if archive_requested = (selected_archived_at is not null) then
      return false;
    end if;

    if archive_requested and exists (
      select 1
      from public.events as event_record
      join public.ticket_types as ticket_type on ticket_type.event_id = event_record.id
      where event_record.id = target_id
        and event_record.status in ('예정', '예매중', '진행중')
    ) then
      raise check_violation using message = 'event_has_open_ticketing';
    end if;

    if archive_requested and exists (
      select 1
      from public.games as game
      where game.event_id = target_id
        and (game.active_to is null or game.active_to > pg_catalog.now())
    ) then
      raise check_violation using message = 'event_has_open_game';
    end if;

    transition_at := case when archive_requested then pg_catalog.clock_timestamp() else null end;
    update public.events set archived_at = transition_at where id = target_id;
    audit_action := case when archive_requested then 'catalog.event.archived' else 'catalog.event.unarchived' end;
    audit_target := 'events:' || target_id;
  else
    raise invalid_parameter_value using message = 'invalid_catalog_kind';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    audit_action,
    audit_target,
    pg_catalog.jsonb_build_object('archived_at', transition_at)
      || case when target_kind = 'ip'
        then pg_catalog.jsonb_build_object('published_at', null)
        else '{}'::jsonb end
  );

  return true;
end;
$$;

revoke all on function private.set_catalog_archived(text, text, boolean)
  from public, anon, authenticated, service_role;

