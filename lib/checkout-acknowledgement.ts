/* 결제 전 주문 내용 확인·구매 조건 동의(원장 PAY-015). 화면(주문서 체크박스)과 서버 액션이 같은 값을 쓴다.
 * 동의 문구가 바뀌어 고객이 읽는 내용이 달라지면 CHECKOUT_ACKNOWLEDGEMENT_VERSION을 올린다 — 주문마다 이 버전이 기록된다. */

export const CHECKOUT_ACKNOWLEDGEMENT_VERSION = '2026-11-19';

/** 청약철회(반품)·교환이 제한된 굿즈. 값은 굿즈의 반품·교환 조건(claim_*)이다 — 사유는 제한일 때 필수라 비어 있지 않다. */
export interface CheckoutClaimRestriction {
  goodId: string;
  returnAllowed: boolean | null;
  exchangeAllowed: boolean | null;
  reason: string;
}
export type CheckoutClaimRestrictions = Readonly<Record<string, CheckoutClaimRestriction>>;

export const EMPTY_CHECKOUT_CLAIM_RESTRICTIONS: CheckoutClaimRestrictions = {};

/** 주문서 품목 줄의 고지. 반품만·교환만 제한이면 어느 쪽인지 밝힌다(가능한 쪽까지 제한으로 읽히지 않게). */
export function checkoutRestrictionNotice(restriction: CheckoutClaimRestriction): string {
  const returnLimited = restriction.returnAllowed === false;
  const exchangeLimited = restriction.exchangeAllowed === false;
  const scope = returnLimited && exchangeLimited ? '청약철회·교환 제한' : returnLimited ? '청약철회 제한 · 교환 가능' : '교환 제한 · 청약철회 가능';
  return `${scope} — ${restriction.reason}`;
}

/** 이 주문서 품목 가운데 청약철회·교환이 제한된 굿즈(주문서 줄 순서, 중복 제거). */
export function restrictedCheckoutGoods(goodIds: readonly string[], restrictions: CheckoutClaimRestrictions): CheckoutClaimRestriction[] {
  const seen = new Set<string>();
  return goodIds.flatMap((goodId) => {
    const found = Object.hasOwn(restrictions, goodId) ? restrictions[goodId] : undefined;
    if (!found || seen.has(goodId)) return [];
    seen.add(goodId);
    return [found];
  });
}

/** 체크박스 문구. 제한 굿즈가 있으면 그 사실을 같은 동의에 더한다. */
export function checkoutAcknowledgementText(hasRestrictedGoods: boolean): string {
  return hasRestrictedGoods
    ? '주문 굿즈·수량·결제 금액·배송지를 확인했으며, 청약철회 또는 교환이 제한되는 굿즈가 포함되어 있음을 확인하고 구매 조건과 결제에 동의합니다.'
    : '주문 굿즈·수량·결제 금액·배송지를 확인했으며, 구매 조건과 결제에 동의합니다.';
}

export const CHECKOUT_ACKNOWLEDGEMENT_REQUIRED_COPY = '주문 내용 확인과 구매 조건 동의에 체크한 뒤 주문해주세요.';

/** 서버 액션이 받은 값이 정확히 true일 때만 동의로 본다(문자열 "true"·1 등은 거절). */
export function isCheckoutAcknowledged(value: unknown): boolean {
  return value === true;
}

/** 서버가 읽은 굿즈 행 → 제한 목록. 형식이 틀리거나 제한이 아닌 행은 버린다(알 수 없는 값은 제한 아님이 아니라 무시). */
export function parseCheckoutClaimRestrictions(rows: unknown): CheckoutClaimRestrictions {
  if (!Array.isArray(rows)) return EMPTY_CHECKOUT_CLAIM_RESTRICTIONS;
  const entries: [string, CheckoutClaimRestriction][] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const { id, claim_return_allowed: returnAllowed, claim_exchange_allowed: exchangeAllowed, claim_restriction_reason: reason } = row as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || (returnAllowed !== false && exchangeAllowed !== false)) continue;
    entries.push([id, {
      goodId: id,
      returnAllowed: typeof returnAllowed === 'boolean' ? returnAllowed : null,
      exchangeAllowed: typeof exchangeAllowed === 'boolean' ? exchangeAllowed : null,
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : '개별 확인',
    }]);
  }
  return Object.fromEntries(entries);
}

/** 읽기 실패로 제한 고지를 보이지 못했을 때 주문서가 대신 보이는 일반 고지. 같은 서버 판정을 그대로 탄다. */
export const CHECKOUT_CLAIM_NOTICE_UNAVAILABLE_COPY = '청약철회·교환 제한 안내를 불러오지 못했어요. 주문 전에 굿즈 상세의 교환·반품 안내를 확인해주세요.';
/** 화면에 보인 제한 고지와 서버가 주문 직전에 다시 읽은 제한이 달라 주문을 만들지 않았다. */
export const CHECKOUT_CLAIM_NOTICE_CHANGED_COPY = '청약철회·교환 제한 안내가 바뀌었어요. 주문서를 다시 확인해주세요.';

/** 화면이 실제로 보인 제한 굿즈 id 목록. 읽기 실패로 일반 고지만 보였으면 'unavailable'. */
export type CheckoutClaimNotice = readonly string[] | 'unavailable';

/** 주문서 품목 기준으로 화면이 보인 고지. restrictions가 null이면 읽지 못한 것이다. */
export function claimNoticeOf(restrictions: CheckoutClaimRestrictions | null, goodIds: readonly string[]): CheckoutClaimNotice {
  return restrictions === null ? 'unavailable' : restrictedCheckoutGoods(goodIds, restrictions).map((restriction) => restriction.goodId);
}

/** 서버 액션이 받은 고지 값 검증. 형식이 틀리면 null이고 호출자는 주문을 거절한다(fail-closed). */
export function normalizeClaimNotice(value: unknown): CheckoutClaimNotice | null {
  if (value === 'unavailable') return 'unavailable';
  if (!Array.isArray(value) || value.length > 200) return null;
  if (value.some((id) => typeof id !== 'string' || id === '' || id.length > 200)) return null;
  return [...new Set(value as string[])];
}

/** record RPC의 p_screen_notice 모양. */
export function claimNoticeRecord(notice: CheckoutClaimNotice | null | undefined): { goodIds: string[] } | { unavailable: true } | null {
  if (notice === null || notice === undefined) return null;
  return notice === 'unavailable' ? { unavailable: true } : { goodIds: [...notice] };
}
