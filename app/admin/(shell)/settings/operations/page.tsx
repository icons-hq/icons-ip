import { unstable_rethrow } from 'next/navigation';
import { OperationsSettingsScreen } from '@/components/admin/screens/OperationsSettingsScreen';
import { operationsReadiness } from '@/components/admin/screens/OperationsSettingsReadiness';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { OPERATIONS_SETTINGS_PATH } from '@/lib/admin/operations-contacts';
import { loadAdminOperationsContacts } from '@/lib/admin/operations-contacts.server';
import { loadAdminShippingRegionExpiry, loadAdminShippingRegionPolicies } from '@/lib/admin/shipping-regions.server';
import { shippingRegionOriginOverview } from '@/lib/admin/shipping-regions';
import { canAccessAdminScreen, hasAdminCapability } from '@/lib/admin/access';
import { loadGoodsFulfillmentOptions } from '@/lib/admin/fulfillment-origins.server';
import { loadActiveShippingNoticeTemplateOptions } from '@/lib/admin/shipping-notice-templates.server';
import { loadAdminStoreCreditPolicy } from '@/lib/admin/store-credits.server';
import { loadAdminShippingCarriers, loadAdminStoreSettings } from '@/lib/admin/store-settings.server';

/** 카드 상태용 읽기. 권한이 없거나 읽지 못해도 이 화면은 그대로 열리고 그 카드만 상태를 말하지 않는다. */
async function readable<T>(load: () => Promise<T>): Promise<T | undefined> {
  try { return await load(); } catch (error) { unstable_rethrow(error); return undefined; }
}

export default async function Page() {
  const auth = await requireAdminScreenAccess(OPERATIONS_SETTINGS_PATH);
  const canEdit = canAccessAdminScreen(auth, null, { capability: 'platform.manage', adminOnly: true });
  /* 권한이 없는 열은 RPC가 빼고 돌려준다 — 빠진 값을 미입력으로 읽지 않도록 권한이 있을 때만 상태를 낸다. */
  const canReadBusiness = hasAdminCapability(auth, 'seller.read'), canReadAccount = hasAdminCapability(auth, 'seller.manage');
  const [data, shippingRegionExpiry, store, origins, regions, carriers, notices, credits] = await Promise.all([
    loadAdminOperationsContacts(), loadAdminShippingRegionExpiry(),
    canReadBusiness || canReadAccount ? readable(loadAdminStoreSettings) : undefined,
    readable(loadGoodsFulfillmentOptions), readable(loadAdminShippingRegionPolicies), readable(loadAdminShippingCarriers),
    readable(loadActiveShippingNoticeTemplateOptions), canEdit ? readable(loadAdminStoreCreditPolicy) : undefined,
  ]);
  /* 출고지·택배사·설정을 모두 읽었을 때만 말한다 — 지역별 추가배송비 화면과 같은 판정으로 새 주문이 막힌 출고지를 가린다. */
  const regionOverview = origins && carriers && regions ? shippingRegionOriginOverview({ origins, carriers, policies: regions.policies, adoptions: regions.adoptions, now: new Date().getTime() }) : undefined;
  const readiness = operationsReadiness({
    business: canReadBusiness ? store?.settings.business : undefined,
    bankTransfer: canReadAccount && store ? store.settings.bankTransfer : undefined,
    origins, regions: regionOverview?.statuses, carriers, activeNoticeTemplates: notices?.length, storeCreditsEnabled: credits?.enabled,
  });
  return <OperationsSettingsScreen {...data} shippingRegionExpiry={regionOverview?.blocked.length ? { ...shippingRegionExpiry, blocked: regionOverview.blocked } : shippingRegionExpiry} canEdit={canEdit} readiness={readiness}/>;
}
