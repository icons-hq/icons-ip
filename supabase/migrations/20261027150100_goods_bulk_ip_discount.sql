-- IP-wide instant discount: one IP expands to every live good of that IP (up to
-- 1,000, beyond the 100-item selection limit). Every discount preview now freezes
-- a per-good skip reason (overlapping active discount, no active option, invalid
-- discounted price); commit applies only the remaining goods and returns the
-- skipped list instead of cancelling the whole batch. Discount guards ignore
-- stock movement, so ordinary sales between preview and commit do not reject
-- a large IP batch, while option prices and discount periods remain guarded.
-- A discount-stop preview shows the current/upcoming discounts each good will
-- lose (including individually set ones) and skips goods with none. A base
-- price change on a good with a current/upcoming discount is refused already
-- at preview with the same code the option price guard raises at commit.
begin;

create function private.goods_bulk_price_fingerprint(p_good text) returns text
language sql stable security definer set search_path='' as $$
 select encode(extensions.digest(jsonb_build_object('good',jsonb_build_object('id',g.id,'price',g.price,'archived',g.archived_at,'ip',g.ip_id),
  'variants',(select jsonb_agg(jsonb_build_object('id',id,'price',price,'archived',archived_at) order by id) from public.goods_variants v where good_id=g.id),
  'periods',(select jsonb_agg(to_jsonb(p) order by id) from private.goods_variant_price_periods p where good_id=g.id)
 )::text,'sha256'),'hex') from public.goods g where id=p_good;
$$;

-- Discounted price without raising: null when the result would not be a valid
-- discount (below 1 won or not lower than the regular price).
create function private.goods_bulk_discount_price(p_price integer,p_values jsonb) returns integer
language plpgsql immutable set search_path='' as $$
declare result numeric;amount numeric:=(p_values->>'value')::numeric;
begin
 result:=case p_values->>'mode' when 'amount' then p_price-amount when 'rate' then floor(p_price*(100-amount)/100) end;
 if result is null or result<1 or result>=p_price then return null;end if;
 return result::integer;
end $$;

