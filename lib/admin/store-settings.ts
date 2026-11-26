import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { BUSINESS_INFO, BUSINESS_INFO_LABELS, type BusinessInfo } from '@/lib/legal/business-info';
import { INQUIRY_CATEGORIES, type InquiryCategory } from '@/lib/inquiries';
import { STORE_SOCIAL_LABELS, STORE_SOCIAL_PLATFORMS, type StoreBranding } from '@/lib/store-branding';
import { STOREFRONT_MENU_ITEMS } from '@/lib/routes';
import type { StoreNavigation } from '@/lib/store-navigation';

export const STORE_SETTINGS_PATH = '/admin/settings/store';
export const CARRIER_SETTINGS_PATH = '/admin/settings/carriers';
export const STORE_SETTINGS_CACHE_TAG = 'store-settings';
export type StoreSettingsSection = 'business' | 'bank_transfer' | 'inquiry_auto_replies' | 'branding' | 'navigation';
export type InquiryAutoReplies = Record<InquiryCategory, { enabled: boolean; body: string }>;
export const BANK_ACCOUNT_LABELS = { bank:'은행',accountNumber:'계좌번호',holder:'예금주' } as const;
export type StoreSettingsValue = Record<string,string>;
export type ParsedSettings<T> = {ok:true;value:T} | {ok:false;errors:Record<string,string>};
export type StoreSettingsSnapshot = { business:StoreSettingsValue;bankTransfer:StoreSettingsValue|null;inquiryAutoReplies:InquiryAutoReplies;branding?:StoreBranding;navigation?:StoreNavigation;updatedAt:string };
export type StoreSettingsAudit = { id:string;actorName:string;action:string;target:string;createdAt:string;diff:Record<string,unknown> };
export type EditableCarrier = { code:string;label:string;trackingUrlTemplate:string;active:boolean;updatedAt:string;
  /** 운송장번호 형식(정규식)·안내 문구(SHP-032). 비어 있으면 공통 형식(8~30자 영숫자)만 본다. */
  trackingNumberPattern?:string;trackingNumberRule?:string };

/**
 * 택배사 운송장 형식 입력(택배사 관리 화면). 형식과 안내 문구는 함께 두거나 함께 비운다. 형식은 전체 일치(^…$) 정규식이고,
 * 확인용 번호(하이픈·공백을 뺀 대문자)가 공통 형식과 새 형식에 맞아야 한다 — 잘못된 식으로 그 택배사의 모든 발송이 막히지 않게.
 * DB(`admin_save_shipping_carrier_tracking_format`)가 같은 검사를 다시 한다. JS가 읽지 못하는 식도 받지 않는다(화면 안내가 이 식을 쓴다).
 * 화면은 식을 직접 받지 않고 종류·자리 수로 고르게 한다(`parseCarrierFormatChoice`가 식을 만들어 이 함수로 다시 검사한다).
 */
export function parseCarrierFormatInput(input:{pattern:string;rule:string;sample:string}):ParsedSettings<{pattern:string;rule:string;sample:string}> {
  const pattern=input.pattern.trim(), rule=input.rule.trim(), sample=input.sample.replace(/[\s-]/g,'').toUpperCase();
  if (!pattern && !rule) return {ok:true,value:{pattern:'',rule:'',sample:''}};
  const errors:Record<string,string>={};
  let compiled:RegExp|null=null;
  if (!pattern) errors.trackingNumberPattern='안내 문구와 함께 형식을 입력하거나 둘 다 비워주세요.';
  else if (!pattern.startsWith('^') || !pattern.endsWith('$') || pattern.length>200) errors.trackingNumberPattern='형식은 ^로 시작해 $로 끝나는 200자 이내 정규식입니다. 예: ^[0-9]{10,14}$';
  else { try { compiled=new RegExp(pattern); } catch { errors.trackingNumberPattern='정규식을 읽을 수 없습니다. 괄호·중괄호를 확인해주세요.'; } }
  if (!rule) errors.trackingNumberRule='형식과 함께 안내 문구(예: 숫자 10~14자리)를 입력해주세요.';
  else if (rule.length>60) errors.trackingNumberRule='안내 문구는 60자 이내로 입력해주세요.';
  if (compiled) {
    if (!sample) errors.trackingNumberSample='확인용 운송장번호를 넣어 주세요. 실제 번호 하나로 새 형식에 맞는지 확인합니다.';
    else if (!CARRIER_COMMON_FORMAT.test(sample)) errors.trackingNumberSample='확인용 운송장번호는 영문·숫자 8~30자로 넣어 주세요.';
    else if (!compiled.test(sample)) errors.trackingNumberSample='확인용 운송장번호가 새 형식에 맞지 않습니다. 번호나 형식을 확인해 주세요.';
  }
  return Object.keys(errors).length?{ok:false,errors}:{ok:true,value:{pattern,rule,sample}};
}

