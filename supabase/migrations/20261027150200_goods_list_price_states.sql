-- Goods list inline price edit (A9) uses the same meaning of "판매가" as the goods
-- editor: it is offered only when the good has no product-level discount
-- (compare_at_price) and no current/upcoming instant discount period; otherwise
-- the list explains why and sends the operator to the editor or discount stop.
-- Price periods are private, so the page reads only this bounded projection.
begin;
create function public.admin_goods_list_price_states(p_good_ids text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_good_ids is null or cardinality(p_good_ids)>100 or array_position(p_good_ids,null) is not null then
  raise invalid_parameter_value using message='invalid_goods_list_price_states';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'price',g.price,'compareAtPrice',g.compare_at_price,
   -- Same predicate as private.guard_goods_variant_period_price.
   'activeDiscountEndsAt',(select max(p.ends_at) from private.goods_variant_price_periods p
     where p.good_id=g.id and p.state='active' and p.ends_at>statement_timestamp())) order by g.id),'[]') into result
 from public.goods g where g.id=any(p_good_ids);
 return result;
end $$;
revoke all on function public.admin_goods_list_price_states(text[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_list_price_states(text[]) to authenticated;
select private.register_operator_rpc_contract('public.admin_goods_list_price_states(text[])'::regprocedure,'catalog.read','read',false);
notify pgrst,'reload schema';
commit;
