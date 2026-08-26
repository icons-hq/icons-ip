\set ON_ERROR_STOP on

begin;

-- Catalog activation is operational data, not a preview seed. This fixture
-- provides a complete ten-good version only inside this transaction.
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000701', 'authenticated', 'authenticated', 'last-bell-one@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000702', 'authenticated', 'authenticated', 'last-bell-two@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000703', 'authenticated', 'authenticated', 'last-bell-three@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at)
values
  ('00000000-0000-4000-8000-000000000701', 'last-bell-one@example.test', 'last_bell_one', '2000-01-01', '{"terms":true,"privacy":true}', now()),
  ('00000000-0000-4000-8000-000000000702', 'last-bell-two@example.test', 'last_bell_two', '2000-01-01', '{"terms":true,"privacy":true}', now()),
  ('00000000-0000-4000-8000-000000000703', 'last-bell-three@example.test', 'last_bell_three', '2000-01-01', '{"terms":true,"privacy":true}', now())
on conflict (id) do update set
  email = excluded.email, nickname = excluded.nickname, birth_date = excluded.birth_date,
  consents = excluded.consents, onboarded_at = excluded.onboarded_at;

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, purchase_access)
select 'last-bell-test-g' || n, 'rilakkuma', 'Last Bell test ' || n, 'test', 10000 + n, 'ok', 10, 'story_entitlement'
from generate_series(1, 10) as n;

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, purchase_access)
values ('last-bell-test-public', 'rilakkuma', 'Last Bell public compatibility', 'test', 10000, 'ok', 10, 'public');

insert into private.last_bell_catalog_versions (version, active_from)
values ('last-bell-test-v1', now() - interval '1 minute');
insert into private.last_bell_collectible_goods (catalog_version, collectible_key, good_id, chapter_id, zone_id, sale_ends_at)
values
  ('last-bell-test-v1', 'idcard', 'last-bell-test-g1', 'chapter-01', 'classroom', now() + interval '30 days'),
  ('last-bell-test-v1', 'badge', 'last-bell-test-g2', 'chapter-01', 'corridor', now() + interval '30 days'),
  ('last-bell-test-v1', 'photo', 'last-bell-test-g3', 'chapter-01', 'corridor', now() + interval '30 days'),
  ('last-bell-test-v1', 'radio', 'last-bell-test-g4', 'chapter-01', 'broadcast', now() + interval '30 days'),
  ('last-bell-test-v1', 'kit', 'last-bell-test-g5', 'chapter-01', 'infirmary', now() + interval '30 days'),
  ('last-bell-test-v1', 'zipup', 'last-bell-test-g6', 'chapter-01', 'infirmary', now() + interval '30 days'),
  ('last-bell-test-v1', 'archery', 'last-bell-test-g7', 'chapter-01', 'broadcast', now() + interval '30 days'),
  ('last-bell-test-v1', 'postcard', 'last-bell-test-g8', 'chapter-01', 'corridor', now() + interval '30 days'),
  ('last-bell-test-v1', 'candle', 'last-bell-test-g9', 'chapter-02', 'stairwell', now() + interval '30 days'),
  ('last-bell-test-v1', 'blanket', 'last-bell-test-g10', 'chapter-02', 'stairwell', now() + interval '30 days');

select 1 / case when exists (
  select 1
  from private.last_bell_collectible_goods
  where catalog_version = 'last-bell-test-v1'
    and collectible_key = 'archery'
    and chapter_id = 'chapter-01'
    and zone_id = 'broadcast'
) then 1 else 0 end as assert_archery_broadcast_mapping;

select 1 / case when not has_function_privilege('anon', 'public.last_bell_start_run(uuid,text,text,text)', 'execute') then 1 else 0 end as assert_anon_cannot_start;
select 1 / case when not has_function_privilege('authenticated', 'public.last_bell_record_event(uuid,uuid,text,integer,uuid,text,text,text,text,text,text)', 'execute') then 1 else 0 end as assert_browser_cannot_record;
select 1 / case when has_function_privilege('service_role', 'public.last_bell_complete_run(uuid,uuid,text)', 'execute') then 1 else 0 end as assert_service_role_can_complete;
select 1 / case when not has_function_privilege('service_role', 'private.last_bell_materialize_entitlements(uuid,uuid)', 'execute') then 1 else 0 end as assert_private_helper_is_sealed;
select 1 / case when not has_table_privilege('authenticated', 'private.last_bell_runs', 'select') then 1 else 0 end as assert_private_runs_not_readable;

