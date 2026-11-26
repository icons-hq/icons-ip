import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adminClaimFeeErrorCopy, claimFeeActionConfirm, claimFeeTimeProblem, claimFeePolicyChangedMessage, claimFeePolicyConfirmMessage, claimFeePolicyFailure, claimFeePolicyReadback, claimFeePolicySummary,
  claimFeePolicyValues, parseClaimFeePolicyAmount, partialReturnFeePanelNote, sameClaimFeePolicyValues,
} from './claim-fees';
import { claimFeeError } from '@/lib/orders/claim-fees';
import { parseReturnFeeDeduction, returnFeeDeductionFeePanelNote } from '@/lib/claims/return-fee-deduction';
import type { AdminClaimPartialReturn } from '@/lib/orders/partial-return';

const off = { enabled: false, returnAmount: null, exchangeAmount: null };
const on = { enabled: true, returnAmount: 3000, exchangeAmount: 6000 };

describe('배송비 청구 설정의 값과 말', () => {
  it('금액 칸: 비우면 직접 적는 것(null), 1~1,000,000원 정수만 받는다', () => {
    expect(parseClaimFeePolicyAmount('')).toBeNull(); expect(parseClaimFeePolicyAmount('  ')).toBeNull();
    expect(parseClaimFeePolicyAmount('1')).toBe(1); expect(parseClaimFeePolicyAmount(' 3000 ')).toBe(3000); expect(parseClaimFeePolicyAmount('1000000')).toBe(1000000);
    for (const wrong of ['0', '-1', '3000.5', '1000001', '3,000', '3천원', '03000', '1e3']) expect(parseClaimFeePolicyAmount(wrong)).toBeUndefined();
  });

  it('저장하는 값은 사용 여부와 기본 청구 금액 둘뿐이다(근거·확인 체크 없음)', () => {
    const policy = { revision: 3, ...on, evidence: '예전 근거', updatedAt: '2026-11-01T00:00:00Z', accountReady: true };
    expect(claimFeePolicyValues(policy)).toEqual(on);
    expect(sameClaimFeePolicyValues(policy, on)).toBe(true); expect(sameClaimFeePolicyValues(on, { ...on, exchangeAmount: null })).toBe(false); expect(sameClaimFeePolicyValues(on, { ...on, enabled: false })).toBe(false);
  });

  it('되읽기 한 줄은 금액이 청구 창에 미리 채워질 뿐이라는 것을 말한다', () => {
    expect(claimFeePolicyReadback(on)).toBe('[새 배송비 청구]를 누르면 금액 칸에 반품 3,000원 · 교환 6,000원이 미리 채워집니다. 청구할 때 고칠 수 있습니다.');
    expect(claimFeePolicyReadback({ ...on, exchangeAmount: null })).toBe('[새 배송비 청구]를 누르면 반품은 금액 칸에 3,000원이 미리 채워지고, 교환은 금액을 직접 적습니다.');
    expect(claimFeePolicyReadback({ ...on, returnAmount: null })).toBe('[새 배송비 청구]를 누르면 교환은 금액 칸에 6,000원이 미리 채워지고, 반품은 금액을 직접 적습니다.');
    expect(claimFeePolicyReadback({ ...on, returnAmount: null, exchangeAmount: null })).toBe('[새 배송비 청구]를 누르면 금액을 그때마다 직접 적습니다.');
    expect(claimFeePolicySummary(off)).toBe('쓰지 않음'); expect(claimFeePolicySummary({ ...on, exchangeAmount: null })).toBe('고객과 합의한 요청에만 직접 청구 · 반품 3,000원 · 교환 없음');
  });

  it('확인창은 바뀌는 값만 이전 → 새 값으로 보이고, 언제부터 어떤 요청에 적용되는지 말한다', () => {
    /* 금액만 바꿈: 지금부터 여는 청구 창에만 채워지고 이미 청구한 금액은 그대로다. */
    expect(claimFeePolicyConfirmMessage(on, { ...on, returnAmount: 3500 })).toBe([
      '반품 기본 청구 금액: 3,000원 → 3,500원', '',
      '저장하면 바로 적용됩니다.', '새 금액은 지금부터 여는 [새 배송비 청구]의 금액 칸에 미리 채워집니다. 이미 청구한 배송비의 금액은 바뀌지 않습니다.',
    ].join('\n'));
    /* 켬: 이미 접수된 요청에도 바로 쓸 수 있다. 자동 청구는 없다. */
    expect(claimFeePolicyConfirmMessage(off, on)).toBe([
      '배송비 청구: 쓰지 않음 → 고객과 합의한 요청에만 직접 청구', '반품 기본 청구 금액: 없음 → 3,000원', '교환 기본 청구 금액: 없음 → 6,000원', '',
      '저장하면 바로 적용됩니다.', '이미 접수돼 진행 중인 반품·교환 요청에도 요청 상세에서 [새 배송비 청구]를 쓸 수 있게 됩니다. 환불을 접수해 반품배송비를 환불액에서 빼기로 정해진 반품은 쓸 수 없고, 환불을 접수하기 전 반품에서 청구하면 그 반품은 환불액에서 반품배송비를 빼지 않습니다. 자동으로 청구되지는 않습니다.',
      '새 금액은 지금부터 여는 [새 배송비 청구]의 금액 칸에 미리 채워집니다. 이미 청구한 배송비의 금액은 바뀌지 않습니다.',
    ].join('\n'));
    /* 끔: 새 청구만 막히고 이미 청구한 건은 계속 처리한다. */
    expect(claimFeePolicyConfirmMessage(on, { ...on, enabled: false })).toBe([
      '배송비 청구: 고객과 합의한 요청에만 직접 청구 → 쓰지 않음', '',
      '저장하면 바로 적용됩니다.', '새로 청구할 수 없게 됩니다. 이미 청구한 건의 입금 확인·면제·취소·반환은 계속 할 수 있습니다.',
    ].join('\n'));
    expect(claimFeePolicyChangedMessage(on)).toBe("다른 사람이 먼저 바꿨습니다. 지금 저장된 설정은 '고객과 합의한 요청에만 직접 청구 · 반품 3,000원 · 교환 6,000원'입니다. 적은 내용으로 바꾸려면 다시 [설정 저장]을 눌러 주세요.");
  });

  it('저장 오류는 저장되지 않은 것이 분명한지, 모르는지를 나눈다', () => {
    expect(claimFeePolicyFailure('42501')).toEqual({ error: '로그인 상태나 판매 관리 권한이 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.', saved: 'no' });
    expect(claimFeePolicyFailure('22023')).toEqual({ error: '기본 청구 금액은 1원부터 1,000,000원까지 원 단위 숫자로 적거나 비워 주세요.', saved: 'no' });
    /* 계좌가 없어 켤 수 없는 것도 PT409로 오지만, 다른 사람이 바꾼 것이 아니다. */
    expect(claimFeePolicyFailure('PT409', 'claim_fee_account_missing')).toEqual({ saved: 'no', error: "입금 받을 계좌가 없어 '고객과 합의한 요청에만 직접 청구'로 저장하지 못했습니다. [무통장 계좌 등록하러 가기]에서 은행·계좌번호·예금주를 등록한 뒤 다시 저장해 주세요." });
    expect(claimFeePolicyFailure('PT409', 'claim_fee_changed')).toMatchObject({ saved: 'no', changed: true });
    expect(claimFeePolicyFailure('PT409', 'claim_fee_changed').error).toContain('다른 사람이 먼저 바꿨습니다.');
    for (const unknown of [claimFeePolicyFailure(), claimFeePolicyFailure('57014', 'canceling statement'), claimFeePolicyFailure('XX000')]) {
      expect(unknown).toEqual({ error: '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.', saved: 'unknown' });
    }
  });
});

