-- ==========================================================================
-- ICONS · 상품 일괄 변경 — 막힌 상품만 건너뛰고 나머지를 적용한다 (2026-11-26 어드민 화면 규칙 PR 2, 결정 D4)
--
-- 지금까지 공개·초안·판매중지·판매중·보관·복원·판매가·판매기간 일괄 변경은 미리보기에서 조건을 보지 않았다.
-- 모든 줄을 '변경 후 공개'처럼 보여 주고, 저장할 때 한 상품이라도 막히면 전체를 되돌린 뒤 이유 코드 하나만 돌려줬다.
-- 어느 상품이 막혔는지 알 수 없어 100개를 하나씩 열어 봐야 했다. 보관 상품이 하나 섞여도 전체가 거절됐다.
-- 할인 등록·할인 중지만 상품마다 '건너뜀'이 있었다(20261027150100).
--
-- 이 migration이 바꾸는 것
--   1. private.goods_bulk_apply_good — 한 상품에 한 건을 적용하는 함수를 따로 뺀다. 저장이 하던 일 그대로다
--      (admin_set_good_published · admin_archive_good · admin_unarchive_good · admin_save_good). 판매가 계산도 그대로다.
--      바뀌는 것이 없는 상품(이미 공개·이미 초안·이미 판매중지·판매중지가 아님·이미 보관·보관 상품이 아님)과
--      보관된 상품은 여기서 이유 코드로 거절한다.
--   2. private.goods_bulk_trial_good — 그 함수를 하위 트랜잭션에서 실행한 뒤 반드시 되돌리고, 거절 이유만 돌려준다.
--      미리보기가 상품마다 부른다. 미리보기와 저장이 같은 함수를 쓰므로 판정이 갈라지지 않는다.
--      commit 때 검사하는 지연 제약(랜덤 판매 조건·기본 옵션)도 되돌리기 전에 당겨서 본다.
--   3. admin_preview_goods_bulk — 위 명령은 상품마다 skip(이유 코드)을 싣는다. 모두 건너뛰어도 거절하지 않고
--      이유를 보여 준다(저장은 거절된다). 저장과 같은 순서로 잠근 뒤 시험 적용한다.
--      판매상태 명령은 줄마다 stock(판매상태 값)을, 판매기간 명령은 saleStartsAt·saleEndsAt(지금 판매기간)을 더해
--      화면이 '현재 → 변경 후'를 그린다.
--      할인 등록·할인 중지는 계산과 건너뛰는 조건이 그대로이고, 보관 상품이 섞였을 때만 전체 거절 대신 건너뛴다
--      (고른 상품이 모두 보관 상품이면 전처럼 good_archived로 거절한다).
--   4. admin_commit_goods_bulk — 미리보기에서 건너뛴 상품을 빼고 적용한다. 그사이 조건이 바뀌어 저장 때 막힌 상품도
--      그 상품만 되돌리고 건너뛴 목록에 더한다. 완료 영수증은 모든 명령에서 skipped(상품·이유)를 싣는다.
--      적용된 상품이 하나도 없으면 goods_bulk_all_skipped로 거절한다.
--   5. [판매중으로](start)는 판매중지(stock='soldout')인 상품만 바꾼다. 소량 재고로 지정한 상품은 건너뛴다
--      (전에는 말없이 판매중으로 바뀌었다).
--
-- 그대로인 것: 함수 시그니처, 운영자·로그인 결속, 15분 유효, 저장 직전 지문 비교(바뀌면 goods_bulk_changed로 전체 중단),
-- 감사 기록(catalog.goods_bulk.completed), 그룹 해제(dissolve), 할인가 계산, 판매가 계산.
-- 이 migration 전에 만든 미리보기(15분 안)는 skip이 없어 모든 상품을 적용 대상으로 보고, 막힌 상품은 저장 때 건너뛴다.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. 한 상품에 한 건 적용 (저장과 미리보기의 시험 적용이 함께 쓴다)
-- --------------------------------------------------------------------------
create or replace function private.goods_bulk_apply_good(p_good text, p_command text, p_values jsonb)
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare g public.goods;payload jsonb;options jsonb;baseline jsonb;next_price integer;
begin
 select * into g from public.goods where id=p_good for update;
 if not found then raise no_data_found using message='goods_bulk_good_unavailable';end if;
 -- 바뀌는 것이 없거나 지금 상태로는 바꿀 수 없는 상품. 이유 코드는 화면이 '건너뜀' 문구로 옮긴다.
 if p_command='archive' then
  if g.archived_at is not null then raise check_violation using message='goods_bulk_already_archived';end if;
 elsif p_command='restore' then
  if g.archived_at is null then raise check_violation using message='goods_bulk_not_archived';end if;
 elsif g.archived_at is not null then raise check_violation using message='good_archived';
 elsif p_command='publish' and g.published_at is not null then raise check_violation using message='goods_bulk_already_published';
 elsif p_command='unpublish' and g.published_at is null then raise check_violation using message='goods_bulk_already_draft';
 elsif p_command='start' and g.stock<>'soldout' then raise check_violation using message='goods_bulk_not_stopped';
 elsif p_command='stop' and g.stock='soldout' then raise check_violation using message='goods_bulk_already_stopped';
 end if;
 if p_command='publish' then perform public.admin_set_good_published(g.id,true);
 elsif p_command='unpublish' then perform public.admin_set_good_published(g.id,false);
 elsif p_command='archive' then perform public.admin_archive_good(g.id);
 elsif p_command='restore' then perform public.admin_unarchive_good(g.id);
 elsif p_command in ('start','stop','period','price') then
  payload:=to_jsonb(g)||jsonb_build_object('previous_id',g.id,'publish',null,'custom_inputs_expected_revision',g.custom_inputs_revision);
  if p_command='start' then payload:=payload||'{"stock":"ok"}'::jsonb;
  elsif p_command='stop' then payload:=payload||'{"stock":"soldout"}'::jsonb;
  elsif p_command='period' then payload:=payload||jsonb_build_object('sale_period',p_values||jsonb_build_object('expectedRevision',g.sale_period_revision));
  else
   next_price:=private.goods_bulk_price(g.price,p_values);
   -- Same predicate as private.guard_goods_variant_period_price (every option, current or upcoming).
   if exists(select 1 from private.goods_variant_price_periods p where p.good_id=g.id and p.state='active' and p.ends_at>statement_timestamp()) then
    raise check_violation using message='active_price_period_requires_reset';end if;
   if g.compare_at_price is not null and g.compare_at_price<=next_price then raise check_violation using message='goods_compare_at_price_invalid';end if;
   if exists(select 1 from public.goods_variants where good_id=g.id and (price<g.price or price::bigint-g.price+next_price>2147483647)) then
    raise check_violation using message='goods_bulk_price_invalid';end if;
   select jsonb_agg(jsonb_build_object('id',id,'name',name,'attributes',attributes,'code',code,'extraPrice',price-g.price,
    'stockQty',stock_qty,'expectedStockQty',stock_qty,'isActive',archived_at is null,'lowStockThreshold',low_stock_threshold)
    order by is_default desc,sort_order,id) into options from public.goods_variants where good_id=g.id;
   select coalesce(jsonb_agg(id::text order by id),'[]') into baseline from public.goods_variants where good_id=g.id and archived_at is null;
   payload:=payload||jsonb_build_object('price',next_price,'variants',options,'variant_baseline',baseline);
  end if;
  perform public.admin_save_good(payload);
 else raise invalid_parameter_value using message='goods_bulk_invalid';
 end if;
