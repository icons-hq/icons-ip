import { describe, expect, it } from 'vitest';
import { BANK_REFUND_FIELDS, BANK_REFUND_KINDS, BANK_REFUND_LABELS, bankRefundConfirm, bankRefundError, bankRefundFields, bankRefundMetadata, bankRefundNotBefore, bankRefundOccurredAt,
  bankRefundReceiptMatches, bankRefundRecordedMessage, bankRefundRecoveryKey, bankRefundSteps, bankRefundTimeInputMin,
  bankRefundTransferAmount, bankRefundWithoutTransfer, normalizeBankRefundRequest, parseBankRefundAccountView, parseBankRefundContext, parseBankRefundReceipt, parseBankRefundRecovery,
  type BankRefundContext, type BankRefundRequest, type BankRefundReceipt } from './bank-transfer-refund';
import { SAVE_UNKNOWN_MESSAGE } from './goods-template-save';

const identity = { actorId: 'b1900000-0000-4000-8000-000000000001', sessionId: 'b1900000-0000-4000-8000-000000000002',
  orderId: 'b1900000-0000-4000-8000-000000000003', claimId: 'b1900000-0000-4000-8000-000000000004' };
const other = 'b1900000-0000-4000-8000-000000000099';
const request: BankRefundRequest = { ...identity, version: 1, operationId: 'b1900000-0000-4000-8000-000000000005',
  revision: 7, amount: 12000, kind: 'complete_transfer', occurredAt: '2026-10-14T06:00:00.000Z', evidence: '합성 송금 증빙', note: '합성 운영 메모', confirmed: true };
const receipt: BankRefundReceipt = { operationId: request.operationId, actorId: identity.actorId, orderId: identity.orderId, claimId: identity.claimId,
  kind: request.kind, revision: 7, resultRevision: 8, amount: 12000, state: 'recorded', createdAt: request.occurredAt };
const context: BankRefundContext = { actorId: identity.actorId, orderId: identity.orderId, claimId: identity.claimId, claimType: 'return', revision: 7,
  amount: 12000, stage: 'processing', phase: 'awaiting_transfer', gift: true, filedAt: request.occurredAt, confirmedAt: request.occurredAt, transferredAt: null,
  confirmationNotBefore: request.occurredAt, transferNotBefore: request.occurredAt, maskedAccount: '123-****-789', maskedHolder: '김*성',
  confirmBlocker: 'bank_refund_already_confirmed', fileBlocker: 'bank_refund_already_filed', completeBlocker: null, viewBlocker: null };
const account = { viewId: other, actorId: identity.actorId, orderId: identity.orderId, claimId: identity.claimId, revision: 7,
  bankName: '합성은행', accountNumber: '123-4567-890', accountHolder: '합성예금주', viewedAt: request.occurredAt };

