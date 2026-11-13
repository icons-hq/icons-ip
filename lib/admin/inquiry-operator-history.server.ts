import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseInquiryOperatorHistory, type InquiryOperatorHistoryData, type InquiryOperatorHistoryFilters } from './inquiry-operator-history';

/** 운영자별 처리 이력. DB가 매니저 관리 권한을 다시 판정하고 열람을 감사한다. */
export async function loadInquiryOperatorHistory(filters: InquiryOperatorHistoryFilters): Promise<InquiryOperatorHistoryData> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_operator_inquiry_history', {
    p_from: filters.from, p_to: filters.to, p_operator: filters.operator, p_page: filters.page,
  });
  const parsed = !error && parseInquiryOperatorHistory(data);
  if (!parsed || parsed.from !== filters.from || parsed.to !== filters.to
    || (filters.operator ? parsed.detail?.operatorId !== filters.operator : parsed.detail !== null)) {
    throw new Error('운영자별 처리 이력을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
  return parsed;
}
