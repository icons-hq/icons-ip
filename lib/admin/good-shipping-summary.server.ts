import 'server-only';
import { loadAdminShippingRegionPolicies } from './shipping-regions.server';
import type { FulfillmentOrigin } from './fulfillment-origins';
import type { GoodShippingRegionSummary } from './good-shipping-summary';

/** Summarize saved configuration; checkout alone calculates destination fees. */
export async function loadGoodShippingRegionSummaries(origins: FulfillmentOrigin[]): Promise<GoodShippingRegionSummary[]> {
  const now = Date.now();
  const checkedAt = new Date(now).toISOString();
  try {
    const { policies, adoptions } = await loadAdminShippingRegionPolicies();
    return origins.map((origin) => {
      const adoption = adoptions.find((row) => row.originId === origin.id);
      if (!adoption || Date.parse(adoption.managedFrom) > now) return {
        originId: origin.id, checkedAt, label: '지역 추가료 미설정 · 기본 배송비만 적용',
        detail: '현재 지역 정책을 도입하지 않은 출고지입니다. 추가료를 확인한 무료 정책으로 표시하는 것은 아닙니다.',
      };
      const policy = policies.filter((row) => row.originId === origin.id && row.carrierCode === origin.defaultCarrier
        && row.status === 'active' && row.startsAt && Date.parse(row.startsAt) <= now && (!row.endsAt || Date.parse(row.endsAt) > now))
        .sort((a, b) => Date.parse(b.startsAt!) - Date.parse(a.startsAt!))[0];
      if (!policy) return { originId: origin.id, checkedAt, label: '지역 배송 정책 확인 필요', detail: '현재 출고지·택배사·기간에 적용할 활성 정책이 없습니다. 정책 설정을 확인해주세요.' };
      const flag = (value: boolean | null) => value === true ? '추가료 적용' : value === false ? '추가료 면제' : '확인 필요';
      return { originId: origin.id, checkedAt, label: `${policy.name} · 버전 ${policy.version}`,
        detail: `출고지 정책 상품 ${flag(policy.chargePolicyGoods)} · 무료배송 상품 ${flag(policy.chargeFreeGoods)} · 개별 배송비 상품 ${flag(policy.chargeIndividualGoods)}. ${policy.waivePolicyThreshold ? '출고지 무료 기준 충족 시 추가료 면제.' : '출고지 무료 기준과 추가료는 별도.'} 최종 금액은 주문 주소와 택배사 사용 상태를 확인해 확정합니다.` };
    });
  } catch {
    return origins.map((origin) => ({ originId: origin.id, checkedAt, label: '지역 추가료 확인 필요', detail: '지역 배송 정책을 불러오지 못했습니다. 미확인 상태이며 0원으로 간주하지 않습니다.' }));
  }
}
