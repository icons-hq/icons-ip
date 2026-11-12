-- 상품번호(ADR-0038, S36-009·S36-X02·SHEET-036): 시스템이 매기는 바뀌지 않는 숫자 상품번호를 goods에 둔다.
--   * 기존 상품은 등록 순서(created_at, 같은 시각이면 id)대로 1번부터 채운다. 새 상품은 identity 순번을 받는다.
--   * 한 번 받은 번호는 바꿀 수 없다(identity ALWAYS + 갱신 차단 트리거). 순번은 되돌리지 않으므로 지운 상품의 번호도 다시 쓰지 않는다.
--   * 상품 URL(goods.id)과 판매자상품코드(goods.code)는 그대로다. 상품번호는 목록·검색·상품 엑셀의 식별자로만 더한다.
-- 상품 조회/수정 검색(admin_search_goods_console)은
--   * 검색 대상 '상품번호'(field=number, 쉼표·공백으로 여러 개)와 정렬 '상품번호순'(number_asc/number_desc)을 받고 행에 productNo를 싣는다.
--   * 전체 검색(admin_search_goods)도 상품번호를 그대로 입력하면 찾는다.
--   * 건수 칸 판매대기·판매중지·판매종료(saleStateCounts)를 센다. 각 숫자는 그 칸의 조건 축만 빼고 같은 검색 조건으로 센다 —
--     판매중지는 재고 조건(stock=stopped) 축, 판매대기·판매종료는 판매기간(salePeriod) 축이다. 그래서 칸을 눌렀을 때의 목록 개수와 같다.
--     기존 statusCounts·stockCounts는 그대로다.
-- 함수 본문은 통째로 다시 쓰지 않고 현재 정의(pg_get_functiondef)에서 앵커만 치환한다. 앵커가 바뀌었으면 실패한다.
begin;

-- 1. 상품번호 열. 백필 UPDATE가 수정일 갱신·잠금 검사·재고 캐시 같은 상품 트리거를 건드리지 않도록 켜져 있던 사용자 트리거만 잠시 끈다.
alter table public.goods add column product_no bigint;

do $backfill$
declare item record; enabled_triggers jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('name', tgname, 'mode', tgenabled) order by tgname), '[]'::jsonb) into enabled_triggers
    from pg_trigger where tgrelid = 'public.goods'::regclass and not tgisinternal and tgenabled <> 'D';
  for item in select value->>'name' as name from jsonb_array_elements(enabled_triggers) loop
    execute format('alter table public.goods disable trigger %I', item.name);
  end loop;
  update public.goods good set product_no = numbered.position
    from (select id, row_number() over (order by created_at, id) as position from public.goods) numbered
    where numbered.id = good.id;
  for item in select value->>'name' as name, value->>'mode' as mode from jsonb_array_elements(enabled_triggers) loop
    execute format(case item.mode when 'A' then 'alter table public.goods enable always trigger %I'
      when 'R' then 'alter table public.goods enable replica trigger %I' else 'alter table public.goods enable trigger %I' end, item.name);
  end loop;
end $backfill$;

alter table public.goods alter column product_no set not null;
alter table public.goods add constraint goods_product_no_key unique (product_no);
alter table public.goods alter column product_no add generated always as identity;
select setval(pg_get_serial_sequence('public.goods', 'product_no'), greatest(coalesce(max(product_no), 0), 1), coalesce(max(product_no), 0) > 0)
  from public.goods;
-- 순번은 상품을 저장하는 SECURITY DEFINER 함수(소유자)만 쓴다. 기본 권한으로 붙은 사용·변경 권한을 거둔다(setval로 번호를 되돌리지 못하게).
do $sequence$ begin
  execute format('revoke all on sequence %s from public, anon, authenticated, service_role', pg_get_serial_sequence('public.goods', 'product_no'));
end $sequence$;
comment on column public.goods.product_no is
  '상품번호. 시스템이 등록 순서대로 매기는 바뀌지 않는 숫자(ADR-0038). 상품 URL(id)·판매자상품코드(code)와 별개이며 재사용하지 않는다.';

