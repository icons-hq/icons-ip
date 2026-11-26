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
--      이유를 보여 준다(저장은 거절된다).
--      판매상태 명령은 줄마다 stock(판매상태 값)을, 판매기간 명령은 saleStartsAt·saleEndsAt(지금 판매기간)을 더해
--      화면이 '현재 → 변경 후'를 그린다.
--      할인 등록·할인 중지는 계산과 건너뛰는 조건이 그대로이고, 보관 상품이 섞였을 때만 전체 거절 대신 건너뛴다
--      (고른 상품이 모두 보관 상품이면 전처럼 good_archived로 거절한다).
--   4. admin_commit_goods_bulk — 미리보기에서 건너뛴 상품을 빼고 적용한다. 그사이 조건이 바뀌어 저장 때 막힌 상품도
--      그 상품만 되돌리고 건너뛴 목록에 더한다(commit 때 검사하는 지연 제약도 상품마다 당겨 본다).
--      완료 영수증은 모든 명령에서 skipped(상품·이유)를 싣는다. 적용된 상품이 하나도 없으면 goods_bulk_all_skipped로 거절한다.
--   5. [판매중으로](start)는 판매중지(stock='soldout')인 상품만 바꾼다. 소량 재고로 지정한 상품은 건너뛴다
--      (전에는 말없이 판매중으로 바뀌었다).
--
-- 미리보기가 잡는 잠금 — 미리보기는 자주 눌리는 읽기 동작이라 고객의 결제·주문·취소를 막지 않는다
--   · 매장 전체에 걸리는 잠금 둘은 함께 잡는 잠금(shared)으로만, 그것도 잠깐만 잡는다. 고객 쪽(카테고리 쿠폰 결제의
--     private.coupon_good_matches, 취소·반품 재고 복원의 private.lock_goods_stock_successor_topology, 리뷰 '도움이 돼요')도
--     함께 잡는 잠금이라 서로 막지 않는다. 그룹 구성 잠금은 고른 상품을 정하는 동안만 잡고 놓는다. 카테고리 트리 잠금은
--     한 상품의 시험 적용 안에서 private.lock_catalog_category_tree가 잡는다(시험 적용은 아무것도 남기지 않으므로
--     트리가 바뀌지 않게만 하면 된다). 미리보기가 끝까지 쥐는 매장 전체 잠금은 없다.
--   · 상품·옵션·IP 행과 상품별 저장 잠금은 미리 한꺼번에 잡지 않는다. 한 상품을 시험 적용하는 동안만 잡고 바로 놓는다
--     (하위 트랜잭션을 되돌리면 그 안에서 잡은 잠금이 풀린다).
--   · 그 잠깐도 오래 기다리지 않는다. 주문·취소나 다른 사람의 저장이 잡고 있는 상품은 5~250ms만 기다린 뒤 미뤄 두고,
--     나머지를 다 본 다음 한 번 더 본다(5~1000ms). 그래도 잡혀 있으면 그 상품만 goods_bulk_busy('지금 다른 처리 중')로
--     건너뛴다. 기다리는 시간은 고른 상품 전체에 4초까지다. 전에는 한 상품이라도 잠겨 있으면 미리보기 전체가 실패했다.
--   저장(admin_commit_goods_bulk)은 실제로 바꾸므로 전처럼 독점으로 잡는다. 공개·초안·보관·복원은 카테고리 트리를
--   건드리지 않으므로 저장도 그 잠금을 잡지 않는다.
--
-- 미리보기 뒤에 상태가 바뀌면 (저장이 다시 판정한다)
--   · 바꿀 상품의 상품·옵션·기간 할인·그룹 값이 바뀌었다 → goods_bulk_changed로 전체 중단(전과 같다.
--     할인 등록·할인 중지는 전처럼 가격·옵션·기간 할인만 보고 재고는 보지 않는다).
--   · 미리보기에서 건너뛴 상품이 바뀌었다 → 보지 않는다. 건드리지 않을 상품이라 잠그지도 않는다
--     (전에는 건너뛴 상품이 한 개 팔려도 전체가 중단됐다. 할인 등록·할인 중지에서 건너뛴 상품도 같다).
--     그사이 조건을 채웠어도 이번 저장에는 넣지 않는다 — 운영자가 확인한 것이 '이 상품은 건너뜀'이기 때문이다.
--     영수증에 미리보기 때의 이유로 남는다.
--   · 바꿀 상품이 상품 값 밖의 이유(KC 검토·카테고리·IP·출고지·다른 사람의 저장)로 막혔다 → 그 상품만 건너뛴다.
--
-- 그대로인 것: 함수 시그니처, 운영자·로그인 결속, 15분 유효, 감사 기록(catalog.goods_bulk.completed), 그룹 해제(dissolve),
-- 할인가 계산, 판매가 계산, 지문 계산(private.goods_bulk_fingerprint · goods_bulk_price_fingerprint).
-- 이 migration 전에 만든 미리보기(15분 안)는 skip이 없어 모든 상품을 적용 대상으로 보고, 막힌 상품은 저장 때 건너뛴다.
--
-- 배포 순서(DB 먼저, 몇 분 뒤 앱) — 그 사이 옛 앱에서 생기는 일
--   옛 앱은 미리보기 한 줄의 키를 정확히 맞춰 보고, 할인이 아닌 명령에 skip이 있으면 받지 않는다. 옛 앱과 새 앱이
--   같은 함수에 같은 요청을 보내므로 DB가 둘을 가려 다른 모양으로 답할 수 없다. 그래서 그 몇 분 동안 옛 앱에서는
--   [판매중으로]·[판매중지로]·[판매기간 변경](목록의 판매상태 바로 수정 포함)이, 그리고 건너뛸 상품이 섞인
--   공개·초안·보관·복원·판매가 변경이 오류로 끝난다. 미리보기만 만들어지고 저장은 불리지 않으므로 바뀌는 것은 없다
--   (남은 미리보기는 15분 뒤 끝난다). 기간 할인 걸기·중지, 그룹 해제, 이 migration 전에 만든 미리보기의 저장은 된다.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 0. 카테고리 트리 잠금: 시험 적용 안에서는 함께 잡는 잠금
-- --------------------------------------------------------------------------
-- 상품 저장(admin_save_good)은 단계마다 이 잠금을 독점으로 잡는다. 카테고리 쿠폰 결제(private.coupon_good_matches)는
-- 같은 잠금을 함께 잡는 잠금으로 '시도'하고 못 잡으면 바로 실패하므로, 미리보기가 저장 함수를 시험 적용하는 동안
-- 매장 전체의 카테고리 쿠폰 결제가 실패했다. 시험 적용은 반드시 되돌리므로 트리가 바뀌지 않게만 하면 된다.
-- icons.goods_bulk_trial은 private.goods_bulk_trial_good이 되돌려지는 블록 안에서만 켠다(블록이 끝나면 설정도 되돌아간다).
-- PostgREST 요청으로는 이 설정을 바꿀 수 없다. 그 밖의 호출은 전과 똑같이 독점으로 잡는다.
create or replace function private.lock_catalog_category_tree()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
 if pg_catalog.current_setting('icons.goods_bulk_trial', true) = 'on' then
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('catalog_category_tree', 0));
 else
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('catalog_category_tree', 0));
 end if;
