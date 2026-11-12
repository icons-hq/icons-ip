-- T15b(1027T-024·0901-008): 상품 등록 화면의 '저장 전 전부 입력'과 신규 '저장 후 공개'.
--
-- 10/27 회의 결정(묶음 10): 상태를 바꾸는 항목(재고 조정·옵션 사용·복사·보관)만 저장 뒤에 두고, 나머지는 첫 저장 때 한 번에
-- 저장한다(원자 저장 확대). 9/1 결정(묶음 11): 신규 등록에도 '저장 후 공개'를 두고, 빈 화면에서 공개까지 10클릭 이내.
--
-- 1. public.admin_save_good_workspace(jsonb)를 앵커 치환으로 넓힌다(T16a 기타 인증·T16b 유형 확인 층을 그대로 둔다).
--    - sections에 나머지 설정 13개를 받는다: optionSaleMode·purchaseCosts·pricePeriods·additional·benefits·afterSales·sizeChart·
--      listingColors·transactionTerms·shippingChargeGroup·subscriptionPolicy·fulfillment·production. 새 상품(previous_id 없음)만 받는다
--      — 저장된 상품은 지금처럼 같은 자리의 독립 패널이 자기 버전(CAS)으로 따로 저장한다.
--    - 기본 저장·KC·예약판매·기타 인증 다음에 같은 트랜잭션에서 각 섹션의 기존 저장 RPC를 그대로 부른다. 권한(매입단가는
--      platform.manage+admin, 예약 활성화는 관리자)·검증·감사 기록은 각 RPC가 지금처럼 다시 한다. 하나라도 실패하면 기본 입력까지
--      모두 되돌린다. 실패는 'goods_workspace_section_failed:<섹션>:<원래 오류>'로 섹션을 담아 알린다.
--    - good.publish=true(새 상품만): 기본 저장 체인은 초안으로 저장하고, 모든 섹션을 저장한 뒤 같은 요청에서 공개를 시도한다.
--      판정은 기존 공개 경로(public.admin_set_good_published → private.set_good_published·goods 트리거의 KC·출고지 가드) 그대로다.
--      공개가 거절되면 그 시도만 되돌리고 저장은 남기며, 거절 이유를 영수증(publish)에 싣는다. 영수증은 재시도에 그대로 돌아간다.
-- 2. private.resolve_goods_workspace_variant가 기간 할인·매입단가 옵션 참조도 해석한다(섹션 이름만 더한다).
-- 3. 같은 migration 끝에서 운영자 계약을 다시 적는다.

-- ---------------------------------------------------------------------------
-- 0. 앵커 치환 도우미: 현재 정의에서 앵커가 정확히 한 번 나올 때만 바꾼다(다른 migration이 같은 줄을 고쳤으면 실패한다).
create function private.goods_workspace_all_sections_patch(p_function regprocedure, p_patches jsonb)
returns void
language plpgsql
volatile
set search_path = ''
as $helper$
declare
  v_definition text := pg_catalog.pg_get_functiondef(p_function);
  v_patch jsonb;
  v_found integer;
begin
  for v_patch in select value from pg_catalog.jsonb_array_elements(p_patches) loop
    v_found := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_patch->>0, '')))
      / pg_catalog.length(v_patch->>0);
    if v_found <> 1 then
      raise exception 'goods_workspace_all_sections_anchor_changed: % (% matches)', p_function, v_found;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;
revoke all on function private.goods_workspace_all_sections_patch(regprocedure, jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. 옵션 참조 해석: 기간 할인(price_period)·매입단가(purchase_cost)도 같은 규칙으로 찾는다.
select private.goods_workspace_all_sections_patch('private.resolve_goods_workspace_variant(text,jsonb,uuid[],text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$if p_section is null or p_section not in ('kc','preorder') then$anchor$,
    $patched$if p_section is null or p_section not in ('kc','preorder','price_period','purchase_cost') then$patched$)));
