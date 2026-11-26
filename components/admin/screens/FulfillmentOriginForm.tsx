'use client';
import { useActionState, useState } from 'react';
import { Check } from 'lucide-react';
import { saveFulfillmentOriginAction, type FulfillmentActionState } from '@/app/admin/fulfillment-actions';
import { AdminField, AdminFormGrid, AdminNotice } from '../console/AdminKit';
import { GoodReadback } from '../GoodEditorParts';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { adminConfirm, confirmAdminSubmit } from '@/lib/admin/confirm';
import {
  changedFulfillmentOriginFields, fulfillmentOriginFormValues, fulfillmentOriginSaveConfirm, originCarrierChangeWarning, originDeactivateGoodsLine, originFeeReadback,
  type FulfillmentOrigin, type FulfillmentOriginConflict, type FulfillmentOriginFormValues, type OriginSaveImpact,
} from '@/lib/admin/fulfillment-origins';
import {
  CHANGED_BY_OTHER, TEMPLATE_DISCARD_INPUT_CONFIRM, TEMPLATE_DISCARD_INPUT_LABEL, TEMPLATE_SAVE_OVER_LATEST_LABEL, TEMPLATE_SAVE_OVER_LATEST_NOTE,
} from '@/lib/admin/goods-template-save';
import { SHIPPING_REGIONS_PATH } from '@/lib/admin/shipping-regions';
import type { EditableCarrier } from '@/lib/admin/store-settings';
import { SettingsFormGroup, SettingsSaveBar } from './StoreSettingsFormGroup';
import { WonInput } from './StoreSettingsWonInput';
import { useAdminLeaveGuard } from '../useAdminLeaveGuard';

/** 값이 바뀌면 화면이 바로 따라 읽는 칸(되읽기·경고·저장 전 확인에 쓴다). 나머지 칸은 폼이 들고 있다. */
type Draft = Pick<FulfillmentOriginFormValues, 'active' | 'defaultCarrier' | 'baseFee' | 'freeThreshold' | 'exportTemplate'>;
const draftOf = (values: FulfillmentOriginFormValues): Draft => ({
  active: values.active, defaultCarrier: values.defaultCarrier, baseFee: values.baseFee, freeThreshold: values.freeThreshold, exportTemplate: values.exportTemplate,
});

/**
 * 출고지 저장 폼. 새 주문을 막거나 배송비가 바뀌는 저장은 확인창을 한 번 거친다(사용 안 함으로 바꿀 때·지역별 추가배송비가 막히는 택배사로 바꿀 때·
 * 사용 중인 출고지의 기본 배송비를 바꿀 때). 영향(`impact`)은 화면이 저장 전에 읽어 넘긴다.
 * 저장하는 사이에 다른 사람이 먼저 바꿨으면 입력을 그대로 둔 채 두 길을 고른다: 내 입력으로 덮어쓰기 / 내 입력 버리기(템플릿 관리 화면과 같다).
 */
