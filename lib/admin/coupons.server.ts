import 'server-only';

import { notFound, redirect } from 'next/navigation';
import type {
  AdminCouponFilters,
  AdminCouponListData,
  AdminCouponRecord,
} from '@/lib/admin/coupons';
import {
  ADMIN_COUPON_PAGE_SIZE,
} from '@/lib/admin/coupons';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { parseCouponDefinitionRow } from '@/lib/coupons';
import { parseCouponTargetGoods } from '@/lib/coupon-targeting';

/* 쿠폰 콘솔 목록 로더 (#465).
 * 검색·상태·페이지는 서버 RPC가 적용하고, 화면에는 현재 페이지 정의만 내린다.
 * 사용 수 또한 전체 원장을 브라우저로 가져와 접지 않고 각 쿠폰의 집계값으로 받는다. */

const COUPON_COLUMNS = 'code,name,discount_type,discount_value,max_discount_amount,min_subtotal,starts_at,ends_at,issue_limit,issued_count,status,grade_benefit,recipient_segment,goods_scope,target_good_ids,terms_revision';

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
  used_count?: number | string | null;
  total_count?: number | string | null;
  recipient_segment: string;
  goods_scope: string;
  target_good_ids: string[];
  terms_revision: number;
  target_goods: unknown;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function toCount(value: number | string | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function toCouponRecord(row: CouponRow, usedCount = toCount(row.used_count)): AdminCouponRecord {
  const coupon = parseCouponDefinitionRow(row);
  const targetGoods = parseCouponTargetGoods(row.target_goods);
  if (!coupon || !targetGoods || !Number.isSafeInteger(row.terms_revision) || row.terms_revision < 1
    || !Number.isSafeInteger(row.issued_count) || row.issued_count < 0
    || !(row.issue_limit === null || Number.isSafeInteger(row.issue_limit) && row.issue_limit > 0)) throw new Error('쿠폰 응답의 금액과 대상 조건을 확인할 수 없습니다.');
  return {
    ...coupon,
    id: row.code,
    code: row.code,
    name: row.name,
    discountType: row.discount_type === 'percent' ? 'percent' : 'fixed',
    discountValue: row.discount_value,
    maxDiscountAmount: row.max_discount_amount,
    minSubtotal: row.min_subtotal,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    issueLimit: row.issue_limit,
    issuedCount: row.issued_count,
    usedCount,
    status: row.status === 'archived' ? 'archived' : 'active',
    gradeBenefit: row.grade_benefit,
    termsRevision: row.terms_revision,
    targetGoods,
  };
}

async function requireStaffCouponAccess() {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent('/admin')}`);
  if (!auth.isStaff) notFound();
}

async function loadSelectedCoupon(
  supabase: SupabaseServerClient,
  code: string,
): Promise<AdminCouponRecord | null> {
  const [couponResult, usageResult] = await Promise.all([
    supabase
      .from('coupons')
      .select(`${COUPON_COLUMNS},target_goods:admin_coupon_target_goods`)
      .eq('code', code)
      .maybeSingle(),
    supabase
      .from('coupon_redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('coupon_code', code)
      .eq('status', 'applied'),
  ]);

  if (couponResult.error) {
    throw new Error('쿠폰 상세를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
  if (!couponResult.data) return null;
  return toCouponRecord(couponResult.data as CouponRow, usageResult.error ? 0 : usageResult.count ?? 0);
}

export async function getAdminCouponListData(
  filters: AdminCouponFilters,
): Promise<AdminCouponListData> {
  await requireStaffCouponAccess();
  const supabase = await createClient();

  if (filters.inputError) return {
    filters: { ...filters, page: 1 }, records: [], total: 0, pageSize: ADMIN_COUPON_PAGE_SIZE,
    selectedRecord: filters.selectedCode ? await loadSelectedCoupon(supabase, filters.selectedCode) : null,
  };

  const listResult = await supabase
    .rpc('admin_search_coupons', {
      p_query: filters.query || null,
      p_status: filters.status,
      p_limit: ADMIN_COUPON_PAGE_SIZE,
      p_offset: (filters.page - 1) * ADMIN_COUPON_PAGE_SIZE,
    })
    .select(`${COUPON_COLUMNS},used_count,total_count,target_goods`);

  if (listResult.error) {
    throw new Error('쿠폰 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  }

  const rows = (listResult.data ?? []) as CouponRow[];
  const records = rows.map((row) => toCouponRecord(row));
  // PostgREST's count only sees the RPC's limited output. The RPC counts its
  // matching definitions before LIMIT/OFFSET, so later pages remain reachable.
  const total = toCount(rows[0]?.total_count);
  const lastPage = Math.max(1, Math.ceil(total / ADMIN_COUPON_PAGE_SIZE));
  if (filters.page > lastPage) {
    return getAdminCouponListData({ ...filters, page: lastPage });
  }

  /* 현재 페이지 밖의 선택도 상세를 유지한다. 이 추가 조회는 선택된 code 하나만
     읽으므로 필터·페이지 이동이 전체 정의 조회로 되돌아가지 않는다. */
  const selectedRecord = filters.selectedCode && !records.some((record) => record.id === filters.selectedCode)
    ? await loadSelectedCoupon(supabase, filters.selectedCode)
    : records.find((record) => record.id === filters.selectedCode) ?? null;

  return {
    filters,
    records,
    selectedRecord,
    pageSize: ADMIN_COUPON_PAGE_SIZE,
    total,
  };
}