end $function$;

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
-- 상품·옵션 표의 지연 제약(랜덤 판매 조건·기본 옵션 등)은 commit 때 검사돼 저장에서야 전체를 되돌린다.
-- 이름을 적어 두지 않고 그때그때 읽는다. 제약이 늘거나 이름이 바뀌어도 시험 적용과 저장이 깨지지 않는다.
-- commit 때 검사하는 것(initially deferred)만 고른다. 저장이 당겨 본 뒤 원래대로 '지연'으로 돌려놓기 때문이다.
create or replace function private.goods_bulk_deferred_constraints()
 returns text
 language sql
 stable
 set search_path to ''
as $function$
 select string_agg(distinct format('%I.%I',n.nspname,c.conname),',')
  from pg_catalog.pg_constraint c join pg_catalog.pg_namespace n on n.oid=c.connamespace
  where c.condeferrable and c.condeferred
   and c.conrelid in ('public.goods'::pg_catalog.regclass,'public.goods_variants'::pg_catalog.regclass);
$function$;

create or replace function private.goods_bulk_trial_good(p_good text, p_command text, p_values jsonb)
 returns text
 language plpgsql
 set search_path to ''
as $function$
declare failure text;deferred text:=private.goods_bulk_deferred_constraints();
begin
 begin
  -- 이 블록 안에서는 카테고리 트리를 함께 잡는 잠금으로 잡는다(private.lock_catalog_category_tree).
  -- 블록은 늘 예외로 끝나므로 이 설정도, 안에서 잡은 잠금도, 바꾼 값도 모두 되돌아간다.
  perform set_config('icons.goods_bulk_trial','on',true);
  perform private.goods_bulk_apply_good(p_good,p_command,p_values);
  if deferred is not null then execute 'set constraints '||deferred||' immediate';end if;
  -- 여기까지 왔으면 적용할 수 있다. 예외로 하위 트랜잭션을 되돌린다(제약 검사 시점도 함께 되돌아간다).
  raise exception sqlstate 'GB001' using message='goods_bulk_trial';
 exception
  when sqlstate 'GB001' then return null;
  when insufficient_privilege or invalid_authorization_specification then raise;
  -- 다른 처리가 이 상품을 잡고 있어 lock_timeout 안에 잠그지 못했다. 기다리지 않고 이 상품만 건너뛴다.
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
 trial boolean;id_value text;archived_skips integer:=0;guard text;busy boolean;
 work text[];turn integer:=0;first_pass integer;wait_until timestamptz;row_by_id jsonb:='{}';
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
 -- 이 명령들은 상품마다 저장과 같은 함수로 시험 적용해 막히는 이유를 미리 읽는다.
 trial:=command in ('publish','unpublish','start','stop','archive','restore','price','period');
 target_limit:=case when kind='ip' then 1000 else 100 end;
 begin
  -- Group membership is stable while expanding the exact selected group set.
  -- 읽기만 하므로 함께 잡는 잠금이다. 취소·반품 재고 복원과 리뷰 '도움이 돼요'(함께 잡는 잠금을 시도하고 못 잡으면 바로 실패)를 막지 않는다.
  perform pg_advisory_xact_lock_shared(hashtextextended('goods-stock-successor-topology:v1',0));
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
  -- 시험 적용하는 미리보기는 길다(상품 100개에 0.1~1.2초). 고른 상품을 정한 뒤 이 잠금을 놓는다(블록을 되돌리면 풀린다).
  -- 쥐고 있으면 그사이 시작한 그룹 저장·일괄 저장이 뒤에서 기다리고, 그 대기 때문에 고객 쪽 시도가 실패한다.
  -- 그룹이 그사이 바뀌면 저장이 그룹 revision과 지문으로 알아채 전체를 멈춘다(goods_bulk_changed).
  -- 할인 등록·할인 중지·그룹 해제 미리보기는 짧게 읽기만 하므로 전처럼 끝까지 쥔다.
  if trial then raise exception sqlstate 'GB003' using message='goods_bulk_release';end if;
 exception when sqlstate 'GB003' then null;
 end;
 if command='discount' then window_range:=tstzrange((p_request#>>'{values,startsAt}')::timestamptz,(p_request#>>'{values,endsAt}')::timestamptz,'[)');end if;
 -- 다른 처리가 잡고 있어 못 본 상품은 나머지를 다 본 뒤 한 번 더 본다(work 끝에 붙인다). 고른 상품 전체에 4초까지만 기다린다.
 work:=ids;first_pass:=cardinality(ids);wait_until:=clock_timestamp()+interval '4 seconds';
 while turn<cardinality(work) loop
  turn:=turn+1;id_value:=work[turn];
  skip:=null;discounts:=null;instant:=null;
  if trial then
   -- 한 상품씩: 행을 잠그고, 현재 값과 지문을 읽고, 시험 적용한 뒤 모두 되돌려 잠금을 놓는다.
   -- 행을 잠근 채 읽으므로 화면에 보이는 값·지문·판정이 같은 시점의 것이다. 잠금은 이 상품을 보는 동안만 잡힌다.
   busy:=false;
   begin
    -- 남은 시간을 남은 상품에 고루 나눈 만큼만 기다린다(처음에는 5~250ms, 다시 볼 때는 5~1000ms).
    -- 블록이 되돌아가면 이 설정도 되돌아간다.
    perform set_config('lock_timeout',greatest(5,least(case when turn<=first_pass then 250 else 1000 end,
     (extract(epoch from wait_until-clock_timestamp())*1000/(cardinality(work)-turn+1))::integer))::text||'ms',true);
    select * into g from public.goods where id=id_value for update;
    if not found then raise check_violation using message='goods_bulk_good_unavailable';end if;
    select min(price),max(price) into min_price,max_price from public.goods_variants where good_id=g.id and archived_at is null;
    guard:=private.goods_bulk_fingerprint(g.id);
    skip:=private.goods_bulk_trial_good(g.id,command,p_request->'values');
    raise exception sqlstate 'GB002' using message='goods_bulk_release';
   exception
    when sqlstate 'GB002' then null;
    when lock_not_available or deadlock_detected then busy:=true;
   end;
   if (busy or skip='goods_bulk_busy') and turn<=first_pass then work:=work||id_value;continue;end if;
   if busy then
    -- 주문·취소 같은 다른 처리가 이 상품을 계속 잡고 있다. 더 기다리지 않고 지금 값만 읽어 이 상품을 건너뛴다.
    select * into g from public.goods where id=id_value;
    if not found then raise check_violation using message='goods_bulk_good_unavailable';end if;
    select min(price),max(price) into min_price,max_price from public.goods_variants where good_id=g.id and archived_at is null;
    guard:=private.goods_bulk_fingerprint(g.id);skip:='goods_bulk_busy';
   end if;
   next_price:=g.price;next_min:=min_price;next_max:=max_price;
   if skip is null and command='price' then
    next_price:=private.goods_bulk_price(g.price,p_request->'values');
    next_min:=min_price-g.price+next_price;next_max:=max_price-g.price+next_price;
   end if;
  else
   -- 할인 등록·할인 중지·그룹 해제는 전과 같다: 읽는 동안 상품·옵션 행을 잡아 요약과 지문이 어긋나지 않게 한다.
   select * into g from public.goods where id=id_value for share nowait;
   if not found then raise check_violation using message='goods_bulk_good_unavailable';end if;
   perform 1 from public.goods_variants where good_id=g.id order by id for share nowait;
   next_price:=g.price;
   select min(price),max(price) into min_price,max_price from public.goods_variants where good_id=g.id and archived_at is null;
   next_min:=min_price;next_max:=max_price;
   if g.archived_at is not null and command<>'dissolve' then
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
   guard:=case when command in ('discount','discount_stop') then private.goods_bulk_price_fingerprint(g.id) else private.goods_bulk_fingerprint(g.id) end;
  end if;
  if skip is null then applied:=applied+1;end if;
  row_by_id:=row_by_id||jsonb_build_object(g.id,jsonb_build_object('id',g.id,'name',g.name,'code',g.code,'price',g.price,'nextPrice',next_price,
   'priceMin',min_price,'priceMax',max_price,'nextMin',next_min,'nextMax',next_max,'published',g.published_at is not null,
   'archived',g.archived_at is not null,'stopped',g.stock='soldout','skip',skip,'discounts',discounts)
   ||case when instant is null then '{}'::jsonb else jsonb_build_object('instantDiscount',instant) end
   -- 화면이 '현재 → 변경 후'를 그리는 데 쓰는 값. 쓰는 명령에만 싣는다.
   ||case when command in ('start','stop') then jsonb_build_object('stock',g.stock) else '{}'::jsonb end
   ||case when command='period' then jsonb_build_object('saleStartsAt',g.sale_starts_at,'saleEndsAt',g.sale_ends_at) else '{}'::jsonb end);
  guards:=guards||jsonb_build_object(g.id,guard);
 end loop;
 -- 줄은 전처럼 상품 순서로 싣는다(다시 본 상품도 제자리에).
 select jsonb_agg(row_by_id->id order by id) into rows from unnest(ids) id;
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
 skipped_ids text[];skipped jsonb;applied integer:=0;apply_ids text[];deferred text;
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
 -- 미리보기에서 건너뛴 상품은 건드리지 않는다. 그래서 잠그지도, 그사이 바뀌었는지 보지도 않는다.
 -- 건너뛴 상품이 팔리거나 주문 처리 중이어도 나머지 상품의 저장을 막지 않는다.
 select coalesce(array_agg(id order by id),'{}') into apply_ids from unnest(ids) id where not id=any(skipped_ids);
 begin
  perform pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));
  -- 공개·초안·보관·복원은 카테고리 트리를 읽지도 잡지도 않는다(admin_save_good을 부르지 않는다).
  -- 그 밖의 명령은 저장 함수가 잡는 순서(카테고리 트리 → 상품)에 맞춰 먼저 잡는다.
  if command not in ('publish','unpublish','archive','restore') then perform private.lock_catalog_category_tree();end if;
  for group_value in select value from jsonb_array_elements(operation.preview->'groups') loop
   perform 1 from private.goods_groups where id=(group_value->>'id')::uuid and revision=(group_value->>'revision')::bigint and archived_at is null for update nowait;
   if not found then raise sqlstate 'PT409' using message='goods_bulk_changed';end if;
  end loop;
  select coalesce(array_agg(distinct id order by id),'{}') into lock_ids from (select unnest(apply_ids) id union select private.goods_aggregation_owner(unnest(apply_ids))) members;
  foreach id_value in array lock_ids loop
   if not pg_try_advisory_xact_lock(hashtextextended('admin_good:'||id_value,0)) then raise sqlstate 'PT409' using message='goods_bulk_busy';end if;
  end loop;
  perform 1 from public.goods where id=any(lock_ids) order by id for update nowait;
  perform 1 from public.goods_variants where good_id=any(apply_ids) order by id for update nowait;
  perform 1 from private.goods_variant_price_periods where good_id=any(apply_ids) order by id for update nowait;
  perform 1 from public.ips where id in(select ip_id from public.goods where id=any(apply_ids)) order by id for update nowait;
  -- Recheck expiration after lock acquisition, and reject the entire batch if
  -- an option, stock, discount, membership or catalog value of a good to be
  -- changed moved meanwhile. Discount commands guard prices, options and periods but not stock.
  if operation.expires_at<=clock_timestamp() then raise sqlstate 'PT409' using message='goods_bulk_preview_expired';end if;
  -- A discount preview stored before this migration carries a full fingerprint
  -- and is rejected here as changed, which only asks the operator to re-review.
  if exists(select 1 from unnest(apply_ids) id where (case when command in ('discount','discount_stop')
     then private.goods_bulk_price_fingerprint(id) else private.goods_bulk_fingerprint(id) end) is distinct from operation.guards->>id) then
   raise sqlstate 'PT409' using message='goods_bulk_changed';end if;
  if command='dissolve' then
   for group_value in select value from jsonb_array_elements(operation.preview->'groups') loop
    perform public.admin_archive_goods_group((group_value->>'id')::uuid,(group_value->>'revision')::bigint,
     md5('goods-bulk-group:'||p_id::text||':'||(group_value->>'id'))::uuid,p_actor,p_session);
   end loop;
   applied:=cardinality(ids)-cardinality(skipped_ids);
  else
   deferred:=private.goods_bulk_deferred_constraints();
   for g in select * from public.goods where id=any(apply_ids) order by id loop
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
      -- 시험 적용처럼 commit 때 검사하는 지연 제약을 지금 당겨 본다. 막히면 이 상품만 되돌아간다
      -- (당기지 않으면 함수는 완료를 돌려주고 트랜잭션이 commit에서 통째로 실패한다). 통과하면 검사 시점을 돌려놓는다.
      if deferred is not null then
       execute 'set constraints '||deferred||' immediate';
       execute 'set constraints '||deferred||' deferred';
      end if;
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
-- private.lock_catalog_category_tree는 본문만 바꿨다(소유자·권한은 그대로, 운영자 계약 대상이 아니다).
revoke all on function private.goods_bulk_apply_good(text,text,jsonb),private.goods_bulk_trial_good(text,text,jsonb),
 private.goods_bulk_deferred_constraints() from public,anon,authenticated,service_role;
revoke all on function public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid),public.admin_commit_goods_bulk(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid),public.admin_commit_goods_bulk(uuid,uuid,uuid) to authenticated;
select private.register_operator_internal_contract('private.goods_bulk_apply_good(text,text,jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.goods_bulk_trial_good(text,text,jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.goods_bulk_deferred_constraints()'::regprocedure);
select private.register_operator_rpc_contract('public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_commit_goods_bulk(uuid,uuid,uuid)'::regprocedure,'catalog.manage','write',false);
notify pgrst,'reload schema';
