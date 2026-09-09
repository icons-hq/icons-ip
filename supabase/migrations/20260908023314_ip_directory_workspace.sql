-- #412: stable directory order and audited featured/rank controls.
alter table public.ips add column sort_order integer not null default 0 check (sort_order >= 0);
with ranked as (select id,row_number() over(order by fans_count desc,id)::integer position from public.ips)
update public.ips ip set sort_order=ranked.position from ranked where ip.id=ranked.id;
-- The directory already displayed at most five featured tiles in this order.
-- Retire previously invisible overflow flags when introducing the global cap.
update public.ips set featured=false where id in (
  select id from public.ips where featured order by sort_order,id offset 5
);
alter table public.ips add constraint ips_sort_order_unique unique(sort_order) deferrable initially deferred;

create function private.guard_ip_directory_settings()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Legacy metadata writers can already hold an IP row lock. Refuse contention
  -- rather than waiting behind a directory RPC that holds the global lock first.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('ip_directory_settings',0)) then
    raise serialization_failure using message='ip_directory_conflict';
  end if;
  if tg_op='INSERT' and new.sort_order=0 then
    select coalesce(max(sort_order),0)+1 into new.sort_order from public.ips;
  end if;
  if new.featured and (select count(*) from public.ips where featured and id<>new.id)>=5 then
    raise check_violation using message='ip_featured_limit';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_ip_directory_settings() from public,anon,authenticated,service_role;
create trigger ips_guard_directory before insert or update of featured,sort_order on public.ips
for each row execute function private.guard_ip_directory_settings();

create function public.admin_set_ip_directory(
  target_id text,target_featured boolean,target_position integer,
  expected_order text[],expected_featured boolean
)
returns void language plpgsql security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid());
  current_order text[];
  next_order text[];
  previous public.ips;
begin
  if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ip_directory_settings',0));
  select array_agg(id order by sort_order,id) into current_order from public.ips;
  select * into previous from public.ips where id=target_id for update;
  if not found then raise no_data_found using message='ip_not_found'; end if;
  if current_order is distinct from expected_order or previous.featured is distinct from expected_featured then
    raise serialization_failure using message='ip_directory_conflict';
  end if;
  if target_featured is null or target_position is null or target_position not between 1 and cardinality(current_order) then
    raise invalid_parameter_value using message='invalid_ip_directory_position';
  end if;
  if target_featured and previous.archived_at is not null then
    raise check_violation using message='catalog_item_archived';
  end if;
  next_order := array_remove(current_order,target_id);
  next_order := coalesce(next_order[1:target_position-1],array[]::text[]) || array[target_id]
    || coalesce(next_order[target_position:cardinality(next_order)],array[]::text[]);
  update public.ips set featured=target_featured where id=target_id;
  update public.ips ip set sort_order=ordered.position::integer
  from unnest(next_order) with ordinality ordered(id,position)
  where ip.id=ordered.id and ip.sort_order is distinct from ordered.position::integer;
  insert into public.audit_log(actor_id,action,target,diff) values(
    actor,'catalog.ip.directory_updated','ips:'||target_id,
    jsonb_build_object('before',jsonb_build_object('featured',previous.featured,'order',current_order),
      'after',jsonb_build_object('featured',target_featured,'order',next_order))
  );
end;
$$;
revoke all on function public.admin_set_ip_directory(text,boolean,integer,text[],boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_set_ip_directory(text,boolean,integer,text[],boolean) to authenticated;
