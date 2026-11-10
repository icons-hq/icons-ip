import { claimContactError, type ClaimContactContracts } from './contracts';

export const CLAIM_CONTACT_FIXTURE_IDS = {
  actor: '10000000-0000-4000-8000-000000000001', session: '10000000-0000-4000-8000-000000000002',
  order: '10000000-0000-4000-8000-000000000003', claim: '10000000-0000-4000-8000-000000000004',
  operation: '10000000-0000-4000-8000-000000000005', request: '10000000-0000-4000-8000-000000000006',
  plan: '10000000-0000-4000-8000-000000000007', pii: '10000000-0000-4000-8000-000000000008',
  item: '10000000-0000-4000-8000-000000000009', variant: '10000000-0000-4000-8000-00000000000a',
} as const;
const ids = CLAIM_CONTACT_FIXTURE_IDS;
const at = '2026-10-14T00:00:00.000Z';

/** Synthetic values only. Each call owns its mutable fixture graph. */
export function claimContactContractFixtures(): ClaimContactContracts {
  const address: ClaimContactContracts['Address'] = { recipientName: '테스트 수령인', phone: '01012345678', postalCode: ' 01234 ', address1: ' 서울시 테스트로 1 ', address2: '' };
  const field: ClaimContactContracts['EncryptedField'] = { v: 1, kid: 'local-test', iv: 'AAAAAAAAAAAAAAAA', tag: 'AAAAAAAAAAAAAAAAAAAAAA', ct: 'AQ' };
  const encrypted = { recipientName: { ...field }, phone: { ...field }, postalCode: { ...field }, address1: { ...field }, address2: { ...field, ct: '' } };
  const source: ClaimContactContracts['SourceBinding'] = { sourceKind: 'order_delivery', sourceId: ids.order, sourceRevision: '0', sourceFingerprint: 'a'.repeat(64), planRevision: 0, piiVersion: null };
  const scope: ClaimContactContracts['RequestScope'] = { requestId: ids.request, orderId: ids.order, claimId: ids.claim, target: 'collection' };
  const receipt: ClaimContactContracts['OperationReceipt'] = { operationId: ids.operation, command: 'change', orderId: ids.order, claimId: ids.claim, target: 'collection', actorId: ids.actor, sessionId: ids.session, expectedClaimType: 'exchange', expectedClaimRevision: 3, resultClaimRevision: 4, state: 'saved', changedFields: ['recipientName'], recordedAt: at, piiState: 'retained' };
  const plan: ClaimContactContracts['SealedPlan'] = { planId: ids.plan, piiVersion: ids.pii, keyVersion: field.kid, addressHmac: 'b'.repeat(64), addressHmacKeyVersion: field.kid, address: encrypted };
  const sealedHistory: ClaimContactContracts['SealedHistory'] = { piiVersion: ids.pii, keyVersion: field.kid, before: encrypted, after: encrypted, agreement: field };
  const current: ClaimContactContracts['TargetView'] = { target: 'collection', piiState: 'available', sourceKind: 'order_delivery', referenceOnly: true, address, unavailableReason: null };
  const dbCurrent: ClaimContactContracts['DbTargetView'] = { target: 'collection', piiState: 'available', source, referenceOnly: true, sourceAddress: address, plan: null, unavailableReason: null };
  const destination: ClaimContactContracts['SealedDestination'] = { piiVersion: ids.pii, keyVersion: field.kid, address: encrypted, addressHmac: 'b'.repeat(64), addressHmacKeyVersion: field.kid, sourceKind: source.sourceKind, sourceId: source.sourceId, sourceRevision: source.sourceRevision, sourcePlanRevision: 0, sourcePiiVersion: null };
  const history: ClaimContactContracts['HistoryEntry'] = { operationId: ids.operation, target: 'collection', changedFields: ['recipientName'], recordedAt: at, resultClaimRevision: 4, piiState: 'available', before: address, after: { ...address, recipientName: '변경 수령인' }, agreement: '고객 확인 완료', actorId: ids.actor, unavailableReason: null };
  const ciphertext: ClaimContactContracts['DbHistoryCiphertext'] = { recordId: ids.operation, ...sealedHistory };
  const dbHistory: ClaimContactContracts['DbHistoryEntry'] = { operationId: ids.operation, target: 'collection', changedFields: ['recipientName'], recordedAt: at, resultClaimRevision: 4, piiState: 'available', actorId: ids.actor, ciphertext, unavailableReason: null };
  const dbDestination: ClaimContactContracts['DbReshipmentDestinationView'] = { source: 'v2_confirmed', operationId: ids.operation, recordedAt: at, piiState: 'available', destination, unavailableReason: null };
  const contactCounts: ClaimContactContracts['ContactDataCounts'] = { plans: 1, operations: 1, destinations: 1, addressEnvelopes: 4, agreementEnvelopes: 1, requestHmacs: 1, addressHmacs: 2, operatorReferences: 0 };
  const retentionScope: ClaimContactContracts['RetentionScope'] = { orderId: ids.order, claimId: ids.claim, subjectKind: 'buyer', state: 'not_due', purposeEndedAt: '2026-10-01T00:00:00Z', basePurgeAt: '2026-10-31T00:00:00Z', effectivePurgeAt: '2026-10-31T00:00:00Z', activeHoldCount: 0, expiredHoldCount: 0, remaining: contactCounts };
  const caseCommand: ClaimContactContracts['RetentionCaseCommand'] = { action: 'hold', caseRef: 'CASE/2026-01', approvalRef: 'APPROVAL/2026-01', legalBasis: 'dispute_resolution', retainUntil: '2026-11-01T00:00:00Z', occurredAt: at };
  const remaining: ClaimContactContracts['PurgeRemainingCounts'] = { eligibleScopes: 1, heldScopes: 2, notDueScopes: 3, operationallyBlockedScopes: 4, piiFields: 50, operatorReferences: 1 };
  return {
    Uuid: ids.order, Instant: at, Revision: 0, ClaimRevision: 0, KeyVersion: field.kid, Digest: 'a'.repeat(64), Target: 'collection', ClaimType: 'exchange', Command: 'change', ChangedField: 'recipientName',
    Address: address, ContactEdit: { recipientName: address.recipientName, phone: address.phone, address2: address.address2 }, EncryptedField: field, EncryptedAddress: encrypted, SourceBinding: source,
    ContextClaims: { v: 1, purpose: 'claim-contact/change-context', environment: 'local', backendOrigin: 'http://127.0.0.1:54321', actorId: ids.actor, sessionId: ids.session, orderId: ids.order, claimId: ids.claim, target: 'collection', expectedClaimType: 'exchange', expectedClaimRevision: 3, source, addressHmac: 'a'.repeat(64), addressHmacKeyVersion: field.kid, issuedAt: at, expiresAt: '2026-10-14T00:10:00.000Z', signingKeyVersion: field.kid },
    SignedContext: 'cc1.AQ.AQ', RequestScope: scope, ContextRequest: { ...scope, command: 'change' },
    ChangeRequest: { ...scope, operationId: ids.operation, signedContext: 'cc1.AQ.AQ', contact: { recipientName: address.recipientName, phone: address.phone, address2: '' }, agreement: '고객 확인 완료', customerConfirmed: true, handoffNotStartedConfirmed: true },
    ReshipmentItem: { orderItemId: ids.item, variantId: ids.variant },
    ReshipmentRequest: { requestId: ids.request, orderId: ids.order, claimId: ids.claim, operationId: ids.operation, signedContext: 'cc1.AQ.AQ', carrier: '테스트택배', trackingNumber: 'AB12345678', items: [{ orderItemId: ids.item, variantId: ids.variant }], destinationConfirmed: true, dispatchConfirmed: true },
    OperationRequest: { ...scope, operationId: ids.operation, command: 'change', expectedClaimType: 'exchange', expectedClaimRevision: 3, sealIfAbsent: false }, OperationReceipt: receipt,
    ContextResponse: { ...scope, actorId: ids.actor, sessionId: ids.session, claimType: 'exchange', claimRevision: 3, allowed: true, blocker: null, sourceKind: 'order_delivery', referenceOnly: true, piiState: 'available', address, signedContext: 'cc1.AQ.AQ', expiresAt: '2026-10-14T00:10:00.000Z', command: 'change', unavailableReason: null },
    OperationResponse: { requestId: ids.request, actorId: ids.actor, sessionId: ids.session, receipt }, SealedPlan: plan, SealedHistory: sealedHistory,
    SealedChange: { effect: 'change', changedFields: ['recipientName'], beforeAddressHmac: 'a'.repeat(64), afterAddressHmac: 'b'.repeat(64), addressHmacKeyVersion: field.kid, plan, history: sealedHistory }, SealedDestination: destination,
    HistoryRequest: { requestId: ids.request, orderId: ids.order, claimId: ids.claim, limit: 20, cursor: { operationId: ids.operation, recordedAt: at } }, HistoryEntry: history,
    HistoryResponse: { requestId: ids.request, viewerId: ids.actor, sessionId: ids.session, orderId: ids.order, claimId: ids.claim, viewerKind: 'operator', piiAccess: true, current: { collection: current, reshipment: { ...current, target: 'reshipment' } }, entries: [history], nextCursor: { operationId: ids.operation, recordedAt: at }, reshipmentDestination: { source: 'v2_confirmed', operationId: ids.operation, recordedAt: at, piiState: 'available', address, unavailableReason: null } },
    ErrorResponse: claimContactError('claim_contact_outcome_unknown', ids.request), DbExpectedContext: { ...source, addressHmac: 'a'.repeat(64), addressHmacKeyVersion: field.kid }, TargetView: current, DbTargetView: dbCurrent,
    DbContactContext: { orderId: ids.order, claimId: ids.claim, target: 'collection', command: 'change', claimType: 'exchange', claimRevision: 3, allowed: true, blocker: null, current: dbCurrent }, DbOperationRecovery: { receipt, hmacKeyVersion: field.kid }, DbHistoryCiphertext: ciphertext, DbHistoryEntry: dbHistory, DbReshipmentDestinationView: dbDestination,
    DbContactHistory: { viewerId: ids.actor, sessionId: ids.session, orderId: ids.order, claimId: ids.claim, viewerKind: 'operator', piiAccess: true, current: { collection: dbCurrent, reshipment: { ...dbCurrent, target: 'reshipment' } }, entries: [dbHistory], nextCursor: { operationId: ids.operation, recordedAt: at }, reshipmentDestination: dbDestination },
    RetentionCaseCommand: caseCommand, NonnegativeCount: 0, OpaqueReference: caseCommand.caseRef, LegalBasis: caseCommand.legalBasis, RetentionCaseState: 'held',
    RetentionCaseReceipt: { operationId: ids.operation, orderId: ids.order, claimId: ids.claim, actorId: ids.actor, sessionId: ids.session, caseRef: caseCommand.caseRef, action: 'hold', legalBasis: caseCommand.legalBasis, expectedRevision: 0, resultRevision: 1, state: 'held', retainUntil: caseCommand.retainUntil, caseClosedAt: null, releasedAt: null, occurredAt: at, recordedAt: at },
    ContactDataCounts: contactCounts, RetentionScope: retentionScope,
    ContactDataInventory: { subjectId: ids.actor, actorId: ids.actor, sessionId: ids.session, recordedAt: at, scopes: [retentionScope], nextClaimId: ids.claim, operatorReferenceCount: 1 }, PurgeRemainingCounts: remaining,
    ContactPurgeReceipt: { operationId: ids.operation, subjectId: ids.actor, actorId: ids.actor, sessionId: ids.session, cutoff: at, limit: 1, recordedAt: at, purgedClaimIds: [ids.claim], purgedTargetCount: 2, removed: { ...contactCounts, operatorReferences: 0 }, selectedResidualPiiFields: 0, remaining },
  };
}
