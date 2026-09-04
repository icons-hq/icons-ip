-- D-4c ② — 굿즈 목록 내보내기 양식 (설계서 v2 §1-7)
--
-- 일괄 수정의 출발점은 「지금 값이 담긴 파일」이다. 그래서 업로드 양식과 **같은 헤더**로 내려준다 —
-- 받아서 한 열만 고쳐 그대로 올리면 그게 일괄 수정이다.
--
-- 읽기 전용 열(IP명·판매상태·판매가능수량)은 사람이 보라고 싣는다. 업로드는 이 열들을 무시한다:
-- 판매 상태는 조회 시 파생이라 쓸 대상이 없고, 재고는 자기 문(재고 맞추기 업로드)이 따로 있다.

create or replace function private.export_rows(
  p_template_id uuid,
  p_filters jsonb,
  p_after jsonb,
  p_limit integer,
  p_unmasked boolean
)
returns table (row_key jsonb, row_data jsonb)
language plpgsql
stable
set search_path = ''
as $$
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
    from public.goods as good
    left join public.ips as ip on ip.id = good.ip_id
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
      'order_no', ord.id::text,
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
$$;

-- 굿즈 목록 양식. 개인정보가 없으므로 normal — 마스킹 대상이 아니다.
insert into public.export_templates (key, name, description, target, columns, sort, security_level, file_format, is_system)
values (
  'goods_catalog',
  '굿즈 목록 (일괄 수정용)',
  '지금 값이 담긴 굿즈 목록. 한 열만 고쳐 그대로 올리면 일괄 수정이 된다. IP명·판매상태·판매가능수량은 보라고 실은 읽기 전용 열이다.',
  'goods',
  '[
    {"key": "good_id", "header": "굿즈코드", "format": "text"},
    {"key": "custom_code", "header": "자체 굿즈코드", "format": "text"},
    {"key": "ip_id", "header": "IP코드", "format": "text"},
    {"key": "ip_name", "header": "IP명"},
    {"key": "name", "header": "굿즈명"},
    {"key": "type", "header": "분류"},
    {"key": "price", "header": "판매가", "format": "number"},
    {"key": "compare_at_price", "header": "정가", "format": "number"},
    {"key": "supply_price", "header": "공급가", "format": "number"},
    {"key": "tax_type_label", "header": "과세구분"},
    {"key": "sale_state_label", "header": "판매상태"},
    {"key": "stock_qty", "header": "판매가능수량", "format": "number"},
    {"key": "sale_mode_label", "header": "판매유형"},
    {"key": "sale_starts_at", "header": "판매시작"},
    {"key": "sale_ends_at", "header": "판매종료"},
    {"key": "preorder_ships_at", "header": "출고예정일"},
    {"key": "summary", "header": "요약"},
    {"key": "search_keywords", "header": "검색어"},
    {"key": "default_location_id", "header": "기본 출고지"},
    {"key": "badge", "header": "배지"},
    {"key": "allow_bank_transfer", "header": "무통장입금"}
  ]'::jsonb,
  '[]'::jsonb,
  'normal',
  'csv',
  true
)
-- 시스템 양식의 정의는 이 파일에 있다. 다시 돌려도 파일 쪽으로 수렴해야 한다
-- (운영자는 시스템 양식을 못 고치니 덮어써도 잃을 편집이 없다).
on conflict (key) do update set
  name = excluded.name, description = excluded.description, target = excluded.target,
  columns = excluded.columns, sort = excluded.sort, security_level = excluded.security_level,
  file_format = excluded.file_format, is_system = excluded.is_system, updated_at = now();