describe('요청 상세 배송비 칸(운영자)의 말', () => {
  it('확인창은 금액과 그 뒤에 일어나는 일을 말한다', () => {
    const issue = claimFeeActionConfirm('issue', { amount: 6000, payerRole: 'requester' });
    expect(issue).toMatchObject({ title: '배송비 청구', confirmLabel: '청구하기', cancelLabel: '돌아가기' });
    expect(issue.message).toContain('반품·교환 요청자에게 배송비 6,000원을 청구합니다.'); expect(issue.message).toContain('알림은 따로 가지 않으니 고객에게 직접 알려 주세요.');
    expect(issue.message).toContain('주문 환불 금액에서 빼는 것이 아니라 따로 입금받는 돈입니다.');
    expect(claimFeeActionConfirm('issue', { amount: 3000 }).message).toContain('원 주문 구매자에게 배송비 3,000원을 청구합니다.');
    expect(claimFeeActionConfirm('confirm_payment', { amount: 3000, state: 'reported' }).message).toContain("기록하면 '입금 확인'으로 바뀌고, 되돌리려면 [청구 취소 · 반환 대기]로 돌려줘야 합니다.");
    /* 취소·면제한 청구에 늦게 들어온 돈은 돌려줄 돈이 된다. */
    for (const state of ['voided', 'waived'] as const) expect(claimFeeActionConfirm('confirm_payment', { amount: 3000, state }).message).toContain("받지 않기로 한 돈이라 '배송비 반환 대기'로 바뀝니다.");
    expect(claimFeeActionConfirm('waive', { amount: 3000, state: 'unpaid' })).toMatchObject({ title: '청구 면제', confirmLabel: '면제하기', destructive: true });
    expect(claimFeeActionConfirm('cancel', { amount: 3000, state: 'unpaid' }).message).toContain("취소한 청구는 다시 '입금 대기'로 돌릴 수 없습니다.");
    expect(claimFeeActionConfirm('cancel', { amount: 3000, state: 'paid' }).message).toContain("'배송비 반환 대기'로 바뀝니다. 고객에게 3,000원을 돌려준 뒤 [실제 반환 완료]를 기록해 주세요.");
    const refund = claimFeeActionConfirm('refund', { amount: 3000, state: 'refund_due' });
    expect(refund).toMatchObject({ title: '실제 반환 완료', confirmLabel: '반환 완료 기록' }); expect(refund.destructive).toBeUndefined();
    expect(refund.message).toContain("기록하면 '배송비 반환 완료'로 끝나고 되돌릴 수 없습니다. 이 기록이 은행 송금을 대신하지는 않습니다.");
  });

  it('고객 화면과 함께 쓰는 서버 오류 문구를 운영자 화면의 말로 바꾼다 — 원문이 바뀌면 이 시험이 알려 준다', () => {
    /* claimFeeError가 지금 돌려주는 문장 그대로여야 바뀐다. */
    const cases: [string, string][] = [
      [claimFeeError('P0002'), '이 배송비 청구를 찾지 못했습니다. [배송비 청구 내역 확인]을 눌러 지금 상태를 다시 불러와 주세요.'],
      [claimFeeError('PT409', 'claim_fee_account_missing'), '입금 받을 계좌가 없어 청구할 수 없습니다. [배송비 청구 설정]의 [무통장 계좌 등록하러 가기]에서 계좌를 등록한 뒤 다시 청구해 주세요.'],
      [claimFeeError('22023'), '금액, 실제 입금·반환한 시각, 근거를 확인해 주세요. 근거는 2자 이상 적습니다. 시각은 청구한 시각보다 뒤이고 지금보다 앞이어야 합니다.'],
      [claimFeeError('PT409'), '다른 사람이 먼저 바꿨습니다. [배송비 청구 내역 확인]을 눌러 지금 상태를 본 뒤 다시 해 주세요.'],
      [claimFeeError(), '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.'],
    ];
    for (const [source, shown] of cases) expect(adminClaimFeeErrorCopy(source)).toBe(shown);
    /* 저장 뒤 지금 상태를 못 읽은 경우의 문장은 서버 액션에 적혀 있다. */
    const afterSave = '저장은 확인했지만 최신 청구 상태를 읽지 못했습니다. 같은 요청으로 다시 확인해주세요.';
    expect(readFileSync(join(process.cwd(), 'app/orders/claim-fee-actions.ts'), 'utf8')).toContain(`'${afterSave}'`);
    expect(adminClaimFeeErrorCopy(afterSave)).toBe('저장은 됐지만 지금 상태를 불러오지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');
    /* 권한 문구와 모르는 문구는 그대로 보인다. */
    expect(adminClaimFeeErrorCopy(claimFeeError('42501'))).toBe(claimFeeError('42501'));
    expect(adminClaimFeeErrorCopy('처음 보는 문구')).toBe('처음 보는 문구');
  });
});

