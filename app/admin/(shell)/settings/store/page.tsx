import { randomUUID } from 'node:crypto';
import { StoreSettingsScreen } from '@/components/admin/screens/StoreSettingsScreen';
import { canAccessAdminScreen, hasAdminCapability, type AdminCapability } from '@/lib/admin/access';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { STORE_SETTINGS_PATH, type StoreSettingsSection } from '@/lib/admin/store-settings';
import { loadAdminStoreSettings } from '@/lib/admin/store-settings.server';

const SECTION_CAPABILITIES: Record<StoreSettingsSection, AdminCapability> = {
  business: 'seller.read', bank_transfer: 'seller.manage', inquiry_auto_replies: 'store.manage', branding: 'store.manage', navigation: 'store.manage',
};
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const section = typeof query.section === 'string' && Object.hasOwn(SECTION_CAPABILITIES, query.section)
    ? query.section as StoreSettingsSection : 'business';
  const auth = await requireAdminScreenAccess(STORE_SETTINGS_PATH, { capability: SECTION_CAPABILITIES[section] });
  const data = await loadAdminStoreSettings();
  const sections = (Object.keys(SECTION_CAPABILITIES) as StoreSettingsSection[]).filter(key => hasAdminCapability(auth, SECTION_CAPABILITIES[key]));
  const capability = section === 'business' || section === 'bank_transfer' ? 'seller.manage' : 'store.manage';
  /* 문의 자동 안내는 이 탭을 여는 모든 운영자(store.manage)가 저장한다 — 매니저 권한 전환 전 호환 단계의 기존 운영자 포함
     (TKT-019·099, 사용자 결정 "아무나 가능하게"). 다른 탭의 호환 단계 admin 전용 저장은 그대로다. */
  const canEdit = canAccessAdminScreen(auth, null, { capability, adminOnly: section !== 'inquiry_auto_replies' });
  const history = auth.operatorAccess?.mode === 'configured'
    ? data.history.filter(entry => entry.target === `store_settings:${section}`) : data.history;
  return <StoreSettingsScreen {...data} history={history} sections={sections} canEdit={canEdit}
    canViewCarriers={hasAdminCapability(auth, 'catalog.manage')}
    brandingOperationId={randomUUID()} navigationOperationId={randomUUID()} section={section} />;
}
