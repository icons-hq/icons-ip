'use client';

import Link from 'next/link';
import { FULFILLMENT_METHOD_LABELS, type GoodsFulfillment } from '@/lib/goods-fulfillment';
import { type ShippingFulfillmentDraft, type ShippingSettingsFulfillment } from '@/lib/admin/shipping-settings-fulfillment';

export function ShippingSettingsFulfillmentFields({ value, onChange, error }: { value: ShippingFulfillmentDraft; onChange: (value: ShippingFulfillmentDraft) => void; error?: string }) {
  const updateMethod = (method: string, patch: Partial<ShippingFulfillmentDraft['methods'][number]>) => onChange({ ...value, confirmed: false, methods: value.methods.map(m => m.method === method ? { ...m, ...patch } : m) });
  return <div className="admin-shipping-settings__full admin-shipping-settings__fulfillment">
    <label htmlFor="shipping-settings-fulfillment-action">수령 방식 적용<select id="shipping-settings-fulfillment-action" value={value.action} onChange={e => onChange({ ...value, action: e.target.value as typeof value.action, confirmed: false })}>
      <option value="preserve">상품의 수령 방식·파일 유지</option><option value="replace">이 템플릿의 수령 방식으로 변경</option>
    </select></label>
    {value.action === 'preserve' ? <p>고객이 선택할 배송수단·설치비·다운로드 파일을 그대로 유지합니다.</p> : <>
      <label htmlFor="shipping-settings-fulfillment-mode">수령 유형<select id="shipping-settings-fulfillment-mode" value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value as typeof value.mode, confirmed: false })}>
        <option value="shipping">배송수단 선택</option><option value="no_delivery">배송없음 · 직접전달</option>
      </select></label>
      <p>고객에게 허용할 수령 방식을 선택합니다. 택배는 위 배송비 규칙을 사용하고, 다른 운임과 설치비는 주문서에서 선결제합니다. 설치비는 상품 수량만큼 부과합니다.</p>
      <p>택배 이외 수령 방식은 <Link href="/admin/settings/origins" target="_blank" rel="noreferrer">출고지·배송정보 관리</Link>에서 해당 방식의 연락처·인계 장소·수령 절차를 활성화해야 주문할 수 있습니다.</p>
      {value.mode === 'shipping' ? value.methods.map(m => <div key={m.method} className="admin-shipping-settings__fulfillment-method">
        <label className="admin-shipping-settings__check"><input type="checkbox" checked={m.enabled} onChange={e => updateMethod(m.method, { enabled: e.target.checked })} />{FULFILLMENT_METHOD_LABELS[m.method]}</label>
        {m.enabled ? <div className="admin-shipping-settings__fulfillment-prices">
          {!['parcel', 'pickup'].includes(m.method) ? <><label>{FULFILLMENT_METHOD_LABELS[m.method]} 운임 (원)<input aria-label={`${FULFILLMENT_METHOD_LABELS[m.method]} 운임 (원)`} type="number" min={0} max={1000000} step={1} required value={m.feeAmount} onChange={e => updateMethod(m.method, { feeAmount: e.target.value })} /></label>
            <label>{FULFILLMENT_METHOD_LABELS[m.method]} 운임 단위<select aria-label={`${FULFILLMENT_METHOD_LABELS[m.method]} 운임 단위`} value={m.feeBasis} onChange={e => updateMethod(m.method, { feeBasis: e.target.value as typeof m.feeBasis })}><option value="per_order">상품당 한 번</option><option value="per_item">상품 수량마다</option></select></label></> : <p>{m.method === 'parcel' ? '상품의 택배 배송비 규칙 적용' : '방문수령 비용 없음'}</p>}
          {m.method !== 'pickup' ? <label>{FULFILLMENT_METHOD_LABELS[m.method]} 설치비 (개당 원)<input aria-label={`${FULFILLMENT_METHOD_LABELS[m.method]} 설치비 (개당 원)`} type="number" min={0} max={1000000} step={1} required value={m.installationFee} onChange={e => updateMethod(m.method, { installationFee: e.target.value })} /></label> : null}
        </div> : null}
      </div>) : <p>배송비와 설치비 없이 판매자가 직접 전달합니다.</p>}
      <label htmlFor="shipping-settings-fulfillment-note">고객 수령 안내<input id="shipping-settings-fulfillment-note" maxLength={1000} value={value.publicNote} onChange={e => onChange({ ...value, publicNote: e.target.value, confirmed: false })} /></label>
      <label htmlFor="shipping-settings-fulfillment-evidence">수령 설정 적용 근거<input id="shipping-settings-fulfillment-evidence" minLength={2} maxLength={1000} required value={value.evidence} onChange={e => onChange({ ...value, evidence: e.target.value, confirmed: false })} placeholder="예: 배송 계약과 설치 비용 확인" /></label>
      <p>선택한 상품의 기존 디지털 파일 연결도 해제됩니다. 새 파일은 상품별로 등록하며, 이미 구매한 주문의 파일과 수령 조건은 유지됩니다.</p>
      <label className="admin-shipping-settings__check"><input type="checkbox" checked={value.confirmed} required onChange={e => onChange({ ...value, confirmed: e.target.checked })} />수령 방식·금액·파일 연결 해제를 확인했습니다.</label>
    </>}
    {error ? <p role="alert" className="admin-shipping-settings__error">{error}</p> : null}
  </div>;
}
export function ShippingSettingsFulfillmentSummary({ value }: { value: Pick<GoodsFulfillment, 'mode' | 'methods' | 'files' | 'publicNote'> }) {
  return <div><strong>{value.mode === 'digital' ? `디지털 파일 ${value.files.length}개` : value.mode === 'no_delivery' ? '배송없음 · 직접전달' : '고객 선택 수령 방식'}</strong>
    {value.methods.map(m => <p key={m.method}>{FULFILLMENT_METHOD_LABELS[m.method]} · {m.feeAmount === null ? '택배 배송비 규칙 적용' : `${m.feeAmount.toLocaleString('ko-KR')}원 · ${m.feeBasis === 'per_item' ? '상품 수량마다' : '상품당 한 번'}`}{m.installationFee ? ` · 설치비 개당 ${m.installationFee.toLocaleString('ko-KR')}원` : ''}</p>)}
    {value.publicNote ? <p>수령 안내: {value.publicNote}</p> : null}
  </div>;
}
export function ShippingSettingsFulfillmentDirective({ value }: { value?: ShippingSettingsFulfillment }) {
  return value?.mode === 'replace' ? <ShippingSettingsFulfillmentSummary value={{ ...value.policy, files: [] }} /> : <small>상품의 수령 방식·파일 유지</small>;
}
