-- Read-only seller-console filters. Existing readiness, inventory and price
-- authorities stay intact; legacy workspace consumers keep their RPC contract.
create function private.admin_goods_console_matches(
  p_query text, p_ip_id text, p_status text, p_stock text,
  p_category_id uuid, p_readiness text, p_filters jsonb
) returns table(good public.goods, readiness jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  field_value text := coalesce(p_filters->>'field', 'all');
  date_field text := coalesce(p_filters->>'dateField', 'created');
  sort_value text := coalesce(p_filters->>'sort', 'created_desc');
  payment_value text := coalesce(p_filters->>'payment', 'all');
  sale_type text := coalesce(p_filters->>'saleType', 'all');
  image_value text := coalesce(p_filters->>'image', 'all');
  restriction_value text := coalesce(p_filters->>'restriction', 'all');
  query_value text := lower(btrim(coalesce(p_query, '')));
  from_value date;
  to_value date;
  origin_value uuid;
begin
  if auth.uid() is null or not coalesce(public.is_staff(), false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if jsonb_typeof(p_filters) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_filters) key where key not in
      ('field','dateField','sort','payment','saleType','image','restriction','from','to','originId'))
    or exists(select 1 from jsonb_each(p_filters) item where jsonb_typeof(item.value) not in ('string','null'))
    or field_value not in ('all','name','id','code','erp','barcode')
    or date_field not in ('created','updated','published')
    or sort_value not in ('created_desc','updated_desc','name_asc','id_asc','price_asc','price_desc','stock_asc','stock_desc')
    or payment_value not in ('all','card','bank','none')
    or sale_type not in ('all','stock','preorder')
    or image_value not in ('all','with','without')
    or restriction_value not in ('all','none','adult')
    or length(query_value) > 100 then
    raise invalid_parameter_value using message = 'invalid_goods_console_filter';
  end if;
  if nullif(p_filters->>'from','') is not null then
    if p_filters->>'from' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise invalid_parameter_value using message = 'invalid_goods_console_date';
    end if;
    from_value := (p_filters->>'from')::date;
  end if;
  if nullif(p_filters->>'to','') is not null then
    if p_filters->>'to' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise invalid_parameter_value using message = 'invalid_goods_console_date';
    end if;
    to_value := (p_filters->>'to')::date;
  end if;
  if from_value > to_value then
    raise invalid_parameter_value using message = 'invalid_goods_console_date';
  end if;
  if nullif(p_filters->>'originId','') is not null then
    origin_value := (p_filters->>'originId')::uuid;
  end if;

  return query
    select source.good, source.readiness
    from private.admin_goods_workspace_matches(
      case when field_value = 'all' then p_query else '' end,
      p_ip_id, p_status, p_stock, p_category_id, p_readiness
    ) source
    cross join lateral (select case date_field
      when 'updated' then (source.good).updated_at
      when 'published' then (source.good).published_at
      else (source.good).created_at end as at) event_date
    where (from_value is null or event_date.at >= (from_value::timestamp at time zone 'Asia/Seoul'))
      and (to_value is null or event_date.at < ((to_value + 1)::timestamp at time zone 'Asia/Seoul'))
      and (origin_value is null or (source.good).origin_id = origin_value)
      and case payment_value
        when 'card' then (source.good).allow_card_payment
        when 'bank' then (source.good).allow_bank_transfer
        when 'none' then not (source.good).allow_card_payment and not (source.good).allow_bank_transfer
        else true end
      and (restriction_value = 'all' or (source.good).sale_restriction::text = restriction_value)
      and case image_value
        when 'with' then nullif(btrim((source.good).image_path),'') is not null
        when 'without' then nullif(btrim((source.good).image_path),'') is null
        else true end
      and (sale_type = 'all' or (
        exists(select 1 from public.goods_variants variant where variant.good_id = (source.good).id
          and variant.archived_at is null and variant.preorder_policy_id is not null)
        = (sale_type = 'preorder')
      ))
      and (query_value = '' or field_value = 'all' or case field_value
        when 'name' then strpos(lower((source.good).name),query_value) > 0
          or strpos(lower(coalesce((source.good).name_en,'')),query_value) > 0
        when 'id' then lower((source.good).id) = any(regexp_split_to_array(query_value,'[[:space:],]+'))
        when 'code' then strpos(lower((source.good).code),query_value) > 0
          or exists(select 1 from public.goods_variants variant where variant.good_id = (source.good).id
            and strpos(lower(variant.code),query_value) > 0)
        when 'erp' then exists(select 1 from public.goods_variants variant
          join private.goods_variant_external_identity identity on identity.variant_id = variant.id
          where variant.good_id = (source.good).id and
            (strpos(lower(identity.erp_code),query_value) > 0 or strpos(lower(identity.erp_name),query_value) > 0))
        when 'barcode' then exists(select 1 from public.goods_variants variant
          join private.goods_variant_external_identity identity on identity.variant_id = variant.id
          where variant.good_id = (source.good).id and strpos(lower(identity.barcode),query_value) > 0)
        else false end);
