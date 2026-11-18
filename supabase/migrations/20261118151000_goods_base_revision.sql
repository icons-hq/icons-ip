-- 상품 기본 칸 동시 수정 보호(CAT-027·CAT-028).
--
-- 상품 편집 화면은 기본 칸(상품명·판매가·정가·고시·상세·이미지·카테고리·배송·구매 제한·반품 조건·옵션 금액 등)을
-- 매번 통째로 다시 보낸다. 판매기간·속성·직접입력·옵션 구성(id 묶음)·재고·즉시할인처럼 따로 버전을 비교하는 칸 말고는
-- 비교가 없어서, 화면을 열어 둔 사이 다른 운영자 저장·목록 일괄 판매가 변경·목록 바로 수정·ERP 판매가 반영·엑셀 반입이
-- 바꾼 값을 옛 화면이 조용히 이전 값으로 되돌렸다.
--
-- goods.base_revision은 그 기본 칸의 버전이다. goods.updated_at은 쓰지 않는다 — 주문·결제 만료가 옵션 재고를 바꾸면
-- goods.stock_qty 캐시(refresh_goods_variant_stock)가 갱신되며 updated_at도 바뀌어, 판매 중인 상품마다 저장이 충돌로 막힌다.
-- 버전은 트리거가 올리므로 어느 쓰기 경로(편집 저장·등록 workspace·목록 일괄·바로 수정·ERP 반영·엑셀 반입·그룹 공통정보·
-- 배송 템플릿 적용)든 기본 칸이 실제로 바뀌면 함께 오른다. 같은 값을 다시 쓰는 저장, 재고·공개 상태·KC 고지·판매 제한·
-- 결제 수단처럼 편집 화면이 쓰지 않거나 따로 지키는 칸은 버전을 올리지 않는다.
--
-- 상품 유형(type)은 대표 카테고리에서 파생되고(공개 전환 때 다시 맞출 수 있다) 저장 RPC가 같은 규칙으로 다시 정하므로 넣지 않는다.
-- 대표 카테고리(category_id)가 들어가 있어 유형 변경도 대부분 함께 잡힌다.
--
-- public.admin_save_good은 target_good.base_expected_revision이 오면 상품 행을 잠근 직후 그 값과 비교해 다르면
-- goods_base_changed(PT409)로 거절한다. 값이 없으면(새 상품, 배포 순간 열려 있던 옛 화면, 목록 일괄·ERP 반영처럼
-- 잠근 최신 행을 읽어 다시 쓰는 서버 경로) 지금처럼 저장한다. admin_save_good_workspace·admin_save_good_from_draft는
-- 같은 target_good을 admin_save_good에 넘기므로 따로 고치지 않는다.
begin;

alter table public.goods add column base_revision bigint not null default 0;
alter table public.goods add constraint goods_base_revision_nonnegative check (base_revision >= 0);
comment on column public.goods.base_revision is
  '상품 기본 칸(편집 화면이 다시 보내는 칸)과 옵션 금액·이름·코드·구매 제한, 추가 카테고리가 바뀔 때마다 1씩 오르는 버전(CAT-027).';

-- 기본 칸이 실제로 바뀌었거나, 다른 표(옵션·추가 카테고리)의 변경이 버전을 올려 달라고(base_revision을 바꿔) 요청하면 1 올린다.
-- 쓰는 쪽이 임의의 값을 넣을 수는 없다. 다른 BEFORE UPDATE 트리거가 고친 NEW까지 보도록 이름을 zzz로 두어 마지막에 돈다.
-- 새 행은 열 기본값 0으로 시작한다(INSERT에는 걸지 않는다 — 상품번호 발급 zz_goods_assign_product_no가 마지막 BEFORE INSERT여야 한다).
create function private.track_goods_base_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.base_revision is distinct from old.base_revision
    or (new.id, new.ip_id, new.name, new.price, new.compare_at_price, new.show_discount_rate, new.badge, new.stock, new.bg,
        new.image_path, new.gallery_paths, new.detail_image_path,
        new.notice_maker, new.notice_origin, new.notice_material, new.notice_size, new.notice_made_on,
        new.notice_as_manager, new.notice_as_contact,
        new.description, new.description_format, new.description_image_paths,
        new.code, new.name_en, new.search_keywords, new.display_order, new.category_id,
        new.origin_id, new.shipping_fee_type, new.individual_fee,
        new.shipping_notice_template_id, new.shipping_notice_template_version,
        new.order_quantity_limit_enabled, new.min_order_qty, new.max_order_qty,
        new.member_purchase_limit_enabled, new.member_lifetime_qty_limit,
        new.claim_return_allowed, new.claim_exchange_allowed, new.claim_restriction_reason,
        new.claim_return_fee, new.claim_return_free_shipping_fee, new.claim_exchange_fee, new.return_address_id)
      is distinct from
       (old.id, old.ip_id, old.name, old.price, old.compare_at_price, old.show_discount_rate, old.badge, old.stock, old.bg,
        old.image_path, old.gallery_paths, old.detail_image_path,
        old.notice_maker, old.notice_origin, old.notice_material, old.notice_size, old.notice_made_on,
        old.notice_as_manager, old.notice_as_contact,
        old.description, old.description_format, old.description_image_paths,
        old.code, old.name_en, old.search_keywords, old.display_order, old.category_id,
        old.origin_id, old.shipping_fee_type, old.individual_fee,
        old.shipping_notice_template_id, old.shipping_notice_template_version,
        old.order_quantity_limit_enabled, old.min_order_qty, old.max_order_qty,
        old.member_purchase_limit_enabled, old.member_lifetime_qty_limit,
        old.claim_return_allowed, old.claim_exchange_allowed, old.claim_restriction_reason,
        old.claim_return_fee, old.claim_return_free_shipping_fee, old.claim_exchange_fee, old.return_address_id) then
    new.base_revision := old.base_revision + 1;
  end if;
  return new;
