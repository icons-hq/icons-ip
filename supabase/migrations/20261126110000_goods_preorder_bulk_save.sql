-- ==========================================================================
-- ICONS · 예약판매 한 번에 저장 — 옵션 선택 판매 상품 (2026-11-25 상품등록 화면 정리, 화면 규칙 6)
--
-- 저장된 상품의 예약판매 패널은 옵션 하나씩만 저장할 수 있었다(옵션 하나 저장 → 입력이 비고 첫 옵션으로 돌아감).
-- 옵션 30개에 같은 일정을 넣으려면 같은 값을 30번 넣어야 했고, 한 번에 넣는 수단은 랜덤 판매 상품
-- (admin_save_random_goods_preorders, 20261111100000)에만 있었다.
--
-- 이 migration이 더하는 것: public.admin_save_goods_preorders_bulk(p_good_id, p_options).
--   · p_options = [{variantId, values:{capacityQty, startsAt, endsAt, expectedShipDate}}] (1~100개, 옵션마다 값을 싣는다 —
--     화면의 기본은 모든 옵션 같은 일정이고, 옵션마다 일정을 다르게 넣을 때도 같은 함수를 쓴다).
--   · 옵션마다 기존 public.admin_save_goods_preorder를 그대로 부르는 얇은 래퍼다. 입력 검증·권한(catalog.manage)·
--     옵션 단위 감사 기록(admin.good.preorder_saved)·판매기간/주문 후 제작과의 배타 트리거는 옵션 단위로 그대로 탄다.
--     한 트랜잭션이라 하나라도 거절되면 아무것도 저장되지 않는다.
--   · 과판매 방지: 이미 적용 중(state='active' — 접수 예정·접수 중·접수 기간이 끝났지만 아직 중지하지 않은)인 예약 조건이
--     있는 옵션은 건너뛰고 skipped로 알린다. 그 조건을 중지하고 새로 만들면 남은 예약 물량이 처음부터 다시 계산되어
--     (private.goods_preorder_remaining은 조건별로 센다) 이미 받은 수량만큼 더 팔 수 있기 때문이다. 중지는 이 함수로 할 수 없다
--     (values에 state를 받지 않고 언제나 'active'로 넣는다).
--   · 기존 함수는 재정의하지 않는다. 돈·재고·주문 경로는 바뀌지 않는다.
--
-- 잠금 순서는 랜덤 일괄 저장과 같다: 상품 → 그 상품의 옵션(id 순) → 옵션별 저장(variantId 순). 주문 접수(주문 → 구매자 →
-- 상품·옵션)와 엇갈리지 않는다.
-- ==========================================================================

begin;

create function public.admin_save_goods_preorders_bulk(p_good_id text,p_options jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; good public.goods; entry jsonb; variant_key uuid; listed uuid[]:='{}'; result jsonb;
  saved jsonb:='[]'; skipped jsonb:='[]'; active_policy uuid;
  uuid_pattern constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  actor:=private.require_operator_capability('catalog.manage',false);
  if nullif(btrim(p_good_id),'') is null or jsonb_typeof(p_options) is distinct from 'array'
    or jsonb_array_length(p_options) not between 1 and 100 then
    raise invalid_parameter_value using message='invalid_preorder_bulk';
  end if;
  for entry in select value from jsonb_array_elements(p_options) loop
    if jsonb_typeof(entry) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(entry) key where key not in ('variantId','values'))
      or jsonb_typeof(entry->'variantId') is distinct from 'string' or entry->>'variantId' !~ uuid_pattern
      or jsonb_typeof(entry->'values') is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(entry->'values') key where key not in ('capacityQty','startsAt','endsAt','expectedShipDate')) then
      raise invalid_parameter_value using message='invalid_preorder_bulk';
    end if;
    listed:=listed||(entry->>'variantId')::uuid;
  end loop;
  if cardinality(listed)<>(select count(distinct value) from unnest(listed) value) then
    raise invalid_parameter_value using message='invalid_preorder_bulk';
  end if;
  select * into good from public.goods where id=p_good_id for update;
  if not found or good.archived_at is not null then raise no_data_found using message='good_not_found'; end if;
  perform 1 from public.goods_variants where good_id=p_good_id order by id for update;
  if exists(select 1 from unnest(listed) value
    where not exists(select 1 from public.goods_variants variant where variant.id=value and variant.good_id=p_good_id)) then
    raise no_data_found using message='goods_variant_not_found';
  end if;
  for entry in select value from jsonb_array_elements(p_options) order by value->>'variantId' loop
    variant_key:=(entry->>'variantId')::uuid;
    -- 이미 적용 중인 조건이 있으면 그대로 둔다(받은 예약 수량을 잃지 않는다). 상품과 옵션 행을 잠근 뒤라 그사이 바뀌지 않는다.
    select policy.id into active_policy from private.goods_preorder_policies policy
      where policy.variant_id=variant_key and policy.state='active' order by policy.created_at desc limit 1;
    if found then
      skipped:=skipped||jsonb_build_array(jsonb_build_object('variantId',variant_key,'policyId',active_policy,'reason','preorder_policy_already_active'));
      continue;
    end if;
    result:=public.admin_save_goods_preorder(p_good_id,variant_key,null,(entry->'values')||jsonb_build_object('state','active'),null);
    saved:=saved||jsonb_build_array(jsonb_build_object('variantId',variant_key)||result);
  end loop;
  if jsonb_array_length(saved)>0 then
    insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.good.preorders_bulk_saved','goods:'||p_good_id,
      jsonb_build_object('saved',saved,'skipped',skipped));
  end if;
  return jsonb_build_object('goodId',p_good_id,'saved',saved,'skipped',skipped);
end $$;
-- Supabase 기본 권한이 public 함수에 anon·authenticated·service_role 실행을 자동으로 준다. 모두 거둔 뒤 운영자 로그인에만 연다.
revoke all on function public.admin_save_goods_preorders_bulk(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_preorders_bulk(text,jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_goods_preorders_bulk(text,jsonb)'::regprocedure,'catalog.manage','write',false);

commit;
notify pgrst,'reload schema';
