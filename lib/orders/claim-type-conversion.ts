import { isUuid } from '@/lib/uuid';
import { isOrderClaimStage, isOrderClaimType, normalizeRefundAccount, type OrderClaimStage, type OrderClaimType, type RefundAccountInput } from './claims';
export type ConvertibleClaimType = 'return' | 'exchange';
export interface ClaimTypeHistory { id: string; claimId: string; fromType: ConvertibleClaimType; toType: ConvertibleClaimType; createdAt: string; agreement?: string }
export interface ClaimTypeContext {
  claimId: string; orderId: string; claimType: OrderClaimType; stage: OrderClaimStage; revision: number; allowed: boolean; blocker: string | null;
  bankRequired: boolean; savedAccount: { account: string; holder: string } | null; history: ClaimTypeHistory[];
}
export interface ClaimTypeRequest { id: string; claimId: string; revision: number; toType: ConvertibleClaimType; agreement: string; confirmed: true; refundAccount: RefundAccountInput | null }
export interface ClaimTypeReceipt extends ClaimTypeHistory { orderId: string; revision: number; stage: OrderClaimStage; agreement: string; accountSupplied: boolean }
export type ClaimTypeResult = { context: ClaimTypeContext } | { receipt: ClaimTypeReceipt | null } | { error: string; uncertain?: boolean; conflict?: boolean };
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const type = (v: unknown): v is ConvertibleClaimType => v === 'return' || v === 'exchange';
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const controls = /[\u0000-\u001f\u007f]/;
export function parseClaimTypeHistory(v: unknown): ClaimTypeHistory[] | null {
  if (!Array.isArray(v)) return null;
  const result: ClaimTypeHistory[] = [];
  for (const row of v) {
    if (!object(row) || !isUuid(row.id) || !isUuid(row.claimId) || !type(row.fromType) || !type(row.toType) || row.fromType === row.toType || !date(row.createdAt)
      || row.agreement !== undefined && typeof row.agreement !== 'string') return null;
    result.push({ id: row.id, claimId: row.claimId, fromType: row.fromType, toType: row.toType, createdAt: row.createdAt, ...(row.agreement === undefined ? {} : { agreement: row.agreement }) });
  }
  return result;
}
export function parseClaimTypeContext(v: unknown): ClaimTypeContext | null {
  if (!object(v) || !isUuid(v.claimId) || !isUuid(v.orderId) || !isOrderClaimType(v.claimType) || !isOrderClaimStage(v.stage) || !integer(v.revision)
    || typeof v.allowed !== 'boolean' || v.blocker !== null && typeof v.blocker !== 'string' || typeof v.bankRequired !== 'boolean') return null;
  if (v.savedAccount !== null && (!object(v.savedAccount) || typeof v.savedAccount.account !== 'string' || typeof v.savedAccount.holder !== 'string')) return null;
  const history = parseClaimTypeHistory(v.history); if (!history || history.some(row => row.claimId !== v.claimId)) return null;
  return { claimId: v.claimId, orderId: v.orderId, claimType: v.claimType, stage: v.stage, revision: v.revision, allowed: v.allowed, blocker: v.blocker as string | null,
    bankRequired: v.bankRequired, savedAccount: v.savedAccount === null ? null : { account: String(v.savedAccount.account), holder: String(v.savedAccount.holder) }, history };
}
export function parseClaimTypeReceipt(v: unknown): ClaimTypeReceipt | null {
  const history = parseClaimTypeHistory([v]);
  if (!history || !object(v) || !isUuid(v.orderId) || !integer(v.revision) || !isOrderClaimStage(v.stage) || typeof v.agreement !== 'string' || typeof v.accountSupplied !== 'boolean') return null;
  return { ...history[0], orderId: v.orderId, revision: v.revision, stage: v.stage, agreement: v.agreement, accountSupplied: v.accountSupplied };
}
export function normalizeClaimTypeRequest(v: unknown): ClaimTypeRequest | null {
  if (!object(v) || Object.keys(v).some(key => !['id','claimId','revision','toType','agreement','confirmed','refundAccount'].includes(key))
    || !isUuid(v.id) || !isUuid(v.claimId) || !integer(v.revision) || !type(v.toType) || v.confirmed !== true
    || typeof v.agreement !== 'string' || v.agreement.trim().length < 2 || v.agreement.trim().length > 500 || controls.test(v.agreement)) return null;
  if (v.refundAccount !== null && (!object(v.refundAccount) || Object.keys(v.refundAccount).some(key => !['bankName','accountNumber','accountHolder'].includes(key))
    || !['bankName','accountNumber','accountHolder'].every(key => typeof v.refundAccount === 'object' && v.refundAccount !== null && typeof (v.refundAccount as Record<string, unknown>)[key] === 'string'))) return null;
  const account = normalizeRefundAccount(v.refundAccount === null ? {} : {
    bankName: String(v.refundAccount.bankName), accountNumber: String(v.refundAccount.accountNumber), accountHolder: String(v.refundAccount.accountHolder),
  });
  if (!account.ok || account.value && (v.toType !== 'return' || Object.values(account.value).some(value => controls.test(value)))) return null;
  return { id: v.id.toLowerCase(), claimId: v.claimId.toLowerCase(), revision: v.revision, toType: v.toType, agreement: v.agreement.trim(), confirmed: true, refundAccount: account.value };
}
export function claimTypeReceiptMatches(receipt: ClaimTypeReceipt, request: ClaimTypeRequest) {
  return receipt.id === request.id && receipt.claimId === request.claimId && receipt.revision === request.revision && receipt.toType === request.toType
    && receipt.agreement === request.agreement && receipt.accountSupplied === Boolean(request.refundAccount);
}
export function claimTypeError(code?: string, message?: string): string {
  if (code === '42501') return '현재 계정과 판매관리 권한을 확인해주세요.';
  if (code === 'PT409') return '다른 처리가 먼저 진행됐습니다. 입력을 보존한 채 최신 요청을 확인해주세요.';
  const known: Record<string, string> = {
    claim_not_found: '해당 요청을 찾을 수 없습니다.', invalid_claim_conversion: '2~500자 고객 합의 근거와 전환 동의를 확인해주세요.',
    invalid_claim_conversion_account: '환불계좌의 은행, 계좌번호, 예금주를 확인해주세요.', claim_conversion_account_required: '무통장 주문을 반품으로 전환하려면 환불계좌가 필요합니다.',
    claim_conversion_same_type: '이미 같은 유형입니다. 최신 요청을 확인해주세요.', claim_conversion_type_unavailable: '반품과 교환 요청만 서로 전환할 수 있습니다.',
    claim_conversion_stage_unavailable: '환급·재출고 처리 또는 종결된 요청은 유형을 바꿀 수 없습니다.', claim_conversion_reshipped: '이미 교환품을 재출고하여 반품으로 전환할 수 없습니다.',
    claim_conversion_finance_started: '결제 취소나 환급 처리가 시작되어 유형을 바꿀 수 없습니다.', claim_conversion_request_conflict: '처음 보낸 내용과 다른 요청입니다. 기존 결과를 확인해주세요.',
  };
  return known[message ?? ''] ?? '결과를 확인하지 못했습니다. 같은 요청의 저장 결과를 확인해주세요.';
}
