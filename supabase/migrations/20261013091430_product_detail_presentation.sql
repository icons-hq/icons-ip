-- PDP configuration is separate from common/listing and manual goods relations.
create function private.product_detail_values_valid(p_section text,p_values jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare entry jsonb; start_day date; end_day date;
begin
 if jsonb_typeof(p_values) is distinct from 'object' then return false;end if;
 if p_section='modules' then
  return coalesce((select count(*)=5 from jsonb_object_keys(p_values))
   and p_values ?& array['reviewSummary','similar','together','categoryPopular','storePopular']
   and not exists(select 1 from jsonb_each(p_values) e where jsonb_typeof(e.value)<>'boolean'),false);
 end if;
 if p_section<>'banner' or (select count(*) from jsonb_object_keys(p_values))<>10
  or not p_values ?& array['enabled','style','title','text','periodEnabled','startsOn','endsOn','targetType','goodIds','categoryIds']
  or jsonb_typeof(p_values->'enabled') is distinct from 'boolean' or jsonb_typeof(p_values->'periodEnabled') is distinct from 'boolean'
  or jsonb_typeof(p_values->'title') is distinct from 'string' or jsonb_typeof(p_values->'text') is distinct from 'string'
  or jsonb_typeof(p_values->'style') is distinct from 'string' or jsonb_typeof(p_values->'targetType') is distinct from 'string'
  or p_values->>'style' not in ('light','dark') or p_values->>'targetType' not in ('all','goods','categories')
  or char_length(p_values->>'title')>10 or char_length(p_values->>'text')>20
  or (p_values->>'title') ~ '[[:cntrl:]]' or (p_values->>'text') ~ '[[:cntrl:]]'
  or (p_values->>'title')<>btrim(p_values->>'title') or (p_values->>'text')<>btrim(p_values->>'text')
  or jsonb_typeof(p_values->'goodIds') is distinct from 'array' or jsonb_typeof(p_values->'categoryIds') is distinct from 'array'
 then return false;end if;
 if jsonb_array_length(p_values->'goodIds')>200 or jsonb_array_length(p_values->'categoryIds')>10 then return false;end if;
 for entry in select value from jsonb_array_elements(p_values->'goodIds') loop
  if jsonb_typeof(entry)<>'string' or entry#>>'{}' !~ '^[a-z0-9][a-z0-9-]{0,199}$' then return false;end if;
 end loop;
 for entry in select value from jsonb_array_elements(p_values->'categoryIds') loop
  if jsonb_typeof(entry)<>'string' or entry#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false;end if;
 end loop;
 if (select count(*)<>count(distinct value) from jsonb_array_elements(p_values->'goodIds'))
  or (select count(*)<>count(distinct value) from jsonb_array_elements(p_values->'categoryIds')) then return false;end if;
 if p_values->>'targetType'<>'goods' and jsonb_array_length(p_values->'goodIds')>0
  or p_values->>'targetType'<>'categories' and jsonb_array_length(p_values->'categoryIds')>0 then return false;end if;
 if (p_values->>'periodEnabled')::boolean then
  if jsonb_typeof(p_values->'startsOn') is distinct from 'string' or jsonb_typeof(p_values->'endsOn') is distinct from 'string'
   or p_values->>'startsOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or p_values->>'endsOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false;end if;
  begin start_day:=(p_values->>'startsOn')::date;end_day:=(p_values->>'endsOn')::date;
  exception when others then return false;end;
  if start_day<date '2000-01-01' or end_day>date '2099-12-31' or start_day>end_day then return false;end if;
 elsif p_values->'startsOn'<>'null'::jsonb or p_values->'endsOn'<>'null'::jsonb then return false;end if;
 return not (p_values->>'enabled')::boolean or (
  char_length(p_values->>'title')>0 and char_length(p_values->>'text')>0
  and (p_values->>'targetType'<>'goods' or jsonb_array_length(p_values->'goodIds')>0)
  and (p_values->>'targetType'<>'categories' or jsonb_array_length(p_values->'categoryIds')>0));
end $$;
revoke all on function private.product_detail_values_valid(text,jsonb) from public,anon,authenticated,service_role;

create table private.product_detail_settings (
 section text primary key check(section in ('banner','modules')),
 values jsonb not null,
 revision bigint not null default 0 check(revision>=0),
 updated_at timestamptz not null default clock_timestamp()
);
create table private.product_detail_banner_goods (
 good_id text primary key references public.goods(id) on update cascade on delete cascade,
 position integer not null unique check(position between 0 and 199)
);
create table private.product_detail_banner_categories (
 category_id uuid primary key references public.catalog_categories(id) on update cascade on delete cascade,
 position integer not null unique check(position between 0 and 9)
);
alter table private.product_detail_settings enable row level security;
alter table private.product_detail_banner_goods enable row level security;
alter table private.product_detail_banner_categories enable row level security;
revoke all on private.product_detail_settings,private.product_detail_banner_goods,private.product_detail_banner_categories from public,anon,authenticated,service_role;
insert into private.product_detail_settings(section,values) values
 ('banner','{"enabled":false,"style":"light","title":"","text":"","periodEnabled":false,"startsOn":null,"endsOn":null,"targetType":"all"}'),
 ('modules','{"reviewSummary":false,"similar":false,"together":false,"categoryPopular":false,"storePopular":false}');

create function private.product_detail_values(p_section text)
returns jsonb language sql stable set search_path='' as $$
 select values||case when p_section='banner' then jsonb_build_object(
  'goodIds',(select coalesce(jsonb_agg(good_id order by position),'[]'::jsonb) from private.product_detail_banner_goods),
  'categoryIds',(select coalesce(jsonb_agg(category_id order by position),'[]'::jsonb) from private.product_detail_banner_categories)) else '{}'::jsonb end
 from private.product_detail_settings where section=p_section;
$$;
revoke all on function private.product_detail_values(text) from public,anon,authenticated,service_role;
create function public.admin_get_product_detail_presentation()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_operator_capability(auth.uid(),'store.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return (select jsonb_build_object('values',jsonb_object_agg(section,private.product_detail_values(section)),
  'revisions',jsonb_object_agg(section,revision)) from private.product_detail_settings);
