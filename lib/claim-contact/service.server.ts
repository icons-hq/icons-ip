import 'server-only';

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { adminClaimBasePath } from '@/lib/admin/claims';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  normalizeClaimContactChangeRequest, normalizeClaimContactReshipmentRequest, parseClaimContactContract,
  claimContactError, claimContactErrorStatus as sharedErrorStatus, claimContactDatabaseError, type ClaimContactErrorCode,
  type Address, type ChangeRequest, type ClaimContactContracts, type Command, type ContextClaims, type ContextRequest, type ContextResponse,
  type DbContactContext, type DbContactHistory, type DbExpectedContext, type DbHistoryEntry, type DbOperationRecovery, type DbTargetView,
  type ErrorResponse, type HistoryEntry, type HistoryRequest, type HistoryResponse, type OperationReceipt, type OperationRequest,
  type OperationResponse, type ReshipmentRequest, type SealedChange, type SealedDestination, type SourceBinding, type Target, type TargetView,
} from './contracts';
import { ClaimContactCryptoError, loadClaimContactCodec, type ClaimContactCodec, type ClaimContactRecordBinding } from './crypto.server';

class ContactError extends Error {
  constructor(readonly code: ClaimContactErrorCode) { super(code); this.name = 'ClaimContactServiceError'; }
}
function fail(code: ClaimContactErrorCode): never { throw new ContactError(code); }
export const claimContactErrorResponse = claimContactError;
export function claimContactErrorStatus(value: ErrorResponse): number { return sharedErrorStatus(value.code); }
function requestIdFrom(input: unknown): string | null {
  if (input === null || typeof input !== 'object' || !('requestId' in input)) return null;
  return parseClaimContactContract('Uuid', input.requestId);
}
async function protect<T>(input: unknown, run: () => Promise<T>): Promise<T | ErrorResponse> {
  try { return await run(); }
  catch (error) {
    const code = error instanceof ContactError || error instanceof ClaimContactCryptoError ? error.code : 'claim_contact_outcome_unknown';
    return claimContactErrorResponse(code, requestIdFrom(input));
  }
}
function parse<N extends keyof ClaimContactContracts>(name: N, input: unknown): ClaimContactContracts[N] {
  return parseClaimContactContract(name, input) ?? fail('invalid_claim_contact_request');
}
function fromDb<N extends keyof ClaimContactContracts>(name: N, input: unknown): ClaimContactContracts[N] {
  return parseClaimContactContract(name, input) ?? fail('claim_contact_outcome_unknown');
}

