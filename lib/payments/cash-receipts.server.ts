import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import { getTossConfig, requestTossCashReceipt } from './toss-api';

/*
 * 현금영수증 워커 (D-3).
 *
 * 큐에서 하나 집어 발급하고 결과를 원장에 적는다. 성공도 실패도 값으로 적는다 —
 * 실패를 예외로 던져 버리면 「왜 안 나갔는지」가 로그에만 남고 화면에는 안 남는다.
 *
 * 토스 키가 없는 환경(로컬·미설정)에서는 발급을 시도하지 않고 큐에 되돌린다.
 * 실패로 적으면 키를 넣은 뒤에도 다시 시도되지 않는다 — 설정 문제와 발급 거절은 다른 일이다.
 */

interface CashReceiptRow {
  id: string;
  order_id: string;
  kind: string;
  amount: number;
  idempotency_key: string;
}

export interface CashReceiptWorkResult {
  claimed: number;
  receipt?: string;
  status?: string;
  error?: string;
}

export async function runCashReceiptJob(): Promise<CashReceiptWorkResult> {
  const supabase = createServiceClient();
  const claimed = await supabase.rpc('claim_cash_receipt_job');
  if (claimed.error) throw new Error(claimed.error.message);
  const receipt = ((claimed.data ?? []) as CashReceiptRow[])[0] ?? null;
  if (!receipt?.id) return { claimed: 0 };

  if (!getTossConfig().isConfigured) {
    await supabase.rpc('record_cash_receipt_result', {
      p_error_code: 'NOT_CONFIGURED',
      p_error_message: '토스 시크릿 키가 없어 발급을 보류했습니다.',
      p_receipt_id: receipt.id,
      p_status: 'queued',
    });
    return { claimed: 1, receipt: receipt.id, status: 'queued', error: 'NOT_CONFIGURED' };
  }

  const identity = await supabase.rpc('consume_cash_receipt_identity', { p_receipt_id: receipt.id });
  if (identity.error) throw new Error(identity.error.message);
  const registrationNumber = typeof identity.data === 'string' ? identity.data : '';
  if (!registrationNumber) {
    await supabase.rpc('record_cash_receipt_result', {
      p_error_code: 'IDENTITY_MISSING',
      p_error_message: '식별번호가 없습니다. 다시 신청해주세요.',
      p_receipt_id: receipt.id,
      p_status: 'failed',
    });
    return { claimed: 1, receipt: receipt.id, status: 'failed', error: 'IDENTITY_MISSING' };
  }

  const result = await requestTossCashReceipt({
    amount: receipt.amount,
    idempotencyKey: receipt.idempotency_key,
    orderId: receipt.order_id,
    orderName: `주문 ${receipt.order_id}`,
    registrationNumber,
    type: receipt.kind === 'expense_proof' ? '지출증빙' : '소득공제',
  });

  if (!result.ok) {
    await supabase.rpc('record_cash_receipt_result', {
      p_error_code: result.code,
      p_error_message: result.message,
      p_receipt_id: receipt.id,
      p_status: 'failed',
    });
    return { claimed: 1, receipt: receipt.id, status: 'failed', error: result.code };
  }

  const body = (result.body ?? {}) as { receiptKey?: unknown; receiptUrl?: unknown; approvalNumber?: unknown };
  await supabase.rpc('record_cash_receipt_result', {
    p_error_code: null,
    p_error_message: null,
    p_receipt_id: receipt.id,
    p_receipt_key: typeof body.receiptKey === 'string' ? body.receiptKey : null,
    p_receipt_number: typeof body.approvalNumber === 'string' ? body.approvalNumber : null,
    p_receipt_url: typeof body.receiptUrl === 'string' ? body.receiptUrl : null,
    p_status: 'issued',
  });
  return { claimed: 1, receipt: receipt.id, status: 'issued' };
}
