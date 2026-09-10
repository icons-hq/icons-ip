-- #475: option-level KRW purchase cost. It never becomes a selling-price,
-- customer-order, or settlement input. Zero is an explicit cost; NULL is unset.
create table private.goods_variant_purchase_costs (
  variant_id uuid primary key references public.goods_variants(id) on delete cascade,
  unit_cost_krw integer check(unit_cost_krw is null or unit_cost_krw>=0),
  tax_basis text check(tax_basis is null or tax_basis in ('included','excluded','exempt')),
  revision integer not null check(revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  check((unit_cost_krw is null)=(tax_basis is null))
);
create table private.goods_variant_purchase_cost_changes (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.goods_variants(id),
  good_id_snapshot text not null,
  revision integer not null check(revision>0),
  before_value jsonb check(before_value is null or jsonb_typeof(before_value)='object'),
  after_value jsonb not null check(jsonb_typeof(after_value)='object'),
  actor_id uuid not null references public.profiles(id),
  changed_at timestamptz not null default clock_timestamp(),
  unique(variant_id,revision)
);
create index goods_variant_purchase_cost_changes_history_idx
  on private.goods_variant_purchase_cost_changes(variant_id,revision desc);
revoke all on table private.goods_variant_purchase_costs,private.goods_variant_purchase_cost_changes
  from public,anon,authenticated,service_role;
grant select,insert,update,delete on table private.goods_variant_purchase_costs,private.goods_variant_purchase_cost_changes to postgres;

create function private.can_manage_goods_purchase_costs()
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and public.is_staff()
    and exists(select 1 from public.profiles where id=auth.uid() and role='admin');
$$;
revoke all on function private.can_manage_goods_purchase_costs() from public,anon,authenticated,service_role;
grant execute on function private.can_manage_goods_purchase_costs() to postgres;

create function private.save_goods_variant_purchase_cost(
  p_good_id text,p_variant_id uuid,p_unit_cost_krw integer,p_tax_basis text,p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  previous private.goods_variant_purchase_costs;
  saved private.goods_variant_purchase_costs;
  normalized_tax text:=nullif(btrim(p_tax_basis),'');
  change_id uuid;
  previous_value jsonb;
  next_value jsonb;
begin
  if not private.can_manage_goods_purchase_costs() then raise insufficient_privilege using message='purchase_cost_admin_required'; end if;
  if p_good_id is null or nullif(btrim(p_good_id),'') is null or p_variant_id is null
    or p_unit_cost_krw<0 or (p_unit_cost_krw is null)<>(normalized_tax is null)
    or (normalized_tax is not null and normalized_tax not in ('included','excluded','exempt'))
    or (p_expected_revision is not null and p_expected_revision<1) then
    raise check_violation using message='invalid_goods_purchase_cost';
  end if;
  -- Same parent->option order as catalog, stock and checkout writers.
  perform 1 from public.goods where id=p_good_id for update;
  if not found then raise no_data_found using message='goods_variant_not_found'; end if;
  perform 1 from public.goods_variants where id=p_variant_id and good_id=p_good_id for update;
  if not found then raise no_data_found using message='goods_variant_not_found'; end if;
  select * into previous from private.goods_variant_purchase_costs where variant_id=p_variant_id for update;
  if found then
    if p_expected_revision is null or p_expected_revision<>previous.revision then
      raise sqlstate 'PT409' using message='goods_purchase_cost_changed';
    end if;
    if (previous.unit_cost_krw,previous.tax_basis) is not distinct from (p_unit_cost_krw,normalized_tax) then
      return jsonb_build_object('revision',previous.revision,'changed',false);
    end if;
    previous_value:=jsonb_build_object('unitCostKrw',previous.unit_cost_krw,'taxBasis',previous.tax_basis);
    update private.goods_variant_purchase_costs set unit_cost_krw=p_unit_cost_krw,tax_basis=normalized_tax,
      revision=revision+1,updated_at=clock_timestamp(),updated_by=auth.uid()
    where variant_id=p_variant_id returning * into saved;
  else
    if p_expected_revision is not null then raise sqlstate 'PT409' using message='goods_purchase_cost_changed'; end if;
    if p_unit_cost_krw is null then return jsonb_build_object('revision',null,'changed',false); end if;
    insert into private.goods_variant_purchase_costs(variant_id,unit_cost_krw,tax_basis,revision,updated_by)
    values(p_variant_id,p_unit_cost_krw,normalized_tax,1,auth.uid()) returning * into saved;
  end if;
  next_value:=jsonb_build_object('unitCostKrw',saved.unit_cost_krw,'taxBasis',saved.tax_basis);
  insert into private.goods_variant_purchase_cost_changes(variant_id,good_id_snapshot,revision,before_value,after_value,actor_id)
  values(p_variant_id,p_good_id,saved.revision,previous_value,next_value,auth.uid()) returning id into change_id;
  -- audit_log is staff-readable. Never place a cost amount or tax basis in it.
  insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'admin.good.purchase_cost_saved','goods:'||p_good_id,
    jsonb_build_object('variantId',p_variant_id,'changeId',change_id,'detailsAccess','admin'));
  return jsonb_build_object('revision',saved.revision,'changed',true);
end $$;
revoke all on function private.save_goods_variant_purchase_cost(text,uuid,integer,text,integer) from public,anon,authenticated,service_role;
grant execute on function private.save_goods_variant_purchase_cost(text,uuid,integer,text,integer) to postgres;

create function public.admin_save_goods_variant_purchase_cost(
  p_good_id text,p_variant_id uuid,p_unit_cost_krw integer,p_tax_basis text,p_expected_revision integer default null
) returns jsonb language sql security definer set search_path='' as $$
  select private.save_goods_variant_purchase_cost(p_good_id,p_variant_id,p_unit_cost_krw,p_tax_basis,p_expected_revision);
$$;
revoke all on function public.admin_save_goods_variant_purchase_cost(text,uuid,integer,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_variant_purchase_cost(text,uuid,integer,text,integer) to authenticated;

create function public.admin_list_goods_variant_purchase_costs(p_good_id text)
returns table(variant_id uuid,good_id text,unit_cost_krw integer,tax_basis text,revision integer,updated_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_manage_goods_purchase_costs() then raise insufficient_privilege using message='purchase_cost_admin_required'; end if;
  if nullif(btrim(p_good_id),'') is null or char_length(p_good_id)>200 then
    raise invalid_parameter_value using message='invalid_goods_purchase_cost';
  end if;
  return query select variant.id,variant.good_id,cost.unit_cost_krw,cost.tax_basis,cost.revision,cost.updated_at
    from public.goods_variants variant left join private.goods_variant_purchase_costs cost on cost.variant_id=variant.id
    where variant.good_id=p_good_id order by variant.is_default desc,variant.sort_order,variant.id;
end $$;
revoke all on function public.admin_list_goods_variant_purchase_costs(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_goods_variant_purchase_costs(text) to authenticated;

create function public.admin_list_goods_purchase_cost_history(p_good_id text,p_variant_id uuid,p_before_revision integer default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_manage_goods_purchase_costs() then raise insufficient_privilege using message='purchase_cost_admin_required'; end if;
  if p_before_revision is not null and p_before_revision<1 then raise invalid_parameter_value using message='invalid_goods_purchase_cost'; end if;
  if not exists(select 1 from public.goods_variants where id=p_variant_id and good_id=p_good_id) then
    raise no_data_found using message='goods_variant_not_found';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,'variantId',entry.variant_id,'revision',entry.revision,
    'before',entry.before_value,'after',entry.after_value,'actorName',actor.nickname,'changedAt',entry.changed_at)
    order by entry.revision desc)
    from (select * from private.goods_variant_purchase_cost_changes where variant_id=p_variant_id
      and (p_before_revision is null or revision<p_before_revision) order by revision desc limit 50) entry
    left join public.profiles actor on actor.id=entry.actor_id),'[]'::jsonb);
end $$;
revoke all on function public.admin_list_goods_purchase_cost_history(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_goods_purchase_cost_history(text,uuid,integer) to authenticated;

-- Optional workbook/admin option field. A staff save which omits purchaseCost
-- preserves it. An explicit cost operation requires admin even when clearing it.
create function private.save_goods_variant_purchase_costs(p_good_id text,p_rows jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; ordinal integer; cost jsonb; variant_key uuid; amount integer; basis text; expected integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then raise check_violation using message='invalid_goods_options'; end if;
  for item,ordinal in select value,ordinality::integer from jsonb_array_elements(p_rows) with ordinality loop
    if not (item?'purchaseCost') then continue; end if;
    if not private.can_manage_goods_purchase_costs() then raise insufficient_privilege using message='purchase_cost_admin_required'; end if;
    cost:=item->'purchaseCost'; amount:=null; basis:=null; expected:=null;
    if jsonb_typeof(cost) is distinct from 'object' or not(cost ?& array['unitCostKrw','taxBasis','expectedRevision'])
      or exists(select 1 from jsonb_object_keys(cost) key where key not in ('unitCostKrw','taxBasis','expectedRevision')) then
      raise check_violation using message='invalid_goods_purchase_cost';
    end if;
    if jsonb_typeof(cost->'unitCostKrw')<>'null' then
      if jsonb_typeof(cost->'unitCostKrw')<>'number' or cost->>'unitCostKrw' !~ '^[0-9]+$'
        or (cost->>'unitCostKrw')::numeric>2147483647 then
        raise check_violation using message='invalid_goods_purchase_cost';
      end if;
      amount:=(cost->>'unitCostKrw')::integer;
    end if;
    if jsonb_typeof(cost->'taxBasis')<>'null' then
      if jsonb_typeof(cost->'taxBasis')<>'string' then raise check_violation using message='invalid_goods_purchase_cost'; end if;
      basis:=cost->>'taxBasis';
    end if;
    if jsonb_typeof(cost->'expectedRevision')<>'null' then
      if jsonb_typeof(cost->'expectedRevision')<>'number' or cost->>'expectedRevision' !~ '^[1-9][0-9]*$'
        or (cost->>'expectedRevision')::numeric>2147483647 then
        raise check_violation using message='invalid_goods_purchase_cost';
      end if;
      expected:=(cost->>'expectedRevision')::integer;
    end if;
    variant_key:=null;
    if nullif(item->>'id','') is not null then variant_key:=(item->>'id')::uuid;
    else
      select id into variant_key from public.goods_variants where good_id=p_good_id and sort_order=ordinal-1
        and attributes=coalesce(item->'attributes','{}'::jsonb) order by id limit 1;
    end if;
    if variant_key is null then raise no_data_found using message='goods_variant_not_found'; end if;
    perform private.save_goods_variant_purchase_cost(p_good_id,variant_key,amount,basis,expected);
  end loop;
end $$;
revoke all on function private.save_goods_variant_purchase_costs(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.save_goods_variant_purchase_costs(text,jsonb) to postgres;

alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_purchase_cost;
revoke all on function private.admin_save_good_before_purchase_cost(jsonb) from public,anon,authenticated,service_role;
create function public.admin_save_good(target_good jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if jsonb_typeof(target_good->'variants')='array' and exists(
    select 1 from jsonb_array_elements(target_good->'variants') item where item?'purchaseCost'
  ) and not private.can_manage_goods_purchase_costs() then
    raise insufficient_privilege using message='purchase_cost_admin_required';
  end if;
  saved:=private.admin_save_good_before_purchase_cost(target_good);
  if target_good?'variants' then perform private.save_goods_variant_purchase_costs(saved->>'id',target_good->'variants'); end if;
  return saved;
end $$;
revoke all on function public.admin_save_good(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;

-- Fingerprint only the cost revision, never an amount or tax basis. Cost values
-- have a small guessable domain and must not become an offline hash oracle.
create or replace function private.goods_import_fingerprint(target_id text)
returns text language sql stable security definer set search_path='' as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'good',to_jsonb(good)-'stock_qty'-'updated_at',
    'variants',(select coalesce(jsonb_agg((to_jsonb(variant)-'stock_qty'-'updated_at')
      ||jsonb_build_object('external_identity',jsonb_build_object('erp_code',external_identity.erp_code,
        'erp_name',external_identity.erp_name,'barcode',external_identity.barcode,'updated_at',external_identity.updated_at),
        'purchase_cost_revision',cost.revision) order by variant.id),'[]'::jsonb)
      from public.goods_variants variant
      left join private.goods_variant_external_identity external_identity on external_identity.variant_id=variant.id
      left join private.goods_variant_purchase_costs cost on cost.variant_id=variant.id where variant.good_id=good.id)
  )::text,'UTF8'),'sha256'),'hex') from public.goods good where good.id=target_id;
$$;
revoke all on function private.goods_import_fingerprint(text) from public,anon,authenticated,service_role;

create or replace function public.admin_goods_import_records(target_codes text[] default '{}',target_ids text[] default '{}')
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
declare can_read_costs boolean:=private.can_manage_goods_purchase_costs();
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if coalesce(cardinality(target_codes),0)+coalesce(cardinality(target_ids),0)>500 then
    raise invalid_parameter_value using message='import_record_limit';
  end if;
  return query select jsonb_build_object('good',to_jsonb(good),'fingerprint',private.goods_import_fingerprint(good.id),
    'variants',(select coalesce(jsonb_agg(to_jsonb(variant)
      ||jsonb_build_object('erp_code',external_identity.erp_code,'erp_name',external_identity.erp_name,
        'barcode',external_identity.barcode,'external_updated_at',external_identity.updated_at)
      ||case when can_read_costs then jsonb_build_object('purchase_cost_krw',cost.unit_cost_krw,
        'purchase_tax_basis',cost.tax_basis,'purchase_cost_revision',cost.revision) else '{}'::jsonb end
      order by variant.is_default desc,variant.sort_order,variant.id),'[]'::jsonb)
      from public.goods_variants variant
      left join private.goods_variant_external_identity external_identity on external_identity.variant_id=variant.id
      left join private.goods_variant_purchase_costs cost on cost.variant_id=variant.id where variant.good_id=good.id))
    from public.goods good where good.code=any(target_codes) or good.id=any(target_ids) order by good.id;
end $$;
revoke all on function public.admin_goods_import_records(text[],text[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_import_records(text[],text[]) to authenticated;

-- An admin workbook can contain purchase costs before its plan is parsed. Mark
-- new admin-owned batches confidential at creation, and never lower that marker.
-- Existing actor-private Storage policies join this table, so the same current-
-- role check also protects source XLSX files after an admin is demoted to staff.
alter table public.admin_goods_imports add column requires_admin boolean not null default false;
create function private.guard_goods_import_cost_confidentiality() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.requires_admin:=coalesce(new.requires_admin,false)
    or exists(select 1 from public.profiles where id=new.actor_id and role='admin')
    or jsonb_path_exists(new.plan,'$[*].target.variants[*].purchaseCost');
  if tg_op='UPDATE' then new.requires_admin:=new.requires_admin or old.requires_admin; end if;
  return new;
end $$;
revoke all on function private.guard_goods_import_cost_confidentiality() from public,anon,authenticated,service_role;
create trigger goods_import_cost_confidentiality before insert or update of actor_id,plan,requires_admin
  on public.admin_goods_imports for each row execute function private.guard_goods_import_cost_confidentiality();
drop policy admin_goods_imports_owner_read on public.admin_goods_imports;
create policy admin_goods_imports_owner_read on public.admin_goods_imports for select to authenticated
using(actor_id=(select auth.uid()) and (select public.is_staff())
  and (not requires_admin or exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin')));

alter function public.admin_commit_goods_import_group(uuid,integer) set schema private;
alter function private.admin_commit_goods_import_group(uuid,integer) rename to admin_commit_goods_import_group_before_purchase_cost;
revoke all on function private.admin_commit_goods_import_group_before_purchase_cost(uuid,integer) from public,anon,authenticated,service_role;
create function public.admin_commit_goods_import_group(target_batch uuid,target_index integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if exists(select 1 from public.admin_goods_imports where id=target_batch and actor_id=auth.uid() and requires_admin)
    and not private.can_manage_goods_purchase_costs() then
    raise insufficient_privilege using message='purchase_cost_admin_required';
  end if;
  return private.admin_commit_goods_import_group_before_purchase_cost(target_batch,target_index);
end $$;
revoke all on function public.admin_commit_goods_import_group(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_commit_goods_import_group(uuid,integer) to authenticated;
