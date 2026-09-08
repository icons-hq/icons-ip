-- #443: cart/order options are mandatory after their lossless #439 backfill.
-- Old local carts resolve public defaults in the application migration boundary.
alter table public.order_items alter column variant_id set not null;
alter table public.cart_items alter column variant_id set not null;
drop trigger cart_items_fill_variant on public.cart_items;
drop function private.fill_cart_default_variant();
drop function public.admin_adjust_stock(uuid,text,integer,integer,text);
drop function public.place_order(jsonb);
drop function private.change_default_goods_variant_stock(text,bigint);

CREATE OR REPLACE FUNCTION private.snapshot_order_variant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare variant public.goods_variants;
begin
  if new.variant_id is null then raise not_null_violation using message='order_variant_required'; end if;
  select * into variant from public.goods_variants where id=new.variant_id and good_id=new.good_id;
  if not found then raise foreign_key_violation using message='order_variant_not_found'; end if;
  new.variant_code_snapshot:=variant.code;
  new.variant_name_snapshot:=case when variant.is_default and variant.name='기본 옵션' and variant.attributes='{}'
    and not exists(select 1 from public.goods_variants where good_id=new.good_id and id<>variant.id and archived_at is null)
    then null else variant.name end;
  return new;
end $function$;
revoke all on function private.snapshot_order_variant() from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.set_cart_item_quantity(p_good_id text, p_variant_id uuid, p_qty integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); selected_variant uuid:=p_variant_id; available_stock integer;
begin
  if actor is null then raise insufficient_privilege using message='auth required'; end if;
  perform private.assert_active_user(actor);
  if nullif(btrim(p_good_id),'') is null or p_variant_id is null or p_qty is null or p_qty<0 then raise invalid_parameter_value using message='invalid cart item'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cart:'||actor::text,0));
  if p_qty=0 then delete from public.cart_items where user_id=actor and good_id=p_good_id and variant_id=selected_variant; return; end if;
  select variant.stock_qty into available_stock from public.goods_variants variant
    join public.goods good on good.id=variant.good_id join public.ips ip on ip.id=good.ip_id
    where variant.id=selected_variant and variant.good_id=p_good_id and variant.archived_at is null
      and good.published_at is not null and good.archived_at is null and good.sale_restriction='none'
      and good.stock<>'soldout' and ip.published_at is not null and ip.archived_at is null;
  if not found then raise check_violation using message='catalog_item_unavailable'; end if;
  if p_qty>available_stock then raise check_violation using message='out of stock'; end if;
  insert into public.cart_items(user_id,good_id,variant_id,qty) values(actor,p_good_id,selected_variant,p_qty)
    on conflict(user_id,variant_id) do update set qty=excluded.qty;
end $function$;
revoke all on function public.set_cart_item_quantity(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.set_cart_item_quantity(text,uuid,integer) to authenticated;

CREATE OR REPLACE FUNCTION public.merge_cart_items(p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); item record; selected_variant uuid;
begin
  if actor is null then raise insufficient_privilege using message='auth required'; end if;
  perform private.assert_active_user(actor);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>1000 then raise check_violation using message='cart items must be an array'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cart:'||actor::text,0));
  for item in select * from jsonb_to_recordset(p_items) as candidate(good_id text,variant_id uuid,qty integer) order by good_id,variant_id loop
    if nullif(btrim(item.good_id),'') is null or item.variant_id is null or item.qty is null or item.qty<=0 then raise check_violation using message='invalid cart item'; end if;
    select variant.id into selected_variant from public.goods_variants variant
      join public.goods good on good.id=variant.good_id join public.ips ip on ip.id=good.ip_id
      where good.id=btrim(item.good_id) and variant.id=item.variant_id
        and variant.archived_at is null and good.archived_at is null and good.published_at is not null and good.sale_restriction='none'
        and ip.archived_at is null and ip.published_at is not null;
    if not found then raise check_violation using message='catalog_item_unavailable'; end if;
    insert into public.cart_items(user_id,good_id,variant_id,qty) values(actor,btrim(item.good_id),selected_variant,item.qty)
      on conflict(user_id,variant_id) do update set qty=greatest(public.cart_items.qty,excluded.qty);
  end loop;
end $function$;
revoke all on function public.merge_cart_items(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.merge_cart_items(jsonb) to authenticated;
