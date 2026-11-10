import { isUuid } from '@/lib/uuid';
import { isCsReplySurface, type CsReplySurface } from './cs-reply-tools';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export function isCsReplyRevision(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= BigInt('9223372036854775807');
}
export interface CsReplyOperation {
  operationId: string; accountId: string; surface: CsReplySurface; id: string; body: string; expectedRevision: string;
}
export interface CsReplyReceipt extends CsReplyOperation { revision: string; changed: boolean; savedAt: string }
export type CsReplyOutcome = { kind: 'saved'; receipt: CsReplyReceipt }
  | { kind: 'conflict' | 'rejected' | 'uncertain'; error: string };
export interface CsReplyActionResult {
  errors?: { form?: string }; message?: string; resultKey?: string; replyOutcome?: CsReplyOutcome;
}
export function parseCsReplyOperation(value: unknown): CsReplyOperation | null {
  if (!record(value) || !isUuid(value.operationId) || !isUuid(value.accountId) || !isUuid(value.id)
    || !isCsReplySurface(value.surface) || !isCsReplyRevision(value.expectedRevision) || typeof value.body !== 'string'
    || value.body !== value.body.trim() || [...value.body].length < (value.surface === 'review' ? 2 : 1)
    || [...value.body].length > (value.surface === 'review' ? 1000 : 2000)) return null;
  return { operationId: value.operationId.toLowerCase(), accountId: value.accountId.toLowerCase(), id: value.id.toLowerCase(),
    surface: value.surface, expectedRevision: value.expectedRevision, body: value.body };
}
export function parseCsReplyReceipt(value: unknown, operation: CsReplyOperation): CsReplyReceipt | null {
  const parsed = parseCsReplyOperation(value);
  if (!parsed || !record(value) || !isCsReplyRevision(value.revision) || typeof value.changed !== 'boolean'
    || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))
    || Object.keys(operation).some(key => parsed[key as keyof CsReplyOperation] !== operation[key as keyof CsReplyOperation])
    || BigInt(value.revision) !== BigInt(operation.expectedRevision) + BigInt(value.changed ? 1 : 0)) return null;
  return { ...parsed, revision: value.revision, changed: value.changed, savedAt: value.savedAt };
}
export function csReplyRpcArguments(operation: CsReplyOperation) {
  return { p_operation_id: operation.operationId, p_actor_id: operation.accountId, p_surface: operation.surface,
    p_target_id: operation.id, p_body: operation.body, p_expected_revision: operation.expectedRevision };
}
