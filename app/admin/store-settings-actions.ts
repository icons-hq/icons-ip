'use server';
import { revalidatePath, updateTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { BUSINESS_INFO_LABELS } from '@/lib/legal/business-info';
import { INQUIRY_CATEGORIES } from '@/lib/inquiries';
import { BANK_ACCOUNT_LABELS, CARRIER_SETTINGS_PATH, STORE_SETTINGS_CACHE_TAG, STORE_SETTINGS_PATH, parseCarrierFormatInput, parseCarrierInput, parseStoreSettingsInput } from '@/lib/admin/store-settings';

export type StoreSettingsActionState={message?:string;errors?:Record<string,string>;values?:Record<string,string>;updatedAt?:string;attempt?:number};
/** 스토어 관리 권한이 없는 계정의 문의 자동 안내 저장 거절 문구. 이 섹션은 최고 관리자 전용이 아니다. */
const INQUIRY_AUTO_REPLY_FORBIDDEN='문의 자동 안내를 저장할 권한이 없습니다. 스토어 관리 권한이 있는 매니저에게 요청해주세요.';
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
    /* 문의 자동 안내 탭을 여는 모든 운영자(store.manage)가 저장한다 — 호환 단계의 기존 운영자 포함(TKT-019·099). DB가 같은 판정을 다시 한다. */
    if (!await requireAdminActionAccess(STORE_SETTINGS_PATH, { capability: 'store.manage' })) return fail({form:INQUIRY_AUTO_REPLY_FORBIDDEN});
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
    if (!await requireAdminActionAccess(STORE_SETTINGS_PATH, { adminOnly: true, capability: 'seller.manage' })) return fail({form:'설정 변경은 최고 관리자만 할 수 있습니다.'});
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
/**
 * 택배사 운송장 형식 저장(SHP-032). 형식·안내 문구·확인용 번호를 받아 DB가 다시 검사하고 감사 기록을 남긴다. 최고 관리자만 저장한다.
 * 저장한 형식은 다음 등록부터 모든 운송장 등록 경로(수동·회신·추가 운송장·교환 재출고)의 판정과 화면 안내에 쓰인다.
 */
export async function saveShippingCarrierFormatAction(previous:StoreSettingsActionState,data:FormData):Promise<StoreSettingsActionState> {
  const values=Object.fromEntries(['code','trackingNumberPattern','trackingNumberRule','trackingNumberSample','updatedAt'].map(key=>[key,value(data,key)]));
  const attempt=(previous.attempt??0)+1;
  const fail=(errors:Record<string,string>)=>({errors,values,attempt});
  try {
    if (!await requireAdminActionAccess(CARRIER_SETTINGS_PATH, { adminOnly: true, capability: 'platform.manage' })) return fail({form:'설정 변경은 최고 관리자만 할 수 있습니다.'});
    if (!/^[a-z0-9_]{2,32}$/.test(values.code) || !validStamp(values.updatedAt)) return fail({form:'최신 택배사 설정을 다시 열어주세요.'});
    const parsed=parseCarrierFormatInput({pattern:values.trackingNumberPattern,rule:values.trackingNumberRule,sample:values.trackingNumberSample});
    if (!parsed.ok) return fail(parsed.errors);
    const client=await createClient();
    const {data:updatedAt,error}=await client.rpc('admin_save_shipping_carrier_tracking_format',{
      target_code:values.code,target_pattern:parsed.value.pattern,target_rule:parsed.value.rule,target_sample:parsed.value.sample,expected_updated_at:values.updatedAt,
    });
    if (error) {
      if (error.message?.includes('tracking_number_format_sample_mismatch')) return fail({trackingNumberSample:'확인용 번호가 새 형식에 맞지 않습니다.'});
      if (error.message?.includes('invalid_tracking_number_format')) return fail({trackingNumberPattern:'형식을 저장할 수 없습니다. ^로 시작해 $로 끝나는 정규식과 안내 문구를 함께 입력해주세요.'});
      return fail({form:errorMessage(error)});
    }
    refreshSettings();
    return {message:parsed.value.pattern?'운송장 형식을 저장했습니다. 다음 등록부터 이 형식으로 확인합니다.':'운송장 형식을 비웠습니다. 공통 형식(8~30자 영숫자)만 확인합니다.',updatedAt,attempt};
  } catch(error) {unstable_rethrow(error);return fail({form:'운송장 형식을 저장하지 못했습니다. 입력값은 유지됩니다.'});}
}
export async function saveShippingCarrierAction(previous:StoreSettingsActionState,data:FormData):Promise<StoreSettingsActionState> {
  const values=Object.fromEntries(['code','label','trackingUrlTemplate','active','updatedAt'].map(key=>[key,value(data,key)]));
  const attempt=(previous.attempt??0)+1;
  const fail=(errors:Record<string,string>)=>({errors,values,attempt});
  try {
    if (!await requireAdminActionAccess(CARRIER_SETTINGS_PATH, { adminOnly: true, capability: 'platform.manage' })) return fail({form:'설정 변경은 최고 관리자만 할 수 있습니다.'});
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
