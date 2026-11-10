import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  claimContactDatabaseError, claimContactError, parseClaimContactContract,
  type ClaimContactContracts, type ClaimContactErrorCode, type ContactDataInventory, type ContactPurgeReceipt,
  type ErrorResponse, type RetentionCaseCommand, type RetentionCaseReceipt,
} from './contracts';

type InventoryRequest = { requestId: string; operation: 'inventory'; subjectId: string; limit: number; afterClaimId: string | null };
type CaseRequest = { requestId: string; operation: 'case'; orderId: string; claimId: string; operationId: string; expectedCaseRevision: number; case: RetentionCaseCommand };
type PurgeRequest = { requestId: string; operation: 'purge'; subjectId: string; operationId: string; cutoff: string; limit: number; confirmed: true };
export type ClaimContactRetentionRequest = InventoryRequest | CaseRequest | PurgeRequest;
export type ClaimContactRetentionResponse =
  | { requestId: string; operation: 'inventory'; data: ContactDataInventory }
  | { requestId: string; operation: 'case'; data: RetentionCaseReceipt }
  | { requestId: string; operation: 'purge'; data: ContactPurgeReceipt };

class RetentionError extends Error {
  constructor(readonly code: ClaimContactErrorCode) { super(code); this.name = 'ClaimContactRetentionError'; }
}
function fail(code: ClaimContactErrorCode): never { throw new RetentionError(code); }
function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).every(key => {
    const property = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && property?.enumerable === true && 'value' in property;
  });
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
function parse<N extends keyof ClaimContactContracts>(name: N, value: unknown): ClaimContactContracts[N] {
  return parseClaimContactContract(name, value) ?? fail('invalid_claim_contact_request');
}
function fromDb<N extends keyof ClaimContactContracts>(name: N, value: unknown): ClaimContactContracts[N] {
  return parseClaimContactContract(name, value) ?? fail('claim_contact_outcome_unknown');
}
function limit(value: unknown, maximum: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= maximum ? value : fail('invalid_claim_contact_request');
}
/** Match PostgreSQL's six-digit precision without rounding away binding changes. */
function micros(value: string): bigint | null {
  if (!parseClaimContactContract('Instant', value)) return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  return match ? BigInt(Date.parse(`${match[1]}${match[3]}`)) * BigInt(1000) + BigInt((match[2] ?? '').padEnd(6, '0')) : null;
}
function sameInstant(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  const first = micros(left), second = micros(right);
  return first !== null && second !== null && first === second;
}
function parseRequest(raw: unknown): ClaimContactRetentionRequest {
  if (!record(raw)) return fail('invalid_claim_contact_request');
  const requestId = parse('Uuid', raw.requestId);
  if (raw.operation === 'inventory' && keys(raw, ['requestId', 'operation', 'subjectId', 'limit', 'afterClaimId'])) {
    return { requestId, operation: 'inventory', subjectId: parse('Uuid', raw.subjectId), limit: limit(raw.limit, 1000),
      afterClaimId: raw.afterClaimId === null ? null : parse('Uuid', raw.afterClaimId) };
  }
  if (raw.operation === 'case' && keys(raw, ['requestId', 'operation', 'orderId', 'claimId', 'operationId', 'expectedCaseRevision', 'case'])) {
    const command = parse('RetentionCaseCommand', raw.case), revision = parse('Revision', raw.expectedCaseRevision);
    const occurred = micros(command.occurredAt), until = command.retainUntil === null ? null : micros(command.retainUntil);
    // DB still checks state and deadlines after its replay lookup. An expired
    // hold must remain replayable with its original operation ID and payload.
    if (revision === Number.MAX_SAFE_INTEGER || occurred === null || occurred > BigInt(Date.now()) * BigInt(1000)
      || (command.retainUntil !== null && (until === null || until <= occurred))) return fail('invalid_claim_contact_request');
    return { requestId, operation: 'case', orderId: parse('Uuid', raw.orderId), claimId: parse('Uuid', raw.claimId),
      operationId: parse('Uuid', raw.operationId), expectedCaseRevision: revision, case: command };
  }
  if (raw.operation === 'purge' && keys(raw, ['requestId', 'operation', 'subjectId', 'operationId', 'cutoff', 'limit', 'confirmed'])) {
    const cutoff = parse('Instant', raw.cutoff), cutoffValue = micros(cutoff);
    if (raw.confirmed !== true || cutoffValue === null || cutoffValue > BigInt(Date.now()) * BigInt(1000)) return fail('invalid_claim_contact_request');
    return { requestId, operation: 'purge', subjectId: parse('Uuid', raw.subjectId), operationId: parse('Uuid', raw.operationId),
      cutoff, limit: limit(raw.limit, 100), confirmed: true };
  }
  return fail('invalid_claim_contact_request');
}

