-- #490: reusable customer-facing shipping information templates.
-- Fulfillment origins continue to own rates, dispatch data, and the current
-- return address. A template owns the notice copy and CS contact details.
-- Applying a template snapshots its content on the good; historical orders and
-- approved claim collection addresses are intentionally untouched.

-- Tabs, LF and CR are valid customer copy. Other control characters are
-- rejected without putting a literal NUL into a PostgreSQL text expression.
create function private.has_disallowed_shipping_notice_control(value text)
returns boolean language sql immutable set search_path='' as $$
  select regexp_replace(coalesce(value, ''), '[' || chr(9) || chr(10) || chr(13) || ']', '', 'g') ~ '[[:cntrl:]]';
$$;
revoke all on function private.has_disallowed_shipping_notice_control(text) from public, anon, authenticated, service_role;
grant execute on function private.has_disallowed_shipping_notice_control(text) to postgres;

create table public.shipping_notice_templates (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9-]{1,39}$'),
  version integer not null default 1 check (version between 1 and 1000000),
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name, E' \t\n\r\f\v')),
  shipping_notice text not null default '' check (char_length(shipping_notice) <= 4000),
  return_exchange_notice text not null default '' check (char_length(return_exchange_notice) <= 4000),
  cs_name text not null default '' check (char_length(cs_name) <= 120),
  cs_phone text not null default '' check (char_length(cs_phone) <= 80),
  cs_email text not null default '' check (char_length(cs_email) <= 320),
  confirmation_evidence text not null default '' check (char_length(confirmation_evidence) <= 2000),
  status text not null default 'draft' check (status in ('draft','active')),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code, version),
  check (not private.has_disallowed_shipping_notice_control(shipping_notice)
    and not private.has_disallowed_shipping_notice_control(return_exchange_notice)),
  check (not private.has_disallowed_shipping_notice_control(cs_name)
    and not private.has_disallowed_shipping_notice_control(cs_phone)
    and not private.has_disallowed_shipping_notice_control(cs_email)),
  check (not private.has_disallowed_shipping_notice_control(confirmation_evidence)),
  check ((status = 'draft') or (
    char_length(btrim(shipping_notice, E' \t\n\r')) > 0
    and char_length(btrim(return_exchange_notice, E' \t\n\r')) > 0
    and char_length(btrim(cs_name, E' \t\n\r')) > 0
    and (char_length(btrim(cs_phone, E' \t\n\r')) > 0 or char_length(btrim(cs_email, E' \t\n\r')) > 0)
    and char_length(btrim(confirmation_evidence, E' \t\n\r')) > 0
    and confirmed_at is not null
  ))
);

create index shipping_notice_templates_status_idx
  on public.shipping_notice_templates(status, code, version desc);
create index shipping_notice_templates_name_idx
  on public.shipping_notice_templates(lower(name));

alter table public.shipping_notice_templates enable row level security;
revoke all on public.shipping_notice_templates from public, anon, authenticated, service_role;
grant select on public.shipping_notice_templates to authenticated;
create policy shipping_notice_templates_staff_read on public.shipping_notice_templates
  for select to authenticated using ((select public.is_staff()));

alter table public.goods
  add column shipping_notice_template_id uuid references public.shipping_notice_templates(id) on delete restrict,
  add column shipping_notice_template_version integer,
  add column shipping_notice_snapshot jsonb;

alter table public.goods
  add constraint goods_shipping_notice_snapshot_shape check (
    (shipping_notice_template_id is null
      and shipping_notice_template_version is null
      and shipping_notice_snapshot is null)
    or (shipping_notice_template_id is not null
      and shipping_notice_template_version is not null
      and shipping_notice_snapshot is not null
      and jsonb_typeof(shipping_notice_snapshot) = 'object')
  );
create index goods_shipping_notice_template_idx
  on public.goods(shipping_notice_template_id, shipping_notice_template_version);

-- An active version is immutable. New customer-facing wording is represented by
-- a new version row, so a product's applied version remains reviewable.
create function private.guard_shipping_notice_template_immutable()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status = 'active' and (
    new.code is distinct from old.code or new.version is distinct from old.version
    or new.name is distinct from old.name or new.shipping_notice is distinct from old.shipping_notice
    or new.return_exchange_notice is distinct from old.return_exchange_notice
    or new.cs_name is distinct from old.cs_name or new.cs_phone is distinct from old.cs_phone
    or new.cs_email is distinct from old.cs_email or new.confirmation_evidence is distinct from old.confirmation_evidence
    or new.status is distinct from old.status
    or (new.confirmed_by is distinct from old.confirmed_by and not (new.confirmed_by is null
      and not exists(select 1 from public.profiles where id=old.confirmed_by)))
    or new.confirmed_at is distinct from old.confirmed_at
  ) then
    raise check_violation using message = 'shipping_notice_template_active_immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_shipping_notice_template_immutable() from public, anon, authenticated, service_role;
