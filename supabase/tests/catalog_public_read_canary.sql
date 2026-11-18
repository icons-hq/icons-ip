-- Production deployment canary for unauthenticated catalog browsing.
-- Runs with the same public permissions as `catalog_baseline.sql`, but asserts
-- only that anon can read the public catalog tables — never which rows exist.
-- Production content is operator-owned: the 2026-11-18 test-data cleanup removed
-- the seeded demo catalog (g1~g15, cards, events, the baseline card pool) before
-- real goods registration, so content assertions belong to `catalog_baseline.sql`
-- on the seeded preview/CI databases only.

do $$
begin
  perform set_config('role', 'anon', true);
  if current_user <> 'anon' then
    raise exception 'catalog public read canary must run as anon';
  end if;

  -- A revoked grant or a broken RLS policy raises here (permission denied or a
  -- policy error); an empty table is fine.
  perform 1 from public.verticals limit 1;
  perform 1 from public.ips limit 1;
  perform 1 from public.goods limit 1;
  perform 1 from public.cards limit 1;
  perform 1 from public.events limit 1;
  perform 1 from public.card_pools limit 1;
  perform 1 from public.pool_odds limit 1;
  perform 1 from public.games limit 1;
end $$;
