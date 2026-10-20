-- Preserve literal entities in plain descriptions; decode HTML entities only for HTML sources.
create or replace function public.get_goods_listing_appearance(p_good_ids text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_good_ids is null or cardinality(p_good_ids)>1000 or coalesce(array_ndims(p_good_ids),1)<>1 then raise invalid_parameter_value using message='invalid_listing_ids';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'galleryPaths',to_jsonb(coalesce(g.gallery_paths[1:9],'{}'::text[])),
  'descriptionFormat',g.description_format,'description',left(btrim(regexp_replace(case when g.description_format='html' then regexp_replace(regexp_replace(coalesce(g.description,''),'<(script|style)\y[^>]*>.*?</\1\s*>',' ','gis'),'<[^>]*>',' ','g') else coalesce(g.description,'') end,'\s+',' ','g')),240),
  'colors',coalesce(c.colors,'[]'::jsonb)) order by g.id),'[]'::jsonb)
  from public.goods g join public.ips ip on ip.id=g.ip_id left join private.goods_listing_colors c on c.good_id=g.id
  where g.id=any(p_good_ids) and g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null);
end $$;
revoke all on function public.get_goods_listing_appearance(text[]) from public,anon,authenticated,service_role;
grant execute on function public.get_goods_listing_appearance(text[]) to anon,authenticated;

select private.register_operator_internal_contract('public.get_goods_listing_appearance(text[])'::regprocedure);
notify pgrst,'reload schema';
