-- Customer segments persist reusable rules, never a browser-visible recipient list.
-- Estimates are observations; execution must reevaluate the current customer state.
create table private.customer_segment_estimates (
 id uuid primary key,
 actor_id uuid references public.profiles(id) on delete set null,
 rule_version integer not null check(rule_version=1),
 rule jsonb not null,
 rule_hash text not null check(rule_hash ~ '^[0-9a-f]{64}$'),
 evaluated_at timestamptz not null,
 matched_count bigint not null check(matched_count>=0),
 consented_count bigint not null check(consented_count>=0 and consented_count<=matched_count),
 valid_until timestamptz not null check(valid_until>evaluated_at)
);
create index customer_segment_estimate_history on private.customer_segment_estimates(rule_hash,evaluated_at desc,id desc);
create table private.customer_segments (
 id uuid primary key,
 reference bigint generated always as identity unique,
 name text not null check(char_length(btrim(name)) between 1 and 50),
 preset_key text unique,
 rule_version integer not null check(rule_version=1),
 rule jsonb not null,
 rule_hash text not null check(rule_hash ~ '^[0-9a-f]{64}$'),
 revision integer not null default 1 check(revision>0),
 estimate_id uuid references private.customer_segment_estimates(id),
 created_by uuid references public.profiles(id) on delete set null,
 updated_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 archived_at timestamptz
);
create index customer_segments_active on private.customer_segments(updated_at desc,id desc) where archived_at is null;
create table private.customer_segment_favorites (
 actor_id uuid not null references public.profiles(id) on delete cascade,
 segment_id uuid not null references private.customer_segments(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,segment_id)
);
alter table private.customer_segment_estimates enable row level security;
alter table private.customer_segments enable row level security;
alter table private.customer_segment_favorites enable row level security;
revoke all on private.customer_segment_estimates,private.customer_segments,private.customer_segment_favorites from public,anon,authenticated,service_role;

create function private.normalize_customer_segment_rule(p_rule jsonb)
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
 if target not in ('first_purchase','cart_unpurchased','wishlist_unpurchased','unused_coupon','ip_notifications','purchased','first_purchase_recent','lapsed_purchase','repeat_purchase')
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
  or (target not in ('cart_unpurchased','wishlist_unpurchased','purchased') and scope<>'all') then
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
   or target not in ('cart_unpurchased','wishlist_unpurchased') then raise invalid_parameter_value using message='invalid_customer_segment_rule';end if;
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
 return jsonb_build_object('version',1,'target',target,'goodsScope',scope,'goodIds',to_jsonb(good_ids),'categoryId',category_id,
  'months',months,'activityDays',days,'grades',to_jsonb(grades),'ageBands',to_jsonb(age_bands),'ipId',ip_id,'couponCode',coupon_code);
end $$;
revoke all on function private.normalize_customer_segment_rule(jsonb) from public,anon,authenticated,service_role;

create function private.customer_segment_rule_hash(p_rule jsonb)
returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest(convert_to(private.normalize_customer_segment_rule(p_rule)::text,'UTF8'),'sha256'),'hex');
$$;
revoke all on function private.customer_segment_rule_hash(jsonb) from public,anon,authenticated,service_role;
create function private.customer_segment_group(p_target text)
returns text language sql immutable set search_path='' as $$
 select case when p_target='first_purchase' then 'visitor'
  when p_target in ('cart_unpurchased','wishlist_unpurchased','unused_coupon','ip_notifications') then 'interested'
  when p_target in ('purchased','first_purchase_recent','lapsed_purchase') then 'buyer'
  when p_target='repeat_purchase' then 'loyal' end;
$$;
revoke all on function private.customer_segment_group(text) from public,anon,authenticated,service_role;

create function private.customer_segment_references_available(p_rule jsonb)
returns boolean language sql stable security definer set search_path='' as $$
 select (p_rule->>'goodsScope'<>'goods' or not exists(select 1 from jsonb_array_elements_text(p_rule->'goodIds') requested(id)
   where not exists(select 1 from public.goods good where good.id=requested.id)))
  and (p_rule->>'goodsScope'<>'category' or exists(select 1 from public.catalog_categories where id=(p_rule->>'categoryId')::uuid))
  and (p_rule->>'ipId' is null or exists(select 1 from public.ips where id=p_rule->>'ipId'))
  and (p_rule->>'couponCode' is null or exists(select 1 from public.coupons where code=p_rule->>'couponCode'));
