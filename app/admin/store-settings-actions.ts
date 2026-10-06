'use server';
import { revalidatePath, updateTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { BUSINESS_INFO_LABELS } from '@/lib/legal/business-info';
import { INQUIRY_CATEGORIES } from '@/lib/inquiries';
import { BANK_ACCOUNT_LABELS, CARRIER_SETTINGS_PATH, STORE_SETTINGS_CACHE_TAG, STORE_SETTINGS_PATH, parseCarrierInput, parseStoreSettingsInput } from '@/lib/admin/store-settings';

export type StoreSettingsActionState={message?:string;errors?:Record<string,string>;values?:Record<string,string>;updatedAt?:string;attempt?:number};
function value(data:FormData,key:string) { const raw=data.get(key);return typeof raw==='string'?raw:''; }
function validStamp(stamp:string) {return Boolean(stamp) && !Number.isNaN(Date.parse(stamp));}
function errorMessage(error:{message?:string}) {
  return error.message?.includes('conflict')?'다른 관리자가 수정했습니다. 입력값을 복사한 뒤 새로고침해 최신 설정을 확인해주세요.':'설정을 저장하지 못했습니다. 입력값은 유지됩니다. 잠시 후 다시 시도해주세요.';
}
function refreshSettings() {
  updateTag(STORE_SETTINGS_CACHE_TAG);
  revalidatePath(STORE_SETTINGS_PATH);revalidatePath(CARRIER_SETTINGS_PATH);
  revalidatePath('/','layout');
}
export async function saveInquiryAutoRepliesAction(previous:StoreSettingsActionState,data:FormData):Promise<StoreSettingsActionState> {
  const values=Object.fromEntries(INQUIRY_CATEGORIES.flatMap(({id})=>[
    [`${id}.enabled`,value(data,`${id}.enabled`)], [`${id}.body`,value(data,`${id}.body`)],
  ]));
  const attempt=(previous.attempt??0)+1;
  const fail=(errors:Record<string,string>)=>({errors,values,attempt});
  try {
    if (!await requireAdminActionAccess(STORE_SETTINGS_PATH, { adminOnly: true })) return fail({form:'설정 변경은 관리자(admin)만 할 수 있습니다.'});
    const stamp=value(data,'updatedAt');
    if (!validStamp(stamp)) return fail({form:'최신 설정을 다시 열어주세요.'});
    const targetValues=Object.fromEntries(INQUIRY_CATEGORIES.map(({id})=>[id,{
      enabled:values[`${id}.enabled`]==='true',body:values[`${id}.body`].trim(),
    }]));
    const errors:Record<string,string>={};
    for (const [id,notice] of Object.entries(targetValues)) {
      if (notice.enabled && !notice.body) errors[`${id}.body`]='사용할 자동 안내 문구를 입력해주세요.';
      else if (Array.from(notice.body).length>2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(notice.body)) errors[`${id}.body`]='안내 문구는 2,000자 이내의 텍스트로 입력해주세요.';
    }
    if (Object.keys(errors).length) return fail(errors);
    const client=await createClient();
    const {data:updatedAt,error}=await client.rpc('admin_save_store_settings',{target_section:'inquiry_auto_replies',target_values:targetValues,expected_updated_at:stamp});
    if (error) return fail({form:errorMessage(error)});
    refreshSettings();
    return {message:'문의 자동 안내를 저장했습니다.',updatedAt,attempt};
  } catch(error) {unstable_rethrow(error);return fail({form:'설정을 저장하지 못했습니다. 입력값은 유지됩니다. 잠시 후 다시 시도해주세요.'});}
}
export async function saveStoreSettingsAction(previous:StoreSettingsActionState,data:FormData):Promise<StoreSettingsActionState> {
  const section=value(data,'section');
  const fields=section==='business'?BUSINESS_INFO_LABELS:BANK_ACCOUNT_LABELS;
  const values=Object.fromEntries(Object.keys(fields).map(key=>[key,value(data,key)]));
  const attempt=(previous.attempt??0)+1;
  const fail=(errors:Record<string,string>)=>({errors,values,attempt});
  try {
    if (!await requireAdminActionAccess(STORE_SETTINGS_PATH, { adminOnly: true })) return fail({form:'설정 변경은 관리자(admin)만 할 수 있습니다.'});
    if (section!=='business' && section!=='bank_transfer') return fail({form:'설정 항목을 확인해주세요.'});
    const parsed=parseStoreSettingsInput(section,values);
    if (!parsed.ok) return fail(parsed.errors);
    const stamp=value(data,'updatedAt');
    if (!validStamp(stamp)) return fail({form:'최신 설정을 다시 열어주세요.'});
    const client=await createClient();
    const {data:updatedAt,error}=await client.rpc('admin_save_store_settings',{target_section:section,target_values:parsed.value,expected_updated_at:stamp});
    if (error) return fail({form:errorMessage(error)});
    refreshSettings();
    return {message:'설정을 저장했습니다.',updatedAt,attempt};
  } catch(error) {unstable_rethrow(error);return fail({form:'설정을 저장하지 못했습니다. 입력값은 유지됩니다. 잠시 후 다시 시도해주세요.'});}
}
export async function saveShippingCarrierAction(previous:StoreSettingsActionState,data:FormData):Promise<StoreSettingsActionState> {
  const values=Object.fromEntries(['code','label','trackingUrlTemplate','active','updatedAt'].map(key=>[key,value(data,key)]));
  const attempt=(previous.attempt??0)+1;
  const fail=(errors:Record<string,string>)=>({errors,values,attempt});
  try {
    if (!await requireAdminActionAccess(CARRIER_SETTINGS_PATH, { adminOnly: true })) return fail({form:'설정 변경은 관리자(admin)만 할 수 있습니다.'});
    const parsed=parseCarrierInput({code:values.code,label:values.label,trackingUrlTemplate:values.trackingUrlTemplate,active:values.active==='true'});
    if (!parsed.ok) return fail(parsed.errors);
    if (values.updatedAt && !validStamp(values.updatedAt)) return fail({form:'최신 택배사 설정을 다시 열어주세요.'});
    const client=await createClient();
    const {data:updatedAt,error}=await client.rpc('admin_save_shipping_carrier',{
      target_code:parsed.value.code,target_label:parsed.value.label,target_url:parsed.value.trackingUrlTemplate,target_active:parsed.value.active,expected_updated_at:values.updatedAt||null,
    });
    if (error) return fail({form:errorMessage(error)});
    refreshSettings();
    return {message:'택배사 설정을 저장했습니다.',...(values.updatedAt?{updatedAt}:{}),attempt};
  } catch(error) {unstable_rethrow(error);return fail({form:'택배사 설정을 저장하지 못했습니다. 입력값은 유지됩니다.'});}
}
