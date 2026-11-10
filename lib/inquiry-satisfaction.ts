import { transactionExactKeys as keys, transactionInstant as instant, transactionInteger as integer, transactionRecord as record } from './goods-transaction-values';
import { isUuid } from './uuid';

export type InquirySatisfactionValue = 'satisfied' | 'dissatisfied' | null;
export const INQUIRY_SATISFACTION_LABELS = { satisfied: '만족', dissatisfied: '불만족', unrated: '미평가' } as const;
export interface InquirySatisfactionCurrent {
  inquiryId: string; answerId: string | null; answerCreatedAt: string | null;
  value: InquirySatisfactionValue; revision: number; ratedAt: string | null;
}
export interface MyInquirySatisfaction extends InquirySatisfactionCurrent {
  actorId: string; sessionId: string; canEvaluate: boolean;
  unavailableReason: 'no_answer' | 'account_unavailable' | null;
}
export interface InquirySatisfactionRequest {
  operationId: string; inquiryId: string; expectedActorId: string; expectedSessionId: string;
  expectedAnswerId: string; expectedRevision: number; desiredValue: InquirySatisfactionValue;
}
export interface InquirySatisfactionReceipt extends InquirySatisfactionRequest {
  beforeValue: InquirySatisfactionValue; afterValue: InquirySatisfactionValue;
  beforeRevision: number; afterRevision: number; outcome: 'changed' | 'unchanged'; createdAt: string;
}
export type InquirySatisfactionOperation =
  | { operation: 'completed'; receipt: InquirySatisfactionReceipt; current: MyInquirySatisfaction }
  | { operation: 'unresolved'; receipt: null; current: MyInquirySatisfaction };
export type InquirySatisfactionLoad = { ok: true; value: MyInquirySatisfaction } | { ok: false };
export type InquirySatisfactionActionResult = { ok: true; value: InquirySatisfactionOperation }
  | { ok: false; kind: 'unknown' | 'conflict' | 'unavailable' | 'invalid'; error: string };
export interface InquirySatisfactionSummary { satisfied: number; dissatisfied: number; unrated: number }
export interface AdminInquirySatisfactionHistory {
  operationId: string; answerId: string; beforeValue: InquirySatisfactionValue; afterValue: InquirySatisfactionValue;
  beforeRevision: number; afterRevision: number; outcome: 'changed' | 'unchanged'; createdAt: string;
}
export interface AdminInquirySatisfactionDetail { current: InquirySatisfactionCurrent; history: AdminInquirySatisfactionHistory[] }

const REQUEST_KEYS = ['operationId', 'inquiryId', 'expectedActorId', 'expectedSessionId', 'expectedAnswerId', 'expectedRevision', 'desiredValue'] as const;
const CURRENT_KEYS = ['inquiryId', 'answerId', 'answerCreatedAt', 'value', 'revision', 'ratedAt'] as const;
const value = (input: unknown): input is InquirySatisfactionValue => input === null || input === 'satisfied' || input === 'dissatisfied';
const maybeInstant = (input: unknown) => input === null || instant(input);