/* ---- 택배사 운송장 형식을 종류·자리 수로 고르기 ----
 * 운영자는 식(정규식)을 쓰지 않는다. 숫자만 / 영문과 숫자 가운데 하나와 자리 수를 고르면 같은 모양의 식과 안내 문구를 만들어 저장한다.
 * 저장되는 값은 전과 같다(예: `^[0-9]{10,14}$` · `숫자 10~14자리`). */

/** 공통 운송장번호 형식(DB `private.tracking_number_format_ok`·`lib/orders/shipment.ts`): 영문 대문자·숫자 8~30자. 택배사 형식은 이 안에서 더 좁힌다. */
const CARRIER_COMMON_FORMAT=/^[A-Z0-9]{8,30}$/;
export const CARRIER_FORMAT_LENGTH_MIN=8;
export const CARRIER_FORMAT_LENGTH_MAX=30;
export type CarrierFormatKind='none'|'digits'|'alnum';
export interface CarrierFormatChoice { kind:CarrierFormatKind;min:number;max:number }
const CARRIER_FORMAT_PARTS={digits:{chars:'0-9',noun:'숫자'},alnum:{chars:'A-Z0-9',noun:'영문·숫자'}} as const;
export const CARRIER_FORMAT_STALE='화면 정보가 오래됐습니다. 새로고침한 뒤 다시 저장해 주세요.';
export const CARRIER_FORMAT_LENGTH_ERROR=`자리 수는 ${CARRIER_FORMAT_LENGTH_MIN}~${CARRIER_FORMAT_LENGTH_MAX} 사이의 숫자로, 최소가 최대보다 크지 않게 적어 주세요.`;
export const CARRIER_FORMAT_FAILED='운송장 형식을 저장하지 못했습니다. 종류와 자리 수를 확인한 뒤 다시 저장해 주세요.';

/** 고른 종류·자리 수가 만드는 식과 안내 문구. 자리 수가 같으면 `{13}`, 다르면 `{10,14}`다. */
export function carrierFormatSpec(kind:'digits'|'alnum',min:number,max:number):{pattern:string;rule:string} {
  const part=CARRIER_FORMAT_PARTS[kind];
  return {pattern:`^[${part.chars}]{${min===max?min:`${min},${max}`}}$`,rule:`${part.noun} ${min===max?min:`${min}~${max}`}자리`};
}

/** 자리 수 두 칸의 글을 숫자로. 공통 형식(8~30자) 안의 정수가 아니거나 최소가 최대보다 크면 null. */
export function readCarrierFormatLength(min:string,max:string):{min:number;max:number}|null {
  if (!/^\d{1,3}$/.test(min.trim()) || !/^\d{1,3}$/.test(max.trim())) return null;
  const low=Number(min), high=Number(max);
  return low>=CARRIER_FORMAT_LENGTH_MIN && high<=CARRIER_FORMAT_LENGTH_MAX && low<=high ? {min:low,max:high} : null;
}

/**
 * 저장된 식을 종류·자리 수로 읽는다. 비었으면 '정하지 않음'이고, 이 화면이 만드는 모양이 아니면(예전에 직접 적은 식) null이다 —
 * 화면은 그 식을 종류·자리 수로 바꿔 보이지 않고 안내 문구만 보인다.
 */
