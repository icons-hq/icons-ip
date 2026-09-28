import type { StoreSettingsActionState } from '../../app/admin/store-settings-actions';
export const INITIAL_SETTINGS_STAMP='2026-09-28T00:00:00Z';
let currentStamp=INITIAL_SETTINGS_STAMP;
export function simulateSettingsRevision(stamp:string) {currentStamp=stamp;}
/** UI-only concurrency/failure replay. Never contacts Auth or the database. */
export async function saveInquiryAutoRepliesAction(previous:StoreSettingsActionState,data:FormData):Promise<StoreSettingsActionState> {
  const attempt=(previous.attempt??0)+1;
  const values=Object.fromEntries([...data].map(([key,value])=>[key,String(value)]));
  if (currentStamp!==INITIAL_SETTINGS_STAMP && values.updatedAt===currentStamp) return {attempt,message:'합성 저장 성공 · 새 버전으로 덮어썼습니다.',updatedAt:currentStamp};
  return {attempt,values,errors:{form:values.updatedAt===currentStamp?'합성 저장 실패입니다. 입력값은 유지됩니다.':'다른 관리자가 수정했습니다. 입력값은 유지됩니다.'}};
}
export const saveStoreSettingsAction=saveInquiryAutoRepliesAction;
export const saveShippingCarrierAction=saveInquiryAutoRepliesAction;
