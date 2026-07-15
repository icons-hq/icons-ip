-- Read-only deployment canary for the immutable public catalog baseline.
-- Run with the same public permissions used by unauthenticated catalog browsing.

do $$
declare
  baseline_pool_id constant uuid := 'a0000000-0000-4000-8000-000000000001';
  matched_count integer;
  expected_count integer;
  odds_total numeric;
begin
  perform set_config('role', 'anon', true);
  if current_user <> 'anon' then
    raise exception 'catalog baseline canary must run as anon';
  end if;

  select count(*) into matched_count
  from public.verticals
  where key = any (array['character', 'game', 'anime']);
  if matched_count <> 3 then
    raise exception 'catalog baseline missing: expected 3 verticals, found %', matched_count;
  end if;

  select count(*) into matched_count
  from (values
    ('rilakkuma', 'character'),
    ('maplestory', 'game'),
    ('nongdamgom', 'character'),
    ('kakao-friends', 'character'),
    ('attack-on-titan', 'anime')
  ) as expected(id, vertical_key)
  join public.ips actual
    on actual.id = expected.id
   and actual.vertical_key = expected.vertical_key;
  if matched_count <> 5 then
    raise exception 'catalog baseline invalid: expected 5 IP-to-vertical mappings, found %', matched_count;
  end if;

  select count(*) into matched_count
  from (values
    ('g1', 'rilakkuma'),
    ('g2', 'rilakkuma'),
    ('g3', 'maplestory'),
    ('g4', 'maplestory'),
    ('g5', 'maplestory'),
    ('g6', 'nongdamgom'),
    ('g7', 'nongdamgom'),
    ('g8', 'kakao-friends'),
    ('g9', 'kakao-friends'),
    ('g10', 'kakao-friends'),
    ('g11', 'attack-on-titan'),
    ('g12', 'attack-on-titan')
  ) as expected(id, ip_id)
  join public.goods actual
    on actual.id = expected.id
   and actual.ip_id = expected.ip_id;
  if matched_count <> 12 then
    raise exception 'catalog baseline invalid: expected 12 good-to-IP mappings, found %', matched_count;
  end if;

  select count(*) into matched_count
  from (values
    ('c1', 'rilakkuma', 'HOLO'),
    ('c2', 'rilakkuma', 'SR'),
    ('c3', 'maplestory', 'SSR'),
    ('c4', 'maplestory', 'R'),
    ('c5', 'maplestory', 'HOLO'),
    ('c6', 'nongdamgom', 'SSR'),
    ('c7', 'nongdamgom', 'R'),
    ('c8', 'kakao-friends', 'SSR'),
    ('c9', 'kakao-friends', 'HOLO'),
    ('c10', 'kakao-friends', 'SR'),
    ('c11', 'attack-on-titan', 'HOLO'),
    ('c12', 'attack-on-titan', 'SSR')
  ) as expected(id, ip_id, rarity)
  join public.cards actual
    on actual.id = expected.id
   and actual.ip_id = expected.ip_id
   and actual.rarity::text = expected.rarity;
  if matched_count <> 12 then
    raise exception 'catalog baseline invalid: expected 12 card IP and rarity mappings, found %', matched_count;
  end if;

  select count(*) into matched_count
  from (values
    ('e1', 'rilakkuma'),
    ('e2', 'maplestory'),
    ('e3', 'nongdamgom'),
    ('e4', 'kakao-friends'),
    ('e5', 'attack-on-titan')
  ) as expected(id, ip_id)
  join public.events actual
    on actual.id = expected.id
   and actual.ip_id = expected.ip_id;
  if matched_count <> 5 then
    raise exception 'catalog baseline invalid: expected 5 event-to-IP mappings, found %', matched_count;
  end if;

  select count(*) into matched_count
  from public.card_pools
  where id = baseline_pool_id
    and ip_id = 'maplestory';
  if matched_count <> 1 then
    raise exception 'catalog baseline missing: expected the Maplestory card pool';
  end if;

  select
    count(*),
    count(*) filter (
      where rarity = any (array['R', 'SSR', 'HOLO']::public.rarity[])
        and probability > 0
    ),
    coalesce(sum(probability), 0)
  into matched_count, expected_count, odds_total
  from public.pool_odds
  where pool_id = baseline_pool_id;
  if matched_count <> 5 or expected_count <> 3 or odds_total <> 1.00000 then
    raise exception 'catalog baseline invalid: expected all 5 rarity rows with positive R, SSR, and HOLO odds totaling 1.0, found % rows, % positive expected rarities, total %', matched_count, expected_count, odds_total;
  end if;

  select count(*) into matched_count
  from public.cards
  where id = any (array['c3', 'c4', 'c5'])
    and ip_id = 'maplestory'
    and pool_id = baseline_pool_id;
  if matched_count <> 3 then
    raise exception 'catalog baseline invalid: expected 3 Maplestory cards bound to the baseline pool, found %', matched_count;
  end if;

  select count(*) into matched_count
  from (values
    ('marble-maple', 'marble_roulette', 'e2', baseline_pool_id, 'card'),
    ('goods-marble', 'marble_roulette', null, null::uuid, 'goods')
  ) as expected(id, type, event_id, reward_pool_id, config_kind)
  join public.games actual
    on actual.id = expected.id
   and actual.type = expected.type
   and actual.event_id is not distinct from expected.event_id
   and actual.reward_pool_id is not distinct from expected.reward_pool_id
   and actual.config #>> '{variant,kind}' = expected.config_kind;
  if matched_count <> 2 then
    raise exception 'catalog baseline invalid: expected 2 game runtime mappings, found %', matched_count;
  end if;
end $$;
