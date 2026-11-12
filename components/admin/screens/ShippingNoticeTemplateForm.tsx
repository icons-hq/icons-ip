'use client';

import { useActionState, useId } from 'react';
import {
  activateShippingNoticeTemplateAction,
  applyShippingNoticeTemplateAction,
  saveShippingNoticeTemplateAction,
  type ShippingNoticeTemplateActionState,
} from '@/app/admin/shipping-notice-template-actions';
import { AdminField, AdminFormGrid, AdminNotice } from '@/components/admin/console/AdminKit';
import { useAdminCreateDialogBusy } from '@/components/admin/console/AdminCreateDialogButton';
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
import { Check } from 'lucide-react';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Textarea } from '@/components/admin/kit/ui/textarea';
const EMPTY_STATE: ShippingNoticeTemplateActionState = {};

export function ShippingNoticeTemplateForm({ template }: { template?: ShippingNoticeTemplate }) {
  const [state, action, pending] = useActionState(saveShippingNoticeTemplateAction, EMPTY_STATE);
  /* 등록 팝업 안에서 저장을 기다리는 동안 팝업을 닫지 못하게 한다(목록 안 수정 폼에서는 아무 일도 하지 않는다). */
  useAdminCreateDialogBusy(pending);
  const prefix = useId();
  const value = (name: string, fallback: string) => state.values?.[name] ?? fallback;
  const locked = template?.status === 'active';
  const inputProps = (name: string) => ({
    id: `${prefix}-${name}`,
    name,
    'aria-invalid': Boolean(state.errors?.[name]),
    'aria-describedby': state.errors?.[name] ? `${prefix}-${name}-error` : undefined,
  });
  return <form action={action} className="flex min-w-0 flex-col gap-3">
    <fieldset key={state.attempt ?? 0} disabled={pending || locked} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
      <input name="id" type="hidden" value={template?.id ?? ''} />
      <input name="updatedAt" type="hidden" value={value('updatedAt', template?.updatedAt ?? '')} />
      <AdminFormGrid>
        <AdminField label="템플릿 코드" inputId={`${prefix}-code`} error={state.errors?.code} hint="새 버전은 같은 코드와 더 큰 버전으로 등록합니다.">
          <Input {...inputProps('code')} defaultValue={value('code', template?.code ?? '')} maxLength={SHIPPING_NOTICE_TEMPLATE_CODE_MAX} readOnly={Boolean(template)} required />
        </AdminField>
        <AdminField label="버전" inputId={`${prefix}-version`} error={state.errors?.version}>
          <Input {...inputProps('version')} type="number" defaultValue={value('version', String(template?.version ?? SHIPPING_NOTICE_TEMPLATE_VERSION_DEFAULT))} min={1} max={1000000} step={1} readOnly={Boolean(template)} required />
        </AdminField>
        <AdminField label="템플릿 이름" inputId={`${prefix}-name`} error={state.errors?.name}>
          <Input {...inputProps('name')} defaultValue={value('name', template?.name ?? '')} maxLength={SHIPPING_NOTICE_TEMPLATE_NAME_MAX} placeholder="기본 배송 안내" required />
        </AdminField>
      </AdminFormGrid>
      <AdminField label="배송 안내" inputId={`${prefix}-shippingNotice`} error={state.errors?.shippingNotice} hint="배송비 숫자와 출고지 주소는 출고지 설정에서 읽습니다.">
        <Textarea {...inputProps('shippingNotice')} defaultValue={value('shippingNotice', template?.shippingNotice ?? '')} maxLength={SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX} rows={5} placeholder="배송 방법과 출고 관련 고객 안내를 입력하세요." />
      </AdminField>
      <AdminField label="도서산간 안내" inputId={`${prefix}-remoteAreaNotice`} error={state.errors?.remoteAreaNotice} hint="선택 입력입니다. 상품 상세 배송 안내에 그대로 보입니다. 제주·도서산간 추가 배송비 금액은 지역별 추가배송비 정책에서 읽어 따로 표시합니다.">
        <Textarea {...inputProps('remoteAreaNotice')} defaultValue={value('remoteAreaNotice', template?.remoteAreaNotice ?? '')} maxLength={SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX} rows={3} placeholder="제주·도서산간 지역의 배송 기간이나 배송 제한 안내를 입력하세요." />
      </AdminField>
      <AdminField label="교환·반품 안내" inputId={`${prefix}-returnExchangeNotice`} error={state.errors?.returnExchangeNotice}>
        <Textarea {...inputProps('returnExchangeNotice')} defaultValue={value('returnExchangeNotice', template?.returnExchangeNotice ?? '')} maxLength={SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX} rows={5} placeholder="교환·반품 접수 방법과 안내를 입력하세요." />
      </AdminField>
      <AdminFormGrid>
        <AdminField label="고객센터 이름" inputId={`${prefix}-csName`} error={state.errors?.csName}>
          <Input {...inputProps('csName')} defaultValue={value('csName', template?.csName ?? '')} maxLength={SHIPPING_NOTICE_TEMPLATE_CS_NAME_MAX} />
        </AdminField>
        <AdminField label="고객센터 전화" inputId={`${prefix}-csPhone`} error={state.errors?.csPhone}>
          <Input {...inputProps('csPhone')} defaultValue={value('csPhone', template?.csPhone ?? '')} maxLength={SHIPPING_NOTICE_TEMPLATE_CS_PHONE_MAX} inputMode="tel" />
        </AdminField>
        <AdminField label="고객센터 이메일" inputId={`${prefix}-csEmail`} error={state.errors?.csEmail}>
          <Input {...inputProps('csEmail')} type="email" defaultValue={value('csEmail', template?.csEmail ?? '')} maxLength={SHIPPING_NOTICE_TEMPLATE_CS_EMAIL_MAX} />
        </AdminField>
      </AdminFormGrid>
      <Button className="w-fit" type="submit"><Check aria-hidden="true" />{pending ? '저장 중…' : template ? '초안 수정 저장' : '새 초안 저장'}</Button>
    </fieldset>
    {state.errors?.form ? <AdminNotice role="alert" tone="danger">{state.errors.form}</AdminNotice> : null}
    {state.message ? <AdminNotice role="status" tone="success">{state.message}</AdminNotice> : null}
  </form>;
}

