'use client';
import { ADMIN_DIALOG_CLOSE_DIRTY_CONFIRM } from '@/lib/admin/dialog-close';
import { focusFirstInvalid } from '@/lib/admin/focus-invalid';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { readShippingSettingsTemplateAction } from '@/app/admin/shipping-settings-template-actions';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { GoodShippingRegionSummary } from '@/lib/admin/good-shipping-summary';
import {
  SHIPPING_SETTINGS_RUNTIME_OFF, parseShippingSettingsTemplateForm, shippingSettingsChargeGroup, shippingSettingsDelivery, shippingSettingsExtraChanges, shippingSettingsMoney,
  shippingSettingsRuntimeOffSaved, type ShippingSettingsIdentity, type ShippingSettingsSaveRequest, type ShippingSettingsTemplate,
} from '@/lib/admin/shipping-settings-templates';
import { goodsTermsDraft, prepareGoodsTermsInput, type DeliveryTermsInput } from '@/lib/admin/goods-transaction-terms';
import { prepareShippingFulfillment, shippingFulfillmentDraft, shippingFulfillmentProblem, shippingFulfillmentReadback } from '@/lib/admin/shipping-settings-fulfillment';
import {
  CHANGED_BY_OTHER, SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE, TEMPLATE_DISCARD_INPUT_CONFIRM, TEMPLATE_DISCARD_INPUT_LABEL,
  TEMPLATE_LATEST_UNREAD_MESSAGE, TEMPLATE_SAVE_OVER_LATEST_LABEL, TEMPLATE_SAVE_OVER_LATEST_NOTE, reopenClosedDialog,
} from '@/lib/admin/goods-template-save';
import { adminConfirm } from '@/lib/admin/confirm';
import { GoodsDeliveryPricingFields } from '@/components/admin/GoodsTransactionTermsPanel';
import { goodShippingFeeReadback } from '@/components/admin/GoodsFulfillmentFields';
import { GoodChoiceCard, GoodChoiceCards, GoodChoiceGroup, GoodChoiceOption } from '@/components/admin/GoodEditorParts';
import { ShippingChargeGroupField } from '@/components/admin/ShippingChargeGroupField';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { ACTIONS, CHECK_LABEL, FIELD_ERROR, FIELD_HINT, FIELD_LABEL, NOTE } from '@/components/admin/settings-kit';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { ShippingSettingsDeliverySummary } from './ShippingSettingsDeliverySummary';
import { ShippingSettingsFulfillmentDirective, ShippingSettingsFulfillmentFields } from './ShippingSettingsFulfillmentFields';
import { SHIPPING_SETTINGS_STOP_LABEL, useShippingSettingsOperation, type ShippingSettingsScope } from './useShippingSettingsOperation';

/* 반품·교환 조건의 선택지와 금액 칸은 상품등록(GoodsClaimPolicyFields)과 같은 말이다. 한쪽만 바꾸면 같은 것이 두 이름이 된다. */
const CLAIM_FEE_PLACEHOLDER = "비우면 '확인 후 안내', 무료면 0";
const claimFlag = (allowed: boolean | null) => allowed === null ? '미검토 · 기본 정책 확인' : allowed ? '기본 정책에 따라 가능' : '제한 사유와 개별 확인 필요';

