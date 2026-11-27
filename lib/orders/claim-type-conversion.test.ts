import { expect, it } from 'vitest';
import { CLAIM_CHANGE_CONFLICT_MESSAGE, CLAIM_CHANGE_UNKNOWN_MESSAGE } from '@/lib/admin/claim-change-copy';
import {
  CLAIM_TYPE_AGREEMENT_ERROR, CLAIM_TYPE_AGREEMENT_MAX, CLAIM_TYPE_AGREEMENT_MIN, claimTypeBulkError, claimTypeConfirmMessage, claimTypeError, claimTypeInputError, claimTypeReceiptMatches,
  maskedRefundAccountNumber, normalizeClaimTypeAgreement, normalizeClaimTypeRequest, parseClaimTypeContext, parseClaimTypeHistory, parseClaimTypeReceipt,
} from './claim-type-conversion';
import { conversionContext as context, conversionRequest as request, conversionReceipt as receipt } from './claim-type-conversion.fixture';
it('전환할 유형·동의·행버전만 허용하고 금액·취소·부분계좌 입력은 거절한다', () => {
  expect(normalizeClaimTypeRequest(request)).toEqual(request);
  for (const bad of [{ toType: 'cancel' }, { confirmed: false }, { revision: -1 }, { amount: 10 }, { agreement: 'a\nvalid' }, { refundAccount: { bankName: '은행' } }]) expect(normalizeClaimTypeRequest({ ...request, ...bad })).toBeNull();
  const account = { bankName: '합성은행', accountNumber: '1234567890', accountHolder: '합성고객' };
  expect(normalizeClaimTypeRequest({ ...request, refundAccount: account })).toBeNull();
  expect(normalizeClaimTypeRequest({ ...request, toType: 'return', refundAccount: account })?.refundAccount).toEqual(account);
});
it('다른 요청·주문/클레임 이력과 본문이 다른 receipt를 확정하지 않는다', () => {
  expect(parseClaimTypeContext(context)).toEqual(context); expect(parseClaimTypeReceipt(receipt)).toEqual(receipt);
  expect(parseClaimTypeContext({ ...context, history: [{ ...receipt, claimId: receipt.orderId }] })).toBeNull();
  expect(parseClaimTypeHistory([{ ...receipt, fromType: 'exchange' }])).toBeNull();
  for (const delta of [{ revision: 3 }, { agreement: '다른 근거' }, { id: receipt.orderId }, { accountSupplied: true }]) expect(claimTypeReceiptMatches({ ...receipt, ...delta }, request)).toBe(false);
  expect(claimTypeReceiptMatches(receipt, request)).toBe(true);
});

it('고객 합의 근거는 DB와 같은 2~500자이고 화면 칸의 제한도 그 값이다', () => {
  expect([CLAIM_TYPE_AGREEMENT_MIN, CLAIM_TYPE_AGREEMENT_MAX]).toEqual([2, 500]);
  expect(normalizeClaimTypeAgreement('ㄱ'.repeat(CLAIM_TYPE_AGREEMENT_MIN))).not.toBeNull();
  expect(normalizeClaimTypeAgreement('ㄱ'.repeat(CLAIM_TYPE_AGREEMENT_MIN - 1))).toBeNull();
  expect(normalizeClaimTypeAgreement('ㄱ'.repeat(CLAIM_TYPE_AGREEMENT_MAX))).not.toBeNull();
  expect(normalizeClaimTypeAgreement('ㄱ'.repeat(CLAIM_TYPE_AGREEMENT_MAX + 1))).toBeNull();
});

it('어느 칸이 왜 안 되는지 말하고, 요청이 만들어지는 입력은 null이다', () => {
  const ok = { agreement: '전화로 합의함', toType: 'exchange' as const, bankName: '', accountNumber: '', accountHolder: '' };
  expect(claimTypeInputError(ok)).toBeNull();
  expect(claimTypeInputError({ ...ok, agreement: '합' })).toBe(CLAIM_TYPE_AGREEMENT_ERROR);
  expect(claimTypeInputError({ ...ok, agreement: '줄\n바꿈' })).toBe(CLAIM_TYPE_AGREEMENT_ERROR);
  /* 교환으로 바꿀 때는 계좌 칸을 보지 않는다. */
  expect(claimTypeInputError({ ...ok, bankName: '은행만' })).toBeNull();
  const toReturn = { ...ok, toType: 'return' as const };
  expect(claimTypeInputError(toReturn)).toBeNull();
  expect(claimTypeInputError({ ...toReturn, bankName: '합성은행' })).toContain('모두 입력');
  expect(claimTypeInputError({ ...toReturn, bankName: '합성은행', accountNumber: '12', accountHolder: '합성고객' })).toContain('8~30자');
  expect(claimTypeInputError({ ...toReturn, bankName: '합성은행', accountNumber: '1234567890', accountHolder: '합성고객' })).toBeNull();
  /* 위가 null이면 요청도 만들어진다. */
  expect(normalizeClaimTypeRequest({ ...request, toType: 'return', refundAccount: { bankName: '합성은행', accountNumber: '1234567890', accountHolder: '합성고객' } })).not.toBeNull();
});

