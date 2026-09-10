'use client';

import { useActionState, useId } from 'react';
import {
  activateShippingNoticeTemplateAction,
  applyShippingNoticeTemplateAction,
  saveShippingNoticeTemplateAction,
  type ShippingNoticeTemplateActionState,
} from '@/app/admin/shipping-notice-template-actions';
import { AdminField, AdminFormGrid } from '@/components/admin/console/AdminKit';
import {
  SHIPPING_NOTICE_TEMPLATE_CODE_MAX,
  SHIPPING_NOTICE_TEMPLATE_CS_EMAIL_MAX,
  SHIPPING_NOTICE_TEMPLATE_CS_NAME_MAX,
  SHIPPING_NOTICE_TEMPLATE_CS_PHONE_MAX,
  SHIPPING_NOTICE_TEMPLATE_EVIDENCE_MAX,
  SHIPPING_NOTICE_TEMPLATE_NAME_MAX,
  SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX,
  SHIPPING_NOTICE_TEMPLATE_VERSION_DEFAULT,
  type ShippingNoticeTemplate,
} from '@/lib/admin/shipping-notice-templates';
import type { ShippingNoticeTemplateImpactGood } from '@/lib/admin/shipping-notice-templates';

const EMPTY_STATE: ShippingNoticeTemplateActionState = {};

export function ShippingNoticeTemplateForm({ template }: { template?: ShippingNoticeTemplate }) {
  const [state, action, pending] = useActionState(saveShippingNoticeTemplateAction, EMPTY_STATE);
  const prefix = useId();
  const value = (name: string, fallback: string) => state.values?.[name] ?? fallback;
  const locked = template?.status === 'active';
  const inputProps = (name: string) => ({
    id: `${prefix}-${name}`,
    name,
    'aria-invalid': Boolean(state.errors?.[name]),
    'aria-describedby': state.errors?.[name] ? `${prefix}-${name}-error` : undefined,
  });
  return <form action={action} className="admin-shipping-notice-templates__form">
    <fieldset key={state.attempt ?? 0} disabled={pending || locked}>
      <input name="id" type="hidden" value={template?.id ?? ''} />
      <input name="updatedAt" type="hidden" value={value('updatedAt', template?.updatedAt ?? '')} />
      <AdminFormGrid>
        <AdminField label="템플릿 코드" inputId={`${prefix}-code`} error={state.errors?.code} hint="새 버전은 같은 코드와 더 큰 버전으로 등록합니다.">
          <input {...inputProps('code')} defaultValue={value('code', template?.code ?? '')} maxLength={SHIPPING_NOTICE_TEMPLATE_CODE_MAX} readOnly={Boolean(template)} required />
        </AdminField>
        <AdminField label="버전" inputId={`${prefix}-version`} error={state.errors?.version}>
          <input {...inputProps('version')} type="number" defaultValue={value('version', String(template?.version ?? SHIPPING_NOTICE_TEMPLATE_VERSION_DEFAULT))} min={1} max={1000000} step={1} readOnly={Boolean(template)} required />
        </AdminField>
        <AdminField label="템플릿 이름" inputId={`${prefix}-name`} error={state.errors?.name}>
          <input {...inputProps('name')} defaultValue={value('name', template?.name ?? '')} maxLength={SHIPPING_NOTICE_TEMPLATE_NAME_MAX} placeholder="기본 배송 안내" required />
        </AdminField>
      </AdminFormGrid>
      <AdminField label="배송 안내" inputId={`${prefix}-shippingNotice`} error={state.errors?.shippingNotice} hint="운임 숫자와 출고지 주소는 출고지 설정에서 읽습니다.">
        <textarea {...inputProps('shippingNotice')} defaultValue={value('shippingNotice', template?.shippingNotice ?? '')} maxLength={SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX} rows={5} placeholder="배송 방법과 출고 관련 고객 안내를 입력하세요." />
      </AdminField>
      <AdminField label="교환·반품 안내" inputId={`${prefix}-returnExchangeNotice`} error={state.errors?.returnExchangeNotice}>
        <textarea {...inputProps('returnExchangeNotice')} defaultValue={value('returnExchangeNotice', template?.returnExchangeNotice ?? '')} maxLength={SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX} rows={5} placeholder="교환·반품 접수 방법과 안내를 입력하세요." />
      </AdminField>
      <AdminFormGrid>
        <AdminField label="고객센터 이름" inputId={`${prefix}-csName`} error={state.errors?.csName}>
          <input {...inputProps('csName')} defaultValue={value('csName', template?.csName ?? '')} maxLength={SHIPPING_NOTICE_TEMPLATE_CS_NAME_MAX} />
        </AdminField>
        <AdminField label="고객센터 전화" inputId={`${prefix}-csPhone`} error={state.errors?.csPhone}>
          <input {...inputProps('csPhone')} defaultValue={value('csPhone', template?.csPhone ?? '')} maxLength={SHIPPING_NOTICE_TEMPLATE_CS_PHONE_MAX} inputMode="tel" />
        </AdminField>
        <AdminField label="고객센터 이메일" inputId={`${prefix}-csEmail`} error={state.errors?.csEmail}>
          <input {...inputProps('csEmail')} type="email" defaultValue={value('csEmail', template?.csEmail ?? '')} maxLength={SHIPPING_NOTICE_TEMPLATE_CS_EMAIL_MAX} />
        </AdminField>
      </AdminFormGrid>
      <button className="wc-admin-kit__button" type="submit">{pending ? '저장 중…' : template ? '초안 수정 저장' : '새 초안 저장'}</button>
    </fieldset>
    {state.errors?.form ? <p className="admin-shipping-notice-templates__error" role="alert">{state.errors.form}</p> : null}
    {state.message ? <p role="status">{state.message}</p> : null}
  </form>;
}

