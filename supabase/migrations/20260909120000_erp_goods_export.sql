-- ERP 품목 등록 양식 (PM 2026-09-09 「여기 등록한 내용을 ERP 에 등록할 수 있게 엑셀로, 기본은 ERP 양식」).
--
-- K-System 의 품목 등록은 「신규품목자동생성」 화면에서 대표품목을 복사해 한 건씩 만든다 — 일괄 업로드
-- 화면은 확인되지 않았다. 그래서 「ERP 양식」 = ERP 담당이 보는 **품목정보(품목조회) 46열 순서**다
-- (ai-icons 품목 마스터 실측 2026-08-04). 이 순서로 내려받아 그대로 옮겨 적거나, ERP 쪽에 업로드
-- 양식이 있으면 열을 맞춰 붙인다. 우리에게 없는 ERP 열(관리부서·영문명·Lot·Serial …)은 빈 칸으로
-- 자리를 지키고, 우리만 가진 값(판매가·소비자가·공급가·바코드·스토어 굿즈코드)은 46열 뒤에 붙인다.
-- 열은 설정 › 엑셀 양식에서 복제해 넣고 뺄 수 있다.
--
-- 기본값 판단(ERP 담당 확인 대상): 품목자산분류 「상품」 · 기준단위 「EA」 · 내외자구분 「내자」 ·
-- 부가세포함 「Y」 · 품목상태 「사용」(보관 굿즈는 「거래중지」) · 품번 = 자체 굿즈코드(없으면 스토어 코드) ·
-- 브랜드 = IP · 품목그룹 = 걸려 있는 팝업 이름 · 대/중/소분류 = 대표 분류의 조상 이름.
--
-- private.export_rows 는 라이브 정의를 그대로 베끼고 굿즈 가지에 열만 더했다(시그니처 불변).

