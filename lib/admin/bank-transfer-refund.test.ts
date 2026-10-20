import { describe, expect, it } from 'vitest';
import { BANK_REFUND_KINDS, bankRefundError, bankRefundMetadata, bankRefundReceiptMatches, bankRefundRecoveryKey,
  normalizeBankRefundRequest, parseBankRefundAccountView, parseBankRefundContext, parseBankRefundReceipt, parseBankRefundRecovery,
  type BankRefundContext, type BankRefundRequest, type BankRefundReceipt } from './bank-transfer-refund';

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
