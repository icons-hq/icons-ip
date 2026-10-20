import { hasAdminCapability } from '@/lib/admin/access';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { ADMIN_INQUIRY_CHAT_PATH, normalizeInquiryChatFilters } from '@/lib/admin/inquiry-chat';
import { loadInquiryChatContext, loadInquiryChatData } from '@/lib/admin/inquiry-chat.server';
import { loadAdminInquiryDetail } from '@/lib/admin/inquiries.server';
import { isUuid } from '@/lib/uuid';
import { InquiryChatScreen } from '@/components/admin/screens/InquiryChatScreen';

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
  return <InquiryChatScreen key={auth.user.id} accountId={auth.user.id} filters={filters} data={data} detail={detail} chatContext={chatContext}
    selected={Boolean(params.inquiryId)} canReadOrders={access.canReadOrders} canViewCustomer={hasAdminCapability(auth, 'platform.manage')} />;
}
