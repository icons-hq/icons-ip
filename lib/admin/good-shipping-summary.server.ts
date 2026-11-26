import 'server-only';
import { loadAdminShippingRegionPolicies } from './shipping-regions.server';
import type { GoodsFulfillmentOrigin } from './fulfillment-origins';
import type { GoodShippingRegionSummary } from './good-shipping-summary';

/** Summarize saved configuration; checkout alone calculates destination fees. */
export async function loadGoodShippingRegionSummaries(origins: GoodsFulfillmentOrigin[]): Promise<GoodShippingRegionSummary[]> {
  const now = Date.now();
  const checkedAt = new Date(now).toISOString();
  try {
    const { policies, adoptions } = await loadAdminShippingRegionPolicies();
    return origins.map((origin) => {
      const adoption = adoptions.find((row) => row.originId === origin.id);
      if (!adoption || Date.parse(adoption.managedFrom) > now) return {
        originId: origin.id, checkedAt, label: '지역별 추가배송비 안 씀 · 기본 배송비만 받음',
        detail: '제주·도서산간도 다른 지역과 같은 배송비로 주문받는 출고지입니다.',
      };
      const policy = policies.filter((row) => row.originId === origin.id && row.carrierCode === origin.defaultCarrier
        && row.status === 'active' && row.startsAt && Date.parse(row.startsAt) <= now && (!row.endsAt || Date.parse(row.endsAt) > now))
        .sort((a, b) => Date.parse(b.startsAt!) - Date.parse(a.startsAt!))[0];
      if (!policy) return { originId: origin.id, checkedAt, label: '적용 중인 지역별 추가배송비 없음', detail: '이 출고지는 지금 새 주문이 막혀 있습니다. 지역별 추가배송비 관리에서 새로 만들어 적용해 주세요.' };
      const flag = (value: boolean | null) => value === true ? '추가배송비 받음' : value === false ? '추가배송비 안 받음' : '확인 필요';
      return { originId: origin.id, checkedAt, label: policy.name || '지역별 추가배송비',
        detail: `‘출고지 정책 따름’ 상품 ${flag(policy.chargePolicyGoods)} · ‘무료배송’ 상품 ${flag(policy.chargeFreeGoods)} · ‘개별 배송비’ 상품 ${flag(policy.chargeIndividualGoods)}. ${policy.waivePolicyThreshold ? '무료 배송 기준 금액을 채우면 추가배송비도 받지 않습니다.' : '무료 배송 기준 금액을 채워도 추가배송비는 받습니다.'} 금액은 주문할 때 배송지에 따라 정해집니다.` };
    });
  } catch {
    return origins.map((origin) => ({ originId: origin.id, checkedAt, label: '지역별 추가배송비 확인 필요', detail: '지역별 추가배송비를 불러오지 못했습니다. 추가배송비가 없다는 뜻이 아니니 새로고침해 다시 확인해 주세요.' }));
  }
}
