-- L8b (#574, CL-09) review fix l8b-data-4: cap the collection banners that can
-- be live at the same instant in one collection.
--
-- The goods-shop slider renders at most 10 slides (BEST·NEW render the first
-- one). Without a write-side cap an 11th overlapping banner saved fine, showed
-- as "live" in the admin list, and silently never appeared. Like the hero cap
-- (guard_home_promotion_banner / home_hero_limit) the database refuses the
-- write instead.
--
-- Rule: within one slot, an enabled collection_banner may not overlap the
-- remaining future part of its [active_from, active_to) window with 10 or more
-- other enabled banners. Disabled rows never count, and the past is ignored
-- (the window is clamped to now()), so ended banners do not have to be deleted
-- and next season's banners can be scheduled while the current ones run.
-- Pairwise overlap is conservative: it can refuse a long window that touches
-- 10 short, mutually disjoint ones, but it can never admit an instant with 11
-- live banners (the last write among any 11 co-live rows overlaps the other 10).
--
-- Updates that keep kind, slot, enabled and the window unchanged (copy, image,
-- order edits) skip the check: they cannot add overlap. Writers of one slot
-- serialize on a per-slot advisory lock so concurrent saves cannot both pass.

create function private.guard_home_collection_banner_limit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_start timestamptz;
  window_end timestamptz;
  overlapping integer;
begin
  if new.kind <> 'collection_banner' or not new.enabled or new.archived_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE'
    and old.kind = new.kind
    and old.slot is not distinct from new.slot
    and old.enabled = new.enabled
    and old.archived_at is not distinct from new.archived_at
    and old.active_from = new.active_from
    and old.active_to is not distinct from new.active_to
  then
    return new;
  end if;

  effective_start := greatest(new.active_from, pg_catalog.now());
  window_end := coalesce(new.active_to, 'infinity'::timestamptz);
  if window_end <= effective_start then
    -- The window is already over: this row can never be shown again.
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('home_collection_banner_live:' || coalesce(new.slot, ''), 0)
  );

  select count(*)
    into overlapping
  from public.home_curations as curation
  where curation.kind = 'collection_banner'
    and curation.slot = new.slot
    and curation.enabled
    and curation.archived_at is null
    and curation.id <> new.id
    and curation.active_from < window_end
    and coalesce(curation.active_to, 'infinity'::timestamptz) > effective_start;

  if overlapping >= 10 then
    raise check_violation using message = 'collection_banner_limit';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_home_collection_banner_limit() from public, anon, authenticated, service_role;

create trigger home_curations_collection_banner_limit
before insert or update on public.home_curations
for each row execute function private.guard_home_collection_banner_limit();

-- Same execution-metadata registration as the hero cap guard: the shared save
-- core (admin_save_home_curation / admin_upsert_home_curation) now depends on it.
select private.register_operator_internal_contract('private.guard_home_collection_banner_limit()'::regprocedure);
