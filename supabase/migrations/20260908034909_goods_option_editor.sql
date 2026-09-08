-- #423/#441: one transaction owns metadata, fulfillment, option inventory, then publication.
alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_options;
revoke all on function private.admin_save_good_before_options(jsonb) from public, anon, authenticated, service_role;

create function private.save_goods_options(target_id text, target_rows jsonb, baseline jsonb, is_new boolean)
returns void language plpgsql security definer set search_path='' as $$
declare
 actor_id uuid:=auth.uid(); good public.goods%rowtype; variant public.goods_variants%rowtype;
 item jsonb; option_id uuid; retained uuid[]:='{}'::uuid[]; ordinal integer:=0; expected_qty integer; desired_qty integer;
 current_ids jsonb; before_rows jsonb; seen_attributes jsonb[]:='{}'::jsonb[]; desired_price bigint;
begin
 if actor_id is null then raise exception 'auth_required' using errcode='28000'; end if;
 if not public.is_staff() then raise exception 'forbidden' using errcode='42501'; end if;
 if target_rows is null or jsonb_typeof(target_rows)<>'array' or jsonb_array_length(target_rows) not between 1 and 100
   or baseline is null or jsonb_typeof(baseline)<>'array' then raise check_violation using message='invalid_goods_options'; end if;
 select * into good from public.goods where id=target_id for update;
 if not found or good.archived_at is not null then raise check_violation using message='good_unavailable'; end if;
 perform 1 from public.goods_variants where good_id=target_id order by id for update;
 select coalesce(jsonb_agg(id::text order by id),'[]') into current_ids from public.goods_variants where good_id=target_id and archived_at is null;
 if not is_new and current_ids is distinct from (select coalesce(jsonb_agg(value order by value),'[]') from jsonb_array_elements_text(baseline)) then
   raise exception 'goods_options_changed' using errcode='40001';
 end if;
 select jsonb_agg(to_jsonb(v) order by v.sort_order,v.id) into before_rows from public.goods_variants v where v.good_id=target_id;
 -- The first submitted row becomes the default. The deferred invariant checks the complete batch.
 update public.goods_variants set is_default=false where good_id=target_id and is_default;
 if is_new then delete from public.goods_variants where good_id=target_id; end if;
 for item in select value from jsonb_array_elements(target_rows) loop
   if jsonb_typeof(item)<>'object' or char_length(btrim(coalesce(item->>'name',''))) not between 1 and 200
     or jsonb_typeof(item->'attributes') is distinct from 'object'
     or exists(select 1 from jsonb_each(item->'attributes') a where char_length(btrim(a.key)) not between 1 and 40
       or jsonb_typeof(a.value)<>'string' or char_length(btrim(a.value#>>'{}')) not between 1 and 80)
     or coalesce(item->>'extraPrice','') !~ '^[0-9]+$' or coalesce(item->>'stockQty','') !~ '^[0-9]+$'
     or char_length(btrim(coalesce(item->>'code','')))>120
     or coalesce(jsonb_typeof(item->'code'),'null') not in ('string','null')
     or item->'attributes'=any(seen_attributes) then raise check_violation using message='invalid_goods_options'; end if;
   seen_attributes:=array_append(seen_attributes,item->'attributes');
   desired_price:=good.price::bigint+(item->>'extraPrice')::bigint;
   desired_qty:=(item->>'stockQty')::integer;
   if desired_price>2147483647 then raise numeric_value_out_of_range using message='invalid_goods_options'; end if;
   option_id:=nullif(item->>'id','')::uuid;
   if option_id is not null then
     select * into variant from public.goods_variants where id=option_id and good_id=target_id and archived_at is null;
     if not found or option_id=any(retained) or coalesce(item->>'expectedStockQty','') !~ '^[0-9]+$' then
       raise check_violation using message='invalid_goods_options'; end if;
     expected_qty:=(item->>'expectedStockQty')::integer;
     -- An untouched quantity is a metadata edit, not an instruction to restore stock sold meanwhile.
     if desired_qty<>expected_qty then
       if variant.stock_qty<>expected_qty then raise exception 'stock_changed' using errcode='40001'; end if;
       perform private.change_goods_variant_stock(target_id,option_id,desired_qty::bigint-variant.stock_qty);
     end if;
     update public.goods_variants set name=btrim(item->>'name'),attributes=item->'attributes',price=desired_price::integer,
       code=coalesce(nullif(item->>'code',''),variant.code),sort_order=ordinal,is_default=(ordinal=0) where id=option_id;
   else
     insert into public.goods_variants(good_id,name,attributes,price,code,sort_order,is_default)
       values(target_id,btrim(item->>'name'),item->'attributes',desired_price::integer,nullif(item->>'code',''),ordinal,ordinal=0)
       returning id into option_id;
     if desired_qty<>0 then perform private.change_goods_variant_stock(target_id,option_id,desired_qty); end if;
   end if;
   retained:=array_append(retained,option_id); ordinal:=ordinal+1;
 end loop;
 for variant in select * from public.goods_variants where good_id=target_id and archived_at is null and not(id=any(retained)) order by id loop
   if exists(select 1 from public.order_items where variant_id=variant.id)
     or exists(select 1 from public.cart_items where variant_id=variant.id)
     or exists(select 1 from public.order_claim_reshipment_items where variant_id=variant.id or source_variant_id=variant.id) then
     update public.goods_variants set archived_at=now() where id=variant.id;
   else
     delete from public.goods_variants where id=variant.id;
   end if;
 end loop;
 insert into public.audit_log(actor_id,action,target,diff) values(actor_id,'admin.good.options_saved','goods:'||target_id,
   jsonb_build_object('before',before_rows,'after',(select jsonb_agg(to_jsonb(v) order by v.sort_order,v.id) from public.goods_variants v where v.good_id=target_id)));
end;
$$;
revoke all on function private.save_goods_options(text,jsonb,jsonb,boolean) from public, anon, authenticated, service_role;

create function public.admin_save_good(target_good jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb; wants_publish boolean:=coalesce((target_good->>'publish')::boolean,false);
begin
 if not(target_good?'variants') then return private.admin_save_good_before_options(target_good); end if;
 saved:=private.admin_save_good_before_options(case when wants_publish then target_good||jsonb_build_object('publish',null) else target_good end);
 perform private.save_goods_options(saved->>'id',target_good->'variants',target_good->'variant_baseline',nullif(btrim(target_good->>'previous_id'),'') is null);
 if wants_publish then perform private.set_good_published(saved->>'id',true); end if;
 return saved||jsonb_build_object('default_variant_code',(select code from public.goods_variants where good_id=saved->>'id' and is_default));
end;
$$;
revoke all on function public.admin_save_good(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;

-- Last saved means the latest metadata save, not a stock update or a recent purchase.
create function public.admin_last_good_notice()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 return (select jsonb_build_object('name',g.name,'notice',jsonb_build_object('maker',g.notice_maker,'origin',g.notice_origin,
   'material',g.notice_material,'size',g.notice_size,'madeOn',g.notice_made_on,'asManager',g.notice_as_manager,'asContact',g.notice_as_contact))
   from public.audit_log a join public.goods g on a.target='goods:'||g.id
   where a.action='catalog.good.upsert' and g.archived_at is null
   order by a.created_at desc,a.id desc limit 1);
end;
$$;
revoke all on function public.admin_last_good_notice() from public, anon, authenticated, service_role;
grant execute on function public.admin_last_good_notice() to authenticated;
