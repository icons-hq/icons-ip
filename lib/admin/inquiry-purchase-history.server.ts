import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseInquiryPurchaseHistory, type InquiryPurchaseHistory } from './inquiry-purchase-history';

/** 그 문의 고객의 구매이력 한 페이지. DB가 문의 응대 권한·고객 범위를 판정하고 열람을 감사한다. 문의가 없으면 null. */
export async function loadInquiryPurchaseHistory(inquiryId: string, page = 1): Promise<InquiryPurchaseHistory | null> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_inquiry_purchase_history', { target_inquiry_id: inquiryId, target_page: page });
  if (error?.code === 'P0002') return null;
  const parsed = !error && parseInquiryPurchaseHistory(data);
  if (!parsed || parsed.inquiryId !== inquiryId) throw new Error('구매이력을 불러오지 못했습니다.');
  return parsed;
}
