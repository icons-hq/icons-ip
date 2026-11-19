-- ADR-0044 칸 삭제 1단계: 상품 유형(goods.type)과 주문 유형 스냅샷(order_items.good_type_snapshot)을 아무도 쓰지 않게 한다.
--
-- 두 칸은 다음 migration(2단계)에서 지운다. 배포는 DB가 먼저, 앱이 몇 분 뒤에 바뀌므로 칸을 지우기 전에
-- 쓰는 쪽을 먼저 멈춘다. 이 migration 뒤에는
--   1. 상품·주문 저장이 두 칸을 쓰지 않는다. 새 행은 기본값 ''을 받고, 기존 값은 바뀌지 않는다.
--      상품 저장 RPC(admin_upsert_good)의 target_type 인자는 시그니처를 유지한 채 받기만 하고 무시한다.
--   2. KC 맥락(private.goods_kc_context)과 KC 가드가 유형을 보지 않는다. 저장된 KC 검토 기록은 고치지 않고,
--      현재 여부를 비교할 때 기록의 옛 'type' 키를 빼고 비교한다(공개 중 상품의 KC 검토가 풀리지 않는다).
--   3. 그룹 공통정보 저장은 'type' 키를 받아도 되고 안 받아도 된다(이전 앱은 보내고, 새 앱은 보내지 않는다).
-- 읽는 쪽(카테고리 진열·주문 조회·스마트스토어 출고·탈퇴 법정 기록)은 이전 앱이 그 응답 키를 아직 읽으므로 그대로 두고,
-- 2단계에서 칸과 함께 걷는다.

-- --------------------------------------------------------------------------
-- 0. 쓰는 쪽이 값을 빼도 넣을 수 있게 기본값을 둔다(NOT NULL은 2단계에서 칸과 함께 사라진다).
-- --------------------------------------------------------------------------
alter table public.goods alter column type set default '';
alter table public.order_items alter column good_type_snapshot set default '';
comment on column public.goods.type is
  'ADR-0044로 쓰지 않는 칸(다음 migration에서 삭제). 어떤 저장 경로도 쓰지 않고 새 상품은 ''''이다. KC 맥락에 들어가지 않는다.';
comment on column public.order_items.good_type_snapshot is
  'ADR-0044로 쓰지 않는 칸(다음 migration에서 삭제). 새 주문 줄은 ''''이다.';

-- --------------------------------------------------------------------------
-- 1. 앵커 치환: 현재 정의에서 앵커가 정확히 한 번 나올 때만 바꾼다(다른 migration이 같은 줄을 고쳤으면 실패한다).
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
    if v_found <> 1 then
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
-- 2. KC: 맥락·가드·현재 여부 비교에서 유형을 뺀다.
-- --------------------------------------------------------------------------
create or replace function private.goods_kc_context(p_good_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('good',jsonb_build_object('ipId',good.ip_id,'name',good.name,
    'maker',good.notice_maker,'origin',good.notice_origin,'material',good.notice_material,'size',good.notice_size),
    'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',variant.id,'name',variant.name,'attributes',variant.attributes,
      'active',variant.archived_at is null) order by variant.id),'[]') from public.goods_variants variant where variant.good_id=good.id))
  from public.goods good where good.id=p_good_id;
$function$;

-- 이 migration 전에 저장한 검토 기록의 맥락에는 'type'이 있다. 기록은 그대로 두고 비교할 때만 뺀다.
select private.goods_type_column_patch('private.goods_kc_review_current(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $a$and review.context_snapshot->'good'=private.goods_kc_context(p_good_id)->'good'$a$,
    $a$and (review.context_snapshot->'good')-'type'=private.goods_kc_context(p_good_id)->'good'$a$)
));

select private.goods_type_column_patch('private.guard_goods_kc()'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $a$changed:=row(old.ip_id,old.name,old.type,old.notice_maker,old.notice_origin,old.notice_material,old.notice_size)$a$,
    $a$changed:=row(old.ip_id,old.name,old.notice_maker,old.notice_origin,old.notice_material,old.notice_size)$a$),
  jsonb_build_array(
    $a$is distinct from row(new.ip_id,new.name,new.type,new.notice_maker,new.notice_origin,new.notice_material,new.notice_size);$a$,
    $a$is distinct from row(new.ip_id,new.name,new.notice_maker,new.notice_origin,new.notice_material,new.notice_size);$a$)
));

drop trigger goods_kc_guard on public.goods;
create trigger goods_kc_guard
  before insert or update of published_at, archived_at, kc_disclosures, id, ip_id, name,
    notice_maker, notice_origin, notice_material, notice_size on public.goods
  for each row execute function private.guard_goods_kc();

-- --------------------------------------------------------------------------
-- 3. 상품 저장·복제·그룹 상품 만들기: 유형을 쓰지 않는다.
-- --------------------------------------------------------------------------
-- target_type은 이전 앱·내부 호출이 보내도 맞게 받기만 한다. 새 상품은 칸 기본값('')을 받고, 기존 상품은 값이 바뀌지 않는다.
select private.goods_type_column_patch(
  'public.admin_upsert_good(text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,integer,boolean)'::regprocedure,
  jsonb_build_array(
    jsonb_build_array(E'    name,\n    type,\n    price,\n', E'    name,\n    price,\n'),
    jsonb_build_array($a$    target_name,
    coalesce(target_type,''),
$a$, $a$    target_name,
$a$),
    jsonb_build_array(E'    name = excluded.name,\n    type = excluded.type,\n', E'    name = excluded.name,\n')
  ));

select private.goods_type_column_patch('private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure, jsonb_build_array(
  jsonb_build_array($a$    'name_en', source_good.name_en,
    'type', source_good.type,
$a$, $a$    'name_en', source_good.name_en,
$a$)
));

