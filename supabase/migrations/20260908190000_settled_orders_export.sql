-- 현업 요청 3-3 — 거래확정 내역 엑셀 (구매확정일 / 쇼핑몰주문번호 / 송장번호 / ERP품명 / 수량 / 판매금액 / 배송비 / 결제일)
--
-- 이 파일은 보고서가 아니라 **ERP 매출내역 업로드의 입력**이다(ERP 실태: 플랫폼 구매확정·배송비
-- 다운로드 → 쇼핑몰매출내역업로드 → 대사). 온라인 MD 넷이 지금 손으로 만드는 표다.
--
-- 행 생성기에 없던 값 셋을 더한다: 구매확정일(`orders.done_at`) · 결제일(`orders.paid_at`) ·
-- 배송비(`orders.shipping_fee`, **첫 품목 행에만** — 품목마다 적으면 합계가 부풀어 잡힌다).
-- 첫 행 판정은 「나보다 id 가 작은 형제가 없다」로 한다 — uuid 에는 min() 집계가 없다(비교만 된다).
-- 주문번호 키는 uuid 가 아니라 사람이 보는 번호(`orders.order_no`, D-3)로 바꾼다 — 사방넷·ERP 가
-- 우리 주문을 찾는 키가 그것이고, uuid 를 대사에 쓰는 곳은 없다(발주서·사방넷 양식도 같이 바뀐다).
--
-- **살아 있는 정의(20260904160100)를 베껴 와 줄만 더한다.** 옛 시그니처를 다시 만들면 오버로드가
-- 부활한다(admin_search_goods 에서 한 번 밟았다). 시그니처가 같으므로 ACL 은 유지된다.
--
-- 열 뜻 두 가지는 온라인 파트 확인이 남아 있다(대조표 §3-1): 「ERP품명」은 우리가 ERP 품명을
-- 저장하지 않아 주문 시점 굿즈명을 싣는다 · 「판매금액」은 할인 전 품목 금액(qty × 단가)이다.

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
$$;

-- 시스템 양식 — 요청한 8열을 그 순서 그대로. 기본 조건은 확정된 주문(status = done).
insert into public.export_templates (key, name, description, target, columns, sort, default_filters, security_level, file_format, is_system)
select
  'settled_orders',
  '거래확정 내역 (ERP 매출 업로드)',
  '구매확정된 주문의 품목 행. ERP 「쇼핑몰매출내역업로드」 에 그대로 넣는 8열이다. 배송비는 주문의 첫 품목 행에만 실린다.',
  'order_items',
  '[
    {"key": "done_at", "header": "구매확정일"},
    {"key": "order_no", "header": "쇼핑몰주문번호"},
    {"key": "tracking_number", "header": "송장번호", "format": "text"},
    {"key": "good_name", "header": "ERP품명"},
    {"key": "qty", "header": "수량", "format": "number"},
    {"key": "line_total", "header": "판매금액", "format": "number"},
    {"key": "shipping_fee", "header": "배송비", "format": "number"},
    {"key": "paid_at", "header": "결제일"}
  ]'::jsonb,
  '[{"key": "done_at", "dir": "asc"}, {"key": "order_no", "dir": "asc"}]'::jsonb,
  '{"status": "done"}'::jsonb,
  'normal',
  'xlsx',
  true
where not exists (select 1 from public.export_templates where key = 'settled_orders');