set local role service_role;
do $$
begin
  begin
    perform public.last_bell_start_run('00000000-0000-4000-8000-000000000703', null, 'chapter-02', 'chapter-replay');
    raise exception 'locked Chapter 2 replay start accepted';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'chapter_replay_locked' then raise; end if;
  end;
  begin
    perform public.last_bell_start_run(null, repeat('c', 64), 'chapter-01', 'chapter-replay');
    raise exception 'fresh guest replay start accepted';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'chapter_replay_locked' then raise; end if;
  end;
end;
$$;
reset role;

-- Account-backed starts and guest claims use the existing suspension,
-- deletion, and onboarding write fences even though the authority RPC itself
-- is service-only.
update public.profiles
set suspended_at = now(), suspension_reason = 'test suspension'
where id = '00000000-0000-4000-8000-000000000703';
set local role service_role;
do $$
begin
  begin
    perform public.last_bell_start_run('00000000-0000-4000-8000-000000000703', null, 'chapter-01');
    raise exception 'suspended account started a verified run';
  exception when insufficient_privilege then
    if sqlerrm <> 'account_suspended' then raise; end if;
  end;
end;
$$;
reset role;
update public.profiles
set suspended_at = null, suspension_reason = null, onboarded_at = null
where id = '00000000-0000-4000-8000-000000000703';
set local role service_role;
do $$
begin
  begin
    perform public.last_bell_start_run('00000000-0000-4000-8000-000000000703', null, 'chapter-01');
    raise exception 'incomplete account started a verified run';
  exception when check_violation then
    if sqlerrm <> 'onboarding_required' then raise; end if;
  end;
end;
$$;
reset role;
update public.profiles
set onboarded_at = now()
where id = '00000000-0000-4000-8000-000000000703';

insert into private.account_deletion_requests (
  deletion_event_id, subject_user_id, idempotency_key, status, blocker_summary
)
values (
  '00000000-0000-4000-8000-000000000761',
  '00000000-0000-4000-8000-000000000703',
  '00000000-0000-4000-8000-000000000762',
  'awaiting_email_intent',
  '[]'::jsonb
);
insert into private.account_action_fences (subject_user_id, deletion_event_id)
values (
  '00000000-0000-4000-8000-000000000703',
  '00000000-0000-4000-8000-000000000761'
);
set local role service_role;
do $$
begin
  begin
    perform public.last_bell_start_run('00000000-0000-4000-8000-000000000703', null, 'chapter-01');
    raise exception 'deletion-fenced account started a verified run';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'account_deletion_write_fenced' then raise; end if;
  end;
end;
$$;
reset role;
delete from private.account_action_fences
where subject_user_id = '00000000-0000-4000-8000-000000000703';
delete from private.account_deletion_requests
where subject_user_id = '00000000-0000-4000-8000-000000000703';

set local role service_role;
select (public.last_bell_start_run(null, repeat('d', 64), 'chapter-01') ->> 'runId')::uuid as fenced_guest_run_id \gset
reset role;
select set_config('last_bell.test.fenced_guest_run_id', :'fenced_guest_run_id', false);
update private.last_bell_runs
set
  status = 'completed',
  completed_at = now(),
  claim_until = now() + interval '7 days'
where id = :'fenced_guest_run_id'::uuid;
insert into private.account_deletion_requests (
  deletion_event_id, subject_user_id, idempotency_key, status, blocker_summary
)
values (
  '00000000-0000-4000-8000-000000000763',
  '00000000-0000-4000-8000-000000000703',
  '00000000-0000-4000-8000-000000000764',
  'awaiting_email_intent',
  '[]'::jsonb
);
insert into private.account_action_fences (subject_user_id, deletion_event_id)
values (
  '00000000-0000-4000-8000-000000000703',
  '00000000-0000-4000-8000-000000000763'
);
set local role service_role;
do $$
begin
  begin
    perform public.last_bell_claim_run(
      current_setting('last_bell.test.fenced_guest_run_id')::uuid,
      '00000000-0000-4000-8000-000000000703',
      repeat('d', 64)
    );
    raise exception 'deletion-fenced account claimed a guest run';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'account_deletion_write_fenced' then raise; end if;
  end;
end;
$$;
reset role;
delete from private.account_action_fences
where subject_user_id = '00000000-0000-4000-8000-000000000703';
delete from private.account_deletion_requests
where subject_user_id = '00000000-0000-4000-8000-000000000703';

