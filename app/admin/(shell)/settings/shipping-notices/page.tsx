import { isUuid } from '@/lib/uuid';
import { ShippingNoticeTemplatesScreen } from '@/components/admin/screens/ShippingNoticeTemplatesScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeShippingNoticeTemplateFilters, SHIPPING_NOTICE_TEMPLATES_PATH } from '@/lib/admin/shipping-notice-templates';
import { loadShippingNoticeTemplates } from '@/lib/admin/shipping-notice-templates.server';

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess(SHIPPING_NOTICE_TEMPLATES_PATH);
  const params = await searchParams;
  const data = await loadShippingNoticeTemplates(normalizeShippingNoticeTemplateFilters(params));
  /* 새 초안을 저장한 직후 이동해 오면 그 초안을 열어 두고 활성화를 안내한다. */
  const focus = typeof params.focus === 'string' && isUuid(params.focus) ? params.focus : undefined;
  return <ShippingNoticeTemplatesScreen data={data} focusId={focus} />;
}