CREATE OR REPLACE FUNCTION private.goods_bulk_validate(p_request jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare command text:=p_request->>'command';v jsonb:=p_request->'values';starts timestamptz;ends timestamptz;kind text:=p_request->>'kind';
begin
 if jsonb_typeof(p_request) is distinct from 'object' or not p_request ?& array['kind','ids','command','values']
  or (select count(*) from jsonb_object_keys(p_request))<>4 or jsonb_typeof(p_request->'kind') is distinct from 'string' or jsonb_typeof(p_request->'command') is distinct from 'string' or kind not in ('goods','groups','ip')
  or jsonb_typeof(p_request->'ids') is distinct from 'array'
  or (kind='ip' and jsonb_array_length(p_request->'ids')<>1) or (kind<>'ip' and jsonb_array_length(p_request->'ids') not between 1 and 100)
  or exists(select 1 from jsonb_array_elements(p_request->'ids') i where jsonb_typeof(i)<>'string'
   or case when kind='goods' then i#>>'{}' !~ '^[a-z0-9][a-z0-9-]{0,63}$'
    when kind='ip' then i#>>'{}' !~ '^[a-z0-9][a-z0-9-]{0,99}$'
    else i#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' end)
  or (select count(distinct i) from jsonb_array_elements(p_request->'ids') i)<>jsonb_array_length(p_request->'ids')
  or command not in ('publish','unpublish','start','stop','archive','restore','price','discount','discount_stop','period','dissolve')
  or jsonb_typeof(v) is distinct from 'object' or command='dissolve' and kind<>'groups'
  or kind='ip' and command not in ('discount','discount_stop') then
  raise invalid_parameter_value using message='goods_bulk_invalid';end if;
 if command in ('price','discount') then
  if not v ?& array['mode','value'] or jsonb_typeof(v->'mode') is distinct from 'string' or jsonb_typeof(v->'value') is distinct from 'number'
   or v->>'value' !~ '^[1-9][0-9]*$' or (v->>'value')::numeric>2147483647
   or (command='price' and (v->>'mode' not in ('set','increase','decrease','percent_increase','percent_decrease') or (select count(*) from jsonb_object_keys(v))<>2))
   or (command='discount' and (v->>'mode' not in ('amount','rate') or (select count(*) from jsonb_object_keys(v))<>4))
   or (v->>'mode' in ('percent_decrease','rate') and (v->>'value')::numeric>=100)
   or (v->>'mode'='percent_increase' and (v->>'value')::numeric>1000) then
   raise invalid_parameter_value using message='goods_bulk_invalid';end if;
 elsif command<>'period' and v<>'{}'::jsonb then raise invalid_parameter_value using message='goods_bulk_invalid';end if;
 if command in ('period','discount') then
  if not v ?& array['startsAt','endsAt'] or command='period' and (select count(*) from jsonb_object_keys(v))<>2 then
   raise invalid_parameter_value using message='goods_bulk_invalid';end if;
  if command='period' and v->'startsAt'='null' and v->'endsAt'='null' then return;end if;
  if jsonb_typeof(v->'startsAt') is distinct from 'string' or jsonb_typeof(v->'endsAt') is distinct from 'string'
   or v->>'startsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' or v->>'endsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' then
   raise invalid_parameter_value using message='goods_bulk_invalid';end if;
  starts:=(v->>'startsAt')::timestamptz;ends:=(v->>'endsAt')::timestamptz;
  if not isfinite(starts) or not isfinite(ends) or starts>=ends then raise invalid_parameter_value using message='goods_bulk_invalid';end if;
 end if;
end $$;

CREATE OR REPLACE FUNCTION public.admin_preview_goods_bulk(p_id uuid,p_request jsonb,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior private.goods_bulk_operations;ids text[];groups jsonb:='[]';rows jsonb:='[]';guards jsonb:='{}';g public.goods;
 next_price integer;min_price integer;max_price integer;next_min integer;next_max integer;expires timestamptz;result jsonb;
 command text:=p_request->>'command';kind text:=p_request->>'kind';target_limit integer;skip text;applied integer:=0;
 window_range tstzrange;discounts jsonb;
begin
 perform private.require_goods_group_identity(p_actor,p_session);
 perform private.goods_bulk_validate(p_request);
 if p_id is null then raise invalid_parameter_value using message='goods_bulk_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-bulk:'||p_id::text,0));
 select * into prior from private.goods_bulk_operations where id=p_id;
 if found then
  if prior.actor_id<>p_actor or prior.session_id<>p_session or prior.request<>p_request then raise sqlstate 'PT409' using message='goods_bulk_operation_conflict';end if;
  if prior.receipt is not null or prior.expires_at<=clock_timestamp() then raise sqlstate 'PT409' using message='goods_bulk_preview_expired';end if;
  return prior.preview;
 end if;
 -- Group membership is stable while expanding the exact selected group set.
 perform pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));
 target_limit:=case when kind='ip' then 1000 else 100 end;
 if kind='groups' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'revision',revision) order by id),'[]') into groups
   from private.goods_groups where id in(select value::uuid from jsonb_array_elements_text(p_request->'ids')) and archived_at is null;
  if jsonb_array_length(groups)<>jsonb_array_length(p_request->'ids') then raise check_violation using message='goods_bulk_group_unavailable';end if;
  select array_agg(distinct good_id order by good_id) into ids from private.goods_group_members
   where group_id in(select value::uuid from jsonb_array_elements_text(p_request->'ids'));
 elsif kind='ip' then
  -- The IP filter result: every non-archived good of that IP at preview time.
  if not exists(select 1 from public.ips where id=p_request->'ids'->>0 and archived_at is null) then raise check_violation using message='goods_bulk_ip_unavailable';end if;
  select array_agg(id order by id) into ids from public.goods where ip_id=p_request->'ids'->>0 and archived_at is null;
 else select array_agg(value order by value) into ids from jsonb_array_elements_text(p_request->'ids');end if;
 if coalesce(cardinality(ids),0) not between 1 and target_limit then raise check_violation using message='goods_bulk_target_limit';end if;
 if (select count(*) from public.goods where id=any(ids))<>cardinality(ids) then raise check_violation using message='goods_bulk_good_unavailable';end if;
 if command='discount' then window_range:=tstzrange((p_request#>>'{values,startsAt}')::timestamptz,(p_request#>>'{values,endsAt}')::timestamptz,'[)');end if;
 -- One statement owns both the summary and fingerprint to avoid torn previews.
 for g in select * from public.goods where id=any(ids) order by id for share nowait loop
  perform 1 from public.goods_variants where good_id=g.id order by id for share nowait;
  if g.archived_at is not null and command not in ('restore','archive','dissolve') then raise check_violation using message='good_archived';end if;
  next_price:=case when command='price' then private.goods_bulk_price(g.price,p_request->'values') else g.price end;
  select min(price),max(price) into min_price,max_price from public.goods_variants where good_id=g.id and archived_at is null;
  next_min:=min_price;next_max:=max_price;skip:=null;discounts:=null;
  if command='price' then
   -- Same predicate as private.guard_goods_variant_period_price (every option, current or upcoming).
   if exists(select 1 from private.goods_variant_price_periods p where p.good_id=g.id and p.state='active' and p.ends_at>statement_timestamp()) then
    raise check_violation using message='active_price_period_requires_reset';end if;
   if g.compare_at_price is not null and g.compare_at_price<=next_price then raise check_violation using message='goods_compare_at_price_invalid';end if;
   if exists(select 1 from public.goods_variants where good_id=g.id and (price<g.price or price::bigint-g.price+next_price>2147483647)) then
    raise check_violation using message='goods_bulk_price_invalid';end if;
   next_min:=min_price-g.price+next_price;next_max:=max_price-g.price+next_price;
  elsif command='discount' then
   -- A good is skipped (not the whole batch) when it cannot take this discount.
   if min_price is null then skip:='price_period_variant_inactive';
   elsif exists(select 1 from public.goods_variants v join private.goods_variant_price_periods p on p.variant_id=v.id and p.good_id=v.good_id
     where v.good_id=g.id and v.archived_at is null and p.state='active' and tstzrange(p.starts_at,p.ends_at,'[)') && window_range) then skip:='price_period_overlap';
   elsif exists(select 1 from public.goods_variants v where v.good_id=g.id and v.archived_at is null and private.goods_bulk_discount_price(v.price,p_request->'values') is null) then skip:='goods_bulk_price_invalid';
   else next_min:=private.goods_bulk_price(min_price,p_request->'values');next_max:=private.goods_bulk_price(max_price,p_request->'values');end if;
  elsif command='discount_stop' then
   select case when count(*)=0 then null else jsonb_build_object('count',count(*),'minPrice',min(p.discount_price),'maxPrice',max(p.discount_price),
     'startsAt',min(p.starts_at),'endsAt',max(p.ends_at)) end into discounts
    from private.goods_variant_price_periods p where p.good_id=g.id and p.state='active' and p.ends_at>statement_timestamp();
   if discounts is null then skip:='no_active_discount';end if;
  end if;
  if skip is null then applied:=applied+1;end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,'price',g.price,'nextPrice',next_price,
   'priceMin',min_price,'priceMax',max_price,'nextMin',next_min,'nextMax',next_max,'published',g.published_at is not null,
   'archived',g.archived_at is not null,'stopped',g.stock='soldout','skip',skip,'discounts',discounts));
  guards:=guards||jsonb_build_object(g.id,case when command in ('discount','discount_stop') then private.goods_bulk_price_fingerprint(g.id) else private.goods_bulk_fingerprint(g.id) end);
 end loop;
 if applied=0 then raise check_violation using message=case when command='discount_stop' then 'goods_bulk_no_active_discount' else 'goods_bulk_all_skipped' end;end if;
 expires:=clock_timestamp()+interval '15 minutes';
 result:=jsonb_build_object('state','ready','operationId',p_id,'request',p_request,'groups',groups,'goods',rows,'expiresAt',expires);
 insert into private.goods_bulk_operations(id,actor_id,session_id,request,guards,preview,expires_at) values(p_id,p_actor,p_session,p_request,guards,result,expires);
 return result;
