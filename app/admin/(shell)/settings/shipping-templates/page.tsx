import { ShippingSettingsTemplatesScreen } from '@/components/admin/screens/ShippingSettingsTemplatesScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadGoodsFulfillmentOptions } from '@/lib/admin/fulfillment-origins.server';
import { loadGoodShippingRegionSummaries } from '@/lib/admin/good-shipping-summary.server';
import { normalizeShippingSettingsFilters } from '@/lib/admin/shipping-settings-templates';
import { loadShippingSettingsTemplates } from '@/lib/admin/shipping-settings-templates.server';
import { parseGoodsBulkShippingIds } from '@/lib/admin/goods-bulk';
import { notFound } from 'next/navigation';

export default async function AdminShippingTemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAdminScreenAccess('/admin/settings/shipping-templates');
  const params = await searchParams;
  const initialGoodIds = parseGoodsBulkShippingIds(params.goods);
  if (params.goods !== undefined && !initialGoodIds.length) notFound();
  const filters = normalizeShippingSettingsFilters(params);
  const [data, origins] = await Promise.all([loadShippingSettingsTemplates(filters), loadGoodsFulfillmentOptions()]);
  const regions = await loadGoodShippingRegionSummaries(origins);
  return <ShippingSettingsTemplatesScreen data={data} origins={origins} regions={regions} accountId={auth.user.id} initialGoodIds={initialGoodIds} />;
}
