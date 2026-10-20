begin;

create function public.admin_search_goods_group_console(p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 query text:=btrim(coalesce(p_filters->>'query','')); field text:=coalesce(p_filters->>'field','all');
 status text:=coalesce(p_filters->>'status','all'); date_field text:=coalesce(p_filters->>'dateField','created');
 stock text:=coalesce(p_filters->>'stock','all'); shipping text:=coalesce(p_filters->>'shippingFee','all');
 sort_value text:=coalesce(p_filters->>'sort','created_desc'); category_id uuid; origin_id uuid; from_date date; to_date date;
 page integer:=coalesce((p_filters->>'page')::integer,1); page_size integer:=coalesce((p_filters->>'pageSize')::integer,50);
 result jsonb;
begin
 if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_filters) k where k not in
 ('query','field','status','categoryId','dateField','from','to','stock','originId','shippingFee','sort','page','pageSize'))
 or exists(select 1 from jsonb_each(p_filters) e where jsonb_typeof(e.value) not in ('string','number','null'))
 or char_length(query)>100 or field not in ('all','goodId','groupId','code','name','maker') or status not in ('all','published','draft','archived')
 or date_field not in ('created','updated') or stock not in ('all','available','soldout') or shipping not in ('all','free','paid')
 or sort_value not in ('created_desc','updated_desc','name_asc') or page not between 1 and 100000 or page_size not in (20,50,100)
 then raise invalid_parameter_value using message='invalid_goods_group_filters'; end if;
 category_id:=nullif(p_filters->>'categoryId','')::uuid; origin_id:=nullif(p_filters->>'originId','')::uuid;
 if nullif(p_filters->>'from','') is not null and p_filters->>'from' !~ '^\d{4}-\d{2}-\d{2}$'
 or nullif(p_filters->>'to','') is not null and p_filters->>'to' !~ '^\d{4}-\d{2}-\d{2}$' then raise invalid_parameter_value using message='invalid_goods_group_dates'; end if;
 from_date:=nullif(p_filters->>'from','')::date; to_date:=nullif(p_filters->>'to','')::date;
 if from_date>to_date then raise invalid_parameter_value using message='invalid_goods_group_dates'; end if;
 with recursive categories as (
  select c.id from public.catalog_categories c where c.id=category_id
  union all select c.id from public.catalog_categories c join categories p on c.parent_id=p.id
 ), matched as materialized (
  select g.*,c.name category_name,
   case when g.archived_at is not null then 'archived'
    when exists(select 1 from private.goods_group_members m join public.goods good on good.id=m.good_id
      where m.group_id=g.id and good.published_at is not null and good.archived_at is null) then 'published' else 'draft' end group_status
  from private.goods_groups g join public.goods common on common.id=g.common_good_id left join public.catalog_categories c on c.id=common.category_id
  where (from_date is null or (case date_field when 'created' then g.created_at else g.updated_at end)>=(from_date::timestamp at time zone 'Asia/Seoul'))
   and (to_date is null or (case date_field when 'created' then g.created_at else g.updated_at end)<((to_date+1)::timestamp at time zone 'Asia/Seoul'))
   and (category_id is null or common.category_id in(select id from categories))
   and (query='' or field in ('all','name') and position(lower(query) in lower(g.name))>0
    or field in ('all','groupId') and position(lower(query) in lower(g.id::text))>0
    or exists(select 1 from private.goods_group_members m join public.goods good on good.id=m.good_id where m.group_id=g.id and (
      field='all' and position(lower(query) in lower(concat_ws(' ',good.id,good.code,good.name,good.notice_maker)))>0
      or field='goodId' and position(lower(query) in lower(good.id))>0
      or field='code' and position(lower(query) in lower(coalesce(good.code,'')))>0
      or field='maker' and position(lower(query) in lower(coalesce(good.notice_maker,'')))>0)))
   and (origin_id is null or exists(select 1 from private.goods_group_members m join public.goods good on good.id=m.good_id where m.group_id=g.id and good.origin_id=origin_id))
   and (stock='all' or exists(select 1 from private.goods_group_members m join public.goods_variants v on v.id=m.variant_id
     where m.group_id=g.id and v.archived_at is null and case stock when 'available' then v.stock_qty>0 else v.stock_qty=0 end))
   and (shipping='all' or exists(select 1 from private.goods_group_members m join public.goods good on good.id=m.good_id
     where m.group_id=g.id and case shipping when 'free' then good.shipping_fee_type='free' else good.shipping_fee_type<>'free' end))
 ), selected as materialized(select * from matched m where status='all' or m.group_status=status),
 paged as (select * from selected s order by case when sort_value='created_desc' then s.created_at end desc,
   case when sort_value='updated_desc' then s.updated_at end desc,case when sort_value='name_asc' then s.name end,s.id
   limit page_size offset (page::bigint-1)*page_size)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(private.goods_group_snapshot(p.id) order by
   case when sort_value='created_desc' then p.created_at end desc,case when sort_value='updated_desc' then p.updated_at end desc,
   case when sort_value='name_asc' then p.name end,p.id) from paged p),'[]'),
  'total',(select count(*) from selected),'page',page,'pageSize',page_size,
  'counts',jsonb_build_object('all',(select count(*) from matched),'published',(select count(*) from matched where group_status='published'),
   'draft',(select count(*) from matched where group_status='draft'),'archived',(select count(*) from matched where group_status='archived')),
  'metadata',coalesce((select jsonb_object_agg(p.id,jsonb_build_object('createdAt',p.created_at,'updatedAt',p.updated_at,'category',p.category_name)) from paged p),'{}')) into result;
 return result;
end;
$$;
revoke all on function public.admin_search_goods_group_console(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_goods_group_console(jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_search_goods_group_console(jsonb)'::regprocedure,'catalog.manage','read',false);

commit;
