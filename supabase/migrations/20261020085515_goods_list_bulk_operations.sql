-- List operations reuse the existing catalog writers. A frozen preview is also
-- the durable operation identity; uncertain requests are read, never replayed
-- under a newly generated identity.
begin;
create table private.goods_bulk_operations (
 id uuid primary key,
 actor_id uuid not null,
 session_id uuid not null,
 request jsonb not null,
 guards jsonb not null,
 preview jsonb not null,
 receipt jsonb,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '15 minutes'
);
alter table private.goods_bulk_operations enable row level security;
revoke all on private.goods_bulk_operations from public,anon,authenticated,service_role;

create function private.goods_bulk_fingerprint(p_good text) returns text
language sql stable security definer set search_path='' as $$
 select encode(extensions.digest(jsonb_build_object('good',to_jsonb(g),
  'variants',(select jsonb_agg(to_jsonb(v) order by id) from public.goods_variants v where good_id=g.id),
  'periods',(select jsonb_agg(to_jsonb(p) order by id) from private.goods_variant_price_periods p where good_id=g.id),
  'group',(select jsonb_agg(to_jsonb(m) order by group_id) from private.goods_group_members m where good_id=g.id)
 )::text,'sha256'),'hex') from public.goods g where id=p_good;
$$;

create function private.goods_bulk_validate(p_request jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare command text:=p_request->>'command';v jsonb:=p_request->'values';starts timestamptz;ends timestamptz;
begin
 if jsonb_typeof(p_request) is distinct from 'object' or not p_request ?& array['kind','ids','command','values']
  or (select count(*) from jsonb_object_keys(p_request))<>4 or jsonb_typeof(p_request->'kind') is distinct from 'string' or jsonb_typeof(p_request->'command') is distinct from 'string' or p_request->>'kind' not in ('goods','groups')
  or jsonb_typeof(p_request->'ids') is distinct from 'array' or jsonb_array_length(p_request->'ids') not between 1 and 100
  or exists(select 1 from jsonb_array_elements(p_request->'ids') i where jsonb_typeof(i)<>'string'
   or case when p_request->>'kind'='goods' then i#>>'{}' !~ '^[a-z0-9][a-z0-9-]{0,63}$'
    else i#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' end)
  or (select count(distinct i) from jsonb_array_elements(p_request->'ids') i)<>jsonb_array_length(p_request->'ids')
  or command not in ('publish','unpublish','start','stop','archive','restore','price','discount','discount_stop','period','dissolve')
  or jsonb_typeof(v) is distinct from 'object' or command='dissolve' and p_request->>'kind'<>'groups' then
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

create function private.goods_bulk_price(p_price integer,p_values jsonb) returns integer
language plpgsql immutable set search_path='' as $$
declare result numeric;amount numeric:=(p_values->>'value')::numeric;
begin
 result:=case p_values->>'mode' when 'set' then amount when 'increase' then p_price+amount when 'decrease' then p_price-amount
  when 'percent_increase' then floor(p_price*(100+amount)/100) when 'percent_decrease' then floor(p_price*(100-amount)/100)
  when 'amount' then p_price-amount when 'rate' then floor(p_price*(100-amount)/100) end;
 if result is null or result not between 1 and 2147483647 then raise check_violation using message='goods_bulk_price_invalid';end if;
 return result::integer;
end $$;

create function public.admin_preview_goods_bulk(p_id uuid,p_request jsonb,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior private.goods_bulk_operations;ids text[];groups jsonb:='[]';rows jsonb:='[]';guards jsonb:='{}';g public.goods;
 next_price integer;min_price integer;max_price integer;next_min integer;next_max integer;expires timestamptz;result jsonb;
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
 if p_request->>'kind'='groups' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'revision',revision) order by id),'[]') into groups
   from private.goods_groups where id in(select value::uuid from jsonb_array_elements_text(p_request->'ids')) and archived_at is null;
  if jsonb_array_length(groups)<>jsonb_array_length(p_request->'ids') then raise check_violation using message='goods_bulk_group_unavailable';end if;
  select array_agg(distinct good_id order by good_id) into ids from private.goods_group_members
   where group_id in(select value::uuid from jsonb_array_elements_text(p_request->'ids'));
 else select array_agg(value order by value) into ids from jsonb_array_elements_text(p_request->'ids');end if;
 if coalesce(cardinality(ids),0) not between 1 and 100 then raise check_violation using message='goods_bulk_target_limit';end if;
 if (select count(*) from public.goods where id=any(ids))<>cardinality(ids) then raise check_violation using message='goods_bulk_good_unavailable';end if;
 -- One statement owns both the summary and fingerprint to avoid torn previews.
 for g in select * from public.goods where id=any(ids) order by id for share nowait loop
  perform 1 from public.goods_variants where good_id=g.id order by id for share nowait;
  if g.archived_at is not null and p_request->>'command' not in ('restore','archive','dissolve') then raise check_violation using message='good_archived';end if;
  next_price:=case when p_request->>'command'='price' then private.goods_bulk_price(g.price,p_request->'values') else g.price end;
  select min(price),max(price) into min_price,max_price from public.goods_variants where good_id=g.id and archived_at is null;
  next_min:=min_price;next_max:=max_price;
  if p_request->>'command'='price' then
   if g.compare_at_price is not null and g.compare_at_price<=next_price then raise check_violation using message='goods_compare_at_price_invalid';end if;
   if exists(select 1 from public.goods_variants where good_id=g.id and (price<g.price or price::bigint-g.price+next_price>2147483647)) then
    raise check_violation using message='goods_bulk_price_invalid';end if;
   next_min:=min_price-g.price+next_price;next_max:=max_price-g.price+next_price;
  elsif p_request->>'command'='discount' then
   if min_price is null then raise check_violation using message='price_period_variant_inactive';end if;
   next_min:=private.goods_bulk_price(min_price,p_request->'values');next_max:=private.goods_bulk_price(max_price,p_request->'values');
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,'price',g.price,'nextPrice',next_price,
   'priceMin',min_price,'priceMax',max_price,'nextMin',next_min,'nextMax',next_max,'published',g.published_at is not null,
   'archived',g.archived_at is not null,'stopped',g.stock='soldout'));
  guards:=guards||jsonb_build_object(g.id,private.goods_bulk_fingerprint(g.id));
 end loop;
 expires:=clock_timestamp()+interval '15 minutes';
 result:=jsonb_build_object('state','ready','operationId',p_id,'request',p_request,'groups',groups,'goods',rows,'expiresAt',expires);
 insert into private.goods_bulk_operations(id,actor_id,session_id,request,guards,preview,expires_at) values(p_id,p_actor,p_session,p_request,guards,result,expires);
 return result;