create trigger shipping_notice_template_immutable
  before update on public.shipping_notice_templates
  for each row execute function private.guard_shipping_notice_template_immutable();

create function public.admin_save_shipping_notice_template(
  target_id uuid,
  target_code text,
  target_version integer,
  target_name text,
  target_shipping_notice text,
  target_return_exchange_notice text,
  target_cs_name text,
  target_cs_phone text,
  target_cs_email text,
  expected_updated_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid());
  previous public.shipping_notice_templates;
  saved public.shipping_notice_templates;
  normalized_code text := btrim(coalesce(target_code, ''), E' \t\n\r');
  normalized_name text := btrim(coalesce(target_name, ''), E' \t\n\r');
  normalized_shipping text := btrim(coalesce(target_shipping_notice, ''), E' \t\n\r');
  normalized_return_exchange text := btrim(coalesce(target_return_exchange_notice, ''), E' \t\n\r');
  normalized_cs_name text := btrim(coalesce(target_cs_name, ''), E' \t\n\r');
  normalized_cs_phone text := btrim(coalesce(target_cs_phone, ''), E' \t\n\r');
  normalized_cs_email text := btrim(coalesce(target_cs_email, ''), E' \t\n\r');
begin
  if actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if normalized_code !~ '^[a-z][a-z0-9-]{1,39}$'
    or target_version is null or target_version not between 1 and 1000000
    or char_length(normalized_name) not between 1 and 80
    or char_length(normalized_shipping) > 4000 or char_length(normalized_return_exchange) > 4000
    or char_length(normalized_cs_name) > 120 or char_length(normalized_cs_phone) > 80
    or char_length(normalized_cs_email) > 320
    or private.has_disallowed_shipping_notice_control(normalized_shipping)
    or private.has_disallowed_shipping_notice_control(normalized_return_exchange)
    or private.has_disallowed_shipping_notice_control(normalized_cs_name)
    or private.has_disallowed_shipping_notice_control(normalized_cs_phone)
    or private.has_disallowed_shipping_notice_control(normalized_cs_email)
  then
    raise invalid_parameter_value using message = 'invalid_shipping_notice_template';
  end if;

  if target_id is not null then
    select * into previous from public.shipping_notice_templates where id = target_id for update;
    if not found then raise no_data_found using message = 'shipping_notice_template_not_found'; end if;
    if previous.updated_at is distinct from expected_updated_at then
      raise exception using errcode = 'PT409', message = 'shipping_notice_template_conflict';
    end if;
    if previous.status <> 'draft' then
      raise check_violation using message = 'shipping_notice_template_active_immutable';
    end if;
    if previous.code <> normalized_code or previous.version <> target_version then
      raise check_violation using message = 'shipping_notice_template_identity_locked';
    end if;
    update public.shipping_notice_templates set
      name = normalized_name,
      shipping_notice = normalized_shipping,
      return_exchange_notice = normalized_return_exchange,
      cs_name = normalized_cs_name,
      cs_phone = normalized_cs_phone,
      cs_email = normalized_cs_email,
      updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
      where id = target_id returning * into saved;
  else
    if expected_updated_at is not null then
      raise invalid_parameter_value using message = 'invalid_shipping_notice_template';
    end if;
    insert into public.shipping_notice_templates(
      code, version, name, shipping_notice, return_exchange_notice, cs_name, cs_phone, cs_email
    ) values (
      normalized_code, target_version, normalized_name, normalized_shipping, normalized_return_exchange,
      normalized_cs_name, normalized_cs_phone, normalized_cs_email
    ) returning * into saved;
  end if;

  insert into public.audit_log(actor_id, action, target, diff)
    values (
      actor,
      case when target_id is null then 'catalog.shipping_notice_template.created'
        else 'catalog.shipping_notice_template.updated' end,
      'shipping_notice_templates:' || saved.id::text,
      jsonb_build_object('before', to_jsonb(previous), 'after', to_jsonb(saved))
    );
  return jsonb_build_object('id', saved.id, 'version', saved.version, 'updatedAt', saved.updated_at);