-- Last Bell is an additive access mode. Its trigger must not change ordinary
-- public-good cart behavior for the authenticated owner.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000703', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000703', 'last-bell-test-public', 1);
select 1 / case when exists (
  select 1 from public.cart_items
  where user_id = '00000000-0000-4000-8000-000000000703'
    and good_id = 'last-bell-test-public'
    and qty = 1
) then 1 else 0 end as assert_public_good_cart_behavior_is_unchanged;
delete from public.cart_items
where user_id = '00000000-0000-4000-8000-000000000703'
  and good_id = 'last-bell-test-public';
reset role;

-- Restricted goods cannot be inserted directly, merged, or ordered from a
-- stale cart without an entitlement.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000703', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
begin
  begin
    insert into public.cart_items (user_id, good_id, qty)
    values ('00000000-0000-4000-8000-000000000703', 'last-bell-test-g1', 1);
    raise exception 'direct cart DML bypassed entitlement';
  exception when check_violation then
    if sqlerrm <> 'story_entitlement_required' then raise; end if;
  end;
  begin
    perform public.merge_cart_items('[{"good_id":"last-bell-test-g1","qty":1}]'::jsonb);
    raise exception 'merge bypassed entitlement';
  exception when check_violation then
    if sqlerrm <> 'story_entitlement_required' then raise; end if;
  end;
end;
$$;
reset role;

-- Simulate a cart row written before this entitlement guard existed. The
-- checkout trigger must still reject it, so a stale cart can never bypass the
-- story eligibility rule.
alter table public.cart_items disable trigger last_bell_cart_item_purchase_access;
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000703', 'last-bell-test-g1', 1);
alter table public.cart_items enable trigger last_bell_cart_item_purchase_access;
do $$
begin
  begin
    perform public.place_order(
      '00000000-0000-4000-8000-000000000703',
      '{"recipientName":"테스트","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
      '00000000-0000-4000-8000-000000000703'::uuid,
      'card'::public.order_payment_method
    );
    raise exception 'order bypassed entitlement';
  exception when check_violation then
    if sqlerrm <> 'story_entitlement_required' then raise; end if;
  end;
end;
$$;

-- Thin helpers keep the fixture readable while still exercising the public
-- server-RPC contract. `p_digest` is a digest string, never a raw token.
create function pg_temp.start_run(p_user uuid, p_digest text, p_chapter text, p_mode text default 'first-play')
returns uuid language plpgsql as $$
declare v jsonb;
begin
  v := public.last_bell_start_run(p_user, p_digest, p_chapter, p_mode);
  return (v ->> 'runId')::uuid;
end;
$$;
create function pg_temp.event(
  p_run uuid, p_user uuid, p_digest text, p_seq integer, p_op uuid,
  p_type text, p_chapter text, p_zone text, p_objective text, p_collectible text, p_checkpoint text
)
returns jsonb language sql as $$
  select public.last_bell_record_event(
    p_run, p_user, p_digest, p_seq, p_op, p_type, p_chapter, p_zone, p_objective, p_collectible, p_checkpoint
  )
$$;
create function pg_temp.allow_next_transition(p_run uuid, p_wait_ms integer)
returns void language sql as $$
  update private.last_bell_runs
  set last_progressed_at = pg_catalog.clock_timestamp() - p_wait_ms * interval '1 millisecond'
  where id = p_run
$$;

-- Constructs a full legal milestone route at an exact server elapsed floor.
-- It receives no entry/skip flag: the same authority contract must accept a
-- natural 600s session and a world-ready skip's 582s active route.
create function pg_temp.complete_route_at_floor(p_run uuid, p_digest text, p_total_ms integer)
returns jsonb
language plpgsql
as $$
declare
  v_rule private.last_bell_progression_rules%rowtype;
  v_result jsonb;
begin
  update private.last_bell_runs
  set started_at = pg_catalog.clock_timestamp() - p_total_ms * interval '1 millisecond'
  where id = p_run;

  for v_rule in
    select rule.*
    from private.last_bell_progression_rules as rule
    order by rule.stage
  loop
    update private.last_bell_runs
    set last_progressed_at = pg_catalog.clock_timestamp()
      - v_rule.minimum_transition_ms * interval '1 millisecond'
    where id = p_run;

    v_result := pg_temp.event(
      p_run,
      null,
      p_digest,
      v_rule.stage,
      ('10000000-0000-4000-8000-' || pg_catalog.lpad(v_rule.stage::text, 12, '0'))::uuid,
      v_rule.event_type,
      v_rule.chapter_id,
      v_rule.zone_id,
      v_rule.objective_id,
      null,
      v_rule.checkpoint_id
    );
    if v_result ->> 'status' <> 'recorded' then
      raise exception 'floor route stage % was not recorded: %', v_rule.stage, v_result;
    end if;
  end loop;

  return public.last_bell_complete_run(p_run, null, p_digest);
