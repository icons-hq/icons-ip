-- D-4c ③ — 굿즈 일괄 등록/수정 업로드 (설계서 v2 §1-7)
--
-- 규칙 하나가 이 파일 전체를 정한다: **파일에 있는 열만 바꾼다.**
-- 실무 경로는 「목록을 받아 한 열만 고쳐 다시 올린다」이고, 헤더에 없는 열을 기본값으로 덮어쓰면
-- 고치지도 않은 값이 조용히 지워진다. 그래서 파서는 헤더에 있는 칸만 실어 보내고,
-- 여기서는 `p_row ? '열'` 로 「실려 왔는가」를 물어 그 열만 쓴다.
--
-- 두 스위치(진열·판매중지)는 **업로드로 끌 수 없다**. D-10 이 끄는 쪽에만 사유를 요구하는데
-- 표에는 사유를 적을 자리가 없고, 무엇보다 일괄로 내리는 변경이야말로 흔적이 남아야 한다.
-- 재고도 여기서 안 바꾼다 — 자기 문(재고 맞추기 업로드)이 따로 있고, 문은 하나여야 한다.

create or replace function private.goods_import_check(p_row jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id text := nullif(pg_catalog.btrim(coalesce(p_row ->> 'good_id', '')), '');
  v_good public.goods;
  v_exists boolean;
  v_starts timestamptz;
  v_ends timestamptz;
begin
  if v_id is null then
    return 'ref_missing';
  end if;

  select * into v_good from public.goods as good where good.id = v_id;
  v_exists := found;

  -- 신규는 상품이 성립하는 최소치를 요구한다. 수정은 실려 온 열만 본다.
  if not v_exists then
    if not (p_row ? 'ip_id' and p_row ? 'name' and p_row ? 'type' and p_row ? 'price') then
      return 'good_incomplete';
    end if;
  end if;

  if p_row ? 'ip_id' then
    if nullif(pg_catalog.btrim(coalesce(p_row ->> 'ip_id', '')), '') is null then
      return 'missing_cell';
    end if;
    if not exists (select 1 from public.ips as ip where ip.id = p_row ->> 'ip_id') then
      return 'ip_not_found';
    end if;
  end if;

  if p_row ? 'name' and nullif(pg_catalog.btrim(coalesce(p_row ->> 'name', '')), '') is null then
    return 'missing_cell';
  end if;

  if p_row ? 'type' and (p_row ->> 'type') not in ('피규어', '인형', '키링', '아크릴', '문구', '쿠션', '파우치', '세트') then
    return 'invalid_type';
  end if;

  if p_row ? 'price' and (
    jsonb_typeof(p_row -> 'price') <> 'number' or (p_row ->> 'price')::numeric < 0
    or (p_row ->> 'price')::numeric <> pg_catalog.floor((p_row ->> 'price')::numeric)
  ) then
    return 'invalid_price';
  end if;

  -- 정가는 판매가보다 커야 한다(goods_compare_at_price_above_price). 실려 오지 않은 쪽은 현재 값으로 본다.
  if p_row ? 'compare_at_price' and jsonb_typeof(p_row -> 'compare_at_price') = 'number' then
    if (p_row ->> 'compare_at_price')::integer <= coalesce(
      case when p_row ? 'price' then (p_row ->> 'price')::integer end, v_good.price, 0
    ) then
      return 'compare_at_price_invalid';
    end if;
  end if;

  if p_row ? 'supply_price' and jsonb_typeof(p_row -> 'supply_price') = 'number'
     and (p_row ->> 'supply_price')::numeric < 0 then
    return 'invalid_price';
  end if;

  if p_row ? 'tax_type' and (p_row ->> 'tax_type') not in ('taxable', 'exempt', 'zero_rated') then
    return 'invalid_tax_type';
  end if;

  if p_row ? 'badge' and nullif(p_row ->> 'badge', '') is not null
     and (p_row ->> 'badge') not in ('NEW', 'EXCLUSIVE') then
    return 'invalid_badge';
  end if;

  if p_row ? 'default_location_id' and not exists (
    select 1 from public.stock_locations as location
    where location.id = p_row ->> 'default_location_id' and location.active
  ) then
    return 'location_not_found';
  end if;

  if p_row ? 'custom_code' and nullif(p_row ->> 'custom_code', '') is not null and exists (
    select 1 from public.goods as other
    where other.custom_code = p_row ->> 'custom_code' and other.id <> v_id
  ) then
    return 'custom_code_taken';
  end if;

  -- 판매 기간은 한쪽만 실려 올 수 있다. 실려 오지 않은 쪽은 현재 값과 맞춰 본다.
  v_starts := case when p_row ? 'sale_starts_at' then nullif(p_row ->> 'sale_starts_at', '')::timestamptz else v_good.sale_starts_at end;
  v_ends := case when p_row ? 'sale_ends_at' then nullif(p_row ->> 'sale_ends_at', '')::timestamptz else v_good.sale_ends_at end;
  if v_starts is not null and v_ends is not null and v_ends <= v_starts then
    return 'invalid_sale_window';
  end if;

  -- 예약판매는 출고 예정일이 있어야 한다(goods_preorder_ship_check).
  if coalesce(
       case when p_row ? 'sale_mode' then p_row ->> 'sale_mode' end, v_good.sale_mode, 'regular'
     ) = 'preorder'
     and coalesce(
       case when p_row ? 'preorder_ships_at' then nullif(p_row ->> 'preorder_ships_at', '')::date end,
       v_good.preorder_ships_at
     ) is null then
    return 'preorder_ships_required';
  end if;

  return null;
exception
  when invalid_datetime_format or datetime_field_overflow then return 'invalid_date';
end;
$$;

create or replace function private.apply_goods_import_row(p_row jsonb, p_actor uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_id text := p_row ->> 'good_id';
  v_previous_ip text;
  v_mode text;
begin
  select good.ip_id into v_previous_ip from public.goods as good where good.id = v_id for update;
  v_mode := case when found then 'update' else 'create' end;

  if v_mode = 'create' then
    insert into public.goods (id, ip_id, name, type, price)
    values (v_id, p_row ->> 'ip_id', p_row ->> 'name', p_row ->> 'type', (p_row ->> 'price')::integer);
  end if;

  update public.goods as good set
    ip_id = case when p_row ? 'ip_id' then p_row ->> 'ip_id' else good.ip_id end,
    name = case when p_row ? 'name' then p_row ->> 'name' else good.name end,
    type = case when p_row ? 'type' then p_row ->> 'type' else good.type end,
    price = case when p_row ? 'price' then (p_row ->> 'price')::integer else good.price end,
    compare_at_price = case when p_row ? 'compare_at_price' then (p_row ->> 'compare_at_price')::integer else good.compare_at_price end,
    supply_price = case when p_row ? 'supply_price' then (p_row ->> 'supply_price')::integer else good.supply_price end,
    tax_type = case when p_row ? 'tax_type' then p_row ->> 'tax_type' else good.tax_type end,
    custom_code = case when p_row ? 'custom_code' then nullif(p_row ->> 'custom_code', '') else good.custom_code end,
    badge = case when p_row ? 'badge' then nullif(p_row ->> 'badge', '') else good.badge end,
    summary = case when p_row ? 'summary' then nullif(p_row ->> 'summary', '') else good.summary end,
    search_keywords = case
      when p_row ? 'search_keywords'
        then coalesce((select pg_catalog.array_agg(value #>> '{}') from jsonb_array_elements(p_row -> 'search_keywords')), '{}'::text[])
      else good.search_keywords end,
    default_location_id = case when p_row ? 'default_location_id' then p_row ->> 'default_location_id' else good.default_location_id end,
    sale_mode = case when p_row ? 'sale_mode' then p_row ->> 'sale_mode' else good.sale_mode end,
    preorder_ships_at = case when p_row ? 'preorder_ships_at' then nullif(p_row ->> 'preorder_ships_at', '')::date else good.preorder_ships_at end,
    sale_starts_at = case when p_row ? 'sale_starts_at' then nullif(p_row ->> 'sale_starts_at', '')::timestamptz else good.sale_starts_at end,
    sale_ends_at = case when p_row ? 'sale_ends_at' then nullif(p_row ->> 'sale_ends_at', '')::timestamptz else good.sale_ends_at end,
    allow_bank_transfer = case when p_row ? 'allow_bank_transfer' then (p_row ->> 'allow_bank_transfer')::boolean else good.allow_bank_transfer end,
    updated_at = pg_catalog.now()
  where good.id = v_id;

  update public.ips as ip
  set goods_count = (select pg_catalog.count(*)::integer from public.goods as good where good.ip_id = ip.id),
      updated_at = pg_catalog.now()
  where ip.id in (p_row ->> 'ip_id', v_previous_ip);

  insert into public.audit_log (actor_id, action, target, diff)
  values (p_actor, 'catalog.good.import', 'goods:' || v_id,
          jsonb_build_object('mode', v_mode, 'fields', (select pg_catalog.array_agg(key) from jsonb_object_keys(p_row - 'line' - 'good_id') as key)));
  return v_mode;
end;
$$;

revoke all on function private.goods_import_check(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.apply_goods_import_row(jsonb, uuid) from public, anon, authenticated, service_role;
