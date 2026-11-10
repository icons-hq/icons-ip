import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseStoreBranding } from '@/lib/store-branding';
import { parseStoreNavigation } from '@/lib/store-navigation';
import { INQUIRY_CATEGORIES } from '@/lib/inquiries';
import type { EditableCarrier, InquiryAutoReplies, StoreSettingsAudit, StoreSettingsSnapshot } from './store-settings';

export async function loadAdminShippingCarriers(): Promise<EditableCarrier[]> {
  const client = await createClient();
  const { data, error } = await client.from('shipping_carriers')
    .select('code,label,is_active,tracking_url_template,updated_at').order('sort_order').order('code');
  if (error) throw new Error('택배사를 불러오지 못했습니다.');
  return (data ?? []).map(row => ({ code: row.code, label: row.label, active: row.is_active,
    trackingUrlTemplate: row.tracking_url_template, updatedAt: row.updated_at }));
}

export async function loadAdminStoreSettingsHistory(): Promise<StoreSettingsAudit[]> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_store_settings_history', { row_limit: 50 });
  if (error) throw new Error('설정 변경 이력을 불러오지 못했습니다.');
  return (data ?? []).map((row: { id: string; actor_name: string | null; action: string; target: string; created_at: string; diff: Record<string, unknown> }) => ({
    id: row.id, actorName: row.actor_name ?? '삭제된 운영자', action: row.action,
    target: row.target, createdAt: row.created_at, diff: row.diff,
  }));
}

/** The RPC removes unauthorized columns before the application receives a row. */
export async function loadAdminStoreSettings(): Promise<{ settings: StoreSettingsSnapshot; carriers: EditableCarrier[]; history: StoreSettingsAudit[] }> {
  const client = await createClient();
  const [result, carriers, history] = await Promise.all([
    client.rpc('admin_operator_store_settings'), loadAdminShippingCarriers(), loadAdminStoreSettingsHistory(),
  ]);
  if (result.error || !result.data?.store || typeof result.data.store.updated_at !== 'string') {
    throw new Error('운영 설정을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
  const source = result.data.store;
  const branding = source.branding === undefined ? undefined : parseStoreBranding(source.branding);
  const navigation = source.navigation === undefined ? undefined : parseStoreNavigation(source.navigation);
  if (branding === null || navigation === null) throw new Error('스토어 표시 설정을 확인할 수 없습니다.');
  const emptyReplies = Object.fromEntries(INQUIRY_CATEGORIES.map(({ id }) => [id, { enabled: false, body: '' }])) as InquiryAutoReplies;
  return { settings: { business: source.business ?? {}, bankTransfer: source.bank_transfer ?? null,
    inquiryAutoReplies: source.inquiry_auto_replies ?? emptyReplies, branding, navigation, updatedAt: source.updated_at }, carriers, history };
}
