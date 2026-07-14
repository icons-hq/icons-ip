-- Read-only deployment canary for the immutable public catalog baseline.

do $$
declare
  baseline_pool_id constant uuid := 'a0000000-0000-4000-8000-000000000001';
  matched_count integer;
  odds_total numeric;
begin
  select count(*) into matched_count
  from public.verticals
  where key = any (array['character', 'game', 'anime']);
  if matched_count <> 3 then
    raise exception 'catalog baseline missing: expected 3 verticals, found %', matched_count;
  end if;

  select count(*) into matched_count
  from public.ips
  where id = any (array['rilakkuma', 'maplestory', 'nongdamgom', 'kakao-friends', 'attack-on-titan']);
  if matched_count <> 5 then
    raise exception 'catalog baseline missing: expected 5 IPs, found %', matched_count;
  end if;

  select count(*) into matched_count
  from public.goods
  where id = any (array['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10', 'g11', 'g12']);
  if matched_count <> 12 then
    raise exception 'catalog baseline missing: expected 12 goods, found %', matched_count;
  end if;

  select count(*) into matched_count
  from public.cards
  where id = any (array['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12']);
  if matched_count <> 12 then
    raise exception 'catalog baseline missing: expected 12 cards, found %', matched_count;
  end if;

  select count(*) into matched_count
  from public.events
  where id = any (array['e1', 'e2', 'e3', 'e4', 'e5']);
  if matched_count <> 5 then
    raise exception 'catalog baseline missing: expected 5 events, found %', matched_count;
  end if;

  select count(*) into matched_count
  from public.card_pools
  where id = baseline_pool_id
    and ip_id = 'maplestory';
  if matched_count <> 1 then
    raise exception 'catalog baseline missing: expected the Maplestory card pool';
  end if;

  select count(*), coalesce(sum(probability), 0)
  into matched_count, odds_total
  from public.pool_odds
  where pool_id = baseline_pool_id
    and rarity = any (array['R', 'SSR', 'HOLO']::public.rarity[]);
  if matched_count <> 3 or odds_total <> 1.00000 then
    raise exception 'catalog baseline invalid: expected 3 pool odds totaling 1.0, found % totaling %', matched_count, odds_total;
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
  from public.games
  where id = any (array['marble-maple', 'goods-marble']);
  if matched_count <> 2 then
    raise exception 'catalog baseline missing: expected 2 games, found %', matched_count;
  end if;
end $$;