type Auth = { actorId: string; sessionId: string; service: ReturnType<typeof createServiceClient> };
async function authenticate(): Promise<Auth> {
  const client = await createClient();
  const user = await client.auth.getUser();
  if (user.error || !user.data.user || !parseClaimContactContract('Uuid', user.data.user.id)) return fail('auth_changed');
  const claims = await client.auth.getClaims();
  if (claims.error || !claims.data || claims.data.claims.sub !== user.data.user.id) return fail('auth_changed');
  const sessionId = parseClaimContactContract('Uuid', claims.data.claims.session_id);
  if (!sessionId) return fail('auth_changed');
  // The service boundary starts only after both checks. Every RPC independently
  // rechecks the live session, current capability/ownership and subject fences.
  return { actorId: user.data.user.id, sessionId, service: createServiceClient() };
}
function scopeArgs(auth: Auth, input: { orderId: string; claimId: string }) {
  return { p_order_id: input.orderId, p_claim_id: input.claimId, p_actor_id: auth.actorId, p_session_id: auth.sessionId };
}
async function rpc(auth: Auth, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await auth.service.rpc(name, args);
  if (error) {
    // Do not expose database message/detail/hint, even on a failed read.
    return fail(claimContactDatabaseError(error.code, error.message).code as ClaimContactErrorCode);
  }
  return data;
}
function freshCodec(): ClaimContactCodec {
  if (process.env.ICONS_CLAIM_CONTACT_ENABLED !== '1' || !process.env.ICONS_CLAIM_CONTACT_KEYRING_JSON) return fail('feature_disabled');
  const codec = loadClaimContactCodec(); codec.requireEnabled(); return codec;
}
function sameDigest(a: string, b: string) { return /^[0-9a-f]{64}$/.test(a) && /^[0-9a-f]{64}$/.test(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
function sameSource(a: SourceBinding, b: SourceBinding) {
  return a.sourceKind === b.sourceKind && a.sourceId === b.sourceId && a.sourceRevision === b.sourceRevision && a.sourceFingerprint === b.sourceFingerprint
    && a.planRevision === b.planRevision && a.piiVersion === b.piiVersion;
}
function recordBinding(input: { orderId: string; claimId: string }, target: Target, recordKind: ClaimContactRecordBinding['recordKind'], recordId: string, piiVersion: string): ClaimContactRecordBinding {
  return { orderId: input.orderId, claimId: input.claimId, target, recordKind, recordId, piiVersion };
}
function readTargetAddress(codec: ClaimContactCodec, input: { orderId: string; claimId: string }, target: DbTargetView): Address | null {
  if (target.piiState !== 'available') return null;
  if (!target.source) return fail('claim_contact_outcome_unknown');
  if (target.source.sourceKind !== 'contact_plan') return target.sourceAddress ?? fail('claim_contact_outcome_unknown');
  const plan = target.plan;
  if (!plan || target.source.sourceId !== plan.planId || target.source.piiVersion !== plan.piiVersion) return fail('claim_contact_outcome_unknown');
  const address = codec.openAddress(plan.address, recordBinding(input, target.target, 'plan', plan.planId, plan.piiVersion), plan.keyVersion);
  if (!sameDigest(codec.addressHmac(address, { ...input, target: target.target }, plan.addressHmacKeyVersion), plan.addressHmac)) throw new ClaimContactCryptoError();
  return address;
}
async function dbContext(auth: Auth, input: Pick<ContextRequest, 'orderId' | 'claimId' | 'target' | 'command'>): Promise<DbContactContext> {
  const value = fromDb('DbContactContext', await rpc(auth, 'service_get_order_claim_contact_context', { ...scopeArgs(auth, input), p_target: input.target, p_command: input.command }));
  if (value.orderId !== input.orderId || value.claimId !== input.claimId || value.target !== input.target || value.command !== input.command
    || value.current.target !== input.target) return fail('claim_contact_outcome_unknown');
  return value;
}

export async function fetchClaimContactContext(raw: unknown): Promise<ContextResponse | ErrorResponse> {
  return protect(raw, async () => {
    const input = parse('ContextRequest', raw), auth = await authenticate(), codec = freshCodec();
    const value = await dbContext(auth, input), address = readTargetAddress(codec, input, value.current);
    let signedContext: string | null = null, expiresAt: string | null = null;
    if (value.allowed) {
      if (!address || !value.current.source || value.blocker !== null) return fail('claim_contact_outcome_unknown');
      const now = Date.now(); expiresAt = new Date(now + 600_000).toISOString();
      signedContext = codec.signContext({ v: 1, purpose: `claim-contact/${input.command}-context`, environment: codec.environment, backendOrigin: codec.backendOrigin,
        actorId: auth.actorId, sessionId: auth.sessionId, orderId: input.orderId, claimId: input.claimId, target: input.target,
        expectedClaimType: value.claimType, expectedClaimRevision: value.claimRevision, source: value.current.source,
        addressHmac: codec.addressHmac(address, input), addressHmacKeyVersion: codec.activeKeyVersion, issuedAt: new Date(now).toISOString(), expiresAt, signingKeyVersion: codec.activeKeyVersion });
    }
    return fromDb('ContextResponse', { requestId: input.requestId, actorId: auth.actorId, sessionId: auth.sessionId,
      orderId: input.orderId, claimId: input.claimId, target: input.target, command: input.command, claimType: value.claimType, claimRevision: value.claimRevision,
      allowed: value.allowed, blocker: value.blocker, sourceKind: value.current.source?.sourceKind ?? null, referenceOnly: value.current.referenceOnly,
      piiState: value.current.piiState, unavailableReason: value.current.unavailableReason, address, signedContext, expiresAt });
  });
}

type RecoveryScope = Pick<OperationRequest, 'orderId' | 'claimId' | 'operationId' | 'command' | 'target' | 'expectedClaimType' | 'expectedClaimRevision'>;
function receiptMatches(receipt: OperationReceipt, auth: Auth, scope: RecoveryScope): boolean {
  return receipt.operationId === scope.operationId && receipt.command === scope.command && receipt.orderId === scope.orderId && receipt.claimId === scope.claimId
    && receipt.actorId === auth.actorId && receipt.sessionId === auth.sessionId && receipt.target === scope.target
    && receipt.expectedClaimType === scope.expectedClaimType && receipt.expectedClaimRevision === scope.expectedClaimRevision;
}
async function recovery(auth: Auth, scope: RecoveryScope, sealIfAbsent: boolean): Promise<DbOperationRecovery> {
  const value = fromDb('DbOperationRecovery', await rpc(auth, 'service_read_order_claim_contact_operation', { ...scopeArgs(auth, scope),
    p_operation_id: scope.operationId, p_command: scope.command, p_target: scope.target, p_expected_claim_type: scope.expectedClaimType,
    p_expected_claim_revision: scope.expectedClaimRevision, p_seal_if_absent: sealIfAbsent }));
  if (value.receipt && !receiptMatches(value.receipt, auth, scope)) return fail('claim_contact_outcome_unknown');
  return value;
}
function revalidateCommittedReceipt(receipt: OperationReceipt | null) {
  if (receipt?.state === 'saved') {
    // Called only after current authentication and exact receipt-scope checks,
    // including metadata recovery. Repeating this repairs a lost response or a
    // prior cache invalidation failure without dispatching stock changes again.
    const surfaces: [string, ('page' | 'layout')?][] = [];
    for (const type of ['cancel', 'return', 'exchange'] as const) {
      const base = adminClaimBasePath(type);
      surfaces.push([base], [`${base}/${receipt.claimId}`]);
    }
    surfaces.push(['/admin/sales/orders'], [`/admin/sales/orders/${receipt.orderId}`], ['/admin/sales/dispatch'],
      ['/orders'], [`/orders/${receipt.orderId}`], ['/gifts'], ['/gifts/[giftId]', 'page']);
    if (receipt.command === 'reshipment') surfaces.push(['/shop', 'layout'], ['/ip', 'layout'], ['/cart'], ['/checkout'], ['/admin/catalog/goods', 'layout']);
    for (const [path, type] of surfaces) {
      try { revalidatePath(path, type); }
      catch { /* A committed DB receipt must remain a success. Recovery can retry this path. */ }
    }
  }
}
function operationResponse(auth: Auth, requestId: string, receipt: OperationReceipt | null): OperationResponse {
  revalidateCommittedReceipt(receipt);
  return { requestId, actorId: auth.actorId, sessionId: auth.sessionId, receipt };
}
/** Keyless and PII-free by design: keep this path independent of the codec. */
export async function readOrSealClaimContactOperation(raw: unknown): Promise<OperationResponse | ErrorResponse> {
  return protect(raw, async () => {
    const input = parse('OperationRequest', raw), auth = await authenticate();
    const value = await recovery(auth, input, input.sealIfAbsent);
    return operationResponse(auth, input.requestId, value.receipt);
  });
}
function mutationScope(input: ChangeRequest | ReshipmentRequest, claims: ContextClaims, command: Command): RecoveryScope {
  return { orderId: input.orderId, claimId: input.claimId, operationId: input.operationId, command, target: claims.target,
    expectedClaimType: claims.expectedClaimType, expectedClaimRevision: claims.expectedClaimRevision };
}
function expectedContext(claims: ContextClaims): DbExpectedContext {
  return { ...claims.source, addressHmac: claims.addressHmac, addressHmacKeyVersion: claims.addressHmacKeyVersion };
}
function requireReplay(value: DbOperationRecovery): string {
  if (!value.receipt) return fail('claim_contact_outcome_unknown');
  if (value.receipt.state === 'sealed') return fail('claim_contact_operation_sealed');
  if (value.receipt.piiState === 'purged') return fail('claim_contact_purged');
  return value.hmacKeyVersion ?? fail('claim_contact_crypto_unavailable');
}
async function verifiedCurrent(auth: Auth, codec: ClaimContactCodec, input: ChangeRequest | ReshipmentRequest, claims: ContextClaims, command: Command): Promise<Address> {
  codec.requireEnabled();
  if (Date.parse(claims.expiresAt) <= Date.now()) return fail('claim_contact_context_expired');
  const current = await dbContext(auth, { orderId: input.orderId, claimId: input.claimId, target: claims.target, command });
  if (current.current.piiState === 'purged') return fail('claim_contact_purged');
  if (current.current.unavailableReason === 'retention_due') return fail('claim_contact_retention_due');
  if (!current.allowed) return fail('claim_contact_blocked');
  if (current.claimType !== claims.expectedClaimType || current.claimRevision !== claims.expectedClaimRevision || !current.current.source
    || !sameSource(current.current.source, claims.source)) return fail('claim_contact_changed');
  const address = readTargetAddress(codec, input, current.current);
  if (!address || !sameDigest(codec.addressHmac(address, { ...input, target: claims.target }, claims.addressHmacKeyVersion), claims.addressHmac)) return fail('claim_contact_changed');
  return address;
}
function sealChange(codec: ClaimContactCodec, input: ChangeRequest, claims: ContextClaims, before: Address): SealedChange {
  const after: Address = { recipientName: input.contact.recipientName, phone: input.contact.phone, postalCode: input.contact.postalCode ?? before.postalCode, address1: input.contact.address1 ?? before.address1, address2: input.contact.address2 };
  const changedFields = (['recipientName', 'phone', 'address2', 'postalCode', 'address1'] as const).filter(field => before[field] !== after[field]);
  const shared = { changedFields, beforeAddressHmac: codec.addressHmac(before, input), afterAddressHmac: codec.addressHmac(after, input), addressHmacKeyVersion: codec.activeKeyVersion };
  if (!changedFields.length) return { ...shared, effect: 'noop', plan: null, history: null };
  const planId = claims.source.sourceKind === 'contact_plan' ? claims.source.sourceId : randomUUID(), planVersion = randomUUID(), historyVersion = randomUUID();
  return { ...shared, ...(changedFields.includes('postalCode') || changedFields.includes('address1') ? { destinationCheck: { before: { postalCode: before.postalCode, address1: before.address1 }, after: { postalCode: after.postalCode, address1: after.address1 } } } : {}), effect: 'change', plan: { planId, piiVersion: planVersion, keyVersion: codec.activeKeyVersion,
    addressHmac: shared.afterAddressHmac, addressHmacKeyVersion: codec.activeKeyVersion, address: codec.sealAddress(after, recordBinding(input, input.target, 'plan', planId, planVersion)) },
    history: { piiVersion: historyVersion, keyVersion: codec.activeKeyVersion,
      before: codec.sealAddress(before, recordBinding(input, input.target, 'operation_before', input.operationId, historyVersion)),
      after: codec.sealAddress(after, recordBinding(input, input.target, 'operation_after', input.operationId, historyVersion)),
      agreement: codec.sealField(input.agreement, recordBinding(input, input.target, 'operation_agreement', input.operationId, historyVersion), 'agreement') } };
}
function sealDestination(codec: ClaimContactCodec, input: ReshipmentRequest, claims: ContextClaims, address: Address): SealedDestination {
  const piiVersion = randomUUID();
  return { piiVersion, keyVersion: codec.activeKeyVersion, address: codec.sealAddress(address, recordBinding(input, 'reshipment', 'reshipment_destination', input.operationId, piiVersion)),
    addressHmac: codec.addressHmac(address, { ...input, target: 'reshipment' }), addressHmacKeyVersion: codec.activeKeyVersion,
    sourceKind: claims.source.sourceKind, sourceId: claims.source.sourceId, sourceRevision: claims.source.sourceRevision,
    sourcePlanRevision: claims.source.planRevision, sourcePiiVersion: claims.source.piiVersion };
}
async function mutate(raw: unknown, command: Command): Promise<OperationResponse | ErrorResponse> {
  return protect(raw, async () => {
    const input = (command === 'change' ? normalizeClaimContactChangeRequest(raw) : normalizeClaimContactReshipmentRequest(raw)) ?? fail('invalid_claim_contact_request');
    const auth = await authenticate(), codec = loadClaimContactCodec();
    const claims = codec.verifyContext(input.signedContext, { actorId: auth.actorId, sessionId: auth.sessionId, orderId: input.orderId, claimId: input.claimId,
      target: 'target' in input ? input.target : 'reshipment', command }, { allowExpired: true });
    const scope = mutationScope(input, claims, command), previous = await recovery(auth, scope, false);
    let sealed: SealedChange | SealedDestination | null = null;
    let existingOperation = previous.receipt !== null;
    let keyVersion = previous.receipt ? requireReplay(previous) : codec.activeKeyVersion;
    if (!previous.receipt) {
      try {
        const address = await verifiedCurrent(auth, codec, input, claims, command);
        sealed = command === 'change' ? sealChange(codec, input as ChangeRequest, claims, address) : sealDestination(codec, input as ReshipmentRequest, claims, address);
      } catch (error) {
        if (!(error instanceof ContactError || error instanceof ClaimContactCryptoError) || error.code === 'auth_changed') throw error;
        // The original operation can commit after the absent lookup but before
        // current-context validation. Its new revision/stage must converge to
        // the frozen receipt, not strand the same request as a fresh conflict.
        const raced = await recovery(auth, scope, false);
        if (!raced.receipt) throw error;
        keyVersion = requireReplay(raced);
        existingOperation = true;
      }
    }
    async function dispatch(version: string, payload: SealedChange | SealedDestination | null) {
      const common = { ...scopeArgs(auth, input), p_operation_id: input.operationId, p_expected_claim_revision: claims.expectedClaimRevision,
        p_expected_context: expectedContext(claims), p_request_hmac: codec.requestHmac(claims, input, version), p_hmac_key_version: version, p_confirmed: true };
      const args = command === 'change' ? { ...common, p_target: claims.target, p_expected_claim_type: claims.expectedClaimType, p_sealed_change: payload }
        : { ...common, p_sealed_destination: payload, p_carrier: (input as ReshipmentRequest).carrier, p_tracking_number: (input as ReshipmentRequest).trackingNumber, p_items: (input as ReshipmentRequest).items };
      const receipt = fromDb('OperationReceipt', await rpc(auth, command === 'change' ? 'service_change_order_claim_contact' : 'service_record_order_claim_reshipment_v2', args));
      if (!receiptMatches(receipt, auth, scope)) return fail('claim_contact_outcome_unknown');
      return operationResponse(auth, input.requestId, receipt);
    }
    try { return await dispatch(keyVersion, sealed); }
    catch (error) {
      if (!(error instanceof ContactError) || error.code !== 'claim_contact_operation_conflict' || existingOperation) throw error;
      // An in-flight old-key operation may have committed after our initial
      // lookup. Re-read metadata once, keep the original UUID/input/context,
      // and use that stored key. Never reread current PII or create a new UUID.
      const raced = await recovery(auth, scope, false);
      if (!raced.receipt) throw error;
      const storedVersion = requireReplay(raced);
      if (storedVersion === keyVersion) throw error;
      return dispatch(storedVersion, null);
    }
  });
}
export async function changeClaimContact(input: unknown) { return mutate(input, 'change'); }
export async function recordClaimReshipmentV2(input: unknown) { return mutate(input, 'reshipment'); }

function targetView(codec: ClaimContactCodec, scope: HistoryRequest, value: DbTargetView): TargetView {
  const metadata = { target: value.target, piiState: value.piiState, unavailableReason: value.unavailableReason,
    sourceKind: value.source?.sourceKind ?? null, referenceOnly: value.referenceOnly };
  try { return { ...metadata, address: readTargetAddress(codec, scope, value) }; }
  catch (error) {
    if (!(error instanceof ClaimContactCryptoError)) throw error;
    return { ...metadata, piiState: 'unavailable', unavailableReason: 'crypto_unavailable', sourceKind: null, referenceOnly: false, address: null };
  }
}
function historyEntry(codec: ClaimContactCodec, scope: HistoryRequest, value: DbHistoryEntry, operator: boolean): HistoryEntry {
  const metadata = { operationId: value.operationId, target: value.target, changedFields: value.changedFields, recordedAt: value.recordedAt,
    resultClaimRevision: value.resultClaimRevision, piiState: value.piiState, unavailableReason: value.unavailableReason, actorId: operator ? value.actorId : null };
  if (value.piiState !== 'available') return { ...metadata, before: null, after: null, agreement: null };
  const ciphertext = value.ciphertext;
  if (!ciphertext || ciphertext.recordId !== value.operationId) return fail('claim_contact_outcome_unknown');
  try {
    const before = codec.openAddress(ciphertext.before, recordBinding(scope, value.target, 'operation_before', value.operationId, ciphertext.piiVersion), ciphertext.keyVersion);
    const after = codec.openAddress(ciphertext.after, recordBinding(scope, value.target, 'operation_after', value.operationId, ciphertext.piiVersion), ciphertext.keyVersion);
    const agreement = operator && ciphertext.agreement ? codec.openField(ciphertext.agreement, recordBinding(scope, value.target, 'operation_agreement', value.operationId, ciphertext.piiVersion), 'agreement', ciphertext.keyVersion) : null;
    return { ...metadata, before, after, agreement };
  } catch (error) {
    if (!(error instanceof ClaimContactCryptoError)) throw error;
    return { ...metadata, piiState: 'unavailable', unavailableReason: 'crypto_unavailable', before: null, after: null, agreement: null };
  }
}
function finalDestination(codec: ClaimContactCodec, scope: HistoryRequest, value: DbContactHistory['reshipmentDestination']): HistoryResponse['reshipmentDestination'] {
  const metadata = { source: value.source, operationId: value.operationId, recordedAt: value.recordedAt, piiState: value.piiState, unavailableReason: value.unavailableReason };
  if (value.piiState !== 'available') return { ...metadata, address: null };
  if (value.source !== 'v2_confirmed' || !value.operationId || !value.destination) return fail('claim_contact_outcome_unknown');
  const destination = value.destination;
  try {
    const address = codec.openAddress(destination.address, recordBinding(scope, 'reshipment', 'reshipment_destination', value.operationId, destination.piiVersion), destination.keyVersion);
    if (!sameDigest(codec.addressHmac(address, { ...scope, target: 'reshipment' }, destination.addressHmacKeyVersion), destination.addressHmac)) throw new ClaimContactCryptoError();
    return { ...metadata, address };
  } catch (error) {
    if (!(error instanceof ClaimContactCryptoError)) throw error;
    return { ...metadata, piiState: 'unavailable', unavailableReason: 'crypto_unavailable', address: null };
  }
}
async function history(raw: unknown, viewerKind: 'operator' | 'customer'): Promise<HistoryResponse | ErrorResponse> {
  return protect(raw, async () => {
    const input = parse('HistoryRequest', raw), auth = await authenticate(), codec = freshCodec();
    const value = fromDb('DbContactHistory', await rpc(auth, 'service_read_order_claim_contact_history', { ...scopeArgs(auth, input), p_viewer_kind: viewerKind, p_limit: input.limit, p_cursor: input.cursor }));
    if (value.viewerId !== auth.actorId || value.sessionId !== auth.sessionId || value.orderId !== input.orderId || value.claimId !== input.claimId
      || (viewerKind === 'operator') !== (value.viewerKind === 'operator') || value.entries.length > input.limit
      || value.current.collection.target !== 'collection' || value.current.reshipment.target !== 'reshipment') return fail('claim_contact_outcome_unknown');
    if (viewerKind === 'customer' && value.entries.some(entry => entry.actorId !== null || entry.ciphertext?.agreement != null)) return fail('claim_contact_outcome_unknown');
    if ((!value.piiAccess || value.viewerKind === 'gift_sender') && (value.current.collection.sourceAddress || value.current.collection.plan
      || value.current.reshipment.sourceAddress || value.current.reshipment.plan || value.entries.some(entry => entry.ciphertext !== null) || value.reshipmentDestination.destination)) return fail('claim_contact_outcome_unknown');
    return fromDb('HistoryResponse', { requestId: input.requestId, viewerId: value.viewerId, sessionId: value.sessionId, orderId: value.orderId, claimId: value.claimId,
      viewerKind: value.viewerKind, piiAccess: value.piiAccess, current: { collection: targetView(codec, input, value.current.collection), reshipment: targetView(codec, input, value.current.reshipment) },
      entries: value.entries.map(entry => historyEntry(codec, input, entry, viewerKind === 'operator')), nextCursor: value.nextCursor,
      reshipmentDestination: finalDestination(codec, input, value.reshipmentDestination) });
  });
}
export async function fetchAdminClaimContactHistory(input: unknown) { return history(input, 'operator'); }
export async function fetchMyClaimContactHistory(input: unknown) { return history(input, 'customer'); }