end;
$$;
revoke all on function public.admin_save_shipping_notice_template(uuid,text,integer,text,text,text,text,text,text,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_save_shipping_notice_template(uuid,text,integer,text,text,text,text,text,text,timestamptz)
  to authenticated;

create function public.admin_activate_shipping_notice_template(
  target_id uuid,
  expected_updated_at timestamptz,
  evidence text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid());
  previous public.shipping_notice_templates;
  saved public.shipping_notice_templates;
  normalized_evidence text := btrim(coalesce(evidence, ''), E' \t\n\r');
begin
  if actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  select * into previous from public.shipping_notice_templates where id = target_id for update;
  if not found then raise no_data_found using message = 'shipping_notice_template_not_found'; end if;
  if previous.status <> 'draft' then raise check_violation using message = 'shipping_notice_template_not_draft'; end if;
  if previous.updated_at is distinct from expected_updated_at then
    raise exception using errcode = 'PT409', message = 'shipping_notice_template_conflict';
  end if;
  if char_length(btrim(previous.shipping_notice, E' \t\n\r')) = 0
    or char_length(btrim(previous.return_exchange_notice, E' \t\n\r')) = 0
    or char_length(btrim(previous.cs_name, E' \t\n\r')) = 0
    or (char_length(btrim(previous.cs_phone, E' \t\n\r')) = 0 and char_length(btrim(previous.cs_email, E' \t\n\r')) = 0)
    or char_length(normalized_evidence) = 0 or char_length(normalized_evidence) > 2000
    or private.has_disallowed_shipping_notice_control(normalized_evidence) then
    raise check_violation using message = 'shipping_notice_template_required';
  end if;
  update public.shipping_notice_templates set
    status = 'active', confirmation_evidence = normalized_evidence,
    confirmed_by = actor, confirmed_at = clock_timestamp(),
    updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
    where id = target_id returning * into saved;
  insert into public.audit_log(actor_id, action, target, diff)
    values (actor, 'catalog.shipping_notice_template.activated', 'shipping_notice_templates:' || saved.id::text,
      jsonb_build_object('before', to_jsonb(previous), 'after', to_jsonb(saved)));
  return jsonb_build_object('id', saved.id, 'version', saved.version, 'updatedAt', saved.updated_at, 'status', saved.status);
end;
$$;
revoke all on function public.admin_activate_shipping_notice_template(uuid,timestamptz,text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_activate_shipping_notice_template(uuid,timestamptz,text) to authenticated;

create function public.admin_apply_shipping_notice_template(
  target_good_id text,
  target_template_id uuid,
  expected_good_updated_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid());
  template public.shipping_notice_templates;
  previous public.goods;
  saved public.goods;
  snapshot jsonb;
begin
  if actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  select * into previous from public.goods where id = target_good_id for update;
  if not found then raise no_data_found using message = 'good_not_found'; end if;
  if expected_good_updated_at is null or previous.updated_at is distinct from expected_good_updated_at then
    raise exception using errcode = 'PT409', message = 'good_shipping_notice_conflict';
  end if;
  if previous.archived_at is not null then raise check_violation using message='good_archived'; end if;
  if target_template_id is not distinct from previous.shipping_notice_template_id then
    return jsonb_build_object('goodId',previous.id,'templateId',previous.shipping_notice_template_id,
      'templateVersion',previous.shipping_notice_template_version,'updatedAt',previous.updated_at);
  end if;
  if target_template_id is null then
    update public.goods set
      shipping_notice_template_id = null,
      shipping_notice_template_version = null,
      shipping_notice_snapshot = null,
      updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
      where id = target_good_id returning * into saved;
    insert into public.audit_log(actor_id, action, target, diff)
      values (actor, 'catalog.good.shipping_notice_template_cleared', 'goods:' || saved.id,
        jsonb_build_object('before', jsonb_build_object(
          'templateId', previous.shipping_notice_template_id,
          'templateVersion', previous.shipping_notice_template_version,
          'snapshot', previous.shipping_notice_snapshot
        ), 'after', null));
    return jsonb_build_object('goodId', saved.id, 'templateId', null, 'templateVersion', null, 'updatedAt', saved.updated_at);
  end if;
  select * into template from public.shipping_notice_templates where id = target_template_id;
  if not found then raise no_data_found using message = 'shipping_notice_template_not_found'; end if;
  if template.status <> 'active' then raise check_violation using message = 'shipping_notice_template_not_active'; end if;
  snapshot := jsonb_build_object(
    'templateId', template.id,
    'templateVersion', template.version,
    'code', template.code,
    'name', template.name,
    'shippingNotice', template.shipping_notice,
    'returnExchangeNotice', template.return_exchange_notice,
    'csName', template.cs_name,
    'csPhone', template.cs_phone,
    'csEmail', template.cs_email
  );
  update public.goods set
    shipping_notice_template_id = template.id,
    shipping_notice_template_version = template.version,
    shipping_notice_snapshot = snapshot,
    updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
    where id = target_good_id returning * into saved;
  insert into public.audit_log(actor_id, action, target, diff)
    values (actor, 'catalog.good.shipping_notice_template_applied', 'goods:' || saved.id,
      jsonb_build_object('before', jsonb_build_object(
        'templateId', previous.shipping_notice_template_id,
        'templateVersion', previous.shipping_notice_template_version,
        'snapshot', previous.shipping_notice_snapshot
      ), 'after', jsonb_build_object(
        'templateId', saved.shipping_notice_template_id,
        'templateVersion', saved.shipping_notice_template_version,
        'snapshot', saved.shipping_notice_snapshot
      )));
  return jsonb_build_object(
    'goodId', saved.id,
    'templateId', saved.shipping_notice_template_id,
    'templateVersion', saved.shipping_notice_template_version,
    'updatedAt', saved.updated_at
  );
end;
$$;
revoke all on function public.admin_apply_shipping_notice_template(text,uuid,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_apply_shipping_notice_template(text,uuid,timestamptz) to authenticated;

-- Goods forms and workbook imports identify a template by its external
-- code/version contract. Resolve that reference and call the same atomic
-- apply/clear writer used by the dedicated admin screen.
create function private.apply_shipping_notice_template_reference(
  target_good_id text,
  target_code text,
  target_version integer
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  template_id uuid;
  good_stamp timestamptz;
begin
  if nullif(btrim(coalesce(target_code, ''), E' \t\n\r'), '') is null then
    select updated_at into good_stamp from public.goods where id = target_good_id;
    if not found then raise no_data_found using message = 'good_not_found'; end if;
    return public.admin_apply_shipping_notice_template(target_good_id, null, good_stamp);
  end if;
  if target_version is null then raise invalid_parameter_value using message = 'shipping_notice_template_version_required'; end if;
  select id into template_id from public.shipping_notice_templates
    where code = btrim(target_code) and version = target_version;
  if not found then raise check_violation using message = 'shipping_notice_template_not_found'; end if;
  select updated_at into good_stamp from public.goods where id = target_good_id;
  if not found then raise no_data_found using message = 'good_not_found'; end if;
  return public.admin_apply_shipping_notice_template(target_good_id, template_id, good_stamp);
end;
$$;
revoke all on function private.apply_shipping_notice_template_reference(text,text,integer)
  from public, anon, authenticated, service_role;

-- The lookup is intentionally staff-only: it exposes draft catalog records to
-- the operations console and never becomes a public catalogue endpoint.
create function public.admin_find_goods_for_shipping_notice_template(
  target_template_id uuid,
  search_query text default ''
)
returns table(id text, name text, template_id uuid, template_version integer, published_at timestamptz, updated_at timestamptz)
language sql security definer set search_path='' as $$
  select good.id, good.name, good.shipping_notice_template_id, good.shipping_notice_template_version, good.published_at, good.updated_at
  from public.goods good
  where (select auth.uid()) is not null and public.is_staff()
    and good.archived_at is null
    and (target_template_id is null or good.shipping_notice_template_id = target_template_id)
    and (nullif(btrim(search_query), '') is null
      or good.id ilike '%' || btrim(search_query) || '%'
      or good.name ilike '%' || btrim(search_query) || '%')
  order by good.updated_at desc, good.id
  limit 100;
$$;
revoke all on function public.admin_find_goods_for_shipping_notice_template(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_find_goods_for_shipping_notice_template(uuid,text) to authenticated;

alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_shipping_notice;
revoke all on function private.admin_save_good_before_shipping_notice(jsonb) from public,anon,authenticated,service_role;
create function public.admin_save_good(target_good jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb; previous public.goods; next_good public.goods; field text; before_policy jsonb; after_policy jsonb;
  owned_payload jsonb; initial_controls jsonb; existing_id text; legacy_payload jsonb;
  template_code text; template_version integer; template_fields_present boolean := false;
  template_version_text text;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  template_fields_present := target_good ? 'shipping_notice_template_code'
    or target_good ? 'shipping_notice_template_version'
    or target_good ? 'shippingNoticeTemplateCode'
    or target_good ? 'shippingNoticeTemplateVersion';
  legacy_payload := target_good - 'shipping_notice_template_code' - 'shipping_notice_template_version'
    - 'shippingNoticeTemplateCode' - 'shippingNoticeTemplateVersion';
  if template_fields_present then
    if (target_good ? 'shipping_notice_template_code' and jsonb_typeof(target_good->'shipping_notice_template_code') not in ('string','null'))
      or (target_good ? 'shippingNoticeTemplateCode' and jsonb_typeof(target_good->'shippingNoticeTemplateCode') not in ('string','null')) then
      raise invalid_parameter_value using message='invalid_shipping_notice_template';
    end if;
    template_code := nullif(btrim(coalesce(target_good->>'shipping_notice_template_code', target_good->>'shippingNoticeTemplateCode', '')), '');
    template_version_text := nullif(btrim(coalesce(target_good->>'shipping_notice_template_version', target_good->>'shippingNoticeTemplateVersion', '')), '');
    if template_version_text is not null then
      begin
        template_version := template_version_text::integer;
      exception when others then
        raise invalid_parameter_value using message='invalid_shipping_notice_template';
      end;
    end if;
    if template_code is not null and (template_code !~ '^[a-z][a-z0-9-]{1,39}$' or template_version is null or template_version not between 1 and 1000000) then
      raise invalid_parameter_value using message='invalid_shipping_notice_template';
    end if;
    if template_code is null and template_version is not null then
      raise invalid_parameter_value using message='invalid_shipping_notice_template';
    end if;
  end if;
  foreach field in array array['allow_card_payment','allow_bank_transfer','order_quantity_limit_enabled','member_purchase_limit_enabled'] loop
    if target_good ? field and jsonb_typeof(target_good->field) is distinct from 'boolean' then
      raise check_violation using message='invalid_goods_sales_policy';
    end if;
  end loop;
  if target_good ? 'sale_restriction' and (jsonb_typeof(target_good->'sale_restriction') is distinct from 'string'
    or target_good->>'sale_restriction' not in ('none','adult')) then
    raise check_violation using message='invalid_goods_sales_policy';
  end if;
  foreach field in array array['min_order_qty','max_order_qty','member_lifetime_qty_limit'] loop
    if target_good ? field and jsonb_typeof(target_good->field)<>'null' then
      if jsonb_typeof(target_good->field)<>'number' or target_good->>field !~ '^[1-9][0-9]*$'
        or (target_good->>field)::numeric>2147483647 then
        raise check_violation using message='invalid_goods_sales_policy';
      end if;
    end if;
  end loop;
  -- Apply controls before the legacy writer can emit a stock/publication alert.
  -- Match the legacy editor's advisory->good lock order, including a draft rename.
  existing_id:=coalesce(nullif(btrim(target_good->>'previous_id'),''),nullif(btrim(target_good->>'id'),''));
  if existing_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('admin_good:'||existing_id,0));
    select * into previous from public.goods where id=existing_id for update;
    if found then
      initial_controls:=jsonb_build_object('allow_card_payment',previous.allow_card_payment,
        'allow_bank_transfer',previous.allow_bank_transfer,'sale_restriction',previous.sale_restriction);
      update public.goods set
        allow_card_payment=case when target_good?'allow_card_payment' then (target_good->>'allow_card_payment')::boolean else allow_card_payment end,
        allow_bank_transfer=case when target_good?'allow_bank_transfer' then (target_good->>'allow_bank_transfer')::boolean else allow_bank_transfer end,
        sale_restriction=case when target_good?'sale_restriction' then (target_good->>'sale_restriction')::public.goods_sale_restriction else sale_restriction end
      where id=existing_id;
      if target_good->>'publish'='false' then perform public.admin_set_good_published(existing_id,false); end if;
    end if;
  end if;
  -- New goods begin as drafts. The final controls must exist before first publish.
  saved:=private.admin_save_good_before_shipping_notice(case when legacy_payload->>'publish' in ('true','false')
    then legacy_payload||'{"publish":null}'::jsonb else legacy_payload end);
  select * into previous from public.goods where id=saved->>'id' for update;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into owned_payload
  from jsonb_each(target_good) where key=any(array['allow_card_payment','allow_bank_transfer','sale_restriction',
    'order_quantity_limit_enabled','min_order_qty','max_order_qty','member_purchase_limit_enabled','member_lifetime_qty_limit']);
  next_good:=jsonb_populate_record(previous,owned_payload);
  before_policy:=jsonb_build_object('allow_card_payment',previous.allow_card_payment,
    'allow_bank_transfer',previous.allow_bank_transfer,'sale_restriction',previous.sale_restriction,
    'order_quantity_limit_enabled',previous.order_quantity_limit_enabled,'min_order_qty',previous.min_order_qty,
    'max_order_qty',previous.max_order_qty,'member_purchase_limit_enabled',previous.member_purchase_limit_enabled,
    'member_lifetime_qty_limit',previous.member_lifetime_qty_limit);
  before_policy:=before_policy||coalesce(initial_controls,'{}'::jsonb);
  after_policy:=jsonb_build_object('allow_card_payment',next_good.allow_card_payment,
    'allow_bank_transfer',next_good.allow_bank_transfer,'sale_restriction',next_good.sale_restriction,
    'order_quantity_limit_enabled',next_good.order_quantity_limit_enabled,'min_order_qty',next_good.min_order_qty,
    'max_order_qty',next_good.max_order_qty,'member_purchase_limit_enabled',next_good.member_purchase_limit_enabled,
    'member_lifetime_qty_limit',next_good.member_lifetime_qty_limit);
  if after_policy is distinct from before_policy then
    update public.goods set allow_card_payment=next_good.allow_card_payment,
      allow_bank_transfer=next_good.allow_bank_transfer,sale_restriction=next_good.sale_restriction,
      order_quantity_limit_enabled=next_good.order_quantity_limit_enabled,min_order_qty=next_good.min_order_qty,
      max_order_qty=next_good.max_order_qty,member_purchase_limit_enabled=next_good.member_purchase_limit_enabled,
      member_lifetime_qty_limit=next_good.member_lifetime_qty_limit where id=previous.id;
    insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'admin.good.sales_policy_saved','goods:'||previous.id,
      jsonb_build_object('before',before_policy,'after',after_policy));
  end if;
  -- Both methods may be deliberately disabled. The public quote advertises an
  -- empty intersection and the locked order writer rejects either method.
  if legacy_payload->>'publish' in ('true','false') then
    perform public.admin_set_good_published(saved->>'id',(legacy_payload->>'publish')::boolean);
  end if;
  if template_fields_present then
    perform private.apply_shipping_notice_template_reference(saved->>'id', template_code, template_version);
    saved := saved || jsonb_build_object('shippingNoticeTemplateCode', template_code, 'shippingNoticeTemplateVersion', template_version);
  end if;
  return saved;
end $$;
revoke all on function public.admin_save_good(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;


-- Extend the existing public shipping-policy contract. Rates and the current
-- origin return address remain origin-owned; customer copy comes from the
-- immutable snapshot stored on the good.
create or replace function public.get_good_shipping_policy(target_good_id text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'originId', origin.id,
    'originName', origin.name,
    'returnAddress', origin.return_address,
    'baseFee', origin.base_fee,
    'freeThreshold', origin.free_threshold,
    'feeType', good.shipping_fee_type,
    'individualFee', good.individual_fee,
    'shippingNoticeTemplateId', good.shipping_notice_template_id,
    'shippingNoticeTemplateVersion', good.shipping_notice_template_version,
    'shippingNotice', coalesce(good.shipping_notice_snapshot->>'shippingNotice', ''),
    'returnExchangeNotice', coalesce(good.shipping_notice_snapshot->>'returnExchangeNotice', ''),
    'cs', jsonb_build_object(
      'name', coalesce(good.shipping_notice_snapshot->>'csName', ''),
      'phone', coalesce(good.shipping_notice_snapshot->>'csPhone', ''),
      'email', coalesce(good.shipping_notice_snapshot->>'csEmail', '')
    )
  )
  from public.goods good
  join public.ips ip on ip.id = good.ip_id
  join public.fulfillment_origins origin on origin.id = good.origin_id and origin.is_active
  where good.id = target_good_id and good.archived_at is null and good.published_at is not null
    and good.sale_restriction = 'none'
    and ip.archived_at is null and ip.published_at is not null;
$$;
revoke all on function public.get_good_shipping_policy(text) from public, anon, authenticated, service_role;
grant execute on function public.get_good_shipping_policy(text) to anon, authenticated;
