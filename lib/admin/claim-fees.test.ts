import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adminClaimFeeErrorCopy, claimFeeActionConfirm, claimFeePolicyChangedMessage, claimFeePolicyConfirmMessage, claimFeePolicyFailure, claimFeePolicyReadback, claimFeePolicySummary,
  claimFeePolicyValues, parseClaimFeePolicyAmount, sameClaimFeePolicyValues,
} from './claim-fees';
import { claimFeeError } from '@/lib/orders/claim-fees';

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
      '저장하면 바로 적용됩니다.', '이미 접수돼 진행 중인 반품·교환 요청에도 요청 상세에서 [새 배송비 청구]를 쓸 수 있게 됩니다(환불 금액에서 반품배송비를 빼기로 한 반품은 제외). 자동으로 청구되지는 않습니다.',
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