end $$;
revoke all on function public.admin_get_product_detail_presentation() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_product_detail_presentation() to authenticated;

create function public.admin_save_product_detail_presentation(p_section text,p_values jsonb,p_expected_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous private.product_detail_settings%rowtype; request jsonb; receipt jsonb; before_values jsonb; target text;
begin
 perform private.require_actor_operator_capability(actor,'store.manage',false);
 if p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or private.product_detail_values_valid(p_section,p_values) is distinct from true then
  raise invalid_parameter_value using message='invalid_product_detail_presentation';end if;
 request:=jsonb_build_object('section',p_section,'values',p_values,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('product-detail:operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.product_detail.updated',request);
 if receipt is not null then return receipt;end if;
 select * into previous from private.product_detail_settings where section=p_section for update;
 if not found then raise no_data_found using message='product_detail_missing';end if;
 if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='product_detail_conflict';end if;
 before_values:=private.product_detail_values(p_section);
 if p_section='banner' then
  -- Key-share locks fence draft URL changes while the actual FK list is replaced.
  for target in select value from jsonb_array_elements_text(p_values->'goodIds') order by value loop
   perform 1 from public.goods where id=target for key share;
   if not found then raise no_data_found using message='banner_good_missing';end if;
  end loop;
  for target in select value from jsonb_array_elements_text(p_values->'categoryIds') order by value loop
   perform 1 from public.catalog_categories where id=target::uuid for key share;
   if not found then raise no_data_found using message='banner_category_missing';end if;
  end loop;
  delete from private.product_detail_banner_goods;
  delete from private.product_detail_banner_categories;
  insert into private.product_detail_banner_goods select value,(ordinality-1)::integer from jsonb_array_elements_text(p_values->'goodIds') with ordinality;
  insert into private.product_detail_banner_categories select value::uuid,(ordinality-1)::integer from jsonb_array_elements_text(p_values->'categoryIds') with ordinality;
 end if;
 update private.product_detail_settings set values=case when p_section='banner' then p_values-'goodIds'-'categoryIds' else p_values end,
  revision=revision+1,updated_at=clock_timestamp() where section=p_section;
 receipt:=jsonb_build_object('section',p_section,'values',p_values,'revision',previous.revision+1);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.product_detail.updated','product_detail:'||p_section,
  jsonb_build_object('request',request,'result',receipt,'before',before_values));
 return receipt;
end $$;
revoke all on function public.admin_save_product_detail_presentation(text,jsonb,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_product_detail_presentation(text,jsonb,bigint,uuid) to authenticated;

-- This internal projection follows the same settled-payment evidence as home BEST.
-- Only the public caller's aggregate ranking leaves the database.
create function private.product_detail_paid_orders(p_start timestamptz,p_end timestamptz)
returns table(id uuid,approved_at timestamptz) language sql stable security definer set search_path='' as $$
 select o.id,min(approval.approved_at) as approved_at
 from public.orders o
 join public.payments p on p.purpose='order' and p.ref_id=o.id and p.status='paid' and p.user_id=o.user_id and p.amount=o.total
 join public.payment_attempts a on a.payment_id=p.id and a.purpose='order' and a.ref_id=o.id and a.state='approved'
  and a.amount=p.amount and a.provider=p.provider and a.user_id=o.user_id
 cross join lateral (select coalesce(
  (select min(e.approved_at) from private.payment_provider_evidence e where e.payment_attempt_id=a.id),
  (select b.confirmed_at from public.bank_transfer_confirmations b where b.attempt_id=a.id and b.order_id=o.id and a.provider='bank_transfer')
 ) as approved_at) approval
 where o.status in ('paid','confirmed','shipping','delivered','done') and approval.approved_at>=p_start and approval.approved_at<p_end
  and not exists(select 1 from public.order_cancellation_requests c where c.order_id=o.id
   and c.claim_type in ('cancel','return') and (c.status='completed' or c.stage='completed'))
 group by o.id;
$$;
revoke all on function private.product_detail_paid_orders(timestamptz,timestamptz) from public,anon,authenticated,service_role;

create function public.get_product_detail_presentation(p_good_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare current_good public.goods%rowtype; banner_config jsonb; modules jsonb; banner jsonb:=null; reviews jsonb:=null;
 recommendations jsonb:='{"similar":[],"together":[],"categoryPopular":[],"storePopular":[]}';
 starts_at timestamptz; ends_at timestamptz; next_change timestamptz; target_matches boolean:=false;
 today timestamptz:=date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
 select g.* into current_good from public.goods g join public.ips ip on ip.id=g.ip_id
 where g.id=p_good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
  and ip.archived_at is null and ip.published_at is not null;
 if not found then return null;end if;
 select values into banner_config from private.product_detail_settings where section='banner';
 select values into modules from private.product_detail_settings where section='modules';
 if (banner_config->>'enabled')::boolean then
  target_matches:=banner_config->>'targetType'='all' or (banner_config->>'targetType'='goods'
   and exists(select 1 from private.product_detail_banner_goods where good_id=p_good_id));
  if banner_config->>'targetType'='categories' then
   with recursive public_categories as materialized (select * from public.get_catalog_categories()),
   descendants as (
    select c.id from public_categories c join private.product_detail_banner_categories selected on selected.category_id=c.id
    union select c.id from public_categories c join descendants parent on c.parent_id=parent.id
   ) select exists(select 1 from descendants c where c.id=current_good.category_id
    or exists(select 1 from public.goods_additional_categories a where a.good_id=p_good_id and a.category_id=c.id)) into target_matches;
  end if;
  if (banner_config->>'periodEnabled')::boolean then
   starts_at:=(banner_config->>'startsOn')::date::timestamp at time zone 'Asia/Seoul';
   ends_at:=((banner_config->>'endsOn')::date+1)::timestamp at time zone 'Asia/Seoul';
   if target_matches then select min(moment) into next_change from unnest(array[starts_at,ends_at]) moment where moment>statement_timestamp();end if;
  end if;
  if target_matches and (starts_at is null or starts_at<=statement_timestamp()) and (ends_at is null or ends_at>statement_timestamp()) then
   banner:=jsonb_build_object('style',banner_config->>'style','title',banner_config->>'title','text',banner_config->>'text');
  end if;
 end if;
 if (modules->>'reviewSummary')::boolean then
  select jsonb_build_object('count',count(*),'positiveCount',count(*) filter(where rating>=4),
   'cards',coalesce((select jsonb_agg(card order by has_photo desc,rating desc,created_at desc,id) from (
    select r.id,r.rating,r.created_at,cardinality(r.image_paths)>0 has_photo,
     jsonb_build_object('id',r.id,'rating',r.rating,'body',r.body,'authorName',coalesce(nullif(btrim(p.nickname),''),'구매자'),
      'createdAt',r.created_at,'imagePaths',coalesce(to_jsonb(r.image_paths),'[]'::jsonb)) card
    from public.reviews r left join public.public_profiles p on p.id=r.user_id
    where r.good_id=p_good_id and r.status='visible' and r.rating>=4
    order by cardinality(r.image_paths)>0 desc,r.rating desc,r.created_at desc,r.id limit 10
   ) selected),'[]'::jsonb)) into reviews from public.reviews where good_id=p_good_id and status='visible';
 end if;
 if (modules->>'similar')::boolean or (modules->>'together')::boolean or (modules->>'categoryPopular')::boolean or (modules->>'storePopular')::boolean then
  with eligible as materialized (
   select g.id,g.ip_id,g.category_id,g.created_at from public.goods g join public.ips ip on ip.id=g.ip_id
   where g.id<>p_good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
    and ip.archived_at is null and ip.published_at is not null
  ), category as (
   select c.id from public.get_catalog_categories() c where c.id=current_good.category_id and c.depth>=2
    and not exists(select 1 from public.catalog_categories child where child.parent_id=c.id and child.archived_at is null)
  ), paid as materialized (
   select * from private.product_detail_paid_orders(today-interval '30 days',today)
   where (modules->>'together')::boolean or (modules->>'categoryPopular')::boolean or (modules->>'storePopular')::boolean
  ), quantities as (
   select item.good_id,sum(item.qty::bigint) qty from paid join public.order_items item on item.order_id=paid.id
   join eligible e on e.id=item.good_id group by item.good_id
  ), wishes as (
   select w.good_id,count(*) qty from public.wishlists w join eligible e on e.id=w.good_id group by w.good_id
  ), popular as (
   select e.*,coalesce(q.qty,0) sale_qty,coalesce(w.qty,0) wish_qty from eligible e
   left join quantities q on q.good_id=e.id left join wishes w on w.good_id=e.id
   where coalesce(q.qty,0)>0 or coalesce(w.qty,0)>0
  ), together as (
   select item.good_id,count(distinct paid.id) co_orders,sum(item.qty::bigint) qty
   from paid join public.order_items item on item.order_id=paid.id join eligible e on e.id=item.good_id
   where exists(select 1 from public.order_items source where source.order_id=paid.id and source.good_id=p_good_id)
   group by item.good_id
  ), similar_ids as (
   select e.id from eligible e where (modules->>'similar')::boolean and (e.category_id in(select id from category) or e.ip_id=current_good.ip_id)
   order by coalesce(e.category_id in(select id from category),false) desc,e.created_at desc,e.id limit 30
  ), together_ids as (
   select good_id id from together where (modules->>'together')::boolean order by co_orders desc,qty desc,good_id limit 30
  ), category_ids as (
   select id from popular where (modules->>'categoryPopular')::boolean and category_id in(select id from category)
   order by sale_qty desc,wish_qty desc,created_at desc,id limit 12
  ), store_ids as (
   select id from popular where (modules->>'storePopular')::boolean order by sale_qty desc,wish_qty desc,created_at desc,id limit 12
  ) select jsonb_build_object(
   'similar',case when (select count(*) from similar_ids)>=5 then (select jsonb_agg(id) from similar_ids) else '[]'::jsonb end,
   'together',case when (select count(*) from together_ids)>=5 then (select jsonb_agg(id) from together_ids) else '[]'::jsonb end,
   'categoryPopular',coalesce((select jsonb_agg(id) from category_ids),'[]'::jsonb),
   'storePopular',coalesce((select jsonb_agg(id) from store_ids),'[]'::jsonb)) into recommendations;
  next_change:=least(next_change,today+interval '1 day');
 end if;
 return jsonb_build_object('banner',banner,'reviews',reviews,'recommendations',recommendations,'nextChangeAt',next_change);
end $$;
revoke all on function public.get_product_detail_presentation(text) from public,anon,authenticated,service_role;
grant execute on function public.get_product_detail_presentation(text) to anon,authenticated;

select private.register_operator_rpc_contract('public.admin_get_product_detail_presentation()','store.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_product_detail_presentation(text,jsonb,bigint,uuid)','store.manage','manual',false);
select private.register_operator_internal_contract('private.product_detail_values_valid(text,jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.product_detail_values(text)'::regprocedure);
select private.register_operator_internal_contract('private.product_detail_paid_orders(timestamptz,timestamptz)'::regprocedure);
select private.register_operator_internal_contract('public.get_product_detail_presentation(text)'::regprocedure);
notify pgrst,'reload schema';