export function readCarrierFormat(pattern:string|null|undefined):CarrierFormatChoice|null {
  const text=(pattern??'').trim();
  if (!text) return {kind:'none',min:0,max:0};
  const match=/^\^\[(0-9|A-Z0-9)\]\{(\d{1,2})(?:,(\d{1,2}))?\}\$$/.exec(text);
  if (!match) return null;
  const min=Number(match[2]), max=match[3]===undefined?min:Number(match[3]);
  return readCarrierFormatLength(String(min),String(max)) ? {kind:match[1]==='0-9'?'digits':'alnum',min,max} : null;
}

/** 확인용 운송장번호 한 줄 판정(저장 전에 화면이 바로 보여 준다). 저장 때 서버가 같은 기준으로 다시 본다. */
export function carrierSampleVerdict(choice:CarrierFormatChoice,sample:string):'empty'|'match'|'mismatch' {
  const normalized=sample.replace(/[\s-]/g,'').toUpperCase();
  if (!normalized) return 'empty';
  if (!CARRIER_COMMON_FORMAT.test(normalized)) return 'mismatch';
  if (choice.kind==='none') return 'match';
  const range=readCarrierFormatLength(String(choice.min),String(choice.max));
  return range && new RegExp(carrierFormatSpec(choice.kind,range.min,range.max).pattern).test(normalized) ? 'match' : 'mismatch';
}

/** 운송장 형식 폼이 보내는 값(종류·자리 수·확인용 번호)으로 저장할 식과 안내 문구를 만든다. 식은 `parseCarrierFormatInput`이 다시 검사한다. */
export function parseCarrierFormatChoice(input:{kind:string;min:string;max:string;sample:string}):ParsedSettings<{pattern:string;rule:string;sample:string}> {
  if (input.kind!=='none' && input.kind!=='digits' && input.kind!=='alnum') return {ok:false,errors:{form:CARRIER_FORMAT_STALE}};
  if (input.kind==='none') return {ok:true,value:{pattern:'',rule:'',sample:''}};
  const length=readCarrierFormatLength(input.min,input.max);
  if (!length) return {ok:false,errors:{trackingNumberLength:CARRIER_FORMAT_LENGTH_ERROR}};
  const spec=carrierFormatSpec(input.kind,length.min,length.max);
  const parsed=parseCarrierFormatInput({pattern:spec.pattern,rule:spec.rule,sample:input.sample});
  if (parsed.ok) return parsed;
  /* 식과 안내 문구는 화면이 만든 값이라 틀릴 수 없다. 틀렸다면 칸으로 보일 수 없으니 폼 오류로 돌린다. */
  const {trackingNumberSample,...others}=parsed.errors;
  return {ok:false,errors:{...(trackingNumberSample?{trackingNumberSample}:{}),...(Object.keys(others).length?{form:CARRIER_FORMAT_FAILED}:{})}};
}

/* ---- 택배사를 끌 수 있는지 ----
 * 출고지가 기본 택배사로 쓰는 택배사를 끄면(DB가 막지 않아 저장은 된다): ① 그 출고지는 저장할 수 없다(`admin_save_fulfillment_origin`이 사용 안 하는 택배사를 거절한다),
 * ② 지역별 추가배송비를 쓰는 출고지는 새 주문이 막힌다(`private.apply_shipping_region_quote`의 carrier_mismatch), ③ 창고 회신 엑셀의 그 택배사 줄이 거절된다.
 * 그래서 고를 때 막는다. 화면과 서버 액션이 같은 판정(`carrierTurnOff`)을 쓴다. */

/** 택배사를 기본 택배사로 쓰는 출고지 한 곳(화면에 보이는 값). `href`는 그 출고지의 배송정보 관리 탭이다. */
export interface CarrierOriginView { name:string;active:boolean;href:string }
/** 택배사 코드 → 그 택배사를 기본으로 쓰는 출고지. null은 읽지 못했다는 뜻이다(쓰는 곳이 없다는 뜻이 아니다). */
export type CarrierUsesByCode=Record<string,CarrierOriginView[]>|null;

