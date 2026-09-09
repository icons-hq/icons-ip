\set ON_ERROR_STOP on

-- ERP 품목 등록 양식 (PM 2026-09-09) — K-System 품목정보 46열 순서 + 우리 열 5, 굿즈 가지의 ERP 키

begin;

insert into public.verticals (key, label, color) values ('erpx', 'ERP 양식', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('erpx-ip', 'ERP 양식 IP', 'erpx') on conflict (id) do nothing;
insert into public.categories (id, name) values ('erpx-l1', '캐릭터 굿즈') on conflict (id) do nothing;
insert into public.categories (id, parent_id, name) values ('erpx-l2', 'erpx-l1', '문구') on conflict (id) do nothing;
insert into public.categories (id, parent_id, name) values ('erpx-l3', 'erpx-l2', '노트') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, custom_code, barcode, notice_size, supply_price, tax_type, compare_at_price)
values ('erpx-g1', 'erpx-ip', 'ERP 노트', '문구', 12000, 'ok', 10, 'XMD-NOTE-001', '8801234000011', 'A5 · 120쪽', 6000, 'exempt', 15000)
on conflict (id) do nothing;
-- 보관 굿즈는 재고가 0 이어야 보관된다(good_has_stock 가드).
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('erpx-g2', 'erpx-ip', 'ERP 코드없음', '문구', 5000, 'soldout', 0)
on conflict (id) do nothing;
update public.goods set archived_at = now() where id = 'erpx-g2';
insert into public.good_categories (good_id, category_id, is_primary) values ('erpx-g1', 'erpx-l3', true) on conflict do nothing;
insert into public.popups (id, ip_id, title, starts_at, ends_at)
values ('erpx-popup', 'erpx-ip', '2026 ERP 팝업', now() - interval '1 day', now() + interval '30 day')
on conflict (id) do nothing;
insert into public.popup_links (popup_id, target_type, target_id) values ('erpx-popup', 'good', 'erpx-g1') on conflict do nothing;

do $$
declare
  v_tpl uuid;
  v_cols jsonb;
  v1 jsonb;
  v2 jsonb;
begin
  select id, columns into v_tpl, v_cols from public.export_templates where key = 'erp_goods';
  if v_tpl is null then raise exception 'erp_goods template missing'; end if;
  if jsonb_array_length(v_cols) <> 51 then raise exception 'erp_goods must have 51 columns, got %', jsonb_array_length(v_cols); end if;
  -- ERP 46열 순서 그대로 + 우리 열은 47번째부터
  if (v_cols -> 0 ->> 'header') <> '품명' or (v_cols -> 1 ->> 'header') <> '품번'
     or (v_cols -> 36 ->> 'header') <> '브랜드' or (v_cols -> 45 ->> 'header') <> '품목추가정보10'
     or (v_cols -> 46 ->> 'header') <> '판매가' or (v_cols -> 50 ->> 'header') <> '굿즈코드(스토어)' then
    raise exception 'erp_goods column order broken';
  end if;
  if (v_cols -> 1 ->> 'format') <> 'text' or (v_cols -> 49 ->> 'format') <> 'text' then
    raise exception '품번·바코드는 문자열 셀이어야 한다(앞의 0)';
  end if;

  select row_data into v1 from private.export_rows(v_tpl, '{"ip_id":"erpx-ip","include_archived":true}'::jsonb, null, 10, true)
  where row_data ->> 'good_id' = 'erpx-g1';
  select row_data into v2 from private.export_rows(v_tpl, '{"ip_id":"erpx-ip","include_archived":true}'::jsonb, null, 10, true)
  where row_data ->> 'good_id' = 'erpx-g2';
  if v1 is null or v2 is null then raise exception 'erp rows missing'; end if;

  if v1 ->> 'erp_item_no' <> 'XMD-NOTE-001' then raise exception '품번 = 자체 굿즈코드, got %', v1 ->> 'erp_item_no'; end if;
  if v2 ->> 'erp_item_no' <> 'erpx-g2' then raise exception '품번 fallback = 스토어 코드, got %', v2 ->> 'erp_item_no'; end if;
  if v1 ->> 'erp_status' <> '사용' or v2 ->> 'erp_status' <> '거래중지' then raise exception '품목상태 사용/거래중지'; end if;
  if v1 ->> 'ip_name' <> 'ERP 양식 IP' then raise exception '브랜드 = IP'; end if;
  if v1 ->> 'category_l1' <> '캐릭터 굿즈' or v1 ->> 'category_l2' <> '문구' or v1 ->> 'category_l3' <> '노트' then
    raise exception '대/중/소분류 = 대표 분류 조상, got %/%/%', v1 ->> 'category_l1', v1 ->> 'category_l2', v1 ->> 'category_l3';
  end if;
  if v2 ->> 'category_l1' <> '' then raise exception '분류 없는 굿즈는 빈 칸'; end if;
  if v1 ->> 'item_group' <> '2026 ERP 팝업' then raise exception '품목그룹 = 걸린 팝업, got %', v1 ->> 'item_group'; end if;
  if v1 ->> 'tax_type_label' <> '면세' or v1 ->> 'erp_vat_included' <> 'Y' or v1 ->> 'erp_unit' <> 'EA'
     or v1 ->> 'erp_origin' <> '내자' or v1 ->> 'erp_asset_class' <> '상품' then
    raise exception 'ERP 기본값(부가세·단위·내외자·자산분류)';
  end if;
  if v1 ->> 'barcode' <> '8801234000011' or v1 ->> 'erp_spec' <> 'A5 · 120쪽' or (v1 ->> 'supply_price')::int <> 6000
     or (v1 ->> 'compare_at_price')::int <> 15000 then
    raise exception '바코드·규격·공급가·소비자가';
  end if;
  if v1 ->> 'erp_dept' <> '' or v1 ->> 'erp_extra10' <> '' or v1 ->> 'erp_lot' <> '' then raise exception 'ERP 전용 열은 빈 칸'; end if;
  if v1 ->> 'created_date' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '등록일 형식'; end if;
end $$;

select 1 as assert_erp_goods_export;

rollback;