/** 다른 사람이 먼저 바꿨을 때 보이는 '지금 저장된 템플릿'. 내 입력으로 덮어쓰면 사라지는 내용이다. */
function SavedTemplate({ template, origins, identity }: { template: ShippingSettingsTemplate; origins: GoodsFulfillmentOrigin[]; identity: ShippingSettingsIdentity }) {
  const { settings } = template, origin = origins.find(item => item.id === settings.originId), extras = shippingSettingsExtraChanges(settings);
  return <div className="mt-2 flex min-w-0 flex-col gap-1" data-goods-template-latest="">
    <strong className="font-medium">지금 저장된 템플릿 · {template.name} · {template.enabled ? '사용' : '사용 안 함'}</strong>
    <p>출고지: {origin?.name ?? '출고지 확인 필요'}</p>
    <ShippingSettingsDeliverySummary effective={{ ...settings, chargeGroup: undefined, fulfillment: undefined, delivery: settings.delivery?.mode === 'replace' ? settings.delivery.policy : null }} origin={origin} />
    <p>함께 바꾸는 것: {extras.length ? extras.join(', ') : '없음'}</p>
    <ShippingSettingsFulfillmentDirective value={settings.fulfillment} />
    {settings.chargeGroup?.mode === 'clear' ? <p>묶음그룹에서 뺍니다.</p> : null}
    {settings.chargeGroup?.mode === 'assign' ? <ShippingChargeGroupField identity={identity} originId={settings.originId} value={settings.chargeGroup.groupId} onChange={() => {}} readOnly /> : null}
    <p>반품 조건: {claimFlag(settings.claimPolicy.returnAllowed)} / 교환 조건: {claimFlag(settings.claimPolicy.exchangeAllowed)}</p>
    <p>고객 귀책 반품비 · 편도: {shippingSettingsMoney(settings.claimPolicy.returnFee)} / 최초 무료배송 후 반품비 · 왕복 합계: {shippingSettingsMoney(settings.claimPolicy.returnFreeShippingFee)} / 고객 귀책 교환비 · 왕복 합계: {shippingSettingsMoney(settings.claimPolicy.exchangeFee)}</p>
    <p>제한 사유와 적용 조건: {settings.claimPolicy.restrictionReason ?? '없음'}</p>
  </div>;
}

/**
 * 배송정보 템플릿 편집 창. 사이즈·A/S·이벤트 템플릿 편집 창과 같은 말을 쓴다(lib/admin/goods-template-save.ts).
 *   - 하나를 고르면 필요한 입력만 열린다: 배송비 유형이 '개별 배송비'일 때만 금액, '함께 바꾸는 것'을 체크했을 때만 그 입력.
 *   - 적은 내용이 있으면 닫기 전에 묻는다.
 *   - 다른 사람이 먼저 바꿨으면 입력을 그대로 둔 채 두 길을 고른다: 내 입력으로 덮어쓰기 / 내 입력 버리기.
 *   - `runtimeEnabled === false`(쇼핑몰 주문 설정이 꺼짐)면 적용할 수 없는 '함께 바꾸는 것'을 고르기 전에 막는다.
 * 저장 값의 모양(유지·변경, 넣기·빼기)은 전과 같다. `onClose(true)`는 목록을 다시 읽어야 하는 닫기다.
 */
