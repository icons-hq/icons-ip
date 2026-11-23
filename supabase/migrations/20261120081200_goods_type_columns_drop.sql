-- ADR-0044 칸 삭제 2단계: goods.type과 order_items.good_type_snapshot을 지운다.
--
-- 1단계(20261119109600_goods_type_columns_unused.sql)가 운영에 배포된 뒤에 적용한다. 지금 운영 앱은 두 칸을 select하지 않고,
-- 아래 응답의 유형 키를 읽지 않으며(그룹 공통정보·선물 주문은 옛 키가 와도 값을 읽지 않는다), 저장 경로는 두 칸을 쓰지 않는다.
--   1. 읽는 쪽(카테고리 진열·주문 조회·스마트스토어 출고·탈퇴 법정 기록)에서 유형을 걷는다.
--      카테고리 진열의 '타입' 묶음은 예약판매 하나만 남고, 'types' 조건은 '예약판매'만 받는다.
--   2. 그룹 공통정보 공통 칸과 상품 임시저장 허용 칸에서 'type'을 뺀다(저장된 임시저장 값에서도 지운다).
--   3. 두 칸(과 goods_type_check)을 지운다.
-- 상품 저장 RPC(admin_upsert_good)의 target_type 인자는 시그니처를 유지한 채 받기만 하고 무시한다(1단계와 같다).
-- KC 검토 기록(goods_kc_reviews.context_snapshot)의 옛 'type' 키는 이력이라 그대로 두고, 현재 여부 비교가 그 키를 뺀다.

-- --------------------------------------------------------------------------
-- 1. 앵커 치환: 현재 정의에서 앵커가 정해진 횟수(기본 1번)만큼 나올 때만 바꾼다.
-- --------------------------------------------------------------------------
create function private.goods_type_column_patch(p_function regprocedure, p_patches jsonb)
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
    if v_found <> coalesce((v_patch->>2)::integer, 1) then
      raise exception 'goods_type_column_anchor_changed: % (% matches)', p_function, v_found;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;
revoke all on function private.goods_type_column_patch(regprocedure, jsonb)
  from public, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- 2. 카테고리 진열: 유형 조건·묶음을 걷고 예약판매만 남긴다.
