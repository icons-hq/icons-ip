'use client';
import { useActionState, useState } from 'react';
import { Check } from 'lucide-react';
import { saveFulfillmentOriginAction, type FulfillmentActionState } from '@/app/admin/fulfillment-actions';
import { AdminField, AdminFormGrid, AdminNotice } from '../console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import type { FulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { EditableCarrier } from '@/lib/admin/store-settings';
import { SettingsFormGroup, SettingsSaveBar } from './StoreSettingsFormGroup';
import { WonInput } from './StoreSettingsWonInput';
import { useAdminLeaveGuard } from '../useAdminLeaveGuard';

/** 새 주문 사용 여부. 켜져 있는 동안의 안내는 조용한 글자로 두고(늘 떠 있는 노란 상자는 지금 문제가 있는 줄 안다), 끄는 쪽을 고르면 그때 상자로 올린다. */
function OriginActiveField({ id, initial, wasActive }: { id: string; initial: string; wasActive: boolean }) {
  const [value, setValue] = useState(initial);
  const off = value === 'false';
  return <div className="flex min-w-0 flex-col gap-3">
    <AdminField hint={off ? undefined : '비활성으로 바꾸면 이 출고지의 상품은 새 주문을 받을 수 없습니다. 기존 주문의 배송비는 바뀌지 않습니다.'} inputId={id} label="새 주문 사용">
      <NativeSelect className="w-full" id={id} name="active" onChange={event => setValue(event.target.value)} value={value}><option value="false">비활성</option><option value="true">사용</option></NativeSelect>
    </AdminField>
    {off ? <AdminNotice role={wasActive ? 'status' : undefined} title="이 출고지는 새 주문을 받지 않습니다" tone={wasActive ? 'danger' : 'warning'}>이 출고지의 상품은 새 주문을 받을 수 없습니다. 기존 주문의 배송비는 바뀌지 않습니다.</AdminNotice> : null}
  </div>;
}

export function FulfillmentOriginForm({ origin, carriers, canEdit }: { origin?: FulfillmentOrigin; carriers: EditableCarrier[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveFulfillmentOriginAction, {} as FulfillmentActionState);
  const { formRef } = useAdminLeaveGuard({ serverState: state });
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
    const invalid = Boolean(state.errors?.[name]);
    const describedBy = invalid ? `${id}-error` : hint ? `${id}-hint` : undefined;
    return <AdminField key={name} inputId={id} label={label} hint={hint} error={state.errors?.[name]}>
      {type === 'won' ? <WonInput aria-describedby={describedBy} aria-invalid={invalid} defaultValue={field(name)} id={id} name={name} />
        : <Input className={name === 'code' && origin ? 'border-dashed bg-muted' : undefined} id={id} name={name} type={type} defaultValue={field(name)} readOnly={name === 'code' && Boolean(origin)}
          aria-invalid={invalid} aria-describedby={describedBy} />}
    </AdminField>;
  }
  return <form action={action} ref={formRef}>
    <fieldset disabled={pending || !canEdit} key={state.attempt ?? 0} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      <input type="hidden" name="id" value={origin?.id ?? ''} />
      <input type="hidden" name="updatedAt" value={state.values?.updatedAt ?? state.updatedAt ?? initialStamp} />
      {!origin ? <AdminNotice title="출고지 코드는 등록 후 바꿀 수 없습니다" tone="warning">저장하기 전에 코드를 다시 확인해주세요.</AdminNotice> : null}
      {origin && !origin.returnAddress ? <AdminNotice title="반품 주소를 입력해주세요" tone="warning">반품 주소가 없으면 반품/교환지를 고르지 않은 이 출고지 상품의 반품을 진행할 수 없습니다.</AdminNotice> : null}
      <SettingsFormGroup title="기본 정보">
        <AdminFormGrid>
          {input('code', '출고지 코드', 'text', '등록 후 바꿀 수 없습니다.')}
          {input('name', '출고지 이름')}
          <AdminField inputId={`${prefix}-carrier`} label="기본 택배사" error={state.errors?.defaultCarrier}>
            <NativeSelect className="w-full" id={`${prefix}-carrier`} name="defaultCarrier" defaultValue={field('defaultCarrier')} aria-invalid={Boolean(state.errors?.defaultCarrier)} aria-describedby={state.errors?.defaultCarrier ? `${prefix}-carrier-error` : undefined}>
              <option value="">설정 전</option>{carriers.map((carrier) => <option key={carrier.code} value={carrier.code} disabled={!carrier.active}>{carrier.label}{carrier.active ? '' : ' · 비활성'}</option>)}
            </NativeSelect>
          </AdminField>
          {input('cutoff', '출고 마감 시각 (한국 시간)', 'time')}
        </AdminFormGrid>
      </SettingsFormGroup>
      <SettingsFormGroup title="배송비">
        <AdminFormGrid>
          {input('baseFee', '기본 배송비 (원)', 'won')}
          {input('freeThreshold', '무료 배송 기준 (원)', 'won', '기간 할인 후, 쿠폰·적립금 차감 전 정책 적용 상품 소계 기준입니다. 비우면 금액별 무료배송을 적용하지 않습니다.')}
        </AdminFormGrid>
      </SettingsFormGroup>
      <SettingsFormGroup title="반품">
        <AdminFormGrid>{input('returnAddress', '반품 주소', 'text', '상품에서 반품/교환지를 고르지 않으면 이 주소가 회수 주소입니다. 상품마다 다른 반품지는 반품/교환지 관리에서 등록해 상품에서 고릅니다.')}</AdminFormGrid>
      </SettingsFormGroup>
      <SettingsFormGroup title="출고·주문 운영">
        <AdminFormGrid>
          <AdminField inputId={`${prefix}-template`} label="기존 창고 출고지시 양식" hint="발주·발송 관리에서 기존 창고 양식을 선택할 때 사용합니다. ICONS 표준 양식에는 적용되지 않습니다." error={state.errors?.exportTemplate}>
            <NativeSelect className="w-full" id={`${prefix}-template`} name="exportTemplate" defaultValue={field('exportTemplate')} aria-invalid={Boolean(state.errors?.exportTemplate)} aria-describedby={state.errors?.exportTemplate ? `${prefix}-template-error` : undefined}>
              <option value="standard">기본 12열 양식</option><option value="wms_csv">김포 WMS 21열</option><option value="seowon_xlsx">서원 우체국 송장양식</option>
            </NativeSelect>
          </AdminField>
          <OriginActiveField id={`${prefix}-active`} initial={field('active')} wasActive={origin?.active ?? false} />
        </AdminFormGrid>
      </SettingsFormGroup>
      {canEdit ? <SettingsSaveBar lastInCard={false}>
        {state.errors?.form ? <AdminNotice className="flex-1" role="alert" tone="danger">{state.errors.form}</AdminNotice> : null}
        {state.message ? <AdminNotice className="flex-1" role="status" tone="success">{state.message}</AdminNotice> : null}
        <Button type="submit"><Check aria-hidden="true" />{pending ? '저장 중…' : '출고지 저장'}</Button>
      </SettingsSaveBar> : <>{state.errors?.form ? <AdminNotice role="alert" tone="danger">{state.errors.form}</AdminNotice> : null}{state.message ? <AdminNotice role="status" tone="success">{state.message}</AdminNotice> : null}</>}
    </fieldset>
  </form>;
}
