begin;

create or replace function public.admin_list_customer_segments(p_query text default '',p_group text default 'all',p_target text default 'all',p_kind text default 'all',p_favorite_only boolean default false,p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb; q text:=btrim(coalesce(p_query,''));
begin
 if not public.has_operator_capability('marketing.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 if length(q)>100 or p_group is null or p_group not in ('all','potential','visitor','interested','buyer','loyal')
  or p_target is null or p_target not in ('all','first_purchase','cart_unpurchased','wishlist_unpurchased','unused_coupon','ip_notifications','purchased','first_purchase_recent','lapsed_purchase','repeat_purchase','visited','not_visited','product_viewed','video_viewed','similar_product_viewed')
  or p_kind is null or p_kind not in ('all','preset','custom') or p_favorite_only is null
  or p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not in (20,50,100) then
  raise invalid_parameter_value using message='invalid_customer_segment_filter';end if;
 with matched as materialized (
  select s.id,s.updated_at from private.customer_segments s where s.archived_at is null
   and (q='' or position(lower(q) in lower(s.name))>0 or position(lower(q) in s.id::text)>0 or position(lower(q) in lower('CSG-'||s.reference::text))>0)
   and (p_group='all' or private.customer_segment_group(s.rule->>'target')=p_group)
   and (p_target='all' or s.rule->>'target'=p_target)
   and (p_kind='all' or (s.preset_key is not null)=(p_kind='preset'))
   and (not p_favorite_only or exists(select 1 from private.customer_segment_favorites f where f.actor_id=actor and f.segment_id=s.id))
 ), page_rows as (select * from matched order by updated_at desc,id desc limit p_page_size offset (p_page-1)*p_page_size)
 select jsonb_build_object('total',(select count(*) from matched),'page',p_page,'pageSize',p_page_size,
  'rows',coalesce((select jsonb_agg(private.customer_segment_document(id,actor) order by updated_at desc,id desc) from page_rows),'[]'::jsonb),
  'favorites',coalesce((select jsonb_agg(private.customer_segment_document(f.segment_id,actor) order by f.created_at,f.segment_id)
    from private.customer_segment_favorites f join private.customer_segments s on s.id=f.segment_id where f.actor_id=actor and s.archived_at is null),'[]'::jsonb)) into result;
 return result;
end $$;

create or replace function private.customer_segment_references_available(p_rule jsonb)
returns boolean language sql stable security definer set search_path='' as $$
 select (p_rule->>'target' not in ('visited','not_visited','product_viewed','video_viewed','similar_product_viewed') or (select enabled from private.member_activity_settings where singleton))
  and (p_rule->>'goodsScope'<>'goods' or not exists(select 1 from jsonb_array_elements_text(p_rule->'goodIds') requested(id)
   where not exists(select 1 from public.goods good where good.id=requested.id)))
  and (p_rule->>'goodsScope'<>'category' or exists(select 1 from public.catalog_categories where id=(p_rule->>'categoryId')::uuid))
  and (p_rule->>'ipId' is null or exists(select 1 from public.ips where id=p_rule->>'ipId'))
  and (p_rule->>'couponCode' is null or exists(select 1 from public.coupons where code=p_rule->>'couponCode'));
$$;

create or replace function public.admin_customer_segment_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare at_value timestamptz:=statement_timestamp(); interested_count bigint; buyer_count bigint; loyal_count bigint; first_count bigint; visitor_count bigint; potential_count bigint;
begin
 if not public.has_operator_capability('marketing.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 if (select enabled from private.member_activity_settings where singleton) then
  select count(*) into visitor_count from private.customer_segment_members('{"version":1,"target":"visited"}',at_value);
  select count(*) into potential_count from private.customer_segment_members('{"version":1,"target":"not_visited"}',at_value);
 end if;
 select count(*) into first_count from private.customer_segment_members('{"version":1,"target":"first_purchase"}',at_value);
 select count(*) into buyer_count from private.customer_segment_members('{"version":1,"target":"purchased"}',at_value);
 select count(*) into loyal_count from private.customer_segment_members('{"version":1,"target":"repeat_purchase"}',at_value);
 select count(distinct customer_id) into interested_count from (
  select customer_id from private.customer_segment_members('{"version":1,"target":"cart_unpurchased"}',at_value)
  union all select customer_id from private.customer_segment_members('{"version":1,"target":"wishlist_unpurchased"}',at_value)
  union all select customer_id from private.customer_segment_members('{"version":1,"target":"unused_coupon"}',at_value)
  union all select customer_id from private.customer_segment_members('{"version":1,"target":"ip_notifications"}',at_value)
 ) interested;
 if (select enabled from private.member_activity_settings where singleton) then
 select count(distinct customer_id) into interested_count from (
  select customer_id from private.customer_segment_members('{"version":1,"target":"cart_unpurchased"}',at_value)
  union all select customer_id from private.customer_segment_members('{"version":1,"target":"wishlist_unpurchased"}',at_value)
  union all select customer_id from private.customer_segment_members('{"version":1,"target":"unused_coupon"}',at_value)
  union all select customer_id from private.customer_segment_members('{"version":1,"target":"ip_notifications"}',at_value)
  union all select customer_id from private.customer_segment_members('{"version":1,"target":"product_viewed"}',at_value)
  union all select customer_id from private.customer_segment_members('{"version":1,"target":"video_viewed"}',at_value)
 ) interested;
 end if;
 return jsonb_build_object('checkedAt',at_value,'groups',jsonb_build_object('potential',potential_count,'visitor',visitor_count,'interested',interested_count,'buyer',buyer_count,'loyal',loyal_count),
  'firstPurchaseMembers',first_count,'memberCount',first_count+buyer_count);
end $$;

revoke all on function private.customer_segment_references_available(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_list_customer_segments(text,text,text,text,boolean,integer,integer),public.admin_customer_segment_overview() from public,anon,authenticated,service_role;
grant execute on function public.admin_list_customer_segments(text,text,text,text,boolean,integer,integer),public.admin_customer_segment_overview() to authenticated;
select private.register_operator_rpc_contract('public.admin_list_customer_segments(text,text,text,text,boolean,integer,integer)'::regprocedure,'marketing.manage','read',false);
select private.register_operator_rpc_contract('public.admin_customer_segment_overview()'::regprocedure,'marketing.manage','read',false);
commit;