-- --------------------------------------------------------------------------
select private.goods_type_column_patch(
  'private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)'::regprocedure,
  jsonb_build_array(
    jsonb_build_array($a$value#>>'{}' not in('피규어','인형','키링','아크릴','문구','쿠션','파우치','세트','기타','예약판매'))$a$,
      $a$value#>>'{}' not in('예약판매'))$a$),
    jsonb_build_array('select g as good,g.id,g.ip_id,g.name,g.type,g.created_at,', 'select g as good,g.id,g.ip_id,g.name,g.created_at,'),
    jsonb_build_array($a$or type in(select value from jsonb_array_elements_text(p_query->'types')) or preorder$a$, 'or preorder'),
    jsonb_build_array($a$'typeFacets',coalesce((select jsonb_agg(jsonb_build_object('value',type,'label',type,'count',n) order by array_position(array['피규어','인형','키링','아크릴','문구','쿠션','파우치','세트','기타'],type)) from (select type,count(*) n from base group by type) f),'[]'::jsonb)
   ||coalesce($a$, $a$'typeFacets',coalesce($a$)
  ));

select private.goods_type_column_patch('private.category_display_public_good(public.goods,jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array($a$'name',p_good.name,'type',p_good.type,'price'$a$, $a$'name',p_good.name,'price'$a$)
));

-- --------------------------------------------------------------------------
-- 3. 주문 조회·출고·법정 기록: 유형 스냅샷 키를 걷는다.
-- --------------------------------------------------------------------------
select private.goods_type_column_patch('public.get_my_gift_checkout_order(uuid,uuid)'::regprocedure, jsonb_build_array(
  jsonb_build_array($a$'name',i.good_name_snapshot,'type',i.good_type_snapshot,'qty'$a$, $a$'name',i.good_name_snapshot,'qty'$a$)
));
select private.goods_type_column_patch('public.get_my_gift_checkout_order_numbered(uuid,uuid)'::regprocedure, jsonb_build_array(
  jsonb_build_array($a$'name',i.good_name_snapshot,'type',i.good_type_snapshot,'qty'$a$, $a$'name',i.good_name_snapshot,'qty'$a$)
));
select private.goods_type_column_patch('private.admin_order_detail_before_preorder(uuid)'::regprocedure, jsonb_build_array(
  jsonb_build_array($a$'type',i.good_type_snapshot,'qty',i.qty,$a$, $a$'qty',i.qty,$a$)
));
select private.goods_type_column_patch('public.admin_smartstore_shipment_export(uuid[])'::regprocedure, jsonb_build_array(
  jsonb_build_array($a$'goodId',item.good_id,'goodType',item.good_type_snapshot,$a$, $a$'goodId',item.good_id,$a$)
));
-- 이미 남긴 법정 기록(account_deletion_legal_snapshots)의 goodType은 기록이라 그대로 둔다. 새 기록부터 키가 없다.
select private.goods_type_column_patch('private.snapshot_account_deletion_legal_records(uuid,uuid)'::regprocedure, jsonb_build_array(
  jsonb_build_array($a$              'goodType', item.good_type_snapshot,
$a$, '')
));

-- 고객 주문 품목은 반환 칸이 바뀌므로 다시 만든다(같은 권한·설명). my_order_item_display는 이름으로 칸을 읽어 그대로 맞는다.
drop function public.my_order_items(uuid[]);
create function public.my_order_items(p_order_ids uuid[])
 RETURNS TABLE(id uuid, order_id uuid, product_order_number text, good_id text, qty integer, unit_price integer, good_name_snapshot text, variant_id uuid, variant_name_snapshot text, variant_code_snapshot text, custom_inputs_snapshot jsonb, supply_source text, preorder_expected_ship_date date, option_sale_mode text, shipment_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare actor uuid:=auth.uid();
begin
  if actor is null then raise insufficient_privilege using message='auth required'; end if;
  if p_order_ids is null or cardinality(p_order_ids)>1000 then raise invalid_parameter_value using message='invalid_order_item_ids'; end if;
  return query
  with owned as (
    select item.id item_id,item.order_id item_order_id,item.good_id item_good_id,item.qty item_qty,item.option_sale_mode_snapshot item_mode
    from public.order_items item
    join public.orders o on o.id=item.order_id
    where item.order_id=any(p_order_ids) and o.user_id=actor and private.gift_direct_order_read_allowed(o.id,actor)
  ), random_groups as (
    select (array_agg(owned.item_id order by owned.item_id))[1] representative_id,least(sum(owned.item_qty::bigint),2147483647)::integer total_qty
    from owned where owned.item_mode='random' group by owned.item_order_id,owned.item_good_id
  ), visible as (
    select owned.item_id visible_id,owned.item_qty visible_qty,false visible_random from owned where owned.item_mode is null
    union all
    select random_groups.representative_id,random_groups.total_qty,true from random_groups
  )
  select item.id,item.order_id,item.product_order_number,item.good_id,visible.visible_qty,item.unit_price,item.good_name_snapshot,
    case when visible.visible_random then coalesce((select key_variant.id from public.goods_variants key_variant
        where key_variant.good_id=item.good_id and key_variant.is_default and key_variant.archived_at is null limit 1),allocation.cart_variant_id)
      else item.variant_id end,
    case when visible.visible_random then '랜덤' else item.variant_name_snapshot end,
    case when visible.visible_random then null else item.variant_code_snapshot end,
    item.custom_inputs_snapshot,item.supply_source,item.preorder_expected_ship_date,
    case when visible.visible_random then 'random' else 'select' end,
    shipment_item.shipment_id
  from visible
  join public.order_items item on item.id=visible.visible_id
  left join private.order_item_random_allocations allocation on allocation.order_item_id=item.id
  left join public.order_shipment_items shipment_item on shipment_item.order_item_id=item.id;
end $function$;
revoke all on function public.my_order_items(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.my_order_items(uuid[]) to authenticated;
comment on function public.my_order_items(uuid[]) is
  '고객 주문 품목(D5②). 랜덤 배정 행은 주문·굿즈마다 한 줄(가장 작은 행 id, 수량 합계, 장바구니 키, 옵션명 랜덤)로 합친다. shipment_id = 그 줄의 배송 건.';

-- --------------------------------------------------------------------------
-- 4. 그룹 공통정보 공통 칸·상품 임시저장 허용 칸에서 'type'을 뺀다. 상품 저장은 type 키를 넘기지 않는다.
-- --------------------------------------------------------------------------
select private.goods_type_column_patch('private.goods_group_common_identity(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array($a$jsonb_each(to_jsonb(g)||'{"type":""}'::jsonb)$a$, $a$jsonb_each(to_jsonb(g))$a$),
  jsonb_build_array($a$array['ip_id','type','category_id',$a$, $a$array['ip_id','category_id',$a$)
));
select private.goods_type_column_patch('private.goods_group_common_public_fields(jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array($a$array['ip_id','type','category_id',$a$, $a$array['ip_id','category_id',$a$)
));
select private.goods_type_column_patch('private.validate_goods_group_common_values(jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array($a$or ((p_values->'goods')-keys-'type')<>'{}'::jsonb$a$, $a$or ((p_values->'goods')-keys)<>'{}'::jsonb$a$)
));
select private.goods_type_column_patch(
  'public.admin_save_goods_group_common(uuid,bigint,jsonb,uuid,uuid,uuid)'::regprocedure,
  jsonb_build_array(
    jsonb_build_array($a$to_jsonb(g)-array['ip_id','type','category_id',$a$, $a$to_jsonb(g)-array['ip_id','category_id',$a$, 2)
  ));

select private.goods_type_column_patch('public.admin_save_goods_draft(uuid,jsonb,integer)'::regprocedure, jsonb_build_array(
  jsonb_build_array($a$'shippingNoticeTemplate','type','code',$a$, $a$'shippingNoticeTemplate','code',$a$)
));
update public.admin_goods_drafts set form_values = form_values - 'type' where form_values ? 'type';

select private.goods_type_column_patch('private.admin_save_good_before_fulfillment(jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array($a$target_good->>'name',target_good->>'type',$a$, $a$target_good->>'name',null,$a$)
));

drop function private.goods_type_column_patch(regprocedure, jsonb);

-- --------------------------------------------------------------------------
-- 5. 칸을 지운다(goods_type_check는 칸과 함께 사라진다).
-- --------------------------------------------------------------------------
alter table public.goods drop column type;
alter table public.order_items drop column good_type_snapshot;

-- --------------------------------------------------------------------------
-- 6. 운영자 계약 지문을 다시 적는다(본문이 바뀐 등록 함수).
-- --------------------------------------------------------------------------
select private.register_operator_rpc_contract('public.admin_smartstore_shipment_export(uuid[])'::regprocedure, 'sales.dispatch', 'read', false);
select private.register_operator_rpc_contract('public.admin_save_goods_group_common(uuid,bigint,jsonb,uuid,uuid,uuid)'::regprocedure, 'catalog.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_save_goods_draft(uuid,jsonb,integer)'::regprocedure, 'catalog.manage', 'write', false);
select private.register_operator_internal_contract('private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)'::regprocedure);
select private.register_operator_internal_contract('private.category_display_public_good(public.goods,jsonb)'::regprocedure);
select private.register_operator_internal_contract('public.get_my_gift_checkout_order(uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('public.get_my_gift_checkout_order_numbered(uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('private.snapshot_account_deletion_legal_records(uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('private.goods_group_common_identity(text)'::regprocedure);
select private.register_operator_internal_contract('private.goods_group_common_public_fields(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.validate_goods_group_common_values(jsonb)'::regprocedure);

-- --------------------------------------------------------------------------
-- 7. 지운 칸·키를 쓰는 함수가 남았으면 여기서 멈춘다(plpgsql은 칸 의존을 추적하지 않는다).
-- --------------------------------------------------------------------------
do $$
declare
  users text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into users
  from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and (p.prosrc ~ 'good_type_snapshot' or p.prosrc ~ '''goodType''' or p.prosrc ~ '\m(good|source_good|p_good|g)\.type\M'
      or p.prosrc ~ '''ip_id'',''type'',''category_id'''
      or p.prosrc ~ '\m(old|new)\.type\M' and exists(
        select 1 from pg_catalog.pg_trigger as t where t.tgfoid = p.oid and t.tgrelid = 'public.goods'::regclass));
  if users is not null then
    raise exception 'goods_type_column_remaining_users: %', users;
  end if;
end $$;