$$;
revoke all on function private.customer_segment_references_available(jsonb) from public,anon,authenticated,service_role;

create function private.customer_segment_members(p_rule jsonb,p_at timestamptz)
returns table(customer_id uuid,marketing_consent boolean) language plpgsql stable security definer set search_path='' as $$
declare rule jsonb:=private.normalize_customer_segment_rule(p_rule); target text; months integer; days integer; period_start timestamptz;
begin
 if p_at is null or not isfinite(p_at) then raise invalid_parameter_value using message='invalid_customer_segment_time';end if;
 if not private.customer_segment_references_available(rule) then raise object_not_in_prerequisite_state using message='customer_segment_target_unavailable';end if;
 target:=rule->>'target';months:=(rule->>'months')::integer;days:=(rule->>'activityDays')::integer;
 period_start:=case when months is not null then ((p_at at time zone 'Asia/Seoul')-make_interval(months=>months)) at time zone 'Asia/Seoul' end;
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
  else false end;
end $$;
revoke all on function private.customer_segment_members(jsonb,timestamptz) from public,anon,authenticated,service_role;

-- Reusable execution boundary: a caller must bind the expected definition.
-- This function is not exposed to authenticated/service clients. A downstream
-- publisher must call it inside its own current-authority and delivery guards.
create function private.customer_segment_execution_members(p_segment_id uuid,p_expected_revision integer,p_expected_hash text)
returns table(customer_id uuid) language plpgsql stable security definer set search_path='' as $$
declare segment private.customer_segments;
begin
 select * into segment from private.customer_segments where id=p_segment_id and archived_at is null;
 if not found then raise no_data_found using message='customer_segment_not_found';end if;
 if segment.revision is distinct from p_expected_revision or segment.rule_hash is distinct from p_expected_hash then
  raise sqlstate 'PT409' using message='customer_segment_changed';end if;
 return query select members.customer_id from private.customer_segment_members(segment.rule,statement_timestamp()) members where members.marketing_consent;
end $$;
revoke all on function private.customer_segment_execution_members(uuid,integer,text) from public,anon,authenticated,service_role;

create function private.customer_segment_estimate_document(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'ruleVersion',rule_version,'ruleHash',rule_hash,'evaluatedAt',evaluated_at,
  'matchedCount',matched_count,'consentedCount',consented_count,'validUntil',valid_until) from private.customer_segment_estimates where id=p_id;
$$;
revoke all on function private.customer_segment_estimate_document(uuid) from public,anon,authenticated,service_role;
create function private.customer_segment_document(p_id uuid,p_actor uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.id,'reference',s.reference,'name',s.name,'presetKey',s.preset_key,'ruleVersion',s.rule_version,
  'rule',s.rule,'ruleHash',s.rule_hash,'target',s.rule->>'target','group',private.customer_segment_group(s.rule->>'target'),'revision',s.revision,
  'available',private.customer_segment_references_available(s.rule),'favorite',exists(select 1 from private.customer_segment_favorites f where f.actor_id=p_actor and f.segment_id=s.id),
  'estimate',private.customer_segment_estimate_document((select e.id from private.customer_segment_estimates e where e.rule_hash=s.rule_hash order by e.evaluated_at desc,e.id desc limit 1)),'createdAt',s.created_at,'updatedAt',s.updated_at)
 from private.customer_segments s where s.id=p_id and s.archived_at is null;
$$;
revoke all on function private.customer_segment_document(uuid,uuid) from public,anon,authenticated,service_role;

