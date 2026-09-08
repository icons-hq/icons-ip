import { FaqScreen } from '@/components/admin/screens/FaqScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { ADMIN_FAQ_PATH, normalizeFaqFilters } from '@/lib/faq';
import { loadAdminFaq } from '@/lib/faq.server';

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess(ADMIN_FAQ_PATH);
  return <FaqScreen data={await loadAdminFaq(normalizeFaqFilters(await searchParams))} />;
}
