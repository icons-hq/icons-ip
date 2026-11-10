import { CustomerSegmentsScreen } from '@/components/admin/screens/CustomerSegmentsScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { CUSTOMER_SEGMENTS_PATH, normalizeSegmentFilters } from '@/lib/admin/customer-segments';
import { loadCustomerSegments, loadCustomerSegmentOverview } from '@/lib/admin/customer-segments.server';
import { loadMemberActivitySettings } from '@/lib/admin/member-activity.server';
import { MemberActivitySettingsPanel } from '@/components/admin/MemberActivitySettingsPanel';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
export default async function AdminCustomerSegmentsPage({ searchParams }: { searchParams?: Promise<Record<string,string|string[]|undefined>> } = {}) {
  const auth = await requireAdminScreenAccess(CUSTOMER_SEGMENTS_PATH, { capability: 'marketing.manage' });
  const filters = normalizeSegmentFilters(await searchParams ?? {});
  const client = await createClient();
  const [data,overview,settings,session] = await Promise.all([loadCustomerSegments(filters),loadCustomerSegmentOverview(),loadMemberActivitySettings(),client.auth.getSession()]);
  const sessionId = session.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(session.data.session.access_token) : null;
  return <><MemberActivitySettingsPanel key={`${auth.user.id}:${sessionId}`} initial={settings} actorId={auth.user.id} sessionId={sessionId} /><CustomerSegmentsScreen key={JSON.stringify(data.filters)} data={data} overview={overview} /></>;
}
