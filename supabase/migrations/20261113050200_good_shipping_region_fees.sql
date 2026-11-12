-- ==========================================================================
-- ICONS · 상품 상세 배송 안내의 지역별 추가 배송비(S36-038, 묶음 15)
--
-- 상세 배송 안내에 '제주 +₩3,000 · 도서산간 +₩5,000'처럼 이 굿즈의 출고지·택배사에
-- 지금 적용되는 활성 지역 정책의 추가료를 싣는다. 규칙이 없으면 화면은 지금 문장을 둔다.
--
-- 금액은 새로 계산하지 않는다. 지역표의 추가료 행마다 그 행에 들어가는 주소 하나로
-- 주문서와 같은 견적 함수를 부른다 — 기존 주문 경로는 private.apply_shipping_region_quote,
-- 새 거래 런타임이 켜져 있으면 private.calculate_goods_transaction_shipping. 견적이 같은
-- 행으로 판정하고 이 굿즈에 붙인 금액(이 굿즈 1개, 무료배송 기준 전)만 싣는다. 그래서
-- 정책 상품·무료배송 상품·개별 배송비 상품의 부과 여부, 부과 단위, 택배사 불일치·정책
-- 공백, 도입 전 출고지가 주문서와 어긋나지 않는다. 무료배송 기준을 채웠을 때 면제되는지도
-- 같은 함수로 기준 금액을 한 번 더 견적해 정한다.
--
-- 묶음그룹의 자체 지역표나 수령 방식 선택처럼 상세에서 한 금액으로 말할 수 없는 경우는
-- 'unresolved'를 돌려주고 화면은 지금 문장을 둔다. 공개 정보(지역명·금액·부과 단위·
-- 면제 여부·다음 정책 경계)만 싣고 정책 ID·근거 문서·우편번호 구간은 싣지 않는다.
-- 한 번에 견적하는 지역 후보는 30개까지다(넘으면 truncated).
-- ==========================================================================

-- 이 굿즈 1개를 p_destination으로 주문할 때 붙는 지역 추가 배송비. null은 상세에서
-- 한 금액으로 말할 수 없는 경우다(새 거래 런타임의 차단·묶음그룹 지역표).
create function private.good_shipping_region_probe_fee(
  p_selected public.goods, p_owner public.goods, p_destination jsonb, p_unit_price bigint,
  p_runtime_enabled boolean, p_at timestamptz)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare lines jsonb; calculation jsonb; fee numeric;
