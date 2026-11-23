import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  parseSystemHealthReport,
  parseUnresolvedPaymentAttempts,
  parseVirtualAccountRefundFailures,
  type SystemHealthReport,
  type UnresolvedPaymentAttemptList,
  type VirtualAccountRefundFailureList,
} from './system-health';

/** 시스템 상태 판정(platform.manage). 읽지 못하면 null — 화면이 정상처럼 보이지 않게 안내한다. */
export async function loadSystemHealth(): Promise<SystemHealthReport | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_system_health');
    return error ? null : parseSystemHealthReport(data);
  } catch {
    return null;
  }
}

/** 미종결 결제 시도 목록(sales.manage, 오래된 순). 읽지 못하면 null. */
export async function loadUnresolvedPaymentAttempts(limit = 50): Promise<UnresolvedPaymentAttemptList | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_unresolved_payment_attempts', { p_limit: limit });
    return error ? null : parseUnresolvedPaymentAttempts(data);
  } catch {
    return null;
  }
}

/** 가상계좌 환불 송금 확인 필요 목록(sales.read, 오래된 순, ADR-0049 결정 5 보강). 읽지 못하면 null. */
export async function loadVirtualAccountRefundFailures(limit = 50): Promise<VirtualAccountRefundFailureList | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_virtual_account_refund_failures', { p_limit: limit });
    return error ? null : parseVirtualAccountRefundFailures(data);
  } catch {
    return null;
  }
}
