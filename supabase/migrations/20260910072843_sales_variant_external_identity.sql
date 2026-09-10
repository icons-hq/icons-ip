-- #472 / P03: ERP external_identity is an operator-only attachment to a sale option.
--
-- The catalog's own good/variant codes remain the source of public external_identity.
-- ERP code, ERP name, and barcode live in private storage so a public catalog
-- query cannot accidentally expose an internal identifier. Blank input is
-- normalized to NULL by the write RPC; values are otherwise preserved exactly
-- (including leading zeroes).

create table private.goods_variant_external_identity (
  variant_id uuid primary key references public.goods_variants(id) on delete cascade,
  erp_code text,
  erp_name text,
  barcode text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goods_variant_external_identity_erp_code_shape check (
    erp_code is null
    or (erp_code = btrim(erp_code) and char_length(erp_code) between 1 and 120)
  ),
  constraint goods_variant_external_identity_erp_name_shape check (
    erp_name is null
    or (erp_name = btrim(erp_name) and char_length(erp_name) between 1 and 200)
  ),
  constraint goods_variant_external_identity_barcode_shape check (
    barcode is null
    or (barcode = btrim(barcode) and char_length(barcode) between 1 and 120)
  )
);

-- An ERP item maps to one option. Names are descriptive and may repeat; the
-- code and barcode are the stable values that must not identify two options.
create unique index goods_variant_external_identity_erp_code_key
  on private.goods_variant_external_identity (lower(erp_code))
  where erp_code is not null;
create unique index goods_variant_external_identity_barcode_key
  on private.goods_variant_external_identity (lower(barcode))
  where barcode is not null;

revoke all on table private.goods_variant_external_identity from public, anon, authenticated, service_role;

create function private.touch_goods_variant_external_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_goods_variant_external_identity() from public, anon, authenticated, service_role;
create trigger goods_variant_external_identity_touch
before update on private.goods_variant_external_identity
for each row execute function private.touch_goods_variant_external_identity();

