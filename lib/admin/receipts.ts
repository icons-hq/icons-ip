/*
 * 증빙 — 현금영수증 · 세금계산서 (D-3).
 *
 * 이 화면의 목적은 「발급했다」가 아니라 **「발급해야 하는데 아직 안 한 건이 무엇인가」**다.
 * 전자상거래 소매업은 현금영수증 의무발행업종이라, 10만 원 이상 현금성 거래를 5일 안에
 * 발급하지 않으면 가산세가 붙는다. 그래서 미발급 목록이 먼저 온다.
 */

export const CASH_RECEIPT_KINDS = [
  { value: 'income_deduction', label: '소득공제 (개인)' },
  { value: 'expense_proof', label: '지출증빙 (사업자)' },
  { value: 'self_issued', label: '자진발급 (번호 모름)' },
] as const;

export type CashReceiptKind = (typeof CASH_RECEIPT_KINDS)[number]['value'];

export const CASH_RECEIPT_KIND_LABELS: Record<string, string> = Object.fromEntries(
  CASH_RECEIPT_KINDS.map((kind) => [kind.value, kind.label]),
);

export const CASH_RECEIPT_STATUS_LABELS: Record<string, string> = {
  queued: '발급 대기',
  requested: '발급 요청 중',
  issued: '발급 완료',
  failed: '발급 실패',
  canceled: '취소',
};

export const TAX_INVOICE_STATUS_LABELS: Record<string, string> = {
  requested: '신청 접수',
  approved: '승인 (발행 대기)',
  issued: '발행 완료',
  rejected: '거절',
};

/** 의무발행 구간. 이 금액 이상은 요청이 없어도 발급해야 한다. */
export const CASH_RECEIPT_MANDATORY_AMOUNT = 100000;

export interface AdminCashReceipt {
  id: string;
  orderId: string;
  orderNo: string | null;
  kind: string;
  status: string;
  amount: number;
  identityMasked: string | null;
  receiptNumber: string | null;
  receiptUrl: string | null;
  errorMessage: string | null;
  requestedAt: string;
  issuedAt: string | null;
}

export interface AdminTaxInvoiceRequest {
  id: string;
  orderId: string;
  orderNo: string | null;
  status: string;
  businessNumber: string;
  businessName: string;
  approvalNumber: string | null;
  issuedAt: string | null;
  note: string | null;
  requestedAt: string;
}

export interface AdminPendingCashReceipt {
  orderId: string;
  orderNo: string;
  total: number;
  mandatory: boolean;
  dueAt: string;
  createdAt: string;
}

export interface AdminReceiptsConsoleData {
  pending: AdminPendingCashReceipt[];
  receipts: AdminCashReceipt[];
  invoices: AdminTaxInvoiceRequest[];
  /** 만료 판정 기준 시각(서버가 만든 ISO 문자열). 렌더 중에 시계를 읽지 않는다. */
  now: string;
}

/** 사업자번호 표기. 저장은 숫자 10자리, 화면은 사람이 읽는 모양이다. */
export function formatBusinessNumber(value: string): string {
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length !== 10) return value;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/** 남은 날. 음수면 이미 지났다는 뜻이라 그대로 보여준다. */
export function daysUntil(dueAt: string, now: string): number {
  const due = Date.parse(dueAt);
  const from = Date.parse(now);
  if (Number.isNaN(due) || Number.isNaN(from)) return 0;
  return Math.ceil((due - from) / 86_400_000);
}
