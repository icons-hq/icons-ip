import 'server-only';

import { notFound, redirect } from 'next/navigation';
import type { AdminCouponSearchArgs } from '@/lib/admin/coupon-search';
import type { AdminCouponRecord } from '@/lib/admin/coupons';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/* 쿠폰 콘솔 로더 (S7 · 현업 슬라이스 4에서 조회형으로 교체).
 *
 * 전량 select 를 쓰지 않는다. PostgREST 는 1000행에서 **말없이** 잘라내므로, 쿠폰이
 * 그만큼 쌓이면 목록에 없는 쿠폰이 생기고 같은 프로모션이 두 번 발행된다. 조회·집계는
 * `admin_search_coupons`(security definer, staff 전용)가 한다. */

interface CouponSearchRow {
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
  used_count: number;
  status: string;
  grade_benefit: string | null;
  target_kind: string;
  target_good_id: string | null;
  total_count: number;
}

export interface AdminCouponSearchResult {
  records: AdminCouponRecord[];
  total: number;
}

async function requireStaffCouponAccess() {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent('/admin')}`);
  if (!auth.isStaff) notFound();
}

export async function searchAdminCoupons(args: AdminCouponSearchArgs): Promise<AdminCouponSearchResult> {
  await requireStaffCouponAccess();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('admin_search_coupons', args);
  if (error) throw new Error(`Failed to search admin coupons: ${error.message}`);

  const rows = (data ?? []) as CouponSearchRow[];
  return {
    /* 사용 수도 서버가 센다 — 원장 전량을 받아 화면에서 세면 같은 절단에 걸린다. */
    total: Number(rows[0]?.total_count ?? 0),
    records: rows.map((row) => ({
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
      usedCount: Number(row.used_count ?? 0),
      status: row.status === 'archived' ? 'archived' as const : 'active' as const,
      gradeBenefit: row.grade_benefit,
      targetKind: row.target_kind,
      targetGoodId: row.target_good_id,
    })),
  };
}