end $$;

create function public.admin_commit_goods_bulk(p_id uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare operation private.goods_bulk_operations;ids text[];lock_ids text[];id_value text;group_value jsonb;g public.goods;v public.goods_variants;
 p private.goods_variant_price_periods;command text;values_doc jsonb;payload jsonb;result jsonb;failure text;options jsonb;baseline jsonb;
begin
 perform private.require_goods_group_identity(p_actor,p_session);
 perform pg_advisory_xact_lock(hashtextextended('goods-bulk:'||p_id::text,0));
 select * into operation from private.goods_bulk_operations where id=p_id for update;
 if not found or operation.actor_id<>p_actor or operation.session_id<>p_session then raise insufficient_privilege using message='goods_bulk_operation_unavailable';end if;
 if operation.receipt is not null then return operation.receipt;end if;
 command:=operation.request->>'command';values_doc:=operation.request->'values';
 select array_agg(key order by key) into ids from jsonb_object_keys(operation.guards) key;
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
  if operation.expires_at<=clock_timestamp() then raise sqlstate 'PT409' using message='goods_bulk_preview_expired';end if;
  if exists(select 1 from unnest(ids) id where private.goods_bulk_fingerprint(id) is distinct from operation.guards->>id) then
   raise sqlstate 'PT409' using message='goods_bulk_changed';end if;
  if command='dissolve' then
   for group_value in select value from jsonb_array_elements(operation.preview->'groups') loop
    perform public.admin_archive_goods_group((group_value->>'id')::uuid,(group_value->>'revision')::bigint,
     md5('goods-bulk-group:'||p_id::text||':'||(group_value->>'id'))::uuid,p_actor,p_session);
   end loop;
  else
   for g in select * from public.goods where id=any(ids) order by id loop
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
  result:=jsonb_build_object('state','completed','operationId',p_id,'goodsCount',cardinality(ids),'groupsCount',jsonb_array_length(operation.preview->'groups'),'error',null);
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

create function public.admin_read_goods_bulk(p_id uuid,p_actor uuid,p_session uuid,p_seal boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare operation private.goods_bulk_operations;result jsonb;
begin
 perform private.require_goods_group_identity(p_actor,p_session);
 if p_id is null or p_seal is null then raise invalid_parameter_value using message='goods_bulk_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-bulk:'||p_id::text,0));
 select * into operation from private.goods_bulk_operations where id=p_id for update;
 if not found or operation.actor_id<>p_actor or operation.session_id<>p_session then raise insufficient_privilege using message='goods_bulk_operation_unavailable';end if;
 if operation.receipt is not null then return operation.receipt;end if;
 result:=jsonb_build_object('state',case when p_seal then 'sealed' else 'unresolved' end,'operationId',p_id,'goodsCount',0,'groupsCount',0,'error',null);
 if p_seal then update private.goods_bulk_operations set receipt=result where id=p_id;end if;
 return result;
end $$;

revoke all on function private.goods_bulk_fingerprint(text),private.goods_bulk_validate(jsonb),private.goods_bulk_price(integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid),public.admin_commit_goods_bulk(uuid,uuid,uuid),public.admin_read_goods_bulk(uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid),public.admin_commit_goods_bulk(uuid,uuid,uuid),public.admin_read_goods_bulk(uuid,uuid,uuid,boolean) to authenticated;
select private.register_operator_rpc_contract('public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_commit_goods_bulk(uuid,uuid,uuid)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_read_goods_bulk(uuid,uuid,uuid,boolean)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_internal_contract(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.proname in ('goods_bulk_fingerprint','goods_bulk_validate','goods_bulk_price','admin_preview_goods_bulk','admin_commit_goods_bulk','admin_read_goods_bulk');
notify pgrst,'reload schema';
commit;