/*
 * F-21: 부분 반품 상세에서 부분 반품 칸은 '반품배송비 3,000원 차감 · 환불 예정 19,000원'이라 하는데 배송비 칸은 '주문 환불 금액에서는 빼지 않습니다'라고 해서
 * 두 칸이 반대로 말했다. 부분 반품의 차감은 부분 반품 칸이 읽는 미리보기·원장에 있어, 배송비 칸 안내도 거기서 만든다.
 * 서버(private.claim_fee_document·partial_return_fee_deduction)는 환불 접수 전에는 청구를 열어 두되 청구하면 차감하지 않고, 접수해 차감이 정해지면 청구를 막는다.
 */
describe('부분 반품 요청의 배송비 칸 안내', () => {
  const preview = (extra: Record<string, unknown> = {}) => ({ provider: 'bank_transfer', balanceBefore: 44000, goodsRefundAmount: 22000, shippingRefundAmount: 0, grossRefundAmount: 22000,
    returnFeeDeduction: 3000, returnFeeBasis: 'one_way', returnFeeReason: null, refundAmount: 19000, storeCreditRestoreAmount: 0, emptiedShipmentCount: 0, ...extra });
  const live = (extra: Record<string, unknown> = {}) => ({ id: 'l1', sequence: 1, reasonCode: 'return', claimId: 'c1', returnFeeDeduction: 3000, state: 'awaiting_transfer', provider: 'bank_transfer',
    refundAmount: 19000, goodsRefundAmount: 22000, shippingRefundAmount: 0, storeCreditRestoreAmount: 0, createdAt: '2026-11-26T08:00:00.000Z', ...extra });
  const partial = (extra: Record<string, unknown> = {}) => ({ items: [], refundId: null, history: [], preview: null, previewError: null, settlement: null, transferConvertible: false, ...extra }) as unknown as AdminClaimPartialReturn;

  it('환불 접수 전 차감 예정이면 주문 전체 반품과 글자까지 같은 말로 따로 청구하지 말라고 한다', () => {
    const note = partialReturnFeePanelNote(partial({ preview: preview() }));
    expect(note).toBe('이 반품은 반품배송비 3,000원(편도 3,000원)을 환불할 때 환불액에서 뺍니다. 같은 반품배송비를 여기서 다시 청구하지 마세요.');
    /* 같은 칸(주문 전체 반품)의 안내와 같은 문장이다 — 부분 반품이라고 말이 달라지지 않는다. */
    const whole = parseReturnFeeDeduction({ source: 'plan', state: null, applicable: true, reason: null, oneWayAmount: 3000, basis: 'one_way', deductionAmount: 3000, paymentAmount: 22000, refundAmount: 19000, provider: 'bank_transfer' });
    expect(note).toBe(returnFeeDeductionFeePanelNote(whole));
  });

  it('최초 무료배송이라 왕복을 빼는 부분 반품은 왕복 근거를 보인다', () => {
    expect(partialReturnFeePanelNote(partial({ preview: preview({ returnFeeDeduction: 6000, returnFeeBasis: 'round_trip', refundAmount: 16000 }) })))
      .toBe('이 반품은 반품배송비 6,000원(최초 무료배송이라 왕복(편도 3,000원 × 2))을 환불할 때 환불액에서 뺍니다. 같은 반품배송비를 여기서 다시 청구하지 마세요.');
    /* 기준을 모르면 괄호 없이 금액만 말한다. */
    expect(partialReturnFeePanelNote(partial({ preview: preview({ returnFeeBasis: null }) })))
      .toBe('이 반품은 반품배송비 3,000원을 환불할 때 환불액에서 뺍니다. 같은 반품배송비를 여기서 다시 청구하지 마세요.');
  });

  it('환불을 접수한 뒤에는 원장의 차감을 말하고, 끝났으면 뺐다고 말한다', () => {
    expect(partialReturnFeePanelNote(partial({ refundId: 'l1', history: [live()], preview: null })))
      .toBe('이 반품은 반품배송비 3,000원을 환불할 때 환불액에서 뺍니다. 같은 반품배송비를 여기서 다시 청구하지 마세요.');
    expect(partialReturnFeePanelNote(partial({ refundId: 'l1', history: [live({ state: 'completed' })] })))
      .toBe('이 반품은 반품배송비 3,000원을 환불액에서 뺐습니다. 같은 반품배송비를 여기서 다시 청구하지 마세요.');
    /* 접수한 환불이 차감 없이 정해졌으면 칸의 기본 문장('환불 금액에서는 빼지 않습니다')이 맞다. */
    expect(partialReturnFeePanelNote(partial({ refundId: 'l1', history: [live({ returnFeeDeduction: 0 })] }))).toBeNull();
  });

  it('여기서 이미 청구해 차감하지 않기로 바뀌었으면 그렇게 말한다', () => {
    expect(partialReturnFeePanelNote(partial({ preview: preview({ returnFeeDeduction: 0, returnFeeBasis: 'one_way', returnFeeReason: 'claim_fee_invoiced', refundAmount: 22000 }) })))
      .toBe('이 반품은 여기서 청구한 배송비가 있어 환불액에서 반품배송비를 빼지 않습니다.');
  });

  it('차감이 없는 그 밖의 경우나 부분 반품이 아닌 요청은 null — 칸의 기본 문장이 사실이다', () => {
    for (const returnFeeReason of ['disabled', 'seller_fault', 'requested_before_enabled', 'carrier_loss', 'fee_exceeds_refund']) {
      expect(partialReturnFeePanelNote(partial({ preview: preview({ returnFeeDeduction: 0, returnFeeReason }) })), returnFeeReason).toBeNull();
    }
    expect(partialReturnFeePanelNote(partial())).toBeNull();
    expect(partialReturnFeePanelNote(null)).toBeNull();
    expect(partialReturnFeePanelNote(undefined)).toBeNull();
  });
});

