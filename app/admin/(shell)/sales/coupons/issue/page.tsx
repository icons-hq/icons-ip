import { notFound, redirect } from 'next/navigation';
import { CouponIssueWorkspace } from '@/components/admin/CouponIssueWorkspace';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminCouponByCode } from '@/lib/admin/coupons.server';
import { COUPON_ISSUE_PATH, parseCouponIssueBatch } from '@/lib/admin/coupon-issuance';
import { marketingCouponCode } from '@/lib/admin/marketing-coupons';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { isUuid } from '@/lib/uuid';
export default async function CouponIssuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAdminScreenAccess(COUPON_ISSUE_PATH, { capability: 'marketing.manage' });
  const params = await searchParams; if (!params.couponCode) redirect('/admin/sales/coupons');
  if (!marketingCouponCode(params.couponCode) || params.batchId !== undefined && !isUuid(params.batchId)) notFound();
  const client = await createClient(), [coupon, session] = await Promise.all([loadAdminCouponByCode(params.couponCode), client.auth.getSession()]);
  if (!coupon) notFound(); const sessionId = session.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(session.data.session.access_token) : null;
  let batch = null;
  if (params.batchId) { const { data, error } = await client.rpc('admin_get_coupon_issue', { p_id: params.batchId }); batch = error ? null : parseCouponIssueBatch(data); if (!batch || batch.couponCode !== coupon.code) notFound(); }
  return <CouponIssueWorkspace key={`${coupon.code}:${params.batchId ?? ''}:${auth.user.id}:${sessionId}`} coupon={coupon} actorId={auth.user.id} sessionId={sessionId} initial={batch} />;
}