export type CarrierTurnOff =
  /** 끌 수 있다. `inactive`는 사용 안 함인 출고지 가운데 이 택배사를 기본으로 쓰는 곳(알리기만 한다). */
  | {ok:true;inactive:readonly {name:string}[]}
  /** 새 주문을 받는 출고지가 기본 택배사로 쓰고 있어 끌 수 없다. */
  | {ok:false;reason:'in_use';active:readonly {name:string}[]}
  /** 쓰는 출고지를 읽지 못했다. */
  | {ok:false;reason:'unknown'};

/** 사용 중인 택배사를 끌 수 있는가. `uses`는 그 택배사를 기본으로 쓰는 출고지 전부이고, null이면 읽지 못한 것이다. */
export function carrierTurnOff(uses:readonly {name:string;active:boolean}[]|null):CarrierTurnOff {
  if (uses===null) return {ok:false,reason:'unknown'};
  const active=uses.filter(use=>use.active);
  return active.length?{ok:false,reason:'in_use',active}:{ok:true,inactive:uses};
}

/** 출고지 이름 묶음('김포, 남양주 출고지')의 끝말. 이름 끝이 이미 '출고지'면 또 붙이지 않는다. */
export const originNamesSuffix=(names:readonly string[])=>/출고지$/.test(names.join(', '))?'':' 출고지';
export const originNamesLabel=(names:readonly string[])=>`${names.join(', ')}${originNamesSuffix(names)}`;
export const CARRIER_TURN_OFF_UNKNOWN='이 택배사를 기본으로 쓰는 출고지를 확인하지 못해 지금은 끌 수 없습니다. 잠시 뒤 다시 해 주세요.';
export const carrierInUseMessage=(names:readonly string[])=>`${originNamesLabel(names)}가 이 택배사를 기본 택배사로 쓰고 있어 끌 수 없습니다. 배송정보 관리에서 그 출고지의 택배사를 먼저 바꿔 주세요.`;
/** 사용 안 함인 출고지만 쓰고 있어 끌 수는 있을 때 알릴 말. */
export const carrierInactiveUseNote=(names:readonly string[])=>`사용 안 함인 ${originNamesLabel(names)}도 이 택배사를 기본 택배사로 쓰고 있습니다. 끄면 그 출고지는 택배사를 바꾸기 전에는 저장할 수 없습니다.`;
/** 이미 사용 안 함인 택배사를 출고지가 기본으로 쓰고 있을 때 알릴 말. */
export const carrierOffUseNote=(names:readonly string[])=>`${originNamesLabel(names)}가 이 택배사를 기본 택배사로 쓰고 있습니다. 사용 안 함인 동안 그 출고지는 저장할 수 없습니다. 켜거나, 배송정보 관리에서 그 출고지의 택배사를 바꿔 주세요.`;

/**
 * 택배사 이름을 바꾸면 옛 이름으로 적은 창고 회신 줄은 '등록되지 않은 택배사'로 거절된다(회신 파서는 택배사 칸을 코드나 이름으로 맞춘다 —
 * `lib/admin/tracking-import.ts`·`smartstore-tracking-workbook.server.ts`). 코드로 적은 줄은 그대로 등록된다. 이름을 바꿨을 때만 보인다.
 */
export const CARRIER_RENAME_NOTE='이름을 바꾸면 옛 이름으로 적은 창고 회신 줄은 등록되지 않습니다. 코드로 적은 줄은 그대로 등록됩니다.';
export const carrierRenamed=(saved:string,current:string)=>saved.trim()!==''&&current.trim()!==saved.trim();

/** Missing means unconfigured; an explicit blank removes that public row. */
export function mergeBusinessInfo(overrides:Record<string,unknown>,fallback:BusinessInfo=BUSINESS_INFO):BusinessInfo {
  return Object.fromEntries(Object.keys(BUSINESS_INFO_LABELS).map(key=>[key,
    typeof overrides[key] === 'string' ? overrides[key].trim() : fallback[key as keyof BusinessInfo],
  ])) as unknown as BusinessInfo;
}