/* F-17: 시각 칸이 서버 규칙 밖이면 저장 전에 어느 칸이 왜 틀렸는지 말한다(서버는 금액·시각·근거를 한 문장으로만 거절한다). */
describe('실제 입금·반환 시각 확인', () => {
  const issuedAt = '2026-11-26T07:26:23.000Z'; /* 16:26:23 KST */
  const invoice = { issuedAt, receivedAt: null };
  const NOW = Date.parse('2026-11-26T08:00:00.000Z');

  it('청구한 뒤 지금까지의 시각이면 통과한다 — 청구한 바로 그 초도 된다', () => {
    expect(claimFeeTimeProblem('confirm_payment', '2026-11-26T07:30:00.000Z', invoice, NOW)).toBeNull();
    expect(claimFeeTimeProblem('confirm_payment', issuedAt, invoice, NOW)).toBeNull();
    expect(claimFeeTimeProblem('confirm_payment', '2026-11-26T08:01:00.000Z', invoice, NOW)).toBeNull(); /* 서버가 1분까지 여유를 둔다 */
  });

  it('지금보다 뒤이면 시각 칸이 지금보다 뒤라고 말한다', () => {
    expect(claimFeeTimeProblem('confirm_payment', '2026-11-26T08:01:01.000Z', invoice, NOW)).toBe('실제 입금된 시각이 지금보다 뒤입니다. 지금이거나 그 이전 시각으로 적어주세요.');
    expect(claimFeeTimeProblem('refund', '2026-11-27T00:00:00.000Z', invoice, NOW)).toBe('실제 반환한 시각이 지금보다 뒤입니다. 지금이거나 그 이전 시각으로 적어주세요.');
  });

  it('청구한 시각보다 앞이면 그 시각을 보이고, 같은 분이면 한 분 뒤로 적으라고 말한다', () => {
    const early = claimFeeTimeProblem('confirm_payment', '2026-11-26T07:26:00.000Z', invoice, NOW);
    expect(early).toBe('실제 입금된 시각이 청구한 시각(2026. 11. 26. 16:26)보다 앞입니다. 청구한 뒤의 시각으로 적어주세요. 같은 분이면 한 분 뒤로 적습니다.');
    expect(claimFeeTimeProblem('refund', '2026-11-25T00:00:00.000Z', invoice, NOW)).toContain('실제 반환한 시각이 청구한 시각(');
  });

  it('반환은 입금을 확인한 시각보다 앞일 수 없다 — 입금 확인에는 적용하지 않는다', () => {
    const paid = { issuedAt, receivedAt: '2026-11-26T07:40:00.000Z' };
    expect(claimFeeTimeProblem('refund', '2026-11-26T07:30:00.000Z', paid, NOW))
      .toBe('실제 반환한 시각이 입금을 확인한 시각(2026. 11. 26. 16:40)보다 앞입니다. 입금을 확인한 뒤의 시각으로 적어주세요.');
    expect(claimFeeTimeProblem('refund', '2026-11-26T07:50:00.000Z', paid, NOW)).toBeNull();
    expect(claimFeeTimeProblem('confirm_payment', '2026-11-26T07:30:00.000Z', paid, NOW)).toBeNull();
  });

  it('비었거나 읽을 수 없는 시각, 청구 정보가 없을 때는 다루지 않는다(기존 입력 오류가 말한다)', () => {
    expect(claimFeeTimeProblem('confirm_payment', '', invoice, NOW)).toBeNull();
    expect(claimFeeTimeProblem('confirm_payment', '내일', invoice, NOW)).toBeNull();
    expect(claimFeeTimeProblem('confirm_payment', '2026-11-26T07:00:00.000Z', null, NOW)).toBeNull();
    expect(claimFeeTimeProblem('confirm_payment', '2026-11-27T07:00:00.000Z', null, NOW)).toContain('지금보다 뒤');
  });
});
