-- #474: customer category hierarchy and independent ERP mapping.
-- Category values are optional metadata while the customer/ERP gates are off.
-- Existing goods.type, unclassified goods, and historical records remain valid.

create table public.catalog_categories (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9-]*$' and length(code) <= 80),
  name text not null check (btrim(name) <> '' and length(name) <= 120),
  parent_id uuid references public.catalog_categories (id) on delete restrict,
  depth integer not null default 1 check (depth between 1 and 4),
  sort_order integer not null default 0 check (sort_order >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.goods
  add column category_id uuid references public.catalog_categories (id) on delete restrict;

create index catalog_categories_parent_idx on public.catalog_categories (parent_id, sort_order, code);
create index catalog_categories_archived_idx on public.catalog_categories (archived_at);
create index goods_category_idx on public.goods (category_id);

create table public.catalog_category_erp_mappings (
  category_id uuid primary key references public.catalog_categories (id) on delete restrict,
  erp_code text not null check (btrim(erp_code) <> ''),
  erp_name text not null check (btrim(erp_name) <> ''),
  source text not null check (btrim(source) <> ''),
  verified_at timestamptz not null,
  verified_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index catalog_category_erp_code_key on public.catalog_category_erp_mappings (erp_code);

create table public.goods_type_category_migrations (
  type text primary key check (btrim(type) <> ''),
  category_id uuid references public.catalog_categories (id) on delete restrict,
  status text not null check (status in ('suggested', 'confirmed', 'rejected')),
  note text,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table public.category_activation_control (
  id text primary key check (id = 'catalog'),
  customer_enabled boolean not null default false,
  erp_enabled boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now()
);
insert into public.category_activation_control (id) values ('catalog') on conflict (id) do nothing;

alter table public.catalog_categories enable row level security;
alter table public.catalog_category_erp_mappings enable row level security;
alter table public.goods_type_category_migrations enable row level security;
alter table public.category_activation_control enable row level security;

create function private.category_customer_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select control.customer_enabled
    from public.category_activation_control as control
    where control.id = 'catalog'), false)
$$;

create policy catalog_categories_public_read on public.catalog_categories for select using (
  archived_at is null and private.category_customer_enabled()
);
create policy catalog_categories_staff_read on public.catalog_categories for select using ((select public.is_staff()));
create policy catalog_category_erp_mappings_staff_read on public.catalog_category_erp_mappings for select using ((select public.is_staff()));
create policy goods_type_category_migrations_staff_read on public.goods_type_category_migrations for select using ((select public.is_staff()));
create policy category_activation_staff_read on public.category_activation_control for select using ((select public.is_staff()));

revoke all on public.catalog_categories, public.catalog_category_erp_mappings, public.goods_type_category_migrations, public.category_activation_control from public, anon, authenticated, service_role;
grant all on public.catalog_categories, public.catalog_category_erp_mappings, public.goods_type_category_migrations, public.category_activation_control to postgres;
grant select on public.catalog_categories to anon, authenticated;
grant select on public.catalog_category_erp_mappings, public.goods_type_category_migrations, public.category_activation_control to authenticated;
revoke insert, update, delete on public.catalog_categories, public.catalog_category_erp_mappings, public.goods_type_category_migrations, public.category_activation_control from public, anon, authenticated, service_role;

create function public.get_catalog_categories()
returns table (
  id uuid,
  code text,
  name text,
  parent_id uuid,
  depth integer,
  sort_order integer
)
language sql stable security definer set search_path = '' as $$
  with recursive category_lineage as (
    select category.id as leaf_id, category.parent_id, category.archived_at
    from public.catalog_categories as category
    union all
    select lineage.leaf_id, parent.parent_id, parent.archived_at
    from category_lineage as lineage
    join public.catalog_categories as parent on parent.id = lineage.parent_id
  )
  select category.id, category.code, category.name, category.parent_id, category.depth, category.sort_order
  from public.catalog_categories as category
  where private.category_customer_enabled()
    and category.archived_at is null
    and not exists (
      select 1 from category_lineage as lineage
      where lineage.leaf_id = category.id and lineage.archived_at is not null
    )
  order by category.depth, category.sort_order, category.code
$$;

revoke all on function public.get_catalog_categories() from public, anon, authenticated, service_role;
grant execute on function public.get_catalog_categories() to anon, authenticated;

create function private.category_validate_parent(target_category_id uuid, target_parent_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  current_id uuid := target_parent_id;
  current_parent_id uuid;
  current_archived_at timestamptz;
  depth integer := 1;
  descendant_depth integer;
begin
  if target_parent_id is null then return 1; end if;
  while current_id is not null loop
    if current_id = target_category_id then raise check_violation using message = 'category_cycle'; end if;
    select category.parent_id, category.archived_at into current_parent_id, current_archived_at
    from public.catalog_categories as category where category.id = current_id;
    if not found then raise foreign_key_violation using message = 'category_parent_not_found'; end if;
    if current_archived_at is not null then raise check_violation using message = 'category_parent_archived'; end if;
    depth := depth + 1;
    if depth > 4 then raise check_violation using message = 'category_depth_exceeded'; end if;
    current_id := current_parent_id;
  end loop;
  with recursive descendants as (
    select category.id, 1 as relative_depth from public.catalog_categories as category where category.parent_id = target_category_id
    union all
    select child.id, descendants.relative_depth + 1 from descendants join public.catalog_categories as child on child.parent_id = descendants.id
  ) select coalesce(max(relative_depth), 0) into descendant_depth from descendants;
  if depth + descendant_depth > 4 then raise check_violation using message = 'category_depth_exceeded'; end if;
  return depth;
end;
$$;

create function private.lock_catalog_category_tree()
returns void language sql volatile security definer set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('catalog_category_tree', 0));
$$;

create function private.guard_category_tree()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_catalog_category_tree();
  if new.parent_id is not null then
    if tg_op = 'INSERT' then
      if exists (select 1 from public.goods where category_id = new.parent_id) then
        raise check_violation using message = 'category_has_goods';
      end if;
    elsif old.parent_id is distinct from new.parent_id
      and exists (select 1 from public.goods where category_id = new.parent_id)
    then
      raise check_violation using message = 'category_has_goods';
    end if;
  end if;
  new.depth := private.category_validate_parent(new.id, new.parent_id);
  return new;
end;
$$;
create trigger catalog_categories_tree_guard before insert or update of parent_id on public.catalog_categories
for each row execute function private.guard_category_tree();

create function private.guard_good_category()
returns trigger language plpgsql security definer set search_path = '' as $$
declare child_count integer; archived_at timestamptz;
begin
  if new.category_id is null then return new; end if;
  select category.archived_at,
    (select count(*)::integer from public.catalog_categories as child where child.parent_id = category.id and child.archived_at is null)
    into archived_at, child_count
  from public.catalog_categories as category where category.id = new.category_id for share;
  if not found then raise foreign_key_violation using message = 'category_not_found'; end if;
  if archived_at is not null then
    if tg_op = 'UPDATE' then
      if old.category_id is not distinct from new.category_id then return new; end if;
    end if;
    raise check_violation using message = 'category_archived';
  end if;
  if child_count > 0 then raise check_violation using message = 'category_not_leaf'; end if;
  return new;
end;
$$;
create trigger goods_category_guard before insert or update of category_id on public.goods
for each row execute function private.guard_good_category();

revoke all on function private.category_validate_parent(uuid, uuid), private.lock_catalog_category_tree(), private.guard_category_tree(), private.guard_good_category()
  from public, anon, authenticated, service_role;
revoke all on function private.category_customer_enabled() from public, anon, authenticated, service_role;
grant execute on function private.category_customer_enabled() to anon, authenticated;
grant execute on function private.lock_catalog_category_tree() to postgres;

create function public.admin_upsert_category(
  target_operation_id uuid,
  target_category_id uuid,
  target_code text,
  target_name text,
  target_parent_id uuid,
  target_sort_order integer,
  target_expected_updated_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  category_row public.catalog_categories;
  next_depth integer;
  result_id uuid;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
  request_payload jsonb;
begin
  if actor_id is null or not public.is_staff() then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_code is null or target_code !~ '^[a-z0-9][a-z0-9-]*$' or length(target_code) > 80
     or target_name is null or btrim(target_name) = '' or length(target_name) > 120
     or target_sort_order is null or target_sort_order < 0 then
    raise invalid_parameter_value using message = 'invalid_category';
  end if;
  request_payload := jsonb_build_object(
    'category_id', target_category_id,
    'code', target_code,
    'name', btrim(target_name),
    'parent_id', target_parent_id,
    'sort_order', target_sort_order,
    'expected_updated_at', target_expected_updated_at
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id
       and existing_action in ('admin.catalog.category.created', 'admin.catalog.category.updated')
       and existing_diff -> 'request' = request_payload
    then
      result_id := coalesce(target_category_id, nullif(existing_diff ->> 'category_id', '')::uuid);
      next_depth := nullif(existing_diff #>> '{after,depth}', '')::integer;
      if result_id is not null and next_depth is not null then
        return jsonb_build_object('id', result_id, 'depth', next_depth);
      end if;
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  perform private.lock_catalog_category_tree();

  if target_category_id is null then
    if exists (select 1 from public.catalog_categories where code = target_code) then raise unique_violation using message = 'category_code_taken'; end if;
    result_id := extensions.gen_random_uuid();
    next_depth := private.category_validate_parent(result_id, target_parent_id);
    insert into public.catalog_categories (id, code, name, parent_id, depth, sort_order)
    values (result_id, target_code, btrim(target_name), target_parent_id, next_depth, target_sort_order);
    insert into public.audit_log(id, actor_id, action, target, diff)
    values (target_operation_id, actor_id, 'admin.catalog.category.created', 'catalog_categories:' || result_id::text,
      jsonb_build_object('category_id', result_id, 'request', request_payload,
        'after', jsonb_build_object('code', target_code, 'name', btrim(target_name), 'parent_id', target_parent_id, 'depth', next_depth)));
  else
    select * into category_row from public.catalog_categories where id = target_category_id for update;
    if not found then raise no_data_found using message = 'category_not_found'; end if;
    if target_expected_updated_at is null or category_row.updated_at is distinct from target_expected_updated_at then raise exception using errcode = 'PT409', message = 'category_changed'; end if;
    if exists (select 1 from public.catalog_categories where code = target_code and id <> target_category_id) then raise unique_violation using message = 'category_code_taken'; end if;
    next_depth := private.category_validate_parent(target_category_id, target_parent_id);
    update public.catalog_categories
    set code = target_code, name = btrim(target_name), parent_id = target_parent_id, depth = next_depth,
        sort_order = target_sort_order, updated_at = pg_catalog.now()
    where id = target_category_id;
    with recursive descendants as (
      select category.id, 1 as relative_depth
      from public.catalog_categories as category
      where category.parent_id = target_category_id
      union all
      select child.id, descendants.relative_depth + 1
      from descendants
      join public.catalog_categories as child on child.parent_id = descendants.id
    )
    update public.catalog_categories as child
    set depth = next_depth + descendants.relative_depth, updated_at = pg_catalog.now()
    from descendants
    where child.id = descendants.id;
    result_id := target_category_id;
    insert into public.audit_log(id, actor_id, action, target, diff)
    values (target_operation_id, actor_id, 'admin.catalog.category.updated', 'catalog_categories:' || target_category_id::text,
      jsonb_build_object('category_id', target_category_id, 'request', request_payload,
        'after', jsonb_build_object('code', target_code, 'name', btrim(target_name), 'parent_id', target_parent_id, 'depth', next_depth)));
  end if;
  return jsonb_build_object('id', result_id, 'depth', next_depth);
end;
$$;

create function public.admin_archive_category(target_operation_id uuid, target_category_id uuid, target_expected_updated_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  category_row public.catalog_categories;
  existing_actor_id uuid;
  existing_action text;
  existing_diff jsonb;
  request_payload jsonb;
  changed boolean;
begin
  if actor_id is null or not public.is_staff() then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_category_id is null or target_expected_updated_at is null then raise invalid_parameter_value using message = 'invalid_category_operation'; end if;
  request_payload := jsonb_build_object('category_id', target_category_id, 'expected_updated_at', target_expected_updated_at);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.diff into existing_actor_id, existing_action, existing_diff
  from public.audit_log as audit where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id and existing_action = 'admin.catalog.category.archived' and existing_diff -> 'request' = request_payload then
      return coalesce((existing_diff ->> 'changed')::boolean, true);
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  perform private.lock_catalog_category_tree();
  select * into category_row from public.catalog_categories where id = target_category_id for update;
  if not found then raise no_data_found using message = 'category_not_found'; end if;
  if category_row.updated_at is distinct from target_expected_updated_at then raise exception using errcode = 'PT409', message = 'category_changed'; end if;
  if category_row.archived_at is not null then
    changed := false;
  else
    if exists (select 1 from public.catalog_categories where parent_id = target_category_id and archived_at is null) then raise check_violation using message = 'category_has_active_children'; end if;
    update public.catalog_categories set archived_at = pg_catalog.now(), updated_at = pg_catalog.now() where id = target_category_id;
    changed := true;
  end if;
  insert into public.audit_log(id, actor_id, action, target, diff)
  values (target_operation_id, actor_id, 'admin.catalog.category.archived', 'catalog_categories:' || target_category_id::text,
    jsonb_build_object('request', request_payload, 'changed', changed));
  return changed;
end;
$$;

create function public.admin_unarchive_category(target_operation_id uuid, target_category_id uuid, target_expected_updated_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  category_row public.catalog_categories;
  next_depth integer;
  existing_actor_id uuid;
  existing_action text;
  existing_diff jsonb;
  request_payload jsonb;
  changed boolean;
begin
  if actor_id is null or not public.is_staff() then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_category_id is null or target_expected_updated_at is null then raise invalid_parameter_value using message = 'invalid_category_operation'; end if;
  request_payload := jsonb_build_object('category_id', target_category_id, 'expected_updated_at', target_expected_updated_at);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.diff into existing_actor_id, existing_action, existing_diff
  from public.audit_log as audit where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id and existing_action = 'admin.catalog.category.unarchived' and existing_diff -> 'request' = request_payload then
      return coalesce((existing_diff ->> 'changed')::boolean, true);
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  perform private.lock_catalog_category_tree();
  select * into category_row from public.catalog_categories where id = target_category_id for update;
  if not found then raise no_data_found using message = 'category_not_found'; end if;
  if category_row.updated_at is distinct from target_expected_updated_at then raise exception using errcode = 'PT409', message = 'category_changed'; end if;
  if category_row.archived_at is null then
    changed := false;
    next_depth := category_row.depth;
  else
    next_depth := private.category_validate_parent(target_category_id, category_row.parent_id);
    update public.catalog_categories set archived_at = null, depth = next_depth, updated_at = pg_catalog.now() where id = target_category_id;
    changed := true;
  end if;
  insert into public.audit_log(id, actor_id, action, target, diff)
  values (target_operation_id, actor_id, 'admin.catalog.category.unarchived', 'catalog_categories:' || target_category_id::text,
    jsonb_build_object('request', request_payload, 'changed', changed, 'depth', next_depth));
  return changed;
end;
$$;

create function public.admin_set_category_erp_mapping(
  target_operation_id uuid,
  target_category_id uuid,
  target_erp_code text,
  target_erp_name text,
  target_source text,
  target_verified_at timestamptz
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  existing_actor_id uuid;
  existing_action text;
  existing_diff jsonb;
  request_payload jsonb;
begin
  if actor_id is null or not public.is_staff() then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_category_id is null or btrim(coalesce(target_erp_code, '')) = ''
     or btrim(coalesce(target_erp_name, '')) = '' or btrim(coalesce(target_source, '')) = '' or target_verified_at is null then
    raise invalid_parameter_value using message = 'invalid_category_erp_mapping';
  end if;
  request_payload := jsonb_build_object(
    'category_id', target_category_id,
    'erp_code', btrim(target_erp_code),
    'erp_name', btrim(target_erp_name),
    'source', btrim(target_source),
    'verified_at', target_verified_at
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.diff into existing_actor_id, existing_action, existing_diff
  from public.audit_log as audit where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id and existing_action = 'admin.catalog.category.erp_mapping_updated' and existing_diff -> 'request' = request_payload then
      return true;
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  perform private.lock_catalog_category_tree();
  if not exists (select 1 from public.catalog_categories where id = target_category_id and archived_at is null) then raise no_data_found using message = 'category_not_found'; end if;
  if exists (select 1 from public.catalog_category_erp_mappings where erp_code = btrim(target_erp_code) and category_id <> target_category_id) then raise unique_violation using message = 'category_erp_code_taken'; end if;
  insert into public.catalog_category_erp_mappings(category_id, erp_code, erp_name, source, verified_at, verified_by)
  values (target_category_id, btrim(target_erp_code), btrim(target_erp_name), btrim(target_source), target_verified_at, actor_id)
  on conflict(category_id) do update set erp_code = excluded.erp_code, erp_name = excluded.erp_name, source = excluded.source,
    verified_at = excluded.verified_at, verified_by = excluded.verified_by, updated_at = pg_catalog.now();
  insert into public.audit_log(id, actor_id, action, target, diff)
  values (target_operation_id, actor_id, 'admin.catalog.category.erp_mapping_updated', 'catalog_categories:' || target_category_id::text,
    jsonb_build_object('request', request_payload));
  return true;
end;
$$;

create function public.admin_set_category_activation(
  target_operation_id uuid,
  target_customer_enabled boolean,
  target_erp_enabled boolean,
  target_evidence jsonb
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := (select auth.uid());
  customer jsonb := coalesce(target_evidence->'customer', '{}'::jsonb);
  erp jsonb := coalesce(target_evidence->'erp', '{}'::jsonb);
  existing_actor_id uuid;
  existing_action text;
  existing_diff jsonb;
  request_payload jsonb;
begin
  if v_actor_id is null or not public.is_staff() then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_evidence is null then raise invalid_parameter_value using message = 'invalid_category_activation'; end if;
  request_payload := jsonb_build_object(
    'customer_enabled', target_customer_enabled,
    'erp_enabled', target_erp_enabled,
    'evidence', target_evidence
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.diff into existing_actor_id, existing_action, existing_diff
  from public.audit_log as audit where audit.id = target_operation_id;
  if found then
    if existing_actor_id = v_actor_id and existing_action = 'admin.catalog.category.activation_updated' and existing_diff -> 'request' = request_payload then
      return true;
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  if target_customer_enabled and (
    btrim(coalesce(customer->>'source', '')) = '' or btrim(coalesce(customer->>'reference', '')) = ''
    or btrim(coalesce(customer->>'verifiedAt', '')) = '' or not exists(select 1 from public.catalog_categories where archived_at is null)
  ) then raise check_violation using message = 'category_activation_unready'; end if;
  if target_erp_enabled and (
    btrim(coalesce(erp->>'source', '')) = '' or btrim(coalesce(erp->>'reference', '')) = ''
    or btrim(coalesce(erp->>'verifiedAt', '')) = '' or not exists(
      select 1 from public.catalog_categories as category
      where category.archived_at is null
        and not exists (select 1 from public.catalog_categories as child where child.parent_id = category.id and child.archived_at is null)
    ) or exists(
      select 1
      from public.catalog_categories as category
      left join public.catalog_category_erp_mappings as mapping on mapping.category_id = category.id
      where category.archived_at is null
        and not exists (select 1 from public.catalog_categories as child where child.parent_id = category.id and child.archived_at is null)
        and mapping.category_id is null
    )
  ) then raise check_violation using message = 'category_activation_unready'; end if;
  update public.category_activation_control
  set customer_enabled = target_customer_enabled, erp_enabled = target_erp_enabled, evidence = target_evidence,
      actor_id = v_actor_id, updated_at = pg_catalog.now()
  where id = 'catalog';
  insert into public.audit_log(id, actor_id, action, target, diff)
  values (target_operation_id, v_actor_id, 'admin.catalog.category.activation_updated', 'category_activation_control:catalog',
    jsonb_build_object('request', request_payload));
  return true;
end;
$$;

create function public.admin_assign_good_category(
  target_operation_id uuid,
  target_good_id text,
  target_category_id uuid,
  target_expected_updated_at timestamptz
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  category_row public.catalog_categories;
  good_updated_at timestamptz;
  good_category_id uuid;
  existing_actor_id uuid;
  existing_action text;
  existing_diff jsonb;
  request_payload jsonb;
begin
  if actor_id is null or not public.is_staff() then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_good_id is null then raise invalid_parameter_value using message = 'invalid_good_category'; end if;
  request_payload := jsonb_build_object(
    'good_id', target_good_id,
    'category_id', target_category_id,
    'expected_updated_at', target_expected_updated_at
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.diff into existing_actor_id, existing_action, existing_diff
  from public.audit_log as audit where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id and existing_action = 'admin.catalog.good.category_updated' and existing_diff -> 'request' = request_payload then
      return true;
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  perform private.lock_catalog_category_tree();
  select updated_at, category_id into good_updated_at, good_category_id
  from public.goods where id = target_good_id for update;
  if not found then raise no_data_found using message = 'goods_not_found'; end if;
  if target_category_id is not null then
    select * into category_row from public.catalog_categories where id = target_category_id for update;
    if not found then raise no_data_found using message = 'category_not_found'; end if;
    if category_row.archived_at is not null and good_category_id is distinct from target_category_id then raise check_violation using message = 'category_archived'; end if;
    if exists(select 1 from public.catalog_categories where parent_id = target_category_id and archived_at is null) then raise check_violation using message = 'category_not_leaf'; end if;
  end if;
  if target_expected_updated_at is not null and good_updated_at is distinct from target_expected_updated_at then raise exception using errcode = 'PT409', message = 'goods_changed'; end if;
  update public.goods set category_id = target_category_id, updated_at = pg_catalog.now() where id = target_good_id;
  insert into public.audit_log(id, actor_id, action, target, diff)
  values (target_operation_id, actor_id, 'admin.catalog.good.category_updated', 'goods:' || target_good_id,
    jsonb_build_object('request', request_payload));
  return true;
end;
$$;

create function public.admin_set_category_type_migration(
  target_operation_id uuid,
  target_type text,
  target_category_id uuid,
  target_status text,
  target_note text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  existing_actor_id uuid;
  existing_action text;
  existing_diff jsonb;
  request_payload jsonb;
begin
  if actor_id is null or not public.is_staff() then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or btrim(coalesce(target_type, '')) = '' or target_status not in ('suggested', 'confirmed', 'rejected') then raise invalid_parameter_value using message = 'invalid_category_type_migration'; end if;
  request_payload := jsonb_build_object(
    'type', btrim(target_type),
    'category_id', target_category_id,
    'status', target_status,
    'note', target_note
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.diff into existing_actor_id, existing_action, existing_diff
  from public.audit_log as audit where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id and existing_action = 'admin.catalog.category.type_migration_updated' and existing_diff -> 'request' = request_payload then
      return true;
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  if target_category_id is not null and not exists(select 1 from public.catalog_categories where id = target_category_id) then raise no_data_found using message = 'category_not_found'; end if;
  insert into public.goods_type_category_migrations(type, category_id, status, note, actor_id)
  values (btrim(target_type), target_category_id, target_status, target_note, actor_id)
  on conflict(type) do update set category_id = excluded.category_id, status = excluded.status, note = excluded.note, actor_id = excluded.actor_id, updated_at = pg_catalog.now();
  insert into public.audit_log(id, actor_id, action, target, diff)
  values (target_operation_id, actor_id, 'admin.catalog.category.type_migration_updated', 'goods_type_category_migrations:' || btrim(target_type),
    jsonb_build_object('request', request_payload));
  return true;
end;
$$;

revoke all on function public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamptz),
  public.admin_archive_category(uuid,uuid,timestamptz),
  public.admin_unarchive_category(uuid,uuid,timestamptz),
  public.admin_set_category_erp_mapping(uuid,uuid,text,text,text,timestamptz),
  public.admin_set_category_activation(uuid,boolean,boolean,jsonb),
  public.admin_assign_good_category(uuid,text,uuid,timestamptz),
  public.admin_set_category_type_migration(uuid,text,uuid,text,text)
from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamptz),
  public.admin_archive_category(uuid,uuid,timestamptz),
  public.admin_unarchive_category(uuid,uuid,timestamptz),
  public.admin_set_category_erp_mapping(uuid,uuid,text,text,text,timestamptz),
  public.admin_set_category_activation(uuid,boolean,boolean,jsonb),
  public.admin_assign_good_category(uuid,text,uuid,timestamptz),
  public.admin_set_category_type_migration(uuid,text,uuid,text,text)
to authenticated;

-- The ordinary editor and workbook share the category identity contract. Acquire
-- the tree lock before any product row so assignment and category moves serialize.
alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_category;
revoke all on function private.admin_save_good_before_category(jsonb) from public,anon,authenticated,service_role;
create function public.admin_save_good(target_good jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb; current_good public.goods; category_value uuid; code_value text; code_id uuid;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if not (target_good ? 'category_id' or target_good ? 'category_code') then
    return private.admin_save_good_before_category(target_good);
  end if;
  perform private.lock_catalog_category_tree();
  if target_good ? 'category_id' then
    if jsonb_typeof(target_good->'category_id') not in ('string','null') then
      raise invalid_parameter_value using message='invalid_good_category';
    end if;
    begin category_value:=nullif(btrim(target_good->>'category_id'),'')::uuid;
    exception when invalid_text_representation then raise invalid_parameter_value using message='invalid_good_category'; end;
  end if;
  if target_good ? 'category_code' then
    if jsonb_typeof(target_good->'category_code') not in ('string','null') then
      raise invalid_parameter_value using message='invalid_good_category';
    end if;
    code_value:=nullif(btrim(target_good->>'category_code'),'');
    if code_value is not null then
      select id into code_id from public.catalog_categories where code=code_value;
      if not found then raise no_data_found using message='category_not_found'; end if;
    end if;
    if target_good ? 'category_id' and code_id is distinct from category_value then
      raise invalid_parameter_value using message='good_category_identity_mismatch';
    end if;
    category_value:=code_id;
  end if;
  saved:=private.admin_save_good_before_category(target_good-'category_id'-'category_code');
  select * into current_good from public.goods where id=saved->>'id' for update;
  if current_good.category_id is distinct from category_value then
    update public.goods set category_id=category_value where id=current_good.id;
    insert into public.audit_log(actor_id,action,target,diff)
      values(auth.uid(),'admin.catalog.good.category_changed','goods:'||current_good.id,
        jsonb_build_object('before',current_good.category_id,'after',category_value));
  end if;
  return saved;
end;
$$;
revoke all on function public.admin_save_good(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;

-- Import validation already locks a product before calling the common writer.
-- Take the same tree lock at the outer boundary to avoid lock-order inversion.
alter function public.admin_commit_goods_import_group(uuid,integer) set schema private;
alter function private.admin_commit_goods_import_group(uuid,integer) rename to admin_commit_goods_import_group_before_category;
revoke all on function private.admin_commit_goods_import_group_before_category(uuid,integer) from public,anon,authenticated,service_role;
create function public.admin_commit_goods_import_group(target_batch uuid,target_index integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  perform private.lock_catalog_category_tree();
  return private.admin_commit_goods_import_group_before_category(target_batch,target_index);
end;
$$;
revoke all on function public.admin_commit_goods_import_group(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_commit_goods_import_group(uuid,integer) to authenticated;
