import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  adminStatsRange,
  type AdminClaimsReport,
  type AdminCustomerReport,
  type AdminSalesReport,
  type AdminStatsFilters,
} from './stats';

/**
 * 통계 로더 (#258).
 *
 * 세 화면 모두 집계를 DB RPC에서 통째로 받아 온다. 여기서 다시 합산하지 않는
 * 이유는 PostgREST가 1000행에서 조용히 자르기 때문이다 — 기간이 길어지면 앱
 * 재집계는 조용히 틀린 값을 그린다.
 */

function report<T>(label: string, data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(`Failed to load ${label}: ${error.message}`);
  if (!data || typeof data !== 'object') throw new Error(`Failed to load ${label}: empty report`);
  return data as T;
}

export async function getAdminSalesReport(
  filters: AdminStatsFilters,
  now: Date = new Date(),
): Promise<AdminSalesReport> {
  const supabase = await createClient();
  const range = adminStatsRange(filters.days, now);
  const { data, error } = await supabase.rpc('admin_sales_report', {
    p_from: range.from,
    p_to: range.to,
    p_ip_id: filters.ipId || null,
  });
  return report<AdminSalesReport>('sales report', data, error);
}

export async function getAdminClaimsReport(
  filters: AdminStatsFilters,
  now: Date = new Date(),
): Promise<AdminClaimsReport> {
  const supabase = await createClient();
  const range = adminStatsRange(filters.days, now);
  const { data, error } = await supabase.rpc('admin_claims_report', {
    p_from: range.from,
    p_to: range.to,
  });
  return report<AdminClaimsReport>('claims report', data, error);
}

export async function getAdminCustomerReport(
  filters: AdminStatsFilters,
  now: Date = new Date(),
): Promise<AdminCustomerReport> {
  const supabase = await createClient();
  const range = adminStatsRange(filters.days, now);
  const { data, error } = await supabase.rpc('admin_customer_report', {
    p_from: range.from,
    p_to: range.to,
  });
  return report<AdminCustomerReport>('customer report', data, error);
}