export function ShippingNoticeTemplateActivationForm({ template }: { template: ShippingNoticeTemplate }) {
  const [state, action, pending] = useActionState(activateShippingNoticeTemplateAction, EMPTY_STATE);
  const prefix = useId();
  const updatedAt = state.updatedAt ?? template.updatedAt;
  return <form action={action} className="admin-shipping-notice-templates__activation-form">
    <fieldset disabled={pending}>
      <input name="id" type="hidden" value={template.id} />
      <input name="updatedAt" type="hidden" value={updatedAt} />
      <AdminField label="활성화 확인 근거" inputId={`${prefix}-confirmationEvidence`} error={state.errors?.confirmationEvidence} hint="실제 운영 자료를 확인한 근거를 적습니다. 임의의 주소·연락처를 대신 입력하지 않습니다.">
        <textarea id={`${prefix}-confirmationEvidence`} name="confirmationEvidence" maxLength={SHIPPING_NOTICE_TEMPLATE_EVIDENCE_MAX} rows={3} required aria-invalid={Boolean(state.errors?.confirmationEvidence)} aria-describedby={state.errors?.confirmationEvidence ? `${prefix}-confirmationEvidence-error` : `${prefix}-confirmationEvidence-hint`} />
      </AdminField>
      <button className="wc-admin-kit__button" type="submit">{pending ? '활성화 중…' : '활성화'}</button>
    </fieldset>
    {state.errors?.form ? <p className="admin-shipping-notice-templates__error" role="alert">{state.errors.form}</p> : null}
    {state.message ? <p role="status">{state.message}</p> : null}
  </form>;
}

export function ShippingNoticeTemplateApplyForm({ template, good }: { template: ShippingNoticeTemplate; good: ShippingNoticeTemplateImpactGood }) {
  const [state, action, pending] = useActionState(applyShippingNoticeTemplateAction, EMPTY_STATE);
  return <form action={action} className="admin-shipping-notice-templates__apply-form">
    <input name="templateId" type="hidden" value={template.id} />
    <input name="goodId" type="hidden" value={good.id} />
    <input name="goodUpdatedAt" type="hidden" value={good.updatedAt} />
    <button className="wc-admin-kit__button" type="submit" disabled={pending}>{pending ? '적용 중…' : '이 템플릿 적용'}</button>
    {state.errors?.form ? <p className="admin-shipping-notice-templates__error" role="alert">{state.errors.form}</p> : null}
    {state.errors?.goodId ? <p className="admin-shipping-notice-templates__error" role="alert">{state.errors.goodId}</p> : null}
    {state.message ? <p role="status">{state.message}</p> : null}
  </form>;
}