-- One private writer owns normalization, row locking, optimistic conflict
-- detection, and the audit record. The public RPC below is the authenticated
-- entry point; admin_save_good/import can call this helper in the same
-- transaction when an option row carries external fields.
create function private.save_goods_variant_external_identity(
  target_good_id text,
  target_variant_id uuid,
  target_erp_code text,
  target_erp_name text,
  target_barcode text,
  target_expected_updated_at timestamptz default null,
  target_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := coalesce(target_actor, auth.uid());
  variant public.goods_variants;
  previous private.goods_variant_external_identity;
  saved private.goods_variant_external_identity;
  previous_json jsonb;
  next_erp_code text := nullif(btrim(target_erp_code), '');
  next_erp_name text := nullif(btrim(target_erp_name), '');
  next_barcode text := nullif(btrim(target_barcode), '');
begin
  if actor_id is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if target_good_id is null or btrim(target_good_id) = '' or char_length(target_good_id) > 200 then
    raise invalid_parameter_value using message = 'invalid_goods_variant_external_identity';
  end if;

  -- Keep the catalog lock order used by the option editor and checkout:
  -- parent good, then variant, then its private external_identity row.
  perform 1 from public.goods where id = target_good_id for update;
  if not found then
    raise no_data_found using message = 'goods_variant_not_found';
  end if;
  select * into variant
  from public.goods_variants
  where id = target_variant_id and good_id = target_good_id
  for update;
  if not found then
    raise no_data_found using message = 'goods_variant_not_found';
  end if;

  select * into previous
  from private.goods_variant_external_identity
  where variant_id = target_variant_id
  for update;

  -- Presence-aware optimistic concurrency: NULL expected means the editor saw
  -- no external_identity row. It is valid for a first write, but conflicts when another
  -- operator created a row after that read. Conversely, an existing row must
  -- always be submitted with its exact revision, including when it is being
  -- cleared.
  if (case when previous.variant_id is null then null::timestamptz else previous.updated_at end)
    is distinct from target_expected_updated_at then
    -- PT409 is a business stale-write response. Using PostgreSQL's 40001 here
    -- makes PostgREST retry the RPC as if it were a transient transaction
    -- serialization failure.
    raise exception using errcode = 'PT409', message = 'goods_variant_external_identity_changed';
  end if;

  if next_erp_code is not null and char_length(next_erp_code) > 120
    or next_erp_name is not null and char_length(next_erp_name) > 200
    or next_barcode is not null and char_length(next_barcode) > 120 then
    raise check_violation using message = 'invalid_goods_variant_external_identity';
  end if;

  previous_json := jsonb_build_object(
    'erpCode', case when previous.variant_id is null then null else previous.erp_code end,
    'erpName', case when previous.variant_id is null then null else previous.erp_name end,
    'barcode', case when previous.variant_id is null then null else previous.barcode end
  );

  if next_erp_code is null and next_erp_name is null and next_barcode is null then
    delete from private.goods_variant_external_identity where variant_id = target_variant_id;
  else
    insert into private.goods_variant_external_identity (variant_id, erp_code, erp_name, barcode)
    values (target_variant_id, next_erp_code, next_erp_name, next_barcode)
    on conflict (variant_id) do update set
      erp_code = excluded.erp_code,
      erp_name = excluded.erp_name,
      barcode = excluded.barcode;
  end if;

  select * into saved
  from private.goods_variant_external_identity
  where variant_id = target_variant_id;

  if previous_json is distinct from jsonb_build_object(
    'erpCode', case when saved.variant_id is null then null else saved.erp_code end,
    'erpName', case when saved.variant_id is null then null else saved.erp_name end,
    'barcode', case when saved.variant_id is null then null else saved.barcode end
  ) then
    insert into public.audit_log(actor_id, action, target, diff)
    values (
      actor_id,
      'admin.good.variant_external_identity_saved',
      'goods_variant:' || target_variant_id::text,
      jsonb_build_object(
        'before', previous_json,
        'after', jsonb_build_object(
          'erpCode', case when saved.variant_id is null then null else saved.erp_code end,
          'erpName', case when saved.variant_id is null then null else saved.erp_name end,
          'barcode', case when saved.variant_id is null then null else saved.barcode end
        )
      )
    );
  end if;

  return jsonb_build_object(
    'variantId', target_variant_id,
    'goodId', target_good_id,
    'erpCode', case when saved.variant_id is null then null else saved.erp_code end,
    'erpName', case when saved.variant_id is null then null else saved.erp_name end,
    'barcode', case when saved.variant_id is null then null else saved.barcode end,
    'updatedAt', case when saved.variant_id is null then null else saved.updated_at end
  );
end;
$$;
revoke all on function private.save_goods_variant_external_identity(text, uuid, text, text, text, timestamptz, uuid)
  from public, anon, authenticated, service_role;

create function public.admin_save_goods_variant_external_identity(
  target_good_id text,
  target_variant_id uuid,
  target_erp_code text,
  target_erp_name text,
  target_barcode text,
  target_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  return private.save_goods_variant_external_identity(
    target_good_id,
    target_variant_id,
    target_erp_code,
    target_erp_name,
    target_barcode,
    target_expected_updated_at,
    auth.uid()
  );
end;
$$;
revoke all on function public.admin_save_goods_variant_external_identity(text, uuid, text, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_save_goods_variant_external_identity(text, uuid, text, text, text, timestamptz)
  to authenticated;

-- The list deliberately starts at goods_variants, so an option with no
-- external external_identity is rendered as three NULLs and can be filled in by staff.
create function public.admin_list_goods_variant_external_identities(target_good_id text default null)
returns table (
  variant_id uuid,
  good_id text,
  erp_code text,
  erp_name text,
  barcode text,
  updated_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if target_good_id is not null and (btrim(target_good_id) = '' or char_length(target_good_id) > 200) then
    raise invalid_parameter_value using message = 'invalid_goods_variant_external_identity';
  end if;
  return query
  select variant.id, variant.good_id, external_identity.erp_code, external_identity.erp_name, external_identity.barcode, external_identity.updated_at
  from public.goods_variants variant
  left join private.goods_variant_external_identity external_identity on external_identity.variant_id = variant.id
  where target_good_id is null or variant.good_id = target_good_id
  order by variant.good_id, variant.sort_order, variant.id;
end;
$$;
revoke all on function public.admin_list_goods_variant_external_identities(text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_goods_variant_external_identities(text) to authenticated;

-- Bulk option saves and workbook imports can carry these keys without making
-- the public goods_variants row or its own code contract depend on ERP data.
-- Rows that omit every external key preserve their existing external_identity; an
-- explicit blank/null clears it.
create function private.save_goods_variant_external_identities(
  target_good_id text,
  target_rows jsonb,
  target_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := coalesce(target_actor, auth.uid());
  item jsonb;
  ordinal integer;
  variant_id uuid;
  external_identity jsonb;
  has_external_fields boolean;
  code_value text;
  name_value text;
  barcode_value text;
  expected_updated_at timestamptz;
begin
  if actor_id is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if target_rows is null or jsonb_typeof(target_rows) is distinct from 'array' then
    raise check_violation using message = 'invalid_goods_options';
  end if;

  for item, ordinal in
    select value, ordinality::integer
    from jsonb_array_elements(target_rows) with ordinality
  loop
    if jsonb_typeof(item) is distinct from 'object' then
      raise check_violation using message = 'invalid_goods_options';
    end if;
    external_identity := case
      when item ? 'externalIdentity' then item -> 'externalIdentity'
      else item
    end;
    has_external_fields :=
      external_identity ? 'erpCode' or external_identity ? 'erpName' or external_identity ? 'barcode'
      or external_identity ? 'erp_code' or external_identity ? 'erp_name';
    if not has_external_fields then
      continue;
    end if;
    if jsonb_typeof(external_identity) is distinct from 'object' then
      raise check_violation using message = 'invalid_goods_variant_external_identity';
    end if;

    code_value := case when external_identity ? 'erpCode' then external_identity ->> 'erpCode' else external_identity ->> 'erp_code' end;
    name_value := case when external_identity ? 'erpName' then external_identity ->> 'erpName' else external_identity ->> 'erp_name' end;
    barcode_value := external_identity ->> 'barcode';
    expected_updated_at := null;
    if external_identity ? 'externalUpdatedAt' or external_identity ? 'external_updated_at' then
      begin
        expected_updated_at := coalesce(external_identity ->> 'externalUpdatedAt', external_identity ->> 'external_updated_at')::timestamptz;
      exception when others then
        raise check_violation using message = 'invalid_goods_variant_external_identity';
      end;
    end if;

    if nullif(item ->> 'id', '') is not null then
      if (item ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise check_violation using message = 'invalid_goods_variant_external_identity';
      end if;
      variant_id := (item ->> 'id')::uuid;
    else
      select variant.id into variant_id
      from public.goods_variants variant
      where variant.good_id = target_good_id and variant.sort_order = ordinal - 1
        and variant.attributes = coalesce(item -> 'attributes', '{}'::jsonb)
      order by variant.id
      limit 1;
    end if;
    if variant_id is null then
      raise check_violation using message = 'goods_variant_not_found';
    end if;

    perform private.save_goods_variant_external_identity(
      target_good_id, variant_id, code_value, name_value, barcode_value, expected_updated_at, actor_id
    );
  end loop;
end;
$$;
revoke all on function private.save_goods_variant_external_identities(text, jsonb, uuid)
  from public, anon, authenticated, service_role;

-- Keep the existing discovery/English-name/catalog writer as the inner seam,
-- then add external identities in the same transaction. The next migration's
-- sales-policy wrapper renames this public function and delegates to it, so
-- the existing chain remains: catalog -> ERP identities -> sales policy.
alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_external_identity;
revoke all on function private.admin_save_good_before_external_identity(jsonb)
  from public, anon, authenticated, service_role;

create function public.admin_save_good(target_good jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved jsonb;
begin
  if auth.uid() is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  saved := private.admin_save_good_before_external_identity(target_good);
  if target_good ? 'variants' then
    perform private.save_goods_variant_external_identities(
      saved ->> 'id', target_good -> 'variants', auth.uid()
    );
  end if;
  return saved;
end;
$$;
revoke all on function public.admin_save_good(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;

-- Include external external_identity values and their row revision in the workbook
-- fingerprint. A preview made before an ERP edit must fail closed at commit;
-- omitting this private table would silently overwrite the newer mapping.
create or replace function private.goods_import_fingerprint(target_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'good', to_jsonb(good) - 'stock_qty' - 'updated_at',
    'variants', (
      select coalesce(jsonb_agg(
        (to_jsonb(variant) - 'stock_qty' - 'updated_at')
        || jsonb_build_object(
          'external_identity', jsonb_build_object(
            'erp_code', external_identity.erp_code,
            'erp_name', external_identity.erp_name,
            'barcode', external_identity.barcode,
            'updated_at', external_identity.updated_at
          )
        )
        order by variant.id
      ), '[]'::jsonb)
      from public.goods_variants variant
      left join private.goods_variant_external_identity external_identity
        on external_identity.variant_id = variant.id
      where variant.good_id = good.id
    )
  )::text, 'UTF8'), 'sha256'), 'hex')
  from public.goods good
  where good.id = target_id;
$$;
revoke all on function private.goods_import_fingerprint(text) from public, anon, authenticated, service_role;

-- The import/readback record carries ERP fields in the option object. They are
-- still returned only from this staff RPC; public goods/variant reads remain
-- unchanged and cannot expose the private source table.
create or replace function public.admin_goods_import_records(
  target_codes text[] default '{}',
  target_ids text[] default '{}'
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if coalesce(cardinality(target_codes), 0) + coalesce(cardinality(target_ids), 0) > 500 then
    raise invalid_parameter_value using message = 'import_record_limit';
  end if;
  return query
    select jsonb_build_object(
      'good', to_jsonb(good),
      'fingerprint', private.goods_import_fingerprint(good.id),
      'variants', (
        select coalesce(jsonb_agg(
          to_jsonb(variant)
          || jsonb_build_object(
            'erp_code', external_identity.erp_code,
            'erp_name', external_identity.erp_name,
            'barcode', external_identity.barcode,
            'external_updated_at', external_identity.updated_at
          )
          order by variant.is_default desc, variant.sort_order, variant.id
        ), '[]'::jsonb)
        from public.goods_variants variant
        left join private.goods_variant_external_identity external_identity
          on external_identity.variant_id = variant.id
        where variant.good_id = good.id
      )
    )
    from public.goods good
    where good.code = any(target_codes) or good.id = any(target_ids)
    order by good.id;
end;
$$;
revoke all on function public.admin_goods_import_records(text[], text[])
  from public, anon, authenticated, service_role;
grant execute on function public.admin_goods_import_records(text[], text[]) to authenticated;

-- New order rows receive a private point-in-time copy. Existing order rows are
-- intentionally left without a snapshot: a later ERP edit must never invent
-- historical values. The snapshot table has no public grant or Data API path.
create table private.order_item_external_identity_snapshots (
  order_item_id uuid primary key references public.order_items(id) on delete cascade,
  variant_id uuid not null,
  erp_code text,
  erp_name text,
  barcode text,
  captured_at timestamptz not null default now(),
  constraint order_item_external_identity_snapshot_erp_code_shape check (
    erp_code is null
    or (erp_code = btrim(erp_code) and char_length(erp_code) between 1 and 120)
  ),
  constraint order_item_external_identity_snapshot_erp_name_shape check (
    erp_name is null
    or (erp_name = btrim(erp_name) and char_length(erp_name) between 1 and 200)
  ),
  constraint order_item_external_identity_snapshot_barcode_shape check (
    barcode is null
    or (barcode = btrim(barcode) and char_length(barcode) between 1 and 120)
  )
);
create index order_item_external_identity_snapshots_variant_idx
  on private.order_item_external_identity_snapshots (variant_id);
revoke all on table private.order_item_external_identity_snapshots from public, anon, authenticated, service_role;

create function private.capture_order_item_external_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  external_identity private.goods_variant_external_identity;
begin
  -- Legacy rows without a variant cannot be given an ERP value. The current
  -- checkout contract always supplies variant_id and is covered by the SQL
  -- contract test below.
  if new.variant_id is null then
    return new;
  end if;

  -- All writers use parent good -> variant -> external_identity lock order. Taking the
  -- variant SHARE lock here makes a direct order-item insert obey the same
  -- boundary and prevents a concurrent external_identity edit from changing the value
  -- between order validation and snapshot capture.
  perform 1 from public.goods_variants where id = new.variant_id for share;
  select * into external_identity
  from private.goods_variant_external_identity
  where variant_id = new.variant_id
  for share;

  insert into private.order_item_external_identity_snapshots (
    order_item_id, variant_id, erp_code, erp_name, barcode
  ) values (
    new.id, new.variant_id,
    case when external_identity.variant_id is null then null else external_identity.erp_code end,
    case when external_identity.variant_id is null then null else external_identity.erp_name end,
    case when external_identity.variant_id is null then null else external_identity.barcode end
  );
  return new;
end;
$$;
revoke all on function private.capture_order_item_external_identity() from public, anon, authenticated, service_role;
create trigger order_items_capture_external_identity
after insert on public.order_items
for each row execute function private.capture_order_item_external_identity();

-- Private composition seam for staff order detail/export RPCs. Customer order
-- queries must continue to use public.order_items and therefore cannot see it.
create function private.order_item_external_identity_snapshot(target_order_item_id uuid)
returns table (erp_code text, erp_name text, barcode text)
language sql
stable
security definer
set search_path = ''
as $$
  select snapshot.erp_code, snapshot.erp_name, snapshot.barcode
  from private.order_item_external_identity_snapshots snapshot
  where snapshot.order_item_id = target_order_item_id;
$$;
revoke all on function private.order_item_external_identity_snapshot(uuid)
  from public, anon, authenticated, service_role;

-- Preserve every existing admin search clause (English name, keywords, own
-- good/option code, wildcard escaping) and add an internal ERP lookup. This is
-- security-definer only because the ERP table is private; the staff check and
-- authenticated-only grant remain the public boundary.
create or replace function public.admin_search_goods(search_text text default null)
returns setof public.goods
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  needle text := btrim(coalesce(search_text, ''));
  pattern text;
begin
  if auth.uid() is null or not public.is_staff() then
    raise insufficient_privilege using message = 'admin_only';
  end if;
  if length(needle) > 100 then
    raise invalid_parameter_value using message = 'goods_search_too_long';
  end if;
  pattern := '%' || replace(replace(replace(needle, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  return query
    select good.*
    from public.goods good
    where needle = ''
      or good.name ilike pattern escape E'\\'
      or coalesce(good.name_en, '') ilike pattern escape E'\\'
      or good.code ilike pattern escape E'\\'
      or good.id ilike pattern escape E'\\'
      or exists (
        select 1 from unnest(good.search_keywords) as item(keyword)
        where item.keyword ilike pattern escape E'\\'
      )
      or exists (
        select 1
        from public.goods_variants variant
        left join private.goods_variant_external_identity external_identity
          on external_identity.variant_id = variant.id
        where variant.good_id = good.id
          and (
            variant.code ilike pattern escape E'\\'
            or external_identity.erp_code ilike pattern escape E'\\'
            or external_identity.erp_name ilike pattern escape E'\\'
            or external_identity.barcode ilike pattern escape E'\\'
          )
      );
end;
$$;
revoke all on function public.admin_search_goods(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_goods(text) to authenticated;
