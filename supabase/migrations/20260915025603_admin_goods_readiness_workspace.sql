-- #528/#530/#532. Read-only projections over the current publication, KC,
-- pricing and supply authorities. No writer, grant to public readers or policy changes.
create function private.admin_goods_readiness(p_good public.goods) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  reasons text[] := array[]::text[]; blockers text[] := array[]::text[];
  available bigint; active_qty bigint; active_options integer; low_options integer;
  min_price integer; max_price integer; ip public.ips;
  kc_current boolean; kc_legacy boolean; notice_complete boolean; unknown_read boolean := false;
begin
  select * into ip from public.ips where id=p_good.ip_id;
  select count(*)::integer into active_options from public.goods_variants where good_id=p_good.id and archived_at is null;
  active_qty:=public.admin_goods_active_stock_qty(p_good);
  low_options:=public.admin_goods_low_stock_option_count(p_good);
  notice_complete := not exists(select 1 from unnest(array[p_good.notice_maker,p_good.notice_origin,p_good.notice_material,
    p_good.notice_size,p_good.notice_made_on,p_good.notice_as_manager,p_good.notice_as_contact]) value where nullif(btrim(value),'') is null);
  -- A malformed supply/review must remain an unknown item in the queue, never 0/ready.
  begin
    available := public.goods_sale_available_qty(p_good);
    select min(price.effective_price),max(price.effective_price) into min_price,max_price
      from public.goods_variants variant cross join lateral private.resolve_goods_variant_price(variant.id,statement_timestamp()) price
      where variant.good_id=p_good.id and variant.archived_at is null;
    kc_current := private.goods_kc_review_current(p_good.id);
    kc_legacy := p_good.published_at is not null and not exists(select 1 from private.goods_kc_reviews where good_id=p_good.id);
  exception when others then
    available:=null; min_price:=null; max_price:=null; kc_current:=null; kc_legacy:=false; unknown_read:=true;
  end;
  if p_good.archived_at is not null then blockers:=array_append(blockers,'archived');
  elsif p_good.published_at is null then blockers:=array_append(blockers,'draft'); end if;
  if p_good.stock='soldout' then blockers:=array_append(blockers,'stopped'); end if;
  if ip.archived_at is not null then blockers:=array_append(blockers,'ip_archived');
  elsif ip.published_at is null then blockers:=array_append(blockers,'ip_unpublished'); end if;
  if nullif(btrim(p_good.type),'') is null then blockers:=array_append(blockers,'type_missing'); end if;
  if nullif(btrim(p_good.image_path),'') is null then blockers:=array_append(blockers,'image_missing'); end if;
  if not notice_complete then blockers:=array_append(blockers,'notice_missing'); end if;
  if active_options=0 then blockers:=array_append(blockers,'no_active_options');
  elsif available=0 and p_good.stock<>'soldout' and p_good.archived_at is null then blockers:=array_append(blockers,'stock_unavailable'); end if;
  if not p_good.allow_card_payment and not p_good.allow_bank_transfer then blockers:=array_append(blockers,'payment_disabled'); end if;
  if p_good.sale_restriction<>'none' then blockers:=array_append(blockers,'restricted_sale'); end if;
  if not exists(select 1 from public.fulfillment_origins where id=p_good.origin_id and is_active) then blockers:=array_append(blockers,'shipping_unavailable'); end if;
  reasons:=blockers;
  if unknown_read then reasons:=array_append(reasons,'readiness_unknown');
  elsif kc_legacy then reasons:=array_append(reasons,'kc_legacy_unrecorded');
  elsif not kc_current then reasons:=array_append(reasons,'kc_required'); end if;
  return jsonb_build_object(
    'state',case when unknown_read then 'unknown' when cardinality(blockers)>0 then 'blocked' when cardinality(reasons)>0 then 'review_required' else 'ready' end,
    'checkedAt',statement_timestamp(),
    'publication',case when p_good.archived_at is not null then 'archived' when p_good.published_at is null then 'draft' else 'published' end,
    'operation',case when p_good.stock='soldout' then 'stopped' else 'active' end,
    'availableQty',available,'activeStockQty',active_qty,'activeOptionCount',active_options,'lowStockOptionCount',low_options,
    'priceMin',min_price,'priceMax',max_price,'noticeComplete',notice_complete,
    'publicReview',case when unknown_read then 'unknown' when kc_current then 'current' when kc_legacy then 'legacy_unrecorded' else 'required' end,
    'saleSettings',case when unknown_read then 'unknown' when cardinality(blockers)>0 then 'blocked' else 'ready' end,
    'reviewRequired',cardinality(reasons)>0,'reasonCodes',to_jsonb(reasons),'blockingCodes',to_jsonb(blockers));
end $$;
revoke all on function private.admin_goods_readiness(public.goods) from public,anon,authenticated,service_role;
grant execute on function private.admin_goods_readiness(public.goods) to postgres;