end;
$$;

-- Progression floors reject only physically impossible burst replays. The
-- authored 10-minute target is a five-session playtest gate, never a database
-- timer that holds a nearby interaction hostage.
select 1 / case when
  (select array_agg(rule.minimum_elapsed_ms order by rule.stage)
   from private.last_bell_progression_rules as rule)
    = array[0, 1000, 4000, 15000, 18000, 20000, 20000, 20000, 23000, 128000, 138000]
  and
  (select array_agg(rule.minimum_transition_ms order by rule.stage)
   from private.last_bell_progression_rules as rule)
    = array[0, 1000, 3000, 11000, 2000, 1000, 0, 0, 3000, 105000, 10000]
then 1 else 0 end as assert_authored_transition_contract;

-- No client-controlled skip marker enters this RPC. A ready-gated skip and a
-- natural cold-open submit the same eleven semantic milestones.
set local role service_role;
select pg_temp.start_run(null, repeat('e', 64), 'chapter-01') as skip_floor_run_id \gset
reset role;
select pg_temp.complete_route_at_floor(:'skip_floor_run_id'::uuid, repeat('e', 64), 138000) as skip_floor_completion \gset

set local role service_role;
select pg_temp.start_run(null, repeat('f', 64), 'chapter-01') as natural_floor_run_id \gset
reset role;
select pg_temp.complete_route_at_floor(:'natural_floor_run_id'::uuid, repeat('f', 64), 156000) as natural_floor_completion \gset

select 1 / case when
  (:'skip_floor_completion'::jsonb ->> 'status') = 'completed'
  and (:'natural_floor_completion'::jsonb ->> 'status') = 'completed'
then 1 else 0 end as assert_natural_and_skip_entry_floors_complete_without_skip_flag;

-- The initial objective is emitted on the first fixed tick, so stage 1 must
-- remain valid immediately after a fresh run starts.
set local role service_role;
select pg_temp.start_run('00000000-0000-4000-8000-000000000703', null, 'chapter-01') as initial_tick_run_id \gset
reset role;
select pg_temp.event(:'initial_tick_run_id'::uuid, '00000000-0000-4000-8000-000000000703', null, 1, '00000000-0000-4000-8000-000000000764', 'objective', 'chapter-01', 'classroom', 'ch1.open-classroom-door', null, null) as initial_stage_result \gset
select 1 / case when (:'initial_stage_result'::jsonb ->> 'status') = 'recorded' then 1 else 0 end as assert_stage_one_initial_tick_passes;
update private.last_bell_runs set status = 'expired' where id = :'initial_tick_run_id'::uuid;

-- Waiting before the first event no longer makes a complete replay valid:
-- each milestone must be observed after its own minimum transition window.
set local role service_role;
select pg_temp.start_run('00000000-0000-4000-8000-000000000703', null, 'chapter-01') as bulk_replay_run_id \gset
reset role;
update private.last_bell_runs
set started_at = now() - interval '11 minutes', last_progressed_at = now() - interval '11 minutes'
where id = :'bulk_replay_run_id'::uuid;
select pg_temp.event(:'bulk_replay_run_id'::uuid, '00000000-0000-4000-8000-000000000703', null, 1, '00000000-0000-4000-8000-000000000765', 'objective', 'chapter-01', 'classroom', 'ch1.open-classroom-door', null, null);
select set_config('last_bell.test.bulk_replay_run_id', :'bulk_replay_run_id', false);
do $$
begin
  begin
    perform pg_temp.event(
      current_setting('last_bell.test.bulk_replay_run_id')::uuid,
      '00000000-0000-4000-8000-000000000703', null, 2,
      '00000000-0000-4000-8000-000000000766',
      'checkpoint', 'chapter-01', 'corridor', null, null, 'ch1_first_bay'
    );
    raise exception 'bulk replay passed after waiting only before the first milestone';
  exception when check_violation then
    if sqlerrm <> 'run_progression_too_fast' then raise; end if;
  end;
end;
$$;
select pg_temp.allow_next_transition(:'bulk_replay_run_id'::uuid, 1000);
select pg_temp.event(:'bulk_replay_run_id'::uuid, '00000000-0000-4000-8000-000000000703', null, 2, '00000000-0000-4000-8000-000000000767', 'checkpoint', 'chapter-01', 'corridor', null, null, 'ch1_first_bay') as stage_two_result \gset
select set_config('last_bell.test.bulk_replay_run_id', :'bulk_replay_run_id', false);
do $$
begin
  begin
    perform pg_temp.event(
      current_setting('last_bell.test.bulk_replay_run_id')::uuid,
      '00000000-0000-4000-8000-000000000703', null, 3,
      '00000000-0000-4000-8000-000000000768',
      'objective', 'chapter-01', 'corridor', 'ch1.restore-emergency-power', null, null
    );
    raise exception 'stage three passed without the first-infected traversal';
  exception when check_violation then
    if sqlerrm <> 'run_progression_too_fast' then raise; end if;
  end;