export function ShippingNoticeTemplateActivationForm({ template }: { template: ShippingNoticeTemplate }) {
  const [state, action, pending] = useActionState(activateShippingNoticeTemplateAction, EMPTY_STATE);
  const prefix = useId();
  const updatedAt = state.updatedAt ?? template.updatedAt;
  return <form action={action} className="flex min-w-0 flex-col gap-3">
    <fieldset disabled={pending} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <input name="id" type="hidden" value={template.id} />
      <input name="updatedAt" type="hidden" value={updatedAt} />
      <AdminField label="활성화 확인 근거" inputId={`${prefix}-confirmationEvidence`} error={state.errors?.confirmationEvidence} hint="실제 운영 자료를 확인한 근거를 적습니다. 임의의 주소·연락처를 대신 입력하지 않습니다.">
        <Textarea id={`${prefix}-confirmationEvidence`} name="confirmationEvidence" maxLength={SHIPPING_NOTICE_TEMPLATE_EVIDENCE_MAX} rows={3} required aria-invalid={Boolean(state.errors?.confirmationEvidence)} aria-describedby={state.errors?.confirmationEvidence ? `${prefix}-confirmationEvidence-error` : `${prefix}-confirmationEvidence-hint`} />
      </AdminField>
      <Button className="w-fit" type="submit">{pending ? '활성화 중…' : '활성화'}</Button>
    </fieldset>
    {state.errors?.form ? <AdminNotice role="alert" tone="danger">{state.errors.form}</AdminNotice> : null}
    {state.message ? <AdminNotice role="status" tone="success">{state.message}</AdminNotice> : null}
  </form>;
}

export function ShippingNoticeTemplateApplyForm({ template, good }: { template: ShippingNoticeTemplate; good: ShippingNoticeTemplateImpactGood }) {
  const [state, action, pending] = useActionState(applyShippingNoticeTemplateAction, EMPTY_STATE);
  return <form action={action} className="flex flex-wrap items-center gap-2">
    <input name="templateId" type="hidden" value={template.id} />
    <input name="goodId" type="hidden" value={good.id} />
    <input name="goodUpdatedAt" type="hidden" value={good.updatedAt} />
    <Button disabled={pending} size="sm" type="submit">{pending ? '적용 중…' : '이 템플릿 적용'}</Button>
    {state.errors?.form ? <p className="text-sm text-destructive" role="alert">{state.errors.form}</p> : null}
    {state.errors?.goodId ? <p className="text-sm text-destructive" role="alert">{state.errors.goodId}</p> : null}
    {state.message ? <p className="text-sm font-medium text-success" role="status">{state.message}</p> : null}
  </form>;
}