export function parseStoreSettingsInput(section:'business'|'bank_transfer',input:unknown):ParsedSettings<StoreSettingsValue> {
  const fields=section==='business'?BUSINESS_INFO_LABELS:BANK_ACCOUNT_LABELS;
  if (!input || typeof input!=='object' || Array.isArray(input)) return {ok:false,errors:{form:'설정 값을 다시 확인해주세요.'}};
  const entries=Object.entries(input);
  if (entries.some(([key,value])=>!Object.hasOwn(fields,key)||typeof value!=='string')) return {ok:false,errors:{form:'이 화면에서 저장할 수 없는 설정 항목이 들어 있습니다. 새로고침한 뒤 다시 저장해주세요.'}};
  const value:StoreSettingsValue=Object.fromEntries(entries.map(([key,v])=>[key,(v as string).trim()]));
  const errors:Record<string,string>={};
  for (const [key,text] of Object.entries(value)) {
    if (text.length>500 || /[\u0000-\u001f\u007f]/.test(text)) errors[key]='500자 이내의 한 줄로 입력해주세요.';
  }
  if (section==='business' && value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) errors.email='올바른 이메일 주소를 입력해주세요.';
  if (section==='bank_transfer') {
    const filled=Object.keys(BANK_ACCOUNT_LABELS).filter(key=>Boolean(value[key]));
    if (filled.length!==0 && filled.length!==3) errors.form='무통장 계좌는 은행·계좌번호·예금주를 모두 입력하거나 모두 비워주세요.';
    if (Object.keys(value).length!==3) errors.form='무통장 계좌 칸을 읽지 못했습니다. 새로고침한 뒤 다시 저장해주세요.';
  }
  return Object.keys(errors).length?{ok:false,errors}:{ok:true,value};
}

/** 배송조회 주소가 안 되는 까닭(고칠 방법과 함께). 쓸 수 있는 주소면 null. 판정 기준은 DB `admin_save_shipping_carrier`와 같다. */
export function carrierTrackingUrlError(text:string):string|null {
  const generic='https://로 시작하는 주소에 {trackingNumber}를 넣어 주세요. 그 자리에 운송장번호가 들어갑니다.';
  let url:URL;
  try { url=new URL(text); } catch { return generic; }
  if (url.username || url.password) return '주소에 아이디나 비밀번호는 넣을 수 없습니다.';
  if (text.length>500) return '배송조회 주소는 500자 이내로 적어 주세요.';
  if (!/^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]{1,5})?[/#?]/.test(text) || url.protocol!=='https:' || !url.hostname || !text.includes('{trackingNumber}') || /[\s\\]/.test(text)) return generic;
  return null;
}

export function parseCarrierInput(input:{code:string;label:string;trackingUrlTemplate:string;active:boolean}):ParsedSettings<Omit<EditableCarrier,'updatedAt'>> {
  const value={...input,code:input.code.trim(),label:input.label.trim(),trackingUrlTemplate:input.trackingUrlTemplate.trim()};
  const errors:Record<string,string>={};
  if (!/^[a-z0-9_]{2,32}$/.test(value.code)) errors.code='택배사 코드는 영문 소문자·숫자·밑줄 2~32자입니다.';
  if (!value.label || value.label.length>60) errors.label='택배사 이름은 1~60자로 입력해주세요.';
  const urlError=carrierTrackingUrlError(value.trackingUrlTemplate);
  if (urlError) errors.trackingUrlTemplate=urlError;
  return Object.keys(errors).length?{ok:false,errors}:{ok:true,value};
}