it('바꿀 수 없는 이유를 DB가 알려 주는 코드마다 말한다(결과를 확인하지 못했다는 말로 두지 않는다)', () => {
  for (const blocker of ['claim_conversion_type_unavailable', 'claim_conversion_partial_return', 'claim_conversion_stage_unavailable', 'claim_conversion_reshipped',
    'claim_conversion_finance_started', 'claim_conversion_same_type', 'claim_conversion_account_required', 'digital_exchange_unavailable', 'invalid_claim_conversion_account']) {
    const text = claimTypeError(undefined, blocker);
    expect(text, blocker).not.toBe(CLAIM_CHANGE_UNKNOWN_MESSAGE);
    expect(text, blocker).not.toMatch(/같은 요청|환급|해당|확인했습니다|합의 확인에 체크/);
  }
  expect(claimTypeError(undefined, 'claim_conversion_partial_return')).toContain('일부 상품만 반품하는 요청');
  expect(claimTypeError(undefined, 'digital_exchange_unavailable')).toContain('디지털 파일');
  expect(claimTypeError('PT409')).toBe(CLAIM_CHANGE_CONFLICT_MESSAGE);
  expect(claimTypeError(undefined, 'something_else')).toBe(CLAIM_CHANGE_UNKNOWN_MESSAGE);
  expect(claimTypeBulkError('PT409')).toContain('다른 사람이 먼저 바꿨습니다.');
  expect(claimTypeBulkError(undefined, 'claim_conversion_account_required')).toContain('요청번호를 눌러 상세에서 입력해 주세요.');
  expect(claimTypeBulkError('57014', 'statement timeout')).toContain('저장됐는지 확인하지 못했습니다.');
});

it('반품→교환 확인창은 그대로인 것·달라지는 것·고객 알림·되돌릴 수 있는 범위를 말한다', () => {
  const message = claimTypeConfirmMessage(context, { toType: 'exchange', refundAccount: null }, '수거중');
  expect(message).toContain('고객과 합의한 대로 반품 요청을 교환 요청으로 바꿉니다. (지금 단계: 수거중)');
  expect(message).toContain('접수일과 회수 기록은 그대로입니다'); expect(message).toContain('회수 생략을 결정한 출고지');
  expect(message).toContain('환불 대신 교환품 재출고로 마무리합니다'); expect(message).toContain('입고가 확인되면 교환품 제작이 열립니다');
  expect(message).toContain('배송비 청구가 있으면 취소됩니다(입금이 확인된 청구는 돌려줄 금액으로 바뀝니다)');
  expect(message).toContain('저장해 둔 품목별 재고 처리(반품의 불량 선택, 교환 출고지의 회수품 재고 처리)가 있으면 지워지니 교환에서 다시 고릅니다');
  expect(message).toContain('고객에게 앱 알림이 갑니다. 환불·재출고를 시작하기 전에는 다시 바꿀 수 있지만, 이미 간 알림과 취소된 배송비 청구는 돌아오지 않습니다.');
  expect(message).not.toContain('환불계좌');
  /* 교환으로 바꿀 때 저장된 환불계좌는 30일 뒤 지워진다. */
  const withAccount = { ...context, savedAccount: { account: '신한 ***1234', holder: '홍*동' } };
  expect(claimTypeConfirmMessage(withAccount, { toType: 'exchange', refundAccount: null }, '수거중')).toContain('저장된 환불계좌는 교환에서 쓰지 않아 30일 뒤 지워집니다');
});

it('교환→반품 확인창은 환불로 마무리하고 제작 취소·환불계좌를 말한다', () => {
  const exchange = { ...context, claimType: 'exchange' as const };
  const message = claimTypeConfirmMessage(exchange, { toType: 'return', refundAccount: null }, '입고완료');
  expect(message).toContain('교환 요청을 반품 요청으로 바꿉니다. (지금 단계: 입고완료)');
  expect(message).toContain('교환품 재출고 대신 환불로 마무리합니다. 환불은 승인·회수 확인 뒤에 따로 처리하고, 열려 있던 교환품 제작은 취소됩니다.');
  expect(message).toContain('가 있으면 지워지니 반품에서 다시 고릅니다');
  expect(message).not.toContain('환불계좌');
  const account = { bankName: '합성은행', accountNumber: '1234567890', accountHolder: '합성고객' };
  /* 적은 계좌는 은행·가린 계좌번호(끝 4자리만)·예금주로 되읽는다 — 전체 번호는 확인창에 싣지 않는다. */
  const withNew = claimTypeConfirmMessage(exchange, { toType: 'return', refundAccount: account }, '수거중');
  expect(withNew).toContain('· 환불계좌는 방금 적은 계좌(합성은행 ******7890 · 합성고객)로 저장됩니다.');
  expect(withNew).not.toContain('1234567890');
  expect(claimTypeConfirmMessage(exchange, { toType: 'return', refundAccount: { ...account, accountNumber: '110-123-456789' } }, '수거중')).toContain('(합성은행 ********6789 · 합성고객)');
  expect(claimTypeConfirmMessage({ ...exchange, savedAccount: { account: '신한 ***1234', holder: '홍*동' } }, { toType: 'return', refundAccount: null }, '수거중'))
    .toContain('환불계좌는 저장된 계좌(신한 ***1234 · 홍*동)를 씁니다.');
});
it('확인창이 되읽는 계좌번호는 끝 4자리만 보이고 하이픈은 뺀다', () => {
  expect(maskedRefundAccountNumber('1234567890')).toBe('******7890');
  expect(maskedRefundAccountNumber('110-123-456789')).toBe('********6789');
  expect(maskedRefundAccountNumber('12345678')).toBe('****5678');
  expect(maskedRefundAccountNumber('1234')).toBe('1234'); expect(maskedRefundAccountNumber('')).toBe('');
});
