'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { parseGoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { marketingCouponCode } from '@/lib/admin/marketing-coupons';
import { COUPON_ISSUE_PATH, couponIssueError, parseCouponIssueBatch, parseCouponIssueTargets, type CouponIssueBatch } from '@/lib/admin/coupon-issuance';
import { isUuid } from '@/lib/uuid';
export type CouponIssueResult = { batch: CouponIssueBatch; error?: never; uncertain?: never } | { batch?: never; error: string; uncertain?: boolean };
const access = () => requireAdminActionAccess(COUPON_ISSUE_PATH, { capability: 'marketing.manage' });
export async function findCouponIssueCustomersAction(query: string) {
  if (!await access()) return { error: '쿠폰 발급 권한이 필요합니다.' };
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 200) return { error: '닉네임·ID·정확한 이메일을 2자 이상 입력해주세요.' };
  try {
    const { data, error } = await (await createClient()).rpc('admin_find_coupon_issue_customers', { p_query: query.trim() });
    if (error || !Array.isArray(data) || data.length > 50 || data.some(row => !row || !isUuid(row.id) || typeof row.nickname !== 'string' || typeof row.maskedEmail !== 'string')) return { error: '고객을 조회하지 못했습니다.' };
    return { rows: data as { id: string; nickname: string; maskedEmail: string }[] };
  } catch (error) { unstable_rethrow(error); return { error: '고객을 조회하지 못했습니다.' }; }
}
export async function previewCouponIssueAction(id: unknown, code: unknown, rawTargets: unknown, rawIdentity: unknown): Promise<CouponIssueResult> {
  const targets = parseCouponIssueTargets(rawTargets), identity = parseGoodsGroupIdentity(rawIdentity);
  if (!isUuid(id) || !marketingCouponCode(code) || !targets || !identity) return { error: '쿠폰과 발급 대상을 확인해주세요.' };
  const auth = await access(); if (!auth || auth.user.id !== identity.actorId) return { error: '현재 관리자 계정으로 다시 열어주세요.' };
  try {
    const { data, error } = await (await createClient()).rpc('admin_preview_coupon_issue', { p_id: id, p_coupon_code: code, p_targets: targets, p_expected_actor: identity.actorId, p_expected_session: identity.sessionId });
    if (error) return { error: couponIssueError(error.message) };
    const batch = parseCouponIssueBatch(data); return batch && batch.id === id && batch.couponCode === code ? { batch } : { error: '발급 대상 확인 결과를 읽지 못했습니다. 다시 확인해주세요.' };
  } catch (error) { unstable_rethrow(error); return { error: '발급 대상을 확인하지 못했습니다. 입력은 유지됩니다.' }; }
}
export async function executeCouponIssueAction(id: unknown, rawIdentity: unknown, acknowledged: unknown): Promise<CouponIssueResult> {
  const identity = parseGoodsGroupIdentity(rawIdentity); if (!isUuid(id) || !identity || acknowledged !== true) return { error: '새 발급·기보유 고객 수와 최종 발급을 확인해주세요.' };
  const auth = await access(); if (!auth || auth.user.id !== identity.actorId) return { error: '현재 관리자 계정으로 다시 열어주세요.' };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_execute_coupon_issue', { p_id: id, p_expected_actor: identity.actorId, p_expected_session: identity.sessionId });
    if (error) return { error: ['42501','22023'].includes(error.code) ? couponIssueError(error.message) : '발급 결과를 확인하지 못했습니다. 현재 작업의 결과를 조회해주세요.', uncertain: !['42501','22023'].includes(error.code) };
    if (parseCouponIssueBatch(data)?.id !== id) return { error: '발급 응답을 확인하지 못했습니다. 현재 작업의 결과를 조회해주세요.', uncertain: true };
    const readback = await client.rpc('admin_get_coupon_issue', { p_id: id }); const batch = readback.error ? null : parseCouponIssueBatch(readback.data);
    if (!batch || batch.id !== id) return { error: '발급 후 저장 결과를 조회하지 못했습니다. 현재 작업 결과를 다시 조회해주세요.', uncertain: true };
    revalidatePath('/admin/sales/coupons'); revalidatePath('/admin/sales/benefit-report'); revalidatePath('/my/coupons'); return { batch };
  } catch (error) { unstable_rethrow(error); return { error: '발급 결과가 불명확합니다. 같은 작업 ID로 조회하거나 다시 확인해주세요.', uncertain: true }; }
}
export async function readCouponIssueAction(id: unknown): Promise<CouponIssueResult> {
  if (!isUuid(id) || !await access()) return { error: '현재 권한과 발급 작업을 확인해주세요.' };
  try { const { data, error } = await (await createClient()).rpc('admin_get_coupon_issue', { p_id: id }); const batch = error ? null : parseCouponIssueBatch(data);
    return batch && batch.id === id ? { batch } : { error: '발급 작업 결과를 조회하지 못했습니다.' };
  } catch (error) { unstable_rethrow(error); return { error: '발급 작업 결과를 조회하지 못했습니다.' }; }
}
