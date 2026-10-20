-- General-stock selling windows are separate from option discounts and preorder
-- supply. Public browsing stays available; only new purchase entry points close.
alter table public.goods
 add column sale_starts_at timestamptz,
 add column sale_ends_at timestamptz,
 add column sale_period_revision integer not null default 0 check(sale_period_revision>=0),
 add constraint goods_sale_period_bounds check(
  (sale_starts_at is null and sale_ends_at is null)
  or (sale_starts_at is not null and sale_ends_at is not null and isfinite(sale_starts_at)
   and isfinite(sale_ends_at) and sale_starts_at<sale_ends_at));

create function private.goods_sale_period_json(good public.goods,p_at timestamptz) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('startsAt',good.sale_starts_at,'endsAt',good.sale_ends_at,
  'state',case when good.sale_starts_at is null then 'unlimited' when p_at<good.sale_starts_at then 'scheduled'
   when p_at>=good.sale_ends_at then 'ended' else 'open' end,
  'calculatedAt',p_at,'nextChangeAt',case when p_at<good.sale_starts_at then good.sale_starts_at
   when p_at<good.sale_ends_at then good.sale_ends_at else null end);
$$;
revoke all on function private.goods_sale_period_json(public.goods,timestamptz) from public,anon,authenticated,service_role;

create function public.goods_sale_period(good public.goods) returns jsonb
language sql stable security definer set search_path='' as $$
 select private.goods_sale_period_json(current_good,statement_timestamp())
 from public.goods current_good join public.ips ip on ip.id=current_good.ip_id
 where current_good.id=good.id and current_good.published_at is not null and current_good.archived_at is null
  and current_good.sale_restriction='none' and ip.published_at is not null and ip.archived_at is null;
$$;
revoke all on function public.goods_sale_period(public.goods) from public,anon,authenticated,service_role;
grant execute on function public.goods_sale_period(public.goods) to anon,authenticated;

create function private.guard_goods_sale_period() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.sale_starts_at is not null and exists(select 1 from public.goods_variants v
  where v.good_id=new.id and v.archived_at is null and v.preorder_policy_id is not null) then
  raise check_violation using message='goods_sale_period_preorder_conflict';end if;
 if tg_op='UPDATE' then
  new.sale_period_revision:=old.sale_period_revision+case when new.sale_starts_at is distinct from old.sale_starts_at
   or new.sale_ends_at is distinct from old.sale_ends_at then 1 else 0 end;
 end if;
 return new;
end $$;
revoke all on function private.guard_goods_sale_period() from public,anon,authenticated,service_role;
create trigger goods_sale_period_guard before insert or update of sale_starts_at,sale_ends_at,sale_period_revision
 on public.goods for each row execute function private.guard_goods_sale_period();

create function private.guard_preorder_sale_period() returns trigger
language plpgsql security definer set search_path='' as $$
declare starts timestamptz;begin
 if new.preorder_policy_id is not null and new.archived_at is null then
  select sale_starts_at into starts from public.goods where id=new.good_id for share;
  if starts is not null then raise check_violation using message='goods_sale_period_preorder_conflict';end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_preorder_sale_period() from public,anon,authenticated,service_role;
create trigger preorder_sale_period_guard before insert or update of preorder_policy_id,good_id,archived_at
 on public.goods_variants for each row execute function private.guard_preorder_sale_period();

