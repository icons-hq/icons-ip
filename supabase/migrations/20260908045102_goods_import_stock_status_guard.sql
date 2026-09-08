-- A manually paused sale is catalog metadata. Only quantity caches and their
-- timestamps may change after a workbook preview without invalidating it.
create or replace function private.goods_import_fingerprint(target_id text)
returns text language sql stable security definer set search_path='' as $$
 select encode(extensions.digest(convert_to(jsonb_build_object(
  'good',to_jsonb(good)-'stock_qty'-'updated_at',
  'variants',(select coalesce(jsonb_agg(to_jsonb(variant)-'stock_qty'-'updated_at' order by variant.id),'[]')
    from public.goods_variants variant where variant.good_id=good.id)
 )::text,'UTF8'),'sha256'),'hex') from public.goods good where good.id=target_id;
$$;
revoke all on function private.goods_import_fingerprint(text) from public,anon,authenticated,service_role;