export function ShippingSettingsTemplateForm({ template, newId, origins, regions, identity, scope, runtimeEnabled = null, onClose, onSaved }: {
  template?: ShippingSettingsTemplate; newId?: string; origins: GoodsFulfillmentOrigin[]; regions: GoodShippingRegionSummary[];
  identity: ShippingSettingsIdentity; scope: ShippingSettingsScope;
  /** 쇼핑몰 주문 설정이 켜져 있는가. 읽지 못했으면 null(막지 않고, 적용할 때 DB가 이유를 말한다). */
  runtimeEnabled?: boolean | null;
  onClose: (refresh?: boolean) => void; onSaved: (template: ShippingSettingsTemplate) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({}), [revision, setRevision] = useState(template?.revision ?? 0);
  const [loadingLatest, setLoadingLatest] = useState(false), [latest, setLatest] = useState<ShippingSettingsTemplate | null | undefined>(undefined);
  const [conflict, setConflict] = useState(false), [notice, setNotice] = useState('');
  const templateId = template?.id ?? newId ?? '', latestBusy = useRef(false), touched = useRef(false), root = useRef<HTMLFormElement>(null);
  /* 마지막으로 보낸 저장 내용. 다른 사람이 먼저 바꿨을 때 [내 입력으로 덮어쓰기]가 같은 내용을 지금 저장된 템플릿 위에 다시 보낸다(그동안 입력은 잠겨 있다). */
  const sent = useRef<Omit<ShippingSettingsSaveRequest, 'operationId' | 'expectedRevision'> | null>(null);
  const operation = useShippingSettingsOperation({ identity, scope, templateId, command: 'save',
    onReceipt: receipt => {
      if (receipt.state === 'saved' && receipt.template) onSaved(receipt.template);
      else if (receipt.state === 'sealed') setNotice('저장하지 않았습니다. 적은 내용은 그대로 있습니다. 확인한 뒤 다시 저장해 주세요.');
    },
    onFailure: failure => { if (failure.changed) { setConflict(true); void loadLatest(); } },
  });
  const pending = operation.busy || loadingLatest, unknown = Boolean(operation.context), locked = pending || unknown || conflict;
  const [originId, setOriginId] = useState(template?.settings.originId ?? ''); const [feeType, setFeeType] = useState(template?.settings.feeType ?? 'policy');
  /* 개별 배송비 칸은 값을 폼이 그대로 제출한다. 되읽기에 쓰려고 입력값만 따라 적는다. */
  const [fee, setFee] = useState(String(template?.settings.individualFee ?? 0));
  const extension = template ? shippingSettingsDelivery(template.settings) : { mode: 'preserve' as const };
  const [fulfillmentDraft, setFulfillmentDraft] = useState(() => shippingFulfillmentDraft(template?.settings.fulfillment));
  const [deliveryMode, setDeliveryMode] = useState(extension.mode);
  const chargeExtension = template ? shippingSettingsChargeGroup(template.settings) : { mode: 'preserve' as const };
  const [chargeMode, setChargeMode] = useState(chargeExtension.mode);
  const [chargeId, setChargeId] = useState<string | null>(chargeExtension.mode === 'assign' ? chargeExtension.groupId : null);
  const [deliveryDraft, setDeliveryDraft] = useState(() => goodsTermsDraft({ goodId: 'shipping-template', revision: 0,
    goodUpdatedAt: template?.updatedAt ?? '2026-01-01T00:00:00Z', volume: null,
    delivery: extension.mode === 'replace' ? { ...extension.policy, id: templateId, goodId: 'shipping-template', revision: 1 } : null }).delivery);
  const origin = origins.find(item => item.id === originId); const region = regions.find(item => item.originId === originId);
  const policy = template?.settings.claimPolicy;
  /* 사용 안 하는 출고지는 새로 고를 수 없다. 이미 그렇게 저장된 템플릿의 출고지만 목록에 남긴다. */
  const originOptions = origins.filter(item => item.active || item.id === template?.settings.originId);
  /* 쇼핑몰 주문 설정이 꺼져 있으면 새로 체크하지 못하게 한다. 이미 체크된 것은 끌 수 있게 열어 둔다. */
  const runtimeOff = runtimeEnabled === false;
  const blockedNow = [deliveryMode === 'replace' && deliveryDraft.status === 'active' ? '수량별·착불 설정' : '', chargeMode !== 'preserve' ? '묶음그룹' : '',
    fulfillmentDraft.action === 'replace' ? '수령 방식' : ''].filter(Boolean);
  const fulfillmentPolicy = fulfillmentDraft.action === 'replace' ? prepareShippingFulfillment(fulfillmentDraft) : null;
  /** 적은 수량별·착불 설정을 저장할 모양으로 읽는다. 아직 저장할 수 없는 입력이면 이유를 돌려준다. */
  const readDelivery = () => prepareGoodsTermsInput('delivery', { ...goodsTermsDraft({ goodId: 'shipping-template', revision: 0, goodUpdatedAt: '2026-01-01T00:00:00Z', volume: null, delivery: null }), delivery: deliveryDraft });
  /* 되읽기: 수량별·착불 설정을 '사용'으로 함께 바꾸는 템플릿은 그 규칙이 배송비 유형보다 먼저다. */
  const deliveryPrepared = deliveryMode === 'replace' ? readDelivery() : null;
  const activeDelivery = deliveryPrepared?.ok && (deliveryPrepared.value as DeliveryTermsInput).status === 'active' ? deliveryPrepared.value as DeliveryTermsInput : null;
  const error = (key: string) => errors[key] ? <span role="alert" className={FIELD_ERROR} id={`shipping-settings-${key}-error`}>{errors[key]}</span> : null;
  const props = (key: string) => ({ id: `shipping-settings-${key}`, name: key, 'aria-invalid': Boolean(errors[key]), 'aria-describedby': errors[key] ? `shipping-settings-${key}-error` : undefined });
  const touch = () => { touched.current = true; };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked) return;
    const form = new FormData(event.currentTarget);
    const fulfillment = prepareShippingFulfillment(fulfillmentDraft);
    if (!fulfillment) { setErrors({ fulfillment: shippingFulfillmentProblem(fulfillmentDraft) ?? '' }); focusFirstInvalid(root.current); return; }
    form.set('fulfillment', JSON.stringify(fulfillment));
    if (chargeMode === 'assign' && !chargeId) { setErrors({ chargeGroup: '넣을 묶음그룹을 골라 주세요.' }); focusFirstInvalid(root.current); return; }
    form.set('chargeGroup', JSON.stringify(chargeMode === 'assign' ? { mode: chargeMode, groupId: chargeId } : { mode: chargeMode }));
    if (deliveryMode === 'preserve') form.set('delivery', JSON.stringify({ mode: 'preserve' }));
    else {
      const prepared = readDelivery();
      if (!prepared.ok) { setErrors({ delivery: prepared.error }); focusFirstInvalid(root.current); return; }
      form.set('delivery', JSON.stringify({ mode: 'replace', policy: prepared.value as DeliveryTermsInput }));
    }
    const parsed = parseShippingSettingsTemplateForm(form);
    if (!parsed.ok) { setErrors(parsed.errors); focusFirstInvalid(root.current); return; }
    setErrors({}); setNotice('');
    sent.current = { command: 'save', templateId: parsed.id, ...identity, name: parsed.name, enabled: parsed.enabled, settings: parsed.settings };
    await operation.send({ ...sent.current, operationId: crypto.randomUUID(), expectedRevision: parsed.revision });
  }
  /** 지금 저장된 템플릿을 읽는다. 읽지 못했으면 undefined(화면에 이유를 보인다). 아직 저장된 적이 없으면 null. */
  async function loadLatest(): Promise<ShippingSettingsTemplate | null | undefined> {
    const ticket = scope.capture(); if (!ticket || latestBusy.current) return undefined;
    latestBusy.current = true; setLoadingLatest(true);
    try { const result = await readShippingSettingsTemplateAction(templateId, identity); if (!scope.canApply(ticket)) return undefined;
      if ('error' in result) { setErrors({ form: result.error }); if (result.authChanged) scope.authenticate(null, null); return undefined; }
      setLatest(result.data); return result.data;
    } catch { if (scope.canApply(ticket)) setErrors({ form: TEMPLATE_LATEST_UNREAD_MESSAGE }); return undefined; }
    finally { latestBusy.current = false; if (scope.canApply(ticket)) setLoadingLatest(false); }
  }
  async function saveOverLatest() {
    const input = sent.current; if (!input || pending || unknown) return;
    const target = latest === undefined ? await loadLatest() : latest;
    if (target === undefined) return;
    setRevision(target?.revision ?? 0); setConflict(false); setLatest(undefined); setErrors({});
    await operation.send({ ...input, operationId: crypto.randomUUID(), expectedRevision: target?.revision ?? 0 });
  }
  async function discardInput() {
    if (pending || unknown) return;
    if (await adminConfirm(TEMPLATE_DISCARD_INPUT_CONFIRM)) onClose(true);
  }
  async function close() {
    if (pending || unknown) return;
    if (touched.current && !await adminConfirm(ADMIN_DIALOG_CLOSE_DIRTY_CONFIRM)) { reopenClosedDialog(root.current); return; }
    onClose(conflict);
  }
  /* 고르면 열리는 입력 한 묶음: 체크 한 줄 + (체크했을 때만) 그 입력. */
  const extra = (name: string, label: string, checked: boolean, toggle: (next: boolean) => void, children: ReactNode) => <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" data-shipping-extra={name}>
    <label className={`${CHECK_LABEL} font-medium`}><input type="checkbox" checked={checked} data-shipping-extra-toggle={name} disabled={runtimeOff && !checked} onChange={event => toggle(event.target.checked)} />{label}</label>
    {checked ? children : null}
  </div>;
  const feeCard = (type: typeof feeType, title: string, description: string) => <GoodChoiceCard name="feeType" value={type} checked={feeType === type} onChange={() => setFeeType(type)} title={title} description={description}
    aria-invalid={errors.feeType ? 'true' : undefined} aria-describedby={errors.feeType ? 'shipping-settings-feeType-error' : undefined} />;
  return <CustomerServiceDialog title={template ? '배송정보 템플릿 수정' : '배송정보 템플릿 등록'} onClose={() => { void close(); }} busy={pending || unknown} wide>
    <form className="flex min-w-0 flex-col gap-4" data-shipping-editor="" noValidate onChange={touch} onSubmit={submit} ref={root}>
      <input type="hidden" name="id" value={templateId} /><input type="hidden" name="revision" value={revision} />
      <fieldset disabled={locked} className="m-0 grid min-w-0 grid-cols-1 gap-x-5 gap-y-4 border-0 p-0 sm:grid-cols-2">
        <label className={FIELD_LABEL} htmlFor="shipping-settings-name">템플릿 이름<Input {...props('name')} defaultValue={template?.name ?? ''} maxLength={80} required placeholder="예: 기본 택배 배송" />{error('name')}</label>
        <label className={FIELD_LABEL} htmlFor="shipping-settings-enabled">사용 여부<NativeSelect className="w-full" {...props('enabled')} defaultValue={String(template?.enabled ?? true)}><option value="true">사용</option><option value="false">사용 안 함</option></NativeSelect>{error('enabled')}</label>
        <label className={`${FIELD_LABEL} sm:col-span-2`} htmlFor="shipping-settings-originId">출고지<NativeSelect className="w-full sm:max-w-md" {...props('originId')} value={originId} onChange={event => setOriginId(event.target.value)} required><option value="">출고지를 골라 주세요</option>{originOptions.map(item => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' · 사용 안 함'}</option>)}</NativeSelect>
          {origin && !origin.active ? <small className={FIELD_HINT} data-shipping-origin-inactive="">사용 안 하는 출고지라 이 템플릿은 상품에 적용할 수 없습니다. 다른 출고지를 고르거나 배송정보 관리에서 출고지를 사용으로 바꿔 주세요.</small> : null}{error('originId')}</label>
        <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
          <GoodChoiceCards legend="배송비 유형">
            {feeCard('policy', '출고지 정책 따름', '출고지에 정해 둔 배송비를 받습니다')}
            {feeCard('free', '무료배송', '배송비를 받지 않습니다')}
            {feeCard('individual', '개별 배송비', '이 템플릿을 쓴 상품에만 따로 정한 배송비를 받습니다')}
          </GoodChoiceCards>
          {error('feeType')}
        </div>
        {/* 금액 칸은 '개별 배송비'일 때만 보인다. 숨겨도 값은 폼에 남아 그대로 저장된다(유형을 다시 바꾸면 이어서 쓴다). 숨은 칸이 제출을 막지 않게 범위 검사는 보일 때만 건다. */}
        <div className="sm:col-span-2" hidden={feeType !== 'individual' && !errors.individualFee}>
          <label className={FIELD_LABEL} htmlFor="shipping-settings-individualFee">개별 배송비 (원)<Input className="sm:max-w-xs" {...props('individualFee')} type="number" min={feeType === 'individual' ? 0 : undefined} max={feeType === 'individual' ? 1000000 : undefined} step={1} defaultValue={template?.settings.individualFee ?? 0} onChange={event => setFee(event.target.value)} />
            <small className={FIELD_HINT}>수량·옵션이 여러 개여도 한 번만 받습니다.</small>{error('individualFee')}</label>
        </div>
        <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0 sm:col-span-2" data-shipping-extras="">
          <legend className="float-left mb-1 w-full p-0 text-sm font-medium">이 템플릿이 함께 바꾸는 것</legend>
          <p className={`${NOTE} clear-both`}>체크하지 않은 것은 상품에 있는 설정을 그대로 둡니다.</p>
          {runtimeOff ? <AdminNotice role="status" tone="warning"><p data-shipping-runtime-off="">{blockedNow.length ? shippingSettingsRuntimeOffSaved(blockedNow) : SHIPPING_SETTINGS_RUNTIME_OFF}</p></AdminNotice> : null}
          {extra('delivery', '수량별·착불 설정', deliveryMode === 'replace', next => setDeliveryMode(next ? 'replace' : 'preserve'), <>
            <GoodsDeliveryPricingFields value={deliveryDraft} onChange={setDeliveryDraft} />
            <p className={NOTE}>‘사용 안 함’으로 두면 상품에 있던 수량별·착불 설정을 끄고, 위 배송비 유형과 선결제로 받습니다.</p>
            {error('delivery')}
          </>)}
          {extra('chargeGroup', '묶음그룹', chargeMode !== 'preserve', next => setChargeMode(next ? 'assign' : 'preserve'), <>
            <GoodChoiceGroup legend="묶음그룹을 어떻게 바꿀까요">
              <GoodChoiceOption name="shipping-settings-chargeMode" value="assign" checked={chargeMode === 'assign'} onChange={() => setChargeMode('assign')}>이 묶음그룹에 넣기</GoodChoiceOption>
              <GoodChoiceOption name="shipping-settings-chargeMode" value="clear" checked={chargeMode === 'clear'} onChange={() => setChargeMode('clear')}>묶음그룹에서 빼기</GoodChoiceOption>
            </GoodChoiceGroup>
            {chargeMode === 'assign' ? <ShippingChargeGroupField identity={identity} originId={originId} value={chargeId} onChange={value => { touch(); setChargeId(value); }} disabled={locked} allowClear={false} error={errors.chargeGroup} />
              : <><p className={NOTE}>묶음그룹에서 빼면 상품과 출고지의 배송비를 그대로 받습니다.</p>{error('chargeGroup')}</>}
          </>)}
          {extra('fulfillment', '수령 방식', fulfillmentDraft.action === 'replace', next => setFulfillmentDraft({ ...fulfillmentDraft, action: next ? 'replace' : 'preserve' }), <>
            <ShippingSettingsFulfillmentFields value={fulfillmentDraft} onChange={setFulfillmentDraft} error={errors.fulfillment} />
            <p className={NOTE} data-shipping-file-note="">적용하면 상품에 연결해 둔 디지털 파일이 새 주문부터 빠집니다. 이미 구매한 주문은 그대로 받을 수 있습니다.</p>
          </>)}
          {fulfillmentDraft.action !== 'replace' ? error('fulfillment') : null}
        </fieldset>
        {(['claimReturnAllowed', 'claimExchangeAllowed'] as const).map((key, index) => <label className={FIELD_LABEL} key={key} htmlFor={`shipping-settings-${key}`}>{index ? '교환 조건' : '반품 조건'}<NativeSelect className="w-full" {...props(key)} defaultValue={String((index ? policy?.exchangeAllowed : policy?.returnAllowed) ?? '')}><option value="">미검토 · 기본 정책 확인</option><option value="true">기본 정책에 따라 가능</option><option value="false">제한 사유와 개별 확인 필요</option></NativeSelect>{error(key)}</label>)}
        {([['claimReturnFee', '고객 귀책 반품비 · 편도 (원)', policy?.returnFee], ['claimReturnFreeShippingFee', '최초 무료배송 후 반품비 · 왕복 합계 (원)', policy?.returnFreeShippingFee], ['claimExchangeFee', '고객 귀책 교환비 · 왕복 합계 (원)', policy?.exchangeFee]] as const).map(([key, label, value]) => <label className={FIELD_LABEL} key={key} htmlFor={`shipping-settings-${key}`}>{label}<Input {...props(key)} type="number" min={0} max={1000000} step={1} defaultValue={value ?? ''} placeholder={CLAIM_FEE_PLACEHOLDER} />{error(key)}</label>)}
        <label className={`${FIELD_LABEL} sm:col-span-2`} htmlFor="shipping-settings-claimRestrictionReason">제한 사유와 적용 조건<Textarea {...props('claimRestrictionReason')} rows={3} maxLength={2000} defaultValue={policy?.restrictionReason ?? ''} placeholder="예: 포장을 뜯으면 반품할 수 없습니다" />{error('claimRestrictionReason')}</label>
        <p className={`${NOTE} sm:col-span-2`}>여기 적은 조건과 금액은 상품 상세에 보이는 안내입니다. 실제로 받거나 환불에서 빼는 금액이 아닙니다. 환불에서 빼는 반품배송비는 따로 정한 정책 금액을 씁니다.</p>
      </fieldset>
      {/* 지금 고른 값으로 고객이 내는 배송비를 되읽는다(상품등록의 배송비 되읽기와 같은 문장). 안에 여러 줄 요약이 들어가 GoodReadback(<p>)과 같은 모양의 상자를 쓴다. */}
      <div className="flex min-w-0 flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2 text-sm text-foreground" data-good-readback="" role="status">
        {activeDelivery ? <div className="flex min-w-0 flex-col gap-0.5" data-shipping-readback="delivery"><strong className="font-medium">이 템플릿을 쓴 상품</strong>
          <ShippingSettingsDeliverySummary effective={{ originId: originId || null, feeType, individualFee: Number(fee) || 0, delivery: activeDelivery }} origin={origin} /></div>
          : <strong className="font-medium" data-shipping-readback="">이 템플릿을 쓴 상품 · {goodShippingFeeReadback({ feeType, origin, individualFee: Number(fee) || 0 })}</strong>}
        {deliveryMode === 'preserve' ? <span className="text-muted-foreground">상품에 수량별 배송비가 켜져 있으면 그 금액을 먼저 받습니다.</span> : null}
        {fulfillmentPolicy?.mode === 'replace' ? <span>{shippingFulfillmentReadback(fulfillmentPolicy.policy)}</span> : null}
        {region ? <span className="text-muted-foreground wrap-anywhere">{region.label} <a className="text-foreground underline underline-offset-4" href="/admin/settings/shipping-regions" target="_blank" rel="noreferrer">지역별 추가배송비 관리 (새 탭)</a></span> : null}
      </div>
      {conflict ? <AdminNotice role="alert" tone="warning">
        <p>{CHANGED_BY_OTHER} 적은 내용은 그대로 있습니다.</p>
        {latest ? <SavedTemplate template={latest} origins={origins} identity={identity} /> : loadingLatest ? <p className="mt-2 text-muted-foreground">지금 저장된 내용을 불러오고 있습니다.</p> : null}
        <p className="mt-2 text-xs" data-goods-template-overwrite-note="">{TEMPLATE_SAVE_OVER_LATEST_NOTE}</p>
        <div className={`${ACTIONS} mt-2`}>
          <Button disabled={pending || unknown} onClick={() => { void saveOverLatest(); }} size="sm" type="button">{TEMPLATE_SAVE_OVER_LATEST_LABEL}</Button>
          <Button disabled={pending || unknown} onClick={() => { void discardInput(); }} size="sm" type="button" variant="outline">{TEMPLATE_DISCARD_INPUT_LABEL}</Button>
        </div>
      </AdminNotice> : null}
      {errors.form || !conflict && !unknown && operation.error ? <AdminNotice role="alert" tone="danger">{errors.form || operation.error}</AdminNotice> : null}
      {notice && !unknown && !conflict ? <AdminNotice role="status" tone="neutral">{notice}</AdminNotice> : null}
      {unknown ? <AdminNotice role="alert" tone="warning">
        <p>{operation.error || SAVE_UNKNOWN_MESSAGE}</p>{operation.message ? <p className="mt-1">{operation.message}</p> : null}
        <div className={`${ACTIONS} mt-2`}><Button disabled={pending} onClick={() => { void operation.check(); }} size="sm" type="button">{SAVE_CHECK_LABEL}</Button>
          <Button disabled={pending} onClick={() => { void operation.recover(true); }} size="sm" type="button" variant="outline">{SHIPPING_SETTINGS_STOP_LABEL}</Button></div>
      </AdminNotice> : null}
      <div className={`${ACTIONS} justify-end border-t pt-4`}>
        <Button disabled={pending || unknown} onClick={() => { void close(); }} type="button" variant="ghost">닫기</Button>
        {conflict ? null : <Button disabled={locked} type="submit">{pending ? '저장하는 중…' : '저장'}</Button>}
      </div>
    </form>
  </CustomerServiceDialog>;
}
