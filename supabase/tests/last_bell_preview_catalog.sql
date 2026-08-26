-- Preview-seed canary. This file is intentionally not a production migration:
-- the prices, stock and sale window are review-only draft values.
do $$
declare
  matched_goods integer;
  matched_mappings integer;
begin
  select count(*) into matched_goods
  from public.goods
  where ip_id = 'all-of-us-are-dead'
    and id like 'aouad-last-bell-%'
    and purchase_access = 'story_entitlement'
    and archived_at is null;

  if matched_goods <> 10 then
    raise exception 'Last Bell preview catalog invalid: expected 10 restricted goods, found %', matched_goods;
  end if;

  select count(*) into matched_mappings
  from private.last_bell_collectible_goods
  where catalog_version = 'last-bell-preview-v1'
    and sale_ends_at > now();

  if matched_mappings <> 10 then
    raise exception 'Last Bell preview catalog invalid: expected 10 active mappings, found %', matched_mappings;
  end if;

  if not exists (
    select 1
    from private.last_bell_collectible_goods
    where catalog_version = 'last-bell-preview-v1'
      and collectible_key = 'archery'
      and chapter_id = 'chapter-01'
      and zone_id = 'broadcast'
      and sale_ends_at > now()
  ) then
    raise exception 'Last Bell preview catalog invalid: archery must use the chapter-01 broadcast mapping';
  end if;
end $$;
