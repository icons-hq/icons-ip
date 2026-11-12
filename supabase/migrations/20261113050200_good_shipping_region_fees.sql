-- ==========================================================================
-- ICONS · 상품 상세 배송 안내의 지역별 추가 배송비(S36-038, 묶음 15)
--
-- 상세 배송 안내에 '제주 +₩3,000 · 도서산간 +₩5,000~₩7,000(배송 묶음당 1회)'처럼 이
-- 굿즈의 출고지·현재 기본 택배사에 지금 적용되는 활성 지역 정책의 추가료를 싣는다.
-- 굿즈마다 부과하는 정책은 단위를 '굿즈당 1회'로 밝힌다(feeUnit). 규칙이 없거나 상세에서
-- 한 문장으로 말할 수 없으면 화면은 지금 문장을 둔다.
--
-- 지역명과 금액은 그 정책 지역표의 '추가료 부과'·0원 초과 행에서 그대로 모은다(같은
-- 지역명은 최소~최대, 실제 지역 수도 함께). 계산하거나 일부만 고르지 않는다.
-- 이 굿즈에 추가료가 붙는지, 부과 단위, 무료배송 기준 면제는 주문서와 같은 견적 함수
-- (private.apply_shipping_region_quote)를 대표 행 하나로 견적해 정한다 — 대표 행
-- 금액 그대로 붙으면 다른 행도 그 행의 금액 그대로 붙는다(부과 여부·단위는 행이 아니라
-- 굿즈 배송 유형과 정책 설정이 정한다). 굿즈 1개 견적은 배송 건당·굿즈당 모두 그 행 금액이고,
-- 굿즈당은 대상 굿즈 수만큼 곱해진다. 무료배송 기준 금액으로 한 번 더 견적해 0원이면 면제를
-- 함께 싣는다.
--
-- 'unresolved'(지금 문장)로 두는 경우: 새 거래 런타임이 켜져 있음(묶음그룹 지역표·수령
-- 방식·수량 운임이 행마다 금액을 바꿀 수 있다), 부과 단위를 모름, 견적이 다른 정책·다른 행·
-- 다른 금액으로 판정함. 'none'(지금 문장): 정책이 없음·도입 전 출고지·이 굿즈에 추가료가
-- 붙지 않음. 공개 정보(지역명·금액·지역 수·부과 단위·면제 여부·다음 정책 경계)만 싣고 정책
-- ID·근거 문서·우편번호 구간은 싣지 않는다. 지역 목록은 최소 금액순 20개까지 싣고
-- regionCount가 실제 지역 수다.
-- ==========================================================================

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
  policy private.shipping_region_policies;
  representative record;
  lines jsonb;
  destination jsonb;
  quote_group jsonb;
  fee numeric;
  fee_unit text;
  waived boolean := false;
  regions jsonb;
  region_count integer;
  next_change timestamptz;
  result jsonb;
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

  -- 기존 주문 경로(quote_goods_sales_for_address)와 같은 줄 모양. 합산 관계가 있는 굿즈는
  -- 원상품의 정책을 따른다(기존 경로는 그 굿즈 주문을 막는다). 단가 0원 = 무료 기준 전.
  lines := jsonb_build_array(jsonb_build_object('origin_id', owner.origin_id, 'good_id', owner.id, 'qty', 1,
    'unit_price', 0, 'fee_type', owner.shipping_fee_type, 'individual_fee', owner.individual_fee));
  -- 정책 시작·종료·도입 시각이 오면 상세를 다시 읽는다(주소 없는 견적이 같은 경계를 낸다).
  next_change := (private.apply_shipping_region_quote(private.calculate_goods_shipping(lines), lines, null, probe_at)
    ->>'nextChangeAt')::timestamptz;
  result := jsonb_build_object('state', 'none', 'regions', '[]'::jsonb, 'regionCount', 0, 'feeUnit', null,
    'waivedAtFreeThreshold', false, 'nextChangeAt', next_change);

  if coalesce((select runtime.enabled from private.goods_transaction_runtime runtime where runtime.singleton), false) then
    return result || jsonb_build_object('state', 'unresolved');
  end if;

  select p.* into policy
  from private.shipping_region_policies p
  where p.origin_id = origin.id and p.carrier_code = origin.default_carrier and p.status = 'active'
    and p.starts_at <= probe_at and (p.ends_at is null or probe_at < p.ends_at)
  order by p.starts_at desc, p.version desc
  limit 1;
  if not found then return result; end if;

  -- 대표 행: 0원 초과 추가료 행 중 우편번호·주소 시작문구가 가장 앞선 행. 행의 첫 우편번호와
  -- 주소 시작문구(없으면 아무 기본주소)는 그 행에만 들어간다 — 활성 정책은 겹치는 행을 받지 않는다.
  select (rule->>'id')::uuid as rule_id, (rule->>'amount')::numeric as amount,
    rule->>'postalFrom' as postal_code, rule->>'addressPrefix' as address_prefix
  into representative
  from jsonb_array_elements(policy.configuration->'rules') rule
  where rule->>'disposition' = 'surcharge' and (rule->>'amount')::numeric > 0
  order by rule->>'postalFrom', rule->>'addressPrefix'
  limit 1;
  if not found then return result; end if;
  destination := jsonb_build_object('postalCode', representative.postal_code,
    'address1', coalesce(nullif(representative.address_prefix, ''), '주소'));

  quote_group := private.apply_shipping_region_quote(private.calculate_goods_shipping(lines), lines, destination, probe_at)->'groups'->0;
  -- 도입 전 출고지는 기존 배송비로 확정한다 — 지역료가 없다.
  if quote_group->>'regionMode' = 'legacy_base_only' then return result; end if;
  if quote_group->>'regionStatus' is distinct from 'surcharge'
    or (quote_group->>'policyId')::uuid is distinct from policy.id
    or (quote_group->>'ruleId')::uuid is distinct from representative.rule_id then
    return result || jsonb_build_object('state', 'unresolved');
  end if;
  fee := (quote_group->>'regionalFee')::numeric;
  -- 이 굿즈의 배송 유형에는 지역료를 붙이지 않는 정책이다.
  if fee = 0 then return result; end if;
  -- 굿즈 1개 견적은 배송 건당(최대 1회)·굿즈당(대상 굿즈 수만큼) 모두 그 행 금액이다. 단위는 화면이 밝힌다.
  fee_unit := quote_group->>'feeUnit';
  if fee_unit is null or fee_unit not in ('per_shipment', 'per_good') or fee is distinct from representative.amount then
    return result || jsonb_build_object('state', 'unresolved');
  end if;

  -- 무료배송 기준 면제: 기준 금액으로 다시 견적해 0원이면 면제, 대표 행 금액 그대로면 면제 없음.
  if origin.free_threshold is not null then
    lines := jsonb_set(lines, '{0,unit_price}', to_jsonb(origin.free_threshold));
    quote_group := private.apply_shipping_region_quote(private.calculate_goods_shipping(lines), lines, destination, probe_at)->'groups'->0;
    if quote_group->>'regionStatus' is distinct from 'surcharge'
      or (quote_group->>'ruleId')::uuid is distinct from representative.rule_id
      or quote_group->>'regionalFee' is null
      or (quote_group->>'regionalFee')::numeric not in (0, representative.amount) then
      return result || jsonb_build_object('state', 'unresolved');
    end if;
    waived := (quote_group->>'regionalFee')::numeric = 0;
  end if;

  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object('label', label, 'minFee', min_fee, 'maxFee', max_fee)
      order by min_fee, max_fee, label) filter (where position <= 20), '[]'::jsonb)
  into region_count, regions
  from (
    select label, min_fee, max_fee, row_number() over (order by min_fee, max_fee, label) as position
    from (
      select rule->>'regionLabel' as label, min((rule->>'amount')::numeric) as min_fee, max((rule->>'amount')::numeric) as max_fee
      from jsonb_array_elements(policy.configuration->'rules') rule
      where rule->>'disposition' = 'surcharge' and (rule->>'amount')::numeric > 0
      group by rule->>'regionLabel'
    ) grouped
  ) ranked;

  return result || jsonb_build_object('state', 'listed', 'regions', regions, 'regionCount', region_count,
    'feeUnit', fee_unit, 'waivedAtFreeThreshold', waived);
end;
$function$;

revoke all on function public.get_good_shipping_region_fees(text) from public, anon, authenticated, service_role;
grant execute on function public.get_good_shipping_region_fees(text) to anon, authenticated;

comment on function public.get_good_shipping_region_fees(text) is
  '상품 상세 배송 안내의 지역별 추가 배송비 요약. 지역명·금액은 활성 정책 지역표 그대로, 부과 여부·단위·면제는 주문서 견적 함수로 확인한다.';

notify pgrst, 'reload schema';
