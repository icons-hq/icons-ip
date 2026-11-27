'use server';
import { revalidatePath, updateTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { BUSINESS_INFO_LABELS } from '@/lib/legal/business-info';
import { INQUIRY_CATEGORIES } from '@/lib/inquiries';
import { carrierTurnOffBlock } from '@/lib/admin/carrier-origin-uses.server';
import { BANK_ACCOUNT_LABELS, CARRIER_FORMAT_FAILED, CARRIER_SETTINGS_PATH, STORE_SETTINGS_CACHE_TAG, STORE_SETTINGS_PATH, parseCarrierFormatChoice, parseCarrierInput, parseStoreSettingsInput } from '@/lib/admin/store-settings';

export type StoreSettingsActionState={message?:string;errors?:Record<string,string>;values?:Record<string,string>;updatedAt?:string;attempt?:number};
/** 스토어 관리 권한이 없는 계정의 문의 자동 안내 저장 거절 문구. 이 섹션은 최고 관리자 전용이 아니다. */
const INQUIRY_AUTO_REPLY_FORBIDDEN='문의 자동 안내를 저장할 권한이 없습니다. 스토어 관리 권한이 있는 매니저에게 요청해주세요.';
function value(data:FormData,key:string) { const raw=data.get(key);return typeof raw==='string'?raw:''; }
function validStamp(stamp:string) {return Boolean(stamp) && !Number.isNaN(Date.parse(stamp));}
function errorMessage(error:{message?:string}) {
  return error.message?.includes('conflict')?'다른 관리자가 수정했습니다. 입력값을 복사한 뒤 새로고침해 최신 설정을 확인해주세요.':'설정을 저장하지 못했습니다. 입력값은 유지됩니다. 잠시 후 다시 시도해주세요.';
}
/** 택배사 저장의 오류 문구. 다른 설정(사업자·계좌·문의 안내)은 위의 `errorMessage`를 그대로 쓴다. */
const CARRIER_FORBIDDEN='택배사 변경은 최고 관리자만 할 수 있습니다.';
function carrierErrorMessage(error:{message?:string}) {
  return error.message?.includes('conflict')?'다른 사람이 먼저 바꿨습니다. 입력한 내용을 복사해 둔 뒤 새로고침해 최신 내용을 확인해 주세요.':'택배사를 저장하지 못했습니다. 입력한 내용은 그대로 있습니다. 잠시 뒤 다시 해 주세요.';
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
 * 택배사 운송장 형식 저장(SHP-032). 형식 종류·자리 수·확인용 번호를 받아 식과 안내 문구를 만들고, DB가 다시 검사하고 감사 기록을 남긴다. 최고 관리자만 저장한다.
 * 저장한 형식은 다음 등록부터 모든 운송장 등록 경로(수동·회신·추가 운송장·교환 재출고)의 판정과 화면 안내에 쓰인다.
 */
export async function saveShippingCarrierFormatAction(previous:StoreSettingsActionState,data:FormData):Promise<StoreSettingsActionState> {
  const values=Object.fromEntries(['code','trackingNumberKind','trackingNumberMin','trackingNumberMax','trackingNumberSample','updatedAt'].map(key=>[key,value(data,key)]));
  const attempt=(previous.attempt??0)+1;
  const fail=(errors:Record<string,string>)=>({errors,values,attempt});
  try {
    if (!await requireAdminActionAccess(CARRIER_SETTINGS_PATH, { adminOnly: true, capability: 'platform.manage' })) return fail({form:CARRIER_FORBIDDEN});
    if (!/^[a-z0-9_]{2,32}$/.test(values.code) || !validStamp(values.updatedAt)) return fail({form:'최신 택배사 설정을 다시 열어주세요.'});
    /* 식과 안내 문구는 화면이 받은 종류·자리 수로 서버가 만든다 — 저장되는 값은 전과 같은 모양(`^[0-9]{10,14}$` · `숫자 10~14자리`)이다. */
    const parsed=parseCarrierFormatChoice({kind:values.trackingNumberKind,min:values.trackingNumberMin,max:values.trackingNumberMax,sample:values.trackingNumberSample});
    if (!parsed.ok) return fail(parsed.errors);
    const client=await createClient();
    const {data:updatedAt,error}=await client.rpc('admin_save_shipping_carrier_tracking_format',{
      target_code:values.code,target_pattern:parsed.value.pattern,target_rule:parsed.value.rule,target_sample:parsed.value.sample,expected_updated_at:values.updatedAt,
    });
    if (error) {
      if (error.message?.includes('tracking_number_format_sample_mismatch')) return fail({trackingNumberSample:'확인용 운송장번호가 새 형식에 맞지 않습니다. 번호나 형식을 확인해 주세요.'});
      if (error.message?.includes('invalid_tracking_number_format')) return fail({form:CARRIER_FORMAT_FAILED});
      return fail({form:carrierErrorMessage(error)});
    }
    refreshSettings();
    return {message:parsed.value.pattern?'운송장 형식을 저장했습니다. 다음 등록부터 이 형식으로 확인합니다.':'운송장 형식을 정하지 않음으로 바꿨습니다. 다음 등록부터 공통 형식(8~30자 영문·숫자)만 확인합니다.',updatedAt,attempt};
  } catch(error) {unstable_rethrow(error);return fail({form:'운송장 형식을 저장하지 못했습니다. 입력값은 유지됩니다.'});}
}
export async function saveShippingCarrierAction(previous:StoreSettingsActionState,data:FormData):Promise<StoreSettingsActionState> {
  const values=Object.fromEntries(['code','label','trackingUrlTemplate','active','updatedAt'].map(key=>[key,value(data,key)]));
  const attempt=(previous.attempt??0)+1;
  const fail=(errors:Record<string,string>)=>({errors,values,attempt});
  try {
    if (!await requireAdminActionAccess(CARRIER_SETTINGS_PATH, { adminOnly: true, capability: 'platform.manage' })) return fail({form:CARRIER_FORBIDDEN});
    const parsed=parseCarrierInput({code:values.code,label:values.label,trackingUrlTemplate:values.trackingUrlTemplate,active:values.active==='true'});
    if (!parsed.ok) return fail(parsed.errors);
    if (values.updatedAt && !validStamp(values.updatedAt)) return fail({form:'최신 택배사 설정을 다시 열어주세요.'});
    /* 끄는 저장은 그 택배사를 기본 택배사로 쓰는 출고지가 없을 때만 한다 — 화면이 미리 막지만 직접 보낸 요청도 같은 판정으로 거절한다.
       새로 등록하는 택배사(updatedAt 없음)는 쓰는 출고지가 있을 수 없다. 거절하면 칸의 '사용'은 켠 채로 돌려준다. */
    if (!parsed.value.active && values.updatedAt) {
      const blocked=await carrierTurnOffBlock(parsed.value.code);
      if (blocked) return {errors:{form:blocked},values:{...values,active:'true'},attempt};
    }
    const client=await createClient();
    const {data:updatedAt,error}=await client.rpc('admin_save_shipping_carrier',{
      target_code:parsed.value.code,target_label:parsed.value.label,target_url:parsed.value.trackingUrlTemplate,target_active:parsed.value.active,expected_updated_at:values.updatedAt||null,
    });
    if (error) return fail({form:carrierErrorMessage(error)});
    refreshSettings();
    return {message:'택배사를 저장했습니다.',...(values.updatedAt?{updatedAt}:{}),attempt};
  } catch(error) {unstable_rethrow(error);return fail({form:'택배사를 저장하지 못했습니다. 입력한 내용은 그대로 있습니다.'});}
}
