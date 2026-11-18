-- Read-only Production deployment canary for public catalog browsing.
-- Run with the same public permissions used by unauthenticated catalog browsing.
--
-- Production catalog content is operator-managed. The 2026-11-18 test data purge
-- removed the seeded demo goods, cards, card pool, games and events from
-- Production, so this canary asserts only invariants that hold for any valid
-- catalog: anon can read every public catalog surface, the reference verticals
-- exist, and every card pool with configured odds keeps odds that total 1.
-- Seeded environments (local smoke, isolated and shared preview) keep running
-- catalog_baseline.sql, which pins the seed itself.

do $$
declare
  matched_count integer;
begin
  perform set_config('role', 'anon', true);
  if current_user <> 'anon' then
    raise exception 'production catalog readback must run as anon';
  end if;

  select count(*) into matched_count
  from public.verticals
  where key = any (array['character', 'game', 'anime']);
  if matched_count <> 3 then
    raise exception 'production catalog readback: expected 3 verticals, found %', matched_count;
  end if;

  -- Anonymous browsing must be able to read each public catalog surface.
  -- A revoked grant raises here; row visibility itself is left to RLS.
  perform count(*) from public.ips;
  perform count(*) from public.goods;
  perform count(*) from public.events;
  perform count(*) from public.cards;
  perform count(*) from public.card_pools;
  perform count(*) from public.pool_odds;
  perform count(*) from public.games;

  -- Creating a pool (admin_upsert_card_pool) and configuring its odds
  -- (admin_set_pool_odds) are separate operator steps, so a pool without any
  -- odds rows is a legitimate intermediate state. Only configured pools must
  -- total 1.
  select count(*) into matched_count
  from public.card_pools pool
  where exists (
    select 1
    from public.pool_odds odds
    where odds.pool_id = pool.id
  )
  and (
    select sum(odds.probability)
    from public.pool_odds odds
    where odds.pool_id = pool.id
  ) <> 1;
  if matched_count <> 0 then
    raise exception 'production catalog readback: % configured card pools have odds that do not total 1', matched_count;
  end if;
end $$;
