'use client';
import { useActionState } from 'react';
import { saveStoreSettingsAction,saveShippingCarrierAction,type StoreSettingsActionState } from '@/app/admin/store-settings-actions';
import { AdminField,AdminFormGrid } from '@/components/admin/console/AdminKit';
import { BUSINESS_INFO_LABELS } from '@/lib/legal/business-info';
import { BANK_ACCOUNT_LABELS,mergeBusinessInfo,type EditableCarrier,type StoreSettingsSection,type StoreSettingsSnapshot } from '@/lib/admin/store-settings';

function Feedback({state}:{state:StoreSettingsActionState}) {
  return <>{state.errors?.form?<p role="alert">{state.errors.form}</p>:null}{state.message?<p role="status">{state.message}</p>:null}</>;
}
function latestStamp(server:string,local?:string) {return local&&Date.parse(local)>Date.parse(server)?local:server;}
export function StoreSettingsForm({section,settings,canEdit}:{section:StoreSettingsSection;settings:StoreSettingsSnapshot;canEdit:boolean}) {
  const [state,action,pending]=useActionState(saveStoreSettingsAction,{});
  const labels=section==='business'?BUSINESS_INFO_LABELS:BANK_ACCOUNT_LABELS;
  const defaults:Record<string,string>=section==='business'?{...mergeBusinessInfo(settings.business)}:{bank:'',accountNumber:'',holder:'',...settings.bankTransfer};
  return <form action={action} className="wc-admin-kit">
    <input type="hidden" name="section" value={section}/>
    <input type="hidden" name="updatedAt" value={latestStamp(settings.updatedAt,state.updatedAt)}/>
    <AdminFormGrid>{Object.entries(labels).map(([key,label])=><AdminField key={key} label={label} inputId={`settings-${key}`} error={state.errors?.[key]}>
      <input id={`settings-${key}`} name={key} defaultValue={state.values?.[key]??defaults[key]} maxLength={500} readOnly={!canEdit}
        aria-invalid={Boolean(state.errors?.[key])} aria-describedby={state.errors?.[key]?`settings-${key}-error`:undefined} type={key==='email'?'email':'text'}/>
    </AdminField>)}</AdminFormGrid>
    {section==='bank_transfer'?<p>세 항목을 모두 비우면 새 주문에서 무통장 입금이 표시되지 않습니다. 기존 입금 대기 주문을 먼저 확인해주세요.</p>:<p>빈 항목은 공개 사업자 정보에서 숨겨집니다. 연락처를 변경하면 푸터와 법정 문서에 함께 반영됩니다.</p>}
    <Feedback state={state}/>
    {canEdit?<button className="btn" type="submit" disabled={pending}>{pending?'저장 중…':'설정 저장'}</button>:<p>직원(staff)은 조회할 수 있습니다. 변경은 관리자(admin)에게 요청해주세요.</p>}
  </form>;
}
export function ShippingCarrierForm({carrier,canEdit}:{carrier?:EditableCarrier;canEdit:boolean}) {
  const [state,action,pending]=useActionState(saveShippingCarrierAction,{});
  return <form action={action} className="wc-admin-kit">
    <input type="hidden" name="updatedAt" value={latestStamp(carrier?.updatedAt??'',state.updatedAt)}/>
    <AdminFormGrid>{[
      ['code','택배사 코드',carrier?.code??''],['label','택배사 이름',carrier?.label??''],['trackingUrlTemplate','배송조회 URL',carrier?.trackingUrlTemplate??''],
    ].map(([key,label,initial])=><AdminField key={key} label={label} inputId={`carrier-${carrier?.code??'new'}-${key}`} error={state.errors?.[key]} hint={key==='trackingUrlTemplate'?'운송장번호 자리에 {trackingNumber}를 넣습니다.':undefined}>
      <input id={`carrier-${carrier?.code??'new'}-${key}`} name={key} defaultValue={state.values?.[key]??initial} maxLength={key==='label'?60:key==='code'?32:500} readOnly={!canEdit||key==='code'&&Boolean(carrier)}
        aria-invalid={Boolean(state.errors?.[key])} aria-describedby={state.errors?.[key]?`carrier-${carrier?.code??'new'}-${key}-error`:key==='trackingUrlTemplate'?`carrier-${carrier?.code??'new'}-${key}-hint`:undefined}/>
    </AdminField>)}</AdminFormGrid>
    <label><input type="checkbox" name="active" value="true" defaultChecked={state.values?state.values.active==='true':carrier?.active??true} disabled={!canEdit}/> 새 발송에서 사용</label>
    <p>비활성화해도 기존 주문의 배송조회 링크는 유지됩니다.</p><Feedback state={state}/>
    {canEdit?<button className="btn" type="submit" disabled={pending}>{pending?'저장 중…':carrier?'택배사 저장':'택배사 등록'}</button>:null}
  </form>;
}