describe('bank refund metadata and request contract', () => {
  it('persists nine bounded operation fields without time, evidence, memo or account', () => {
    const recovery = bankRefundMetadata(request);
    expect(Object.keys(recovery).sort()).toEqual(['version', 'actorId', 'sessionId', 'orderId', 'claimId', 'operationId', 'revision', 'amount', 'kind'].sort());
    expect(parseBankRefundRecovery(recovery, identity)).toEqual(recovery);
    expect(JSON.stringify(recovery)).not.toContain(request.evidence);
    expect(JSON.stringify(recovery)).not.toContain(request.note);
    for (const [key, value] of Object.entries({ evidence: request.evidence, note: request.note, occurredAt: request.occurredAt, account, accountNumber: account.accountNumber, requestHash: 'secret' })) {
      expect(parseBankRefundRecovery({ ...recovery, [key]: value })).toBeNull();
    }
  });
  it.each(['actorId', 'sessionId', 'orderId', 'claimId'] as const)('separates %s in both recovery identity and storage key', key => {
    const changed = { ...identity, [key]: other };
    expect(parseBankRefundRecovery(bankRefundMetadata(request), changed)).toBeNull();
    expect(bankRefundRecoveryKey(changed)).not.toBe(bankRefundRecoveryKey(identity));
  });
  it.each(BANK_REFUND_KINDS)('accepts the exact %s request and normalizes its instant', kind => {
    expect(normalizeBankRefundRequest({ ...request, kind, occurredAt: '2026-10-14T15:00:00+09:00' })).toEqual({ ...request, kind });
  });
  it.each([{ confirmed: false }, { confirmed: 'true' }, { evidence: '' }, { evidence: ' ' }, { evidence: ' leading' },
    { note: 'trailing ' }, { evidence: 'ok\nsecret' }, { note: 'ok\u0000secret' }, { evidence: '문'.repeat(301) },
    { amount: 0 }, { amount: -1 }, { amount: Number.MAX_SAFE_INTEGER + 1 }, { revision: -1 }, { revision: 1.5 },
    { operationId: '../wrong' }, { occurredAt: '2026-02-30T00:00:00Z' }, { kind: 'provider_cancel' }, { extra: true }])('rejects invalid request %j', patch => {
    expect(normalizeBankRefundRequest({ ...request, ...patch })).toBeNull();
  });
  it('counts evidence by Unicode code point like PostgreSQL char_length', () => {
    expect(normalizeBankRefundRequest({ ...request, evidence: '😀'.repeat(300) })).not.toBeNull();
    expect(normalizeBankRefundRequest({ ...request, evidence: '😀'.repeat(301) })).toBeNull();
  });
});

describe('bank refund response boundaries', () => {
  it('accepts separately projected context, receipt and audited raw view', () => {
    expect(parseBankRefundContext(context)).toEqual(context);
    expect(parseBankRefundReceipt(receipt)).toEqual(receipt);
    expect(parseBankRefundAccountView(account)).toEqual(account);
    expect(bankRefundReceiptMatches(receipt, bankRefundMetadata(request))).toBe(true);
  });
  it.each(['accountNumber', 'accountHolder', 'bankName', 'account', 'evidence', 'sessionId', 'requestHash'])('rejects extra %s in context and receipt', key => {
    expect(parseBankRefundContext({ ...context, [key]: 'sensitive' })).toBeNull();
    expect(parseBankRefundReceipt({ ...receipt, [key]: 'sensitive' })).toBeNull();
  });
  it.each(['operationId', 'actorId', 'orderId', 'claimId', 'kind', 'revision', 'amount'] as const)('binds receipt %s to the submitted operation', key => {
    const value = key === 'amount' || key === 'revision' ? 99 : key === 'kind' ? 'file_transfer' : other;
    expect(bankRefundReceiptMatches({ ...receipt, [key]: value }, bankRefundMetadata(request))).toBe(false);
  });
  it('distinguishes a recorded revision advance from a sealed no-write receipt', () => {
    expect(parseBankRefundReceipt({ ...receipt, resultRevision: 7 })).toBeNull();
    expect(parseBankRefundReceipt({ ...receipt, state: 'sealed', resultRevision: 7 })).not.toBeNull();
    expect(parseBankRefundReceipt({ ...receipt, state: 'sealed', resultRevision: 8 })).toBeNull();
    expect(parseBankRefundReceipt({ ...receipt, state: 'recorded', resultRevision: 6 })).toBeNull();
  });
  it.each([{ accountNumber: '--------' }, { accountNumber: '123' }, { accountHolder: '' }, { bankName: '' },
    { accountHolder: '가'.repeat(41) }, { revision: -1 }, { viewedAt: 'not-a-date' }, { viewId: 'wrong' }, { sessionId: identity.sessionId }])('rejects malformed audited account %j', patch => {
    expect(parseBankRefundAccountView({ ...account, ...patch })).toBeNull();
  });
  it.each([{ gift: 'true' }, { phase: 'done' }, { stage: 'unknown' }, { amount: -1 }, { revision: '7' }, { filedAt: '2026-02-30T00:00:00Z' }])('rejects malformed context %j', patch => {
    expect(parseBankRefundContext({ ...context, ...patch })).toBeNull();
  });
  it('accepts the optional partial refund field and derives the transfer amount from it (원장 재작업 후속 2)', () => {
    const remaining = { ...context, partialRefund: { refundedAmount: 9500, refundAmount: 2500 } };
    expect(parseBankRefundContext(remaining)).toEqual(remaining);
    expect(bankRefundTransferAmount(parseBankRefundContext(remaining)!)).toBe(2500);
    expect(bankRefundWithoutTransfer(parseBankRefundContext(remaining)!)).toBe(false);
    const zero = { ...context, phase: 'not_confirmed' as const, partialRefund: { refundedAmount: 12000, refundAmount: 0 } };
    expect(bankRefundTransferAmount(parseBankRefundContext(zero)!)).toBe(0);
    expect(bankRefundWithoutTransfer(parseBankRefundContext(zero)!)).toBe(true);
    // 부분 취소가 없으면 지금처럼 주문 금액 전액이다.
    expect(bankRefundTransferAmount(context)).toBe(12000);
    expect(bankRefundWithoutTransfer(context)).toBe(false);
  });
  it.each([{ refundedAmount: 0, refundAmount: 0 }, { refundedAmount: 100, refundAmount: -1 }, { refundedAmount: '100', refundAmount: 0 },
    { refundedAmount: 100 }, { refundedAmount: 100, refundAmount: 0, accountNumber: '123' }, null])('rejects malformed partial refund %j', partialRefund => {
    expect(parseBankRefundContext({ ...context, partialRefund })).toBeNull();
  });
  it('maps authority and conflict without copying untrusted database messages', () => {
    expect(bankRefundError('42501', account.accountNumber)).toMatchObject({ authChanged: true });
    expect(bankRefundError('PT409', request.evidence)).toMatchObject({ conflict: true });
    expect(bankRefundError('23505', 'bank_refund_request_conflict')).toMatchObject({ uncertain: true });
    const result = bankRefundError('XX000', `${account.accountNumber} ${account.accountHolder} ${request.evidence}`);
    expect(result).toMatchObject({ uncertain: true });
    expect(JSON.stringify(result)).not.toContain(account.accountNumber);
  });
  it.each(['__proto__', 'constructor', 'toString'])('treats prototype key %s as an unknown error', message => {
    const result = bankRefundError('XX000', message);
    expect(typeof result.error).toBe('string');
    expect(result.uncertain).toBe(true);
  });
});

