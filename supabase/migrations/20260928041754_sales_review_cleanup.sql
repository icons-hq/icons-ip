-- #505: sales-policy validation, control ordering and audit belong to the
-- preceding sales-policy writer. This layer owns only the template reference.
create or replace function private.admin_save_good_before_category(target_good jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  saved jsonb;
  legacy_payload jsonb;
  template_code text;
  template_version integer;
  template_fields_present boolean;
  template_version_text text;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  template_fields_present := target_good ? 'shipping_notice_template_code'
    or target_good ? 'shipping_notice_template_version'
    or target_good ? 'shippingNoticeTemplateCode'
    or target_good ? 'shippingNoticeTemplateVersion';
  legacy_payload := target_good - 'shipping_notice_template_code' - 'shipping_notice_template_version'
    - 'shippingNoticeTemplateCode' - 'shippingNoticeTemplateVersion';
  if template_fields_present then
    if (target_good ? 'shipping_notice_template_code' and jsonb_typeof(target_good->'shipping_notice_template_code') not in ('string','null'))
      or (target_good ? 'shippingNoticeTemplateCode' and jsonb_typeof(target_good->'shippingNoticeTemplateCode') not in ('string','null')) then
      raise invalid_parameter_value using message='invalid_shipping_notice_template';
    end if;
    template_code := nullif(btrim(coalesce(target_good->>'shipping_notice_template_code', target_good->>'shippingNoticeTemplateCode', '')), '');
    template_version_text := nullif(btrim(coalesce(target_good->>'shipping_notice_template_version', target_good->>'shippingNoticeTemplateVersion', '')), '');
    if template_version_text is not null then
      begin
        template_version := template_version_text::integer;
      exception when others then
        raise invalid_parameter_value using message='invalid_shipping_notice_template';
      end;
    end if;
    if template_code is not null and (template_code !~ '^[a-z][a-z0-9-]{1,39}$' or template_version is null or template_version not between 1 and 1000000) then
      raise invalid_parameter_value using message='invalid_shipping_notice_template';
    end if;
    if template_code is null and template_version is not null then
      raise invalid_parameter_value using message='invalid_shipping_notice_template';
    end if;
  end if;

  -- Defer first publication until the template snapshot has been applied.
  -- Keep an explicit unpublish in the preceding writer so restocking in the
  -- same request cannot notify customers about a good being taken offline.
  saved := private.admin_save_good_before_shipping_notice(case when legacy_payload->>'publish'='true'
    then legacy_payload||'{"publish":null}'::jsonb else legacy_payload end);
  if template_fields_present then
    perform private.apply_shipping_notice_template_reference(saved->>'id',template_code,template_version);
    saved := saved||jsonb_build_object('shippingNoticeTemplateCode',template_code,'shippingNoticeTemplateVersion',template_version);
  end if;
  if legacy_payload->>'publish'='true' then
    perform public.admin_set_good_published(saved->>'id',true);
  end if;
  return saved;
end $$;
revoke all on function private.admin_save_good_before_category(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.admin_save_good_before_category(jsonb) to postgres;

-- Match user-entered characters literally. Keep each endpoint's empty-search
-- behavior and result limit; reject oversized raw input before normalization.
create or replace function public.admin_find_goods_for_shipping_notice_template(
  target_template_id uuid,
  search_query text default ''
)
returns table(id text,name text,template_id uuid,template_version integer,published_at timestamptz,updated_at timestamptz)
language sql security definer set search_path='' as $$
  with params as (
    select btrim(coalesce(search_query,'')) needle,
      '%'||replace(replace(replace(btrim(coalesce(search_query,'')),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%' pattern
  )
  select good.id,good.name,good.shipping_notice_template_id,good.shipping_notice_template_version,good.published_at,good.updated_at
  from public.goods good cross join params
  where (select auth.uid()) is not null and public.is_staff()
    and char_length(coalesce(search_query,''))<=100
    and good.archived_at is null
    and (target_template_id is null or good.shipping_notice_template_id=target_template_id)
    and (params.needle='' or good.id ilike params.pattern escape E'\\' or good.name ilike params.pattern escape E'\\')
  order by good.updated_at desc,good.id
  limit 100;
$$;
revoke all on function public.admin_find_goods_for_shipping_notice_template(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_find_goods_for_shipping_notice_template(uuid,text) to authenticated;

create or replace function public.admin_search_goods_additional(p_base_good_id text,p_query text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pattern text;
begin
  if not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  if length(btrim(coalesce(p_query,'')))<1 or length(p_query)>100 then return '[]'::jsonb; end if;
  pattern := '%'||replace(replace(replace(btrim(p_query),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  return (select coalesce(jsonb_agg(jsonb_build_object('goodId',candidate.id,'name',candidate.name,'available',true)
    order by candidate.name,candidate.id),'[]'::jsonb) from (
      select good.id,good.name from public.goods good where good.id<>p_base_good_id
        and private.goods_additional_available(good.id)
        and (good.name ilike pattern escape E'\\' or good.id ilike pattern escape E'\\')
      order by good.name,good.id limit 50) candidate);
end $$;
revoke all on function public.admin_search_goods_additional(text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_goods_additional(text,text) to authenticated;

create index order_items_price_period_idx on public.order_items(price_period_id);
create index order_items_preorder_policy_idx on public.order_items(preorder_policy_id);
create index order_shipments_delivery_policy_idx on public.order_shipments(delivery_policy_id);
create index goods_variants_preorder_policy_idx on public.goods_variants(id,preorder_policy_id);

notify pgrst,'reload schema';
