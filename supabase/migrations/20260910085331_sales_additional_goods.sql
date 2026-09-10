-- #482: optional, independent goods at their ordinary option prices. Relations
-- only affect the product detail selector; orders retain normal item identities.
create table private.goods_additional_sets (
  good_id text primary key references public.goods(id) on update cascade on delete cascade,
  revision integer not null check (revision>0),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id)
);
create table private.goods_additional_links (
  base_good_id text not null references private.goods_additional_sets(good_id) on update cascade on delete cascade,
  target_good_id text not null references public.goods(id) on update cascade on delete restrict,
  sort_order integer not null check (sort_order>=0 and sort_order<50),
  primary key(base_good_id,target_good_id),
  unique(base_good_id,sort_order),
  check(base_good_id<>target_good_id)
);
create index goods_additional_links_target on private.goods_additional_links(target_good_id);
revoke all on private.goods_additional_sets,private.goods_additional_links from public,anon,authenticated,service_role;
grant select,insert,update,delete on private.goods_additional_sets,private.goods_additional_links to postgres;

create function private.goods_additional_available(p_good_id text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.goods good join public.ips ip on ip.id=good.ip_id
    where good.id=p_good_id and good.published_at is not null and good.archived_at is null
      and good.sale_restriction='none' and good.stock<>'soldout'
      and (good.allow_card_payment or good.allow_bank_transfer)
      and ip.published_at is not null and ip.archived_at is null
      and exists(select 1 from public.goods_variants variant where variant.good_id=good.id
        and variant.archived_at is null and variant.stock_qty>0));
$$;
revoke all on function private.goods_additional_available(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_additional_available(text) to postgres;

create function public.goods_additional_ids(good public.goods) returns text[]
language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(link.target_good_id order by link.sort_order),'{}'::text[])
  from private.goods_additional_links link where link.base_good_id=good.id
    and private.goods_additional_available(good.id) and private.goods_additional_available(link.target_good_id);
$$;
revoke all on function public.goods_additional_ids(public.goods) from public,anon,authenticated,service_role;
grant execute on function public.goods_additional_ids(public.goods) to anon,authenticated;

create function public.admin_read_goods_additional(p_good_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  if not exists(select 1 from public.goods where id=p_good_id) then raise no_data_found using message='good_not_found'; end if;
  return jsonb_build_object('revision',(select revision from private.goods_additional_sets where good_id=p_good_id),
    'items',(select coalesce(jsonb_agg(jsonb_build_object('goodId',good.id,'name',good.name,
      'available',private.goods_additional_available(good.id)) order by link.sort_order),'[]'::jsonb)
      from private.goods_additional_links link join public.goods good on good.id=link.target_good_id where link.base_good_id=p_good_id));
end $$;
revoke all on function public.admin_read_goods_additional(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_goods_additional(text) to authenticated;

create function public.admin_search_goods_additional(p_base_good_id text,p_query text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  if length(btrim(coalesce(p_query,'')))<1 or length(p_query)>100 then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('goodId',candidate.id,'name',candidate.name,'available',true)
    order by candidate.name,candidate.id),'[]'::jsonb) from (
      select good.id,good.name from public.goods good where good.id<>p_base_good_id
        and private.goods_additional_available(good.id)
        and (good.name ilike '%'||btrim(p_query)||'%' or good.id ilike '%'||btrim(p_query)||'%')
      order by good.name,good.id limit 50) candidate);