begin
  if not p_runtime_enabled then
    -- 기존 주문 경로(quote_goods_sales_for_address)와 같은 줄 모양. 합산 관계가 있는
    -- 굿즈는 원상품의 정책을 따른다(기존 경로는 그 굿즈 주문을 막는다).
    lines := jsonb_build_array(jsonb_build_object('origin_id', p_owner.origin_id, 'good_id', p_owner.id, 'qty', 1,
      'unit_price', p_unit_price, 'fee_type', p_owner.shipping_fee_type, 'individual_fee', p_owner.individual_fee));
    return coalesce((private.apply_shipping_region_quote(private.calculate_goods_shipping(lines), lines, p_destination, p_at)
      #>> '{groups,0,regionalFee}')::numeric, 0);
  end if;
  -- 새 거래 런타임은 고른 굿즈 줄을 그대로 넘긴다 — 원상품 합산·수령 방식·수량 운임·
  -- 묶음그룹은 계산 함수가 스스로 정한다.
  lines := jsonb_build_array(jsonb_build_object('origin_id', p_selected.origin_id, 'good_id', p_selected.id, 'qty', 1,
    'unit_price', p_unit_price, 'fee_type', p_selected.shipping_fee_type, 'individual_fee', p_selected.individual_fee));
  begin
    calculation := private.calculate_goods_transaction_shipping(lines, p_destination, '{}'::jsonb, p_at);
  exception when others then
    return null;
  end;
  if calculation->>'state' is distinct from 'calculated' or exists (
    select 1 from jsonb_array_elements(coalesce(calculation->'rawGroups', '[]'::jsonb)) raw
    cross join lateral jsonb_array_elements(coalesce(raw->'deliveryTerms', '[]'::jsonb)) term
    where term #>> '{regionalSource,scope}' = 'group') then
    return null;
  end if;
  select coalesce(sum((component->>'regionalFee')::numeric), 0) into fee
  from jsonb_array_elements(calculation->'rawGroups') raw
  cross join lateral jsonb_array_elements(coalesce(raw->'components', '[]'::jsonb)) component
  where component->>'goodId' = p_selected.id;
  return fee;
end;
$function$;

revoke all on function private.good_shipping_region_probe_fee(public.goods, public.goods, jsonb, bigint, boolean, timestamptz)
  from public, anon, authenticated, service_role;

create function public.get_good_shipping_region_fees(target_good_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  selected public.goods;
  owner public.goods;
  origin public.fulfillment_origins;
  probe_at timestamptz := statement_timestamp();
  runtime_enabled boolean;
  owner_lines jsonb;
  candidate record;
  destination jsonb;
  region_group jsonb;
  fee numeric;
  threshold_fee numeric;
  probed jsonb := '[]';
  regions jsonb;
  fee_unit text;
  waived boolean := false;
  waiver_checked boolean := false;
  truncated boolean := false;
  probes integer := 0;
  next_change timestamptz;
begin
  -- 공개 배송 정책(get_good_shipping_policy)과 같은 공개 범위·같은 정책 상품·같은 출고지.
  select g.* into selected
  from public.goods g join public.ips ip on ip.id = g.ip_id
  where g.id = target_good_id and g.archived_at is null and g.published_at is not null
    and private.good_sale_restriction_visible(g.sale_restriction, (select auth.uid()))
    and ip.archived_at is null and ip.published_at is not null;
  if not found then return null; end if;
  select * into owner from public.goods where id = private.goods_aggregation_owner(selected.id);
  select * into origin from public.fulfillment_origins where id = owner.origin_id and is_active;
  if not found then return null; end if;
  runtime_enabled := coalesce((select runtime.enabled from private.goods_transaction_runtime runtime where runtime.singleton), false);
  owner_lines := jsonb_build_array(jsonb_build_object('origin_id', owner.origin_id, 'good_id', owner.id, 'qty', 1,
    'unit_price', 0, 'fee_type', owner.shipping_fee_type, 'individual_fee', owner.individual_fee));
  -- 정책 시작·종료·도입 시각이 오면 상세를 다시 읽는다(주소 없는 견적이 같은 경계를 낸다).
  next_change := (private.apply_shipping_region_quote(private.calculate_goods_shipping(owner_lines), owner_lines, null, probe_at)
    ->>'nextChangeAt')::timestamptz;

  for candidate in
    select distinct on (rule->>'regionLabel', (rule->>'amount')::numeric)
      (rule->>'id')::uuid as rule_id, rule->>'regionLabel' as label, rule->>'postalFrom' as postal_code,
      rule->>'addressPrefix' as address_prefix
    from private.shipping_region_policies policy
    cross join lateral jsonb_array_elements(policy.configuration->'rules') rule
    where policy.origin_id = origin.id and policy.carrier_code = origin.default_carrier and policy.status = 'active'
      and policy.starts_at <= probe_at and (policy.ends_at is null or probe_at < policy.ends_at)
      and rule->>'disposition' = 'surcharge' and (rule->>'amount')::numeric > 0
    order by rule->>'regionLabel', (rule->>'amount')::numeric, policy.starts_at desc, rule->>'postalFrom', rule->>'addressPrefix'
  loop
    if probes >= 30 then truncated := true; exit; end if;
    probes := probes + 1;
    -- 행의 첫 우편번호와 주소 시작문구(없으면 아무 기본주소)는 그 행에만 들어간다 —
    -- 활성 정책은 겹치는 행을 받지 않는다. 견적이 다른 행·다른 판정을 내면 싣지 않는다.
    destination := jsonb_build_object('postalCode', candidate.postal_code,
      'address1', coalesce(nullif(candidate.address_prefix, ''), '주소'));
    region_group := private.apply_shipping_region_quote(private.calculate_goods_shipping(owner_lines), owner_lines, destination, probe_at)
      ->'groups'->0;
    continue when region_group->>'regionStatus' is distinct from 'surcharge'
      or (region_group->>'ruleId')::uuid is distinct from candidate.rule_id;
    if runtime_enabled then
      fee := private.good_shipping_region_probe_fee(selected, owner, destination, 0, true, probe_at);
      if fee is null then
        return jsonb_build_object('state', 'unresolved', 'regions', '[]'::jsonb, 'feeUnit', null,
          'waivedAtFreeThreshold', false, 'truncated', false, 'nextChangeAt', next_change);
      end if;
    else
      fee := coalesce((region_group->>'regionalFee')::numeric, 0);
    end if;
    continue when fee <= 0;
    -- 면제 여부는 부과 규칙(굿즈·정책)에 달렸고 지역과 무관하므로 한 번만 견적한다.
    if not waiver_checked and origin.free_threshold is not null then
      waiver_checked := true;
      threshold_fee := private.good_shipping_region_probe_fee(selected, owner, destination, origin.free_threshold, runtime_enabled, probe_at);
      waived := threshold_fee is not null and threshold_fee = 0;
    end if;
    fee_unit := coalesce(fee_unit, region_group->>'feeUnit');
    probed := probed || jsonb_build_array(jsonb_build_object('label', candidate.label, 'fee', fee));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'minFee', min_fee, 'maxFee', max_fee) order by min_fee, max_fee, label), '[]'::jsonb)
  into regions
  from (
    select item->>'label' as label, min((item->>'fee')::numeric) as min_fee, max((item->>'fee')::numeric) as max_fee
    from jsonb_array_elements(probed) item
    group by item->>'label'
  ) grouped;

  return jsonb_build_object(
    'state', case when jsonb_array_length(regions) > 0 then 'listed' else 'none' end,
    'regions', regions,
    'feeUnit', case when jsonb_array_length(regions) > 0 then fee_unit end,
    'waivedAtFreeThreshold', jsonb_array_length(regions) > 0 and waived,
    'truncated', truncated,
    'nextChangeAt', next_change);
end;
$function$;

revoke all on function public.get_good_shipping_region_fees(text) from public, anon, authenticated, service_role;
grant execute on function public.get_good_shipping_region_fees(text) to anon, authenticated;

comment on function public.get_good_shipping_region_fees(text) is
  '상품 상세 배송 안내의 지역별 추가 배송비 요약. 금액은 주문서 견적 함수로 지역마다 견적한 값이다.';

notify pgrst, 'reload schema';
