import { InquiryOperatorHistoryScreen } from '@/components/admin/screens/InquiryOperatorHistoryScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { INQUIRY_OPERATOR_HISTORY_PATH, normalizeInquiryOperatorHistoryFilters } from '@/lib/admin/inquiry-operator-history';
import { loadInquiryOperatorHistory } from '@/lib/admin/inquiry-operator-history.server';

/* 운영자별 처리 이력(1014-105). 매니저 관리 권한(operators.manage)으로만 열고, 조회할 때마다 DB가 열람을 감사한다. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminScreenAccess(INQUIRY_OPERATOR_HISTORY_PATH, { capability: 'operators.manage' });
  const filters = normalizeInquiryOperatorHistoryFilters(await searchParams);
  const data = await loadInquiryOperatorHistory(filters);
  return <InquiryOperatorHistoryScreen data={data} filters={filters} />;
}
