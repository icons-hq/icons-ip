/**
 * 구매자 본인 주문의 진행 중 반품·교환 회수 묶음(배송 건 × 반품지) 가운데 방문 회수(반품 자동 회수 접수, QNA-032)와 고객이 직접 보내야 하는
 * 묶음 수. 둘 다 0이면 지금 반송 안내 그대로다.
 */
export type OrderReturnPickup = { pickupBundles: number; directBundles: number };
export const NO_RETURN_PICKUP: OrderReturnPickup = { pickupBundles: 0, directBundles: 0 };

const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

/** DB 응답을 읽는다. 키가 정확히 둘이 아니거나 모양이 틀리면 null(호출부는 지금 반송 안내로 둔다). */
export function parseOrderReturnPickup(value: unknown): OrderReturnPickup | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !keys.includes('pickupBundles') || !keys.includes('directBundles')) return null;
  return count(record.pickupBundles) && count(record.directBundles) ? { pickupBundles: record.pickupBundles, directBundles: record.directBundles } : null;
}
