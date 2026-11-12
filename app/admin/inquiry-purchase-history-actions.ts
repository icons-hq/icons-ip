'use server';

import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import type { InquiryPurchaseHistory } from '@/lib/admin/inquiry-purchase-history';
import { loadInquiryPurchaseHistory } from '@/lib/admin/inquiry-purchase-history.server';
import { isUuid } from '@/lib/uuid';

export interface InquiryPurchaseHistoryState { error?: string; history?: InquiryPurchaseHistory }

function read(data: FormData, name: string) { const value = data.get(name); return typeof value === 'string' ? value.trim() : ''; }

/**
 * 상담 중 고객의 구매이력 페이지 이동·불러오기(1014-103). 상담 화면을 여는 권한(cs.manage)이면 부를 수 있고,
 * 고객 범위(그 문의를 쓴 고객)와 열람 감사는 DB RPC가 다시 판정한다. 주문 조회 권한(sales.read)은 요구하지 않는다.
 */
export async function loadInquiryPurchaseHistoryAction(_state: InquiryPurchaseHistoryState, form: FormData): Promise<InquiryPurchaseHistoryState> {
  const inquiryId = read(form, 'inquiryId').toLowerCase();
  const page = Number(read(form, 'page') || '1');
  const returnPath = isUuid(inquiryId) ? `/admin/cs/inquiries/${inquiryId}` : '/admin/cs/inquiries';
  if (!await requireAdminActionAccess(returnPath, { capability: 'cs.manage' })) return { error: '문의 응대 권한이 필요합니다.' };
  if (!isUuid(inquiryId) || !Number.isSafeInteger(page) || page < 1 || page > 100_000) return { error: '구매이력을 다시 열어주세요.' };
  try {
    const history = await loadInquiryPurchaseHistory(inquiryId, page);
    return history ? { history } : { error: '문의를 찾을 수 없습니다.' };
  } catch {
    return { error: '구매이력을 불러오지 못했습니다. 다시 시도해주세요.' };
  }
}
