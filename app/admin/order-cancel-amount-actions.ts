'use server';

import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { parseOrderPartialCancellationContext } from '@/lib/orders/partial-cancellation';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

/** `amount`가 지금 전액 취소를 실행하면 결제사에 취소를 요청하는 금액, `paidAmount`가 결제 금액이다. 읽지 못하면 금액 없이 ok false다. */
export type AdminOrderFullCancelAmountState =
  | { ok: true; amount: number; paidAmount: number }
  | { ok: false };

const amountOf = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/**
 * 운영자 전액 취소 확인창에 적을 금액을 읽는다(읽기 전용 — 아무것도 바꾸지 않는다).
 *
 * 전액 취소는 결제 금액이 아니라 남은 결제 금액을 취소한다: DB(admin_start_order_cancellation)가 환불 기록에 적는 금액도,
 * 서버가 결제사에 보내는 금액도 `결제완료 결제 금액 − 이미 적용된 부분 취소 금액`이다(재고 부족 부분 취소 원장). 주문 목록은
 * 부분 취소 금액을 받지 않으므로, 누르는 시점에 결제완료 결제와 그 주문의 부분 취소 기록을 읽어 같은 계산을 한다.
 * 권한은 전액 취소와 같다(판매 관리).
 */
export async function readOrderFullCancelAmountAction(orderId: string): Promise<AdminOrderFullCancelAmountState> {
  if (!await requireAdminActionAccess('/admin/sales/orders', { capability: 'sales.manage' })) return { ok: false };
  const id = typeof orderId === 'string' ? orderId.toLowerCase() : '';
  if (!isUuid(id)) return { ok: false };
  try {
    const supabase = await createClient();
    const [payments, partial] = await Promise.all([
      supabase.from('payment_summaries').select('amount,status').eq('purpose', 'order').eq('ref_id', id),
      supabase.rpc('admin_order_partial_cancellation_context', { p_order_id: id }),
    ]);
    if (payments.error || partial.error || !Array.isArray(payments.data)) return { ok: false };
    const paid = (payments.data as { amount: unknown; status: unknown }[]).filter((payment) => payment.status === 'paid');
    if (!paid.length) return { ok: false };
    let paidAmount = 0;
    for (const payment of paid) {
      const value = amountOf(payment.amount);
      if (value === null) return { ok: false };
      paidAmount += value;
    }
    /* 적용된(applied) 부분 취소만 결제사에서 이미 돌려준 금액이다. 진행 중·거절된 기록은 세지 않는다 — DB와 같다. */
    const alreadyCanceled = parseOrderPartialCancellationContext(partial.data).history
      .filter((record) => record.appliedAt !== null)
      .reduce((sum, record) => sum + record.refundAmount, 0);
    const amount = paidAmount - alreadyCanceled;
    return Number.isSafeInteger(amount) && amount >= 0 ? { ok: true, amount, paidAmount } : { ok: false };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false };
  }
}
