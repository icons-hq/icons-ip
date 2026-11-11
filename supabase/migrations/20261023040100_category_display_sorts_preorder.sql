-- LFS 패리티 2차 L5(#570) — 카테고리 전시 경로를 컬렉션과 같은 목록 문법으로 맞춘다(L4 잔여 CL-10·CL-11).
-- 정렬 4종 → 7종(추천·이름 가나다순·이름 역순·가격 2·오래된순·최신순, 12 LD-13), 타입 facet·필터에 '예약판매'.
-- 컬렉션(lib/shop-catalog.ts selectCollectionGoods)과 같은 판정이다:
--  - 이름순은 Intl.Collator('ko', { numeric: true, sensitivity: 'base' })와 같은 ICU 규칙(숫자 자연 비교 → 한글 → 영문, 대소문자 동률).
--  - 동률·시각 없음은 추천 순서(수동 순서 또는 진열 순서·자연 ID)로 둔다. 오래된순·최신순 모두 등록 시각이 없으면 뒤다.
--  - '예약판매'는 저장 타입이 아니라 옵션 공급 방식(preorder) 파생 값이고, 타입 그룹 안의 다른 값과 OR 로 고른다. facet 은 타입 뒤 마지막.
-- 조회 토큰 공식·행 투영·배너·영상·추천 블록은 그대로다.

create collation private.category_display_name_ko (provider = icu, locale = 'ko-u-kn-ks-level1', deterministic = false);

create or replace function private.category_display_page(p_category_id uuid,p_values jsonb,p_query jsonb,p_offset integer,p_token text,p_revision bigint) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare category jsonb;result jsonb;fingerprint text;b jsonb;r jsonb;video jsonb;recommendations jsonb;keys text[]:=array['ips','types','min','max','sort'];
begin
 category:=private.category_display_category(p_category_id);
 if category is null or not (category->>'publicEnabled')::boolean then return null;end if;
 if p_offset is null or p_offset<0 or p_offset>10000000 or p_offset%20<>0 or p_offset>0 and (p_token is null or p_token !~ '^[0-9a-f]{32}$')
  or jsonb_typeof(p_query) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_query))<>5 or not p_query ?& keys
  or jsonb_typeof(p_query->'ips') is distinct from 'array' or jsonb_typeof(p_query->'types') is distinct from 'array'
  or jsonb_typeof(p_query->'sort') is distinct from 'string' or p_query->>'sort' not in('recommended','name_asc','name_desc','price_asc','price_desc','oldest','newest')
  or jsonb_typeof(p_query->'min') not in('null','number') or jsonb_typeof(p_query->'max') not in('null','number') then raise invalid_parameter_value using message='invalid_category_display_query';end if;
 if jsonb_array_length(p_query->'ips')>100 or jsonb_array_length(p_query->'types')>9
  or exists(select 1 from jsonb_array_elements(p_query->'ips') value where jsonb_typeof(value)<>'string' or value#>>'{}' !~ '^[a-z0-9][a-z0-9-]{0,199}$')
  or exists(select 1 from jsonb_array_elements(p_query->'types') value where jsonb_typeof(value)<>'string' or value#>>'{}' not in('피규어','인형','키링','아크릴','문구','쿠션','파우치','세트','예약판매'))
  or exists(select 1 from jsonb_each_text(p_query) e where e.key in('min','max') and e.value is not null and (e.value !~ '^[0-9]{1,9}$' or e.value::numeric>100000000))
  or (p_query->>'min')::numeric>(p_query->>'max')::numeric then raise invalid_parameter_value using message='invalid_category_display_query';end if;
 -- Materialize the complete option quote once per candidate. A flattenable
 -- lateral SELECT would run the price/supply helper separately for each of the
 -- JSON projection, minimum price and available-stock expressions.
 with quoted as materialized (
  select g as good,g.id,g.ip_id,g.name,g.type,g.created_at,g.updated_at,g.display_order,m.ordinal_position,ip.title ip_name,
   private.category_display_public_variants(g.id) variants
  from private.category_display_matching_goods(p_values) m join public.goods g on g.id=m.id join public.ips ip on ip.id=g.ip_id
 ), base as materialized (
  select quoted.*,
   coalesce((select min((v#>>'{pricing,effectivePrice}')::numeric) from jsonb_array_elements(variants) v),(good).price) current_price,
   coalesce((select sum((v#>>'{supply,availableQty}')::bigint) from jsonb_array_elements(variants) v),0) available,
   exists(select 1 from jsonb_array_elements(variants) v where v#>>'{supply,mode}'='preorder') preorder
  from quoted
 ), filtered as materialized (
  select * from base where (jsonb_array_length(p_query->'ips')=0 or ip_id in(select value from jsonb_array_elements_text(p_query->'ips')))
   and (jsonb_array_length(p_query->'types')=0 or type in(select value from jsonb_array_elements_text(p_query->'types')) or preorder and p_query->'types' ? '예약판매')
   and (p_query->>'min' is null or current_price>=(p_query->>'min')::numeric) and (p_query->>'max' is null or current_price<=(p_query->>'max')::numeric)
 ), ranked as materialized (
  select *,row_number() over(order by
   case when p_query->>'sort'='price_asc' then current_price end asc,
   case when p_query->>'sort'='price_desc' then current_price end desc,
   (case when p_query->>'sort'='name_asc' then name end) collate private.category_display_name_ko asc,
   (case when p_query->>'sort'='name_desc' then name end) collate private.category_display_name_ko desc,
   case when p_query->>'sort'='newest' then created_at end desc nulls last,
   case when p_query->>'sort'='oldest' then created_at end asc nulls last,
   case when p_values->>'mode'='manual' then ordinal_position end asc nulls last,
   case when p_values->>'mode'='categories' then display_order end asc nulls last,
   case when p_values->>'mode'='categories' then private.category_display_natural_key(id) end collate "C" asc,
   id collate "C") rank from filtered
 ), page as (select * from ranked order by rank limit 20 offset p_offset)
 select jsonb_build_object('category',jsonb_build_object('id',category->'id','name',category->'name'),'checkedAt',statement_timestamp(),
  'total',(select count(*) from base),'filteredTotal',(select count(*) from filtered),'priceCeil',coalesce((select max(current_price) from base),0),
  'token',md5(jsonb_build_array(p_category_id,p_revision,category,p_query,coalesce((select string_agg(id||':'||current_price||':'||available||':'||updated_at,',' order by rank) from ranked),'') )::text),
  'offset',p_offset,'nextOffset',case when (select count(*) from filtered)>p_offset+20 then p_offset+20 else null end,
  'ipFacets',coalesce((select jsonb_agg(jsonb_build_object('value',ip_id,'label',ip_name,'count',n) order by ip_name,ip_id) from (select ip_id,ip_name,count(*) n from base group by ip_id,ip_name) f),'[]'::jsonb),
  'typeFacets',coalesce((select jsonb_agg(jsonb_build_object('value',type,'label',type,'count',n) order by array_position(array['피규어','인형','키링','아크릴','문구','쿠션','파우치','세트'],type)) from (select type,count(*) n from base group by type) f),'[]'::jsonb)
   ||coalesce((select jsonb_build_array(jsonb_build_object('value','예약판매','label','예약판매','count',count(*))) from base where preorder having count(*)>0),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(private.category_display_public_good(good,variants) order by rank) from page),'[]'::jsonb)) into result;
 fingerprint:=result->>'token';if p_token is not null and p_token is distinct from fingerprint then raise sqlstate 'PT409' using message='category_display_page_changed';end if;
 if (result->>'total')::bigint=0 then return result||jsonb_build_object('banner',null,'video',null,'recommendations',null);end if;
 b:=p_values->'banner';r:=p_values->'recommendations';
 if not (b->>'enabled')::boolean then b:=null;else
  b:=jsonb_build_object('title',b->'title','content',b->'content','imagePath',b->'imagePath','mobileImagePath',b->'mobileImagePath',
   'linkPath',b->'linkPath','imageDim',b->'imageDim','textColor',b->'textColor','altText',case when (b->>'altEnabled')::boolean then concat_ws(' · ',nullif(btrim(b->>'altTitle'),''),nullif(btrim(b->>'altContent'),'')) else '' end);
 end if;
 if (p_values#>>'{video,enabled}')::boolean then
  video:=public.get_good_media(p_values#>>'{video,goodId}')->'video';
  if video='null'::jsonb then video:=null;end if;
  if video is not null then video:=jsonb_build_object('asset',video,'poster',(select image_path from public.goods where id=p_values#>>'{video,goodId}'));end if;
 end if;
 if (r->>'enabled')::boolean then
  select jsonb_build_object('title',r->'title','rows',coalesce(jsonb_agg(private.category_display_public_good(good,variants) order by position),'[]'::jsonb)) into recommendations
  from (select g as good,ordinality position,private.category_display_public_variants(g.id) variants
   from jsonb_array_elements_text(r->'goodIds') with ordinality ids join public.goods g on g.id=ids.value join public.ips ip on ip.id=g.ip_id
   where g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null
   order by ordinality limit (r->>'itemCount')::integer) selected;
 end if;
 return result||jsonb_build_object('banner',b,'video',video,'recommendations',recommendations);
end $$;
revoke all on function private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint) from public,anon,authenticated,service_role;

select private.register_operator_internal_contract('private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)'::regprocedure);
