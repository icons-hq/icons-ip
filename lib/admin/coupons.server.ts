import 'server-only';

import { notFound, redirect } from 'next/navigation';
import type { AdminCouponRecord } from '@/lib/admin/coupons';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/* 쿠폰 콘솔 목록 로더 (S7).
 * coupons·coupon_redemptions 는 staff RLS select 가 열려 있어 사용자 세션
 * 클라이언트로 읽는다 — service role 을 화면 로드에 끌어들이지 않는다. */

interface CouponRow {
  code: string;
  name: string;
  discount_type: string;
  discount_value: number;
  max_discount_amount: number | null;
  min_subtotal: number;
  starts_at: string;
  ends_at: string | null;
  issue_limit: number | null;
  issued_count: number;
  status: string;
  grade_benefit: string | null;
}

async function requireStaffCouponAccess() {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent('/admin')}`);
  if (!auth.isStaff) notFound();
}

export async function getAdminCouponRecords(): Promise<AdminCouponRecord[]> {
  await requireStaffCouponAccess();
  const supabase = await createClient();

  const [couponsResult, usageResult] = await Promise.all([
    supabase
      .from('coupons')
      .select('code,name,discount_type,discount_value,max_discount_amount,min_subtotal,starts_at,ends_at,issue_limit,issued_count,status,grade_benefit')
      .order('created_at', { ascending: false }),
    supabase
      .from('coupon_redemptions')
      .select('coupon_code')
      .eq('status', 'applied'),
  ]);

  if (couponsResult.error) throw new Error('Failed to load admin coupons');

  /* 사용 수는 원장에서 파생한다(applied 만 — released 는 복구된 사용이다).
     원장 조회가 실패해도 목록은 떠야 하므로 0으로 접는다. */
  const usedCounts = new Map<string, number>();
  if (!usageResult.error) {
    for (const row of (usageResult.data ?? []) as { coupon_code: string }[]) {
      usedCounts.set(row.coupon_code, (usedCounts.get(row.coupon_code) ?? 0) + 1);
    }
  }

  return ((couponsResult.data ?? []) as CouponRow[]).map((row) => ({
    id: row.code,
    code: row.code,
    name: row.name,
    discountType: row.discount_type === 'percent' ? 'percent' as const : 'fixed' as const,
    discountValue: row.discount_value,
    maxDiscountAmount: row.max_discount_amount,
    minSubtotal: row.min_subtotal,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    issueLimit: row.issue_limit,
    issuedCount: row.issued_count,
    usedCount: usedCounts.get(row.code) ?? 0,
    status: row.status === 'archived' ? 'archived' as const : 'active' as const,
    gradeBenefit: row.grade_benefit,
  }));
}