revoke all on function private.resolve_goods_workspace_variant(text,jsonb,uuid[],text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. 나머지 설정 저장. admin_save_good_workspace(새 상품의 기본 저장 직후, 같은 트랜잭션)만 부른다.
--    섹션마다 기존 저장 RPC를 그대로 부르고, 새 상품이라 기대 버전은 지금 저장값(없으면 0)이다. 작업 ID는 섹션마다 새로 만든다
--    — 같은 등록 요청의 재시도는 래퍼 영수증이 저장 결과를 돌려주므로 섹션 RPC에 다시 들어가지 않는다.
--    순서: 매입단가 → 기간 할인 → 추가 구성 → 사은품 → A/S → 사이즈 → 색상칩 → 복수구매 할인·배송비 → 묶음그룹 →
--    정기배송 → 수령 방식 → 제작 → 판매 방식. 판매 방식(랜덤 전환)을 맨 뒤에 두어, 기존 전환 검사(goods_random_option_switch_problem)가
--    같은 요청의 정기배송·기간 할인을 모두 본다. 예약판매·제작·디지털 등 함께 쓸 수 없는 조합은 각 RPC가 지금처럼 거절한다.
create function private.save_goods_workspace_extra_sections(p_good_id text, p_sections jsonb, p_new_variants uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  session_id uuid;
  section text;
  entry jsonb;
  value jsonb;
  variant uuid;
  saved jsonb := '{}'::jsonb;
  result jsonb;
  results jsonb;
  good_updated timestamptz;
  revision bigint;
  good_row public.goods;
  origin_doc jsonb;
  group_revision integer;
  uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p_good_id is null or jsonb_typeof(p_sections) is distinct from 'object' then
    raise invalid_parameter_value using message = 'invalid_goods_workspace_request';
  end if;
  -- 로그인 세션에 묶인 저장(수령 방식·제작·묶음그룹)은 지금 요청의 세션으로 부른다. 없으면 각 RPC가 권한 오류로 거절한다.
  session_id := case when coalesce(auth.jwt()->>'session_id', '') ~ uuid_pattern then (auth.jwt()->>'session_id')::uuid end;
  foreach section in array array['purchaseCosts','pricePeriods','additional','benefits','afterSales','sizeChart',
    'listingColors','transactionTerms','shippingChargeGroup','subscriptionPolicy','fulfillment','production','optionSaleMode'] loop
    continue when not (p_sections ? section);
    value := p_sections->section;
    begin
      case section
      when 'optionSaleMode' then
        if jsonb_typeof(value) is distinct from 'string' or value #>> '{}' not in ('select','random') then
          raise invalid_parameter_value using message = 'invalid_goods_workspace_request';
        end if;
        -- 새 상품은 옵션 선택 판매로 만들어진다. 랜덤 판매를 고른 경우만 전환하고, 조건은 기존 전환 RPC가 판정한다.
        if value #>> '{}' = 'random' then
          select updated_at into good_updated from public.goods where id = p_good_id;
          result := public.admin_set_goods_option_sale_mode(p_good_id, 'random', good_updated);
        else
          result := jsonb_build_object('optionSaleMode', 'select');
        end if;
      when 'purchaseCosts' then
        if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value) > 100 then
          raise invalid_parameter_value using message = 'invalid_goods_workspace_request';
        end if;
        results := '[]'::jsonb;
        for entry in select item from jsonb_array_elements(value) item loop
          if jsonb_typeof(entry) is distinct from 'object'
            or (select array_agg(key order by key) from jsonb_object_keys(entry) key) is distinct from array['taxBasis','unitCostKrw','variant']
            or jsonb_typeof(entry->'unitCostKrw') not in ('null','number')
            or (jsonb_typeof(entry->'unitCostKrw') = 'number' and (entry->>'unitCostKrw' !~ '^(0|[1-9][0-9]*)$' or (entry->>'unitCostKrw')::numeric > 2147483647))
            or jsonb_typeof(entry->'taxBasis') not in ('null','string') then
            raise invalid_parameter_value using message = 'invalid_goods_workspace_request';
          end if;
          variant := private.resolve_goods_workspace_variant(p_good_id, entry->'variant', p_new_variants, 'purchase_cost');
          results := results || jsonb_build_array(public.admin_save_goods_variant_purchase_cost(p_good_id, variant,
            (entry->>'unitCostKrw')::integer, entry->>'taxBasis', null) || jsonb_build_object('variantId', variant));
        end loop;
        result := results;
      when 'pricePeriods' then
        if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value) > 100 then
          raise invalid_parameter_value using message = 'invalid_goods_workspace_request';
        end if;
        results := '[]'::jsonb;
        for entry in select item from jsonb_array_elements(value) item loop
          if jsonb_typeof(entry) is distinct from 'object'
            or (select array_agg(key order by key) from jsonb_object_keys(entry) key) is distinct from array['period','variant']
            or jsonb_typeof(entry->'period') is distinct from 'object' then
            raise invalid_parameter_value using message = 'invalid_goods_workspace_request';
          end if;
          variant := private.resolve_goods_workspace_variant(p_good_id, entry->'variant', p_new_variants, 'price_period');
          results := results || jsonb_build_array(public.admin_save_goods_price_period(p_good_id, variant, null, entry->'period', null)
            || jsonb_build_object('variantId', variant));
        end loop;
        result := results;
      when 'additional' then
        if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value) > 50
          or exists(select 1 from jsonb_array_elements(value) item where jsonb_typeof(item) is distinct from 'string') then
          raise invalid_parameter_value using message = 'invalid_goods_workspace_request';
        end if;
        result := public.admin_save_goods_additional(p_good_id, array(select item from jsonb_array_elements_text(value) item),
          (select sets.revision from private.goods_additional_sets sets where sets.good_id = p_good_id));
      when 'benefits' then
        select coalesce(max(content.revision), 0) into revision from private.goods_benefit_content content where content.good_id = p_good_id;
        result := public.admin_save_goods_benefit_content(p_good_id, revision::integer, gen_random_uuid(), value);
      when 'afterSales' then
        select coalesce(max(content.revision), 0) into revision from private.goods_after_sales_content content where content.good_id = p_good_id;
        result := public.admin_save_goods_after_sales_content(p_good_id, revision::integer, gen_random_uuid(), value);
      when 'sizeChart' then
        select coalesce(max(chart.revision), 0) into revision from private.goods_size_charts chart where chart.good_id = p_good_id;
        result := public.admin_save_goods_size_chart(p_good_id, revision::integer, gen_random_uuid(), value);
      when 'listingColors' then
        select coalesce(max(colors.revision), 0) into revision from private.goods_listing_colors colors where colors.good_id = p_good_id;
        result := public.admin_save_goods_listing_colors(p_good_id, value, revision, gen_random_uuid());
      when 'transactionTerms' then
        if jsonb_typeof(value) is distinct from 'object'
          or exists(select 1 from jsonb_object_keys(value) key where key not in ('volume','delivery'))
          or coalesce(jsonb_typeof(value->'volume'), 'null') not in ('null','object')
          or coalesce(jsonb_typeof(value->'delivery'), 'null') not in ('null','object') then
          raise invalid_parameter_value using message = 'invalid_goods_workspace_request';
        end if;
        select coalesce(max(config.revision), 0) into revision from private.goods_transaction_configs config where config.good_id = p_good_id;
        select updated_at into good_updated from public.goods where id = p_good_id;
        result := public.admin_save_good_transaction_terms(p_good_id, revision::integer, good_updated,
          case when jsonb_typeof(value->'volume') = 'object' then value->'volume' end,
          case when jsonb_typeof(value->'delivery') = 'object' then value->'delivery' end,
          gen_random_uuid(), actor);
      when 'shippingChargeGroup' then
        -- 화면이 고른 그룹과 그때 본 그룹 버전만 받는다. 상품·출고지 기준값은 같은 트랜잭션의 지금 저장값으로 만든다.
        if jsonb_typeof(value) is distinct from 'object'
          or (select array_agg(key order by key) from jsonb_object_keys(value) key) is distinct from array['expectedRevision','groupId']
          or jsonb_typeof(value->'groupId') is distinct from 'string' or value->>'groupId' !~ uuid_pattern
          or jsonb_typeof(value->'expectedRevision') is distinct from 'number' or value->>'expectedRevision' !~ '^[1-9][0-9]*$'
          or (value->>'expectedRevision')::numeric > 2147483647 then
          raise invalid_parameter_value using message = 'invalid_goods_workspace_request';
        end if;
        select * into good_row from public.goods where id = p_good_id;
        origin_doc := case when good_row.origin_id is null then null else private.shipping_charge_group_origin(good_row.origin_id) end;
        result := public.admin_assign_shipping_charge_group(jsonb_build_object(
          'operationId', gen_random_uuid(), 'command', 'assign', 'groupId', lower(value->>'groupId'),
          'expectedRevision', (value->>'expectedRevision')::integer, 'expectedActorId', actor, 'expectedSessionId', session_id,
          'origins', case when origin_doc is null then '[]'::jsonb else jsonb_build_array(origin_doc) end,
          'goods', jsonb_build_array(private.shipping_charge_group_good_guard(good_row))));
      when 'subscriptionPolicy' then
        if jsonb_typeof(value) is distinct from 'object'
          or (select array_agg(key order by key) from jsonb_object_keys(value) key) is distinct from array['enabled','intervals','message']
          or jsonb_typeof(value->'enabled') is distinct from 'boolean' or jsonb_typeof(value->'message') is distinct from 'string' then
          raise invalid_parameter_value using message = 'invalid_goods_workspace_request';
        end if;
        select coalesce(max(policy.revision), 0) into revision from private.goods_subscription_policies policy where policy.good_id = p_good_id;
        select updated_at into good_updated from public.goods where id = p_good_id;
        result := public.admin_save_goods_subscription_policy(actor, p_good_id, revision, good_updated, gen_random_uuid(),
          (value->>'enabled')::boolean, value->'intervals', value->>'message');
      when 'fulfillment' then
        select coalesce(max(settings.revision), 0) into revision from private.goods_fulfillment_settings settings where settings.good_id = p_good_id;
        result := public.admin_save_goods_fulfillment(p_good_id, value, revision, gen_random_uuid(), actor, session_id);
      when 'production' then
        select coalesce(max(settings.revision), 0) into revision from private.goods_production_settings settings where settings.good_id = p_good_id;
        result := public.admin_save_goods_production(p_good_id, value, revision, gen_random_uuid(), actor, session_id);
      end case;
    exception when others then
      -- 어느 섹션이 실패했는지 담아 다시 던진다(같은 오류 코드). 래퍼 트랜잭션 전체가 되돌아간다.
      raise exception using errcode = sqlstate, message = 'goods_workspace_section_failed:' || section || ':' || sqlerrm;
    end;
    saved := saved || jsonb_build_object(section, coalesce(result, 'null'::jsonb));
  end loop;
  return saved;
