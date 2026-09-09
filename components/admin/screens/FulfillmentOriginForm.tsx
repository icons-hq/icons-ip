'use client';
import { useActionState, useState } from 'react';
import { saveFulfillmentOriginAction, type FulfillmentActionState } from '@/app/admin/fulfillment-actions';
import { AdminField, AdminFormGrid } from '../console/AdminKit';
import type { FulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { EditableCarrier } from '@/lib/admin/store-settings';

export function FulfillmentOriginForm({ origin, carriers, canEdit }: { origin?: FulfillmentOrigin; carriers: EditableCarrier[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveFulfillmentOriginAction, {} as FulfillmentActionState);
  const [initialStamp] = useState(origin?.updatedAt ?? '');
  const defaults: Record<string, string> = {
    code: origin?.code ?? '', name: origin?.name ?? '', defaultCarrier: origin?.defaultCarrier ?? '',
    baseFee: origin ? String(origin.baseFee) : '', freeThreshold: origin?.freeThreshold == null ? '' : String(origin.freeThreshold),
    returnAddress: origin?.returnAddress ?? '', cutoff: origin?.cutoff ?? '', exportTemplate: origin?.exportTemplate ?? 'standard', active: String(origin?.active ?? false),
  };
  const field = (name: string) => state.values?.[name] ?? defaults[name];
  const prefix = `origin-${origin?.id ?? 'new'}`;
  function input(name: string, label: string, type = 'text', hint?: string) {
    const id = `${prefix}-${name}`;
    return <AdminField key={name} inputId={id} label={label} hint={hint} error={state.errors?.[name]}>
      <input id={id} name={name} type={type} defaultValue={field(name)} readOnly={name === 'code' && Boolean(origin)}
        aria-invalid={Boolean(state.errors?.[name])} aria-describedby={state.errors?.[name] ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...(type === 'number' ? { min: 0, step: 1 } : {})} />
    </AdminField>;
  }
  return <form action={action}>
    <fieldset disabled={pending || !canEdit} key={state.attempt ?? 0} style={{ border: 0, padding: 0, margin: 0 }}>
      <input type="hidden" name="id" value={origin?.id ?? ''} />
      <input type="hidden" name="updatedAt" value={state.values?.updatedAt ?? state.updatedAt ?? initialStamp} />
      <AdminFormGrid>
        {input('code', '출고지 코드', 'text', '등록 후 바꿀 수 없습니다.')}
        {input('name', '출고지 이름')}
        <AdminField inputId={`${prefix}-carrier`} label="기본 택배사" error={state.errors?.defaultCarrier}>
          <select id={`${prefix}-carrier`} name="defaultCarrier" defaultValue={field('defaultCarrier')} aria-invalid={Boolean(state.errors?.defaultCarrier)} aria-describedby={state.errors?.defaultCarrier ? `${prefix}-carrier-error` : undefined}>
            <option value="">설정 전</option>{carriers.map((carrier) => <option key={carrier.code} value={carrier.code} disabled={!carrier.active}>{carrier.label}{carrier.active ? '' : ' · 비활성'}</option>)}
          </select>
        </AdminField>
        {input('baseFee', '기본 배송비 (원)', 'number')}
        {input('freeThreshold', '무료 배송 기준 (원)', 'number', '할인 전 정책 적용 상품 소계 기준입니다. 비우면 금액별 무료배송을 적용하지 않습니다.')}
        {input('returnAddress', '반품 주소')}
        {input('cutoff', '출고 마감 시각 (한국 시간)', 'time')}
        <AdminField inputId={`${prefix}-template`} label="출고지시 양식" error={state.errors?.exportTemplate}>
          <select id={`${prefix}-template`} name="exportTemplate" defaultValue={field('exportTemplate')} aria-invalid={Boolean(state.errors?.exportTemplate)} aria-describedby={state.errors?.exportTemplate ? `${prefix}-template-error` : undefined}>
            <option value="standard">표준 양식</option><option value="wms_csv">김포 WMS 21열</option><option value="seowon_xlsx">서원 우체국 7열</option>
          </select>
        </AdminField>
        <AdminField inputId={`${prefix}-active`} label="새 주문 사용" hint="비활성으로 바꾸면 이 출고지의 상품은 새 주문을 받을 수 없습니다. 기존 주문의 배송비는 바뀌지 않습니다.">
          <select id={`${prefix}-active`} name="active" defaultValue={field('active')}><option value="false">비활성</option><option value="true">사용</option></select>
        </AdminField>
      </AdminFormGrid>
      {state.errors?.form ? <p role="alert" className="wc-admin-kit__error">{state.errors.form}</p> : null}
      {state.message ? <p role="status">{state.message}</p> : null}
      {canEdit ? <button type="submit" className="wc-admin-kit__button" style={{ marginTop: 20 }}>{pending ? '저장 중…' : '출고지 저장'}</button> : null}
    </fieldset>
  </form>;
}
