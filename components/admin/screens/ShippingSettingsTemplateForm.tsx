'use client';
import { useRef, useState, type FormEvent } from 'react';
import { readShippingSettingsTemplateAction } from '@/app/admin/shipping-settings-template-actions';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { GoodShippingRegionSummary } from '@/lib/admin/good-shipping-summary';
import { parseShippingSettingsTemplateForm, shippingSettingsDelivery, shippingSettingsChargeGroup, shippingSettingsMoney, type ShippingSettingsIdentity, type ShippingSettingsTemplate } from '@/lib/admin/shipping-settings-templates';
import { goodsTermsDraft, prepareGoodsTermsInput, type DeliveryTermsInput } from '@/lib/admin/goods-transaction-terms';
import { GoodsDeliveryPricingFields } from '@/components/admin/GoodsTransactionTermsPanel';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { ShippingSettingsDeliverySummary } from './ShippingSettingsDeliverySummary';
import { useShippingSettingsOperation, type ShippingSettingsScope } from './useShippingSettingsOperation';
import { shippingFulfillmentDraft, prepareShippingFulfillment } from '@/lib/admin/shipping-settings-fulfillment';
import { ShippingSettingsFulfillmentFields, ShippingSettingsFulfillmentDirective } from './ShippingSettingsFulfillmentFields';
import { ShippingChargeGroupField } from '@/components/admin/ShippingChargeGroupField';