end;
$$;
select pg_temp.allow_next_transition(:'bulk_replay_run_id'::uuid, 3000);
select pg_temp.event(:'bulk_replay_run_id'::uuid, '00000000-0000-4000-8000-000000000703', null, 3, '00000000-0000-4000-8000-000000000768', 'objective', 'chapter-01', 'corridor', 'ch1.restore-emergency-power', null, null) as stage_three_result \gset
select 1 / case when
  (:'stage_two_result'::jsonb ->> 'status') = 'recorded'
  and (:'stage_three_result'::jsonb ->> 'status') = 'recorded'
then 1 else 0 end as assert_door_checkpoint_precedes_first_infected_objective;
update private.last_bell_runs set status = 'expired' where id = :'bulk_replay_run_id'::uuid;

set local role service_role;
select pg_temp.start_run('00000000-0000-4000-8000-000000000701', null, 'chapter-01') as run_id \gset
reset role;
update private.last_bell_runs set started_at = now() - interval '11 minutes', last_progressed_at = now() - interval '11 minutes' where id = :'run_id'::uuid;

set local role service_role;
select public.last_bell_start_run('00000000-0000-4000-8000-000000000701', null, 'chapter-01') as multitab_start \gset
reset role;
select 1 / case when (:'multitab_start'::jsonb ->> 'runId')::uuid = :'run_id'::uuid and (:'multitab_start'::jsonb ->> 'resumed')::boolean then 1 else 0 end as assert_multitab_resumes_one_active_run;
select 1 / case when (:'multitab_start'::jsonb ->> 'lastSequence')::integer = 0 and (:'multitab_start'::jsonb ->> 'progressStage')::integer = 0 then 1 else 0 end as assert_resume_returns_sequence_and_stage;

select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 1, '00000000-0000-4000-8000-000000000711', 'objective', 'chapter-01', 'classroom', 'ch1.open-classroom-door', null, null);
select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 2, '00000000-0000-4000-8000-000000000712', 'pickup', 'chapter-01', 'classroom', null, 'idcard', null);
set local role service_role;
select public.last_bell_start_run('00000000-0000-4000-8000-000000000701', null, 'chapter-01') as progressed_resume \gset
reset role;
select 1 / case when (:'progressed_resume'::jsonb ->> 'lastSequence')::integer = 2 and (:'progressed_resume'::jsonb ->> 'progressStage')::integer = 1 and (:'progressed_resume'::jsonb -> 'pickedCollectibleKeys') = '["idcard"]'::jsonb then 1 else 0 end as assert_resume_restores_collected_keys;
select set_config('last_bell.test.run_id', :'run_id', false);
do $$
begin
  begin
    perform pg_temp.event(current_setting('last_bell.test.run_id')::uuid, '00000000-0000-4000-8000-000000000701', null, 3, '00000000-0000-4000-8000-000000000713', 'pickup', 'chapter-01', 'classroom', null, 'idcard', null);
    raise exception 'duplicate pickup accepted';
  exception when unique_violation then
    if sqlerrm <> 'duplicate_pickup' then raise; end if;
  end;
  begin
    perform pg_temp.event(current_setting('last_bell.test.run_id')::uuid, '00000000-0000-4000-8000-000000000701', null, 5, '00000000-0000-4000-8000-000000000714', 'capture', 'chapter-01', 'corridor', null, null, null);
    raise exception 'sequence jump accepted';
  exception when check_violation then
    if sqlerrm <> 'run_sequence_invalid' then raise; end if;
  end;
end;
$$;
select pg_temp.allow_next_transition(:'run_id'::uuid, 1000);
select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 3, '00000000-0000-4000-8000-000000000715', 'checkpoint', 'chapter-01', 'corridor', null, null, 'ch1_first_bay') as checkpoint_result \gset
select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 3, '00000000-0000-4000-8000-000000000715', 'checkpoint', 'chapter-01', 'corridor', null, null, 'ch1_first_bay') as checkpoint_retry \gset
select 1 / case when (:'checkpoint_retry'::jsonb ->> 'status') = 'idempotent' then 1 else 0 end as assert_replayed_operation_is_idempotent;

