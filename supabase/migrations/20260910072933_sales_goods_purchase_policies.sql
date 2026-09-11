-- #471/#476/#483/#484: one authoritative price and purchase-condition contract.
-- Existing goods retain their current card/bank-transfer and unrestricted-quantity
-- behavior. A new restriction must be explicitly enabled with actual numeric values.
alter table public.goods
  add column allow_card_payment boolean not null default true,
  add column order_quantity_limit_enabled boolean not null default false,
  add column min_order_qty integer,
  add column max_order_qty integer,
  add column member_purchase_limit_enabled boolean not null default false,
  add column member_lifetime_qty_limit integer,
  add constraint goods_order_quantity_values check (
    (min_order_qty is null or min_order_qty > 0)
    and (max_order_qty is null or max_order_qty > 0)
    and (min_order_qty is null or max_order_qty is null or min_order_qty <= max_order_qty)
  ),
  add constraint goods_order_quantity_activation check (
    not order_quantity_limit_enabled or (min_order_qty is not null and max_order_qty is not null)
  ),
  add constraint goods_member_quantity_value check (
    member_lifetime_qty_limit is null or member_lifetime_qty_limit > 0
  ),
  add constraint goods_member_quantity_activation check (
    not member_purchase_limit_enabled or member_lifetime_qty_limit is not null
  );

-- This is an operational schedule, not a publicly writable catalog table. Public
-- readers only receive the price effective at the server's evaluation timestamp.
create table private.goods_variant_price_periods (
  id uuid primary key default gen_random_uuid(),
  good_id text not null,
  variant_id uuid not null,
  state text not null check (state in ('draft','active','disabled')),
  regular_price integer not null check (regular_price >= 0),
  discount_price integer check (discount_price > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (variant_id,good_id) references public.goods_variants(id,good_id) on update cascade,
  check (starts_at is null or ends_at is null or starts_at < ends_at),
  check (discount_price is null or discount_price < regular_price),
  check (state <> 'active' or (discount_price is not null and starts_at is not null and ends_at is not null))
);
revoke all on table private.goods_variant_price_periods from public,anon,authenticated,service_role;
-- Existing SECURITY DEFINER functions may be owned by postgres even when this
-- migration runs as supabase_admin. Both are trusted database owners; API roles
-- remain sealed. This also keeps owner-operated local maintenance possible.
grant select,insert,update,delete on table private.goods_variant_price_periods to postgres;
create index goods_variant_price_periods_active_idx
  on private.goods_variant_price_periods(variant_id,starts_at,ends_at) where state='active';

-- Published versions keep their economics forever; stopping a version only changes
-- its state. A changed offer is a new row. Orders retain both the row id and amounts.
create function private.guard_goods_price_period() returns trigger
language plpgsql security definer set search_path='' as $$
declare variant public.goods_variants;
begin
  perform 1 from public.goods where id=new.good_id for update;
  select * into variant from public.goods_variants
    where id=new.variant_id and good_id=new.good_id for update;
  if not found then raise check_violation using message='goods_variant_not_found'; end if;
  if tg_op='UPDATE' then
    -- A never-published good can still change its draft slug. Its immutable
    -- option id remains the identity while the composite FK cascades good_id.
    if (new.id,new.variant_id,new.created_at,new.created_by)
      is distinct from (old.id,old.variant_id,old.created_at,old.created_by) then
      raise check_violation using message='price_period_identity_immutable';
    end if;
    if old.state in ('active','disabled') and (
      (new.regular_price,new.discount_price,new.starts_at,new.ends_at)
        is distinct from (old.regular_price,old.discount_price,old.starts_at,old.ends_at)
      or new.state='draft' or (old.state='disabled' and new.state<>'disabled')
    ) then raise check_violation using message='price_period_requires_new_version'; end if;
  end if;
  if new.state='active' then
    if variant.archived_at is not null then
      raise check_violation using message='price_period_variant_inactive';
    end if;
    if new.regular_price is distinct from variant.price then
      raise check_violation using message='price_period_regular_price_changed';
    end if;
    if exists(select 1 from private.goods_variant_price_periods period
      where period.variant_id=new.variant_id and period.id<>new.id and period.state='active'
        and tstzrange(period.starts_at,period.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)')) then
      raise exclusion_violation using message='price_period_overlap';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_goods_price_period() from public,anon,authenticated,service_role;
create trigger goods_price_period_guard before insert or update on private.goods_variant_price_periods
  for each row execute function private.guard_goods_price_period();

create function private.guard_goods_variant_period_price() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.price is distinct from old.price and exists (
    select 1 from private.goods_variant_price_periods
    where variant_id=old.id and state='active' and ends_at>statement_timestamp()
  ) then raise check_violation using message='active_price_period_requires_reset'; end if;
  return new;
end $$;
revoke all on function private.guard_goods_variant_period_price() from public,anon,authenticated,service_role;
create trigger goods_variant_period_price_guard before update of price on public.goods_variants
  for each row execute function private.guard_goods_variant_period_price();

-- All live price consumers call this resolver. p_at is supplied once per checkout;
-- tests may exercise exact boundaries without clocks, sleeps, or catalog mutation.
create function private.resolve_goods_variant_price(p_variant_id uuid,p_at timestamptz)
returns table(regular_price integer,effective_price integer,price_period_id uuid,starts_at timestamptz,ends_at timestamptz)
language sql stable security definer set search_path='' as $$
  select variant.price,coalesce(period.discount_price,variant.price),period.id,period.starts_at,period.ends_at
  from public.goods_variants variant
  left join lateral (
    select schedule.* from private.goods_variant_price_periods schedule
    where schedule.variant_id=variant.id and schedule.state='active'
      and schedule.starts_at<=p_at and p_at<schedule.ends_at
    order by schedule.starts_at,schedule.id limit 1
  ) period on true
  where variant.id=p_variant_id;
$$;
revoke all on function private.resolve_goods_variant_price(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.resolve_goods_variant_price(uuid,timestamptz) to postgres;

-- PostgREST computed field: goods_variants(...,pricing:goods_variant_pricing).
-- Look up the persisted id and visibility rather than trusting a caller-supplied row.
create function public.goods_variant_pricing(target_variant public.goods_variants)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('regularPrice',price.regular_price,'effectivePrice',price.effective_price,
    'pricePeriodId',price.price_period_id,'startsAt',price.starts_at,'endsAt',price.ends_at,
    'calculatedAt',statement_timestamp(),'nextChangeAt',(
      select min(boundary.change_at) from private.goods_variant_price_periods schedule
      cross join lateral (values(schedule.starts_at),(schedule.ends_at)) boundary(change_at)
      where schedule.variant_id=variant.id and schedule.state='active' and boundary.change_at>statement_timestamp()
    ))
  from public.goods_variants variant
  join public.goods good on good.id=variant.good_id
  join public.ips ip on ip.id=good.ip_id
  cross join lateral private.resolve_goods_variant_price(variant.id,statement_timestamp()) price
  where variant.id=target_variant.id and (public.is_staff() or (
    variant.archived_at is null and good.archived_at is null and good.published_at is not null
    and good.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null
  ));
$$;
revoke all on function public.goods_variant_pricing(public.goods_variants) from public,anon,authenticated,service_role;
grant execute on function public.goods_variant_pricing(public.goods_variants) to anon,authenticated;

create function public.admin_list_goods_price_periods(p_good_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'goodId',good_id,'variantId',variant_id,
    'state',state,'regularPrice',regular_price,'discountPrice',discount_price,'startsAt',starts_at,'endsAt',ends_at,
    'revision',revision,'createdAt',created_at,'updatedAt',updated_at) order by created_at,id)
    from private.goods_variant_price_periods where good_id=p_good_id),'[]'::jsonb);
