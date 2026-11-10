import { describe, expect, it } from 'vitest';
import { normalizeClaimFeeValues, parseClaimFeeDocument, parseClaimFeePolicy } from './claim-fees';
const issue = { amount: 3000, payerRole: 'buyer', customerNote: ' TEST 배송비 안내 ', evidence: ' TEST 고객 합의 ', confirmed: true };
describe('claim fee contracts', () => {
 it('requires explicit customer agreement and integral positive money', () => {
  expect(normalizeClaimFeeValues('issue', issue)).toEqual({ ...issue, customerNote: issue.customerNote.trim(), evidence: issue.evidence.trim() });
  for (const delta of [{ amount: 0 }, { amount: 3000.1 }, { amount: 1000001 }, { confirmed: false }, { evidence: '' }, { payerRole: 'arbitrary' }, { autoCharge: true }]) expect(normalizeClaimFeeValues('issue', { ...issue, ...delta })).toBeNull();
 });
 it('customer payment reports cannot submit amounts, timestamps, or confirmation evidence', () => {
  expect(normalizeClaimFeeValues('report_payment', { confirmed: true })).toEqual({ confirmed: true });
  for (const extra of [{ amount: 3000 }, { occurredAt: new Date().toISOString() }, { evidence: 'pretend verified' }]) expect(normalizeClaimFeeValues('report_payment', { confirmed: true, ...extra })).toBeNull();
  expect(normalizeClaimFeeValues('confirm_payment', { amount: 3000, occurredAt: 'not-date', evidence: 'TEST confirmed', confirmed: true })).toBeNull();
  expect(normalizeClaimFeeValues('refund', { amount: 3000, occurredAt: '2026-10-16T01:00:00Z', evidence: 'TEST bank ref', confirmed: true })).not.toBeNull();
 });
 it('rejects malformed readback and unexpected private fields', () => {
  const policy = { revision: 1, enabled: false, returnAmount: null, exchangeAmount: null, evidence: '', updatedAt: '2026-10-16T00:00:00Z', accountReady: false };
  const doc = { claimId: '00000000-0000-4000-8000-000000000001', orderId: '00000000-0000-4000-8000-000000000002', claimRevision: 0, revision: 0, claimType: 'exchange', policy, canIssue: false, invoices: [], history: [] };
  expect(parseClaimFeeDocument(doc)).toEqual(doc); expect(parseClaimFeeDocument({ ...doc, payerEmail: 'hidden' })).toBeNull();
  expect(parseClaimFeePolicy({ ...policy, returnAmount: -1 })).toBeNull(); expect(parseClaimFeeDocument({ ...doc, invoices: [{ amount: 3000 }] })).toBeNull();
 });
});
