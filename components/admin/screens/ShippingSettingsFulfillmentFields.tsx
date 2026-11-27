'use client';

import { FULFILLMENT_METHOD_LABELS, type GoodsFulfillment } from '@/lib/goods-fulfillment';
import { shippingFulfillmentReadback, type ShippingFulfillmentDraft, type ShippingSettingsFulfillment } from '@/lib/admin/shipping-settings-fulfillment';
import { GoodChoiceCard, GoodChoiceCards } from '@/components/admin/GoodEditorParts';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { CHECK_LABEL, FIELD_ERROR, FIELD_HINT, FIELD_LABEL, NOTE } from '@/components/admin/settings-kit';

/*
 * 템플릿이 함께 바꾸는 수령 방식 입력. 편집 창이 '수령 방식'을 체크했을 때만 그린다.
 * 칸 이름과 문장은 상품의 수령 방식 패널(GoodsFulfillmentPanel)과 같은 말을 쓴다. 템플릿에는 디지털 파일을 담지 않는다.
 * 적용 근거·확인 체크는 없다(2026-11-25 결정 — 저장 = 적용).
 */
export function ShippingSettingsFulfillmentFields({ value, onChange, error }: { value: ShippingFulfillmentDraft; onChange: (value: ShippingFulfillmentDraft) => void; error?: string }) {
  const updateMethod = (method: string, patch: Partial<ShippingFulfillmentDraft['methods'][number]>) => onChange({ ...value, methods: value.methods.map(m => m.method === method ? { ...m, ...patch } : m) });
  /* 택배 외 방식과 직접 전달은 출고지에서 연락처·인계 장소·수령 절차를 켜 둬야 주문할 수 있다. */
  const needsOriginSetup = value.mode === 'no_delivery' || value.methods.some(m => m.enabled && m.method !== 'parcel');
  const modeCard = (mode: ShippingFulfillmentDraft['mode'], title: string, description: string) => <GoodChoiceCard name="shipping-settings-fulfillment-mode" value={mode}
    checked={value.mode === mode} onChange={() => onChange({ ...value, mode })} title={title} description={description} />;
  return <div className="flex min-w-0 flex-col gap-3" data-shipping-fulfillment="">
    <GoodChoiceCards legend="수령 방식">
      {modeCard('shipping', '배송 또는 방문수령', '고객이 주문서에서 받는 방법을 고릅니다.')}
      {modeCard('no_delivery', '배송없음 · 직접전달', '배송비 없이 주문받고, 직접 전달한 뒤 전달 근거를 기록합니다.')}
    </GoodChoiceCards>
    {value.mode === 'shipping' ? <div className="grid min-w-0 gap-3 sm:grid-cols-2">{value.methods.map(m => <div key={m.method} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" data-fulfillment-method={m.method}>
      <label className={`${CHECK_LABEL} font-medium`}><input type="checkbox" checked={m.enabled} onChange={e => updateMethod(m.method, { enabled: e.target.checked })} />{FULFILLMENT_METHOD_LABELS[m.method]}</label>
      {m.enabled ? <>
        {!['parcel', 'pickup'].includes(m.method) ? <><label className={FIELD_LABEL}>선결제 배송비 (원)<Input aria-label={`${FULFILLMENT_METHOD_LABELS[m.method]} 선결제 배송비 (원)`} type="number" min={0} max={1000000} step={1} required value={m.feeAmount} onChange={e => updateMethod(m.method, { feeAmount: e.target.value })} /></label>
          <label className={FIELD_LABEL}>배송비 계산 단위<NativeSelect className="w-full" aria-label={`${FULFILLMENT_METHOD_LABELS[m.method]} 배송비 계산 단위`} value={m.feeBasis} onChange={e => updateMethod(m.method, { feeBasis: e.target.value as typeof m.feeBasis })}><option value="per_order">이 상품 주문당 1회</option><option value="per_item">수량 1개마다</option></NativeSelect></label></>
          : <p className={FIELD_HINT}>{m.method === 'parcel' ? '배송비는 위에서 정한 배송비 유형을 따릅니다.' : '방문수령은 배송비 0원입니다.'}</p>}
        {m.method !== 'pickup' ? <label className={FIELD_LABEL}>수량 1개당 선결제 설치비 (원)<Input aria-label={`${FULFILLMENT_METHOD_LABELS[m.method]} 수량 1개당 선결제 설치비 (원)`} type="number" min={0} max={1000000} step={1} required value={m.installationFee} onChange={e => updateMethod(m.method, { installationFee: e.target.value })} /></label> : null}
      </> : null}
    </div>)}</div> : null}
    {needsOriginSetup ? <p className={NOTE} data-shipping-fulfillment-origin-note="">택배 외 방식은 <a className="font-medium text-foreground underline underline-offset-4" href="/admin/settings/origins" target="_blank" rel="noreferrer">배송정보 관리</a>에서 출고지의 연락처·인계 장소·수령 절차를 먼저 켜 둬야 주문할 수 있습니다. 추가 배송비는 선결제로만 받고, 현장에서 따로 받지 않습니다.</p> : null}
    <label className={FIELD_LABEL} htmlFor="shipping-settings-fulfillment-note">고객 안내 (선택)<Input id="shipping-settings-fulfillment-note" maxLength={1000} placeholder="예: 설치 기사가 방문해 설치합니다" value={value.publicNote} onChange={e => onChange({ ...value, publicNote: e.target.value })} />
      <small className={FIELD_HINT}>상품 상세의 ‘제공 방식’과 주문서의 ‘받을 방식’ 아래에 보입니다.</small></label>
    {error ? <p role="alert" className={FIELD_ERROR}>{error}</p> : null}
  </div>;
}
/** 상품(또는 템플릿)의 수령 방식을 한 줄로 보인다. 미리보기 표의 '지금'·'바꾼 뒤' 칸과 목록이 쓴다. */
export function ShippingSettingsFulfillmentSummary({ value }: { value: Pick<GoodsFulfillment, 'mode' | 'methods' | 'files' | 'publicNote'> }) {
  return <div className="flex min-w-0 flex-col gap-0.5">
    <span>{value.mode === 'digital' ? `디지털 파일 ${value.files.length}개를 내려받습니다.` : shippingFulfillmentReadback({ mode: value.mode, methods: value.methods })}</span>
    {value.publicNote ? <span className={FIELD_HINT}>고객 안내: {value.publicNote}</span> : null}
  </div>;
}
/** 템플릿이 수령 방식을 함께 바꾸도록 저장돼 있을 때만 그 내용을 보인다(바꾸지 않는 템플릿은 아무것도 그리지 않는다). */
export function ShippingSettingsFulfillmentDirective({ value }: { value?: ShippingSettingsFulfillment }) {
  return value?.mode === 'replace' ? <ShippingSettingsFulfillmentSummary value={{ ...value.policy, files: [] }} /> : null;
}
