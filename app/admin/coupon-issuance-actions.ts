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
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 200) return { error: '닉네임·회원번호·정확한 이메일을 2자 이상 입력해주세요.' };
  try {
    const { data, error } = await (await createClient()).rpc('admin_find_coupon_issue_customers', { p_query: query.trim() });
    if (error || !Array.isArray(data) || data.length > 50 || data.some(row => !row || !isUuid(row.id) || typeof row.nickname !== 'string' || typeof row.maskedEmail !== 'string' || (row.operator !== undefined && typeof row.operator !== 'boolean'))) return { error: '고객을 조회하지 못했습니다. 잠시 뒤 다시 조회해주세요.' };
    /* 운영자 계정(staff·admin)도 지정 발급 대상이다(2026-11-17 사용자 결정) — 화면이 '운영자 계정'으로 구분한다. */
    return { rows: (data as { id: string; nickname: string; maskedEmail: string; operator?: boolean }[]).map(row => ({ id: row.id, nickname: row.nickname, maskedEmail: row.maskedEmail, operator: row.operator === true })) };
  } catch (error) { unstable_rethrow(error); return { error: '고객을 조회하지 못했습니다. 잠시 뒤 다시 조회해주세요.' }; }
}
export async function previewCouponIssueAction(id: unknown, code: unknown, rawTargets: unknown, rawIdentity: unknown): Promise<CouponIssueResult> {
  const targets = parseCouponIssueTargets(rawTargets), identity = parseGoodsGroupIdentity(rawIdentity);
  if (!isUuid(id) || !marketingCouponCode(code) || !targets || !identity) return { error: '발급 대상을 확인하지 못했습니다. 회원번호를 한 줄에 하나씩(최대 1,000명) 넣거나 세그먼트를 고른 뒤 다시 눌러주세요.' };
  const auth = await access(); if (!auth || auth.user.id !== identity.actorId) return { error: '로그인 계정이 바뀌었습니다. 지금 로그인한 관리자 계정으로 화면을 새로고침해주세요.' };
  try {
    const { data, error } = await (await createClient()).rpc('admin_preview_coupon_issue', { p_id: id, p_coupon_code: code, p_targets: targets, p_expected_actor: identity.actorId, p_expected_session: identity.sessionId });
    if (error) return { error: couponIssueError(error.message) };
    const batch = parseCouponIssueBatch(data); return batch && batch.id === id && batch.couponCode === code ? { batch } : { error: '발급 대상 확인 결과를 받지 못했습니다. 아직 발급되지 않았습니다. ‘발급 대상 확인’을 다시 눌러주세요.' };
  } catch (error) { unstable_rethrow(error); return { error: '발급 대상을 확인하지 못했습니다. 아직 발급되지 않았고 입력은 그대로 있습니다. ‘발급 대상 확인’을 다시 눌러주세요.' }; }
}
export async function executeCouponIssueAction(id: unknown, rawIdentity: unknown, acknowledged: unknown): Promise<CouponIssueResult> {
  const identity = parseGoodsGroupIdentity(rawIdentity); if (!isUuid(id) || !identity || acknowledged !== true) return { error: '발급하지 않았습니다. ‘대상과 새 발급 수를 확인했습니다’에 체크한 뒤 다시 눌러주세요.' };
  const auth = await access(); if (!auth || auth.user.id !== identity.actorId) return { error: '로그인 계정이 바뀌었습니다. 지금 로그인한 관리자 계정으로 화면을 새로고침해주세요.' };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_execute_coupon_issue', { p_id: id, p_expected_actor: identity.actorId, p_expected_session: identity.sessionId });
    if (error) return { error: ['42501','22023'].includes(error.code) ? couponIssueError(error.message) : '발급됐는지 확인하지 못했습니다. ‘현재 작업 결과 조회’나 ‘같은 발급 요청 결과 확인’을 눌러 결과를 확인해주세요. 같은 작업은 두 번 발급되지 않습니다.', uncertain: !['42501','22023'].includes(error.code) };
    if (parseCouponIssueBatch(data)?.id !== id) return { error: '발급됐는지 확인하지 못했습니다. ‘현재 작업 결과 조회’나 ‘같은 발급 요청 결과 확인’을 눌러 결과를 확인해주세요. 같은 작업은 두 번 발급되지 않습니다.', uncertain: true };
    const readback = await client.rpc('admin_get_coupon_issue', { p_id: id }); const batch = readback.error ? null : parseCouponIssueBatch(readback.data);
    if (!batch || batch.id !== id) return { error: '발급됐는지 확인하지 못했습니다. ‘현재 작업 결과 조회’나 ‘같은 발급 요청 결과 확인’을 눌러 결과를 확인해주세요. 같은 작업은 두 번 발급되지 않습니다.', uncertain: true };
    revalidatePath('/admin/sales/coupons'); revalidatePath('/admin/sales/benefit-report'); revalidatePath('/my/coupons'); return { batch };
  } catch (error) { unstable_rethrow(error); return { error: '발급됐는지 확인하지 못했습니다. ‘현재 작업 결과 조회’나 ‘같은 발급 요청 결과 확인’을 눌러 결과를 확인해주세요. 같은 작업은 두 번 발급되지 않습니다.', uncertain: true }; }
}
export async function readCouponIssueAction(id: unknown): Promise<CouponIssueResult> {
  if (!isUuid(id) || !await access()) return { error: '발급 작업을 열 수 없습니다. 쿠폰 발급 권한이 있는지 확인하고 화면을 새로고침해주세요.' };
  try { const { data, error } = await (await createClient()).rpc('admin_get_coupon_issue', { p_id: id }); const batch = error ? null : parseCouponIssueBatch(data);
    return batch && batch.id === id ? { batch } : { error: '발급 작업 결과를 조회하지 못했습니다. 잠시 뒤 다시 조회해주세요.' };
  } catch (error) { unstable_rethrow(error); return { error: '발급 작업 결과를 조회하지 못했습니다. 잠시 뒤 다시 조회해주세요.' }; }
}
