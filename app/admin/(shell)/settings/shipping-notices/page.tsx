import { ShippingNoticeTemplatesScreen } from '@/components/admin/screens/ShippingNoticeTemplatesScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeShippingNoticeTemplateFilters, SHIPPING_NOTICE_TEMPLATES_PATH } from '@/lib/admin/shipping-notice-templates';
import { loadShippingNoticeTemplates } from '@/lib/admin/shipping-notice-templates.server';

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess(SHIPPING_NOTICE_TEMPLATES_PATH);
  const data = await loadShippingNoticeTemplates(normalizeShippingNoticeTemplateFilters(await searchParams));
  return <ShippingNoticeTemplatesScreen data={data} />;
}