end $$;

CREATE OR REPLACE FUNCTION public.admin_commit_goods_bulk(p_id uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare operation private.goods_bulk_operations;ids text[];lock_ids text[];id_value text;group_value jsonb;g public.goods;v public.goods_variants;
 p private.goods_variant_price_periods;command text;values_doc jsonb;payload jsonb;result jsonb;failure text;options jsonb;baseline jsonb;
 skipped_ids text[];skipped jsonb;
begin
 perform private.require_goods_group_identity(p_actor,p_session);
 perform pg_advisory_xact_lock(hashtextextended('goods-bulk:'||p_id::text,0));
 select * into operation from private.goods_bulk_operations where id=p_id for update;
 if not found or operation.actor_id<>p_actor or operation.session_id<>p_session then raise insufficient_privilege using message='goods_bulk_operation_unavailable';end if;
 if operation.receipt is not null then return operation.receipt;end if;
 command:=operation.request->>'command';values_doc:=operation.request->'values';
 select array_agg(key order by key) into ids from jsonb_object_keys(operation.guards) key;
 -- Skips were frozen in the reviewed preview; a preview stored before this
 -- change has no skip key and therefore applies to every good as before.
 select coalesce(array_agg(r->>'id' order by r->>'id'),'{}'),
  coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','name',r->>'name','code',r->'code','reason',r->>'skip') order by r->>'id'),'[]')
  into skipped_ids,skipped from jsonb_array_elements(operation.preview->'goods') r where nullif(r->>'skip','') is not null;
 begin
  perform pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));
  perform private.lock_catalog_category_tree();
  for group_value in select value from jsonb_array_elements(operation.preview->'groups') loop
   perform 1 from private.goods_groups where id=(group_value->>'id')::uuid and revision=(group_value->>'revision')::bigint and archived_at is null for update nowait;
   if not found then raise sqlstate 'PT409' using message='goods_bulk_changed';end if;
  end loop;
  select array_agg(distinct id order by id) into lock_ids from (select unnest(ids) id union select private.goods_aggregation_owner(unnest(ids))) members;
  foreach id_value in array lock_ids loop
   if not pg_try_advisory_xact_lock(hashtextextended('admin_good:'||id_value,0)) then raise sqlstate 'PT409' using message='goods_bulk_busy';end if;
  end loop;
  perform 1 from public.goods where id=any(lock_ids) order by id for update nowait;
  perform 1 from public.goods_variants where good_id=any(ids) order by id for update nowait;
  perform 1 from private.goods_variant_price_periods where good_id=any(ids) order by id for update nowait;
  perform 1 from public.ips where id in(select ip_id from public.goods where id=any(ids)) order by id for update nowait;
  -- Recheck expiration after lock acquisition, and reject the entire batch if
  -- an option, stock, discount, membership or catalog value changed meanwhile.
  -- Discount commands guard prices, options and periods but not stock.
  if operation.expires_at<=clock_timestamp() then raise sqlstate 'PT409' using message='goods_bulk_preview_expired';end if;
  -- A discount preview stored before this migration carries a full fingerprint
  -- and is rejected here as changed, which only asks the operator to re-review.
  if exists(select 1 from unnest(ids) id where (case when command in ('discount','discount_stop')
     then private.goods_bulk_price_fingerprint(id) else private.goods_bulk_fingerprint(id) end) is distinct from operation.guards->>id) then
   raise sqlstate 'PT409' using message='goods_bulk_changed';end if;
  if command='dissolve' then
   for group_value in select value from jsonb_array_elements(operation.preview->'groups') loop
    perform public.admin_archive_goods_group((group_value->>'id')::uuid,(group_value->>'revision')::bigint,
     md5('goods-bulk-group:'||p_id::text||':'||(group_value->>'id'))::uuid,p_actor,p_session);
   end loop;
  else
   for g in select * from public.goods where id=any(ids) and not id=any(skipped_ids) order by id loop
    if command='publish' then perform public.admin_set_good_published(g.id,true);
    elsif command='unpublish' then perform public.admin_set_good_published(g.id,false);
    elsif command='archive' then perform public.admin_archive_good(g.id);
    elsif command='restore' then perform public.admin_unarchive_good(g.id);
    elsif command in ('discount','discount_stop') then
     if command='discount' then
      for v in select * from public.goods_variants where good_id=g.id and archived_at is null order by id loop
       perform public.admin_save_goods_price_period(g.id,v.id,null,jsonb_build_object('state','active',
        'discountPrice',private.goods_bulk_price(v.price,values_doc),'startsAt',values_doc->'startsAt','endsAt',values_doc->'endsAt'),null);
      end loop;
     else
      for p in select * from private.goods_variant_price_periods where good_id=g.id and state='active' order by id loop
       perform public.admin_save_goods_price_period(g.id,p.variant_id,p.id,jsonb_build_object('state','disabled',
        'discountPrice',p.discount_price,'startsAt',p.starts_at,'endsAt',p.ends_at),p.revision);
      end loop;
     end if;
    else
     payload:=to_jsonb(g)||jsonb_build_object('previous_id',g.id,'publish',null,'custom_inputs_expected_revision',g.custom_inputs_revision);
     if command='start' then payload:=payload||'{"stock":"ok"}'::jsonb;
     elsif command='stop' then payload:=payload||'{"stock":"soldout"}'::jsonb;
     elsif command='period' then payload:=payload||jsonb_build_object('sale_period',values_doc||jsonb_build_object('expectedRevision',g.sale_period_revision));
     elsif command='price' then
      select jsonb_agg(jsonb_build_object('id',id,'name',name,'attributes',attributes,'code',code,'extraPrice',price-g.price,
       'stockQty',stock_qty,'expectedStockQty',stock_qty,'isActive',archived_at is null,'lowStockThreshold',low_stock_threshold)
       order by is_default desc,sort_order,id) into options from public.goods_variants where good_id=g.id;
      select coalesce(jsonb_agg(id::text order by id),'[]') into baseline from public.goods_variants where good_id=g.id and archived_at is null;
      payload:=payload||jsonb_build_object('price',private.goods_bulk_price(g.price,values_doc),'variants',options,'variant_baseline',baseline);
     end if;
     perform public.admin_save_good(payload);
    end if;
   end loop;
  end if;
  result:=jsonb_build_object('state','completed','operationId',p_id,'goodsCount',cardinality(ids)-cardinality(skipped_ids),'groupsCount',jsonb_array_length(operation.preview->'groups'),'error',null)
   ||case when command in ('discount','discount_stop') then jsonb_build_object('skipped',skipped) else '{}'::jsonb end;
  insert into public.audit_log(actor_id,action,target,diff) values(p_actor,'catalog.goods_bulk.completed','goods_bulk:'||p_id::text,
   jsonb_build_object('request',operation.request,'preview',operation.preview,'receipt',result));
 exception when others then
  -- The subtransaction rolls back every product and child-operation change.
  -- Persist a terminal rejection so an uncertain network reply cannot replay it.
  get stacked diagnostics failure=message_text;
  result:=jsonb_build_object('state','rejected','operationId',p_id,'goodsCount',0,'groupsCount',0,
   'error',case when failure ~ '^[a-z][a-z0-9_]{0,100}$' then failure else 'goods_bulk_rejected' end);
 end;
 update private.goods_bulk_operations set receipt=result where id=p_id;
 return result;
end $$;

revoke all on function private.goods_bulk_price_fingerprint(text),private.goods_bulk_discount_price(integer,jsonb),private.goods_bulk_validate(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid),public.admin_commit_goods_bulk(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid),public.admin_commit_goods_bulk(uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_commit_goods_bulk(uuid,uuid,uuid)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_internal_contract(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.proname in ('goods_bulk_price_fingerprint','goods_bulk_discount_price','goods_bulk_validate','admin_preview_goods_bulk','admin_commit_goods_bulk');
notify pgrst,'reload schema';
commit;
