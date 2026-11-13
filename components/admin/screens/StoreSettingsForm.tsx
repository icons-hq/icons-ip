'use client';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { useActionState, useState } from 'react';
import { Check } from 'lucide-react';
import { saveStoreSettingsAction,saveShippingCarrierAction,saveInquiryAutoRepliesAction,type StoreSettingsActionState } from '@/app/admin/store-settings-actions';
import { AdminField,AdminFormGrid, AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { BUSINESS_INFO_LABELS } from '@/lib/legal/business-info';
import { INQUIRY_CATEGORIES } from '@/lib/inquiries';
import { BANK_ACCOUNT_LABELS,mergeBusinessInfo,type EditableCarrier,type StoreSettingsSnapshot } from '@/lib/admin/store-settings';
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
export function ShippingCarrierForm({carrier,canEdit}:{carrier?:EditableCarrier;canEdit:boolean}) {
  const [state,action,pending]=useActionState(saveShippingCarrierAction,{});
  const {formRef}=useAdminLeaveGuard({serverState:state});
  return <form action={action} className="flex min-w-0 flex-col gap-4" ref={formRef}>
    <input type="hidden" name="updatedAt" value={latestStamp(carrier?.updatedAt??'',state.updatedAt)}/>
    <AdminFormGrid>{[
      ['code','택배사 코드',carrier?.code??''],['label','택배사 이름',carrier?.label??''],['trackingUrlTemplate','배송조회 URL',carrier?.trackingUrlTemplate??''],
    ].map(([key,label,initial])=><div className={key==='trackingUrlTemplate'?'col-span-full min-w-0':'min-w-0'} key={key}><AdminField label={label} inputId={`carrier-${carrier?.code??'new'}-${key}`} error={state.errors?.[key]} hint={key==='trackingUrlTemplate'?'운송장번호 자리에 {trackingNumber}를 넣습니다.':key==='code'&&carrier?'등록 후 바꿀 수 없습니다.':undefined}>
      <Input className={key==='code'&&carrier?'border-dashed bg-muted':readOnlyLook(canEdit)} id={`carrier-${carrier?.code??'new'}-${key}`} name={key} defaultValue={state.values?.[key]??initial} maxLength={key==='label'?60:key==='code'?32:500} readOnly={!canEdit||key==='code'&&Boolean(carrier)}
        aria-invalid={Boolean(state.errors?.[key])} aria-describedby={state.errors?.[key]?`carrier-${carrier?.code??'new'}-${key}-error`:key==='trackingUrlTemplate'||key==='code'&&carrier?`carrier-${carrier?.code??'new'}-${key}-hint`:undefined}/>
    </AdminField></div>)}</AdminFormGrid>
    <label className={CHECK_LABEL}><input type="checkbox" name="active" value="true" defaultChecked={state.values?state.values.active==='true':carrier?.active??true} disabled={!canEdit}/> 새 발송에서 사용</label>
    <p className={NOTE}>비활성화해도 기존 주문의 배송조회 링크는 유지됩니다.</p><Feedback state={state}/>
    {canEdit?<Button className="w-fit" disabled={pending} type="submit"><Check aria-hidden="true"/>{pending?'저장 중…':carrier?'택배사 저장':'택배사 등록'}</Button>:null}
  </form>;
}