select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 4, '00000000-0000-4000-8000-000000000716', 'capture', 'chapter-01', 'corridor', null, null, null);
select pg_temp.allow_next_transition(:'run_id'::uuid, 3000);
select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 5, '00000000-0000-4000-8000-000000000717', 'objective', 'chapter-01', 'corridor', 'ch1.restore-emergency-power', null, null);
select pg_temp.allow_next_transition(:'run_id'::uuid, 11000);
select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 6, '00000000-0000-4000-8000-000000000718', 'checkpoint', 'chapter-01', 'utility', null, null, 'ch1_power');
select pg_temp.allow_next_transition(:'run_id'::uuid, 2000);
select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 7, '00000000-0000-4000-8000-000000000719', 'objective', 'chapter-01', 'stairwell', 'ch1.ring-last-bell', null, null);
select pg_temp.allow_next_transition(:'run_id'::uuid, 1000);
select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 8, '00000000-0000-4000-8000-000000000720', 'chapter_complete', 'chapter-01', 'stairwell', null, null, null);
select 1 / case when not exists (select 1 from public.goods_purchase_entitlements where user_id = '00000000-0000-4000-8000-000000000701' and good_id = 'last-bell-test-g1') then 1 else 0 end as assert_first_play_chapter_exit_does_not_grant;

select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 9, '00000000-0000-4000-8000-000000000721', 'objective', 'chapter-02', 'stairwell', 'ch2.search-stairwell', null, null);
select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 10, '00000000-0000-4000-8000-000000000722', 'pickup', 'chapter-02', 'stairwell', null, 'candle', null);
select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 11, '00000000-0000-4000-8000-000000000723', 'checkpoint', 'chapter-02', 'stairwell', null, null, 'ch2_stairwell');
select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 12, '00000000-0000-4000-8000-000000000724', 'pickup', 'chapter-02', 'stairwell', null, 'blanket', null);
select pg_temp.allow_next_transition(:'run_id'::uuid, 3000);
select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 13, '00000000-0000-4000-8000-000000000725', 'objective', 'chapter-02', 'rooftop', 'ch2.approach-namra', null, null);
select pg_temp.allow_next_transition(:'run_id'::uuid, 105000);
select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 14, '00000000-0000-4000-8000-000000000726', 'chapter_complete', 'chapter-02', 'rooftop', null, null, null);
select pg_temp.allow_next_transition(:'run_id'::uuid, 10000);
select pg_temp.event(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 15, '00000000-0000-4000-8000-000000000727', 'game_complete', 'chapter-02', 'rooftop', null, null, null);
select public.last_bell_complete_run(:'run_id'::uuid, '00000000-0000-4000-8000-000000000701', null) as completion \gset
select 1 / case when (:'completion'::jsonb ->> 'status') = 'completed' then 1 else 0 end as assert_verified_game_completion;
select 1 / case when exists (select 1 from public.goods_purchase_entitlements where user_id = '00000000-0000-4000-8000-000000000701' and good_id = 'last-bell-test-g1') then 1 else 0 end as assert_first_play_grants_only_at_game_complete;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000703', true);
select 1 / case when not exists (select 1 from public.goods_purchase_entitlements where user_id = '00000000-0000-4000-8000-000000000701') then 1 else 0 end as assert_entitlement_rls_is_owner_only;
reset role;

insert into public.orders (id, user_id, status, total, address, payment_method)
values ('00000000-0000-4000-8000-000000000781', '00000000-0000-4000-8000-000000000701', 'pending', 10001, '{"recipientName":"테스트","phone":"01012345678","postalCode":"12345","address1":"서울시"}', 'card');
insert into public.order_items (order_id, good_id, qty, unit_price, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot)
values ('00000000-0000-4000-8000-000000000781', 'last-bell-test-g1', 1, 10001, 'Last Bell test 1', 'test', 'rilakkuma');
select 1 / case when exists (select 1 from private.order_goods_purchase_entitlement_snapshots where order_id = '00000000-0000-4000-8000-000000000781' and good_id = 'last-bell-test-g1') and (select count(*) from public.goods_purchase_entitlements where user_id = '00000000-0000-4000-8000-000000000701' and good_id = 'last-bell-test-g1') = 1 then 1 else 0 end as assert_order_snapshot_preserves_entitlement;