/** Show only changed operator-facing fields, not row ids or database timestamps. */
export function storeSettingsHistoryRows(entry:StoreSettingsAudit) {
  const labels:Record<string,string>={...BUSINESS_INFO_LABELS,...BANK_ACCOUNT_LABELS,
    code:'코드',label:'이름',tracking_url_template:'배송조회 주소',is_active:'사용 여부',tracking_number_pattern:'운송장 형식',tracking_number_rule:'운송장 형식',
    default_carrier:'기본 택배사',export_template:'발주서 양식',name:'출고지 이름',base_fee:'기본 배송비',free_threshold:'무료배송 기준',return_address:'반품 주소',cutoff:'마감 시각'};
  const before=entry.diff.before&&typeof entry.diff.before==='object'?entry.diff.before as Record<string,unknown>:{};
  const after=entry.diff.after&&typeof entry.diff.after==='object'?entry.diff.after as Record<string,unknown>:{};
  const words=(value:unknown)=>value===true?'사용':value===false?'사용 안 함':typeof value==='string'||typeof value==='number'?String(value):'없음';
  if (entry.target==='store_settings:navigation') {
    const oldItems=Array.isArray(entry.diff.before)?entry.diff.before as StoreNavigation:[];
    const newItems=Array.isArray(entry.diff.after)?entry.diff.after as StoreNavigation:[];
    return STOREFRONT_MENU_ITEMS.flatMap(item=>{
      const oldIndex=oldItems.findIndex(row=>row.id===item.id),newIndex=newItems.findIndex(row=>row.id===item.id);
      const old=oldItems[oldIndex],next=newItems[newIndex];
      return [
        ...(oldIndex!==newIndex?[{key:`${item.id}.order`,label:`${item.label} · 순서`,before:oldIndex<0?'없음':String(oldIndex+1),after:newIndex<0?'없음':String(newIndex+1)}]:[]),
        ...(['label','visible'] as const).filter(key=>old?.[key]!==next?.[key]).map(key=>({key:`${item.id}.${key}`,label:`${item.label} · ${key==='label'?'메뉴명':'노출'}`,before:words(old?.[key]),after:words(next?.[key])})),
      ];
    });
  }
  if (entry.target==='store_settings:branding') {
    const brandLabels:Record<string,string>={displayName:'스토어 표시 이름',logoMode:'로고 표시 방식',logoPath:'PC 로고',mobileLogoPath:'모바일 로고',introduction:'스토어 소개',showIntroduction:'소개 노출'};
    const brandWords=(value:unknown)=>value==='text'?'텍스트':value==='image'?'이미지':words(value);
    const rows=Object.entries(brandLabels).filter(([key])=>before[key]!==after[key]).map(([key,label])=>({key,label,before:brandWords(before[key]),after:brandWords(after[key])}));
    for (const platform of STORE_SOCIAL_PLATFORMS) {
      const old=(before.socials as StoreBranding['socials']|undefined)?.[platform];
      const next=(after.socials as StoreBranding['socials']|undefined)?.[platform];
      for (const key of ['enabled','url'] as const) if (old?.[key]!==next?.[key]) rows.push({key:`${platform}.${key}`,label:`${STORE_SOCIAL_LABELS[platform]} · ${key==='enabled'?'노출':'주소'}`,before:words(old?.[key]),after:words(next?.[key])});
    }
    return rows;
  }
  if (entry.target==='store_settings:inquiry_auto_replies') {
    return INQUIRY_CATEGORIES.flatMap(({id,label})=>{
      const old=before[id] as {enabled?:boolean;body?:string}|undefined;
      const next=after[id] as {enabled?:boolean;body?:string}|undefined;
      return (['enabled','body'] as const).filter(key=>old?.[key]!==next?.[key]).map(key=>({
        key:`${id}.${key}`,label:`${adminGoodsCopy(label)} · ${key==='enabled'?'사용 여부':'안내 문구'}`,
        before:words(old?.[key]),after:words(next?.[key]),
      }));
    });
  }
  const rows=Object.keys(labels).filter(key=>(key in before||key in after)&&before[key]!==after[key])
    .map(key=>({key,label:labels[key],before:words(before[key]),after:words(after[key])}));
  /* 택배사의 운송장 형식은 사람이 읽는 안내 문구('숫자 10~14자리')로 보인다. 안내 문구가 함께 바뀌었으면 식(정규식) 줄은 뺀다. */
  return rows.some(row=>row.key==='tracking_number_rule')?rows.filter(row=>row.key!=='tracking_number_pattern'):rows;
}