end $function$;

-- --------------------------------------------------------------------------
-- 2. 시험 적용: 적용해 보고 반드시 되돌린다. 막히면 이유 코드, 되면 null.
-- --------------------------------------------------------------------------
create or replace function private.goods_bulk_trial_good(p_good text, p_command text, p_values jsonb)
 returns text
 language plpgsql
 set search_path to ''
as $function$
declare failure text;deferred text;
begin
 -- 상품·옵션 표의 지연 제약(랜덤 판매 조건·기본 옵션 등)은 commit 때 검사돼 저장에서야 전체를 되돌린다.
 -- 이름을 적어 두지 않고 그때그때 읽는다. 제약이 늘거나 이름이 바뀌어도 시험 적용이 깨지지 않는다.
 select string_agg(distinct format('%I.%I',n.nspname,c.conname),',') into deferred
  from pg_catalog.pg_constraint c join pg_catalog.pg_namespace n on n.oid=c.connamespace
  where c.condeferrable and c.conrelid in ('public.goods'::pg_catalog.regclass,'public.goods_variants'::pg_catalog.regclass);
 begin
  perform private.goods_bulk_apply_good(p_good,p_command,p_values);
  if deferred is not null then execute 'set constraints '||deferred||' immediate';end if;
  -- 여기까지 왔으면 적용할 수 있다. 예외로 하위 트랜잭션을 되돌린다(제약 검사 시점도 함께 되돌아간다).
  raise exception sqlstate 'GB001' using message='goods_bulk_trial';
 exception
  when sqlstate 'GB001' then return null;
  when insufficient_privilege or invalid_authorization_specification then raise;
  when lock_not_available or deadlock_detected then return 'goods_bulk_busy';
  when others then
   get stacked diagnostics failure=message_text;
   return case when failure ~ '^[a-z][a-z0-9_]{0,100}$' then failure else 'goods_bulk_rejected' end;
 end;
