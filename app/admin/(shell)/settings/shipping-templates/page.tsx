import { ShippingSettingsTemplatesScreen } from '@/components/admin/screens/ShippingSettingsTemplatesScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadGoodsFulfillmentOptions } from '@/lib/admin/fulfillment-origins.server';
import { loadGoodShippingRegionSummaries } from '@/lib/admin/good-shipping-summary.server';
import { normalizeShippingSettingsFilters } from '@/lib/admin/shipping-settings-templates';
import { loadShippingSettingsTemplates, loadShippingSettingsUsage } from '@/lib/admin/shipping-settings-templates.server';
import { parseGoodsBulkShippingIds } from '@/lib/admin/goods-bulk';
import { loadGoodsTransactionRuntimeMode } from '@/lib/checkout-transaction.server';
import { notFound } from 'next/navigation';

export default async function AdminShippingTemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAdminScreenAccess('/admin/settings/shipping-templates');
  const params = await searchParams;
  const initialGoodIds = parseGoodsBulkShippingIds(params.goods);
  if (params.goods !== undefined && !initialGoodIds.length) notFound();
  const filters = normalizeShippingSettingsFilters(params);
  /* 쇼핑몰 주문 설정을 미리 읽어, 꺼져 있으면 적용할 수 없는 설정을 고르기 전에 막는다(화면 규칙 5). 읽지 못했으면 막지 않는다. */
  const [data, origins, runtime] = await Promise.all([loadShippingSettingsTemplates(filters), loadGoodsFulfillmentOptions(), loadGoodsTransactionRuntimeMode()]);
  const [regions, usage] = await Promise.all([loadGoodShippingRegionSummaries(origins), loadShippingSettingsUsage(data.rows)]);
  return <ShippingSettingsTemplatesScreen data={{ ...data, usage }} origins={origins} regions={regions} accountId={auth.user.id} initialGoodIds={initialGoodIds}
    runtimeEnabled={runtime === 'transaction' ? true : runtime === 'legacy' ? false : null} />;
}