-- Supported templates have stable identifiers. Uncollected visitor/prediction
-- data is not seeded as fictional customers or empty audience observations.
insert into private.customer_segments(id,name,preset_key,rule_version,rule,rule_hash)
select md5('icons-customer-segment:'||key)::uuid,label,key,1,rule,private.customer_segment_rule_hash(rule)
from (select key,label,private.normalize_customer_segment_rule(jsonb_build_object('version',1,'target',key)||settings) rule from (values
 ('first_purchase','가입 회원 중 첫구매 대상','{}'::jsonb),
 ('cart_unpurchased','장바구니에 담은 후 아직 구매하지 않은 회원','{}'::jsonb),
 ('wishlist_unpurchased','찜한 후 아직 구매하지 않은 회원','{}'::jsonb),
 ('unused_coupon','사용 가능한 미사용 쿠폰을 가진 회원','{}'::jsonb),
 ('ip_notifications','IP 알림을 구독하는 회원','{}'::jsonb),
 ('purchased','유효한 구매 이력이 있는 회원','{}'::jsonb),
 ('first_purchase_recent','최근 1개월 내 첫구매한 회원','{"months":1}'::jsonb),
 ('lapsed_purchase','마지막 구매 후 3개월이 지난 회원','{"months":3}'::jsonb),
 ('repeat_purchase','유효한 주문을 2회 이상 한 회원','{}'::jsonb)
) presets(key,label,settings)) normalized;

