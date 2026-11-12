import { isUuid } from '@/lib/uuid';
import type { CartItem } from './cart';
import { parseGoodsCustomInputSelection } from './goods-custom-inputs';

/*
 * 주문서 초안(ADR-0030). 장바구니 화면이 체크한 줄(selection)이나 상품 상세·위시의 [구매하기] 선택(direct)을
 * 서버(private.checkout_drafts)에 두고 주문서는 `/checkout?draft=<id>`로 연다. 직접입력값(각인 문구 등)을 URL에
 * 싣지 않고, 새로고침·다른 탭에서도 같은 주문서가 보인다. 초안이 없으면 주문서는 지금처럼 장바구니 전체다.
 */

export type CheckoutDraftSource = 'selection' | 'direct';

/** 초안 주문서의 쿠폰 출처. 선택 주문은 장바구니 쿠폰 선택, 바로구매는 주문서에서 고른 쿠폰이다(ADR-0030). */
export type CheckoutDraftCoupon = { kind: 'cart' } | { kind: 'direct'; userCouponId: string | null };

export interface CheckoutDraft {
  id: string;
  source: CheckoutDraftSource;
  /** 바로구매의 상품 상세 굿즈(되돌아가기·다시 구매하기 목적지). 선택 주문은 null. */
  baseGoodId: string | null;
  expiresAt: string;
  lines: CartItem[];
  /** 선택 주문 초안을 만든 뒤 고른 장바구니 줄이 바뀌었는지(수량·삭제). 바로구매는 늘 false. */
  stale: boolean;
  /**
   * 이 주문서로 이미 접수(무통장)·결제한 주문. 있으면 같은 주문서로 다시 주문하지 않고 그 주문으로 안내한다 — 다른 탭·
   * 뒤로 가기의 재제출은 DB가 checkout_draft_used로 거절한다. 카드 미결제 주문은 여기 오지 않는다(새 주문이 닫는다).
   */
  usedOrderId: string | null;
}

/**
 * 만료된(줄을 지운) 본인 주문서. 줄은 없고 출처·상품 상세·이미 주문한 주문만 남아, 주문서 화면이 고른 화면으로
 * 돌려보내거나(바로구매는 굿즈 상세) 원 주문으로 안내한다.
 */
export interface ClosedCheckoutDraft {
  id: string;
  source: CheckoutDraftSource;
  baseGoodId: string | null;
  closed: 'expired';
  usedOrderId: string | null;
}

export function isClosedCheckoutDraft(draft: CheckoutDraft | ClosedCheckoutDraft): draft is ClosedCheckoutDraft {
  return 'closed' in draft;
}

export function normalizeCheckoutDraftId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  return isUuid(id) ? id : null;
}

export function checkoutDraftHref(draftId: string): string {
  return `/checkout?draft=${encodeURIComponent(draftId)}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 이미 주문한 주문 id. 없으면 null, 모양이 틀리면 undefined. */
function usedOrderIdOf(value: Record<string, unknown>): string | null | undefined {
  if (value.usedOrderId === null || value.usedOrderId === undefined) return null;
  return typeof value.usedOrderId === 'string' && isUuid(value.usedOrderId) ? value.usedOrderId.toLowerCase() : undefined;
}

/**
 * service_get_checkout_draft 응답. 살아 있는 주문서는 CheckoutDraft, 만료된 본인 주문서는 ClosedCheckoutDraft다.
 * 모양이 틀리면 null — 주문서는 초안을 못 읽은 것으로 다룬다.
 */
export function parseCheckoutDraftView(value: unknown): CheckoutDraft | ClosedCheckoutDraft | null {
  if (!record(value) || value.closed === undefined || value.closed === null) return parseCheckoutDraft(value);
  const id = normalizeCheckoutDraftId(value.id);
  const source = value.source === 'selection' || value.source === 'direct' ? value.source : null;
  const baseGoodId = value.baseGoodId === null || value.baseGoodId === undefined ? null
    : typeof value.baseGoodId === 'string' && value.baseGoodId.trim() ? value.baseGoodId : undefined;
  const usedOrderId = usedOrderIdOf(value);
  if (value.closed !== 'expired' || !id || !source || baseGoodId === undefined || usedOrderId === undefined
    || (source === 'direct') !== (baseGoodId !== null)) return null;
  return { id, source, baseGoodId, closed: 'expired', usedOrderId };
}

/** 살아 있는 주문서 초안 응답. 모양이 틀리거나 만료된 주문서면 null. */
export function parseCheckoutDraft(value: unknown): CheckoutDraft | null {
  if (!record(value) || (value.closed !== undefined && value.closed !== null)) return null;
  const id = normalizeCheckoutDraftId(value.id);
  const source = value.source === 'selection' || value.source === 'direct' ? value.source : null;
  const baseGoodId = value.baseGoodId === null || value.baseGoodId === undefined ? null
    : typeof value.baseGoodId === 'string' && value.baseGoodId.trim() ? value.baseGoodId : undefined;
  const usedOrderId = usedOrderIdOf(value);
  if (!id || !source || baseGoodId === undefined || usedOrderId === undefined || (source === 'direct') !== (baseGoodId !== null)
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || !Array.isArray(value.lines)
    || !value.lines.length || typeof value.stale !== 'boolean') return null;
  const lines: CartItem[] = [];
  for (const line of value.lines) {
    if (!record(line) || typeof line.goodId !== 'string' || !line.goodId.trim() || typeof line.variantId !== 'string'
      || !isUuid(line.variantId) || typeof line.qty !== 'number' || !Number.isSafeInteger(line.qty) || line.qty < 1) return null;
    const customInputs = line.customInputs === null || line.customInputs === undefined ? undefined : parseGoodsCustomInputSelection(line.customInputs);
    if (customInputs === null) return null;
    lines.push({ goodId: line.goodId, variantId: line.variantId.toLowerCase(), qty: line.qty, ...(customInputs ? { customInputs } : {}) });
  }
  return { id, source, baseGoodId, expiresAt: value.expiresAt, lines, stale: value.stale, usedOrderId };
}

/** 주문서의 '되돌아가기' 목적지. 선택 주문은 장바구니, 바로구매는 그 상품 상세다. */
export function checkoutDraftReturnHref(draft: Pick<CheckoutDraft, 'source' | 'baseGoodId'> | null | undefined): string {
  return draft?.source === 'direct' && draft.baseGoodId ? `/shop/${encodeURIComponent(draft.baseGoodId)}` : '/cart';
}