end $$;
revoke all on function public.admin_list_goods_price_periods(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_goods_price_periods(text) to authenticated;

create function public.admin_save_goods_price_period(
  p_good_id text,p_variant_id uuid,p_period_id uuid,p_period jsonb,p_expected_revision integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  previous private.goods_variant_price_periods;
  saved private.goods_variant_price_periods;
  variant public.goods_variants;
  next_state text;
  next_price integer;
  next_start timestamptz;
  next_end timestamptz;
  next_regular integer;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if jsonb_typeof(p_period) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_period) key where key not in ('state','discountPrice','startsAt','endsAt'))
    or p_period->>'state' is null or p_period->>'state' not in ('draft','active','disabled') then
    raise check_violation using message='invalid_price_period';
  end if;
  next_state:=p_period->>'state';
  if coalesce(jsonb_typeof(p_period->'discountPrice'),'null')<>'null' then
    if jsonb_typeof(p_period->'discountPrice')<>'number' or p_period->>'discountPrice' !~ '^[1-9][0-9]*$'
      or (p_period->>'discountPrice')::numeric>2147483647 then
      raise check_violation using message='invalid_price_period';
    end if;
    next_price:=(p_period->>'discountPrice')::integer;
  end if;
  if coalesce(jsonb_typeof(p_period->'startsAt'),'null')<>'null' then
    if jsonb_typeof(p_period->'startsAt')<>'string' or p_period->>'startsAt' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise check_violation using message='price_period_timezone_required';
    end if;
    next_start:=(p_period->>'startsAt')::timestamptz;
  end if;
  if coalesce(jsonb_typeof(p_period->'endsAt'),'null')<>'null' then
    if jsonb_typeof(p_period->'endsAt')<>'string' or p_period->>'endsAt' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise check_violation using message='price_period_timezone_required';
    end if;
    next_end:=(p_period->>'endsAt')::timestamptz;
  end if;
  if next_state='active' and (next_price is null or next_start is null or next_end is null) then
    raise check_violation using message='price_period_not_configured';
  end if;
  if (next_start is not null and not isfinite(next_start)) or (next_end is not null and not isfinite(next_end))
    or (next_start is not null and next_end is not null and next_start>=next_end) then
    raise check_violation using message='invalid_price_period';
  end if;
  perform 1 from public.goods where id=p_good_id for update;
  select * into variant from public.goods_variants where id=p_variant_id and good_id=p_good_id for update;
  if not found then raise check_violation using message='goods_variant_not_found'; end if;
  next_regular:=variant.price;
  if p_period_id is not null then
    select * into previous from private.goods_variant_price_periods
      where id=p_period_id and good_id=p_good_id and variant_id=p_variant_id for update;
    if not found then raise no_data_found using message='price_period_not_found'; end if;
    if p_expected_revision is null or previous.revision<>p_expected_revision then
      raise sqlstate 'PT409' using message='price_period_changed';
    end if;
    if previous.state<>'draft' then next_regular:=previous.regular_price; end if;
    update private.goods_variant_price_periods set state=next_state,regular_price=next_regular,
      discount_price=next_price,starts_at=next_start,ends_at=next_end,revision=revision+1,
      updated_by=auth.uid(),updated_at=clock_timestamp()
    where id=p_period_id returning * into saved;
  else
    if p_expected_revision is not null then raise check_violation using message='invalid_price_period'; end if;
    insert into private.goods_variant_price_periods(good_id,variant_id,state,regular_price,discount_price,starts_at,ends_at,created_by,updated_by)
    values(p_good_id,p_variant_id,next_state,next_regular,next_price,next_start,next_end,auth.uid(),auth.uid())
    returning * into saved;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'admin.good.price_period_saved','goods:'||p_good_id,
    jsonb_build_object('before',case when previous.id is null then null else to_jsonb(previous) end,'after',to_jsonb(saved)));
  return jsonb_build_object('id',saved.id,'revision',saved.revision,
    'ipId',(select ip_id from public.goods where id=p_good_id));