end $function$;

-- --------------------------------------------------------------------------
-- 3. 미리보기
-- --------------------------------------------------------------------------
create or replace function public.admin_preview_goods_bulk(p_id uuid, p_request jsonb, p_actor uuid, p_session uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare prior private.goods_bulk_operations;ids text[];groups jsonb:='[]';rows jsonb:='[]';guards jsonb:='{}';g public.goods;
 next_price integer;min_price integer;max_price integer;next_min integer;next_max integer;expires timestamptz;result jsonb;
 command text:=p_request->>'command';kind text:=p_request->>'kind';target_limit integer;skip text;applied integer:=0;
 window_range tstzrange;discounts jsonb;instant jsonb;
 trial boolean;lock_ids text[];id_value text;archived_skips integer:=0;
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
 -- 이 명령들은 상품마다 저장과 같은 함수로 시험 적용해 막히는 이유를 미리 읽는다.
 trial:=command in ('publish','unpublish','start','stop','archive','restore','price','period');
 if trial then
  -- 저장(admin_commit_goods_bulk)과 같은 순서로 잠근다. 시험 적용이 다른 저장과 엇갈려 서로를 기다리지 않게 한다.
  begin
   perform private.lock_catalog_category_tree();
   select array_agg(distinct id order by id) into lock_ids from (select unnest(ids) id union select private.goods_aggregation_owner(unnest(ids))) members;
   foreach id_value in array lock_ids loop
    if not pg_try_advisory_xact_lock(hashtextextended('admin_good:'||id_value,0)) then raise sqlstate 'PT409' using message='goods_bulk_busy';end if;
   end loop;
   perform 1 from public.goods where id=any(lock_ids) order by id for update nowait;
   perform 1 from public.goods_variants where good_id=any(ids) order by id for update nowait;
   perform 1 from private.goods_variant_price_periods where good_id=any(ids) order by id for update nowait;
   perform 1 from public.ips where id in(select ip_id from public.goods where id=any(ids)) order by id for update nowait;
  exception when lock_not_available then raise sqlstate 'PT409' using message='goods_bulk_busy';
  end;
 end if;
 -- One statement owns both the summary and fingerprint to avoid torn previews.
 for g in select * from public.goods where id=any(ids) order by id for share nowait loop
  perform 1 from public.goods_variants where good_id=g.id order by id for share nowait;
  next_price:=g.price;
  select min(price),max(price) into min_price,max_price from public.goods_variants where good_id=g.id and archived_at is null;
  next_min:=min_price;next_max:=max_price;skip:=null;discounts:=null;instant:=null;
  if trial then
   skip:=private.goods_bulk_trial_good(g.id,command,p_request->'values');
   if skip is null and command='price' then
    next_price:=private.goods_bulk_price(g.price,p_request->'values');
    next_min:=min_price-g.price+next_price;next_max:=max_price-g.price+next_price;
   end if;
  elsif g.archived_at is not null and command<>'dissolve' then
   -- 할인 등록·할인 중지에 보관 상품이 섞이면 전체를 거절하지 않고 그 상품만 건너뛴다.
   skip:='good_archived';archived_skips:=archived_skips+1;
  elsif command='discount' then
   -- A good is skipped (not the whole batch) when it cannot take this discount.
   if g.compare_at_price is not null and g.compare_at_price>g.price then skip:='instant_discount_active';
   elsif min_price is null then skip:='price_period_variant_inactive';
   elsif exists(select 1 from public.goods_variants v join private.goods_variant_price_periods p on p.variant_id=v.id and p.good_id=v.good_id
     where v.good_id=g.id and v.archived_at is null and p.state='active' and tstzrange(p.starts_at,p.ends_at,'[)') && window_range) then skip:='price_period_overlap';
   elsif exists(select 1 from public.goods_variants v where v.good_id=g.id and v.archived_at is null and private.goods_bulk_discount_price(v.price,p_request->'values') is null) then skip:='goods_bulk_price_invalid';
   else next_min:=private.goods_bulk_price(min_price,p_request->'values');next_max:=private.goods_bulk_price(max_price,p_request->'values');end if;
  elsif command='discount_stop' then
   select case when count(*)=0 then null else jsonb_build_object('count',count(*),'minPrice',min(p.discount_price),'maxPrice',max(p.discount_price),
     'startsAt',min(p.starts_at),'endsAt',max(p.ends_at)) end into discounts
    from private.goods_variant_price_periods p where p.good_id=g.id and p.state='active' and p.ends_at>statement_timestamp();
   if p_request#>>'{values,includeInstant}'='true' and g.compare_at_price is not null and g.compare_at_price>g.price then
    instant:=jsonb_build_object('regularPrice',g.compare_at_price,'salePrice',g.price);
    next_price:=g.compare_at_price;next_min:=min_price-g.price+g.compare_at_price;next_max:=max_price-g.price+g.compare_at_price;
   end if;
   if discounts is null and instant is null then skip:='no_active_discount';end if;
  end if;
  if skip is null then applied:=applied+1;end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,'price',g.price,'nextPrice',next_price,
   'priceMin',min_price,'priceMax',max_price,'nextMin',next_min,'nextMax',next_max,'published',g.published_at is not null,
   'archived',g.archived_at is not null,'stopped',g.stock='soldout','skip',skip,'discounts',discounts)
   ||case when instant is null then '{}'::jsonb else jsonb_build_object('instantDiscount',instant) end
   -- 화면이 '현재 → 변경 후'를 그리는 데 쓰는 값. 쓰는 명령에만 싣는다.
   ||case when command in ('start','stop') then jsonb_build_object('stock',g.stock) else '{}'::jsonb end
   ||case when command='period' then jsonb_build_object('saleStartsAt',g.sale_starts_at,'saleEndsAt',g.sale_ends_at) else '{}'::jsonb end);
  guards:=guards||jsonb_build_object(g.id,case when command in ('discount','discount_stop') then private.goods_bulk_price_fingerprint(g.id) else private.goods_bulk_fingerprint(g.id) end);
 end loop;
 -- 할인은 적용할 상품이 없으면 미리보기부터 거절한다(전과 같다. 모두 보관 상품이면 전처럼 good_archived).
 -- 나머지 명령은 상품마다 건너뛴 이유를 보여 주려고 돌려준다. 저장은 거절된다.
 if applied=0 and not trial then raise check_violation using message=case when archived_skips=jsonb_array_length(rows) then 'good_archived'
  when command='discount_stop' and archived_skips=0 then 'goods_bulk_no_active_discount' else 'goods_bulk_all_skipped' end;end if;
 expires:=clock_timestamp()+interval '15 minutes';
 result:=jsonb_build_object('state','ready','operationId',p_id,'request',p_request,'groups',groups,'goods',rows,'expiresAt',expires);
 insert into private.goods_bulk_operations(id,actor_id,session_id,request,guards,preview,expires_at) values(p_id,p_actor,p_session,p_request,guards,result,expires);
 return result;