end $$;
revoke all on function private.track_goods_base_revision() from public, anon, authenticated, service_role;
create trigger zzz_goods_base_revision before update on public.goods
  for each row execute function private.track_goods_base_revision();

-- 편집 화면은 옵션 행의 이름·속성·금액·코드·구매 제한도 다시 보낸다(save_goods_options). 옵션 구성(id 묶음)과 재고는
-- 따로 비교하지만 금액은 비교하지 않아, ERP 판매가 반영이 바꾼 옵션가가 옛 화면 저장으로 되돌아갔다(CAT-028).
-- 재고(stock_qty)·예약판매 정책 연결은 목록에 없으므로 주문·결제 만료가 이 트리거를 부르지 않는다.
create function private.bump_goods_base_revision_from_variant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.goods set base_revision = base_revision + 1 where id = new.good_id;
  return null;
end $$;
revoke all on function private.bump_goods_base_revision_from_variant() from public, anon, authenticated, service_role;
create trigger goods_variants_base_revision
  after update of price, name, attributes, code, low_stock_threshold, order_max_qty, member_max_qty on public.goods_variants
  for each row
  when ((old.price, old.name, old.attributes, old.code, old.low_stock_threshold, old.order_max_qty, old.member_max_qty)
    is distinct from (new.price, new.name, new.attributes, new.code, new.low_stock_threshold, new.order_max_qty, new.member_max_qty))
  execute function private.bump_goods_base_revision_from_variant();

-- 앵커 치환 도구(이 migration 안에서만 쓰고 끝에서 지운다). 앵커가 정확히 한 번 나오지 않으면 실패한다.
create function private.t2_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 't2 patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 추가 카테고리는 다른 표라 위 트리거가 보지 못한다. 집합이 실제로 바뀔 때만 상품 행을 건드리는 유일한 쓰기 함수가 버전을 함께 올린다.
select private.t2_patch_function('private.apply_goods_additional_categories(text,uuid[])'::regprocedure, array[
$a$  update public.goods set updated_at=clock_timestamp() where id=target_good_id;$a$,
$a$  update public.goods set updated_at=clock_timestamp(), base_revision=base_revision+1 where id=target_good_id;$a$
]);

-- 상품 저장: 상품 행을 잠근 직후(카테고리 트리 → 상품 행, 기존 잠금 순서 그대로) 화면이 본 버전과 비교한다.
select private.t2_patch_function('public.admin_save_good(jsonb)'::regprocedure, array[
$a$    where id = coalesce(nullif(target_good->>'previous_id', ''), target_good->>'id') for update;
$a$,
$a$    where id = coalesce(nullif(target_good->>'previous_id', ''), target_good->>'id') for update;

  -- 상품 기본 칸 동시 수정(CAT-027·CAT-028): 편집 화면이 연 시점의 버전(base_expected_revision)과 지금 버전이 다르면
  -- 다른 작업(다른 운영자 저장·목록 일괄·바로 수정·ERP 반영·엑셀 반입)이 바꾼 값을 되돌리지 않게 저장 전체를 거절한다.
  -- 값이 없는 요청(새 상품·옛 화면·서버 내부 경로)은 지금처럼 저장한다. 저장된 상품을 고치는 요청인데 그 상품이 없어졌으면
  -- (그사이 URL을 바꿨거나 지웠으면) 새 상품을 만들지 않고 같은 충돌로 알린다.
  if target_good ? 'base_expected_revision' then
    if pg_catalog.jsonb_typeof(target_good->'base_expected_revision') is distinct from 'number'
      or target_good->>'base_expected_revision' !~ '^(0|[1-9][0-9]{0,17})$' then
      raise check_violation using message = 'invalid_goods_base_revision';
    end if;
    if nullif(target_good->>'previous_id', '') is not null
      and (previous.id is null or previous.base_revision <> (target_good->>'base_expected_revision')::bigint) then
      raise sqlstate 'PT409' using message = 'goods_base_changed';
    end if;
    target_good := target_good - 'base_expected_revision';
  end if;
$a$
]);

-- 운영자 계약 지문: 다시 정의한 함수는 기존 분류 그대로 다시 등록한다.
do $$
declare fn regprocedure; contract private.operator_rpc_contracts;
begin
  foreach fn in array array[
    'public.admin_save_good(jsonb)'::regprocedure,
    'private.apply_goods_additional_categories(text,uuid[])'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

drop function private.t2_patch_function(regprocedure, text[]);

commit;