export function FulfillmentOriginForm({ origin, carriers, canEdit, impact }: { origin?: FulfillmentOrigin; carriers: EditableCarrier[]; canEdit: boolean; impact?: OriginSaveImpact }) {
  const [state, action, pending] = useActionState(saveFulfillmentOriginAction, {} as FulfillmentActionState);
  const { formRef } = useAdminLeaveGuard({ serverState: state });
  const [initialStamp] = useState(origin?.updatedAt ?? '');
  const own = fulfillmentOriginFormValues(origin);
  /* 다른 사람이 먼저 바꿨다면 그 사람이 저장한 내용(saved)이 지금 저장된 값이다. 바뀌었는지는 그 값과 견준다. */
  const saved = state.conflict;
  const [discarded, setDiscarded] = useState<FulfillmentOriginConflict | null>(null);
  const viewingSaved = saved && discarded === saved ? saved : null;
  const conflict = saved && !viewingSaved ? saved : null;
  const base = saved?.values ?? own;
  const field = (name: keyof FulfillmentOriginFormValues) => viewingSaved?.values[name] ?? state.values?.[name] ?? own[name];
  const [draft, setDraft] = useState<Draft>(() => draftOf({ ...own, active: field('active'), defaultCarrier: field('defaultCarrier'), baseFee: field('baseFee'), freeThreshold: field('freeThreshold'), exportTemplate: field('exportTemplate') }));
  const change = (patch: Partial<Draft>) => setDraft(previous => ({ ...previous, ...patch }));
  const stamp = saved ? saved.updatedAt : state.values?.updatedAt ?? state.updatedAt ?? initialStamp;
  const prefix = `origin-${origin?.id ?? 'new'}`;

  const active = draft.active === 'true';
  const wasActive = base.active === 'true';
  const carrierLabel = (code: string) => code ? carriers.find(item => item.code === code)?.label ?? code : '고르지 않음';
  const selectedCarrier = carriers.find(item => item.code === draft.defaultCarrier);
  const carrierWarning = impact ? originCarrierChangeWarning({ from: base.defaultCarrier, to: draft.defaultCarrier, active, regionalFee: impact.regionalFee, label: carrierLabel }) : null;
  const carrierError = state.errors?.defaultCarrier
    ?? (selectedCarrier && !selectedCarrier.active ? '사용 안 함인 택배사는 고를 수 없습니다. 다른 택배사를 골라 주세요.'
      : active && !draft.defaultCarrier ? '사용으로 저장하려면 기본 택배사를 골라 주세요.' : undefined);
  const feeReadback = originFeeReadback({ baseFee: draft.baseFee, freeThreshold: draft.freeThreshold });
  const saveConfirm = origin ? fulfillmentOriginSaveConfirm({ name: origin.name, before: base, after: draft, impact, label: carrierLabel }) : null;

  async function discardInput() {
    if (!conflict || !await adminConfirm(TEMPLATE_DISCARD_INPUT_CONFIRM)) return;
    setDiscarded(conflict);
    setDraft(draftOf(conflict.values));
  }

  function text(name: 'code' | 'name' | 'cutoff' | 'returnAddress', label: string, options: { type?: string; hint?: string; placeholder?: string } = {}) {
    const id = `${prefix}-${name}`;
    const invalid = Boolean(state.errors?.[name]);
    const describedBy = invalid ? `${id}-error` : options.hint ? `${id}-hint` : undefined;
    return <AdminField key={name} inputId={id} label={label} hint={options.hint} error={state.errors?.[name]}>
      <Input className={name === 'code' && origin ? 'border-dashed bg-muted' : undefined} id={id} name={name} type={options.type ?? 'text'} defaultValue={field(name)}
        placeholder={options.placeholder} readOnly={name === 'code' && Boolean(origin)} aria-invalid={invalid} aria-describedby={describedBy} />
    </AdminField>;
  }
  function won(name: 'baseFee' | 'freeThreshold', label: string, hint?: string) {
    const id = `${prefix}-${name}`;
    const invalid = Boolean(state.errors?.[name]);
    const describedBy = invalid ? `${id}-error` : hint ? `${id}-hint` : undefined;
    return <AdminField key={name} inputId={id} label={label} hint={hint} error={state.errors?.[name]}>
      <WonInput aria-describedby={describedBy} aria-invalid={invalid} id={id} name={name} onValueChange={value => change(name === 'baseFee' ? { baseFee: value } : { freeThreshold: value })} value={draft[name]} />
    </AdminField>;
  }

  const formError = conflict ? null : state.errors?.form;
  const notices = <>
    {conflict ? <AdminNotice className="flex-1" role="alert" title={CHANGED_BY_OTHER} tone="warning">
      {changedFulfillmentOriginFields(own, conflict.values).length ? <p>바뀐 항목: {changedFulfillmentOriginFields(own, conflict.values).join(' · ')}</p> : null}
      <p className="text-xs">{TEMPLATE_SAVE_OVER_LATEST_NOTE}</p>
    </AdminNotice> : null}
    {formError ? <AdminNotice className="flex-1" role="alert" tone="danger">{formError}</AdminNotice> : null}
    {state.message ? <AdminNotice className="flex-1" role="status" tone="success">{state.message}</AdminNotice> : null}
  </>;

  return <form action={action} onSubmit={event => { confirmAdminSubmit(event, saveConfirm); }} ref={formRef}>
    <fieldset disabled={pending || !canEdit} key={`${state.attempt ?? 0}:${viewingSaved ? 'saved' : 'mine'}`} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      <input type="hidden" name="id" value={origin?.id ?? ''} />
      <input type="hidden" name="updatedAt" value={stamp} />
      {origin && !origin.returnAddress ? <AdminNotice title="반품 주소를 입력해주세요" tone="warning">반품 주소가 없으면 반품/교환지를 고르지 않은 이 출고지 상품의 반품을 진행할 수 없습니다.</AdminNotice> : null}
      <SettingsFormGroup title="기본 정보">
        <AdminFormGrid>
          {text('code', '출고지 코드', { hint: "상품 엑셀의 '출고지 코드' 열에 적는 값입니다. 등록하면 바꿀 수 없습니다.", placeholder: origin ? undefined : '예: gimpo' })}
          {text('name', '출고지 이름')}
          <div className="flex min-w-0 flex-col gap-3">
            <AdminField inputId={`${prefix}-carrier`} label={active ? '기본 택배사 (필수)' : '기본 택배사'} error={carrierError}>
              <NativeSelect className="w-full" id={`${prefix}-carrier`} name="defaultCarrier" value={draft.defaultCarrier} onChange={event => change({ defaultCarrier: event.target.value })}
                aria-invalid={Boolean(carrierError)} aria-describedby={carrierError ? `${prefix}-carrier-error` : undefined}>
                <option value="">고르지 않음</option>
                {carriers.filter(item => item.active || item.code === base.defaultCarrier).map(item => <option key={item.code} value={item.code}>{item.label}{item.active ? '' : ' · 사용 안 함'}</option>)}
              </NativeSelect>
            </AdminField>
            {carrierWarning ? <AdminNotice role="status" title={carrierWarning.title} tone="warning">
              {carrierWarning.body}{' '}<a className="underline underline-offset-4" href={SHIPPING_REGIONS_PATH} rel="noreferrer" target="_blank">지역별 추가배송비 (새 탭)</a>
            </AdminNotice> : null}
          </div>
          {text('cutoff', '출고 마감 시각 (KST)', { type: 'time' })}
        </AdminFormGrid>
      </SettingsFormGroup>
      <SettingsFormGroup title="배송비">
        <AdminFormGrid>
          {won('baseFee', '기본 배송비 (원)')}
          {won('freeThreshold', '무료 배송 기준 (원)', '비우면 금액과 관계없이 배송비를 받습니다.')}
        </AdminFormGrid>
        {feeReadback ? <GoodReadback>{feeReadback}</GoodReadback> : null}
      </SettingsFormGroup>
      <SettingsFormGroup title="반품">
        <AdminFormGrid>{text('returnAddress', '반품 주소', { hint: '상품에서 반품/교환지를 고르지 않으면 이 주소가 회수 주소입니다. 상품마다 다른 반품/교환지는 반품/교환지 관리에서 등록해 상품에서 고릅니다.' })}</AdminFormGrid>
      </SettingsFormGroup>
      <SettingsFormGroup title="출고·주문 운영">
        <AdminFormGrid>
          <AdminField inputId={`${prefix}-template`} label="기존 창고 출고지시 양식" hint="발주·발송 관리에서 기존 창고 양식을 선택할 때 사용합니다. 엑스스퀘어 표준 양식에는 적용되지 않습니다." error={state.errors?.exportTemplate}>
            <NativeSelect className="w-full" id={`${prefix}-template`} name="exportTemplate" value={draft.exportTemplate} onChange={event => change({ exportTemplate: event.target.value })}
              aria-invalid={Boolean(state.errors?.exportTemplate)} aria-describedby={state.errors?.exportTemplate ? `${prefix}-template-error` : undefined}>
              <option value="standard">기본 12열 양식</option><option value="wms_csv">김포 WMS 21열</option><option value="seowon_xlsx">서원 우체국 송장양식</option>
            </NativeSelect>
          </AdminField>
          <div className="flex min-w-0 flex-col gap-3">
            <AdminField inputId={`${prefix}-active`} label="사용 여부">
              <NativeSelect className="w-full" id={`${prefix}-active`} name="active" value={draft.active} onChange={event => change({ active: event.target.value })}>
                <option value="true">사용</option><option value="false">사용 안 함</option>
              </NativeSelect>
            </AdminField>
            {!active ? (wasActive
              ? <AdminNotice role="status" title="저장하면 이 출고지는 새 주문을 받지 않습니다" tone="danger">{originDeactivateGoodsLine(impact?.goods)}</AdminNotice>
              : <AdminNotice title="사용 안 함이라 상품에서 이 출고지를 고를 수 없습니다" tone="warning">상품에 쓰려면 &apos;사용&apos;으로 바꾸고 기본 택배사를 골라 주세요.</AdminNotice>) : null}
          </div>
        </AdminFormGrid>
      </SettingsFormGroup>
      {canEdit ? <SettingsSaveBar lastInCard={false}>
        {notices}
        {conflict ? <>
          <Button onClick={() => { void discardInput(); }} type="button" variant="outline">{TEMPLATE_DISCARD_INPUT_LABEL}</Button>
          {/* 제출 버튼이 없어 입력칸에서 Enter를 눌러도 덮어쓰지 않는다. 이 버튼이 폼을 다시 제출하고, 숨은 칸의 저장 시각은 이미 지금 저장된 값이다. */}
          <Button onClick={event => { event.currentTarget.form?.requestSubmit(); }} type="button">{TEMPLATE_SAVE_OVER_LATEST_LABEL}</Button>
        </> : <Button type="submit"><Check aria-hidden="true" />{pending ? '저장 중…' : '출고지 저장'}</Button>}
      </SettingsSaveBar> : <>{formError ? <AdminNotice role="alert" tone="danger">{formError}</AdminNotice> : null}{state.message ? <AdminNotice role="status" tone="success">{state.message}</AdminNotice> : null}</>}
    </fieldset>
  </form>;
}