CREATE OR REPLACE FUNCTION private.export_rows(p_template_id uuid, p_filters jsonb, p_after jsonb, p_limit integer, p_unmasked boolean)
 RETURNS TABLE(row_key jsonb, row_data jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_template public.export_templates;
  v_unmasked boolean := p_unmasked;
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_after_at timestamptz := nullif(p_after ->> 'at', '')::timestamptz;
  v_after_id uuid := nullif(p_after ->> 'id', '')::uuid;
  -- 굿즈 키는 uuid 가 아니라 사람이 정한 코드다. 커서 칸을 따로 둬서 주문 경로의 uuid 캐스팅을 건드리지 않는다.
  v_after_key text := nullif(p_after ->> 'key', '');
  v_from timestamptz := nullif(p_filters ->> 'from', '')::timestamptz;
  v_to timestamptz := nullif(p_filters ->> 'to', '')::timestamptz;
  v_status text := nullif(p_filters ->> 'status', '');
  v_location text := nullif(p_filters ->> 'location_id', '');
  v_ip text := nullif(p_filters ->> 'ip_id', '');
  v_unshipped boolean := coalesce((p_filters ->> 'unshipped_only')::boolean, false);
  v_include_archived boolean := coalesce((p_filters ->> 'include_archived')::boolean, false);
begin
  select * into v_template from public.export_templates as template where template.id = p_template_id;
  if not found then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;
  v_unmasked := v_template.security_level = 'normal' or p_unmasked;

  if v_template.target = 'goods' then
    return query
    select
      jsonb_build_object('at', good.created_at, 'key', good.id),
      jsonb_build_object(
        'good_id', good.id,
        'custom_code', coalesce(good.custom_code, ''),
        'ip_id', good.ip_id,
        'ip_name', coalesce(ip.title, ''),
        'name', good.name,
        'type', good.type,
        'price', good.price,
        'compare_at_price', good.compare_at_price,
        'supply_price', good.supply_price,
        'tax_type_label', case good.tax_type
          when 'exempt' then '면세' when 'zero_rated' then '영세' else '과세' end,
        'sale_state_label', case public.good_sale_state(good)
          when 'archived' then '보관' when 'hidden' then '숨김' when 'stopped' then '판매중지'
          when 'ended' then '판매종료' when 'scheduled' then '판매예정' when 'soldout' then '품절'
          when 'preorder' then '예약판매' else '판매중' end,
        'stock_qty', good.stock_qty,
        'sale_mode_label', case good.sale_mode when 'preorder' then '예약' else '일반' end,
        'preorder_ships_at', coalesce(pg_catalog.to_char(good.preorder_ships_at, 'YYYY-MM-DD'), ''),
        'sale_starts_at', coalesce(pg_catalog.to_char(good.sale_starts_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'), ''),
        'sale_ends_at', coalesce(pg_catalog.to_char(good.sale_ends_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'), ''),
        'summary', coalesce(good.summary, ''),
        'search_keywords', pg_catalog.array_to_string(good.search_keywords, ', '),
        'default_location_id', good.default_location_id,
        'badge', coalesce(good.badge, ''),
        'allow_bank_transfer', case when good.allow_bank_transfer then 'Y' else 'N' end
      )
      -- ERP(K-System) 품목정보 46열 자리. 우리에게 없는 열은 빈 칸으로 내보내되 키를 따로 둔다 —
      -- 양식을 복제할 때 열마다 켜고 끌 수 있어야 하기 때문이다(같은 키가 둘이면 하나만 남는다).
      -- jsonb_build_object 는 인자 100개 상한이라 두 덩어리를 || 로 잇는다.
      || jsonb_build_object(
        'erp_item_no', coalesce(nullif(good.custom_code, ''), good.id),
        'erp_spec', coalesce(good.notice_size, ''),
        'erp_asset_class', '상품',
        'erp_unit', 'EA',
        'erp_status', case when good.archived_at is not null then '거래중지' else '사용' end,
        'erp_origin', '내자',
        'category_l1', coalesce(category.l1, ''),
        'category_l2', coalesce(category.l2, ''),
        'category_l3', coalesce(category.l3, ''),
        'erp_vat_included', 'Y',
        'created_date', pg_catalog.to_char(good.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
        'updated_date', pg_catalog.to_char(good.updated_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
        'item_group', coalesce(popup.title, ''),
        'barcode', coalesce(good.barcode, ''),
        'erp_importance', '', 'erp_dept', '', 'erp_manager', '', 'erp_english_name', '',
        'erp_ship_kind', '', 'erp_rep_item', '', 'erp_set_item', '', 'erp_bom', '',
        'erp_process_material', '', 'erp_lot', '', 'erp_serial', '', 'erp_expiry_kind', '', 'erp_expiry_days', '',
        'erp_registrar', '', 'erp_purchase_vendor', '', 'erp_attachment', '', 'erp_image', '', 'erp_modifier', '',
        'erp_rep_name', '', 'erp_rep_no', '', 'erp_rep_spec', '', 'erp_ship_unit', '', 'erp_parent_item', '', 'erp_business_unit', '',
        'erp_extra6', '', 'erp_extra7', '', 'erp_extra8', '', 'erp_extra9', '', 'erp_extra10', ''
      )
    from public.goods as good
    left join public.ips as ip on ip.id = good.ip_id
    -- 대표 분류의 조상 이름 셋 — categories.path 는 '/id1/id2/id3/' 다.
    left join lateral (
      select
        (select c1.name from public.categories as c1 where c1.id = parts.id[1]) as l1,
        (select c2.name from public.categories as c2 where c2.id = parts.id[2]) as l2,
        (select c3.name from public.categories as c3 where c3.id = parts.id[3]) as l3
      from (
        select pg_catalog.string_to_array(pg_catalog.btrim(cat.path, '/'), '/') as id
        from public.good_categories as gc
        join public.categories as cat on cat.id = gc.category_id
        where gc.good_id = good.id
        order by gc.is_primary desc, gc.position, gc.category_id
        limit 1
      ) as parts
    ) as category on true
    -- ERP 품목그룹은 「연도+기획 단위」다 — 걸려 있는 팝업 이름이 가장 가깝다(없으면 빈 칸).
    left join lateral (
      select p.title
      from public.popup_links as l
      join public.popups as p on p.id = l.popup_id
      where l.target_type = 'good' and l.target_id = good.id and p.archived_at is null
      order by p.starts_at desc, p.id
      limit 1
    ) as popup on true
    where (v_ip is null or good.ip_id = v_ip)
      and (v_include_archived or good.archived_at is null)
      and (v_from is null or good.created_at >= v_from)
      and (v_to is null or good.created_at < v_to)
      and (
        v_after_at is null or v_after_key is null
        or (good.created_at, good.id) > (v_after_at, v_after_key)
      )
    order by good.created_at, good.id
    limit v_limit;
    return;
  end if;

  if v_template.target <> 'order_items' then
    raise exception 'unsupported_export_target' using errcode = '22023';
  end if;

  return query
  select
    jsonb_build_object('at', ord.created_at, 'id', item.id),
    jsonb_build_object(
      'mall_name', 'XSQUARE몰',
      'order_no', coalesce(ord.order_no, ord.id::text),
      'item_no', item.id::text,
      'ordered_at', pg_catalog.to_char(ord.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
      'order_kind', '일반',
      'order_status', ord.status::text,
      'good_id', item.good_id,
      'good_name', coalesce(item.good_name_snapshot, good.name),
      'variant_code', coalesce(variant.custom_code, item.variant_code_snapshot),
      'option_summary', coalesce(item.option_summary_snapshot, ''),
      'qty', item.qty,
      'unit_price', item.unit_price,
      'line_total', item.qty::bigint * item.unit_price::bigint,
      'paid_total', item.qty::bigint * item.unit_price::bigint,
      'location_name', coalesce(location.name, item.location_id),
      'location_id', item.location_id,
      'carrier_label', coalesce(carrier.label, ord.shipping_carrier),
      'tracking_number', coalesce(ord.tracking_number, ''),
      -- 거래확정 정산 열(현업 3-3). 확정일·결제일은 주문 단위다. **배송비도 주문 단위**라 품목 행마다
      -- 적으면 ERP 매출내역 업로드에서 배송비가 품목 수만큼 부풀어 잡힌다 — 첫 품목 행에만 싣는다.
      'done_at', coalesce(pg_catalog.to_char(ord.done_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'), ''),
      'paid_at', coalesce(pg_catalog.to_char(ord.paid_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'), ''),
      'shipping_fee', case
        when not exists (
          select 1 from public.order_items as earlier
          where earlier.order_id = ord.id and earlier.id < item.id
        ) then coalesce(ord.shipping_fee, 0)
        else 0
      end,
      'ship_by', pg_catalog.to_char((ord.created_at + interval '1 day') at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
      'shipment_group', pg_catalog.left(pg_catalog.md5(
        coalesce(ord.address ->> 'recipientName', '') || '|' ||
        coalesce(ord.address ->> 'phone', '') || '|' ||
        coalesce(ord.address ->> 'address1', '') || coalesce(ord.address ->> 'address2', '')
      ), 8),
      -- 같은 주문에 다른 줄이 있으면 합포장이다. 윈도 함수(`count(*) over (partition by ord.id)`)로 쓰면
      -- LIMIT 이 윈도를 넘어가지 못해 **한 페이지마다 10만 줄을 다시 정렬**한다(실측 39ms → 165ms,
      -- 10만 줄 전체는 33초). 한 줄짜리 EXISTS 는 order_items_order_idx 가 바로 답한다.
      'box_kind', case when exists (
        select 1 from public.order_items as sibling
        where sibling.order_id = ord.id and sibling.id <> item.id
      ) then '합포장' else '단품' end,
      'delivery_note', coalesce(ord.address ->> 'deliveryNote', ''),
      'orderer_name', case when v_unmasked then coalesce(ord.address ->> 'recipientName', '')
                           else private.mask_name(ord.address ->> 'recipientName') end,
      'orderer_phone', case when v_unmasked then coalesce(ord.address ->> 'phone', '')
                            else private.mask_phone(ord.address ->> 'phone') end,
      'recipient_name', case when v_unmasked then coalesce(ord.address ->> 'recipientName', '')
                             else private.mask_name(ord.address ->> 'recipientName') end,
      'recipient_phone', case when v_unmasked then coalesce(ord.address ->> 'phone', '')
                              else private.mask_phone(ord.address ->> 'phone') end,
      'recipient_postal_code', coalesce(ord.address ->> 'postalCode', ''),
      'recipient_address', case
        when v_unmasked then pg_catalog.btrim(coalesce(ord.address ->> 'address1', '') || ' ' || coalesce(ord.address ->> 'address2', ''))
        else private.mask_address(ord.address ->> 'address1')
      end
    )
  from public.order_items as item
  join public.orders as ord on ord.id = item.order_id
  join public.goods as good on good.id = item.good_id
  left join public.good_variants as variant on variant.id = item.variant_id
  left join public.stock_locations as location on location.id = item.location_id
  left join public.shipping_carriers as carrier on carrier.code = ord.shipping_carrier
  where (v_from is null or ord.created_at >= v_from)
    and (v_to is null or ord.created_at < v_to)
    and (v_status is null or ord.status::text = v_status)
    and (v_location is null or item.location_id = v_location)
    and (not v_unshipped or ord.status in ('paid', 'confirmed'))
    and (
      v_after_at is null or v_after_id is null
      or (ord.created_at, item.id) > (v_after_at, v_after_id)
    )
  order by ord.created_at, item.id
  limit v_limit;
end;
$function$
;

insert into public.export_templates (key, name, description, target, columns, sort, security_level, file_format, is_system)
values (
  'erp_goods',
  'ERP 품목 등록 양식 (K-System 품목정보 46열)',
  'ERP 담당이 보는 품목정보 열 순서 그대로. 우리에게 없는 열은 빈 칸으로 자리를 지키고, 판매가·소비자가·공급가·바코드·스토어 굿즈코드는 46열 뒤에 붙는다. 기본값(자산분류 상품·단위 EA·내자·부가세포함 Y)은 ERP 담당과 확인한다. 열을 넣고 빼려면 복제해서 쓴다.',
  'goods',
  '[
    {"key": "name", "header": "품명"},
    {"key": "erp_item_no", "header": "품번", "format": "text"},
    {"key": "erp_spec", "header": "규격"},
    {"key": "erp_asset_class", "header": "품목자산분류"},
    {"key": "erp_unit", "header": "기준단위"},
    {"key": "erp_status", "header": "품목상태"},
    {"key": "erp_origin", "header": "내외자구분"},
    {"key": "erp_importance", "header": "중요도"},
    {"key": "erp_dept", "header": "관리부서"},
    {"key": "erp_manager", "header": "관리자"},
    {"key": "category_l1", "header": "품목대분류"},
    {"key": "category_l2", "header": "품목중분류"},
    {"key": "category_l3", "header": "품목소분류"},
    {"key": "erp_english_name", "header": "영문명"},
    {"key": "erp_ship_kind", "header": "출고구분"},
    {"key": "erp_rep_item", "header": "대표품목"},
    {"key": "erp_set_item", "header": "세트품목"},
    {"key": "erp_bom", "header": "BOM등록"},
    {"key": "erp_process_material", "header": "제품별공정소요자재"},
    {"key": "erp_lot", "header": "Lot 관리"},
    {"key": "erp_serial", "header": "Serial 관리"},
    {"key": "erp_expiry_kind", "header": "유통기한구분"},
    {"key": "erp_expiry_days", "header": "유통기간"},
    {"key": "erp_registrar", "header": "등록자"},
    {"key": "created_date", "header": "등록일"},
    {"key": "summary", "header": "품목설명"},
    {"key": "erp_purchase_vendor", "header": "기본구매처"},
    {"key": "tax_type_label", "header": "부가세구분"},
    {"key": "erp_vat_included", "header": "판매단가에 부가세포함여부"},
    {"key": "erp_attachment", "header": "첨부파일"},
    {"key": "erp_image", "header": "이미지"},
    {"key": "erp_modifier", "header": "최종수정자"},
    {"key": "updated_date", "header": "최종수정일"},
    {"key": "erp_rep_name", "header": "대표품명"},
    {"key": "erp_rep_no", "header": "대표품번"},
    {"key": "erp_rep_spec", "header": "대표규격"},
    {"key": "ip_name", "header": "브랜드"},
    {"key": "item_group", "header": "품목그룹"},
    {"key": "erp_ship_unit", "header": "출고단위"},
    {"key": "erp_parent_item", "header": "모품목"},
    {"key": "erp_business_unit", "header": "사업부문"},
    {"key": "erp_extra6", "header": "품목추가정보6"},
    {"key": "erp_extra7", "header": "품목추가정보7"},
    {"key": "erp_extra8", "header": "품목추가정보8"},
    {"key": "erp_extra9", "header": "품목추가정보9"},
    {"key": "erp_extra10", "header": "품목추가정보10"},
    {"key": "price", "header": "판매가", "format": "number"},
    {"key": "compare_at_price", "header": "소비자가", "format": "number"},
    {"key": "supply_price", "header": "공급가", "format": "number"},
    {"key": "barcode", "header": "바코드", "format": "text"},
    {"key": "good_id", "header": "굿즈코드(스토어)", "format": "text"}
  ]'::jsonb,
  '[]'::jsonb,
  'normal',
  'xlsx',
  true
)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, target = excluded.target,
  columns = excluded.columns, sort = excluded.sort, security_level = excluded.security_level,
  file_format = excluded.file_format, is_system = excluded.is_system, updated_at = now();