export function ShippingSettingsTemplateForm({ template, newId, origins, regions, identity, scope, onClose, onSaved }: {
  template?: ShippingSettingsTemplate; newId?: string; origins: GoodsFulfillmentOrigin[]; regions: GoodShippingRegionSummary[];
  identity: ShippingSettingsIdentity; scope: ShippingSettingsScope;
  onClose: () => void; onSaved: (template: ShippingSettingsTemplate) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({}), [revision, setRevision] = useState(template?.revision ?? 0);
  const [loadingLatest, setLoadingLatest] = useState(false), [latest, setLatest] = useState<ShippingSettingsTemplate | null | undefined>(undefined);
  const [needsRefresh, setNeedsRefresh] = useState(false), [notice, setNotice] = useState('');
  const templateId = template?.id ?? newId ?? '', latestBusy = useRef(false);
  const operation = useShippingSettingsOperation({ identity, scope, templateId, command: 'save', onReceipt: receipt => {
    if (receipt.state === 'saved' && receipt.template) onSaved(receipt.template);
    else if (receipt.state === 'sealed') { setNeedsRefresh(true); setNotice('미처리 요청을 종료했습니다. 입력은 유지됩니다. 최신 저장본을 확인한 뒤 저장 기준을 선택해주세요.'); }
  } });
  const pending = operation.busy || loadingLatest, locked = pending || Boolean(operation.context);
  const [originId, setOriginId] = useState(template?.settings.originId ?? ''); const [feeType, setFeeType] = useState(template?.settings.feeType ?? 'policy');
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
  const error = (key: string) => errors[key] ? <span role="alert" className="admin-shipping-settings__error" id={`shipping-settings-${key}-error`}>{errors[key]}</span> : null;
  const props = (key: string) => ({ id: `shipping-settings-${key}`, name: key, 'aria-invalid': Boolean(errors[key]), 'aria-describedby': errors[key] ? `shipping-settings-${key}-error` : undefined });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked || needsRefresh) return;
    const form = new FormData(event.currentTarget);
    const fulfillment = prepareShippingFulfillment(fulfillmentDraft);
    if (!fulfillment) { setErrors({ fulfillment: '수령 방식·정수 금액·적용 근거와 확인 여부를 점검해주세요.' }); return; }
    form.set('fulfillment', JSON.stringify(fulfillment));
    if (chargeMode === 'assign' && !chargeId) { setErrors({ chargeGroup: '적용할 배송비 묶음그룹을 선택해주세요.' }); return; }
    form.set('chargeGroup', JSON.stringify(chargeMode === 'assign' ? { mode: chargeMode, groupId: chargeId } : { mode: chargeMode }));
    if (deliveryMode === 'preserve') form.set('delivery', JSON.stringify({ mode: 'preserve' }));
    else {
      const draft = goodsTermsDraft({ goodId: 'shipping-template', revision: 0, goodUpdatedAt: '2026-01-01T00:00:00Z', volume: null, delivery: null });
      const prepared = prepareGoodsTermsInput('delivery', { ...draft, delivery: deliveryDraft });
      if (!prepared.ok) { setErrors({ delivery: prepared.error }); return; }
      form.set('delivery', JSON.stringify({ mode: 'replace', policy: prepared.value as DeliveryTermsInput }));
    }
    const parsed = parseShippingSettingsTemplateForm(form);
    if (!parsed.ok) { setErrors(parsed.errors); return; }
    setErrors({}); setNotice('');
    await operation.send({ operationId: crypto.randomUUID(), command: 'save', templateId: parsed.id, expectedRevision: parsed.revision,
      ...identity, name: parsed.name, enabled: parsed.enabled, settings: parsed.settings });
  }
  async function loadLatest() {
    const ticket = scope.capture(); if (!ticket || locked || latestBusy.current) return;
    latestBusy.current = true; setLoadingLatest(true);
    try { const result = await readShippingSettingsTemplateAction(templateId, identity); if (!scope.canApply(ticket)) return;
      if ('error' in result) { setErrors({ form: result.error }); if (result.authChanged) scope.authenticate(null, null); }
      else { setLatest(result.data); setNotice('현재 입력과 최신 저장본을 비교한 뒤 저장 기준을 선택해주세요.'); }
    } catch { if (scope.canApply(ticket)) setErrors({ form: '최신 저장본을 읽지 못했습니다. 현재 입력은 유지됩니다.' }); }
    finally { latestBusy.current = false; if (scope.canApply(ticket)) setLoadingLatest(false); }
  }
  return <CustomerServiceDialog title={template ? '배송정보 템플릿 수정' : '배송정보 템플릿 등록'} onClose={() => { if (!locked) onClose(); }} busy={locked} wide>
    <form className="admin-shipping-settings__editor" onSubmit={submit}>
      <input type="hidden" name="id" value={templateId} /><input type="hidden" name="revision" value={revision} />
      <fieldset disabled={locked}>
        <label htmlFor="shipping-settings-name">템플릿 이름<input {...props('name')} defaultValue={template?.name ?? ''} maxLength={80} required placeholder="예: 기본 택배 배송" />{error('name')}</label>
        <label htmlFor="shipping-settings-enabled">사용 여부<select {...props('enabled')} defaultValue={String(template?.enabled ?? true)}><option value="true">사용</option><option value="false">사용 안 함</option></select>{error('enabled')}</label>
        <label htmlFor="shipping-settings-originId">출고지<select {...props('originId')} value={originId} onChange={event => setOriginId(event.target.value)} required><option value="">출고지를 선택해주세요</option>{origins.map(item => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' · 비활성'}</option>)}</select>{error('originId')}</label>
        <label htmlFor="shipping-settings-feeType">배송비 유형<select {...props('feeType')} value={feeType} onChange={event => setFeeType(event.target.value as typeof feeType)}><option value="policy">출고지 정책 따름</option><option value="free">무료배송</option><option value="individual">개별 배송비</option></select>{error('feeType')}</label>
        <label htmlFor="shipping-settings-individualFee">개별 배송비 (원)<input {...props('individualFee')} type="number" min={0} max={1000000} step={1} defaultValue={template?.settings.individualFee ?? 0} required /><small>{feeType === 'individual' ? '같은 상품의 수량·옵션과 관계없이 한 번 부과합니다.' : '입력값은 보관하고, 개별 배송비 유형일 때만 계산합니다.'}</small>{error('individualFee')}</label>
        <div className="admin-shipping-settings__full">
          <label htmlFor="shipping-settings-deliveryMode">수량별·착불 설정 적용 방식<select id="shipping-settings-deliveryMode" value={deliveryMode} onChange={event => setDeliveryMode(event.target.value as typeof deliveryMode)}>
            <option value="preserve">상품에 저장된 확장 배송비 유지</option><option value="replace">이 템플릿의 확장 배송비로 변경</option>
          </select></label>
          {deliveryMode === 'preserve' ? <p>기존 템플릿도 이 방식으로 동작합니다. 상품의 수량별·착불 설정은 유지되며, 사용 중인 수량별 배송비가 있으면 위 기본 배송비보다 우선합니다.</p>
            : <><GoodsDeliveryPricingFields value={deliveryDraft} onChange={setDeliveryDraft} /><p>‘사용 안 함’으로 적용하면 상품의 기존 확장 배송비를 명시적으로 비활성화합니다. 기본 배송비 설정과 선결제로 돌아갑니다. 초안도 실제 운임 계산에는 적용하지 않습니다.</p></>}
          {error('delivery')}
        </div>
        <div className="admin-shipping-settings__full">
          <label htmlFor="shipping-settings-chargeMode">배송비 묶음그룹 적용 방식<select id="shipping-settings-chargeMode" value={chargeMode} onChange={event => setChargeMode(event.target.value as typeof chargeMode)}>
            <option value="preserve">상품의 현재 묶음그룹 유지</option><option value="assign">이 묶음그룹으로 지정</option><option value="clear">묶음그룹 배정 해제</option>
          </select></label>
          {chargeMode === 'assign' ? <ShippingChargeGroupField identity={identity} originId={originId} value={chargeId} onChange={setChargeId} disabled={locked} allowClear={false} error={errors.chargeGroup} />
            : <p>{chargeMode === 'clear' ? '배정을 해제하면 상품·출고지의 기존 개별 계산으로 돌아갑니다. 상품의 복수구매 할인과 구매 합산군은 유지합니다.' : '기존 템플릿도 배정을 유지합니다. 출고지를 바꾸면 기존 묶음그룹과 호환되는지 적용 전에 확인합니다.'}</p>}
          {chargeMode !== 'assign' ? error('chargeGroup') : null}
        </div>
        <ShippingSettingsFulfillmentFields value={fulfillmentDraft} onChange={setFulfillmentDraft} error={errors.fulfillment} />
        <div className="admin-shipping-settings__origin">
          <strong>출고지의 현재 배송정보</strong>
          {origin ? <><p>{origin.name} · {origin.active ? '활성' : '비활성'} · 기본 배송비 {shippingSettingsMoney(origin.baseFee)} · {origin.freeThreshold === null ? '무료 기준 없음' : `${shippingSettingsMoney(origin.freeThreshold)} 이상 무료`}</p><p>기본 택배사 {origin.defaultCarrier ?? '미설정'} · 반송 주소 {origin.returnAddress || '미설정'}</p></> : <p>선택한 출고지의 정보를 확인합니다.</p>}
          <p>{region?.label ?? '지역 배송 정책에서 적용 상태를 확인해주세요.'} {region?.detail}</p>
          <p>출고지와 묶음그룹의 지역 추가료 적용 범위를 함께 확인합니다. 최종 운임은 주문 주소와 상품 구성으로 계산합니다.</p>
        </div>
        {(['claimReturnAllowed', 'claimExchangeAllowed'] as const).map((key, index) => <label key={key} htmlFor={`shipping-settings-${key}`}>{index ? '교환 조건' : '반품 조건'}<select {...props(key)} defaultValue={String((index ? policy?.exchangeAllowed : policy?.returnAllowed) ?? '')}><option value="">미검토 · 기본 정책 확인</option><option value="true">기본 정책에 따라 가능</option><option value="false">제한 사유와 개별 확인 필요</option></select>{error(key)}</label>)}
        {([['claimReturnFee', '고객 귀책 반품비 · 편도 (원)', policy?.returnFee], ['claimReturnFreeShippingFee', '최초 무료배송 후 반품비 · 왕복 합계 (원)', policy?.returnFreeShippingFee], ['claimExchangeFee', '고객 귀책 교환비 · 왕복 합계 (원)', policy?.exchangeFee]] as const).map(([key, label, value]) => <label key={key} htmlFor={`shipping-settings-${key}`}>{label}<input {...props(key)} type="number" min={0} max={1000000} step={1} defaultValue={value ?? ''} placeholder="미확인이면 비워두세요" />{error(key)}</label>)}
        <label className="admin-shipping-settings__full" htmlFor="shipping-settings-claimRestrictionReason">제한 사유와 적용 조건<textarea {...props('claimRestrictionReason')} rows={3} maxLength={2000} defaultValue={policy?.restrictionReason ?? ''} />{error('claimRestrictionReason')}</label>
        <p className="admin-shipping-settings__full">비용을 비우면 미확인, 0원은 확인된 무료입니다. 반품·교환 조건은 고객 안내이며 접수 제한이나 환불 차감에 사용하지 않습니다.</p>
      </fieldset>
      {latest !== undefined ? <div className="admin-shipping-settings__origin"><strong>최신 저장본</strong>
        {latest ? <><p>{latest.name} · 버전 {latest.revision} · {latest.enabled ? '사용' : '사용 안 함'} · {origins.find(item => item.id === latest.settings.originId)?.name ?? '출고지 확인 필요'}</p>
          <ShippingSettingsDeliverySummary effective={{ ...latest.settings, chargeGroup: undefined, fulfillment: undefined, delivery: latest.settings.delivery?.mode === 'replace' ? latest.settings.delivery.policy : null }} />
          <p>{latest.settings.delivery?.mode === 'replace' ? '이 템플릿의 확장 배송비로 변경' : '상품의 기존 확장 배송비 유지'}</p>
          <ShippingSettingsFulfillmentDirective value={latest.settings.fulfillment} />
          <p>묶음그룹: {latest.settings.chargeGroup?.mode === 'assign' ? '지정 그룹으로 변경' : latest.settings.chargeGroup?.mode === 'clear' ? '배정 해제' : '현재 배정 유지'}</p>
          {latest.settings.chargeGroup?.mode === 'assign' ? <ShippingChargeGroupField identity={identity} originId={latest.settings.originId} value={latest.settings.chargeGroup.groupId} onChange={() => {}} readOnly /> : null}
          {([['반품 조건', latest.settings.claimPolicy.returnAllowed], ['교환 조건', latest.settings.claimPolicy.exchangeAllowed]] as const).map(([label, allowed]) =>
            <p key={label}>{label}: {allowed === null ? '미검토 · 기본 정책 확인' : allowed ? '기본 정책에 따라 가능' : '제한 사유와 개별 확인 필요'}</p>)}
          <p>고객 귀책 반품비 · 편도: {shippingSettingsMoney(latest.settings.claimPolicy.returnFee)} / 최초 무료배송 후 반품비 · 왕복 합계: {shippingSettingsMoney(latest.settings.claimPolicy.returnFreeShippingFee)} / 고객 귀책 교환비 · 왕복 합계: {shippingSettingsMoney(latest.settings.claimPolicy.exchangeFee)}</p>
          <p>제한 사유와 적용 조건: {latest.settings.claimPolicy.restrictionReason ?? '미입력'}</p></> : <p>아직 저장된 템플릿이 없습니다.</p>}
        <button className="btn btn-sm" type="button" disabled={locked} onClick={() => { setRevision(latest?.revision ?? 0); setNeedsRefresh(false); setLatest(undefined); setNotice('현재 입력을 유지하고 최신 버전을 저장 기준으로 선택했습니다.'); }}>내 입력 유지 · 최신 버전을 저장 기준으로</button>
      </div> : null}
      {errors.form || operation.error ? <p role="alert" className="admin-shipping-settings__error">{errors.form || operation.error}</p> : null}
      {notice || operation.message ? <p role="status">{notice || operation.message}</p> : null}
      {operation.context ? <div className="admin-shipping-settings__origin"><strong>진행한 요청의 결과를 먼저 확인해주세요.</strong><p>이 탭에는 요청번호와 저장 기준만 보관합니다. 새로고침 후에는 결과 확인 또는 미처리 요청 종료만 할 수 있습니다.</p>
        <div className="admin-shipping-settings__actions"><button className="btn" type="button" disabled={pending} onClick={() => { void operation.recover(); }}>저장 결과 확인</button>
          {operation.canRetry ? <button className="btn btn-ghost" type="button" disabled={pending} onClick={() => { void operation.retry(); }}>같은 입력으로 재시도</button> : null}
          <button className="btn btn-ghost" type="button" disabled={pending} onClick={() => { void operation.recover(true); }}>미처리 요청 종료</button></div></div> : null}
      <div className="admin-shipping-settings__actions"><button className="btn" type="submit" disabled={locked || needsRefresh}>{pending ? '처리 중…' : template ? '새 버전 저장' : '등록'}</button>
        <button className="btn btn-ghost" type="button" disabled={locked} onClick={() => { void loadLatest(); }}>최신 저장본 불러오기</button><button className="btn btn-ghost" type="button" disabled={locked} onClick={onClose}>취소</button></div>
      <p>저장하면 다음 버전이 생성됩니다. 기존 상품에 적용된 설정은 미리보기 후 다시 적용해야 변경됩니다.</p>
    </form>
  </CustomerServiceDialog>;
}
