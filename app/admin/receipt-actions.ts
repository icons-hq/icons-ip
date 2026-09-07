'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { preserveValues } from '@/lib/admin/form-values';

/* 증빙 액션 — 현금영수증 · 세금계산서 (D-3). */

const RECEIPTS_PATH = '/admin/sales/receipts';

export interface AdminReceiptActionState {
  error?: string;
  message?: string;
  /** 저장이 실패했을 때 제출됐던 문자열 필드. `SeededForm` 이 이 값으로 다시 시드한다. */
  values?: Record<string, string>;
}

async function requireStaff(): Promise<AdminReceiptActionState | null> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isStaff) return { error: '권한이 없습니다.' };
  return null;
}

function receiptErrorMessage(raw: string) {
  if (raw.includes('tax_invoice_exists')) return '이 주문은 세금계산서를 신청했습니다. 같은 거래에 증빙은 하나입니다.';
  if (raw.includes('cash_receipt_exists')) return '이 주문은 현금영수증이 있습니다. 먼저 취소해주세요.';
  if (raw.includes('cash_receipt_already_active')) return '이미 발급 중이거나 발급된 영수증이 있습니다.';
  if (raw.includes('identity_required')) return '식별번호(휴대폰·사업자번호)를 적어주세요.';
  if (raw.includes('business_number_invalid')) return '사업자번호는 숫자 10자리입니다.';
  if (raw.includes('approval_number_taken')) return '이미 쓰인 승인번호입니다.';
  if (raw.includes('approval_number_invalid')) return '승인번호를 확인해주세요.';
  if (raw.includes('tax_invoice_not_approved')) return '승인한 뒤에 발행 결과를 적을 수 있습니다.';
  if (raw.includes('tax_invoice_not_decidable')) return '이미 처리한 신청입니다.';
  if (raw.includes('order_not_found')) return '주문을 찾을 수 없습니다.';
  return '처리하지 못했습니다. 최신 상태를 확인해주세요.';
}

export async function requestCashReceiptAction(_state: AdminReceiptActionState,
  formData: FormData,): Promise<AdminReceiptActionState> {
  return preserveValues(formData, () => run_requestCashReceiptAction(_state, formData));
}

async function run_requestCashReceiptAction(_state: AdminReceiptActionState,
  formData: FormData,): Promise<AdminReceiptActionState> {
  const denied = await requireStaff();
  if (denied) return denied;

  const orderId = String(formData.get('orderId') ?? '').trim();
  const kind = String(formData.get('kind') ?? '').trim();
  if (!orderId) return { error: '주문을 찾을 수 없습니다.' };
  if (kind !== 'income_deduction' && kind !== 'expense_proof' && kind !== 'self_issued') {
    return { error: '발급 유형을 골라주세요.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_request_cash_receipt', {
    p_identity_number: String(formData.get('identityNumber') ?? '').trim() || null,
    p_kind: kind,
    p_order_id: orderId,
  });
  if (error) return { error: receiptErrorMessage(error.message) };

  revalidatePath(RECEIPTS_PATH);
  return { message: '발급을 신청했습니다. 잠시 뒤 발급 결과가 표시됩니다.' };
}

export async function cancelCashReceiptAction(_state: AdminReceiptActionState,
  formData: FormData,): Promise<AdminReceiptActionState> {
  return preserveValues(formData, () => run_cancelCashReceiptAction(_state, formData));
}

async function run_cancelCashReceiptAction(_state: AdminReceiptActionState,
  formData: FormData,): Promise<AdminReceiptActionState> {
  const denied = await requireStaff();
  if (denied) return denied;

  const receiptId = String(formData.get('receiptId') ?? '').trim();
  if (!receiptId) return { error: '영수증을 찾을 수 없습니다.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_cancel_cash_receipt', {
    p_reason: String(formData.get('reason') ?? '').trim() || null,
    p_receipt_id: receiptId,
  });
  if (error) return { error: receiptErrorMessage(error.message) };

  revalidatePath(RECEIPTS_PATH);
  return { message: '현금영수증을 취소했습니다.' };
}

export async function recordTaxInvoiceRequestAction(_state: AdminReceiptActionState,
  formData: FormData,): Promise<AdminReceiptActionState> {
  return preserveValues(formData, () => run_recordTaxInvoiceRequestAction(_state, formData));
}

async function run_recordTaxInvoiceRequestAction(_state: AdminReceiptActionState,
  formData: FormData,): Promise<AdminReceiptActionState> {
  const denied = await requireStaff();
  if (denied) return denied;

  const orderId = String(formData.get('orderId') ?? '').trim();
  const businessName = String(formData.get('businessName') ?? '').trim();
  if (!orderId) return { error: '주문을 찾을 수 없습니다.' };
  if (!businessName) return { error: '상호를 적어주세요.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_record_tax_invoice_request', {
    p_business_name: businessName,
    p_business_number: String(formData.get('businessNumber') ?? '').trim(),
    p_email: String(formData.get('email') ?? '').trim() || null,
    p_order_id: orderId,
    p_representative_name: String(formData.get('representativeName') ?? '').trim() || null,
  });
  if (error) return { error: receiptErrorMessage(error.message) };

  revalidatePath(RECEIPTS_PATH);
  return { message: '세금계산서 신청을 접수했습니다.' };
}

export async function decideTaxInvoiceAction(_state: AdminReceiptActionState,
  formData: FormData,): Promise<AdminReceiptActionState> {
  return preserveValues(formData, () => run_decideTaxInvoiceAction(_state, formData));
}

async function run_decideTaxInvoiceAction(_state: AdminReceiptActionState,
  formData: FormData,): Promise<AdminReceiptActionState> {
  const denied = await requireStaff();
  if (denied) return denied;

  const requestId = String(formData.get('requestId') ?? '').trim();
  const decision = String(formData.get('decision') ?? '').trim();
  if (!requestId) return { error: '신청을 찾을 수 없습니다.' };
  if (decision !== 'approve' && decision !== 'reject') return { error: '처리를 골라주세요.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_decide_tax_invoice', {
    p_decision: decision,
    p_note: String(formData.get('note') ?? '').trim() || null,
    p_request_id: requestId,
  });
  if (error) return { error: receiptErrorMessage(error.message) };

  revalidatePath(RECEIPTS_PATH);
  return { message: decision === 'approve' ? '승인했습니다. 스마트빌에서 발행한 뒤 승인번호를 적어주세요.' : '거절했습니다.' };
}

export async function recordTaxInvoiceIssuedAction(_state: AdminReceiptActionState,
  formData: FormData,): Promise<AdminReceiptActionState> {
  return preserveValues(formData, () => run_recordTaxInvoiceIssuedAction(_state, formData));
}

async function run_recordTaxInvoiceIssuedAction(_state: AdminReceiptActionState,
  formData: FormData,): Promise<AdminReceiptActionState> {
  const denied = await requireStaff();
  if (denied) return denied;

  const requestId = String(formData.get('requestId') ?? '').trim();
  const approvalNumber = String(formData.get('approvalNumber') ?? '').trim();
  if (!requestId) return { error: '신청을 찾을 수 없습니다.' };
  if (!approvalNumber) return { error: '승인번호를 적어주세요.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_record_tax_invoice_issued', {
    p_approval_number: approvalNumber,
    p_issued_at: null,
    p_request_id: requestId,
  });
  if (error) return { error: receiptErrorMessage(error.message) };

  revalidatePath(RECEIPTS_PATH);
  return { message: '발행 결과를 기록했습니다.' };
}
