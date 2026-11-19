import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  DISABLED_PARTIAL_RETURN,
  parseAdminClaimPartialReturn,
  parseMyOrderClaimItems,
  parseOrderPartialReturnContext,
  parsePartialReturnPolicy,
  type AdminClaimPartialReturn,
  type MyOrderClaimItem,
  type OrderPartialReturnContext,
} from './partial-return';

/** 구매자 반품 폼의 부분 반품 문맥(ADR-0047). 읽지 못하면 꺼진 것으로 읽는다 — 반품 폼은 지금처럼 주문 전체만 보인다. */
export async function loadMyOrderPartialReturnContext(orderId: string): Promise<OrderPartialReturnContext> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_my_order_partial_return_context', { p_order_id: orderId });
  return error ? DISABLED_PARTIAL_RETURN : parseOrderPartialReturnContext(data);
}

/** 구매자 주문 상세: 부분 반품 클레임에 고른 굿즈. 없거나 읽지 못하면 빈 배열. */
export async function loadMyOrderClaimItems(orderId: string): Promise<MyOrderClaimItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_my_order_claim_items', { p_order_id: orderId });
  return error ? [] : parseMyOrderClaimItems(data);
}

/** 공개 정책: 부분 반품을 받는지. 읽지 못하면 꺼짐 — 약속하지 않은 일부 반품을 안내하지 않는다. */
export async function loadPartialReturnPolicy(): Promise<{ enabled: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_partial_return_policy');
  return error ? { enabled: false } : parsePartialReturnPolicy(data);
}

/** 운영 클레임 상세의 부분 반품 칸. 주문 전체 클레임이면 null. 읽지 못하면 예외(상세 화면이 오류를 보인다). */
export async function loadAdminClaimPartialReturn(claimId: string): Promise<AdminClaimPartialReturn | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_order_claim_partial_return', { p_claim_id: claimId });
  if (error) throw new Error(`partial return read failed: ${error.message}`);
  return parseAdminClaimPartialReturn(data);
}

/** 운영자 대리 접수 폼의 품목 선택 문맥. 읽지 못하면 꺼진 것으로 읽는다(주문 전체 접수는 그대로). */
export async function loadAdminOrderPartialReturnContext(orderId: string): Promise<OrderPartialReturnContext> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_order_partial_return_context', { p_order_id: orderId });
  return error ? DISABLED_PARTIAL_RETURN : parseOrderPartialReturnContext(data);
}
