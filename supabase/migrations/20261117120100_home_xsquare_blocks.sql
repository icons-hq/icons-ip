-- X SQUARE 홈(ADR-0043): 고정 홈 블록 2개(NEW ARRIVAL = new_arrivals, 홈 스트립 배너 = strip_banner)와
-- 상품 모음의 '그리드형(5열)'(layout 'grid'). 정의 원본은 20261020085320_home_free_product_collections.sql이며
-- 허용 목록만 바꿨다 — 필수 키 집합(원래 다섯 개)·나머지 규칙은 그대로라 새 키가 없는 옛 저장값·옛 요청도 계속 유효하다.
-- `private.save_home_curation`은 `private.is_valid_home_product_collection`만 부르므로 고치지 않는다.

-- 1) 상품 모음: layout 'grid'는 item_count 5 또는 10, image_shape 'square' 고정. list(3~12)·full_image(1~8) 범위는 그대로.
create or replace function private.is_valid_home_product_collection(candidate jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare item jsonb;seen text[]:='{}';count_value numeric;
begin
 if candidate is null or jsonb_typeof(candidate)<>'object' then return false;end if;
 if not candidate ?& array['layout','image_shape','item_count','good_ids']
  or candidate-array['layout','image_shape','item_count','good_ids']<>'{}'::jsonb
  or jsonb_typeof(candidate->'layout') is distinct from 'string'
  or candidate->>'layout' not in ('list','full_image','grid')
  or jsonb_typeof(candidate->'image_shape') is distinct from 'string'
  or candidate->>'image_shape' not in ('square','portrait','landscape')
  or jsonb_typeof(candidate->'item_count') is distinct from 'number'
  or jsonb_typeof(candidate->'good_ids') is distinct from 'array' then return false;end if;
 count_value:=(candidate->>'item_count')::numeric;
 if count_value<>trunc(count_value)
  or (candidate->>'layout'='list' and count_value not between 3 and 12)
  or (candidate->>'layout'='full_image' and count_value not between 1 and 8)
  or (candidate->>'layout'='grid' and (count_value not in (5,10) or candidate->>'image_shape'<>'square'))
  or jsonb_array_length(candidate->'good_ids')>100 then return false;end if;
 for item in select value from jsonb_array_elements(candidate->'good_ids') loop
  if jsonb_typeof(item)<>'string' or item#>>'{}'!~'^[A-Za-z0-9_-]{1,64}$' or (item#>>'{}')=any(seen) then return false;end if;
  seen:=array_append(seen,item#>>'{}');
 end loop;
 return true;
end $$;
revoke all on function private.is_valid_home_product_collection(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.is_valid_home_product_collection(jsonb) to postgres;

-- 2) 레이아웃 검증: 고정 키에 new_arrivals·strip_banner 추가(저장 레이아웃에는 선택 키다).
CREATE OR REPLACE FUNCTION private.is_valid_home_layout_blocks(candidate jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare entry jsonb; block_key text; seen text[] := '{}';
begin
  if candidate is null then return true; end if;
  if pg_catalog.jsonb_typeof(candidate) <> 'array'
    or pg_catalog.jsonb_array_length(candidate) not between 5 and 1000 then return false; end if;
  for entry in select value from pg_catalog.jsonb_array_elements(candidate)
  loop
    if pg_catalog.jsonb_typeof(entry) <> 'object'
      or pg_catalog.jsonb_typeof(entry->'key') is distinct from 'string'
      or pg_catalog.jsonb_typeof(entry->'enabled') is distinct from 'boolean'
      or exists(select 1 from pg_catalog.jsonb_object_keys(entry) field where field not in ('key','enabled'))
    then return false; end if;
    block_key := entry->>'key';
    if block_key = any(seen) then return false; end if;
    if block_key not in ('hero','editor_picks','category_best','popular','benefits','stories','new_arrivals','strip_banner')
      and block_key !~ '^(band|sales|reviews|mosaic|products):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then return false; end if;
    seen := pg_catalog.array_append(seen, block_key);
  end loop;
  return array['hero','editor_picks','category_best','popular','benefits']::text[] <@ seen;
end;
$function$;
revoke all on function private.is_valid_home_layout_blocks(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.is_valid_home_layout_blocks(jsonb) to postgres;

-- 3) 공개 순서 RPC: 두 키를 공개 렌더 키로 인정하고, 저장 레이아웃에 없으면 stories와 같은 방식으로 맨 뒤에
--    stories → new_arrivals → strip_banner 순서로 붙인다(명시적으로 숨긴 키는 되살리지 않는다).
CREATE OR REPLACE FUNCTION public.get_home_layout_order()
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare configured jsonb; result text[];
begin
  select blocks into configured from public.home_layout_settings where singleton;
  if configured is null then return null; end if;
  with requested as (
    select item->>'key' as key, item->'enabled'='true'::jsonb as enabled, position
    from pg_catalog.jsonb_array_elements(configured) with ordinality entries(item,position)
  ), active_bands as (
    select (case kind when 'band_banner' then 'band:' when 'sales_best' then 'sales:' when 'review_best' then 'reviews:' when 'product_mosaic' then 'mosaic:' else 'products:' end)||id::text as key,
      case kind when 'band_banner' then 0 when 'sales_best' then 1 when 'review_best' then 2 when 'product_mosaic' then 3 else 4 end as kind_order,display_order, active_from, id
    from public.home_curations
    where kind in ('band_banner','sales_best','review_best','product_mosaic','product_collection') and enabled and active_from<=now()
      and (active_to is null or active_to>now())
      and (kind<>'product_collection' or jsonb_array_length(private.public_home_product_collection_goods(payload))>0)
  ), ordered as (
    select requested.key, requested.position
    from requested
    where requested.enabled and (
      requested.key in ('hero','editor_picks','category_best','popular','benefits','stories','new_arrivals','strip_banner')
      or exists(select 1 from active_bands where active_bands.key=requested.key)
    )
    union all
    select active_bands.key,
      pg_catalog.jsonb_array_length(configured)+row_number() over(order by kind_order,display_order,active_from,id)
    from active_bands where not exists(select 1 from requested where requested.key=active_bands.key)
    union all
    select fixed.key,pg_catalog.jsonb_array_length(configured)+(select count(*) from active_bands)+fixed.slot
    from (values ('stories',1),('new_arrivals',2),('strip_banner',3)) fixed(key,slot)
    where not exists(select 1 from requested where requested.key=fixed.key)
  )
  select coalesce(pg_catalog.array_agg(key order by position),'{}'::text[]) into result from ordered;
  return result;
end;
$function$;
revoke all on function public.get_home_layout_order() from public,anon,authenticated,service_role;
grant execute on function public.get_home_layout_order() to anon,authenticated;

-- 4) 이행: 저장된 레이아웃이 있으면 new_arrivals를 editor_picks 바로 뒤, strip_banner를 그 뒤에 켠 상태로 끼운다.
--    이미 있는 키는 건드리지 않고(운영자가 숨겼다면 그대로), 한쪽만 있으면 나머지 하나만 알맞은 자리에 더한다.
--    저장된 레이아웃이 없으면(null) 코드 기본 순서가 같은 위치를 쓰므로 바꾸지 않는다. revision을 올려 열려 있던
--    어드민 화면이 옛 값으로 덮어쓰지 못하게 한다(낙관적 충돌). 시스템 이행이라 감사 기록 선례가 없어 audit_log는 쓰지 않는다.
do $$
declare current_blocks jsonb; rebuilt jsonb:='[]'::jsonb; entry jsonb; has_arrivals boolean; has_strip boolean;
begin
  select blocks into current_blocks from public.home_layout_settings where singleton for update;
  if current_blocks is null then return; end if;
  has_arrivals:=exists(select 1 from pg_catalog.jsonb_array_elements(current_blocks) e where e->>'key'='new_arrivals');
  has_strip:=exists(select 1 from pg_catalog.jsonb_array_elements(current_blocks) e where e->>'key'='strip_banner');
  if has_arrivals and has_strip then return; end if;
  for entry in select value from pg_catalog.jsonb_array_elements(current_blocks) with ordinality entries(value,position) order by position loop
    rebuilt:=rebuilt||pg_catalog.jsonb_build_array(entry);
    if entry->>'key'='editor_picks' and not has_arrivals then
      rebuilt:=rebuilt||'[{"key":"new_arrivals","enabled":true}]'::jsonb;
      if not has_strip then rebuilt:=rebuilt||'[{"key":"strip_banner","enabled":true}]'::jsonb; end if;
    elsif entry->>'key'='new_arrivals' and not has_strip then
      rebuilt:=rebuilt||'[{"key":"strip_banner","enabled":true}]'::jsonb;
    end if;
  end loop;
  update public.home_layout_settings set blocks=rebuilt,revision=revision+1,updated_at=clock_timestamp() where singleton;
end $$;

-- 5) 재정의한 세 함수의 운영자 계약 지문(ACL 재설정 뒤).
select private.register_operator_internal_contract('private.is_valid_home_product_collection(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.is_valid_home_layout_blocks(jsonb)'::regprocedure);
select private.register_operator_internal_contract('public.get_home_layout_order()'::regprocedure);
notify pgrst,'reload schema';