-- Guest finalization and a second claim are deterministic; another account may
-- not claim the run. Guests complete the whole first-play route before claim.
set local role service_role;
select pg_temp.start_run(null, repeat('b', 64), 'chapter-01') as guest_run_id \gset
reset role;
update private.last_bell_runs set started_at = now() - interval '11 minutes', last_progressed_at = now() - interval '11 minutes' where id = :'guest_run_id'::uuid;
select pg_temp.event(:'guest_run_id'::uuid, null, repeat('b', 64), 1, '00000000-0000-4000-8000-000000000731', 'objective', 'chapter-01', 'classroom', 'ch1.open-classroom-door', null, null);
select pg_temp.event(:'guest_run_id'::uuid, null, repeat('b', 64), 2, '00000000-0000-4000-8000-000000000732', 'pickup', 'chapter-01', 'classroom', null, 'idcard', null);
select pg_temp.allow_next_transition(:'guest_run_id'::uuid, 1000);
select pg_temp.event(:'guest_run_id'::uuid, null, repeat('b', 64), 3, '00000000-0000-4000-8000-000000000733', 'checkpoint', 'chapter-01', 'corridor', null, null, 'ch1_first_bay');
select pg_temp.allow_next_transition(:'guest_run_id'::uuid, 3000);
select pg_temp.event(:'guest_run_id'::uuid, null, repeat('b', 64), 4, '00000000-0000-4000-8000-000000000734', 'objective', 'chapter-01', 'corridor', 'ch1.restore-emergency-power', null, null);
select pg_temp.allow_next_transition(:'guest_run_id'::uuid, 11000);
select pg_temp.event(:'guest_run_id'::uuid, null, repeat('b', 64), 5, '00000000-0000-4000-8000-000000000735', 'checkpoint', 'chapter-01', 'utility', null, null, 'ch1_power');
select pg_temp.allow_next_transition(:'guest_run_id'::uuid, 2000);
select pg_temp.event(:'guest_run_id'::uuid, null, repeat('b', 64), 6, '00000000-0000-4000-8000-000000000736', 'objective', 'chapter-01', 'stairwell', 'ch1.ring-last-bell', null, null);
select pg_temp.allow_next_transition(:'guest_run_id'::uuid, 1000);
select pg_temp.event(:'guest_run_id'::uuid, null, repeat('b', 64), 7, '00000000-0000-4000-8000-000000000737', 'chapter_complete', 'chapter-01', 'stairwell', null, null, null);
select pg_temp.event(:'guest_run_id'::uuid, null, repeat('b', 64), 8, '00000000-0000-4000-8000-000000000738', 'objective', 'chapter-02', 'stairwell', 'ch2.search-stairwell', null, null);
select pg_temp.event(:'guest_run_id'::uuid, null, repeat('b', 64), 9, '00000000-0000-4000-8000-000000000739', 'pickup', 'chapter-02', 'stairwell', null, 'candle', null);
select pg_temp.event(:'guest_run_id'::uuid, null, repeat('b', 64), 10, '00000000-0000-4000-8000-000000000740', 'checkpoint', 'chapter-02', 'stairwell', null, null, 'ch2_stairwell');
select pg_temp.event(:'guest_run_id'::uuid, null, repeat('b', 64), 11, '00000000-0000-4000-8000-000000000741', 'pickup', 'chapter-02', 'stairwell', null, 'blanket', null);
select pg_temp.allow_next_transition(:'guest_run_id'::uuid, 3000);
select pg_temp.event(:'guest_run_id'::uuid, null, repeat('b', 64), 12, '00000000-0000-4000-8000-000000000742', 'objective', 'chapter-02', 'rooftop', 'ch2.approach-namra', null, null);
select pg_temp.allow_next_transition(:'guest_run_id'::uuid, 105000);
select pg_temp.event(:'guest_run_id'::uuid, null, repeat('b', 64), 13, '00000000-0000-4000-8000-000000000743', 'chapter_complete', 'chapter-02', 'rooftop', null, null, null);
select pg_temp.allow_next_transition(:'guest_run_id'::uuid, 10000);
select pg_temp.event(:'guest_run_id'::uuid, null, repeat('b', 64), 14, '00000000-0000-4000-8000-000000000744', 'game_complete', 'chapter-02', 'rooftop', null, null, null);
select public.last_bell_complete_run(:'guest_run_id'::uuid, null, repeat('b', 64));
set local role service_role;
select pg_temp.start_run(null, repeat('b', 64), 'chapter-01', 'chapter-replay') as guest_replay_run_id \gset
reset role;
select 1 / case when (select run_mode from private.last_bell_runs where id = :'guest_replay_run_id'::uuid) = 'chapter-replay' then 1 else 0 end as assert_completed_guest_can_start_chapter_replay;
update private.last_bell_runs set status = 'expired' where id = :'guest_replay_run_id'::uuid;
select public.last_bell_claim_run(:'guest_run_id'::uuid, '00000000-0000-4000-8000-000000000702', repeat('b', 64)) as first_claim \gset
select public.last_bell_claim_run(:'guest_run_id'::uuid, '00000000-0000-4000-8000-000000000702', repeat('b', 64)) as retry_claim \gset
select 1 / case when (:'first_claim'::jsonb ->> 'status') = 'claimed' and (:'retry_claim'::jsonb ->> 'status') = 'idempotent' and exists (select 1 from public.goods_purchase_entitlements where user_id = '00000000-0000-4000-8000-000000000702' and good_id = 'last-bell-test-g9') then 1 else 0 end as assert_guest_claim_is_idempotent;
select set_config('last_bell.test.guest_run_id', :'guest_run_id', false);
do $$
begin
  begin
    perform public.last_bell_claim_run(current_setting('last_bell.test.guest_run_id')::uuid, '00000000-0000-4000-8000-000000000703', repeat('b', 64));
    raise exception 'a second account claimed the guest run';
  exception when insufficient_privilege then
    if sqlerrm <> 'run_claimed_by_another_user' then raise; end if;
  end;