type Auth = { actorId: string; sessionId: string; service: ReturnType<typeof createServiceClient> };
async function authenticate(): Promise<Auth> {
  const client = await createClient(), user = await client.auth.getUser();
  if (user.error || !user.data.user || !parseClaimContactContract('Uuid', user.data.user.id)) return fail('auth_changed');
  const claims = await client.auth.getClaims();
  if (claims.error || !claims.data || claims.data.claims.sub !== user.data.user.id) return fail('auth_changed');
  const sessionId = parseClaimContactContract('Uuid', claims.data.claims.session_id);
  if (!sessionId) return fail('auth_changed');
  return { actorId: user.data.user.id, sessionId, service: createServiceClient() };
}
async function rpc(auth: Auth, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await auth.service.rpc(name, { ...args, p_actor_id: auth.actorId, p_session_id: auth.sessionId });
  if (result.error) return fail(claimContactDatabaseError(result.error.code, result.error.message).code as ClaimContactErrorCode);
  return result.data;
}
function identity(auth: Auth, value: { actorId: string; sessionId: string }): void {
  if (value.actorId !== auth.actorId || value.sessionId !== auth.sessionId) fail('claim_contact_outcome_unknown');
}

/** Manual, metadata-only maintenance. Each RPC rechecks live platform.manage
 * with adminOnly=true. This module never loads contact crypto or feature flags. */
export async function maintainClaimContactRetention(raw: unknown): Promise<ClaimContactRetentionResponse | ErrorResponse> {
  try {
    const input = parseRequest(raw), auth = await authenticate();
    if (input.operation === 'inventory') {
      const data = fromDb('ContactDataInventory', await rpc(auth, 'service_inventory_order_claim_contact_data', {
        p_subject_id: input.subjectId, p_limit: input.limit, p_after_claim_id: input.afterClaimId,
      }));
      identity(auth, data);
      if (data.subjectId !== input.subjectId || data.scopes.length > input.limit
        || data.scopes.some((scope, index) => scope.claimId <= (index === 0 ? input.afterClaimId ?? '' : data.scopes[index - 1].claimId))
        || (data.nextClaimId !== null && (data.scopes.length !== input.limit || data.nextClaimId !== data.scopes.at(-1)?.claimId))) {
        return fail('claim_contact_outcome_unknown');
      }
      return { requestId: input.requestId, operation: input.operation, data };
    }
    if (input.operation === 'case') {
      const data = fromDb('RetentionCaseReceipt', await rpc(auth, 'service_record_order_claim_contact_retention_case', {
        p_order_id: input.orderId, p_claim_id: input.claimId, p_operation_id: input.operationId,
        p_expected_case_revision: input.expectedCaseRevision, p_case: input.case,
      }));
      identity(auth, data);
      if (data.operationId !== input.operationId || data.orderId !== input.orderId || data.claimId !== input.claimId
        || data.caseRef !== input.case.caseRef || data.action !== input.case.action || data.legalBasis !== input.case.legalBasis
        || data.expectedRevision !== input.expectedCaseRevision || !sameInstant(data.occurredAt, input.case.occurredAt)
        || !sameInstant(data.retainUntil, input.case.retainUntil)
        || (data.action === 'release' && !sameInstant(data.releasedAt, input.case.occurredAt))
        || (data.action === 'close' && !sameInstant(data.caseClosedAt, input.case.occurredAt))
        || micros(data.recordedAt) === null || micros(data.occurredAt)! > micros(data.recordedAt)!) return fail('claim_contact_outcome_unknown');
      return { requestId: input.requestId, operation: input.operation, data };
    }
    const data = fromDb('ContactPurgeReceipt', await rpc(auth, 'service_purge_order_claim_contact_data', {
      p_subject_id: input.subjectId, p_operation_id: input.operationId, p_cutoff: input.cutoff, p_limit: input.limit,
    }));
    identity(auth, data);
    if (data.operationId !== input.operationId || data.subjectId !== input.subjectId || data.limit !== input.limit
      || !sameInstant(data.cutoff, input.cutoff) || micros(data.recordedAt) === null || micros(data.cutoff)! > micros(data.recordedAt)!
      || data.purgedTargetCount < data.purgedClaimIds.length
      || data.purgedTargetCount > data.purgedClaimIds.length * 2) return fail('claim_contact_outcome_unknown');
    return { requestId: input.requestId, operation: input.operation, data };
  } catch (error) {
    return claimContactError(error instanceof RetentionError ? error.code : 'claim_contact_outcome_unknown', record(raw) ? raw.requestId : null);
  }
}
