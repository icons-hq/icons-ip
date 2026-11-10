-- Public computed fields intentionally hide unpublished/archived goods. The
-- store.manage editor must retain and inspect those existing references, so use
-- the same private calculation functions behind its already-guarded RPCs.
create or replace function private.shopping_story_admin_good(p_good public.goods,p_ip_published boolean,p_ip_archived boolean)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_good.id,'name',p_good.name,'code',p_good.code,'price',p_good.price,
  'compareAtPrice',p_good.compare_at_price,'showDiscountRate',p_good.show_discount_rate,
  'imagePath',p_good.image_path,'bg',p_good.bg,'badge',p_good.badge,'stock',p_good.stock,
  'archived',p_good.archived_at is not null or p_ip_archived,
  'published',p_good.published_at is not null and p_ip_published and p_good.archived_at is null and not p_ip_archived and p_good.sale_restriction='none',
  'variants',coalesce((select jsonb_agg(jsonb_build_object('price',v.price,
   'pricing',jsonb_build_object('regularPrice',price.regular_price,'effectivePrice',price.effective_price,
    'pricePeriodId',price.price_period_id,'startsAt',price.starts_at,'endsAt',price.ends_at,'calculatedAt',statement_timestamp(),
    'nextChangeAt',(select min(boundary.at) from private.goods_variant_price_periods schedule
      cross join lateral (values(schedule.starts_at),(schedule.ends_at)) boundary(at)
      where schedule.variant_id=v.id and schedule.state='active' and boundary.at>statement_timestamp())),
   'supply',jsonb_build_object('mode',supply.mode,'availableQty',supply.available_qty,'policyId',supply.policy_id,
    'policyRevision',supply.policy_revision,'state',supply.state,'startsAt',supply.starts_at,'endsAt',supply.ends_at,
    'expectedShipDate',supply.expected_ship_date,'calculatedAt',statement_timestamp(),'nextChangeAt',supply.next_change_at)) order by v.id)
   from public.goods_variants v
   cross join lateral private.resolve_goods_variant_price(v.id,statement_timestamp()) price
   cross join lateral private.resolve_goods_variant_supply(v.id,statement_timestamp()) supply
   where v.good_id=p_good.id and v.archived_at is null),'[]'::jsonb));
$$;
revoke all on function private.shopping_story_admin_good(public.goods,boolean,boolean) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.shopping_story_admin_good(public.goods,boolean,boolean)'::regprocedure);
