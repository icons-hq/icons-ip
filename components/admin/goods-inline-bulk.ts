import { commitGoodsBulkAction, previewGoodsBulkAction, readGoodsBulkAction } from '@/app/admin/goods-bulk-actions';
import { goodsBulkError, parseGoodsBulkRequest, type GoodsBulkActiveDiscounts, type GoodsBulkCommand, type GoodsBulkGood } from '@/lib/admin/goods-bulk';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { discountStopStaleBaseMessage, priceAfterStopStaleMessage, type DiscountStopPricePhase, type DiscountStopReview } from '@/lib/admin/goods-list-inline';

/*
 * 상품 목록 바로 수정이 상품 1개짜리 일괄 변경(미리보기 → 확정)을 부르는 경로. 새 쓰기 경로를 만들지 않는다.
 * 미리보기의 현재 값이 목록(또는 창)에서 본 값과 다르면 확정하지 않고 요청을 종료한다(다른 사람의 수정 덮어쓰기 방지).
 * 미리보기와 확정 사이의 변경은 기존 지문 비교가, 감사는 기존 일괄 변경 기록이 맡는다.
 */

type BulkOutcome = { ok: true } | { ok: false; message: string; operationId?: string };
const UNCERTAIN = '처리 결과가 불명확합니다. 같은 요청의 결과를 조회해주세요.';

export async function runSingleGoodBulk(identity: GoodsGroupIdentity, goodId: string, command: GoodsBulkCommand,
  values: Record<string, string | number | null>, staleMessage: (row: GoodsBulkGood) => string | null): Promise<BulkOutcome> {
  const request = parseGoodsBulkRequest({ kind: 'goods', ids: [goodId], command, values });
  if (!request) return { ok: false, message: '입력값을 확인해주세요.' };
  const operationId = crypto.randomUUID();
  const preview = await previewGoodsBulkAction(operationId, request, identity);
  if ('error' in preview) return { ok: false, message: preview.error };
  const row = preview.value.goods.find(item => item.id === goodId);
  const stale = row ? staleMessage(row) : '현재 상품 정보를 확인하지 못했습니다.';
  if (stale) {
    // Close the reviewed request so it can never be committed later.
    await readGoodsBulkAction(operationId, identity, true).catch(() => null);
    return { ok: false, message: stale };
  }
  // A commit whose reply never arrived may have been applied: keep the request id for '처리 결과 조회' instead of retrying.
  const receipt = await commitGoodsBulkAction(operationId, identity).catch(() => ({ error: UNCERTAIN, uncertain: true }));
  if ('error' in receipt) return { ok: false, message: receipt.error, ...(receipt.uncertain ? { operationId } : {}) };
  if (receipt.value.state === 'completed') return { ok: true };
  return { ok: false, message: goodsBulkError(receipt.value.error) };
}

/*
 * 할인 중지 후 판매가 변경(1027T-025, 묶음 15 '할인 멈추고 판매가 변경'). 기존 '기간 할인 중지' → '판매가 변경'을 차례로 부른다.
 * 판매가 변경이 실패해도 멈춘 할인은 되돌리지 않는다 — 결과에 할인이 이미 멈췄다고 밝히고 같은 창에서 판매가만 다시 시도한다.
 * 한 단계의 결과를 모르면(응답 끊김) 다음 단계로 가지 않고 그 요청의 결과 조회·미처리 종료로 끝낸다.
 */

/** 다음 단계와, 판매가 변경의 기대값이 바뀌었으면 그 값. `done`이면 판매가까지 바뀌었다. */
export type DiscountStopPriceStep = { phase: DiscountStopPricePhase; seenBasePrice?: number; done?: boolean };

/** 멈출 할인을 읽는다(일괄 변경 '기간 할인 중지' 비교). 아무것도 바꾸지 않는다. */
export async function reviewDiscountStop(identity: GoodsGroupIdentity, goodId: string, seenBasePrice: number): Promise<DiscountStopPricePhase> {
  const request = parseGoodsBulkRequest({ kind: 'goods', ids: [goodId], command: 'discount_stop', values: {} });
  if (!request) return { step: 'review-failed', message: '상품을 확인하지 못했습니다. 창을 닫고 새로고침해주세요.', retry: false };
  const operationId = crypto.randomUUID();
  const preview = await previewGoodsBulkAction(operationId, request, identity);
  if ('error' in preview) {
    /* 그사이 할인이 끝났거나 다른 곳에서 멈췄다. 멈출 것이 없으니 판매가만 바꾼다고 밝힌다. */
    if (preview.error === goodsBulkError('goods_bulk_no_active_discount')) return { step: 'price', stoppedHere: false, stopped: null, error: '' };
    return { step: 'review-failed', message: preview.error, retry: !preview.authChanged };
  }
  const row = preview.value.goods.find(item => item.id === goodId);
  if (!row || row.price !== seenBasePrice) {
    await readGoodsBulkAction(operationId, identity, true).catch(() => null);
    return { step: 'review-failed', message: row ? discountStopStaleBaseMessage(row.price) : '현재 상품 정보를 확인하지 못했습니다. 창을 닫고 새로고침해주세요.', retry: false };
  }
  return { step: 'ready', review: { operationId, discounts: row.discounts ?? null } };
}

