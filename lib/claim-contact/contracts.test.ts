import { describe, expect, it } from 'vitest';
import {
  CLAIM_CONTACT_ERRORS, claimContactDatabaseError, claimContactError, claimContactErrorStatus,
  isClaimContactText, normalizeClaimContactAddress, normalizeClaimContactChangeRequest,
  normalizeClaimContactReshipmentRequest, parseClaimContactContract, parseClaimContactJournal,
  type ClaimContactContractName, type ClaimContactJournal,
} from './contracts';
import { CLAIM_CONTACT_FIXTURE_IDS as ids, claimContactContractFixtures } from './test-fixtures';

const fixtures = claimContactContractFixtures;
const parse = parseClaimContactContract;

type JsonPath = Array<string | number>;
function objectPaths(value: unknown, path: JsonPath = []): JsonPath[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((child, i) => objectPaths(child, [...path, i]));
  return [path, ...Object.entries(value).flatMap(([key, child]) => objectPaths(child, [...path, key]))];
}
function atPath(value: unknown, path: JsonPath): Record<string, unknown> {
  return path.reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], value) as Record<string, unknown>;
}

describe('claim-contact strict wire contracts', () => {
  for (const name of Object.keys(fixtures()) as ClaimContactContractName[]) {
    it(`${name}: accepts its complete valid DTO and rejects unknown or missing nested keys`, () => {
      const value = fixtures()[name];
      expect(parse(name, value)).toEqual(value);
      for (const path of objectPaths(value)) {
        const withSecret = structuredClone(value);
        atPath(withSecret, path).rawContact = 'must never survive';
        expect(parse(name, withSecret), `${name} extra key at ${path.join('.')}`).toBeNull();
        for (const key of Object.keys(atPath(value, path))) {
          const missing = structuredClone(value);
          delete atPath(missing, path)[key];
          expect(parse(name, missing), `${name} missing ${[...path, key].join('.')}`).toBeNull();
        }
      }
    });
  }

  it('accepts codepoint limits including Korean and supplementary Unicode, without NFC folding', () => {
    const base = fixtures().ChangeRequest;
    const recipientName = '🧑'.repeat(50), agreement = '한'.repeat(500), address2 = '😀'.repeat(200);
    const input = { ...base, contact: { recipientName: ` ${recipientName} `, phone: '+82 (10) 1234-5678', address2: ` ${address2} ` }, agreement: ` ${agreement} ` };
    const normalized = normalizeClaimContactChangeRequest(input);
    expect(normalized).not.toBeNull();
    expect(normalized?.contact).toEqual({ recipientName, phone: '821012345678', address2 });
    expect(normalized?.agreement).toBe(agreement);
    for (const [key, value] of [['recipientName', '😀'.repeat(51)], ['address2', '가'.repeat(201)], ['phone', '1'.repeat(16)], ['phone', '1'.repeat(7)]]) {
      expect(normalizeClaimContactChangeRequest({ ...base, contact: { ...base.contact, [key]: value } })).toBeNull();
    }
    expect(normalizeClaimContactChangeRequest({ ...base, agreement: '가'.repeat(501) })).toBeNull();
    expect(normalizeClaimContactChangeRequest({ ...base, agreement: '가' })).toBeNull();
    expect(normalizeClaimContactChangeRequest({ ...base, contact: { ...base.contact, recipientName: 'e\u0301' } })?.contact.recipientName).toBe('e\u0301');
    expect(normalizeClaimContactChangeRequest({ ...base, contact: { ...base.contact, address2: '' } })).not.toBeNull();
  });

  it('rejects malformed UTF-16 and all C0/C1 controls before trimming, including ignored edge controls', () => {
    const base = fixtures().ChangeRequest;
    for (const bad of ['\ud800', '\udfff', 'a\ud800z', '\udc00\ud800', ...Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)), ...Array.from({ length: 33 }, (_, i) => String.fromCharCode(0x7f + i))]) {
      expect(isClaimContactText(bad)).toBe(false);
      for (const key of ['recipientName', 'phone', 'address2']) expect(normalizeClaimContactChangeRequest({ ...base, contact: { ...base.contact, [key]: `${bad}${base.contact[key as keyof typeof base.contact]}` } })).toBeNull();
      expect(normalizeClaimContactChangeRequest({ ...base, agreement: `${bad}확인` })).toBeNull();
    }
    expect(isClaimContactText('😀')).toBe(true);
    for (const phone of ['０１０１２３４５６７８', '010.1234.5678', '010\u00a012345678', '010/12345678', '٠١٠١٢٣٤٥٦٧٨']) expect(normalizeClaimContactChangeRequest({ ...base, contact: { ...base.contact, phone } })).toBeNull();
  });

  it('preserves read-only source strings exactly and never accepts unsupported edit fields', () => {
    const base = fixtures();
    expect(normalizeClaimContactAddress({ ...base.Address, recipientName: ' 수령인 ', phone: '010-1234-5678', address2: ' ' })).toEqual({ ...base.Address, recipientName: '수령인' });
    for (const field of ['postalCode', 'address1', 'deliveryNote', 'additionalPhone', 'collectionMethod']) expect(normalizeClaimContactChangeRequest({ ...base.ChangeRequest, contact: { ...base.ContactEdit, [field]: 'not editable' } })).toBeNull();
    for (const address of [{ ...base.Address, postalCode: ' ' }, { ...base.Address, address1: ' ' }, { ...base.Address, postalCode: '1'.repeat(21) }, { ...base.Address, address1: '가'.repeat(201) }, { ...base.Address, address2: undefined }]) expect(normalizeClaimContactAddress(address)).toBeNull();
    expect(parse('ContactEdit', { ...base.ContactEdit, recipientName: ' space ' })).toBeNull();
  });

  it('validates reshipment confirmations, empty legacy selections, item bounds and duplicate item IDs', () => {
    const base = fixtures().ReshipmentRequest;
    expect(normalizeClaimContactReshipmentRequest({ ...base, carrier: ' 택배 ', trackingNumber: ' ab12345678 ', items: [] })).toMatchObject({ carrier: '택배', trackingNumber: 'AB12345678', items: [] });
    const items = Array.from({ length: 1000 }, (_, i) => ({ orderItemId: `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`, variantId: ids.variant }));
    expect(parse('ReshipmentRequest', { ...base, items })).not.toBeNull();
    expect(parse('ReshipmentRequest', { ...base, items: [...items, { ...items[0], orderItemId: ids.item }] })).toBeNull();
    for (const change of [{ destinationConfirmed: false }, { dispatchConfirmed: false }, { carrier: '' }, { trackingNumber: '1234567' }, { trackingNumber: 'ß12345678' }, { items: [{ ...base.items[0] }, { ...base.items[0], variantId: ids.plan }] }, { items: [{ ...base.items[0], quantity: 1 }] }]) expect(normalizeClaimContactReshipmentRequest({ ...base, ...change })).toBeNull();
  });

  it('distinguishes context commands and accepts a denied return reshipment view without creating authority', () => {
    const f = fixtures();
    expect(parse('ContextRequest', { ...f.ContextRequest, command: 'reshipment' })).toBeNull();
    expect(parse('ContextClaims', { ...f.ContextClaims, purpose: 'claim-contact/reshipment-context' })).toBeNull();
    expect(parse('ContextClaims', { ...f.ContextClaims, expiresAt: '2026-10-14T00:10:01Z' })).toBeNull();
    for (const backendOrigin of ['https://example.com/', 'https://user:password@example.com', 'https://example.com?secret=1', 'file:///tmp/test']) expect(parse('ContextClaims', { ...f.ContextClaims, backendOrigin })).toBeNull();
    const denied = { ...f.ContextResponse, command: 'reshipment', target: 'reshipment', claimType: 'return', allowed: false, blocker: 'not_applicable', sourceKind: null, referenceOnly: false, piiState: 'not_applicable', address: null, signedContext: null, expiresAt: null };
    expect(parse('ContextResponse', denied)).not.toBeNull();
    expect(parse('ContextResponse', { ...denied, signedContext: f.SignedContext })).toBeNull();
    expect(parse('OperationRequest', { ...f.OperationRequest, command: 'reshipment', target: 'reshipment', expectedClaimType: 'return' })).toBeNull();
    expect(parse('DbContactContext', { ...f.DbContactContext, current: { ...f.DbTargetView, target: 'reshipment' } })).toBeNull();
  });

  it('binds source variant, plan identifiers and the source-only reference display', () => {
    const f = fixtures();
    for (const change of [{ sourceRevision: null }, { sourceRevision: '01' }, { sourceRevision: '-1' }, { sourceFingerprint: null }, { planRevision: 1 }, { piiVersion: ids.pii }]) {
      expect(parse('SourceBinding', { ...f.SourceBinding, ...change })).toBeNull();
      expect(parse('DbExpectedContext', { ...f.DbExpectedContext, ...change })).toBeNull();
    }
    expect(parse('SourceBinding', { ...f.SourceBinding, sourceKind: 'seller_intake', sourceRevision: null })).not.toBeNull();
    const planSource = { ...f.SourceBinding, sourceKind: 'contact_plan', sourceId: ids.plan, sourceRevision: null, sourceFingerprint: null, planRevision: 1, piiVersion: ids.pii };
    const planView = { ...f.DbTargetView, referenceOnly: false, source: planSource, sourceAddress: null, plan: f.SealedPlan };
    expect(parse('DbTargetView', planView)).not.toBeNull();
    expect(parse('DbTargetView', { ...planView, source: { ...planSource, sourceId: ids.order } })).toBeNull();
    expect(parse('DbTargetView', { ...planView, source: { ...planSource, piiVersion: ids.order } })).toBeNull();
    expect(parse('DbTargetView', { ...planView, sourceAddress: f.Address })).toBeNull();
    expect(parse('TargetView', { ...f.TargetView, referenceOnly: false })).toBeNull();
    expect(parse('TargetView', { ...f.TargetView, sourceKind: 'contact_plan' })).toBeNull();
    expect(parse('ContextClaims', { ...f.ContextClaims, source: { ...f.SourceBinding, sourceId: ids.claim } })).toBeNull();
    expect(parse('DbContactContext', { ...f.DbContactContext, orderId: ids.claim })).toBeNull();
    expect(parse('DbContactHistory', { ...f.DbContactHistory, orderId: ids.claim })).toBeNull();
    const intakeSource = { ...f.SourceBinding, sourceKind: 'seller_intake', sourceId: ids.claim, sourceRevision: null };
    expect(parse('ContextClaims', { ...f.ContextClaims, source: intakeSource })).not.toBeNull();
    expect(parse('ContextClaims', { ...f.ContextClaims, source: { ...intakeSource, sourceId: ids.order } })).toBeNull();
    const intakeCurrent = { ...f.DbTargetView, source: intakeSource, referenceOnly: false };
    expect(parse('DbContactContext', { ...f.DbContactContext, current: intakeCurrent })).not.toBeNull();
    expect(parse('DbContactContext', { ...f.DbContactContext, claimId: ids.order, current: intakeCurrent })).toBeNull();
    const intakeHistory = { ...f.DbContactHistory, current: { ...f.DbContactHistory.current, collection: intakeCurrent } };
    expect(parse('DbContactHistory', intakeHistory)).not.toBeNull();
    expect(parse('DbContactHistory', { ...intakeHistory, claimId: ids.order })).toBeNull();
    expect(parse('DbContactHistory', { ...f.DbContactHistory, reshipmentDestination: { ...f.DbReshipmentDestinationView,
      destination: { ...f.SealedDestination, sourceKind: 'seller_intake', sourceId: ids.order, sourceRevision: null } } })).toBeNull();
  });

  it('requires canonical envelope encodings and consistent field key versions', () => {
    const f = fixtures();
    for (const change of [{ iv: 'A'.repeat(15) }, { tag: 'A'.repeat(21) + 'B' }, { ct: 'AB' }, { ct: 'A' }, { ct: 'AQ==' }, { ct: 'A'.repeat(8193) }]) expect(parse('EncryptedField', { ...f.EncryptedField, ...change })).toBeNull();
    expect(parse('EncryptedField', { ...f.EncryptedField, ct: '' })).not.toBeNull();
    expect(parse('EncryptedAddress', { ...f.EncryptedAddress, recipientName: { ...f.EncryptedField, ct: '' } })).toBeNull();
    expect(parse('SealedPlan', { ...f.SealedPlan, address: { ...f.EncryptedAddress, phone: { ...f.EncryptedField, kid: 'other' } } })).toBeNull();
    expect(parse('SealedHistory', { ...f.SealedHistory, agreement: { ...f.EncryptedField, kid: 'other' } })).toBeNull();
    expect(parse('DbHistoryEntry', { ...f.DbHistoryEntry, ciphertext: { ...f.DbHistoryCiphertext, recordId: ids.order } })).toBeNull();
  });

  it('requires exact same-version no-op HMAC equality and changed-field canonical order', () => {
    const f = fixtures(), noop = { ...f.SealedChange, effect: 'noop', changedFields: [], afterAddressHmac: f.SealedChange.beforeAddressHmac, plan: null, history: null };
    expect(parse('SealedChange', noop)).not.toBeNull();
    expect(parse('SealedChange', { ...noop, afterAddressHmac: 'c'.repeat(64) })).toBeNull();
    expect(parse('SealedChange', { ...noop, history: f.SealedHistory })).toBeNull();
    for (const fields of [[], ['phone', 'recipientName'], ['recipientName', 'recipientName'], ['address1']]) expect(parse('SealedChange', { ...f.SealedChange, changedFields: fields })).toBeNull();
    expect(parse('SealedChange', { ...f.SealedChange, beforeAddressHmac: f.SealedChange.afterAddressHmac })).toBeNull();
    expect(parse('SealedChange', { ...f.SealedChange, plan: { ...f.SealedPlan, addressHmac: 'c'.repeat(64) } })).toBeNull();
  });

  it('enforces minimal receipts, historical revision results and purged replay metadata', () => {
    const f = fixtures(), receipt = f.OperationReceipt;
    for (const change of [{ resultClaimRevision: 3 }, { changedFields: [] }, { piiState: 'not_stored' }]) expect(parse('OperationReceipt', { ...receipt, ...change })).toBeNull();
    const noop = { ...receipt, state: 'noop', resultClaimRevision: 3, changedFields: [], piiState: 'not_stored' };
    expect(parse('OperationReceipt', noop)).not.toBeNull();
    expect(parse('OperationReceipt', { ...noop, piiState: 'purged' })).not.toBeNull();
    const sealed = { ...noop, state: 'sealed', resultClaimRevision: null };
    expect(parse('OperationReceipt', sealed)).not.toBeNull();
    expect(parse('OperationReceipt', { ...sealed, piiState: 'purged' })).toBeNull();
    expect(parse('DbOperationRecovery', { receipt: sealed, hmacKeyVersion: null })).not.toBeNull();
    expect(parse('DbOperationRecovery', { receipt: sealed, hmacKeyVersion: 'local-test' })).toBeNull();
    expect(parse('DbOperationRecovery', { receipt: { ...receipt, piiState: 'purged' }, hmacKeyVersion: 'local-test' })).toBeNull();
    expect(parse('OperationResponse', { ...f.OperationResponse, actorId: ids.order })).toBeNull();
    for (const key of ['address', 'agreement', 'signedContext', 'requestHmac', 'sourceFingerprint', 'ciphertext']) expect(parse('OperationReceipt', { ...receipt, [key]: 'secret' })).toBeNull();
  });

  it('suppresses PII for retention_due, purged and restricted views without original fallback', () => {
    const f = fixtures();
    for (const piiState of ['unavailable', 'purged', 'restricted', 'not_applicable']) {
      const unavailableReason = piiState === 'unavailable' ? 'retention_due' : null;
      const target = { ...f.TargetView, piiState, unavailableReason, sourceKind: null, referenceOnly: false, address: null };
      expect(parse('TargetView', target)).not.toBeNull();
      expect(parse('TargetView', { ...target, address: f.Address })).toBeNull();
      expect(parse('TargetView', { ...target, sourceKind: 'order_delivery' })).toBeNull();
      expect(parse('DbTargetView', { ...f.DbTargetView, piiState, unavailableReason, source: null, sourceAddress: null, plan: null, referenceOnly: false })).not.toBeNull();
    }
    expect(parse('TargetView', { ...f.TargetView, unavailableReason: 'retention_due' })).toBeNull();
    const due = { ...f.HistoryEntry, piiState: 'unavailable', unavailableReason: 'retention_due', before: null, after: null, agreement: null };
    expect(parse('HistoryEntry', due)).not.toBeNull();
    expect(parse('HistoryEntry', { ...due, before: f.Address })).toBeNull();
    expect(parse('HistoryEntry', { ...due, unavailableReason: null })).toBeNull();
    expect(parse('HistoryEntry', { ...due, piiState: 'purged' })).toBeNull();
    expect(parse('DbHistoryEntry', { ...f.DbHistoryEntry, piiState: 'unavailable', unavailableReason: 'retention_due' })).toBeNull();
    expect(parse('DbReshipmentDestinationView', { ...f.DbReshipmentDestinationView, piiState: 'unavailable', unavailableReason: 'retention_due' })).toBeNull();
  });

  it('keeps customer history free of operator/agreement data and gifts sender free of every address', () => {
    const f = fixtures();
    expect(parse('HistoryResponse', { ...f.HistoryResponse, viewerKind: 'buyer' })).toBeNull();
    const customer = { ...f.HistoryResponse, viewerKind: 'buyer', entries: [{ ...f.HistoryEntry, actorId: null, agreement: null }] };
    expect(parse('HistoryResponse', customer)).not.toBeNull();
    expect(parse('HistoryResponse', { ...customer, viewerKind: 'gift_sender' })).toBeNull();
    expect(parse('HistoryResponse', { ...customer, piiAccess: false })).toBeNull();
    expect(parse('DbContactHistory', { ...f.DbContactHistory, viewerKind: 'buyer' })).toBeNull();
    expect(parse('DbContactHistory', { ...f.DbContactHistory, viewerKind: 'buyer', entries: [{ ...f.DbHistoryEntry, actorId: null, ciphertext: { ...f.DbHistoryCiphertext, agreement: null } }] })).not.toBeNull();
    expect(parse('HistoryResponse', { ...f.HistoryResponse, current: { ...f.HistoryResponse.current, collection: f.HistoryResponse.current.reshipment } })).toBeNull();
    expect(parse('HistoryResponse', { ...f.HistoryResponse, entries: [f.HistoryEntry, f.HistoryEntry] })).toBeNull();
    expect(parse('DbReshipmentDestinationView', { ...f.DbReshipmentDestinationView, source: 'legacy_unconfirmed' })).toBeNull();
    expect(parse('DbReshipmentDestinationView', { source: 'none', operationId: null, recordedAt: null, piiState: 'not_applicable', destination: null, unavailableReason: null })).not.toBeNull();
  });

  it('strictly parses 10-key metadata journals and never stores signed input or digest material', () => {
    const f = fixtures();
    const journal: ClaimContactJournal = { operationId: ids.operation, orderId: ids.order, claimId: ids.claim, command: 'change', target: 'collection', expectedClaimType: 'exchange', expectedClaimRevision: 3, actorId: ids.actor, sessionId: ids.session, startedAt: f.Instant };
    expect(parseClaimContactJournal(journal)).toEqual(journal);
    for (const key of ['contact', 'agreement', 'signedContext', 'source', 'sourceFingerprint', 'digest', 'ciphertext', 'requestHmac', 'addressHmac', 'requestId']) expect(parseClaimContactJournal({ ...journal, [key]: 'forbidden' })).toBeNull();
    for (const key of Object.keys(journal)) {
      const broken = { ...journal } as Record<string, unknown>; delete broken[key];
      expect(parseClaimContactJournal(broken)).toBeNull();
    }
    expect(parseClaimContactJournal({ ...journal, command: 'reshipment' })).toBeNull();
  });

  it('validates actual instants, finite numeric bounds and prototypes without coercion', () => {
    for (const invalid of ['2026-02-30T00:00:00Z', '2025-02-29T00:00:00Z', '2026-10-14', '2026-10-14T24:00:00Z', 'infinity', '2026-10-14T00:00:00+25:00']) expect(parse('Instant', invalid)).toBeNull();
    expect(parse('Instant', '2024-02-29T23:59:59.123456+09:00')).not.toBeNull();
    for (const invalid of ['0', 0.5, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(parse('Revision', invalid)).toBeNull();
    expect(parse('ClaimRevision', 2147483648)).toBeNull();
    expect(parse('RequestScope', Object.create(fixtures().RequestScope))).toBeNull();
    const getter = { ...fixtures().RequestScope }; Object.defineProperty(getter, 'orderId', { get: () => ids.order, enumerable: true });
    expect(parse('RequestScope', getter)).toBeNull();
    expect(parse('ReshipmentRequest', { ...fixtures().ReshipmentRequest, items: Array(1) })).toBeNull();
    const extra = Object.assign([fixtures().ReshipmentItem], { address: 'not allowed' });
    expect(parse('ReshipmentRequest', { ...fixtures().ReshipmentRequest, items: extra })).toBeNull();
  });

  it('enforces retention event results, remaining counts and metadata-only purge reports', () => {
    const f = fixtures();
    expect(parse('RetentionCaseCommand', { ...f.RetentionCaseCommand, action: 'release' })).toBeNull();
    expect(parse('RetentionCaseCommand', { ...f.RetentionCaseCommand, retainUntil: f.Instant })).toBeNull();
    expect(parse('RetentionCaseCommand', { ...f.RetentionCaseCommand, caseRef: '고객 이름' })).toBeNull();
    expect(parse('RetentionCaseReceipt', { ...f.RetentionCaseReceipt, resultRevision: 5 })).toBeNull();
    expect(parse('RetentionCaseReceipt', { ...f.RetentionCaseReceipt, action: 'close' })).toBeNull();
    expect(parse('RetentionCaseReceipt', { ...f.RetentionCaseReceipt, action: 'release', state: 'released', retainUntil: null, releasedAt: f.Instant })).not.toBeNull();
    expect(parse('RetentionCaseReceipt', { ...f.RetentionCaseReceipt, action: 'close', state: 'closed', retainUntil: null, caseClosedAt: f.Instant })).not.toBeNull();
    expect(parse('ContactPurgeReceipt', { ...f.ContactPurgeReceipt, selectedResidualPiiFields: 1 })).toBeNull();
    expect(parse('ContactPurgeReceipt', { ...f.ContactPurgeReceipt, removed: { ...f.ContactDataCounts, operatorReferences: 1 } })).toBeNull();
    expect(parse('ContactPurgeReceipt', { ...f.ContactPurgeReceipt, cutoff: '2026-10-15T00:00:00Z' })).toBeNull();
    expect(parse('ContactPurgeReceipt', { ...f.ContactPurgeReceipt, purgedClaimIds: [ids.claim, ids.order] })).toBeNull();
    expect(parse('ContactPurgeReceipt', f.ContactPurgeReceipt)?.remaining.piiFields).toBe(50);
  });

  it('uses fixed errors and exact DB code pairs without reflecting raw messages or details', () => {
    for (const [code, definition] of Object.entries(CLAIM_CONTACT_ERRORS)) {
      const error = claimContactError(code, ids.request);
      expect(parse('ErrorResponse', error)).toEqual(error);
      expect(claimContactErrorStatus(code)).toBe(definition.http);
      expect(parse('ErrorResponse', { ...error, message: 'raw database details' })).toBeNull();
      if (definition.sqlState !== null) expect(claimContactDatabaseError(definition.sqlState, code, ids.request)).toEqual(error);
    }
    expect(claimContactDatabaseError('PT409', 'claim_contact_changed phone=01012345678').code).toBe('claim_contact_outcome_unknown');
    expect(claimContactDatabaseError('WRONG', 'claim_contact_changed').code).toBe('claim_contact_outcome_unknown');
    const safe = claimContactError('secret name and address', 'not-a-uuid');
    expect(safe).toMatchObject({ code: 'claim_contact_outcome_unknown', requestId: null, uncertain: true });
    expect(JSON.stringify(safe)).not.toContain('secret name');
    expect(claimContactErrorStatus('__proto__')).toBe(503);
  });
});

it('accepts full address edits only as a paired, normalized destination while preserving legacy requests', () => {
  const f = fixtures(), full = { ...f.ChangeRequest, contact: { ...f.ContactEdit, postalCode: ' 54321 ', address1: ' 새 기본 주소 ' } };
  expect(normalizeClaimContactChangeRequest(full)?.contact).toEqual({ ...f.ContactEdit, postalCode: '54321', address1: '새 기본 주소' });
  expect(normalizeClaimContactChangeRequest({ ...full, contact: { ...f.ContactEdit, postalCode: '54321' } })).toBeNull();
  expect(normalizeClaimContactChangeRequest({ ...full, contact: { ...full.contact, postalCode: '1234' } })).toBeNull();
  const sealed = { ...f.SealedChange, changedFields: ['postalCode', 'address1'], destinationCheck: { before: { postalCode: '12345', address1: '기존 주소' }, after: { postalCode: '54321', address1: '새 기본 주소' } } };
  expect(parse('SealedChange', sealed)).not.toBeNull();
  expect(parse('SealedChange', { ...sealed, changedFields: ['recipientName'] })).toBeNull();
  expect(normalizeClaimContactChangeRequest(f.ChangeRequest)).toEqual(f.ChangeRequest);
});