-- Filtering happens before count, ordering and paging. Every consumer shares it.
create function private.admin_goods_workspace_matches(p_query text,p_ip_id text,p_status text,p_stock text,p_category_id uuid,p_readiness text)
returns table(good public.goods,readiness jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_status is null or p_status not in ('active','all','draft','published','archived') or p_stock is null or p_stock not in ('all','ok','low','soldout')
    or p_readiness is null or p_readiness not in ('all','ready','review_required','archived','draft','stopped','ip_unpublished','ip_archived',
    'type_missing','image_missing','notice_missing','no_active_options','stock_unavailable','payment_disabled','restricted_sale','shipping_unavailable',
    'kc_required','kc_legacy_unrecorded','readiness_unknown') then raise invalid_parameter_value using message='invalid_goods_workspace_filter'; end if;
  return query
  with recursive categories as (
    select id from public.catalog_categories where id=p_category_id
    union select child.id from public.catalog_categories child join categories parent on child.parent_id=parent.id
  ), candidates as materialized (
    select item from public.admin_search_goods(p_query) item
    where (coalesce(p_ip_id,'')='' or item.ip_id=p_ip_id)
      and (p_category_id is null or item.category_id in (select id from categories))
      and case p_status when 'all' then true when 'archived' then item.archived_at is not null
        when 'draft' then item.archived_at is null and item.published_at is null
        when 'published' then item.archived_at is null and item.published_at is not null else item.archived_at is null end
  ), assessed as materialized (
    select item,private.admin_goods_readiness(item) decision from candidates
  ) select item,decision from assessed
    where case p_stock when 'soldout' then (item).stock='soldout' or (decision->>'activeStockQty')::bigint=0
      when 'ok' then (item).stock='ok' and (decision->>'activeStockQty')::bigint>0
      when 'low' then (item).stock='low' and (decision->>'activeStockQty')::bigint>0 else true end
    and case p_readiness when 'all' then true when 'ready' then decision->>'state'='ready'
      when 'review_required' then (decision->>'reviewRequired')::boolean else decision->'reasonCodes' ? p_readiness end;
end $$;
revoke all on function private.admin_goods_workspace_matches(text,text,text,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.admin_goods_workspace_matches(text,text,text,text,uuid,text) to postgres;

create function public.admin_search_goods_workspace(p_query text default '',p_ip_id text default '',p_status text default 'active',p_stock text default 'all',
  p_category_id uuid default null,p_readiness text default 'all',p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_limit is null or p_limit not between 0 and 100 or p_offset is null or p_offset<0 then raise invalid_parameter_value using message='invalid_goods_workspace_page'; end if;
  with matched as materialized (
    select * from private.admin_goods_workspace_matches(p_query,p_ip_id,p_status,p_stock,p_category_id,p_readiness)
  ), page as (select * from matched order by (good).id limit p_limit offset p_offset)
  select jsonb_build_object('checkedAt',statement_timestamp(),'total',(select count(*) from matched),
    'reasonCounts',coalesce((select jsonb_object_agg(code,total) from (
      select code,count(*) total from matched cross join lateral jsonb_array_elements_text(readiness->'reasonCodes') code group by code
    ) counts),'{}'),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',(good).id,'code',(good).code,'name',(good).name,'ipId',(good).ip_id,
      'ipTitle',(select title from public.ips where id=(good).ip_id),
      'categoryId',(good).category_id,'categoryName',(select name from public.catalog_categories where id=(good).category_id),
      'imagePath',(good).image_path,'publishedAt',(good).published_at,'archivedAt',(good).archived_at,
      'stock',(good).stock,'stockQty',(good).stock_qty,'readiness',readiness) order by (good).id) from page),'[]')) into result;
  return result;
end $$;
revoke all on function public.admin_search_goods_workspace(text,text,text,text,uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_goods_workspace(text,text,text,text,uuid,text,integer,integer) to authenticated;

create function public.admin_read_goods_readiness(p_good_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff_required'; end if;
  return (select private.admin_goods_readiness(good) from public.goods good where id=p_good_id);
end $$;
revoke all on function public.admin_read_goods_readiness(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_goods_readiness(text) to authenticated;

create function public.admin_goods_workspace_export_candidates(p_query text default '',p_ip_id text default '',p_status text default 'active',p_stock text default 'all',
  p_category_id uuid default null,p_readiness text default 'all') returns table(good_id text,option_rows integer)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff_required'; end if;
  return query select (matched.good).id,greatest(1,(select count(*)::integer from public.goods_variants variant
    where variant.good_id=(matched.good).id and (variant.archived_at is null or variant.is_default)))
    from private.admin_goods_workspace_matches(p_query,p_ip_id,p_status,p_stock,p_category_id,p_readiness) matched order by (matched.good).id;
end $$;
revoke all on function public.admin_goods_workspace_export_candidates(text,text,text,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_workspace_export_candidates(text,text,text,text,uuid,text) to authenticated;
notify pgrst,'reload schema';
