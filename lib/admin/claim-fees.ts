import { CLAIM_FEE_STATES, type ClaimFeeKind, type ClaimFeePolicy, type ClaimFeeState } from '@/lib/orders/claim-fees';
import { transactionExactKeys as keys, transactionInteger as integer, transactionRecord as record } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
import { isCommerceNumber } from '@/lib/commerce-number';
import { CHANGED_BY_OTHER, SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { krwAmountWords } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/orders';
import { returnFeeDeductionBasisLabel } from '@/lib/claims/return-fee-deduction';
import { objectParticle } from '@/lib/korean-particle';
import type { AdminClaimPartialReturn } from '@/lib/orders/partial-return';
export const CLAIM_FEES_PATH = '/admin/sales/claims/returns/fees';

/*
 * 배송비 청구(고객이 따로 입금하는 반품·교환 배송비)의 어드민 화면 말.
 * 고객 화면과 함께 쓰는 이름표(lib/orders/claim-fees.ts의 CLAIM_FEE_STATES·CLAIM_FEE_ACTIONS·claimFeeError)는 고객이 보는 글자라
 * 고치지 않는다. 어드민에서만 다르게 말해야 하는 것은 여기에 둔다.
 * 환불 금액에서 빼는 '반품배송비 차감'과는 다른 일이다(CONTEXT.md).
 */
/** 두 화면의 이름. 설정·내역을 가리키는 말은 이 둘뿐이다. */
export const CLAIM_FEE_SETTINGS_LABEL = '배송비 청구 설정';
export const CLAIM_FEE_LIST_LABEL = '배송비 청구 내역';
/** 요청 상세의 '반품·교환 배송비' 칸에서 새 청구를 여는 버튼. 설정 화면의 문장도 이 이름을 그대로 쓴다. */
export const CLAIM_FEE_ISSUE_LABEL = '새 배송비 청구';
/** 설정의 두 선택지. */
export const CLAIM_FEE_MODE_LABELS = { off: '쓰지 않음', on: '고객과 합의한 요청에만 직접 청구' } as const;
export const CLAIM_FEE_SETTINGS_SAVE_LABEL = '설정 저장';
/** 입금 받을 계좌를 등록하는 곳(판매자 정보 관리 > 무통장 계좌)과 그리로 가는 버튼. */
export const CLAIM_FEE_BANK_ACCOUNT_PATH = '/admin/settings/store?section=bank_transfer';
export const CLAIM_FEE_BANK_ACCOUNT_LINK_LABEL = '무통장 계좌 등록하러 가기';
export const CLAIM_FEE_PAYER_LABEL = '입금할 사람';
export const CLAIM_FEE_PAYER_LABELS = { buyer: '원 주문 구매자', requester: '반품·교환 요청자' } as const;
export const CLAIM_FEE_MAX_AMOUNT = 1000000;

/** 설정에서 운영자가 정하는 값. 저장할 때 보내는 것은 이 셋뿐이다(근거·확인 체크는 없앴다 — DB 20261127101000). */
export type ClaimFeePolicyValues = { enabled: boolean; returnAmount: number | null; exchangeAmount: number | null };
export const claimFeePolicyValues = (policy: ClaimFeePolicyValues): ClaimFeePolicyValues => ({ enabled: policy.enabled, returnAmount: policy.returnAmount, exchangeAmount: policy.exchangeAmount });
export const sameClaimFeePolicyValues = (a: ClaimFeePolicyValues, b: ClaimFeePolicyValues) => a.enabled === b.enabled && a.returnAmount === b.returnAmount && a.exchangeAmount === b.exchangeAmount;
/** 금액 칸의 글자를 저장 값으로 바꾼다. 비우면 null(청구할 때 직접 적음), 1~1,000,000원 정수가 아니면 undefined. */
export function parseClaimFeePolicyAmount(text: string): number | null | undefined {
 const trimmed = text.trim();
 if (!trimmed) return null;
 return /^[1-9][0-9]*$/.test(trimmed) && Number(trimmed) <= CLAIM_FEE_MAX_AMOUNT ? Number(trimmed) : undefined;
}
export const CLAIM_FEE_POLICY_AMOUNT_ERROR = `기본 청구 금액은 1원부터 ${krwAmountWords(CLAIM_FEE_MAX_AMOUNT)}까지 원 단위 숫자로 적거나 비워 주세요.`;
const amountWords = (amount: number | null) => amount === null ? '없음' : krwAmountWords(amount);
/** 지금 저장된 설정을 한 줄로. 예: '고객과 합의한 요청에만 직접 청구 · 반품 3,000원 · 교환 없음'. */
export function claimFeePolicySummary(values: ClaimFeePolicyValues): string {
 return values.enabled ? `${CLAIM_FEE_MODE_LABELS.on} · 반품 ${amountWords(values.returnAmount)} · 교환 ${amountWords(values.exchangeAmount)}` : CLAIM_FEE_MODE_LABELS.off;
}
/** 금액 칸 아래 되읽기 한 줄. 기본 청구 금액은 청구 창의 금액 칸에 미리 채워질 뿐이고 청구할 때 고칠 수 있다. */
export function claimFeePolicyReadback(values: ClaimFeePolicyValues): string {
 const { returnAmount, exchangeAmount } = values, open = `[${CLAIM_FEE_ISSUE_LABEL}]를 누르면`;
 if (returnAmount !== null && exchangeAmount !== null) return `${open} 금액 칸에 반품 ${krwAmountWords(returnAmount)} · 교환 ${krwAmountWords(exchangeAmount)}이 미리 채워집니다. 청구할 때 고칠 수 있습니다.`;
 if (returnAmount !== null) return `${open} 반품은 금액 칸에 ${krwAmountWords(returnAmount)}이 미리 채워지고, 교환은 금액을 직접 적습니다.`;
 if (exchangeAmount !== null) return `${open} 교환은 금액 칸에 ${krwAmountWords(exchangeAmount)}이 미리 채워지고, 반품은 금액을 직접 적습니다.`;
 return `${open} 금액을 그때마다 직접 적습니다.`;
}
/**
 * 부분 반품 요청의 '반품·교환 배송비' 칸 안내(F-21). 주문 전체 반품은 `returnFeeDeductionFeePanelNote`가 환불 단계의 차감 판정을 읽어 말하지만,
 * 부분 반품의 차감은 부분 반품 칸(ClaimPartialReturnPanel)이 읽는 미리보기·부분 환불 원장에 있어, 이 안내가 없으면 두 칸이 반대로 말한다
 * (한 칸은 '반품배송비 차감 · 환불 예정', 다른 칸은 '환불 금액에서는 빼지 않습니다').
 *
 * 서버 규칙(private.claim_fee_document의 canIssue · partial_return_fee_deduction): 환불을 접수하기 전에는 [새 배송비 청구]가 열려 있지만 청구하면 그 반품은
 * 차감하지 않고(claim_fee_invoiced), 환불을 접수해 차감이 정해지면 청구가 막힌다(버튼이 그려지지 않는다). 그래서 차감 예정·확정이면 따로 청구하지 말라고 말하고,
 * 이미 청구해서 차감하지 않기로 바뀌었으면 그렇게 말한다. 차감이 없는 그 밖의 경우(null)는 칸의 기본 문장('환불 금액에서는 빼지 않습니다')이 맞다.
 */
export function partialReturnFeePanelNote(partialReturn: AdminClaimPartialReturn | null | undefined): string | null {
 if (!partialReturn) return null;
 const live = partialReturn.history.find(record => record.id === partialReturn.refundId) ?? null;
 const warning = '같은 반품배송비를 여기서 다시 청구하지 마세요.';
 if (live) {
  if (live.returnFeeDeduction <= 0) return null;
  const amount = krwAmountWords(live.returnFeeDeduction);
  return `이 반품은 반품배송비 ${amount}${objectParticle(amount)} ${live.state === 'completed' ? '환불액에서 뺐습니다' : '환불할 때 환불액에서 뺍니다'}. ${warning}`;
 }
 const preview = partialReturn.preview;
 if (!preview) return null;
 if (preview.returnFeeDeduction > 0) {
  const amount = krwAmountWords(preview.returnFeeDeduction);
  const basis = preview.returnFeeBasis ? `(${returnFeeDeductionBasisLabel({ basis: preview.returnFeeBasis, oneWayAmount: preview.returnFeeBasis === 'round_trip' ? preview.returnFeeDeduction / 2 : preview.returnFeeDeduction })})` : '';
  return `이 반품은 반품배송비 ${amount}${basis}${objectParticle(amount)} 환불할 때 환불액에서 뺍니다. ${warning}`;
 }
 if (preview.returnFeeReason === 'claim_fee_invoiced') return '이 반품은 여기서 청구한 배송비가 있어 환불액에서 반품배송비를 빼지 않습니다.';
 return null;
}
/**
 * 저장 전 확인창 본문: 바뀌는 값(이전 → 새)과, 언제부터 어떤 요청에 적용되는지.
 * 적용 범위는 DB로 확인한 사실만 적는다 — 금액은 청구할 때 운영자가 적은 값으로 청구 건마다 따로 저장돼 설정을 바꿔도 이미 청구한 금액은 그대로이고,
 * 사용 여부는 요청 상세가 열릴 때마다 지금 설정을 읽어 진행 중인 요청에도 바로 적용된다(끄면 새 청구만 막힌다).
 * 켜도 새 청구를 열 수 없는 요청: 끝난 요청, 받는 중인 청구가 이미 있는 요청, 반품배송비 차감이 정해진 반품(private.claim_fee_document의 canIssue).
 */
export function claimFeePolicyConfirmMessage(before: ClaimFeePolicyValues, after: ClaimFeePolicyValues): string {
 const changes: string[] = [], effects: string[] = ['저장하면 바로 적용됩니다.'];
 if (before.enabled !== after.enabled) changes.push(`배송비 청구: ${CLAIM_FEE_MODE_LABELS[before.enabled ? 'on' : 'off']} → ${CLAIM_FEE_MODE_LABELS[after.enabled ? 'on' : 'off']}`);
 if (before.returnAmount !== after.returnAmount) changes.push(`반품 기본 청구 금액: ${amountWords(before.returnAmount)} → ${amountWords(after.returnAmount)}`);
 if (before.exchangeAmount !== after.exchangeAmount) changes.push(`교환 기본 청구 금액: ${amountWords(before.exchangeAmount)} → ${amountWords(after.exchangeAmount)}`);
 if (!before.enabled && after.enabled) effects.push(`이미 접수돼 진행 중인 반품·교환 요청에도 요청 상세에서 [${CLAIM_FEE_ISSUE_LABEL}]를 쓸 수 있게 됩니다. 환불을 접수해 반품배송비를 환불액에서 빼기로 정해진 반품은 쓸 수 없고, 환불을 접수하기 전 반품에서 청구하면 그 반품은 환불액에서 반품배송비를 빼지 않습니다. 자동으로 청구되지는 않습니다.`);
 if (before.enabled && !after.enabled) effects.push('새로 청구할 수 없게 됩니다. 이미 청구한 건의 입금 확인·면제·취소·반환은 계속 할 수 있습니다.');
 if (after.enabled && (before.returnAmount !== after.returnAmount || before.exchangeAmount !== after.exchangeAmount)) effects.push(`새 금액은 지금부터 여는 [${CLAIM_FEE_ISSUE_LABEL}]의 금액 칸에 미리 채워집니다. 이미 청구한 배송비의 금액은 바뀌지 않습니다.`);
 return `${changes.join('\n')}\n\n${effects.join('\n')}`;
}
/** 다른 사람이 먼저 바꿨을 때: 지금 저장된 설정을 보여 주고, 적은 내용은 그대로 둔다. */
export const claimFeePolicyChangedMessage = (latest: ClaimFeePolicyValues) => `${CHANGED_BY_OTHER} 지금 저장된 설정은 '${claimFeePolicySummary(latest)}'입니다. 적은 내용으로 바꾸려면 다시 [${CLAIM_FEE_SETTINGS_SAVE_LABEL}]을 눌러 주세요.`;
export const CLAIM_FEE_POLICY_SAVED_MESSAGE = '배송비 청구 설정을 저장했습니다.';
export const CLAIM_FEE_POLICY_UNCHANGED_MESSAGE = '바뀐 내용이 없습니다.';
export const CLAIM_FEE_POLICY_NOT_SAVED_MESSAGE = `저장되지 않았습니다. 적은 내용은 그대로 있습니다. 다시 [${CLAIM_FEE_SETTINGS_SAVE_LABEL}]을 눌러 주세요.`;
export const CLAIM_FEE_POLICY_READ_FAILED_MESSAGE = `저장된 설정을 불러오지 못했습니다. 잠시 뒤 [${SAVE_CHECK_LABEL}]을 다시 눌러 주세요.`;
export const CLAIM_FEE_POLICY_ACCOUNT_MESSAGE = `입금 받을 계좌가 없어 '${CLAIM_FEE_MODE_LABELS.on}'로 저장하지 못했습니다. [${CLAIM_FEE_BANK_ACCOUNT_LINK_LABEL}]에서 은행·계좌번호·예금주를 등록한 뒤 다시 저장해 주세요.`;
export const CLAIM_FEE_POLICY_PERMISSION_MESSAGE = '로그인 상태나 판매 관리 권한이 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.';
/** 설정 저장·조회의 오류. saved: 'no'는 저장되지 않은 것이 분명한 경우, 'unknown'은 저장됐는지 모르는 경우. */
export type ClaimFeePolicyFailure = { error: string; saved: 'no' | 'unknown'; changed?: true; latest?: ClaimFeePolicy };
export function claimFeePolicyFailure(code?: string, message = ''): ClaimFeePolicyFailure {
 if (code === '42501') return { error: CLAIM_FEE_POLICY_PERMISSION_MESSAGE, saved: 'no' };
 if (message.includes('account_missing')) return { error: CLAIM_FEE_POLICY_ACCOUNT_MESSAGE, saved: 'no' };
 if (code === '22023') return { error: CLAIM_FEE_POLICY_AMOUNT_ERROR, saved: 'no' };
 if (code === 'PT409') return { error: `${CHANGED_BY_OTHER} 새로고침해 지금 저장된 설정을 확인한 뒤 다시 저장해 주세요.`, saved: 'no', changed: true };
 return { error: SAVE_UNKNOWN_MESSAGE, saved: 'unknown' };
}

/**
 * 요청 상세의 배송비 칸(운영자)이 저장 전에 띄우는 확인창. 확인 체크가 말하던 사실을 금액과 함께 묻는다.
 * 금액은 저장에 그대로 보내는 값이다. 청구는 고객의 주문 상세에 계좌와 함께 보이고, 그 밖의 기록은 이 칸의 상태만 바꾼다(은행 송금·결제 취소를 하지 않는다).
 */
export function claimFeeActionConfirm(kind: Exclude<ClaimFeeKind, 'report_payment'>, input: { amount: number; payerRole?: 'buyer' | 'requester'; state?: ClaimFeeState }): { title: string; message: string; confirmLabel: string; cancelLabel: string; destructive?: boolean } {
 const amount = krwAmountWords(input.amount), back = { cancelLabel: '돌아가기' };
 if (kind === 'issue') return { ...back, title: '배송비 청구', confirmLabel: '청구하기',
  message: `${CLAIM_FEE_PAYER_LABELS[input.payerRole ?? 'buyer']}에게 배송비 ${amount}을 청구합니다.\n고객 화면의 배송비 청구 내역에 금액·고객 안내·입금 받을 계좌가 보입니다. 알림은 따로 가지 않으니 고객에게 직접 알려 주세요.\n주문 환불 금액에서 빼는 것이 아니라 따로 입금받는 돈입니다.` };
 if (kind === 'confirm_payment') return { ...back, title: '실제 입금 확인', confirmLabel: '입금 확인 기록',
  message: input.state === 'voided' || input.state === 'waived'
   ? `취소·면제한 청구에 ${amount}이 입금된 것으로 기록합니다.\n받지 않기로 한 돈이라 '${CLAIM_FEE_STATES.refund_due}'로 바뀝니다. 고객에게 돌려준 뒤 [실제 반환 완료]를 기록해 주세요.`
   : `통장에서 ${amount} 전액이 들어온 것을 확인했을 때만 기록해 주세요.\n기록하면 '${CLAIM_FEE_STATES.paid}'으로 바뀌고, 되돌리려면 [청구 취소 · 반환 대기]로 돌려줘야 합니다.` };
 if (kind === 'waive') return { ...back, title: '청구 면제', confirmLabel: '면제하기', destructive: true,
  message: `배송비 ${amount}을 받지 않기로 합니다.\n면제한 청구는 다시 '${CLAIM_FEE_STATES.unpaid}'로 돌릴 수 없습니다. 다시 받아야 하면 새로 청구해야 합니다.` };
 if (kind === 'cancel') return { ...back, title: '청구 취소', confirmLabel: '청구 취소하기', destructive: true,
  message: input.state === 'paid'
   ? `입금이 확인된 배송비 ${amount}의 청구를 취소합니다.\n'${CLAIM_FEE_STATES.refund_due}'로 바뀝니다. 고객에게 ${amount}을 돌려준 뒤 [실제 반환 완료]를 기록해 주세요.`
   : `배송비 ${amount}의 청구를 취소합니다.\n취소한 청구는 다시 '${CLAIM_FEE_STATES.unpaid}'로 돌릴 수 없습니다. 다시 받아야 하면 새로 청구해야 합니다.` };
 return { ...back, title: '실제 반환 완료', confirmLabel: '반환 완료 기록',
  message: `고객에게 ${amount} 전액을 실제로 돌려줬을 때만 기록해 주세요.\n기록하면 '${CLAIM_FEE_STATES.refunded}'로 끝나고 되돌릴 수 없습니다. 이 기록이 은행 송금을 대신하지는 않습니다.` };
}
/** 운영자 저장 양식에서 필수 값이 빠졌을 때(확인 체크는 없다). */
export const CLAIM_FEE_ACTION_INPUT_ERROR = '금액, 실제 입금·반환한 시각, 근거를 확인해 주세요. 근거는 2자 이상 적습니다.';
/**
 * [실제 입금 확인]·[실제 반환 완료]의 시각 칸이 서버가 받아 주는 범위 밖이면 어느 칸이 왜 틀렸는지 저장 전에(확인창보다 먼저) 말한다.
 * 서버 규칙: 지금보다 1분 넘게 뒤일 수 없고, 청구한 시각보다 앞일 수 없고, 반환은 입금을 확인한 시각보다 앞일 수 없다.
 * 시각 칸은 분 단위라 청구한 바로 그 분을 적으면 청구한 초보다 앞이 되어 거절된다. 비었거나 읽을 수 없는 값은 여기서 다루지 않는다.
 */
export function claimFeeTimeProblem(
  kind: 'confirm_payment' | 'refund', occurredAt: string, invoice: { issuedAt: string; receivedAt: string | null } | null, now: number,
): string | null {
  const at = Date.parse(occurredAt);
  if (!Number.isFinite(at)) return null;
  const label = kind === 'refund' ? '실제 반환한 시각' : '실제 입금된 시각';
  if (at > now + 60_000) return `${label}이 지금보다 뒤입니다. 지금이거나 그 이전 시각으로 적어주세요.`;
  const issued = invoice ? Date.parse(invoice.issuedAt) : NaN;
  if (invoice && Number.isFinite(issued) && at < issued) {
    return `${label}이 청구한 시각(${formatOrderDateTime(invoice.issuedAt)})보다 앞입니다. 청구한 뒤의 시각으로 적어주세요. 같은 분이면 한 분 뒤로 적습니다.`;
  }
  const received = invoice?.receivedAt ? Date.parse(invoice.receivedAt) : NaN;
  if (kind === 'refund' && invoice?.receivedAt && Number.isFinite(received) && at < received) {
    return `${label}이 입금을 확인한 시각(${formatOrderDateTime(invoice.receivedAt)})보다 앞입니다. 입금을 확인한 뒤의 시각으로 적어주세요.`;
  }
  return null;
}
/**
 * 배송비 칸의 서버 오류 문구는 고객 화면과 함께 쓴다(claimFeeError). 운영자에게는 지금 화면의 버튼 이름과 고칠 방법으로 바꿔 보인다.
 * 모르는 문구는 그대로 돌려준다.
 */
export function adminClaimFeeErrorCopy(message: string): string {
 const known: Record<string, string> = {
  '이 배송비 청구를 확인할 수 없습니다.': '이 배송비 청구를 찾지 못했습니다. [배송비 청구 내역 확인]을 눌러 지금 상태를 다시 불러와 주세요.',
  '먼저 운영 설정에 입금 받을 법인계좌를 등록해주세요.': `입금 받을 계좌가 없어 청구할 수 없습니다. [${CLAIM_FEE_SETTINGS_LABEL}]의 [${CLAIM_FEE_BANK_ACCOUNT_LINK_LABEL}]에서 계좌를 등록한 뒤 다시 청구해 주세요.`,
  '금액·실제 처리시각·근거·확인 항목을 확인해주세요.': `${CLAIM_FEE_ACTION_INPUT_ERROR} 시각은 청구한 시각보다 뒤이고 지금보다 앞이어야 합니다.`,
  '요청 또는 배송비 상태가 바뀌었습니다. 현재 청구 내역을 다시 확인해주세요.': `${CHANGED_BY_OTHER} [배송비 청구 내역 확인]을 눌러 지금 상태를 본 뒤 다시 해 주세요.`,
  '처리 결과를 확인하지 못했습니다. 같은 요청으로 결과를 확인해주세요.': SAVE_UNKNOWN_MESSAGE,
  '저장은 확인했지만 최신 청구 상태를 읽지 못했습니다. 같은 요청으로 다시 확인해주세요.': `저장은 됐지만 지금 상태를 불러오지 못했습니다. [${SAVE_CHECK_LABEL}]을 누르면 같은 내용이 두 번 저장되지 않습니다.`,
 };
 return known[message] ?? message;
}
export const CLAIM_FEE_FILTERS = { open: '처리 대기', all: '전체', ...CLAIM_FEE_STATES } as const;
export type ClaimFeeFilter = keyof typeof CLAIM_FEE_FILTERS;
export type ClaimFeeQueueRow = { orderNumber?: string; id: string; claimId: string; orderId: string; claimType: 'return' | 'exchange'; amount: number; state: ClaimFeeState; payerRole: 'buyer' | 'requester'; issuedAt: string; receivedAt: string | null; refundedAt: string | null };
export type ClaimFeeQueue = { state: ClaimFeeFilter; page: number; pageSize: number; total: number; counts: Partial<Record<ClaimFeeState, number>>; rows: ClaimFeeQueueRow[] };
export const claimFeeQueueHref = (state: ClaimFeeFilter, page = 1) => `${CLAIM_FEES_PATH}?state=${state}&page=${page}`;
export function claimFeeQueueFilters(params: Record<string, string | string[] | undefined>) {
 const state = typeof params.state === 'string' && Object.hasOwn(CLAIM_FEE_FILTERS, params.state) ? params.state as ClaimFeeFilter : 'open';
 const page = typeof params.page === 'string' && /^[1-9][0-9]*$/.test(params.page) && Number(params.page) <= 50000 ? Number(params.page) : 1;
 return { state, page };
}
export function parseClaimFeeQueue(v: unknown): ClaimFeeQueue | null {
 const time = (a: unknown) => typeof a === 'string' && Number.isFinite(Date.parse(a));
 if (!record(v) || !keys(v, ['state', 'page', 'pageSize', 'total', 'counts', 'rows']) || typeof v.state !== 'string' || !Object.hasOwn(CLAIM_FEE_FILTERS, v.state)
  || !integer(v.page, 1, 50000) || v.pageSize !== 50 || !integer(v.total, 0) || !record(v.counts) || !Array.isArray(v.rows)
  || Object.entries(v.counts).some(([key, value]) => !Object.hasOwn(CLAIM_FEE_STATES, key) || !integer(value, 0))) return null;
 if (v.rows.length > 50 || v.rows.some(r => !record(r) || !keys(r, ['id', 'claimId', 'orderId', 'claimType', 'amount', 'state', 'payerRole', 'issuedAt', 'receivedAt', 'refundedAt', ...(Object.hasOwn(r, 'orderNumber') ? ['orderNumber'] : [])])
  || (r.orderNumber !== undefined && !isCommerceNumber(r.orderNumber, 'order')) || !isUuid(r.id) || !isUuid(r.claimId) || !isUuid(r.orderId) || !['return', 'exchange'].includes(r.claimType as string) || !integer(r.amount, 1, 1000000)
  || typeof r.state !== 'string' || !Object.hasOwn(CLAIM_FEE_STATES, r.state) || !['buyer', 'requester'].includes(r.payerRole as string)
  || !time(r.issuedAt) || ![r.receivedAt, r.refundedAt].every(a => a === null || time(a)))) return null;
 return v as ClaimFeeQueue;
}
