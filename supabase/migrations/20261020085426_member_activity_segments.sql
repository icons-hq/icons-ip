begin;

create or replace function private.normalize_customer_segment_rule(p_rule jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare target text; scope text; good_ids text[]; grades text[]; age_bands integer[]; months integer; days integer;
 category_id uuid; ip_id text; coupon_code text; item jsonb;
begin
 if p_rule is null or jsonb_typeof(p_rule)<>'object' or p_rule->'version' is distinct from '1'::jsonb
  or jsonb_typeof(p_rule->'target') is distinct from 'string'
  or exists(select 1 from jsonb_object_keys(p_rule) key where key not in
   ('version','target','goodsScope','goodIds','categoryId','months','activityDays','grades','ageBands','ipId','couponCode')) then
  raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
 target:=p_rule->>'target';scope:=coalesce(p_rule->>'goodsScope','all');
 if target not in ('first_purchase','cart_unpurchased','wishlist_unpurchased','unused_coupon','ip_notifications','purchased','first_purchase_recent','lapsed_purchase','repeat_purchase','visited','not_visited','product_viewed','video_viewed','similar_product_viewed')
  or scope not in ('all','goods','category')
  or (p_rule ? 'goodsScope' and jsonb_typeof(p_rule->'goodsScope')<>'string')
  or jsonb_typeof(coalesce(p_rule->'goodIds','[]'))<>'array'
  or jsonb_array_length(coalesce(p_rule->'goodIds','[]'))>100
  or jsonb_typeof(coalesce(p_rule->'grades','[]'))<>'array'
  or jsonb_array_length(coalesce(p_rule->'grades','[]'))>4
  or jsonb_typeof(coalesce(p_rule->'ageBands','[]'))<>'array'
  or jsonb_array_length(coalesce(p_rule->'ageBands','[]'))>6 then
  raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
 for item in select value from jsonb_array_elements(coalesce(p_rule->'goodIds','[]')) loop
  if jsonb_typeof(item)<>'string' or (item#>>'{}')!~'^[a-z0-9][a-z0-9-]{0,199}$' then
   raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
 end loop;
 select coalesce(array_agg(value order by value),'{}'::text[]) into good_ids from jsonb_array_elements_text(coalesce(p_rule->'goodIds','[]'));
 if cardinality(good_ids)<>(select count(distinct value) from unnest(good_ids) value) then raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
 for item in select value from jsonb_array_elements(coalesce(p_rule->'grades','[]')) loop
  if jsonb_typeof(item)<>'string' or (item#>>'{}') not in ('welcome','silver','gold','platinum') then raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
 end loop;
 select coalesce(array_agg(value order by value),'{}'::text[]) into grades from jsonb_array_elements_text(coalesce(p_rule->'grades','[]'));
 if cardinality(grades)<>(select count(distinct value) from unnest(grades) value) then raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
 for item in select value from jsonb_array_elements(coalesce(p_rule->'ageBands','[]')) loop
  if jsonb_typeof(item)<>'number' or item::text not in ('10','20','30','40','50','60') then raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
 end loop;
 select coalesce(array_agg(value::integer order by value::integer),'{}'::integer[]) into age_bands from jsonb_array_elements_text(coalesce(p_rule->'ageBands','[]'));
 if cardinality(age_bands)<>(select count(distinct value) from unnest(age_bands) value) then raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
 if coalesce(p_rule->'categoryId','null')<>'null'::jsonb then
  if jsonb_typeof(p_rule->'categoryId')<>'string' or (p_rule->>'categoryId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
  category_id:=(p_rule->>'categoryId')::uuid;
 end if;
 if (scope='all' and (cardinality(good_ids)>0 or category_id is not null))
  or (scope='goods' and (cardinality(good_ids)=0 or category_id is not null))
  or (scope='category' and (category_id is null or cardinality(good_ids)>0))
  or (target not in ('cart_unpurchased','wishlist_unpurchased','purchased','product_viewed','video_viewed','similar_product_viewed') and scope<>'all') then
  raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
 if coalesce(p_rule->'months','null')<>'null'::jsonb then
  if jsonb_typeof(p_rule->'months')<>'number' or (p_rule->'months')::text not in ('1','3','6') then raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
  months:=(p_rule->>'months')::integer;
 end if;
 if (target='first_purchase_recent' and months is null) or (target='lapsed_purchase' and coalesce(months,0) not in (3,6))
  or (target='repeat_purchase' and months is not null and months not in (1,3))
  or (target not in ('first_purchase_recent','lapsed_purchase','repeat_purchase','purchased') and months is not null) then
  raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
 if coalesce(p_rule->'activityDays','null')<>'null'::jsonb then
  if jsonb_typeof(p_rule->'activityDays')<>'number' or (p_rule->'activityDays')::text not in ('7','30','90')
   or target not in ('cart_unpurchased','wishlist_unpurchased','visited','not_visited','product_viewed','video_viewed','similar_product_viewed') then raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
  days:=(p_rule->>'activityDays')::integer;
 end if;
 if coalesce(p_rule->'ipId','null')<>'null'::jsonb then
  if jsonb_typeof(p_rule->'ipId')<>'string' or (p_rule->>'ipId')!~'^[a-z0-9][a-z0-9-]{0,199}$' or target<>'ip_notifications' then raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
  ip_id:=p_rule->>'ipId';
 end if;
 if coalesce(p_rule->'couponCode','null')<>'null'::jsonb then
  if jsonb_typeof(p_rule->'couponCode')<>'string' or (p_rule->>'couponCode')!~'^[A-Z0-9][A-Z0-9-]{2,23}$' or target<>'unused_coupon' then raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
  coupon_code:=p_rule->>'couponCode';
 end if;
 if target in ('visited','not_visited','product_viewed','video_viewed','similar_product_viewed') then days:=coalesce(days,30);end if;
 if target='similar_product_viewed' and scope<>'goods' then raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
 return jsonb_build_object('version',1,'target',target,'goodsScope',scope,'goodIds',to_jsonb(good_ids),'categoryId',category_id,
  'months',months,'activityDays',days,'grades',to_jsonb(grades),'ageBands',to_jsonb(age_bands),'ipId',ip_id,'couponCode',coupon_code);
end $$;

create or replace function private.customer_segment_members(p_rule jsonb,p_at timestamptz)
returns table(customer_id uuid,marketing_consent boolean) language plpgsql stable security definer set search_path='' as $$
declare rule jsonb:=private.normalize_customer_segment_rule(p_rule); target text; months integer; days integer; period_start timestamptz; activity_start timestamptz;
begin
 if p_at is null or not isfinite(p_at) then raise invalid_parameter_value using message='invalid_customer_segment_time';end if;
 if not private.customer_segment_references_available(rule) then raise object_not_in_prerequisite_state using message='customer_segment_target_unavailable';end if;
 target:=rule->>'target';months:=(rule->>'months')::integer;days:=(rule->>'activityDays')::integer;
 period_start:=case when months is not null then ((p_at at time zone 'Asia/Seoul')-make_interval(months=>months)) at time zone 'Asia/Seoul' end;
 activity_start:=greatest(p_at-make_interval(days=>coalesce(days,30)),(((p_at at time zone 'Asia/Seoul')::date-89)::timestamp at time zone 'Asia/Seoul'));
 return query
 with recursive category_tree as (
  select c.id from public.catalog_categories c where c.id=(rule->>'categoryId')::uuid
  union select child.id from public.catalog_categories child join category_tree parent on child.parent_id=parent.id
 ), scope_goods as materialized (
  select g.id from public.goods g where rule->>'goodsScope'='all'
   or (rule->>'goodsScope'='goods' and rule->'goodIds' ? g.id)
   or (rule->>'goodsScope'='category' and exists(select 1 from category_tree c where c.id=g.category_id
     or exists(select 1 from public.goods_additional_categories a where a.good_id=g.id and a.category_id=c.id)))
 ), valid_orders as materialized (
  select o.id,o.user_id,o.created_at from public.orders o where o.status in ('paid','confirmed','shipping','delivered','done') and o.created_at<=p_at
   and exists(select 1 from public.payments p where p.purpose='order' and p.ref_id=o.id and p.user_id=o.user_id and p.status='paid' and p.amount=o.total)
 ), purchase_facts as (
  select o.user_id,count(*) orders,min(o.created_at) first_at,max(o.created_at) last_at from valid_orders o group by o.user_id
 ), candidates as (
  select p.id,p.consents,coalesce(f.orders,0) orders,f.first_at,f.last_at from public.profiles p left join purchase_facts f on f.user_id=p.id
  where p.role='user' and p.onboarded_at is not null and p.suspended_at is null
   and p.consents->'terms'='true'::jsonb and p.consents->'privacy'='true'::jsonb
   and p.birth_date is not null and p.birth_date<=((p_at at time zone 'Asia/Seoul')::date-interval '14 years')::date
   and not exists(select 1 from private.account_action_fences fence where fence.subject_user_id=p.id)
   and (jsonb_array_length(rule->'grades')=0 or rule->'grades' ? p.loyalty_grade::text)
   and (jsonb_array_length(rule->'ageBands')=0 or exists(select 1 from jsonb_array_elements_text(rule->'ageBands') band
    where case when band='60' then extract(year from age((p_at at time zone 'Asia/Seoul')::date,p.birth_date))>=60
      else extract(year from age((p_at at time zone 'Asia/Seoul')::date,p.birth_date))>=band::integer
       and extract(year from age((p_at at time zone 'Asia/Seoul')::date,p.birth_date))<band::integer+10 end))
 ) select c.id,coalesce(c.consents->'marketing'='true'::jsonb,false) from candidates c
 where case target
  when 'first_purchase' then c.orders=0
  when 'purchased' then exists(select 1 from valid_orders o where o.user_id=c.id and (period_start is null or o.created_at>=period_start)
    and (rule->>'goodsScope'='all' or exists(select 1 from public.order_items i join scope_goods g on g.id=i.good_id where i.order_id=o.id)))
  when 'first_purchase_recent' then c.orders>0 and c.first_at>=period_start
  when 'lapsed_purchase' then c.orders>0 and c.last_at<period_start
  when 'repeat_purchase' then c.orders>=2 and (period_start is null or (c.first_at<period_start and c.last_at>=period_start))
  when 'cart_unpurchased' then exists(select 1 from public.cart_items item join scope_goods g on g.id=item.good_id where item.user_id=c.id and item.qty>0
    and item.created_at<=p_at and (days is null or item.created_at>=p_at-make_interval(days=>days))
    and not exists(select 1 from valid_orders o join public.order_items i on i.order_id=o.id where o.user_id=c.id and i.good_id=item.good_id and o.created_at>=item.created_at))
  when 'wishlist_unpurchased' then exists(select 1 from public.wishlists item join scope_goods g on g.id=item.good_id where item.user_id=c.id
    and item.created_at<=p_at and (days is null or item.created_at>=p_at-make_interval(days=>days))
    and not exists(select 1 from valid_orders o join public.order_items i on i.order_id=o.id where o.user_id=c.id and i.good_id=item.good_id and o.created_at>=item.created_at))
  when 'unused_coupon' then exists(select 1 from public.user_coupons held join public.coupons coupon on coupon.code=held.coupon_code
    where held.user_id=c.id and held.status='active' and coupon.status='active' and held.usable_from<=p_at and (held.expires_at is null or held.expires_at>p_at)
      and (rule->>'couponCode' is null or held.coupon_code=rule->>'couponCode'))
  when 'ip_notifications' then exists(select 1 from public.ip_follows follow where follow.user_id=c.id and (follow.notify_drops or follow.notify_events)
    and (rule->>'ipId' is null or follow.ip_id=rule->>'ipId'))
  when 'visited' then exists(select 1 from private.member_activity_consents ac cross join private.member_activity_settings cfg
    where ac.user_id=c.id and ac.choice='accepted' and ac.accepted_at<=p_at and cfg.singleton and cfg.enabled
      and exists(select 1 from private.member_activity_events ev where ev.user_id=c.id and ev.observed_at>=activity_start and ev.observed_at<=p_at and ev.kind='visit'))
  when 'not_visited' then exists(select 1 from private.member_activity_consents ac cross join private.member_activity_settings cfg
    where ac.user_id=c.id and ac.choice='accepted' and ac.accepted_at<=activity_start and cfg.singleton and cfg.enabled and cfg.enabled_since<=activity_start
      and not exists(select 1 from private.member_activity_events ev where ev.user_id=c.id and ev.observed_at>=activity_start and ev.observed_at<=p_at and ev.kind='visit'))
  when 'product_viewed' then exists(select 1 from private.member_activity_consents ac cross join private.member_activity_settings cfg
    where ac.user_id=c.id and ac.choice='accepted' and ac.accepted_at<=p_at and cfg.singleton and cfg.enabled
      and exists(select 1 from private.member_activity_events ev join scope_goods sg on sg.id=ev.target_id
        where ev.user_id=c.id and ev.page_kind='good' and ev.kind='visit' and ev.observed_at>=activity_start and ev.observed_at<=p_at))
  when 'video_viewed' then exists(select 1 from private.member_activity_consents ac cross join private.member_activity_settings cfg
    where ac.user_id=c.id and ac.choice='accepted' and ac.accepted_at<=p_at and cfg.singleton and cfg.enabled
      and exists(select 1 from private.member_activity_events ev join scope_goods sg on sg.id=ev.target_id
        where ev.user_id=c.id and ev.page_kind='good' and ev.kind='video_started' and ev.observed_at>=activity_start and ev.observed_at<=p_at))
  when 'similar_product_viewed' then exists(select 1 from private.member_activity_consents ac cross join private.member_activity_settings cfg
    where ac.user_id=c.id and ac.choice='accepted' and ac.accepted_at<=p_at and cfg.singleton and cfg.enabled
      and exists(select 1 from private.member_activity_events ev where ev.user_id=c.id and ev.page_kind='good' and ev.kind='visit'
        and ev.observed_at>=activity_start and ev.observed_at<=p_at and not (rule->'goodIds' ? ev.target_id)
        and exists(select 1 from public.goods selected where rule->'goodIds' ? selected.id and selected.category_id=ev.category_id)))
  else false end;
end $$;

create or replace function private.customer_segment_group(p_target text) returns text language sql immutable set search_path='' as $$
 select case when p_target in ('not_visited','similar_product_viewed') then 'potential'
  when p_target in ('first_purchase','visited') then 'visitor'
  when p_target in ('cart_unpurchased','wishlist_unpurchased','unused_coupon','ip_notifications','product_viewed','video_viewed') then 'interested'
  when p_target in ('purchased','first_purchase_recent','lapsed_purchase') then 'buyer' when p_target='repeat_purchase' then 'loyal' end;
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
 return jsonb_build_object('checkedAt',at_value,'groups',jsonb_build_object('potential',potential_count,'visitor',visitor_count,'interested',interested_count,'buyer',buyer_count,'loyal',loyal_count),
  'firstPurchaseMembers',first_count,'memberCount',first_count+buyer_count);
end $$;

revoke all on function private.normalize_customer_segment_rule(jsonb),private.customer_segment_members(jsonb,timestamptz),private.customer_segment_group(text) from public,anon,authenticated,service_role;

revoke all on function public.admin_customer_segment_overview() from public,anon,authenticated,service_role;
grant execute on function public.admin_customer_segment_overview() to authenticated;
select private.register_operator_rpc_contract('public.admin_customer_segment_overview()'::regprocedure,'marketing.manage','read',false);

insert into private.customer_segments(id,name,preset_key,rule_version,rule,rule_hash)
 select gen_random_uuid(),name,key,1,rule,private.customer_segment_rule_hash(rule) from (
  select key,name,private.normalize_customer_segment_rule(jsonb_build_object('version',1,'target',key,'activityDays',30)) rule from (values
   ('visited','최근 30일 방문 회원'),('not_visited','최근 30일 미방문 회원'),('product_viewed','최근 30일 상품 조회 회원'),('video_viewed','최근 30일 영상 시청 회원')) x(key,name)
 ) rules;
commit;