end
$$;
revoke all on function private.save_goods_workspace_extra_sections(text, jsonb, uuid[]) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. 원자 저장 래퍼. T16a(기타 인증)·T16b(유형 확인)가 앵커 치환한 현재 정의에서 최소 변경한다.
select private.goods_workspace_all_sections_patch('public.admin_save_good_workspace(jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  other_certifications jsonb; other_saved jsonb;$anchor$,
    $patched$  other_certifications jsonb; other_saved jsonb;
  extra_sections jsonb:='{}'::jsonb; extra_saved jsonb; publish_requested boolean:=false; publish_result jsonb;$patched$),
  jsonb_build_array(
    $anchor$where key not in ('kc','preorders','otherCertifications')) then$anchor$,
    $patched$where key not in ('kc','preorders','otherCertifications','optionSaleMode','purchaseCosts','pricePeriods','additional',
    'benefits','afterSales','sizeChart','listingColors','transactionTerms','shippingChargeGroup','subscriptionPolicy','fulfillment','production')) then$patched$),
  jsonb_build_array(
    $anchor$  -- 공개는 기존 게시 상태 전환이 맡는다. 래퍼는 초안 저장만 한다.
  if coalesce(good->'publish','null'::jsonb) not in ('null'::jsonb,'false'::jsonb) then
    raise check_violation using message='goods_workspace_publish_unsupported';
  end if;$anchor$,
    $patched$  -- T15b(0901-008): 새 상품의 '저장 후 공개'. 기본 저장 체인은 초안으로 저장하고, 모든 섹션을 저장한 뒤 같은 요청에서 공개를
  -- 시도한다(아래 9). 저장된 상품의 공개는 지금처럼 게시 상태 전환(admin_save_good·판매 준비 카드)이 맡는다.
  if coalesce(good->'publish','null'::jsonb) not in ('null'::jsonb,'false'::jsonb,'true'::jsonb) then
    raise invalid_parameter_value using message='invalid_goods_workspace_request';
  end if;
  publish_requested:=coalesce(good->'publish','null'::jsonb)='true'::jsonb;
  if publish_requested and nullif(good->>'previous_id','') is not null then
    raise check_violation using message='goods_workspace_publish_unsupported';
  end if;
  if publish_requested then good:=good-'publish'; end if;$patched$),
  jsonb_build_array(
    $anchor$  previous_id:=nullif(good->>'previous_id','');$anchor$,
    $patched$  previous_id:=nullif(good->>'previous_id','');
  -- T15b(1027T-024): 나머지 설정은 새 상품의 첫 저장에서만 함께 저장한다. 저장된 상품은 독립 패널이 자기 버전으로 저장한다.
  extra_sections:=sections-array['kc','preorders','otherCertifications'];
  if extra_sections<>'{}'::jsonb and previous_id is not null then
    raise invalid_parameter_value using message='invalid_goods_workspace_request';
  end if;$patched$),
  jsonb_build_array(
    $anchor$    if kc is not null or coalesce(jsonb_array_length(preorders),0)>0 or other_certifications is not null then$anchor$,
    $patched$    if kc is not null or coalesce(jsonb_array_length(preorders),0)>0 or other_certifications is not null
      or extra_sections<>'{}'::jsonb or publish_requested then$patched$),
  jsonb_build_array(
    $anchor$    result:=jsonb_build_object('id',saved_id,'operationId',operation,'created',previous_id is null,'good',saved,$anchor$,
    $patched$    -- 8. T15b(1027T-024): 나머지 설정. 각 섹션의 기존 저장 RPC가 권한·검증을 다시 하고, 실패하면 기본 입력까지 되돌린다.
    if extra_sections<>'{}'::jsonb then
      extra_saved:=private.save_goods_workspace_extra_sections(saved_id,extra_sections,new_variants);
    end if;
    result:=jsonb_build_object('id',saved_id,'operationId',operation,'created',previous_id is null,'good',saved,$patched$),
  jsonb_build_array(
    $anchor$      'otherCertifications',case when other_saved is null then null else jsonb_build_object('changed',other_saved->'changed',
        'revision',other_saved#>'{configuration,revision}') end);$anchor$,
    $patched$      'otherCertifications',case when other_saved is null then null else jsonb_build_object('changed',other_saved->'changed',
        'revision',other_saved#>'{configuration,revision}') end,
      'sections',coalesce(extra_saved,'{}'::jsonb));
    -- 9. T15b(0901-008): 저장 후 공개. 판정은 기존 공개 경로 그대로이고, 거절되면 그 시도만 되돌려 저장은 남긴다.
    if publish_requested then
      begin
        perform public.admin_set_good_published(saved_id,true);
        publish_result:=jsonb_build_object('requested',true,'published',true,'error',null,'code',null);
      exception when others then
        publish_result:=jsonb_build_object('requested',true,'published',false,'error',sqlerrm,'code',sqlstate);
      end;
      result:=result||jsonb_build_object('publish',publish_result);
    end if;$patched$),
  jsonb_build_array(
    $anchor$'preorders',coalesce(jsonb_array_length(preorders),0),'draftAlreadyCompleted',$anchor$,
    $patched$'preorders',coalesce(jsonb_array_length(preorders),0),
      'sections',(select coalesce(jsonb_agg(key order by key),'[]'::jsonb) from jsonb_object_keys(extra_sections) key),
      'publishRequested',publish_requested,'published',coalesce((publish_result->>'published')::boolean,false),
      'draftAlreadyCompleted',$patched$)));

drop function private.goods_workspace_all_sections_patch(regprocedure, jsonb);

-- 앵커 치환은 create or replace라 소유자·권한이 그대로다. 봉인을 다시 확인한다.
revoke all on function public.admin_save_good_workspace(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_good_workspace(jsonb) to authenticated;

-- 운영자 계약: 앵커 치환한 원자 저장의 본문 지문을 다시 적는다(분류는 기존 행 그대로).
select private.register_operator_rpc_contract('public.admin_save_good_workspace(jsonb)'::regprocedure,'catalog.manage','write',false);
notify pgrst, 'reload schema';