create function public.admin_customer_segment_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare at_value timestamptz:=statement_timestamp(); interested_count bigint; buyer_count bigint; loyal_count bigint; first_count bigint;
begin
 if not public.has_operator_capability('marketing.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 select count(*) into first_count from private.customer_segment_members('{"version":1,"target":"first_purchase"}',at_value);
 select count(*) into buyer_count from private.customer_segment_members('{"version":1,"target":"purchased"}',at_value);
 select count(*) into loyal_count from private.customer_segment_members('{"version":1,"target":"repeat_purchase"}',at_value);
 select count(distinct customer_id) into interested_count from (
  select customer_id from private.customer_segment_members('{"version":1,"target":"cart_unpurchased"}',at_value)
  union all select customer_id from private.customer_segment_members('{"version":1,"target":"wishlist_unpurchased"}',at_value)
  union all select customer_id from private.customer_segment_members('{"version":1,"target":"unused_coupon"}',at_value)
  union all select customer_id from private.customer_segment_members('{"version":1,"target":"ip_notifications"}',at_value)
 ) interested;
 return jsonb_build_object('checkedAt',at_value,'groups',jsonb_build_object('potential',null,'visitor',null,'interested',interested_count,'buyer',buyer_count,'loyal',loyal_count),
  'firstPurchaseMembers',first_count,'memberCount',first_count+buyer_count);
end $$;
revoke all on function public.admin_customer_segment_overview() from public,anon,authenticated,service_role;
grant execute on function public.admin_customer_segment_overview() to authenticated;

create function public.admin_estimate_customer_segment(p_rule jsonb,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; rule jsonb; hash text; existing private.customer_segment_estimates; at_value timestamptz:=statement_timestamp(); matched bigint; consented bigint;
begin
 actor:=private.require_operator_capability('marketing.manage',false);
 if p_operation_id is null then raise invalid_parameter_value using message='invalid_customer_segment_operation';end if;
 rule:=private.normalize_customer_segment_rule(p_rule);hash:=private.customer_segment_rule_hash(rule);
 perform pg_advisory_xact_lock(hashtextextended('customer-segment-estimate:'||p_operation_id::text,0));
 select * into existing from private.customer_segment_estimates where id=p_operation_id;
 if found then
  if existing.actor_id=actor and existing.rule_hash=hash and existing.rule=rule then return private.customer_segment_estimate_document(existing.id);end if;
  raise sqlstate 'PT409' using message='customer_segment_operation_conflict';
 end if;
 select count(*),count(*) filter(where marketing_consent) into matched,consented from private.customer_segment_members(rule,at_value);
 insert into private.customer_segment_estimates(id,actor_id,rule_version,rule,rule_hash,evaluated_at,matched_count,consented_count,valid_until)
 values(p_operation_id,actor,1,rule,hash,at_value,matched,consented,at_value+interval '15 minutes');
 return private.customer_segment_estimate_document(p_operation_id);
end $$;
revoke all on function public.admin_estimate_customer_segment(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_estimate_customer_segment(jsonb,uuid) to authenticated;

create function public.admin_save_customer_segment(p_id uuid,p_expected_revision integer,p_operation_id uuid,p_name text,p_rule jsonb,p_estimate_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; rule jsonb; hash text; estimate private.customer_segment_estimates; previous private.customer_segments;
 request jsonb; replay jsonb; result jsonb; name_value text:=btrim(p_name); saved_revision integer;
begin
 actor:=private.require_operator_capability('marketing.manage',false);
 if p_id is null or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null or p_estimate_id is null
  or name_value is null or char_length(name_value) not between 1 and 50 or name_value ~ '[[:cntrl:]]' then
  raise invalid_parameter_value using message='invalid_customer_segment';end if;
 rule:=private.normalize_customer_segment_rule(p_rule);hash:=private.customer_segment_rule_hash(rule);
 request:=jsonb_build_object('id',p_id,'expectedRevision',p_expected_revision,'name',name_value,'rule',rule,'estimateId',p_estimate_id);
 perform pg_advisory_xact_lock(hashtextextended('customer-segment-operation:'||p_operation_id::text,0));
 replay:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.customer_segment.saved',request);
 if replay is not null then return replay;end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-segment-catalog',0));
 select * into previous from private.customer_segments where id=p_id for update;
 if found then
  if previous.archived_at is not null then raise no_data_found using message='customer_segment_not_found';end if;
  if previous.preset_key is not null then raise insufficient_privilege using message='customer_segment_preset_readonly';end if;
  if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='customer_segment_changed';end if;
 elsif p_expected_revision<>0 then raise no_data_found using message='customer_segment_not_found';
 elsif (select count(*) from private.customer_segments where archived_at is null and preset_key is null)>=1000 then
  raise check_violation using message='customer_segment_limit';
 end if;
 select * into estimate from private.customer_segment_estimates where id=p_estimate_id;
 if not found or estimate.actor_id is distinct from actor or estimate.rule_hash<>hash or estimate.rule<>rule
  or estimate.valid_until<=clock_timestamp() then raise object_not_in_prerequisite_state using message='customer_segment_estimate_required';end if;
 if not private.customer_segment_references_available(rule) then raise object_not_in_prerequisite_state using message='customer_segment_target_unavailable';end if;
 if previous.id is null then
  insert into private.customer_segments(id,name,rule_version,rule,rule_hash,estimate_id,created_by,updated_by)
  values(p_id,name_value,1,rule,hash,p_estimate_id,actor,actor) returning revision into saved_revision;
 else
  update private.customer_segments set name=name_value,rule_version=1,rule=rule,rule_hash=hash,estimate_id=p_estimate_id,
   revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where id=p_id returning revision into saved_revision;
 end if;
 result:=jsonb_build_object('id',p_id,'revision',saved_revision,'ruleHash',hash);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.customer_segment.saved','customer_segment:'||p_id::text,
  jsonb_build_object('request',request,'previousRuleHash',previous.rule_hash,'result',result));
 return result;
end $$;
revoke all on function public.admin_save_customer_segment(uuid,integer,uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_customer_segment(uuid,integer,uuid,text,jsonb,uuid) to authenticated;

create function public.admin_archive_customer_segments(p_entries jsonb,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; entry jsonb; ids uuid[]:='{}'::uuid[]; id_value uuid; previous private.customer_segments; request jsonb; replay jsonb; result jsonb;
begin
 actor:=private.require_operator_capability('marketing.manage',false);
 if p_operation_id is null or p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 100 then
  raise invalid_parameter_value using message='invalid_customer_segment_archive';end if;
 for entry in select value from jsonb_array_elements(p_entries) loop
  if jsonb_typeof(entry)<>'object' or not(entry ?& array['id','revision']) or (select count(*) from jsonb_object_keys(entry))<>2
   or jsonb_typeof(entry->'id')<>'string' or (entry->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(entry->'revision')<>'number' or (entry->>'revision')!~'^[1-9][0-9]{0,8}$' then
   raise invalid_parameter_value using message='invalid_customer_segment_archive';end if;
  id_value:=(entry->>'id')::uuid;
  if id_value=any(ids) then raise invalid_parameter_value using message='invalid_customer_segment_archive';end if;
  ids:=array_append(ids,id_value);
 end loop;
 select jsonb_agg(value order by value->>'id') into request from jsonb_array_elements(p_entries);
 perform pg_advisory_xact_lock(hashtextextended('customer-segment-operation:'||p_operation_id::text,0));
 replay:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.customer_segments.archived',request);
 if replay is not null then return replay;end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-segment-catalog',0));
 for id_value in select value from unnest(ids) value order by value loop
  select * into previous from private.customer_segments where id=id_value for update;
  if not found or previous.archived_at is not null then raise no_data_found using message='customer_segment_not_found';end if;
  if previous.preset_key is not null then raise insufficient_privilege using message='customer_segment_preset_readonly';end if;
  if previous.revision<>(select (value->>'revision')::integer from jsonb_array_elements(request) where (value->>'id')::uuid=id_value) then
   raise sqlstate 'PT409' using message='customer_segment_changed';end if;
 end loop;
 update private.customer_segments set archived_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where id=any(ids);
 delete from private.customer_segment_favorites where segment_id=any(ids);
 result:=jsonb_build_object('archivedCount',cardinality(ids));
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.customer_segments.archived','customer_segments',jsonb_build_object('request',request,'result',result));
 return result;
end $$;
revoke all on function public.admin_archive_customer_segments(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_archive_customer_segments(jsonb,uuid) to authenticated;

create function public.admin_set_customer_segment_favorite(p_segment_id uuid,p_favorite boolean)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;
begin
 actor:=private.require_operator_capability('marketing.manage',false);
 if p_segment_id is null or p_favorite is null then raise invalid_parameter_value using message='invalid_customer_segment_favorite';end if;
 perform 1 from private.customer_segments where id=p_segment_id and archived_at is null for share;
 if not found then raise no_data_found using message='customer_segment_not_found';end if;
 if p_favorite then
  if exists(select 1 from private.customer_segment_favorites where actor_id=actor and segment_id=p_segment_id) then return true;end if;
  if (select count(*) from private.customer_segment_favorites where actor_id=actor)>=3 then raise check_violation using message='customer_segment_favorite_limit';end if;
  insert into private.customer_segment_favorites(actor_id,segment_id) values(actor,p_segment_id);
 else delete from private.customer_segment_favorites where actor_id=actor and segment_id=p_segment_id;end if;
 return p_favorite;
end $$;
revoke all on function public.admin_set_customer_segment_favorite(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_set_customer_segment_favorite(uuid,boolean) to authenticated;

create function public.admin_list_customer_segments(p_query text default '',p_group text default 'all',p_target text default 'all',p_kind text default 'all',p_favorite_only boolean default false,p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb; q text:=btrim(coalesce(p_query,''));
begin
 if not public.has_operator_capability('marketing.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 if length(q)>100 or p_group is null or p_group not in ('all','potential','visitor','interested','buyer','loyal')
  or p_target is null or p_target not in ('all','first_purchase','cart_unpurchased','wishlist_unpurchased','unused_coupon','ip_notifications','purchased','first_purchase_recent','lapsed_purchase','repeat_purchase')
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
revoke all on function public.admin_list_customer_segments(text,text,text,text,boolean,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_customer_segments(text,text,text,text,boolean,integer,integer) to authenticated;

create function public.admin_get_customer_segment(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); segment private.customer_segments; months jsonb; choices jsonb; at_value timestamptz:=statement_timestamp();
begin
 if not public.has_operator_capability('marketing.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 select * into segment from private.customer_segments where id=p_id and archived_at is null;
 if not found then return null;end if;
 with calendar as (select date_trunc('month',at_value at time zone 'Asia/Seoul')-make_interval(months=>ago) month_start from generate_series(12,0,-1) ago),
 observations as (
  select calendar.month_start,observation.* from calendar left join lateral (
   select e.evaluated_at,e.matched_count,e.consented_count from private.customer_segment_estimates e
   where e.rule_hash=segment.rule_hash and e.evaluated_at>=calendar.month_start at time zone 'Asia/Seoul'
    and e.evaluated_at<(calendar.month_start+interval '1 month') at time zone 'Asia/Seoul' and e.evaluated_at<=at_value
   order by e.evaluated_at desc,e.id desc limit 1
  ) observation on true
 ) select jsonb_agg(jsonb_build_object('month',to_char(month_start,'YYYY-MM'),'evaluatedAt',evaluated_at,
  'matchedCount',matched_count,'consentedCount',consented_count) order by month_start) into months from observations;
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'label',label) order by kind,label,id),'[]'::jsonb) into choices from (
  select 'good'::text kind,g.id,g.name label from public.goods g where segment.rule->'goodIds' ? g.id
  union all select 'category',c.id::text,c.name from public.catalog_categories c where c.id=(segment.rule->>'categoryId')::uuid
  union all select 'ip',ip.id,ip.title from public.ips ip where ip.id=segment.rule->>'ipId'
  union all select 'coupon',c.code,c.name from public.coupons c where c.code=segment.rule->>'couponCode'
 ) selected;
 return jsonb_build_object('segment',private.customer_segment_document(p_id,actor),'history',months,'selectedOptions',choices);
end $$;
revoke all on function public.admin_get_customer_segment(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_customer_segment(uuid) to authenticated;

create function public.admin_customer_segment_options(p_kind text,p_query text default '',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q text:=btrim(coalesce(p_query,'')); result jsonb;
begin
 if not public.has_operator_capability('marketing.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_kind is null or p_kind not in ('good','category','ip','coupon') or length(q)>100 or p_page is null or p_page not between 1 and 1000000 then
  raise invalid_parameter_value using message='invalid_customer_segment_options';end if;
 with candidates as (
  select 'good'::text kind,g.id,g.name label,g.code extra from public.goods g where p_kind='good' and g.archived_at is null and g.sale_restriction='none'
  union all select 'category',c.id::text,c.name,c.code from public.catalog_categories c where p_kind='category' and c.archived_at is null
  union all select 'ip',ip.id,ip.title,'' from public.ips ip where p_kind='ip' and ip.archived_at is null
  union all select 'coupon',c.code,c.name,c.code from public.coupons c where p_kind='coupon' and c.status<>'archived'
 ), matched as materialized(select * from candidates where q='' or position(lower(q) in lower(id||' '||label||' '||extra))>0),
 page_rows as (select * from matched order by label,id limit 20 offset (p_page-1)*20)
 select jsonb_build_object('total',(select count(*) from matched),'page',p_page,'pageSize',20,
  'rows',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'id',id,'label',label,'extra',extra) order by label,id) from page_rows),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.admin_customer_segment_options(text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_customer_segment_options(text,text,integer) to authenticated;

select private.register_operator_rpc_contract('public.admin_customer_segment_overview()','marketing.manage','read',false);
select private.register_operator_rpc_contract('public.admin_estimate_customer_segment(jsonb,uuid)','marketing.manage','write',false);
select private.register_operator_rpc_contract('public.admin_save_customer_segment(uuid,integer,uuid,text,jsonb,uuid)','marketing.manage','write',false);
select private.register_operator_rpc_contract('public.admin_archive_customer_segments(jsonb,uuid)','marketing.manage','write',false);
select private.register_operator_rpc_contract('public.admin_set_customer_segment_favorite(uuid,boolean)','marketing.manage','write',false);
select private.register_operator_rpc_contract('public.admin_list_customer_segments(text,text,text,text,boolean,integer,integer)','marketing.manage','read',false);
select private.register_operator_rpc_contract('public.admin_get_customer_segment(uuid)','marketing.manage','read',false);
select private.register_operator_rpc_contract('public.admin_customer_segment_options(text,text,integer)','marketing.manage','read',false);
do $$ declare f record;
begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and (p.proname like 'customer_segment_%' or p.proname='normalize_customer_segment_rule') loop
  perform private.register_operator_internal_contract(f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
