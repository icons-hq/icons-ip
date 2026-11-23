'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { parseGoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { parseMarketingCoupon, type MarketingCoupon } from '@/lib/admin/marketing-coupons';
import { MARKETING_MESSAGES_PATH } from '@/lib/admin/marketing-messages';
import { transactionRecord, transactionInteger, transactionInstant } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
export async function searchMarketingCouponsAction(query: string, page = 1) {
  if (!await requireAdminActionAccess(MARKETING_MESSAGES_PATH, { capability: 'marketing.manage' })) return { error: '마케팅 관리 권한이 필요합니다.' };
  if (typeof query !== 'string' || query.length > 100 || !transactionInteger(page, 1, 100000)) return { error: '쿠폰 검색 조건을 확인해주세요. 검색어는 100자까지 입력할 수 있습니다.' };
  try {
    const { data, error } = await (await createClient()).rpc('admin_marketing_coupon_options', { p_query: query, p_page: page });
    if (error || !transactionRecord(data) || !Array.isArray(data.rows) || data.rows.length > 20 || data.page !== page || data.pageSize !== 20 || !transactionInteger(data.total, data.rows.length)) return { error: '쿠폰을 조회하지 못했습니다.' };
    const rows = data.rows.map(parseMarketingCoupon);
    if (rows.some(row => !row)) return { error: '쿠폰 정보를 확인하지 못했습니다.' };
    return { rows: rows as MarketingCoupon[], total: data.total, page };
  } catch (error) { unstable_rethrow(error); return { error: '쿠폰을 조회하지 못했습니다.' }; }
}
export async function sendMarketingTestAction(campaignId: unknown, revision: unknown, operationId: unknown, rawIdentity: unknown) {
  const identity = parseGoodsGroupIdentity(rawIdentity);
  if (!isUuid(campaignId) || !transactionInteger(revision, 1) || !isUuid(operationId) || !identity) return { error: '테스트할 메시지 정보를 읽지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.', uncertain: false };
  const auth = await requireAdminActionAccess(MARKETING_MESSAGES_PATH, { capability: 'marketing.manage' });
  if (!auth || auth.user.id !== identity.actorId) return { error: '로그인한 계정이 바뀌었거나 마케팅 관리 권한이 없습니다. 현재 계정으로 화면을 다시 열어주세요.', uncertain: false };
  try {
    const { data, error } = await (await createClient()).rpc('admin_send_marketing_test', { p_campaign_id: campaignId, p_expected_revision: revision,
      p_operation_id: operationId, p_expected_actor: identity.actorId, p_expected_session: identity.sessionId });
    if (error) return { error: ['PT409','42501','23514'].includes(error.code) ? '그사이 로그인 계정이나 저장한 메시지, 상품·쿠폰 상태가 바뀌었습니다. 메시지를 새로고침해 다시 연 뒤 테스트해주세요.' : '테스트 알림이 등록됐는지 확인하지 못했습니다. [같은 테스트 요청 결과 확인]을 눌러주세요. 다시 눌러도 두 번 등록되지 않습니다.', uncertain: !['PT409','42501','23514'].includes(error.code) };
    if (!transactionRecord(data) || data.receiptId !== operationId || !isUuid(data.notificationId) || !transactionInstant(data.registeredAt) || data.linkPath !== `/notifications/marketing-test/${operationId}`) return { error: '테스트 알림이 등록됐는지 확인하지 못했습니다. [같은 테스트 요청 결과 확인]을 눌러주세요. 다시 눌러도 두 번 등록되지 않습니다.', uncertain: true };
    revalidatePath('/notifications'); return { receipt: { id: data.receiptId as string, linkPath: data.linkPath as string, registeredAt: data.registeredAt } };
  } catch (error) { unstable_rethrow(error); return { error: '테스트 알림이 등록됐는지 확인하지 못했습니다. [같은 테스트 요청 결과 확인]을 눌러주세요. 다시 눌러도 두 번 등록되지 않습니다.', uncertain: true }; }
}
