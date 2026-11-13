import { hasAdminCapability } from '@/lib/admin/access';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { ADMIN_INQUIRY_CHAT_PATH, normalizeInquiryChatFilters } from '@/lib/admin/inquiry-chat';
import { loadInquiryChatContext, loadInquiryChatData } from '@/lib/admin/inquiry-chat.server';
import { loadAdminInquiryDetail } from '@/lib/admin/inquiries.server';
import { loadInquiryPurchaseHistory } from '@/lib/admin/inquiry-purchase-history.server';
import { isUuid } from '@/lib/uuid';
import { InquiryChatScreen } from '@/components/admin/screens/InquiryChatScreen';

/* 상담 화면 오른쪽 구매이력은 버튼 없이 자동으로 보인다(A7). 상담 화면을 여는 모든 운영자 역할(부매니저·대행사 포함)이
   그 문의 고객의 구매이력을 본다(1014-103, 사용자 결정 "전부 다 아무나 볼 수 있게"). 같은 RPC가 문의 응대 권한·고객 범위를
   다시 검사하고 열람을 감사한다. 실패해도 대화는 연다. */
async function loadPurchaseHistory(inquiryId: string) {
  try {
    return { history: await loadInquiryPurchaseHistory(inquiryId), error: false };
  } catch { return { history: null, error: true }; }
}

export default async function AdminInquiryChatPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAdminScreenAccess(ADMIN_INQUIRY_CHAT_PATH, { capability: 'cs.manage' });
  const params = await searchParams;
  const filters = normalizeInquiryChatFilters(params);
  const inquiryId = typeof params.inquiryId === 'string' && isUuid(params.inquiryId) ? params.inquiryId : null;
  const access = { canReadOrders: hasAdminCapability(auth, 'sales.read'), canManageSales: hasAdminCapability(auth, 'sales.manage') };
  const [data, detail, chatContext] = await Promise.all([
    loadInquiryChatData(filters), inquiryId ? loadAdminInquiryDetail(inquiryId, access) : Promise.resolve(null),
    inquiryId ? loadInquiryChatContext(inquiryId) : Promise.resolve(null),
  ]);
  const purchase = detail ? await loadPurchaseHistory(detail.inquiry.id) : null;
  return <InquiryChatScreen key={auth.user.id} accountId={auth.user.id} filters={filters} data={data} detail={detail} chatContext={chatContext}
    selected={Boolean(params.inquiryId)} canReadOrders={access.canReadOrders} canViewCustomer={hasAdminCapability(auth, 'platform.manage')}
    purchaseHistory={purchase?.history ?? null} purchaseHistoryError={purchase?.error ?? false} />;
}