end $$;
revoke all on function public.admin_save_goods_price_period(text,uuid,uuid,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_price_period(text,uuid,uuid,jsonb,integer) to authenticated;

-- Keep the existing public save/import seam atomic. Omitted fields are preserved;
-- disabled numeric drafts are retained but never evaluated as active limits.
alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_sales_policy;
revoke all on function private.admin_save_good_before_sales_policy(jsonb) from public,anon,authenticated,service_role;
create function public.admin_save_good(target_good jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb; previous public.goods; next_good public.goods; field text; before_policy jsonb; after_policy jsonb;
  owned_payload jsonb; initial_controls jsonb; existing_id text;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
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
  saved:=private.admin_save_good_before_sales_policy(case when target_good->>'publish' in ('true','false')
    then target_good||'{"publish":null}'::jsonb else target_good end);
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
  if target_good->>'publish' in ('true','false') then
    perform public.admin_set_good_published(saved->>'id',(target_good->>'publish')::boolean);
  end if;
  return saved;
end $$;
revoke all on function public.admin_save_good(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;

-- Orders are the reservation ledger. Existing historical item quantities participate
-- immediately when a limit is activated. Pending (including expired/ambiguous PG)
-- counts until the existing verified whole-order cancellation writer marks canceled.
create function private.member_goods_reserved_qty(p_user_id uuid,p_good_id text)
returns bigint language sql stable security definer set search_path='' as $$
  select coalesce(sum(item.qty::bigint),0)
  from public.order_items item join public.orders orders on orders.id=item.order_id
  where orders.user_id=p_user_id and item.good_id=p_good_id and orders.status<>'canceled';
$$;
revoke all on function private.member_goods_reserved_qty(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.member_goods_reserved_qty(uuid,text) to postgres;

create function private.check_goods_purchase_quantity(p_good public.goods,p_user_id uuid,p_qty bigint,p_check_minimum boolean)
returns text language sql stable security definer set search_path='' as $$
  select case
    when p_good.order_quantity_limit_enabled and (p_good.min_order_qty is null or p_good.max_order_qty is null)
      then 'purchase_limit_not_configured'
    when p_good.member_purchase_limit_enabled and p_good.member_lifetime_qty_limit is null
      then 'purchase_limit_not_configured'
    when p_good.order_quantity_limit_enabled and p_check_minimum and p_qty<p_good.min_order_qty
      then 'order_quantity_below_minimum'
    when p_good.order_quantity_limit_enabled and p_qty>p_good.max_order_qty
      then 'order_quantity_above_maximum'
    when p_good.member_purchase_limit_enabled and p_user_id is not null
      and private.member_goods_reserved_qty(p_user_id,p_good.id)+p_qty>p_good.member_lifetime_qty_limit
      then 'member_purchase_limit_exceeded'
    else null end;
$$;
revoke all on function private.check_goods_purchase_quantity(public.goods,uuid,bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function private.check_goods_purchase_quantity(public.goods,uuid,bigint,boolean) to postgres;

-- New orders only: known current regular/effective amounts and offer identity.
-- Existing snapshots intentionally remain NULL because their former regular price
-- was never recorded. No export may backfill them from today's catalog.
alter table public.order_items
  add column regular_unit_price_snapshot integer check (regular_unit_price_snapshot is null or regular_unit_price_snapshot>=0),
  add column price_period_id uuid references private.goods_variant_price_periods(id),
  add column price_evaluated_at timestamptz,
  add column sales_policy_snapshot jsonb;

create or replace function private.cart_subtotal(p_user_id uuid)
returns bigint language sql stable set search_path='' as $$
  select coalesce(sum(cart.qty::bigint * price.effective_price::bigint),0)
  from public.cart_items cart
  join public.goods_variants variant on variant.id=cart.variant_id and variant.good_id=cart.good_id and variant.archived_at is null
  join public.goods good on good.id=cart.good_id and good.archived_at is null and good.published_at is not null and good.sale_restriction='none'
  join public.ips ip on ip.id=good.ip_id and ip.archived_at is null and ip.published_at is not null
  cross join lateral private.resolve_goods_variant_price(variant.id,statement_timestamp()) price
  where cart.user_id=p_user_id;
$$;
revoke all on function private.cart_subtotal(uuid) from public,anon,authenticated,service_role;

-- Replace the authoritative writer, keeping its existing wrapper and grants.
CREATE OR REPLACE FUNCTION private.place_order_before_shipments(p_address jsonb, p_checkout_key uuid, p_payment_method order_payment_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  -- 결제사 최소 결제액(20260813242000 가드·lib/coupons.ts MIN_PAYABLE_TOTAL와 동치).
  -- 할인이 총액을 이 밑으로 내리면 가드가 주문 전체를 롤백하므로, 여기서 캡한다.
  c_min_payable_total constant bigint := 1000;
  v_user uuid := (select auth.uid());
  v_order uuid;
  v_existing_address jsonb;
  v_existing_payment_method public.order_payment_method;
  v_expires_at timestamptz;
  v_subtotal bigint := 0;
  v_shipping_fee bigint := 0;
  v_item_count integer := 0;
  v_recipient_name text;
  v_phone text;
  v_postal_code text;
  v_address1 text;
  v_optional text;
  v_selected_coupon uuid;
  v_coupon_eval record;
  v_discount bigint := 0;
  r record;
  v_variant public.goods_variants;
  v_price record;
  v_price_at timestamptz;
  v_limit_good public.goods;
  v_good_qty bigint;
  v_last_good_id text;
  v_quantity_error text;
begin
  if v_user is null then
    raise insufficient_privilege using message = 'auth required';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where profile.id = v_user
      and nullif(btrim(coalesce(profile.email, auth_user.email)), '') is not null
      and nullif(btrim(profile.nickname), '') is not null
      and profile.birth_date is not null
      and profile.birth_date <= current_date
      and profile.onboarded_at is not null
      and profile.consents ->> 'terms' = 'true'
      and profile.consents ->> 'privacy' = 'true'
  ) then
    raise insufficient_privilege using message = 'onboarding required';
  end if;

  if p_checkout_key is null then
    raise not_null_violation using message = 'checkout key required';
  end if;

  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    raise check_violation using message = 'invalid checkout address';
  end if;

  if not (p_address ?& array['recipientName', 'phone', 'postalCode', 'address1'])
     or exists (
       select 1
       from jsonb_object_keys(p_address) as address_key(key)
       where address_key.key not in (
         'recipientName', 'phone', 'postalCode', 'address1', 'address2', 'deliveryNote'
       )
     )
     or exists (
       select 1
       from jsonb_each(p_address) as address_value(key, value)
       where jsonb_typeof(address_value.value) <> 'string'
     ) then
    raise check_violation using message = 'invalid checkout address';
  end if;

  v_recipient_name := p_address ->> 'recipientName';
  v_phone := p_address ->> 'phone';
  v_postal_code := p_address ->> 'postalCode';
  v_address1 := p_address ->> 'address1';

  if v_recipient_name <> btrim(v_recipient_name, E' \t\n\r\f\v')
     or length(v_recipient_name) not between 1 and 50
     or v_phone !~ '^[0-9]{8,15}$'
     or v_postal_code !~ '^[0-9]{5}$'
     or v_address1 <> btrim(v_address1, E' \t\n\r\f\v')
     or length(v_address1) not between 1 and 200 then
    raise check_violation using message = 'invalid checkout address';
  end if;

  if p_address ? 'address2' then
    v_optional := p_address ->> 'address2';
    if v_optional <> btrim(v_optional, E' \t\n\r\f\v') or length(v_optional) > 200 then
      raise check_violation using message = 'invalid checkout address';
    end if;
  end if;

  if p_address ? 'deliveryNote' then
    v_optional := p_address ->> 'deliveryNote';
    if v_optional <> btrim(v_optional, E' \t\n\r\f\v') or length(v_optional) > 200 then
      raise check_violation using message = 'invalid checkout address';
    end if;
  end if;

  -- 같은 사용자의 다른 탭 주문을 직렬화한다. 동일 키 재시도는 먼저 생성된
  -- 주문을 반환하고, 다른 키는 첫 주문이 비운 장바구니를 확인하게 된다.
  -- 쿠폰 적용·해제도 같은 잠금을 잡으므로 선택 교체와 소비가 경합하지 않는다.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select orders.id, orders.address, orders.payment_method
    into v_order, v_existing_address, v_existing_payment_method
  from public.orders
  where orders.user_id = v_user
    and orders.checkout_key = p_checkout_key;

  if found then
    -- 같은 checkout key로 결제수단만 바꿔 다시 부르면 24시간 선점을 15분 주문에
    -- 덧씌우거나 그 반대가 된다. 주소와 같은 등급의 충돌로 막는다.
    if v_existing_address is distinct from p_address
      or v_existing_payment_method is distinct from p_payment_method
    then
      raise unique_violation using message = 'checkout key conflict';
    end if;
    return v_order;
  end if;

  if p_payment_method is null then
    raise invalid_parameter_value using message='payment method required';
  end if;

  -- 카드 15분 · 무통장 24시간. 무통장은 사람이 은행 앱을 열고 이체할 시간을
  -- 줘야 해서 선점 창이 길고, 그만큼 재고가 오래 묶인다 — 한정 드롭은
  -- goods.allow_bank_transfer로 아예 차단한다(ADR-0007).
  v_expires_at := case
    when p_payment_method = 'bank_transfer' then now() + interval '24 hours'
    else now() + interval '15 minutes'
  end;

  insert into public.orders (
    user_id, status, total, shipping_fee, address, expires_at, checkout_key, payment_method
  )
  values (v_user, 'pending', 0, 0, p_address, v_expires_at, p_checkout_key, p_payment_method)
  returning id into v_order;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cart:'||v_user::text,0));
  -- This timestamp is fixed after the member/cart locks. Waiting for a competing
  -- checkout cannot select a stale pre-lock clock value. Each order has one price
  -- boundary, including all its coupon and shipping calculations.
  v_price_at:=clock_timestamp();
  -- Parent goods are locked before their selected options and cache updates.
  for r in
    select
      cart.good_id,
      cart.variant_id,
      cart.qty,
      good.price,
      good.stock,
      good.stock_qty,
      good.name,
      good.type,
      good.ip_id,
      good.allow_bank_transfer,
      good.allow_card_payment,
      good.sale_restriction,
      good.published_at,
      good.archived_at
    from public.cart_items as cart
    join public.goods as good on good.id = cart.good_id
    where cart.user_id = v_user
    order by cart.good_id, cart.variant_id
    for update of cart, good
  loop
    -- The locked good fixes its parent association. Keep the IP SHARE lock until
    -- this order commits, serializing new purchases with an unpublish UPDATE.
    perform private.assert_ip_purchasable(r.ip_id);
    if r.published_at is null or r.archived_at is not null then
      raise check_violation using message='catalog_item_unavailable';
    end if;
    select * into v_variant from public.goods_variants where id=r.variant_id and good_id=r.good_id for update;
    if not found or v_variant.archived_at is not null then raise check_violation using message='catalog_item_unavailable'; end if;
    v_item_count := v_item_count + 1;

    -- Cart has one row per option. Check a good only before its first row is
    -- consumed, summing every selected option and any optional add-on of it.
    if v_last_good_id is distinct from r.good_id then
      select * into v_limit_good from public.goods where id=r.good_id;
      select sum(qty::bigint) into v_good_qty from public.cart_items where user_id=v_user and good_id=r.good_id;
      v_quantity_error:=private.check_goods_purchase_quantity(v_limit_good,v_user,v_good_qty,true);
      if v_quantity_error is not null then
        raise check_violation using message=v_quantity_error||': '||r.good_id;
      end if;
      v_last_good_id:=r.good_id;
    end if;
    select * into v_price from private.resolve_goods_variant_price(v_variant.id,v_price_at);


    if r.stock = 'soldout' or v_variant.stock_qty < r.qty then
      raise check_violation using message = format('out of stock: %s', r.good_id);
    end if;

    if p_payment_method = 'card' and not r.allow_card_payment then
      raise check_violation using message=format('card payment blocked: %s',r.good_id);
    end if;

    if p_payment_method = 'bank_transfer' and not r.allow_bank_transfer then
      raise check_violation using message = format('bank transfer blocked: %s', r.good_id);
    end if;

    -- 성인인증(#209·#210)이 도입되기 전까지 판매 제한 상품은 서버가 구매를
    -- 차단한다. 결제수단과 무관한 상품 축이라 무통장 검사와 별개로 판정한다.
    if r.sale_restriction <> 'none' then
      raise check_violation using message = format('restricted good blocked: %s', r.good_id);
    end if;

    perform private.change_goods_variant_stock(r.good_id, r.variant_id, -r.qty::bigint);

    insert into public.order_items (
      order_id,
      good_id,
      variant_id,
      qty,
      unit_price,
      good_name_snapshot,
      good_type_snapshot,
      good_ip_id_snapshot,
      regular_unit_price_snapshot,
      price_period_id,
      price_evaluated_at,
      sales_policy_snapshot
    )
    values (
      v_order,
      r.good_id,
      r.variant_id,
      r.qty,
      v_price.effective_price,
      r.name,
      r.type,
      r.ip_id,
      v_price.regular_price,
      v_price.price_period_id,
      v_price_at,
      jsonb_build_object('version',1,'allowCardPayment',r.allow_card_payment,'allowBankTransfer',r.allow_bank_transfer,
        'orderQuantityLimitEnabled',v_limit_good.order_quantity_limit_enabled,
        'minOrderQty',v_limit_good.min_order_qty,'maxOrderQty',v_limit_good.max_order_qty,
        'memberPurchaseLimitEnabled',v_limit_good.member_purchase_limit_enabled,
        'memberLifetimeQtyLimit',v_limit_good.member_lifetime_qty_limit)
    );

    -- 조회 시 잠근 스냅샷 행만 지운다. 동시에 새로 담긴 다른 상품까지
    -- 마지막 broad delete가 없애지 않도록 상품 단위로 소비한다.
    delete from public.cart_items
    where user_id = v_user
      and good_id = r.good_id and variant_id = r.variant_id;

    v_subtotal := v_subtotal + (v_price.effective_price::bigint * r.qty::bigint);
  end loop;

  if v_item_count = 0 then
    raise check_violation using message = 'cart empty';
  end if;

  -- Shipping uses the period-adjusted item subtotal before coupon/credit deductions.
  -- Its order-item inputs already contain the immutable effective price.
  v_shipping_fee := private.goods_shipping_fee_for(v_order);

  -- 카트에 적용해 둔 쿠폰을 여기서 최종 검증하고 소비한다. 조건 미달이면 주문
  -- 전체를 거부한다 — 할인을 기대한 사용자를 조용히 정가로 결제시키지 않는다.
  select selection.user_coupon_id
  into v_selected_coupon
  from public.cart_coupon_selections as selection
  where selection.user_id = v_user;

  if v_selected_coupon is not null then
    -- 상태 전이 전에 보유 행을 잠근다. 같은 유저는 advisory lock으로 이미
    -- 직렬화되어 있고, 이 잠금은 향후 다른 경로가 생겨도 이중 사용을 막는 안전벨트다.
    perform held.id
    from public.user_coupons as held
    where held.id = v_selected_coupon
    for update;

    select * into v_coupon_eval
    from private.evaluate_user_coupon(v_selected_coupon, v_user, v_subtotal);
    if v_coupon_eval.o_reason is not null then
      raise check_violation using message = v_coupon_eval.o_reason;
    end if;
    -- 결제사 최소 결제액을 지키도록 할인을 캡한다 — 전액 쿠폰이 주문을
    -- 결제 불가(총액 < 1,000원)로 만들면 혜택이 주문 실패로 둔갑한다.
    v_discount := least(
      v_coupon_eval.o_discount,
      greatest(0, v_subtotal + v_shipping_fee - c_min_payable_total)
    );

    update public.user_coupons
    set status = 'used',
        used_at = now(),
        used_order_id = v_order
    where id = v_selected_coupon;

    insert into public.coupon_redemptions (
      user_coupon_id, coupon_code, user_id, order_id, discount_amount
    )
    values (
      v_selected_coupon, v_coupon_eval.o_coupon_code, v_user, v_order, v_discount
    );

    -- 소비한 선택만 지운다. 주문 진행 중 다른 탭이 교체한 새 선택은 남는다.
    delete from public.cart_coupon_selections
    where user_id = v_user
      and user_coupon_id = v_selected_coupon;
  end if;

  update public.orders
  set total = v_subtotal + v_shipping_fee - v_discount,
      shipping_fee = v_shipping_fee,
      discount_total = v_discount
  where id = v_order;

  -- 무통장에는 결제사 왕복이 없다. 그래서 원장 anchor(payment_attempts)를 여기서
  -- 바로 연다 — 없으면 운영자가 입금을 확인할 대상 자체가 없고, "결제 준비" 버튼을
  -- 눌러야 생기는 구조는 구매자가 이미 이체한 뒤에도 확인이 안 되는 창을 만든다.
  -- 새 함수를 두지 않고 카드와 같은 prepare를 부른다: 소유권·금액·스냅샷·정지
  -- 계정 검사가 한 곳에만 있어야 한다.
  if p_payment_method = 'bank_transfer' then
    perform public.prepare_goods_payment_attempt(v_user, v_order, 'bank_transfer');
  end if;

  -- 무통장 주문은 만든 순간이 안내 시점이다. 금액·입금자명 코드·기한이 모두
  -- 정해졌고, 이 알림을 놓치면 구매자는 어디로 얼마를 보낼지 알 수 없다.
  if p_payment_method = 'bank_transfer' then
    insert into public.notifications (
      user_id, type, title, body, link_path, source_type, source_id, dedupe_key
    )
    values (
      v_user,
      'order_bank_transfer_pending',
      '입금 안내를 확인해주세요',
      format(
        '%s원을 기한 안에 입금해주세요. 입금자명 끝에 주문코드 %s를 붙이면 확인이 빨라집니다.',
        to_char(v_subtotal + v_shipping_fee - v_discount, 'FM999,999,999'),
        private.bank_transfer_deposit_code(v_order)
      ),
      '/checkout/' || v_order::text,
      'order',
      v_order::text,
      'order:bank_transfer_pending:' || v_order::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  return v_order;
end;
$function$;
revoke all on function private.place_order_before_shipments(jsonb,uuid,public.order_payment_method) from public,anon,authenticated,service_role;

-- #443: shipping quotes require the same explicit option identity as cart/order writes.
CREATE OR REPLACE FUNCTION public.quote_goods_shipping(items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare input record; good public.goods; variant public.goods_variants; line_qty integer; variant_key uuid; lines jsonb:='[]';
begin
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>1000 then
    raise invalid_parameter_value using message='invalid_shipping_quote_items';
  end if;
  for input in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(input.value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(input.value) k where k not in ('goodId','variantId','qty'))
      or jsonb_typeof(input.value->'qty') is distinct from 'number'
      or jsonb_typeof(input.value->'variantId') is distinct from 'string'
      or (input.value->>'variantId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise invalid_parameter_value using message='invalid_shipping_quote_items'; end if;
    line_qty:=(input.value->>'qty')::integer;
    if line_qty not between 1 and 2147483647 then raise invalid_parameter_value using message='invalid_shipping_quote_items'; end if;
    select g.* into good from public.goods g join public.ips ip on ip.id=g.ip_id
      join public.fulfillment_origins origin on origin.id=g.origin_id and origin.is_active
      where g.id=input.value->>'goodId' and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
        and ip.archived_at is null and ip.published_at is not null;
    if not found then raise check_violation using message='shipping_quote_good_unavailable'; end if;
    variant_key:=(input.value->>'variantId')::uuid;
    select v.* into variant from public.goods_variants v where v.good_id=good.id and v.archived_at is null
      and v.id=variant_key;
    if not found then raise check_violation using message='shipping_quote_variant_unavailable'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('origin_id',good.origin_id,'good_id',good.id,'qty',line_qty,
      'unit_price',(select effective_price from private.resolve_goods_variant_price(variant.id,statement_timestamp())),'fee_type',good.shipping_fee_type,'individual_fee',good.individual_fee));
  end loop;
  return private.calculate_goods_shipping(lines);
end $function$;

revoke all on function public.quote_goods_shipping(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.quote_goods_shipping(jsonb) to anon, authenticated;

-- Public/cart advisory quote. Member history is always derived from auth.uid();
-- there is no customer-supplied user id. It does not reserve or release anything.
create function public.quote_goods_sales(items jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  input record;
  line record;
  good public.goods;
  variant public.goods_variants;
  price record;
  normalized jsonb:='[]';
  quoted_lines jsonb:='[]';
  quoted_goods jsonb:='[]';
  at_time timestamptz:=statement_timestamp();
  actor uuid:=auth.uid();
  subtotal bigint:=0;
  card_allowed boolean:=true;
  bank_allowed boolean:=true;
  reserved_qty bigint;
  quantity_error text;
begin
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>1000 then
    raise invalid_parameter_value using message='invalid_sales_quote_items';
  end if;
  for input in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(input.value) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(input.value) key where key not in ('goodId','variantId','qty'))
      or jsonb_typeof(input.value->'goodId') is distinct from 'string'
      or nullif(btrim(input.value->>'goodId'),'') is null
      or jsonb_typeof(input.value->'variantId') is distinct from 'string'
      or input.value->>'variantId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(input.value->'qty') is distinct from 'number'
      or input.value->>'qty' !~ '^[1-9][0-9]*$' then
      raise invalid_parameter_value using message='invalid_sales_quote_items';
    end if;
    if (input.value->>'qty')::numeric>2147483647 then
      raise invalid_parameter_value using message='invalid_sales_quote_items';
    end if;
    normalized:=normalized||jsonb_build_array(jsonb_build_object('good_id',input.value->>'goodId',
      'variant_id',(input.value->>'variantId')::uuid,'qty',(input.value->>'qty')::integer));
  end loop;
  for line in select good_id,variant_id,sum(qty::bigint)::bigint qty
    from jsonb_to_recordset(normalized) as item(good_id text,variant_id uuid,qty integer)
    group by good_id,variant_id order by good_id,variant_id
  loop
    select g.* into good from public.goods g join public.ips ip on ip.id=g.ip_id
      where g.id=line.good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
        and ip.archived_at is null and ip.published_at is not null;
    if not found then raise check_violation using message='sales_quote_good_unavailable'; end if;
    select * into variant from public.goods_variants
      where id=line.variant_id and good_id=good.id and archived_at is null;
    if not found then raise check_violation using message='sales_quote_variant_unavailable'; end if;
    select * into price from private.resolve_goods_variant_price(variant.id,at_time);
    quoted_lines:=quoted_lines||jsonb_build_array(jsonb_build_object('goodId',good.id,'variantId',variant.id,'qty',line.qty,
      'regularPrice',price.regular_price,'effectivePrice',price.effective_price,'pricePeriodId',price.price_period_id,
      'startsAt',price.starts_at,'endsAt',price.ends_at,'available',good.stock<>'soldout' and line.qty<=variant.stock_qty));
    subtotal:=subtotal+line.qty*price.effective_price::bigint;
    card_allowed:=card_allowed and good.allow_card_payment;
    bank_allowed:=bank_allowed and good.allow_bank_transfer;
  end loop;
  for line in select good_id,sum(qty::bigint)::bigint qty
    from jsonb_to_recordset(normalized) as item(good_id text,variant_id uuid,qty integer)
    group by good_id order by good_id
  loop
    select * into good from public.goods where id=line.good_id;
    reserved_qty:=case when actor is null then null else private.member_goods_reserved_qty(actor,good.id) end;
    quantity_error:=private.check_goods_purchase_quantity(good,actor,line.qty,true);
    quoted_goods:=quoted_goods||jsonb_build_array(jsonb_build_object('goodId',good.id,'qty',line.qty,
      'orderQuantityLimitEnabled',good.order_quantity_limit_enabled,'minOrderQty',good.min_order_qty,'maxOrderQty',good.max_order_qty,
      'memberPurchaseLimitEnabled',good.member_purchase_limit_enabled,'memberLifetimeQtyLimit',good.member_lifetime_qty_limit,
      'memberReservedQty',reserved_qty,'memberRemainingQty',case when not good.member_purchase_limit_enabled or actor is null
        then null else greatest(0,good.member_lifetime_qty_limit::bigint-reserved_qty) end,'reason',quantity_error));
  end loop;
  return jsonb_build_object('calculatedAt',at_time,'subtotal',subtotal,'lines',quoted_lines,'goods',quoted_goods,
    'shipping',public.quote_goods_shipping(items),
    'nextChangeAt',(select min(boundary.change_at) from private.goods_variant_price_periods schedule
      cross join lateral (values(schedule.starts_at),(schedule.ends_at)) boundary(change_at)
      where schedule.state='active' and boundary.change_at>at_time
        and schedule.variant_id in (select (value->>'variant_id')::uuid from jsonb_array_elements(normalized))),
    'paymentMethods',jsonb_build_object('card',card_allowed and jsonb_array_length(normalized)>0,
      'bankTransfer',bank_allowed and jsonb_array_length(normalized)>0));
end $$;
revoke all on function public.quote_goods_sales(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quote_goods_sales(jsonb) to anon,authenticated;

-- A closed payment-method intersection must not announce a purchasable drop or
-- consume a pending restock subscription during the existing stock/publication flow.
CREATE OR REPLACE FUNCTION private.notify_good_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.published_at is null or new.archived_at is not null or new.sale_restriction<>'none'
    or not (new.allow_card_payment or new.allow_bank_transfer)
    or not exists(select 1 from public.ips where id=new.ip_id and published_at is not null and archived_at is null) then return new; end if;
  if tg_op='UPDATE' and old.published_at is not null then return new; end if;
  if (select auth.uid()) is null or not (select public.is_staff()) then
    return new;
  end if;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    link_path,
    source_type,
    source_id,
    dedupe_key
  )
  select
    follow.user_id,
    'drop_published',
    '새 굿즈가 공개됐어요',
    left(new.name || ' 굿즈가 공개됐습니다.', 500),
    '/shop',
    'good',
    new.id,
    'good:' || pg_catalog.encode(
      extensions.digest(new.id, 'sha256'),
      'hex'
    )
  from public.ip_follows as follow
  where follow.ip_id = new.ip_id
    and follow.notify_drops
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$function$;
revoke all on function private.notify_good_insert() from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.notify_goods_restock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- 판매 가능 술어가 거짓→참으로 전이할 때만 발화한다.
  if not (
    new.archived_at is null
    and new.published_at is not null
    and new.sale_restriction='none'
    and (new.allow_card_payment or new.allow_bank_transfer)
    and exists(select 1 from public.ips where id=new.ip_id and published_at is not null and archived_at is null)
    and new.stock <> 'soldout'
    and new.stock_qty > 0
  ) or (
    old.archived_at is null
    and old.published_at is not null
    and old.sale_restriction='none'
    and (old.allow_card_payment or old.allow_bank_transfer)
    and old.stock <> 'soldout'
    and old.stock_qty > 0
  ) then
    return new;
  end if;

  with flipped as (
    update public.restock_alerts
    set status = 'notified', notified_at = now()
    where good_id = new.id and status = 'pending'
    returning user_id
  )
  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    link_path,
    source_type,
    source_id,
    dedupe_key
  )
  select
    flipped.user_id,
    'restock_available',
    '재입고 알림',
    left(new.name || ' 굿즈가 다시 판매를 시작했어요.', 500),
    '/shop/' || new.id,
    'good',
    new.id,
    -- 재신청→재품절→재입고 사이클마다 새 알림이어야 하므로 시각을 키에 넣는다.
    -- now() 는 트랜잭션 시작에 고정되어 같은 트랜잭션(또는 같은 초)의 두 사이클이
    -- 충돌하므로, 문장 시각(clock_timestamp) 밀리초로 사이클을 구분한다.
    'restock:' || new.id || ':'
      || (extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint::text
  from flipped
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$function$;
revoke all on function private.notify_goods_restock() from public,anon,authenticated,service_role;
