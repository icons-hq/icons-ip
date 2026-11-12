/**
 * 상품 목록 바로 수정의 두 창(1014-106·107·1027T-025)이 쓰는 순수 규칙. 쓰기 경로는 새로 만들지 않는다.
 * - 옵션별 재고: 옵션마다 기존 실재고 조정(admin_adjust_stock)을 부른다. 이 창에서 본 수량을 기대값으로 보내므로
 *   그사이 판매·다른 수정으로 바뀐 옵션만 거절되고(다시 확인), 나머지 옵션은 저장된다. 사유는 옵션마다 남는다.
 * - 할인 중지 후 판매가 변경: 기존 상품 일괄 변경의 '기간 할인 중지' → '판매가 변경'을 차례로 부른다.
 *   두 번째가 실패하면 할인은 이미 멈춘 상태로 남고(되돌리지 않는다), 같은 창에서 판매가만 다시 시도한다.
 */
import type { GoodsBulkActiveDiscounts } from './goods-bulk';

const INT32_MAX = 2_147_483_647;
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

/** 목록 재고 칸의 옵션별 재고 창이 보이는 사용 옵션 한 줄. 수량은 목록을 읽은 때의 실재고다. */
export interface GoodsListOptionStock { variantId: string; name: string; code: string; stockQty: number }