end $function$;

-- --------------------------------------------------------------------------
-- 4. 저장
-- --------------------------------------------------------------------------
create or replace function public.admin_commit_goods_bulk(p_id uuid, p_actor uuid, p_session uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare operation private.goods_bulk_operations;ids text[];lock_ids text[];id_value text;group_value jsonb;g public.goods;v public.goods_variants;
 p private.goods_variant_price_periods;command text;values_doc jsonb;result jsonb;failure text;failure_state text;options jsonb;baseline jsonb;
 skipped_ids text[];skipped jsonb;applied integer:=0;
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
   applied:=cardinality(ids)-cardinality(skipped_ids);
  else
   for g in select * from public.goods where id=any(ids) and not id=any(skipped_ids) order by id loop
    if command in ('discount','discount_stop') then
     if command='discount' then
      for v in select * from public.goods_variants where good_id=g.id and archived_at is null order by id loop
       perform public.admin_save_goods_price_period(g.id,v.id,null,jsonb_build_object('state','active',
        'discountPrice',private.goods_bulk_price(v.price,values_doc),'startsAt',values_doc->'startsAt','endsAt',values_doc->'endsAt'),null);
      end loop;
     else
      for p in select * from private.goods_variant_price_periods where good_id=g.id and state='active' and ends_at>clock_timestamp() order by id loop
       perform public.admin_save_goods_price_period(g.id,p.variant_id,p.id,jsonb_build_object('state','disabled',
        'discountPrice',p.discount_price,'startsAt',p.starts_at,'endsAt',p.ends_at),p.revision);
      end loop;
      if values_doc->>'includeInstant'='true' and g.compare_at_price is not null and g.compare_at_price>g.price then
       select jsonb_agg(jsonb_build_object('id',id,'name',name,'attributes',attributes,'code',code,'extraPrice',price-g.price,
        'stockQty',stock_qty,'expectedStockQty',stock_qty,'isActive',archived_at is null,'lowStockThreshold',low_stock_threshold)
        order by is_default desc,sort_order,id) into options from public.goods_variants where good_id=g.id;
       select coalesce(jsonb_agg(id::text order by id),'[]') into baseline from public.goods_variants where good_id=g.id and archived_at is null;
       perform public.admin_save_good(to_jsonb(g)||jsonb_build_object('previous_id',g.id,'publish',null,'custom_inputs_expected_revision',g.custom_inputs_revision,
        'price',g.compare_at_price,'compare_at_price',null,'variants',options,'variant_baseline',baseline));
      end if;
     end if;
     applied:=applied+1;
    else
     -- 미리보기가 시험 적용한 것과 같은 함수다. 그사이 조건이 바뀌어 막힌 상품은 그 상품만 되돌리고 건너뛴 목록에 더한다.
     begin
      perform private.goods_bulk_apply_good(g.id,command,values_doc);
      applied:=applied+1;
     exception
      when insufficient_privilege or invalid_authorization_specification then raise;
      when others then
       get stacked diagnostics failure=message_text,failure_state=returned_sqlstate;
       skipped:=skipped||jsonb_build_array(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,'reason',
        case when failure_state in ('55P03','40P01') then 'goods_bulk_busy' when failure ~ '^[a-z][a-z0-9_]{0,100}$' then failure else 'goods_bulk_rejected' end));
     end;
    end if;
   end loop;
  end if;
  if applied<1 then raise check_violation using message='goods_bulk_all_skipped';end if;
  result:=jsonb_build_object('state','completed','operationId',p_id,'goodsCount',applied,'groupsCount',jsonb_array_length(operation.preview->'groups'),'error',null,'skipped',skipped);
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
end $function$;

-- --------------------------------------------------------------------------
-- 5. 봉인과 운영자 계약
-- --------------------------------------------------------------------------
-- Supabase default privileges가 새 함수에 anon·authenticated·service_role 실행 권한을 붙인다. 내부 함수는 모두 거둔다.
revoke all on function private.goods_bulk_apply_good(text,text,jsonb),private.goods_bulk_trial_good(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid),public.admin_commit_goods_bulk(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid),public.admin_commit_goods_bulk(uuid,uuid,uuid) to authenticated;
select private.register_operator_internal_contract('private.goods_bulk_apply_good(text,text,jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.goods_bulk_trial_good(text,text,jsonb)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_commit_goods_bulk(uuid,uuid,uuid)'::regprocedure,'catalog.manage','write',false);
notify pgrst,'reload schema';