end $$;
revoke all on function public.admin_search_goods_additional(text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_goods_additional(text,text) to authenticated;

create function public.admin_save_goods_additional(p_good_id text,p_target_good_ids text[],p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_set private.goods_additional_sets; before_ids text[]; next_revision integer; target_id text;
begin
  if not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  if p_target_good_ids is null or cardinality(p_target_good_ids)>50
    or exists(select 1 from unnest(p_target_good_ids) id where id is null or btrim(id)='' or id<>btrim(id))
    or cardinality(p_target_good_ids)<>(select count(distinct id) from unnest(p_target_good_ids) id)
    or p_good_id=any(p_target_good_ids) then raise check_violation using message='invalid_additional_goods'; end if;
  -- All graph writers take this before examining reachability, so simultaneous
  -- A -> B and B -> A saves cannot independently pass the cycle check.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('goods-additional-graph',0));
  perform 1 from public.goods where id=p_good_id and archived_at is null for key share;
  if not found then raise no_data_found using message='good_not_found'; end if;
  select * into current_set from private.goods_additional_sets where good_id=p_good_id for update;
  if current_set.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='additional_goods_changed'; end if;
  select coalesce(array_agg(target_good_id order by sort_order),'{}') into before_ids
    from private.goods_additional_links where base_good_id=p_good_id;
  if before_ids=p_target_good_ids then return jsonb_build_object('revision',current_set.revision,'changed',false); end if;
  for target_id in select id from unnest(p_target_good_ids) id order by id loop
    perform 1 from public.goods where id=target_id for key share;
    if not found or (not target_id=any(before_ids) and not private.goods_additional_available(target_id)) then
      raise check_violation using message='additional_good_unavailable';
    end if;
  end loop;
  if exists(with recursive reachable(good_id) as (
    select unnest(p_target_good_ids)
    union
    select link.target_good_id from private.goods_additional_links link
      join reachable on reachable.good_id=link.base_good_id where link.base_good_id<>p_good_id
  ) select 1 from reachable where good_id=p_good_id) then raise check_violation using message='additional_goods_cycle'; end if;
  next_revision:=coalesce(current_set.revision,0)+1;
  insert into private.goods_additional_sets(good_id,revision,updated_at,updated_by)
    values(p_good_id,next_revision,now(),auth.uid())
    on conflict(good_id) do update set revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  delete from private.goods_additional_links where base_good_id=p_good_id;
  insert into private.goods_additional_links(base_good_id,target_good_id,sort_order)
    select p_good_id,target.id,(target.ordinality-1)::integer from unnest(p_target_good_ids) with ordinality target(id,ordinality);
  insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'admin.good.additional_saved','goods:'||p_good_id,
    jsonb_build_object('before',before_ids,'after',p_target_good_ids,'revision',next_revision));
  return jsonb_build_object('revision',next_revision,'changed',true);
end $$;
revoke all on function public.admin_save_goods_additional(text,text[],integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_additional(text,text[],integer) to authenticated;

create function public.add_cart_selection(p_base_good_id text,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); item record; actual_qty integer; next_qty bigint;
begin
  if actor is null then raise insufficient_privilege using message='auth required'; end if;
  perform private.assert_active_user(actor);
  if nullif(btrim(p_base_good_id),'') is null or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>51 then raise invalid_parameter_value using message='invalid cart selection'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) line where jsonb_typeof(line)<>'object'
    or not (line ?& array['good_id','variant_id','qty','expected_qty'])
    or jsonb_typeof(line->'good_id')<>'string' or jsonb_typeof(line->'variant_id')<>'string'
    or jsonb_typeof(line->'qty')<>'number' or jsonb_typeof(line->'expected_qty')<>'number'
    or line->>'qty' !~ '^[1-9][0-9]*$' or line->>'expected_qty' !~ '^(0|[1-9][0-9]*)$') then
    raise invalid_parameter_value using message='invalid cart selection';
  end if;
  if not exists(select 1 from jsonb_to_recordset(p_items) as input(good_id text) where input.good_id=p_base_good_id)
    or exists(select 1 from jsonb_to_recordset(p_items) as input(variant_id uuid) group by variant_id having count(*)>1) then
    raise invalid_parameter_value using message='invalid cart selection';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cart:'||actor::text,0));
  -- All checks and writes happen in this transaction. The quantity comparison
  -- also prevents an uncertain response followed by a retry from adding twice.
  for item in select * from jsonb_to_recordset(p_items)
      as input(good_id text,variant_id uuid,qty integer,expected_qty integer) order by good_id,variant_id loop
    if item.good_id is null or btrim(item.good_id)='' or item.variant_id is null or item.qty<1 or item.expected_qty<0 then
      raise invalid_parameter_value using message='invalid cart selection';
    end if;
    if item.good_id<>p_base_good_id and not exists(select 1 from private.goods_additional_links
      where base_good_id=p_base_good_id and target_good_id=item.good_id) then
      raise check_violation using message='additional_good_unavailable';
    end if;
    if not private.goods_additional_available(item.good_id) then raise check_violation using message='additional_good_unavailable'; end if;
    select coalesce((select qty from public.cart_items where user_id=actor and good_id=item.good_id and variant_id=item.variant_id),0) into actual_qty;
    if actual_qty<>item.expected_qty then raise sqlstate 'PT409' using message='cart_selection_changed'; end if;
    next_qty:=actual_qty::bigint+item.qty;
    if next_qty>2147483647 then raise check_violation using message='invalid cart selection'; end if;
    perform public.set_cart_item_quantity(item.good_id,item.variant_id,next_qty::integer);
  end loop;
  return (select coalesce(jsonb_agg(jsonb_build_object('goodId',good_id,'variantId',variant_id,'qty',qty)
    order by created_at,good_id,variant_id),'[]'::jsonb) from public.cart_items where user_id=actor);
end $$;
revoke all on function public.add_cart_selection(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.add_cart_selection(text,jsonb) to authenticated;

notify pgrst,'reload schema';