/* 화면 규칙 PR 3(D-30~D-33): 확인 체크를 없애고 확인창·순서 표시·칸 이름이 그 말을 한다. 금액·단계 판정은 그대로다. */
describe('무통장 환불 화면의 말', () => {
  const cancel: BankRefundContext = { ...context, claimType: 'cancel', gift: false, stage: 'processing', phase: 'not_confirmed', confirmedAt: null, filedAt: null,
    confirmBlocker: null, fileBlocker: 'bank_refund_confirmation_required', completeBlocker: 'bank_refund_confirmation_required', viewBlocker: 'bank_refund_confirmation_required' };
  const at = '2026-10-14T06:03:25.456Z';
  it('시각 칸 이름은 단계마다 다르고 모두 (KST)로 끝난다', () => {
    expect(BANK_REFUND_KINDS.map(kind => BANK_REFUND_FIELDS[kind].time)).toEqual(['취소 확정 시각 (KST)', '접수 시각 (KST)', '송금한 시각 (KST)']);
    expect(BANK_REFUND_LABELS).toEqual({ confirm_cancellation: '취소 확정 · 재고 복원', file_transfer: '환불 접수 기록', complete_transfer: '송금 완료 기록' });
    for (const kind of BANK_REFUND_KINDS) expect(BANK_REFUND_FIELDS[kind].kept).toContain('기록으로만 남');
    /* 메모가 환불 기록에 보이는 단계(접수·완료, 잔액 0원 취소 확정)는 칸 이름이 '환불 메모'다. */
    expect(BANK_REFUND_KINDS.map(kind => bankRefundFields(kind, cancel).note)).toEqual(['메모', '환불 메모', '환불 메모']);
    const zero = bankRefundFields('confirm_cancellation', { ...cancel, partialRefund: { refundedAmount: 12000, refundAmount: 0 } });
    expect(zero).toMatchObject({ note: '환불 메모', evidence: '취소 확정 근거', kept: '환불 메모는 요청 상세의 환불 기록에 보입니다. 취소 확정 근거는 기록으로만 남습니다.' });
  });
  it('지금은 누른 시각 그대로이고, 직접 적은 분이 앞 단계와 같은 분이면 앞 단계 바로 뒤로 맞춘다', () => {
    const notBefore = '2026-10-14T06:03:20.123456+00:00', now = new Date(at);
    expect(bankRefundOccurredAt({ custom: null, now, notBefore })).toBe(at);
    /* PC 시계가 늦어 누른 시각이 앞 단계보다 이르면 앞 단계 바로 뒤(1ms)다. */
    expect(bankRefundOccurredAt({ custom: null, now: new Date('2026-10-14T06:03:19.000Z'), notBefore })).toBe('2026-10-14T06:03:20.124Z');
    expect(bankRefundOccurredAt({ custom: null, now, notBefore: null })).toBe(at);
    const minute = (iso: string) => { const ms = Date.parse(iso); return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
    expect(bankRefundOccurredAt({ custom: minute('2026-10-14T06:03:00Z'), now, notBefore })).toBe('2026-10-14T06:03:20.124Z');
    expect(bankRefundOccurredAt({ custom: minute('2026-10-14T06:10:00Z'), now, notBefore })).toBe('2026-10-14T06:10:00.000Z');
    /* 앞 단계보다 1분 넘게 이른 시각은 고치지 않는다 — 서버가 거절하고 화면이 고칠 방법을 말한다. */
    expect(bankRefundOccurredAt({ custom: minute('2026-10-14T06:01:00Z'), now, notBefore })).toBe('2026-10-14T06:01:00.000Z');
    expect(bankRefundOccurredAt({ custom: '', now, notBefore })).toBeNull();
    expect(bankRefundTimeInputMin(notBefore)).toBe(minute('2026-10-14T06:03:00Z'));
    expect(bankRefundTimeInputMin(null)).toBeUndefined();
    expect(bankRefundNotBefore({ ...context, transferNotBefore: 'b', confirmationNotBefore: 'a' }, 'complete_transfer')).toBe('b');
    expect(bankRefundNotBefore({ ...context, transferNotBefore: 'b', confirmationNotBefore: 'a' }, 'file_transfer')).toBe('a');
  });
  it('순서는 취소가 취소 확정부터, 반품이 환불 접수부터이고 잔액 0원 취소는 한 단계다', () => {
    expect(bankRefundSteps(cancel, 'confirm_cancellation').map(step => [step.kind, step.state])).toEqual([
      ['confirm_cancellation', 'current'], ['file_transfer', 'waiting'], ['complete_transfer', 'waiting']]);
    expect(bankRefundSteps(context, 'complete_transfer').map(step => [step.kind, step.state, step.at])).toEqual([
      ['file_transfer', 'done', context.filedAt], ['confirm_cancellation', 'done', context.confirmedAt], ['complete_transfer', 'current', null]]);
    expect(bankRefundSteps({ ...cancel, partialRefund: { refundedAmount: 12000, refundAmount: 0 } }, 'confirm_cancellation').map(step => step.kind)).toEqual(['confirm_cancellation']);
    expect(bankRefundSteps({ ...context, phase: 'completed', transferredAt: at }, null).every(step => step.state === 'done')).toBe(true);
  });
  it('취소 확정 확인창은 금액·가린 계좌와 재고 복원·되돌릴 수 없음을 말한다', () => {
    const asked = bankRefundConfirm(cancel, 'confirm_cancellation', at);
    expect(asked).toMatchObject({ title: '취소를 확정할까요?', confirmLabel: '취소 확정', cancelLabel: '돌아가기', destructive: true });
    for (const part of ['송금할 금액: 12,000원', '받는 계좌: 123-****-789 (예금주 김*성)', '취소 확정 시각: 2026. 10. 14. 15:03', '주문이 취소되고 재고가 복원됩니다. 되돌릴 수 없습니다.', '환불 송금 대기에 남습니다']) expect(asked.message, part).toContain(part);
    expect(asked.message).not.toContain('선물');
  });
  it('환불 접수 확인창은 고객 알림과, 반품이면 차감 금액 확정·거부 불가를 말한다', () => {
    const plan = { source: 'plan', state: 'planned', applicable: true, reason: null, oneWayAmount: 3000, basis: 'one_way', initialShippingFee: 3000,
      deductionAmount: 3000, paymentId: null, provider: 'bank_transfer', paymentAmount: 12000, refundAmount: 9000, decidedAt: null, appliedAt: null };
    const returned = parseBankRefundContext({ ...context, stage: 'collected', phase: 'not_confirmed', confirmedAt: null, filedAt: null, fileBlocker: null, refundDeduction: plan });
    expect(returned).not.toBeNull();
    const asked = bankRefundConfirm(returned!, 'file_transfer', at);
    expect(asked.destructive).toBeUndefined(); expect(asked).toMatchObject({ title: '환불 접수를 기록할까요?', confirmLabel: '환불 접수 기록' });
    for (const part of ['송금할 금액: 9,000원 (결제 12,000원 − 반품배송비 3,000원)', "고객에게 '환불 접수가 완료됐어요' 알림이 갑니다. 돈은 아직 보내지 않습니다.", '반품배송비를 뺀 금액이 지금 정해집니다.',
      '접수한 뒤에는 이 요청을 거부할 수 없습니다.', '결제한 분에게 환불합니다']) expect(asked.message, part).toContain(part);
    const canceled = bankRefundConfirm({ ...cancel, phase: 'awaiting_transfer' }, 'file_transfer', at).message;
    expect(canceled).not.toContain('거부할 수 없습니다'); expect(canceled).not.toContain('반품배송비');
  });
  it('송금 완료 확인창은 이 버튼이 돈을 보내지 않는다는 것과 고객 알림을 말한다', () => {
    const asked = bankRefundConfirm(context, 'complete_transfer', at);
    expect(asked).toMatchObject({ title: '송금을 마쳤다고 기록할까요?', confirmLabel: '송금 완료 기록', destructive: true });
    for (const part of ['보낸 금액: 12,000원', '송금한 시각: 2026. 10. 14. 15:03', '이 버튼은 돈을 보내지 않고 기록만 남깁니다.', "'환불이 완료됐어요' 알림이 갑니다. 되돌릴 수 없습니다."]) expect(asked.message, part).toContain(part);
  });
  it('기록한 뒤 한 줄은 다음에 누를 버튼을 말한다', () => {
    expect(bankRefundRecordedMessage('confirm_cancellation', cancel)).toBe('취소를 확정하고 재고를 복원했습니다. 다음은 [환불 접수 기록]입니다.');
    expect(bankRefundRecordedMessage('file_transfer', cancel)).toBe('환불 접수를 기록했습니다. 은행에서 송금한 뒤 [송금 완료 기록]을 남겨주세요.');
    expect(bankRefundRecordedMessage('file_transfer', context)).toBe('환불 접수를 기록했습니다. 다음은 [취소 확정 · 재고 복원]입니다.');
    expect(bankRefundRecordedMessage('complete_transfer', null)).toBe('송금 완료를 기록했습니다. 환불이 끝났습니다.');
  });
  it('오류 문구는 화면에 있는 버튼 이름으로 다음 할 일을 말하고, 모르는 결과는 공용 문장을 쓴다', () => {
    expect(bankRefundError('XX000').error).toBe(SAVE_UNKNOWN_MESSAGE);
    expect(bankRefundError('PT409').error).toContain('[최신 환불 상태 확인]');
    expect(bankRefundError('23514', 'bank_refund_occurred_at_invalid').error).toContain('[다른 시각 적기]');
    expect(bankRefundError('23514', 'bank_refund_filing_required').error).toBe('먼저 [환불 접수 기록]을 남겨주세요.');
    expect(bankRefundError('23514', 'claim_refund_account_missing').error).toContain('환불계좌를 등록해 달라고 안내해주세요');
    expect(bankRefundError('22023', 'invalid_bank_refund_operation').error).not.toContain('체크');
  });
});
