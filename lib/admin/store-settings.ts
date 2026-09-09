import { BUSINESS_INFO, BUSINESS_INFO_LABELS, type BusinessInfo } from '@/lib/legal/business-info';

export const STORE_SETTINGS_PATH = '/admin/settings/store';
export const CARRIER_SETTINGS_PATH = '/admin/settings/carriers';
export const STORE_SETTINGS_CACHE_TAG = 'store-settings';
export type StoreSettingsSection = 'business' | 'bank_transfer';
export const BANK_ACCOUNT_LABELS = { bank:'은행',accountNumber:'계좌번호',holder:'예금주' } as const;
export type StoreSettingsValue = Record<string,string>;
export type ParsedSettings<T> = {ok:true;value:T} | {ok:false;errors:Record<string,string>};
export type StoreSettingsSnapshot = { business:StoreSettingsValue;bankTransfer:StoreSettingsValue|null;updatedAt:string };
export type StoreSettingsAudit = { id:string;actorName:string;action:string;target:string;createdAt:string;diff:Record<string,unknown> };
export type EditableCarrier = { code:string;label:string;trackingUrlTemplate:string;active:boolean;updatedAt:string };

/** Missing means unconfigured; an explicit blank removes that public row. */
export function mergeBusinessInfo(overrides:Record<string,unknown>,fallback:BusinessInfo=BUSINESS_INFO):BusinessInfo {
  return Object.fromEntries(Object.keys(BUSINESS_INFO_LABELS).map(key=>[key,
    typeof overrides[key] === 'string' ? overrides[key].trim() : fallback[key as keyof BusinessInfo],
  ])) as unknown as BusinessInfo;
}

export function parseStoreSettingsInput(section:StoreSettingsSection,input:unknown):ParsedSettings<StoreSettingsValue> {
  const fields=section==='business'?BUSINESS_INFO_LABELS:BANK_ACCOUNT_LABELS;
  if (!input || typeof input!=='object' || Array.isArray(input)) return {ok:false,errors:{form:'설정 값을 다시 확인해주세요.'}};
  const entries=Object.entries(input);
  if (entries.some(([key,value])=>!Object.hasOwn(fields,key)||typeof value!=='string')) return {ok:false,errors:{form:'허용되지 않은 설정 항목입니다.'}};
  const value:StoreSettingsValue=Object.fromEntries(entries.map(([key,v])=>[key,(v as string).trim()]));
  const errors:Record<string,string>={};
  for (const [key,text] of Object.entries(value)) {
    if (text.length>500 || /[\u0000-\u001f\u007f]/.test(text)) errors[key]='500자 이내의 한 줄로 입력해주세요.';
  }
  if (section==='business' && value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) errors.email='올바른 이메일 주소를 입력해주세요.';
  if (section==='bank_transfer') {
    const filled=Object.keys(BANK_ACCOUNT_LABELS).filter(key=>Boolean(value[key]));
    if (filled.length!==0 && filled.length!==3) errors.form='무통장 계좌는 은행·계좌번호·예금주를 모두 입력하거나 모두 비워주세요.';
    if (Object.keys(value).length!==3) errors.form='무통장 계좌의 세 항목을 모두 보내주세요.';
  }
  return Object.keys(errors).length?{ok:false,errors}:{ok:true,value};
}

export function parseCarrierInput(input:{code:string;label:string;trackingUrlTemplate:string;active:boolean}):ParsedSettings<Omit<EditableCarrier,'updatedAt'>> {
  const value={...input,code:input.code.trim(),label:input.label.trim(),trackingUrlTemplate:input.trackingUrlTemplate.trim()};
  const errors:Record<string,string>={};
  if (!/^[a-z0-9_]{2,32}$/.test(value.code)) errors.code='택배사 코드는 영문 소문자·숫자·밑줄 2~32자입니다.';
  if (!value.label || value.label.length>60) errors.label='택배사 이름은 1~60자로 입력해주세요.';
  try {
    const url=new URL(value.trackingUrlTemplate);
    if (!/^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]{1,5})?[/#?]/.test(value.trackingUrlTemplate) || url.protocol!=='https:' || !url.hostname || url.username || url.password || !value.trackingUrlTemplate.includes('{trackingNumber}') || value.trackingUrlTemplate.length>500 || /[\s\\]/.test(value.trackingUrlTemplate)) throw new Error('invalid');
  } catch { errors.trackingUrlTemplate='HTTPS 조회 URL에 {trackingNumber}를 한 번 이상 포함해주세요. 인증 정보는 넣을 수 없습니다.'; }
  return Object.keys(errors).length?{ok:false,errors}:{ok:true,value};
}

/** Show only changed operator-facing fields, not row ids or database timestamps. */
export function storeSettingsHistoryRows(entry:StoreSettingsAudit) {
  const labels:Record<string,string>={...BUSINESS_INFO_LABELS,...BANK_ACCOUNT_LABELS,
    code:'코드',label:'이름',tracking_url_template:'배송조회 URL',is_active:'새 발송 사용',
    default_carrier:'기본 택배사',export_template:'발주서 양식',name:'출고지 이름',base_fee:'기본 배송비',free_threshold:'무료배송 기준',return_address:'반품 주소',cutoff:'마감 시각'};
  const before=entry.diff.before&&typeof entry.diff.before==='object'?entry.diff.before as Record<string,unknown>:{};
  const after=entry.diff.after&&typeof entry.diff.after==='object'?entry.diff.after as Record<string,unknown>:{};
  const words=(value:unknown)=>value===true?'사용':value===false?'비활성':typeof value==='string'||typeof value==='number'?String(value):'미설정';
  return Object.keys(labels).filter(key=>(key in before||key in after)&&before[key]!==after[key])
    .map(key=>({key,label:labels[key],before:words(before[key]),after:words(after[key])}));
}