-- The existing complete product transaction still owns pricing, options, stock,
-- KC, publication and drafts. Omitted fields preserve an older client's window.
alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_sale_period;
revoke all on function private.admin_save_good_before_sale_period(jsonb) from public,anon,authenticated,service_role;
create function public.admin_save_good(target_good jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare previous public.goods; saved jsonb; bounds jsonb; starts timestamptz; ends timestamptz;
 expected integer; saved_revision integer; changed boolean;
begin
 perform private.require_operator_capability('catalog.manage',false);
 if jsonb_typeof(target_good) is distinct from 'object' then raise invalid_parameter_value using message='invalid_good';end if;
 if not target_good ? 'sale_period' then return private.admin_save_good_before_sale_period(target_good);end if;
 bounds:=target_good->'sale_period';
 if jsonb_typeof(bounds) is distinct from 'object' or not bounds ?& array['startsAt','endsAt','expectedRevision']
  or (select count(*) from jsonb_object_keys(bounds))<>3
  or jsonb_typeof(bounds->'expectedRevision') is distinct from 'number' or bounds->>'expectedRevision' !~ '^(0|[1-9][0-9]*)$'
  or (bounds->>'expectedRevision')::numeric>2147483647 then raise check_violation using message='invalid_goods_sale_period';end if;
 expected:=(bounds->>'expectedRevision')::integer;
 if bounds->'startsAt'<>'null'::jsonb or bounds->'endsAt'<>'null'::jsonb then
  if jsonb_typeof(bounds->'startsAt') is distinct from 'string' or jsonb_typeof(bounds->'endsAt') is distinct from 'string'
   or bounds->>'startsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' or bounds->>'endsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' then
   raise check_violation using message='invalid_goods_sale_period';end if;
  begin starts:=(bounds->>'startsAt')::timestamptz;ends:=(bounds->>'endsAt')::timestamptz;
  exception when others then raise check_violation using message='invalid_goods_sale_period';end;
  if not isfinite(starts) or not isfinite(ends) or starts>=ends then raise check_violation using message='invalid_goods_sale_period';end if;
 end if;
 -- Same lock order as the delegated product editor, including category edits.
 perform private.lock_catalog_category_tree();
 select * into previous from public.goods where id=coalesce(nullif(target_good->>'previous_id',''),target_good->>'id') for update;
 if coalesce(previous.sale_period_revision,0)<>expected then raise sqlstate 'PT409' using message='goods_sale_period_changed';end if;
 saved:=private.admin_save_good_before_sale_period(target_good-'sale_period');
 changed:=previous.sale_starts_at is distinct from starts or previous.sale_ends_at is distinct from ends;
 update public.goods set sale_starts_at=starts,sale_ends_at=ends where id=saved->>'id'
  returning sale_period_revision into saved_revision;
 if changed then insert into public.audit_log(actor_id,action,target,diff)
  values(auth.uid(),'catalog.goods_sale_period_saved','goods:'||(saved->>'id'),
   jsonb_build_object('before',jsonb_build_object('startsAt',previous.sale_starts_at,'endsAt',previous.sale_ends_at),
    'after',jsonb_build_object('startsAt',starts,'endsAt',ends),'revision',saved_revision));end if;
 return saved||jsonb_build_object('salePeriodRevision',saved_revision);
end $$;
revoke all on function public.admin_save_good(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;

-- Future stock availability is a derived quantity; physical inventory and the
-- manual sold-out switch are never overwritten by the clock.
create or replace function private.resolve_goods_variant_supply(p_variant_id uuid,p_at timestamptz)
returns table(mode text,available_qty integer,policy_id uuid,policy_revision integer,state text,
 starts_at timestamptz,ends_at timestamptz,expected_ship_date date,next_change_at timestamptz)
language plpgsql stable security invoker set search_path='' as $$
declare variant public.goods_variants; policy private.goods_preorder_policies; good public.goods;
begin
 select * into variant from public.goods_variants where id=p_variant_id;
 if not found then raise no_data_found using message='goods_variant_not_found';end if;
 if p_at is null then raise invalid_parameter_value using message='supply_time_required';end if;
 if variant.preorder_policy_id is null then
  select * into good from public.goods where id=variant.good_id;
  return query select 'stock'::text,case when variant.archived_at is null
   and (good.sale_starts_at is null or p_at>=good.sale_starts_at and p_at<good.sale_ends_at) then variant.stock_qty else 0 end,
   null::uuid,null::integer,'stock'::text,null::timestamptz,null::timestamptz,null::date,
   case when p_at<good.sale_starts_at then good.sale_starts_at when p_at<good.sale_ends_at then good.sale_ends_at else null end;
  return;
 end if;
 select * into policy from private.goods_preorder_policies where id=variant.preorder_policy_id and variant_id=variant.id;
 if not found or policy.state='draft' then raise check_violation using message='preorder_policy_not_configured';end if;
 return query select 'preorder'::text,
  case when variant.archived_at is null and policy.state='active' and p_at>=policy.starts_at and p_at<policy.ends_at
   then private.goods_preorder_remaining(policy.id) else 0 end,
  policy.id,policy.revision,case when policy.state='stopped' then 'stopped' when p_at<policy.starts_at then 'scheduled'
   when p_at>=policy.ends_at then 'closed' else 'open' end,policy.starts_at,policy.ends_at,policy.expected_ship_date,
  case when policy.state<>'active' then null when p_at<policy.starts_at then policy.starts_at when p_at<policy.ends_at then policy.ends_at else null end;
end $$;
revoke all on function private.resolve_goods_variant_supply(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.resolve_goods_variant_supply(uuid,timestamptz) to postgres;

create function private.assert_goods_sale_period(p_good_id text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare good public.goods;current_at timestamptz;begin
 -- Wait for a competing editor before reading actual time; transaction/statement
 -- timestamps can still be inside a period after a long row-lock wait.
 select * into good from public.goods where id=p_good_id for share;
 if not found then raise no_data_found using message='catalog_item_unavailable';end if;
 current_at:=clock_timestamp();
 if good.sale_starts_at is not null and (current_at<good.sale_starts_at or current_at>=good.sale_ends_at) then
  raise check_violation using message='goods_sale_not_open';end if;
end $$;
revoke all on function private.assert_goods_sale_period(text) from public,anon,authenticated,service_role;

create function private.guard_new_goods_sale_period() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 perform private.assert_goods_sale_period(new.good_id);
 return new;
end $$;
revoke all on function private.guard_new_goods_sale_period() from public,anon,authenticated,service_role;
create trigger cart_goods_sale_period_guard before insert or update of qty,good_id,variant_id on public.cart_items
 for each row execute function private.guard_new_goods_sale_period();
create trigger order_item_goods_sale_period_guard before insert on public.order_items
 for each row execute function private.guard_new_goods_sale_period();

create function private.assert_order_goods_sale_period(p_order_id uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare current_at timestamptz;begin
 -- Lock every product before sampling one common instant. An earlier product
 -- can expire naturally while this transaction waits for a later product lock.
 perform g.id from public.goods g where exists(select 1 from public.order_items i
  where i.order_id=p_order_id and i.good_id=g.id) order by g.id for share;
 current_at:=clock_timestamp();
 if exists(select 1 from public.order_items i join public.goods g on g.id=i.good_id
  where i.order_id=p_order_id and g.sale_starts_at is not null
   and (current_at<g.sale_starts_at or current_at>=g.sale_ends_at)) then
  raise check_violation using message='goods_sale_not_open';end if;
end $$;
revoke all on function private.assert_order_goods_sale_period(uuid) from public,anon,authenticated,service_role;

-- All public checkout overloads converge on this canonical creator. Only its
-- final new-order return is guarded; its earlier idempotent replay stays valid.
do $$declare body text;anchor text:=E'  return v_order;\nend;';begin
 body:=pg_get_functiondef('private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)'::regprocedure);
 if (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 then
  raise exception 'goods_sale_period_order_anchor_missing';end if;
 execute replace(body,anchor,E'  perform private.assert_order_goods_sale_period(v_order);\n'||anchor);
end $$;

alter function public.prepare_goods_payment_attempt(uuid,uuid,public.payment_provider) set schema private;
alter function private.prepare_goods_payment_attempt(uuid,uuid,public.payment_provider) rename to prepare_goods_payment_before_sale_period;
revoke all on function private.prepare_goods_payment_before_sale_period(uuid,uuid,public.payment_provider) from public,anon,authenticated,service_role;
create function public.prepare_goods_payment_attempt(p_user_id uuid,p_order_id uuid,p_provider public.payment_provider) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;begin
 -- Delegate first to retain all user/provider/TTL checks and the existing
 -- order -> attempt locks. A closed period rolls the prepared attempt back.
 result:=private.prepare_goods_payment_before_sale_period(p_user_id,p_order_id,p_provider);
 perform private.assert_order_goods_sale_period(p_order_id);
 return result;
end $$;
revoke all on function public.prepare_goods_payment_attempt(uuid,uuid,public.payment_provider) from public,anon,authenticated,service_role;
grant execute on function public.prepare_goods_payment_attempt(uuid,uuid,public.payment_provider) to service_role;

alter function public.claim_goods_payment_attempt(public.payment_provider,text,text,uuid) set schema private;
alter function private.claim_goods_payment_attempt(public.payment_provider,text,text,uuid) rename to claim_goods_payment_before_sale_period;
revoke all on function private.claim_goods_payment_before_sale_period(public.payment_provider,text,text,uuid) from public,anon,authenticated,service_role;
create function public.claim_goods_payment_attempt(p_provider public.payment_provider,p_provider_order_id text,p_callback_nonce_digest text,p_claim_token uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;order_id uuid;begin
 result:=private.claim_goods_payment_before_sale_period(p_provider,p_provider_order_id,p_callback_nonce_digest,p_claim_token);
 if result->>'claim_status'='claimed' then
  select ref_id into order_id from public.payment_attempts where provider=p_provider and provider_order_id=p_provider_order_id and purpose='order';
  perform private.assert_order_goods_sale_period(order_id);
 end if;
 -- Terminal/in-progress retries and all reconciliation/finalizer paths retain
 -- their original snapshot contract after money has already been approved.
 return result;
end $$;
revoke all on function public.claim_goods_payment_attempt(public.payment_provider,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_goods_payment_attempt(public.payment_provider,text,text,uuid) to service_role;

-- Extend personal draft allowlists without duplicating their image/owner/CAS rules.
do $$declare body text;begin
 body:=pg_get_functiondef('public.admin_save_goods_draft(uuid,jsonb,integer)'::regprocedure);
 if strpos(body,'''customInputsExpectedRevision'',')=0 then raise exception 'goods_draft_sale_period_anchor_missing';end if;
 body:=replace(body,'''customInputsExpectedRevision'',','''customInputsExpectedRevision'',''salePeriodEnabled'',''saleStartsAt'',''saleEndsAt'',''salePeriodRevision'',');
 execute body;
end $$;

select private.register_operator_rpc_contract('public.admin_save_good(jsonb)','catalog.manage','write',false);
select private.register_operator_internal_contract('private.admin_save_good_before_sale_period(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.goods_sale_period_json(public.goods,timestamptz)'::regprocedure);
select private.register_operator_internal_contract('public.goods_sale_period(public.goods)'::regprocedure);
select private.register_operator_internal_contract('private.guard_goods_sale_period()'::regprocedure);
select private.register_operator_internal_contract('private.guard_preorder_sale_period()'::regprocedure);
select private.register_operator_internal_contract('private.assert_goods_sale_period(text)'::regprocedure);
select private.register_operator_internal_contract('private.guard_new_goods_sale_period()'::regprocedure);
select private.register_operator_internal_contract('private.assert_order_goods_sale_period(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.prepare_goods_payment_before_sale_period(uuid,uuid,public.payment_provider)'::regprocedure);
select private.register_operator_internal_contract('private.claim_goods_payment_before_sale_period(public.payment_provider,text,text,uuid)'::regprocedure);
select private.register_operator_internal_contract('public.prepare_goods_payment_attempt(uuid,uuid,public.payment_provider)'::regprocedure);
select private.register_operator_internal_contract('public.claim_goods_payment_attempt(public.payment_provider,text,text,uuid)'::regprocedure);
notify pgrst,'reload schema';
