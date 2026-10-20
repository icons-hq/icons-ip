-- Editor candidates and preview share the storefront option price/supply mapper.
create function private.shopping_story_admin_good(p_good public.goods,p_ip_published boolean,p_ip_archived boolean)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_good.id,'name',p_good.name,'code',p_good.code,'price',p_good.price,
  'compareAtPrice',p_good.compare_at_price,'showDiscountRate',p_good.show_discount_rate,
  'imagePath',p_good.image_path,'bg',p_good.bg,'badge',p_good.badge,'stock',p_good.stock,
  'archived',p_good.archived_at is not null or p_ip_archived,
  'published',p_good.published_at is not null and p_ip_published and p_good.archived_at is null and not p_ip_archived and p_good.sale_restriction='none',
  'variants',coalesce((select jsonb_agg(jsonb_build_object('price',v.price,'pricing',public.goods_variant_pricing(v),'supply',public.goods_variant_supply(v)) order by v.id)
   from public.goods_variants v where v.good_id=p_good.id and v.archived_at is null),'[]'::jsonb));
$$;
revoke all on function private.shopping_story_admin_good(public.goods,boolean,boolean) from public,anon,authenticated,service_role;

create or replace function public.admin_get_shopping_story(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result_value jsonb;
begin
 if not public.has_operator_capability('store.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 if not exists(select 1 from public.shopping_stories where id=p_id and deleted_at is null) then return null;end if;
 result_value:=private.shopping_story_document(p_id);
 return result_value||jsonb_build_object('goods',coalesce((select jsonb_agg(private.shopping_story_admin_good(g,ip.published_at is not null,ip.archived_at is not null) order by g.id)
  from public.shopping_story_goods links join public.goods g on g.id=links.good_id join public.ips ip on ip.id=g.ip_id where links.story_id=p_id),'[]'::jsonb));
end;
$$;
revoke all on function public.admin_get_shopping_story(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_shopping_story(uuid) to authenticated;

create or replace function public.admin_search_shopping_story_goods(p_query text default '',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result_value jsonb;
begin
 if not public.has_operator_capability('store.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 1000000 then raise invalid_parameter_value using message='invalid_shopping_story_goods_search';end if;
 with filtered as (
  select g as good, g.id, g.name, ip.published_at as ip_published_at from public.goods g join public.ips ip on ip.id=g.ip_id
  where g.archived_at is null and ip.archived_at is null and (p_query='' or position(lower(p_query) in lower(g.name||' '||g.code||' '||g.id))>0)
 ), page as (select * from filtered order by name,id limit 20 offset (p_page-1)*20)
 select jsonb_build_object('page',p_page,'pageSize',20,'total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(private.shopping_story_admin_good(p.good,p.ip_published_at is not null,false) order by p.name,p.id) from page p),'[]'::jsonb)) into result_value;
 return result_value;
end;
$$;
revoke all on function public.admin_search_shopping_story_goods(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_shopping_story_goods(text,integer) to authenticated;

do $$ begin
 perform private.register_operator_rpc_contract('public.admin_get_shopping_story(uuid)'::regprocedure,'store.manage','read',false);
 perform private.register_operator_rpc_contract('public.admin_search_shopping_story_goods(text,integer)'::regprocedure,'store.manage','read',false);
 perform private.register_operator_internal_contract('private.shopping_story_admin_good(public.goods,boolean,boolean)'::regprocedure);
end $$;
