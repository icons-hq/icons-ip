'use client';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import Link from 'next/link';
import { Fragment, useActionState, useState } from 'react';
import { Check } from 'lucide-react';
import { saveStoreSettingsAction,saveShippingCarrierAction,saveShippingCarrierFormatAction,saveInquiryAutoRepliesAction,type StoreSettingsActionState } from '@/app/admin/store-settings-actions';
import { AdminField,AdminFormGrid, AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { BUSINESS_INFO_LABELS } from '@/lib/legal/business-info';
import { INQUIRY_CATEGORIES } from '@/lib/inquiries';
import { FULFILLMENT_ORIGINS_PATH } from '@/lib/admin/fulfillment-origins';
import {
  BANK_ACCOUNT_LABELS,CARRIER_RENAME_NOTE,CARRIER_TURN_OFF_UNKNOWN,carrierFormatLengthProblem,carrierFormatSpec,carrierRenamed,carrierSampleVerdict,carrierTurnOff,mergeBusinessInfo,originNamesSuffix,readCarrierFormat,readCarrierFormatLength,
  type CarrierFormatKind,type CarrierOriginView,type EditableCarrier,type StoreSettingsSnapshot,
} from '@/lib/admin/store-settings';
import { GoodChoiceCard,GoodChoiceCards,GoodReadback } from '../GoodEditorParts';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { SettingsSaveBar } from './StoreSettingsFormGroup';
import { useAdminLeaveGuard } from '../useAdminLeaveGuard';

const NOTE = 'text-sm text-muted-foreground';
const CHECK_LABEL = 'flex w-fit items-center gap-2 text-sm';

function Feedback({state}:{state:StoreSettingsActionState}) {
  return <>{state.errors?.form?<AdminNotice role="alert" tone="danger">{state.errors.form}</AdminNotice>:null}{state.message?<AdminNotice role="status" tone="success">{state.message}</AdminNotice>:null}</>;
}
/* 조회 전용 계정(S-T21a-02): 안내는 폼 맨 위 상자로, 입력칸은 편집할 수 없는 모양(흐린 바탕·기본 커서)으로 그린다. */
const READ_ONLY_FIELD = 'cursor-default bg-muted text-muted-foreground focus-visible:ring-0';
const readOnlyLook=(canEdit:boolean)=>canEdit?undefined:READ_ONLY_FIELD;
function ReadOnlyNotice() {
  return <AdminNotice tone="info" title="조회 전용" role="note">현재 계정은 이 설정을 조회할 수 있습니다. 변경 권한이 있는 매니저에게 요청해주세요.</AdminNotice>;
}
function latestStamp(server:string,local?:string) {return local&&Date.parse(local)>Date.parse(server)?local:server;}
export function StoreSettingsForm({section,settings,canEdit}:{section:'business'|'bank_transfer';settings:StoreSettingsSnapshot;canEdit:boolean}) {
  const [state,action,pending]=useActionState(saveStoreSettingsAction,{});
  const {formRef}=useAdminLeaveGuard({serverState:state});
  const [contactHelpOpen,setContactHelpOpen]=useState(false);
  const labels=section==='business'?BUSINESS_INFO_LABELS:BANK_ACCOUNT_LABELS;
  const defaults:Record<string,string>=section==='business'?{...mergeBusinessInfo(settings.business)}:{bank:'',accountNumber:'',holder:'',...settings.bankTransfer};
  return <form action={action} className="flex min-w-0 flex-col gap-4" ref={formRef}>
    {canEdit?null:<ReadOnlyNotice/>}
    <input type="hidden" name="section" value={section}/>
    <input type="hidden" name="updatedAt" value={latestStamp(settings.updatedAt,state.updatedAt)}/>
    <AdminFormGrid>{Object.entries(labels).map(([key,label])=><AdminField key={key} label={label} inputId={`settings-${key}`} error={state.errors?.[key]}>
      {section==='business'&&key==='phone'?<div className="flex min-w-0 gap-2">
        <Input id={`settings-${key}`} name={key} defaultValue={state.values?.[key]??defaults[key]} maxLength={500} readOnly={!canEdit}
          aria-invalid={Boolean(state.errors?.[key])} aria-describedby={state.errors?.[key]?`settings-${key}-error`:undefined} className={`min-w-0 flex-1${canEdit?'':` ${READ_ONLY_FIELD}`}`} type="text"/>
        <Button className="shrink-0" onClick={()=>setContactHelpOpen(true)} type="button" variant="outline">고객센터 노출위치</Button>
      </div>:<Input id={`settings-${key}`} name={key} defaultValue={state.values?.[key]??defaults[key]} maxLength={500} readOnly={!canEdit}
        aria-invalid={Boolean(state.errors?.[key])} aria-describedby={state.errors?.[key]?`settings-${key}-error`:undefined} className={readOnlyLook(canEdit)} type={key==='email'?'email':'text'}/>}
    </AdminField>)}</AdminFormGrid>
    {section==='bank_transfer'?<AdminNotice tone="warning">세 항목을 모두 비우면 새 주문에서 무통장 입금이 표시되지 않습니다. 기존 입금 대기 주문을 먼저 확인해주세요.</AdminNotice>:<AdminNotice tone="warning">빈 항목은 공개 사업자 정보에서 숨겨집니다. 연락처를 변경하면 푸터와 법정 문서에 함께 반영됩니다.</AdminNotice>}
    {canEdit?<SettingsSaveBar><div className="flex min-w-0 flex-1 flex-col gap-2 empty:hidden"><Feedback state={state}/></div><Button disabled={pending} type="submit"><Check aria-hidden="true"/>{pending?'저장 중…':'설정 저장'}</Button></SettingsSaveBar>:null}
    {contactHelpOpen?<CustomerServiceDialog title="고객센터 연락처 노출위치" onClose={()=>setContactHelpOpen(false)}>
      <div className="flex flex-col gap-5 leading-relaxed" data-contact-help="">
      <section className="flex flex-col gap-1.5">
      <h3 className="text-sm font-medium">쇼핑몰 하단</h3>
      <p className="text-muted-foreground">저장한 전화번호와 이메일은 쇼핑몰 하단의 고객센터에 표시됩니다. 주문 상세에서도 같은 하단 연락처를 확인할 수 있습니다.</p>
      </section><section className="flex flex-col gap-1.5">
      <h3 className="text-sm font-medium">사업자 정보·법정 문서</h3>
      <p className="text-muted-foreground">사업자 정보와 이용약관 등 법정 문서의 연락처에도 함께 반영됩니다. 빈 항목은 표시하지 않으며, 아직 저장하지 않은 입력은 공개 화면에 반영되지 않습니다.</p>
      </section>
      <Button className="min-w-24 self-center" onClick={()=>setContactHelpOpen(false)} type="button">확인</Button>
      </div>
    </CustomerServiceDialog>:null}
  </form>;
}
export function InquiryAutoRepliesForm({settings,canEdit}:{settings:StoreSettingsSnapshot;canEdit:boolean}) {
  const [state,action,pending]=useActionState(saveInquiryAutoRepliesAction,{});
  const {formRef}=useAdminLeaveGuard({serverState:state});
  // External revalidation must not advance the version of unsaved inputs.
  const [editingStamp,setEditingStamp]=useState(settings.updatedAt);
  if (state.updatedAt && state.updatedAt!==editingStamp) setEditingStamp(state.updatedAt);
  return <form action={action} className="flex min-w-0 flex-col gap-4" ref={formRef}>
    {canEdit?null:<ReadOnlyNotice/>}
    <input type="hidden" name="updatedAt" value={editingStamp}/>
    <p className={NOTE}>문의 유형별 사용 여부와 안내 문구를 함께 저장합니다. 기본은 모두 꺼짐입니다. 문구에 HTTPS로 시작하는 FAQ 전체 주소를 넣을 수 있습니다.</p>
    <div key={state.attempt??0} className="flex min-w-0 flex-col gap-4" data-auto-replies="">
      {INQUIRY_CATEGORIES.map(({id,label})=><fieldset key={id} disabled={pending} className="flex min-w-0 flex-col gap-3 rounded-lg border p-4">
        <legend className="float-left w-full p-0 text-sm font-medium">{adminGoodsCopy(label)}</legend>
        <label className={CHECK_LABEL}><input type="checkbox" name={`${id}.enabled`} value="true" disabled={!canEdit}
          defaultChecked={state.values?state.values[`${id}.enabled`]==='true':settings.inquiryAutoReplies[id].enabled}/> {adminGoodsCopy(label)} 자동 안내 사용</label>
        <AdminField label="안내 문구" inputId={`auto-reply-${id}`} error={state.errors?.[`${id}.body`]} hint="최대 2,000자. 사용을 켜려면 공백이 아닌 문구가 필요합니다.">
          <Textarea id={`auto-reply-${id}`} name={`${id}.body`} rows={4} maxLength={2000} readOnly={!canEdit} className={`min-h-24 resize-y field-sizing-fixed${canEdit?'':` ${READ_ONLY_FIELD}`}`}
            defaultValue={state.values?.[`${id}.body`]??settings.inquiryAutoReplies[id].body}
            aria-invalid={Boolean(state.errors?.[`${id}.body`])}
            aria-describedby={`auto-reply-${id}-hint${state.errors?.[`${id}.body`]?` auto-reply-${id}-error`:''}`}/>
        </AdminField>
      </fieldset>)}
    </div>
    <Feedback state={state}/>
    {canEdit?<Button className="w-fit" disabled={pending} type="submit"><Check aria-hidden="true"/>{pending?'저장 중…':'문의 자동 안내 저장'}</Button>:null}
  </form>;
}
/** 운송장 형식을 고르는 세 카드. 종류를 고르면 필요한 입력(자리 수·확인용 번호)만 열린다. */
const FORMAT_CARDS:{kind:CarrierFormatKind;title:string;description?:string}[]=[
  {kind:'none',title:'정하지 않음',description:'공통 형식(8~30자 영문·숫자)만 확인합니다.'},
  {kind:'digits',title:'숫자만'},
  {kind:'alnum',title:'영문과 숫자'},
];

/**
 * 택배사 운송장 형식(SHP-032). 등록된 택배사에만 있다. 식(정규식)을 적지 않고 종류(숫자만·영문과 숫자)와 자리 수를 고르면 같은 모양의 식과
 * 안내 문구가 저장된다(`^[0-9]{10,14}$` · `숫자 10~14자리`). 실제 운송장번호 하나를 넣으면 새 형식에 맞는지 바로 보이고, 저장 때 서버가 다시 확인한다.
 * 저장한 형식은 다음 등록부터 모든 등록 경로의 판정·안내에 쓰인다. 예전에 식을 직접 적어 이 화면의 모양이 아닌 형식은 안내 문구만 보이고,
 * [형식 새로 정하기]를 눌러야 새로 고를 수 있다.
 * 종류 카드는 `defaultChecked`로 두고 `onChange`로 따라간다 — 폼은 액션이 끝나면 React가 다시 맞추는데(reset), 제어하는 라디오는 처음 골라져 있던 것으로 돌아간다.
 * 자리 수는 숫자 입력(number)이 아니라 글자 입력(numeric 자판)이다 — 칸에 커서가 있으면 React가 기본값을 갱신하지 않아 reset 뒤 옛 숫자로 돌아간다.
 */
export function ShippingCarrierFormatForm({carrier,canEdit}:{carrier:EditableCarrier;canEdit:boolean}) {
  const [state,action,pending]=useActionState(saveShippingCarrierFormatAction,{});
  const {formRef}=useAdminLeaveGuard({serverState:state});
  const stored=readCarrierFormat(carrier.trackingNumberPattern);
  const [editing,setEditing]=useState(false);
  const [kind,setKind]=useState<CarrierFormatKind>(stored?.kind??'digits');
  const [min,setMin]=useState(stored&&stored.kind!=='none'?String(stored.min):'');
  const [max,setMax]=useState(stored&&stored.kind!=='none'?String(stored.max):'');
  const [sample,setSample]=useState('');
  const id=(key:string)=>`carrier-${carrier.code}-format-${key}`;
  if (!canEdit || (stored===null && !editing)) {
    const current=stored===null?carrier.trackingNumberRule||'이 화면에서 정하지 않은 형식':stored.kind==='none'?'정하지 않음 — 공통 형식(8~30자 영문·숫자)만 확인합니다.':carrierFormatSpec(stored.kind,stored.min,stored.max).rule;
    return <div className="flex min-w-0 flex-col gap-2 border-t pt-4" data-carrier-format="">
      <p className="text-sm font-medium text-foreground">운송장 형식</p>
      <p className="text-sm">{current}</p>
      {canEdit?<Button className="w-fit" onClick={()=>setEditing(true)} size="sm" type="button" variant="outline">형식 새로 정하기</Button>:null}
    </div>;
  }
  const length=kind==='none'?null:readCarrierFormatLength(min,max);
  /* 자리 수를 읽을 수 없으면 되읽기 한 줄이 말없이 사라지지 않도록 까닭과 고칠 방법을 칸 아래에 바로 보인다. 저장 뒤 서버가 돌려준 오류는 그다음 순서다. */
  const lengthError=kind==='none'?undefined:carrierFormatLengthProblem(min,max)??state.errors?.trackingNumberLength;
  const readback=kind!=='none'&&length?`${carrier.label} 운송장번호는 ${carrierFormatSpec(kind,length.min,length.max).rule}여야 등록됩니다.`:null;
  const verdict=kind!=='none'&&length?carrierSampleVerdict({kind,min:length.min,max:length.max},sample):'empty';
  const sampleHint=verdict==='match'?'이 번호는 형식에 맞습니다.':verdict==='mismatch'?'이 번호는 형식에 맞지 않습니다.':'실제 운송장번호 하나를 넣어 형식에 맞는지 확인합니다. 저장되지 않습니다.';
  /* noValidate: 빈 칸은 브라우저 기본 말풍선("이 입력란을 작성하세요.") 대신 칸 아래의 앱 문구로 알린다(저장 때 서버가 칸마다 말한다). required는 접근성 표시로 남긴다. */
  return <form action={action} className="flex min-w-0 flex-col gap-4 border-t pt-4" ref={formRef} data-carrier-format="" noValidate>
    <input type="hidden" name="code" value={carrier.code}/>
    <input type="hidden" name="updatedAt" value={latestStamp(carrier.updatedAt,state.updatedAt)}/>
    <p className={NOTE}>모든 운송장 등록(발송처리·운송장 수정·창고 회신·추가 운송장·교환 재출고)이 이 형식에 맞아야 합니다.</p>
    {/* 예전에 식을 직접 적은 형식은 이 화면의 카드로 나타낼 수 없다 — 저장하면 그 형식이 사라진다는 것을 [형식 새로 정하기]를 누른 사람에게 말한다. */}
    {stored===null?<p className={NOTE}>지금은 직접 적은 형식({carrier.trackingNumberRule||'이 화면에서 정하지 않은 형식'})을 쓰고 있습니다. 저장하면 이 화면에서 고른 형식으로 바뀌고 예전 형식은 없어집니다. 그만두려면 화면을 새로고침해 주세요.</p>:null}
    <GoodChoiceCards legend="운송장 형식">
      {FORMAT_CARDS.map(card=><GoodChoiceCard defaultChecked={kind===card.kind} description={card.description} key={card.kind} name="trackingNumberKind" onChange={()=>setKind(card.kind)} title={card.title} value={card.kind}/>)}
    </GoodChoiceCards>
    {kind!=='none'?<>
      <AdminField label="자리 수" inputId={id('min')} error={lengthError}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Input aria-describedby={lengthError?`${id('min')}-error`:undefined} aria-invalid={Boolean(lengthError)} aria-label="최소 자리 수" className="w-20 text-right tabular-nums" id={id('min')} inputMode="numeric" maxLength={2} name="trackingNumberMin" onChange={event=>setMin(event.target.value)} required value={min}/>
          <span aria-hidden="true">~</span>
          <Input aria-describedby={lengthError?`${id('min')}-error`:undefined} aria-invalid={Boolean(lengthError)} aria-label="최대 자리 수" className="w-20 text-right tabular-nums" id={id('max')} inputMode="numeric" maxLength={2} name="trackingNumberMax" onChange={event=>setMax(event.target.value)} required value={max}/>
          <span>자리</span>
        </div>
      </AdminField>
      {readback?<GoodReadback>{readback}</GoodReadback>:null}
      <AdminField label="확인용 운송장번호 (필수)" inputId={id('sample')} error={state.errors?.trackingNumberSample} hint={sampleHint}>
        <Input aria-describedby={state.errors?.trackingNumberSample?`${id('sample')}-error`:`${id('sample')}-hint`} aria-invalid={Boolean(state.errors?.trackingNumberSample)} autoComplete="off" id={id('sample')} maxLength={40} name="trackingNumberSample" onChange={event=>setSample(event.target.value)} required spellCheck={false} value={sample}/>
      </AdminField>
    </>:null}
    <Feedback state={state}/>
    <Button className="w-fit" disabled={pending} type="submit" variant="outline"><Check aria-hidden="true"/>{pending?'저장 중…':'운송장 형식 저장'}</Button>
  </form>;
}

/** 출고지 이름 묶음. 이름마다 그 출고지의 배송정보 관리 탭으로 가는 링크다(문장은 `lib/admin/store-settings.ts`의 같은 이름 문구와 같다). */
const NOTE_LINK='underline underline-offset-4';
function OriginLinks({uses}:{uses:readonly CarrierOriginView[]}) {
  return <>{uses.map((use,index)=><Fragment key={`${use.href}:${use.name}`}>{index?', ':null}<Link className={NOTE_LINK} href={use.href}>{use.name}</Link></Fragment>)}{originNamesSuffix(uses.map(use=>use.name))}</>;
}
const OriginsPageLink=()=><Link className={NOTE_LINK} href={FULFILLMENT_ORIGINS_PATH}>배송정보 관리</Link>;

/**
 * 택배사 등록·수정. `uses`는 이 택배사를 기본 택배사로 쓰는 출고지다(택배사 관리 화면이 저장할 수 있는 사람에게만 읽어 넘긴다).
 * 새 주문을 받는 출고지가 쓰는 택배사는 끌 수 없다 — 끄면 그 출고지는 저장할 수 없고 지역별 추가배송비를 쓰는 출고지는 새 주문이 막힌다.
 * 못 읽었으면(null) 끄지 못하게 하고 그렇게 말한다. 안 줬으면(undefined) 화면은 막지 않고, 저장 때 서버가 같은 판정으로 막는다.
 */
export function ShippingCarrierForm({carrier,canEdit,uses}:{carrier?:EditableCarrier;canEdit:boolean;uses?:readonly CarrierOriginView[]|null}) {
  const [state,action,pending]=useActionState(saveShippingCarrierAction,{});
  const {formRef}=useAdminLeaveGuard({serverState:state});
  const [label,setLabel]=useState(carrier?.label??'');
  const key=carrier?.code??'new';
  const verdict=carrier?.active&&uses!==undefined?carrierTurnOff(uses):null;
  const refusal=canEdit&&verdict&&!verdict.ok?verdict:null;
  const locked=refusal!==null;
  const blocking=uses?.filter(use=>use.active)??[];
  const inactiveUses=uses?.filter(use=>!use.active)??[];
  const noteId=`carrier-${key}-active-note`;
  const fields:{key:'code'|'label'|'trackingUrlTemplate';label:string;initial:string;hint?:string;max:number}[]=[
    {key:'code',label:'택배사 코드',initial:carrier?.code??'',hint:'창고 회신 엑셀의 택배사 칸에 이 코드나 이름을 적습니다. 등록 후 바꿀 수 없습니다.',max:32},
    {key:'label',label:'택배사 이름',initial:carrier?.label??'',hint:carrier&&carrierRenamed(carrier.label,label)?CARRIER_RENAME_NOTE:undefined,max:60},
    {key:'trackingUrlTemplate',label:'배송조회 주소',initial:carrier?.trackingUrlTemplate??'',hint:'운송장번호가 들어갈 자리에 {trackingNumber}를 적습니다. 예: https://example.com/?no={trackingNumber}',max:500},
  ];
  return <form action={action} className="flex min-w-0 flex-col gap-4" ref={formRef}>
    <input type="hidden" name="updatedAt" value={latestStamp(carrier?.updatedAt??'',state.updatedAt)}/>
    <AdminFormGrid>{fields.map(field=>{
      const inputId=`carrier-${key}-${field.key}`;
      return <div className={field.key==='trackingUrlTemplate'?'col-span-full min-w-0':'min-w-0'} key={field.key}><AdminField label={field.label} inputId={inputId} error={state.errors?.[field.key]} hint={field.hint}>
        <Input className={field.key==='code'&&carrier?'border-dashed bg-muted':readOnlyLook(canEdit)} id={inputId} name={field.key} defaultValue={state.values?.[field.key]??field.initial} maxLength={field.max} readOnly={!canEdit||field.key==='code'&&Boolean(carrier)}
          onChange={field.key==='label'?event=>setLabel(event.target.value):undefined}
          aria-invalid={Boolean(state.errors?.[field.key])} aria-describedby={state.errors?.[field.key]?`${inputId}-error`:field.hint?`${inputId}-hint`:undefined}/>
      </AdminField></div>;
    })}</AdminFormGrid>
    <label className={CHECK_LABEL}><input type="checkbox" name={locked?undefined:'active'} value="true" defaultChecked={state.values?state.values.active==='true':carrier?.active??true} disabled={!canEdit||locked} aria-describedby={locked?noteId:undefined}/> 사용</label>
    {/* 못 끄는 택배사는 켠 채로 보낸다(사용 안 하는 칸은 제출되지 않아 끄는 것으로 읽힌다). */}
    {locked?<input type="hidden" name="active" value="true"/>:null}
    {refusal?.reason==='in_use'?<div id={noteId}><AdminNotice tone="warning"><OriginLinks uses={blocking}/>가 이 택배사를 기본 택배사로 쓰고 있어 끌 수 없습니다. <OriginsPageLink/>에서 그 출고지의 택배사를 먼저 바꿔 주세요.</AdminNotice></div>:null}
    {refusal?.reason==='unknown'?<div id={noteId}><AdminNotice tone="warning">{CARRIER_TURN_OFF_UNKNOWN}</AdminNotice></div>:null}
    {canEdit&&verdict?.ok&&inactiveUses.length?<AdminNotice tone="info">사용 안 함인 <OriginLinks uses={inactiveUses}/>도 이 택배사를 기본 택배사로 쓰고 있습니다. 끄면 그 출고지는 택배사를 바꾸기 전에는 저장할 수 없습니다.</AdminNotice>:null}
    {canEdit&&carrier&&!carrier.active&&uses?.length?<AdminNotice tone="warning"><OriginLinks uses={uses}/>가 이 택배사를 기본 택배사로 쓰고 있습니다. 사용 안 함인 동안 그 출고지는 저장할 수 없습니다. 켜거나, <OriginsPageLink/>에서 그 출고지의 택배사를 바꿔 주세요.</AdminNotice>:null}
    <p className={NOTE}>사용 안 함이면 새 발송과 창고 회신 엑셀에서 쓸 수 없습니다. 이미 발송한 주문의 배송조회 링크는 그대로입니다.</p><Feedback state={state}/>
    {canEdit?<Button className="w-fit" disabled={pending} type="submit"><Check aria-hidden="true"/>{pending?'저장 중…':carrier?'택배사 저장':'택배사 등록'}</Button>:null}
  </form>;
}
