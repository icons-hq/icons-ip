import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  parseMyOrderRefundDeduction,
  parseReturnFeeDeductionPolicy,
  type MyOrderRefundDeduction,
  type ReturnFeeDeductionPolicy,
} from './return-fee-deduction';

/**
 * 구매자 본인 주문의 반품배송비 차감 결정(ADR-0031). DB가 본인 주문만 돌려준다. 결정이 없거나 읽지 못하면 null —
 * 주문 상세의 다른 내용은 그대로 보이고, 환불 금액은 결제사 취소 알림에도 실린다.
 */
export async function loadMyOrderRefundDeduction(orderId: string): Promise<MyOrderRefundDeduction | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_my_order_claim_refund_deduction', { p_order_id: orderId });
  if (error) return null;
  return parseMyOrderRefundDeduction(data);
}

/** 반품 접수 안내에 쓸 공개 정책. 읽지 못하면 꺼진 것으로 읽는다 — 약속하지 않은 차감을 안내하지 않는다. */
export async function loadReturnFeeDeductionPolicy(): Promise<ReturnFeeDeductionPolicy> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_return_fee_deduction_policy');
  return error ? { enabled: false, oneWayAmount: null } : parseReturnFeeDeductionPolicy(data);
}