-- 2. 상품번호 불변. identity ALWAYS는 값 지정 갱신을 막지만 `set product_no = default`(새 순번)는 통과하므로 트리거로 막는다.
create function private.guard_goods_product_no() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.product_no is distinct from old.product_no then
    raise exception using errcode = '22023', message = 'goods_product_no_immutable';
  end if;
  return new;
end $$;
revoke all on function private.guard_goods_product_no() from public, anon, authenticated, service_role;
create trigger goods_product_no_immutable before update of product_no on public.goods
  for each row execute function private.guard_goods_product_no();

-- 3. 판매기간 조건(판매대기 = 시작 전, 판매종료 = 종료 시각 지남) 판정을 한곳에 둔다. 목록 필터와 건수가 같은 판정을 쓴다.
create function private.admin_goods_sale_period_matches(p_period text, p_starts_at timestamptz, p_ends_at timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select case p_period
    when 'scheduled' then p_starts_at is not null and now() < p_starts_at
    when 'ended' then p_ends_at is not null and now() >= p_ends_at
    else true end
$$;
revoke all on function private.admin_goods_sale_period_matches(text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.admin_goods_sale_period_matches(text, timestamptz, timestamptz) to postgres;

-- 4. 검색 함수 앵커 치환.
do $patch$
declare target record; definition text; patch record;
begin
 for target in select * from (values
  ('private.admin_goods_console_matches(text,text,text,text,uuid,text,jsonb)'),
  ('public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)'),
  ('public.admin_search_goods(text)')
 ) supplied(signature) loop
  definition := pg_get_functiondef(target.signature::regprocedure);
  for patch in select * from (values
   ('private.admin_goods_console_matches(text,text,text,text,uuid,text,jsonb)', 'field_values',
    $old$or field_value not in ('all','name','id','code','erp','barcode')$old$,
    $new$or field_value not in ('all','name','number','id','code','erp','barcode')$new$),
   ('private.admin_goods_console_matches(text,text,text,text,uuid,text,jsonb)', 'sort_values',
    $old$or sort_value not in ('created_desc','updated_desc','name_asc','id_asc','price_asc','price_desc','stock_asc','stock_desc')$old$,
    $new$or sort_value not in ('created_desc','updated_desc','name_asc','number_asc','number_desc','id_asc','price_asc','price_desc','stock_asc','stock_desc')$new$),
   ('private.admin_goods_console_matches(text,text,text,text,uuid,text,jsonb)', 'sale_period',
    $old$and case sale_period_value
        when 'scheduled' then (source.good).sale_starts_at is not null and now() < (source.good).sale_starts_at
        when 'ended' then (source.good).sale_ends_at is not null and now() >= (source.good).sale_ends_at
        else true end$old$,
    $new$and private.admin_goods_sale_period_matches(sale_period_value,(source.good).sale_starts_at,(source.good).sale_ends_at)$new$),
   ('private.admin_goods_console_matches(text,text,text,text,uuid,text,jsonb)', 'number_field',
    $old$        when 'id' then lower((source.good).id) = any(regexp_split_to_array(query_value,'[[:space:],]+'))$old$,
    $new$        when 'number' then (source.good).product_no::text = any(regexp_split_to_array(query_value,'[[:space:],]+'))
        when 'id' then lower((source.good).id) = any(regexp_split_to_array(query_value,'[[:space:],]+'))$new$),
   ('public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)', 'period_universe',
    $old$  with universe as materialized (
    select * from private.admin_goods_console_matches(p_query,p_ip_id,'all','all',p_category_id,p_readiness,p_filters)
  ), scope as ($old$,
    $new$  -- 판매기간 축은 건수를 위해 여기서 거른다(나머지 조건 검증은 admin_goods_console_matches가 한다).
  if jsonb_typeof(p_filters) is distinct from 'object'
    or jsonb_typeof(p_filters->'salePeriod') not in ('string','null')
    or coalesce(p_filters->>'salePeriod','all') not in ('all','scheduled','ended') then
    raise invalid_parameter_value using message = 'invalid_goods_console_filter';
  end if;
  with period_universe as materialized (
    select * from private.admin_goods_console_matches(p_query,p_ip_id,'all','all',p_category_id,p_readiness,p_filters - 'salePeriod')
  ), universe as materialized (
    select * from period_universe
    where private.admin_goods_sale_period_matches(coalesce(p_filters->>'salePeriod','all'),(good).sale_starts_at,(good).sale_ends_at)
  ), scope as ($new$),
   ('public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)', 'period_scope',
    $old$  ), matched as materialized (
    select * from status_scope where private.admin_goods_stock_filter_matches(p_stock,(good).stock,(readiness->>'activeStockQty')::bigint)
  ), ordered as ($old$,
    $new$  ), matched as materialized (
    select * from status_scope where private.admin_goods_stock_filter_matches(p_stock,(good).stock,(readiness->>'activeStockQty')::bigint)
  ), period_scope as (
    select * from period_universe where case p_status
      when 'all' then true when 'archived' then (good).archived_at is not null
      when 'draft' then (good).archived_at is null and (good).published_at is null
      when 'published' then (good).archived_at is null and (good).published_at is not null
      else (good).archived_at is null end
      and private.admin_goods_stock_filter_matches(p_stock,(good).stock,(readiness->>'activeStockQty')::bigint)
  ), ordered as ($new$),
   ('public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)', 'number_sort',
    $old$      case when sort_value = 'name_asc' then (good).name end asc nulls last,$old$,
    $new$      case when sort_value = 'name_asc' then (good).name end asc nulls last,
      case when sort_value = 'number_asc' then (good).product_no end asc nulls last,
      case when sort_value = 'number_desc' then (good).product_no end desc nulls last,$new$),
   ('public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)', 'sale_state_counts',
    $old$      'low',count(*) filter(where private.admin_goods_stock_filter_matches('low',(good).stock,(readiness->>'activeStockQty')::bigint))) from status_scope),$old$,
    $new$      'low',count(*) filter(where private.admin_goods_stock_filter_matches('low',(good).stock,(readiness->>'activeStockQty')::bigint))) from status_scope),
    'saleStateCounts',jsonb_build_object(
      'scheduled',(select count(*) from period_scope where private.admin_goods_sale_period_matches('scheduled',(good).sale_starts_at,(good).sale_ends_at)),
      'stopped',(select count(*) from status_scope where private.admin_goods_stock_filter_matches('stopped',(good).stock,(readiness->>'activeStockQty')::bigint)),
      'ended',(select count(*) from period_scope where private.admin_goods_sale_period_matches('ended',(good).sale_starts_at,(good).sale_ends_at))),$new$),
   ('public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)', 'product_no_row',
    $old$      'id',(good).id,'code',(good).code,'name',(good).name,'ipId',(good).ip_id,$old$,
    $new$      'id',(good).id,'productNo',(good).product_no,'code',(good).code,'name',(good).name,'ipId',(good).ip_id,$new$),
   ('public.admin_search_goods(text)', 'product_no_match',
    $old$      or good.id ilike pattern escape E'\\'$old$,
    $new$      or good.id ilike pattern escape E'\\'
      or good.product_no::text = needle$new$)
  ) supplied(signature, name, old_text, new_text) where supplied.signature = target.signature loop
   if (length(definition) - length(replace(definition, patch.old_text, ''))) / length(patch.old_text) <> 1 then
    raise exception 'goods_product_numbers_anchor_changed: %', patch.name;
   end if;
   definition := replace(definition, patch.old_text, patch.new_text);
  end loop;
  execute definition;
 end loop;
end $patch$;

-- create or replace는 ACL을 유지하지만 계약을 다시 봉인한다.
revoke all on function private.admin_goods_console_matches(text,text,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function private.admin_goods_console_matches(text,text,text,text,uuid,text,jsonb) to postgres;
revoke all on function public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb) to authenticated;
revoke all on function public.admin_search_goods(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_goods(text) to authenticated;

-- 등록된 운영자 계약이 있으면 새 본문·ACL로 다시 등록한다(없으면 아무것도 하지 않는다).
do $$declare fn regprocedure; contract record; begin
 foreach fn in array array['private.admin_goods_console_matches(text,text,text,text,uuid,text,jsonb)'::regprocedure,
   'public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)'::regprocedure,
   'public.admin_search_goods(text)'::regprocedure] loop
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
  if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
  elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
   perform private.register_operator_internal_contract(fn);
  end if;
 end loop;
end $$;

commit;
notify pgrst, 'reload schema';