export function parseInquirySatisfactionRequest(input: unknown): InquirySatisfactionRequest | null {
  if (!record(input) || !keys(input, REQUEST_KEYS) || !isUuid(input.operationId) || !isUuid(input.inquiryId)
    || !isUuid(input.expectedActorId) || !isUuid(input.expectedSessionId) || !isUuid(input.expectedAnswerId)
    || !integer(input.expectedRevision) || !value(input.desiredValue)) return null;
  return { operationId: input.operationId.toLowerCase(), inquiryId: input.inquiryId.toLowerCase(), expectedActorId: input.expectedActorId.toLowerCase(),
    expectedSessionId: input.expectedSessionId.toLowerCase(), expectedAnswerId: input.expectedAnswerId.toLowerCase(), expectedRevision: input.expectedRevision, desiredValue: input.desiredValue };
}
export function parseInquirySatisfactionCurrent(input: unknown): InquirySatisfactionCurrent | null {
  if (!record(input) || !keys(input, CURRENT_KEYS) || !isUuid(input.inquiryId) || !(input.answerId === null || isUuid(input.answerId))
    || !maybeInstant(input.answerCreatedAt) || !maybeInstant(input.ratedAt) || !integer(input.revision) || !value(input.value)
    || (input.answerId === null) !== (input.answerCreatedAt === null)
    || (input.value === null) !== (input.ratedAt === null) || input.answerId === null && input.value !== null) return null;
  return input as unknown as InquirySatisfactionCurrent;
}
export function parseMyInquirySatisfaction(input: unknown): MyInquirySatisfaction | null {
  if (!record(input) || !keys(input, [...CURRENT_KEYS, 'actorId', 'sessionId', 'canEvaluate', 'unavailableReason'])
    || !isUuid(input.actorId) || !isUuid(input.sessionId) || typeof input.canEvaluate !== 'boolean'
    || !(input.unavailableReason === null || input.unavailableReason === 'no_answer' || input.unavailableReason === 'account_unavailable')
    || input.canEvaluate !== (input.unavailableReason === null)
    || input.canEvaluate && input.answerId === null || input.unavailableReason === 'no_answer' && input.answerId !== null) return null;
  const current = parseInquirySatisfactionCurrent(Object.fromEntries(CURRENT_KEYS.map(key => [key, input[key]])));
  return current ? { ...current, actorId: input.actorId, sessionId: input.sessionId,
    canEvaluate: input.canEvaluate, unavailableReason: input.unavailableReason as MyInquirySatisfaction['unavailableReason'] } : null;
}
export function parseInquirySatisfactionReceipt(input: unknown): InquirySatisfactionReceipt | null {
  if (!record(input) || !keys(input, [...REQUEST_KEYS, 'beforeValue', 'afterValue', 'beforeRevision', 'afterRevision', 'outcome', 'createdAt'])) return null;
  const request = parseInquirySatisfactionRequest(Object.fromEntries(REQUEST_KEYS.map(key => [key, input[key]])));
  if (!request || !value(input.beforeValue) || !value(input.afterValue) || !integer(input.beforeRevision) || !integer(input.afterRevision)
    || !instant(input.createdAt) || !['changed', 'unchanged'].includes(input.outcome as string)
    || input.afterValue !== request.desiredValue || input.beforeRevision !== request.expectedRevision
    || input.outcome === 'changed' && (input.beforeValue === input.afterValue || input.afterRevision !== input.beforeRevision + 1)
    || input.outcome === 'unchanged' && (input.beforeValue !== input.afterValue || input.afterRevision !== input.beforeRevision)) return null;
  return input as unknown as InquirySatisfactionReceipt;
}
export function parseInquirySatisfactionOperation(input: unknown, request: InquirySatisfactionRequest): InquirySatisfactionOperation | null {
  if (!record(input) || !keys(input, ['operation', 'receipt', 'current'])) return null;
  const current = parseMyInquirySatisfaction(input.current);
  if (!current || current.inquiryId !== request.inquiryId || current.actorId !== request.expectedActorId || current.sessionId !== request.expectedSessionId) return null;
  if (input.operation === 'unresolved' && input.receipt === null) return { operation: 'unresolved', receipt: null, current };
  const receipt = parseInquirySatisfactionReceipt(input.receipt);
  if (input.operation !== 'completed' || !receipt || REQUEST_KEYS.some(key => receipt[key] !== request[key])) return null;
  // A historical receipt never overwrites the independently read current state.
  return { operation: 'completed', receipt, current };
}
export function parseInquirySatisfactionSummary(input: unknown): InquirySatisfactionSummary | null {
  return record(input) && keys(input, ['satisfied', 'dissatisfied', 'unrated'])
    && integer(input.satisfied) && integer(input.dissatisfied) && integer(input.unrated)
    ? input as unknown as InquirySatisfactionSummary : null;
}
export function inquirySatisfactionPercent(summary: InquirySatisfactionSummary): number | null {
  const responses = summary.satisfied + summary.dissatisfied;
  return responses ? Math.round(summary.satisfied / responses * 1000) / 10 : null;
}
export function parseAdminInquirySatisfactionDetail(input: unknown): AdminInquirySatisfactionDetail | null {
  if (!record(input) || !keys(input, ['current', 'history']) || !Array.isArray(input.history) || input.history.length > 20) return null;
  const current = parseInquirySatisfactionCurrent(input.current);
  if (!current || !input.history.every(row => record(row) && keys(row, ['operationId', 'answerId', 'beforeValue', 'afterValue', 'beforeRevision', 'afterRevision', 'outcome', 'createdAt'])
    && isUuid(row.operationId) && isUuid(row.answerId) && value(row.beforeValue) && value(row.afterValue)
    && integer(row.beforeRevision) && integer(row.afterRevision) && instant(row.createdAt)
    && (row.outcome === 'changed' && row.beforeValue !== row.afterValue && row.afterRevision === row.beforeRevision + 1
      || row.outcome === 'unchanged' && row.beforeValue === row.afterValue && row.afterRevision === row.beforeRevision))) return null;
  return { current, history: input.history as AdminInquirySatisfactionHistory[] };
}
