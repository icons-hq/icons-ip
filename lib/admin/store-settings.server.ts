import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { EditableCarrier, StoreSettingsAudit, StoreSettingsSnapshot } from './store-settings';

export async function loadAdminStoreSettings():Promise<{settings:StoreSettingsSnapshot;carriers:EditableCarrier[];history:StoreSettingsAudit[]}> {
  const client=await createClient();
  const [settings,carriers,history]=await Promise.all([
    client.from('store_settings').select('business,bank_transfer,updated_at').single(),
    client.from('shipping_carriers').select('code,label,is_active,tracking_url_template,updated_at').order('sort_order').order('code'),
    client.rpc('admin_store_settings_history',{row_limit:50}),
  ]);
  if (settings.error || carriers.error || history.error) throw new Error('운영 설정을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  return {
    settings:{business:settings.data.business,bankTransfer:settings.data.bank_transfer,updatedAt:settings.data.updated_at},
    carriers:(carriers.data??[]).map(row=>({code:row.code,label:row.label,active:row.is_active,trackingUrlTemplate:row.tracking_url_template,updatedAt:row.updated_at})),
    history:(history.data??[]).map((row:{id:string;actor_name:string|null;action:string;target:string;created_at:string;diff:Record<string,unknown>})=>({id:row.id,actorName:row.actor_name??'삭제된 운영자',action:row.action,target:row.target,createdAt:row.created_at,diff:row.diff})),
  };
}