end;
$$;

-- A completed account can open Chapter 2 independently only in replay mode.
set local role service_role;
select pg_temp.start_run('00000000-0000-4000-8000-000000000702', null, 'chapter-02', 'chapter-replay') as chapter_two_replay_run_id \gset
reset role;
select 1 / case when exists (
  select 1
  from private.last_bell_runs as run
  where run.id = :'chapter_two_replay_run_id'::uuid
    and run.timeline_offset_ms = 425000
    and run.progress_stage = 6
) then 1 else 0 end as assert_chapter_two_replay_keeps_authored_offset;
update private.last_bell_runs set status = 'expired' where id = :'chapter_two_replay_run_id'::uuid;

-- A completed account can replay Chapter 1. Its verified chapter exit vests
-- new Chapter 1 keys immediately and completes that replay at stage 6.
set local role service_role;
select pg_temp.start_run('00000000-0000-4000-8000-000000000701', null, 'chapter-01', 'chapter-replay') as replay_run_id \gset
reset role;
update private.last_bell_runs set started_at = now() - interval '11 minutes', last_progressed_at = now() - interval '11 minutes' where id = :'replay_run_id'::uuid;
select pg_temp.event(:'replay_run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 1, '00000000-0000-4000-8000-000000000751', 'objective', 'chapter-01', 'classroom', 'ch1.open-classroom-door', null, null);
select pg_temp.event(:'replay_run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 2, '00000000-0000-4000-8000-000000000752', 'pickup', 'chapter-01', 'corridor', null, 'badge', null);
select pg_temp.allow_next_transition(:'replay_run_id'::uuid, 1000);
select pg_temp.event(:'replay_run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 3, '00000000-0000-4000-8000-000000000753', 'checkpoint', 'chapter-01', 'corridor', null, null, 'ch1_first_bay');
select pg_temp.allow_next_transition(:'replay_run_id'::uuid, 3000);
select pg_temp.event(:'replay_run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 4, '00000000-0000-4000-8000-000000000754', 'objective', 'chapter-01', 'corridor', 'ch1.restore-emergency-power', null, null);
select pg_temp.allow_next_transition(:'replay_run_id'::uuid, 11000);
select pg_temp.event(:'replay_run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 5, '00000000-0000-4000-8000-000000000755', 'checkpoint', 'chapter-01', 'utility', null, null, 'ch1_power');
select pg_temp.allow_next_transition(:'replay_run_id'::uuid, 2000);
select pg_temp.event(:'replay_run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 6, '00000000-0000-4000-8000-000000000756', 'objective', 'chapter-01', 'stairwell', 'ch1.ring-last-bell', null, null);
select pg_temp.allow_next_transition(:'replay_run_id'::uuid, 1000);
select pg_temp.event(:'replay_run_id'::uuid, '00000000-0000-4000-8000-000000000701', null, 7, '00000000-0000-4000-8000-000000000757', 'chapter_complete', 'chapter-01', 'stairwell', null, null, null);
select 1 / case when exists (select 1 from public.goods_purchase_entitlements where user_id = '00000000-0000-4000-8000-000000000701' and good_id = 'last-bell-test-g2') and (select status from private.last_bell_runs where id = :'replay_run_id'::uuid) = 'completed' then 1 else 0 end as assert_chapter_replay_exit_grants_and_completes;

rollback;