select private.goods_type_column_patch('private.create_goods_group_product(text,uuid,text,uuid)'::regprocedure, jsonb_build_array(
  jsonb_build_array($a$    'name_en', source_good.name_en,
    'type', source_good.type,
$a$, $a$    'name_en', source_good.name_en,
$a$)
));

-- 그룹 공통정보: 필수 키에서 'type'을 빼고, 배포 사이 이전 앱이 보내는 'type'은 받아 둔다(저장은 무시된다).
select private.goods_type_column_patch('private.validate_goods_group_common_values(jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array($a$array['ip_id','type','category_id',$a$, $a$array['ip_id','category_id',$a$),
  jsonb_build_array($a$or ((p_values->'goods')-keys)<>'{}'::jsonb$a$, $a$or ((p_values->'goods')-keys-'type')<>'{}'::jsonb$a$)
));

-- --------------------------------------------------------------------------
-- 4. 주문 생성: 주문 줄에 유형 스냅샷을 쓰지 않는다(칸 기본값 ''). 거래 계산 문서에서도 goodType을 뺀다.
-- --------------------------------------------------------------------------
select private.goods_type_column_patch(
  'private.calculate_goods_transaction_locked(uuid,jsonb,jsonb,jsonb,uuid,bigint,timestamp with time zone,jsonb,uuid)'::regprocedure,
  jsonb_build_array(
    jsonb_build_array($a$'goodName',good.name,'goodType',good.type,'goodIpId',good.ip_id,$a$, $a$'goodName',good.name,'goodIpId',good.ip_id,$a$)
  ));

select private.goods_type_column_patch(
  'private.place_goods_transaction(uuid,jsonb,jsonb,jsonb,uuid,uuid,public.order_payment_method)'::regprocedure,
  jsonb_build_array(
    jsonb_build_array('good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,', 'good_name_snapshot,good_ip_id_snapshot,'),
    jsonb_build_array($a$line->>'goodName',line->>'goodType',line->>'goodIpId',$a$, $a$line->>'goodName',line->>'goodIpId',$a$)
  ));

select private.goods_type_column_patch(
  'private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)'::regprocedure,
  jsonb_build_array(
    jsonb_build_array(E'      good.name,\n      good.type,\n', E'      good.name,\n'),
    jsonb_build_array(E'      good_name_snapshot,\n      good_type_snapshot,\n', E'      good_name_snapshot,\n'),
    jsonb_build_array(E'      r.name,\n      r.type,\n', E'      r.name,\n')
  ));

select private.goods_type_column_patch(
  'private.allocate_random_option_items(uuid,uuid,uuid,text,uuid,integer,timestamp with time zone,jsonb,jsonb)'::regprocedure,
  jsonb_build_array(
    jsonb_build_array('good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,', 'good_name_snapshot,good_ip_id_snapshot,'),
    jsonb_build_array('good.name,good.type,good.ip_id,', 'good.name,good.ip_id,')
  ));

drop function private.goods_type_column_patch(regprocedure, jsonb);

-- --------------------------------------------------------------------------
-- 5. 운영자 계약 지문을 다시 적는다(본문이 바뀐 등록 함수).
-- --------------------------------------------------------------------------
select private.register_operator_rpc_contract(
  'public.admin_upsert_good(text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,integer,boolean)'::regprocedure,
  'catalog.manage', 'write', false);
select private.register_operator_internal_contract('private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure);
select private.register_operator_internal_contract('private.create_goods_group_product(text,uuid,text,uuid)'::regprocedure);
select private.register_operator_internal_contract('private.validate_goods_group_common_values(jsonb)'::regprocedure);
select private.register_operator_internal_contract(
  'private.calculate_goods_transaction_locked(uuid,jsonb,jsonb,jsonb,uuid,bigint,timestamp with time zone,jsonb,uuid)'::regprocedure);
select private.register_operator_internal_contract(
  'private.place_goods_transaction(uuid,jsonb,jsonb,jsonb,uuid,uuid,public.order_payment_method)'::regprocedure);
select private.register_operator_internal_contract('private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)'::regprocedure);

-- --------------------------------------------------------------------------
-- 6. 쓰는 쪽이 남았으면 여기서 멈춘다(plpgsql은 칸 의존을 추적하지 않는다).
--    읽는 쪽 7개는 2단계에서 칸과 함께 걷는다.
-- --------------------------------------------------------------------------
do $$
declare
  writers text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into writers
  from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and (p.prosrc ~ 'good_type_snapshot' or p.prosrc ~ '''goodType''' or p.prosrc ~ '\m(good|source_good|p_good)\.type\M'
      -- 상품 행 트리거만 본다(다른 표의 트리거도 old.type·new.type을 쓴다).
      or p.prosrc ~ '\m(old|new)\.type\M' and exists(
        select 1 from pg_catalog.pg_trigger as t where t.tgfoid = p.oid and t.tgrelid = 'public.goods'::regclass))
    and p.oid not in (
      'private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)'::regprocedure,
      'private.category_display_public_good(public.goods,jsonb)'::regprocedure,
      'public.my_order_items(uuid[])'::regprocedure,
      'public.get_my_gift_checkout_order(uuid,uuid)'::regprocedure,
      'public.get_my_gift_checkout_order_numbered(uuid,uuid)'::regprocedure,
      'private.admin_order_detail_before_preorder(uuid)'::regprocedure,
      'public.admin_smartstore_shipment_export(uuid[])'::regprocedure,
      'private.snapshot_account_deletion_legal_records(uuid,uuid)'::regprocedure);
  if writers is not null then
    raise exception 'goods_type_column_remaining_writers: %', writers;
  end if;
end $$;
