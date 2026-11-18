import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  parseSystemHealthReport,
  parseUnresolvedPaymentAttempts,
  type SystemHealthReport,
  type UnresolvedPaymentAttemptList,
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