end $$;
revoke all on function private.admin_goods_console_matches(text,text,text,text,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.admin_goods_console_matches(text,text,text,text,uuid,text,jsonb) to postgres;

create function public.admin_search_goods_console(
  p_query text default '', p_ip_id text default '', p_status text default 'active', p_stock text default 'all',
  p_category_id uuid default null, p_readiness text default 'all', p_limit integer default 20,
  p_offset integer default 0, p_filters jsonb default '{}'
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
  sort_value text := coalesce(p_filters->>'sort', 'created_desc');
begin
  if auth.uid() is null or not coalesce(public.is_staff(),false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if p_limit is null or p_limit not between 0 and 100 or p_offset is null or p_offset < 0 then
    raise invalid_parameter_value using message = 'invalid_goods_console_page';
  end if;
  if p_status is null or p_status not in ('active','all','draft','published','archived') then
    raise invalid_parameter_value using message = 'invalid_goods_console_status';
  end if;
  with scope as materialized (
    select * from private.admin_goods_console_matches(p_query,p_ip_id,'all',p_stock,p_category_id,p_readiness,p_filters)
  ), matched as materialized (
    select * from scope where case p_status
      when 'all' then true when 'archived' then (good).archived_at is not null
      when 'draft' then (good).archived_at is null and (good).published_at is null
      when 'published' then (good).archived_at is null and (good).published_at is not null
      else (good).archived_at is null end
  ), ordered as (
    select *, row_number() over(order by
      case when sort_value = 'created_desc' then (good).created_at end desc nulls last,
      case when sort_value = 'updated_desc' then (good).updated_at end desc nulls last,
      case when sort_value = 'name_asc' then (good).name end asc nulls last,
      case when sort_value = 'price_asc' then (readiness->>'priceMin')::bigint end asc nulls last,
      case when sort_value = 'price_desc' then (readiness->>'priceMin')::bigint end desc nulls last,
      case when sort_value = 'stock_asc' then (readiness->>'availableQty')::bigint end asc nulls last,
      case when sort_value = 'stock_desc' then (readiness->>'availableQty')::bigint end desc nulls last,
      (good).id asc) as position
    from matched
  ), page as (select * from ordered order by position limit p_limit offset p_offset)
  select jsonb_build_object(
    'checkedAt',statement_timestamp(), 'total',(select count(*) from matched),
    'statusCounts',(select jsonb_build_object(
      'all',count(*), 'active',count(*) filter(where (good).archived_at is null),
      'draft',count(*) filter(where (good).archived_at is null and (good).published_at is null),
      'published',count(*) filter(where (good).archived_at is null and (good).published_at is not null),
      'archived',count(*) filter(where (good).archived_at is not null)) from scope),
    'reasonCounts',coalesce((select jsonb_object_agg(code,total) from (
      select code,count(*) total from matched cross join lateral jsonb_array_elements_text(readiness->'reasonCodes') code group by code
    ) counts),'{}'),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',(good).id,'code',(good).code,'name',(good).name,'ipId',(good).ip_id,
      'ipTitle',(select title from public.ips where id=(good).ip_id),
      'categoryId',(good).category_id,'categoryName',(select name from public.catalog_categories where id=(good).category_id),
      'imagePath',(good).image_path,'publishedAt',(good).published_at,'archivedAt',(good).archived_at,
      'createdAt',(good).created_at,'updatedAt',(good).updated_at,
      'stock',(good).stock,'stockQty',(good).stock_qty,'readiness',readiness
    ) order by position) from page),'[]')
  ) into result;
  return result;
end $$;
revoke all on function public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb) to authenticated;

create function public.admin_goods_console_export_candidates(
  p_query text default '', p_ip_id text default '', p_status text default 'active', p_stock text default 'all',
  p_category_id uuid default null, p_readiness text default 'all', p_filters jsonb default '{}'
) returns table(good_id text, option_rows integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not coalesce(public.is_staff(),false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  return query select (matched.good).id, greatest(1,(select count(*)::integer from public.goods_variants variant
    where variant.good_id = (matched.good).id and (variant.archived_at is null or variant.is_default)))
    from private.admin_goods_console_matches(p_query,p_ip_id,p_status,p_stock,p_category_id,p_readiness,p_filters) matched
    order by (matched.good).id;
end $$;
revoke all on function public.admin_goods_console_export_candidates(text,text,text,text,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_console_export_candidates(text,text,text,text,uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