/** 0 이상 정수 수량(쉼표 허용). 아니면 null. */
export function parseInlineStockQty(raw: string): number | null {
  const text = raw.replaceAll(',', '').trim();
  if (!/^(0|[1-9][0-9]*)$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value <= INT32_MAX ? value : null;
}
/** 1원 이상 정수 판매가(쉼표 허용). 아니면 null. */
export function parseInlineSalePrice(raw: string): number | null {
  const text = raw.replaceAll(',', '').trim();
  if (!/^[1-9][0-9]*$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value <= INT32_MAX ? value : null;
}

// ── 옵션별 재고 창 ──────────────────────────────────────────────────────────────────────────

/** 실재고 조정 사유 길이 상한(admin_adjust_stock과 같다). */
export const OPTION_STOCK_REASON_MAX = 200;
/** 사유를 비우면 남는 기록. 한 옵션 바로 수정(`상품 목록에서 재고수량 수정 (7 → 9)`)과 같은 모양이다. */
export function optionStockDefaultReason(from: number, to: number) {
  return `상품 목록에서 옵션별 재고수량 수정 (${from.toLocaleString('ko-KR')} → ${to.toLocaleString('ko-KR')})`;
}

/**
 * 창의 한 줄 상태. `seen`은 운영자가 이 창에서 본 수량(저장할 때의 기대값)이다.
 * 다시 확인 중인 줄은 `seen`이 null이라 목록이 새로 읽은 현재 수량을 그대로 보여 주고, 그 값을 기대값으로 다시 저장한다.
 */
export type OptionStockRowStatus = 'idle' | 'saved' | 'recheck' | 'uncertain' | 'invalid';
export interface OptionStockRow {
  variantId: string; name: string; code: string;
  seen: number | null;
  input: string; reason: string;
  /** 한 번의 조정을 멱등하게 만드는 요청번호. 화면에 그리지 않는다. 반영되지 않은 것이 확실할 때만 새로 만든다. */
  requestId: string;
  status: OptionStockRowStatus; message: string;
}
export const OPTION_STOCK_STATUS_LABELS: Record<Exclude<OptionStockRowStatus, 'idle' | 'invalid'>, string> = {
  saved: '저장됨', recheck: '다시 확인', uncertain: '결과 확인 필요',
};

export function openOptionStockRows(options: GoodsListOptionStock[], newId: () => string): OptionStockRow[] {
  return options.map(option => ({ variantId: option.variantId, name: option.name, code: option.code, seen: option.stockQty,
    input: String(option.stockQty), reason: '', requestId: newId(), status: 'idle', message: '' }));
}
/** 줄의 현재 수량: 이 창에서 본 값, 다시 확인 중이면 목록이 새로 읽은 값. 옵션이 목록에서 사라졌으면 null. */
export function optionStockCurrent(row: OptionStockRow, live: readonly GoodsListOptionStock[]): number | null {
  return row.seen ?? live.find(option => option.variantId === row.variantId)?.stockQty ?? null;
}

export interface OptionStockRequest { variantId: string; requestId: string; expectedStockQty: number; nextStockQty: number; reason: string }
/** `rows`는 입력 오류 표시를 고친 줄이다(고쳐진 줄의 오류는 지운다). */
export type OptionStockPlan =
  | { ok: true; requests: OptionStockRequest[]; rows: OptionStockRow[] }
  | { ok: false; rows: OptionStockRow[] };

/**
 * 저장할 줄을 고른다. 바뀌지 않은 줄은 보내지 않는다. 잘못 입력한 줄이 하나라도 있으면 아무것도 보내지 않고
 * 그 줄에 이유를 붙여 돌려준다(일부만 조용히 저장하지 않는다).
 */
export function planOptionStockSave(rows: OptionStockRow[], live: readonly GoodsListOptionStock[]): OptionStockPlan {
  const requests: OptionStockRequest[] = [];
  let invalid = false;
  const checked = rows.map((row): OptionStockRow => {
    const current = optionStockCurrent(row, live);
    const next = parseInlineStockQty(row.input);
    const reason = row.reason.trim();
    const fail = (message: string): OptionStockRow => { invalid = true; return { ...row, status: 'invalid', message }; };
    /* 다시 확인 중에 목록에서 사라진 옵션(보관 등)은 보낼 기대값이 없다. 다른 줄은 막지 않고 이 줄만 남겨 둔다. */
    if (current === null) return { ...row, status: 'recheck', message: '이 옵션은 지금 사용 중인 옵션에 없습니다. 상품 수정의 옵션에서 확인해주세요.' };
    if (next === null) return fail('0 이상의 정수로 입력해주세요.');
    if (next === current) return row.status === 'invalid' ? { ...row, status: 'idle', message: '' } : row;
    if ([...reason].length > OPTION_STOCK_REASON_MAX) return fail(`사유는 ${OPTION_STOCK_REASON_MAX}자 이하로 입력해주세요.`);
    requests.push({ variantId: row.variantId, requestId: row.requestId, expectedStockQty: current, nextStockQty: next, reason: reason || optionStockDefaultReason(current, next) });
    return row.status === 'invalid' ? { ...row, status: 'idle', message: '' } : row;
  });
  return invalid ? { ok: false, rows: checked } : { ok: true, requests, rows: checked };
}

/**
 * 한 옵션 조정의 결과.
 * - saved: 반영됐다(돌려받은 수량).
 * - rejected: 서버가 거절해 반영되지 않았다(다른 곳에서 먼저 바뀐 수량 포함). 새 요청번호로 다시 확인한다.
 * - uncertain: 응답을 받지 못했다. 같은 요청번호·같은 값으로 다시 저장하면 한 번만 반영된다.
 */
export type OptionStockOutcome =
  | { variantId: string; state: 'saved'; stockQty: number }
  | { variantId: string; state: 'rejected'; message: string }
  | { variantId: string; state: 'uncertain'; message: string };

export function applyOptionStockOutcomes(rows: OptionStockRow[], outcomes: readonly OptionStockOutcome[], newId: () => string): OptionStockRow[] {
  return rows.map(row => {
    const outcome = outcomes.find(item => item.variantId === row.variantId);
    if (!outcome) return row;
    if (outcome.state === 'saved') return { ...row, seen: outcome.stockQty, input: String(outcome.stockQty), reason: '', requestId: newId(), status: 'saved', message: '' };
    if (outcome.state === 'rejected') return { ...row, seen: null, requestId: newId(), status: 'recheck', message: outcome.message };
    return { ...row, status: 'uncertain', message: outcome.message };
  });
}
export function optionStockSummary(outcomes: readonly OptionStockOutcome[]): string {
  const saved = outcomes.filter(outcome => outcome.state === 'saved').length;
  const rejected = outcomes.filter(outcome => outcome.state === 'rejected').length;
  const uncertain = outcomes.filter(outcome => outcome.state === 'uncertain').length;
  return [saved ? `${saved}개 옵션의 재고수량을 저장했습니다.` : '', rejected ? `${rejected}개 옵션은 저장하지 않았습니다. 현재 수량을 다시 확인하고 저장해주세요.` : '',
    uncertain ? `${uncertain}개 옵션은 저장 결과를 확인하지 못했습니다. 같은 수량으로 다시 저장하면 한 번만 반영됩니다.` : ''].filter(Boolean).join(' ');
}

// ── 할인 중지 후 판매가 변경 ───────────────────────────────────────────────────────────────

/** 할인 중지 비교(멈출 진행·예정 기간 할인). 비교 요청은 15분 동안 유효하고, 그사이 할인·옵션 가격이 바뀌면 확정이 거절된다. */
export interface DiscountStopReview { operationId: string; discounts: GoodsBulkActiveDiscounts | null }
/**
 * 창의 단계.
 * - loading: 멈출 할인을 읽는 중
 * - ready: 멈출 할인을 보여 주고 확인을 기다림
 * - review-failed: 아무것도 바뀌지 않았다. `retry`면 멈출 할인을 다시 읽을 수 있고, 아니면 창을 닫고 새로고침한다.
 * - stop-uncertain: 할인 중지 결과를 모른다(처리 결과 조회·미처리 요청 종료)
 * - price: 할인이 멈춘 상태(이 창에서 멈췄거나 이미 없었음)에서 판매가 변경을 기다리거나 실패했다. `error`가 실패 사유다.
 * - price-uncertain: 할인은 멈췄고 판매가 변경 결과를 모른다
 */
export type DiscountStopPricePhase =
  | { step: 'loading' }
  | { step: 'ready'; review: DiscountStopReview }
  | { step: 'review-failed'; message: string; retry: boolean }
  | { step: 'stop-uncertain'; review: DiscountStopReview; operationId: string; message: string }
  | { step: 'price'; stoppedHere: boolean; stopped: GoodsBulkActiveDiscounts | null; error: string }
  | { step: 'price-uncertain'; stoppedHere: boolean; stopped: GoodsBulkActiveDiscounts | null; operationId: string; message: string };

/** 할인이 멈춘 뒤인가. 이때부터 창을 닫으면 목록을 새로 읽어 할인 표시가 사라진 것을 보인다. */
export function discountStopApplied(phase: DiscountStopPricePhase | null): boolean {
  return phase?.step === 'price' || phase?.step === 'price-uncertain';
}
/** 결과를 모르는 동안은 창을 닫지 않는다(처리 결과 조회·미처리 요청 종료로 끝낸다). */
export function discountStopAwaitingResult(phase: DiscountStopPricePhase | null): boolean {
  return phase?.step === 'stop-uncertain' || phase?.step === 'price-uncertain';
}

const KST_SHORT = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
/** '할인 2건 · 할인가 8,000원 ~ 8,500원 · 11. 12. 10:00 ~ 11. 20. 23:59'. 일괄 변경의 할인 중지 비교와 같은 표기다. */
export function discountStopSummary(discounts: GoodsBulkActiveDiscounts): string {
  const prices = discounts.minPrice === discounts.maxPrice ? won(discounts.minPrice) : `${won(discounts.minPrice)} ~ ${won(discounts.maxPrice)}`;
  return `할인 ${discounts.count.toLocaleString('ko-KR')}건 · 할인가 ${prices} · ${KST_SHORT.format(new Date(discounts.startsAt))} ~ ${KST_SHORT.format(new Date(discounts.endsAt))}`;
}
export function discountStopStaleBaseMessage(price: number) {
  return `다른 곳에서 기본 판매가가 ${won(price)}으로 바뀌었습니다. 창을 닫고 새로고침한 뒤 다시 수정해주세요.`;
}
export function priceAfterStopStaleMessage(price: number) {
  return `다른 곳에서 기본 판매가가 ${won(price)}으로 바뀌어 판매가를 바꾸지 않았습니다. 바뀐 현재 판매가를 확인하고 다시 시도해주세요.`;
}