/** 확인한 할인 중지를 확정하고, 확정되면 이어서 판매가를 바꾼다. `onStopped`는 할인이 멈춘 순간 창에 알린다. */
export async function stopDiscountThenChangePrice(identity: GoodsGroupIdentity, goodId: string, review: DiscountStopReview, seenBasePrice: number, nextPrice: number,
  onStopped?: (phase: DiscountStopPricePhase) => void): Promise<DiscountStopPriceStep> {
  const receipt = await commitGoodsBulkAction(review.operationId, identity).catch(() => ({ error: UNCERTAIN, uncertain: true }));
  if ('error' in receipt) {
    return { phase: receipt.uncertain ? { step: 'stop-uncertain', review, operationId: review.operationId, message: receipt.error }
      : { step: 'review-failed', message: receipt.error, retry: true } };
  }
  if (receipt.value.state !== 'completed') return { phase: { step: 'review-failed', message: goodsBulkError(receipt.value.error), retry: true } };
  const stop = { stoppedHere: true, stopped: review.discounts };
  onStopped?.({ step: 'price', ...stop, error: '' });
  return changePriceAfterStop(identity, goodId, seenBasePrice, nextPrice, stop);
}

/**
 * 할인이 멈춘 상태에서 판매가만 바꾼다(처음 이어서, 또는 실패 뒤 다시 시도). 단계(`step`)는 결과로만 정한다 —
 * 넘겨받은 값은 할인 중지 사실(`stoppedHere`·`stopped`)만 읽는다(단계 객체를 펼쳐 결과 단계를 덮지 않는다).
 */
export async function changePriceAfterStop(identity: GoodsGroupIdentity, goodId: string, seenBasePrice: number, nextPrice: number,
  stop: { stoppedHere: boolean; stopped: GoodsBulkActiveDiscounts | null }): Promise<DiscountStopPriceStep> {
  const { stoppedHere, stopped } = stop;
  let current = seenBasePrice;
  try {
    const result = await runSingleGoodBulk(identity, goodId, 'price', { mode: 'set', value: nextPrice }, row => {
      current = row.price;
      return row.price === seenBasePrice ? null : priceAfterStopStaleMessage(row.price);
    });
    if (result.ok) return { phase: { step: 'price', stoppedHere, stopped, error: '' }, done: true };
    if (result.operationId) return { phase: { step: 'price-uncertain', stoppedHere, stopped, operationId: result.operationId, message: result.message } };
    /* 그사이 다른 곳에서 바뀐 기본 판매가는 창의 '현재 판매가'로 보이고 다시 시도의 기대값이 된다. */
    return { phase: { step: 'price', stoppedHere, stopped, error: result.message }, ...(current !== seenBasePrice ? { seenBasePrice: current } : {}) };
  } catch {
    // The preview call itself failed, so no price request exists to commit.
    return { phase: { step: 'price', stoppedHere, stopped, error: '판매가 변경을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.' } };
  }
}

/** 결과를 모르는 단계의 처리 결과 조회(`seal`이면 미처리 요청 종료). 판매가 변경을 새로 시작하지는 않는다. */
export async function recoverDiscountStopPrice(identity: GoodsGroupIdentity, phase: Extract<DiscountStopPricePhase, { step: 'stop-uncertain' | 'price-uncertain' }>,
  seal: boolean): Promise<DiscountStopPriceStep> {
  const result = await readGoodsBulkAction(phase.operationId, identity, seal).catch(() => null);
  if (!result || 'error' in result) return { phase: { ...phase, message: result?.error ?? '처리 결과를 불러오지 못했습니다. 다시 조회해주세요.' } };
  const { state, error } = result.value;
  if (state === 'unresolved') return { phase: { ...phase, message: '아직 완료 기록이 없습니다. 잠시 후 다시 조회해주세요.' } };
  if (phase.step === 'stop-uncertain') {
    if (state === 'completed') return { phase: { step: 'price', stoppedHere: true, stopped: phase.review.discounts, error: '' } };
    return { phase: { step: 'review-failed', retry: true,
      message: state === 'sealed' ? '미처리 요청을 종료했습니다. 할인과 판매가는 바뀌지 않았습니다. 멈출 할인을 다시 확인해주세요.' : goodsBulkError(error) } };
  }
  if (state === 'completed') return { phase: { step: 'price', stoppedHere: phase.stoppedHere, stopped: phase.stopped, error: '' }, done: true };
  return { phase: { step: 'price', stoppedHere: phase.stoppedHere, stopped: phase.stopped,
    error: state === 'sealed' ? '미처리 요청을 종료했습니다. 판매가는 바뀌지 않았습니다.' : goodsBulkError(error) } };
}

/** 창이 끝난 뒤 목록에 남길 결과 문구(창은 그 상품이 목록에서 빠져도 결과를 잃지 않게 화면 수준에서 연다). */
export function discountStopPriceDoneNotice(goodName: string, price: number, stoppedHere: boolean) {
  const won = `${price.toLocaleString('ko-KR')}원`;
  return stoppedHere ? `‘${goodName}’ 할인을 멈추고 판매가를 ${won}으로 바꿨습니다.` : `‘${goodName}’ 판매가를 ${won}으로 바꿨습니다.`;
}
