import { MarketingLinksScreen } from '@/components/admin/screens/MarketingLinksScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { hasAdminCapability } from '@/lib/admin/access';
import { MARKETING_LINKS_PATH, normalizeMarketingLinkFilters } from '@/lib/admin/marketing-links';
import { loadMarketingLinks } from '@/lib/admin/marketing-links.server';
export default async function AdminMarketingLinksPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const auth = await requireAdminScreenAccess(MARKETING_LINKS_PATH, { capability: 'marketing.manage' });
  const data = await loadMarketingLinks(normalizeMarketingLinkFilters(await searchParams ?? {}));
  return <MarketingLinksScreen data={data} canIssueHome={hasAdminCapability(auth, 'store.manage')} />;
}
