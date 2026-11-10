import type { CheckoutAddress } from '@/lib/checkout';
import type { SubscriptionSchedule } from '@/lib/subscriptions/schedule';
import { GOODS_SUBSCRIPTION_INTERVALS, GOODS_SUBSCRIPTION_INTERVAL_LABELS, type GoodsSubscriptionInterval } from '@/lib/admin/goods-subscription-policy';
import type { useSubscriptionRequest } from './useSubscriptionRequest';

export const subscriptionDate = (value: string | null) => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
export const kstToday = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
export const nextKstDate = () => new Date(Date.now() + 33 * 60 * 60 * 1000).toISOString().slice(0, 10);
export function SubscriptionRequestFeedback(request: ReturnType<typeof useSubscriptionRequest>) {
  return <>
    {request.blocked ? <p role="alert">로그인 계정 또는 세션이 바뀌었습니다. 현재 계정으로 이 화면을 다시 열어주세요.</p> : <>
      {request.pending && <p role="status">처리 결과를 확인하고 있어요. 잠시 기다려주세요.</p>}
      {request.failure && <div role="alert"><p>{request.failure.error}</p>
        {request.failure.uncertain && <button type="button" disabled={request.pending} onClick={request.retry}>같은 요청으로 결과 확인</button>}</div>}
    </>}
  </>;
}
export function SubscriptionAddressFields({ value, onChange, prefix = 'subscription' }: { value: CheckoutAddress; onChange: (value: CheckoutAddress) => void; prefix?: string }) {
  const fields = [
    ['recipientName', '받는 분', 'name', 50], ['phone', '연락처', 'tel', 20], ['postalCode', '우편번호', 'postal-code', 5],
    ['address1', '기본 주소', 'address-line1', 200], ['address2', '상세 주소', 'address-line2', 200], ['deliveryNote', '배송 요청사항', 'off', 200],
  ] as const;
  return <div className="wc-subscriptions__fields">{fields.map(([key, label, autoComplete, limit]) => <label key={key} htmlFor={`${prefix}-${key}`}>{label}
    <input id={`${prefix}-${key}`} value={value[key] ?? ''} onChange={event => onChange({ ...value, [key]: event.target.value })}
      maxLength={limit} autoComplete={autoComplete} inputMode={key === 'phone' ? 'tel' : key === 'postalCode' ? 'numeric' : 'text'} required={!['address2', 'deliveryNote'].includes(key)} />
  </label>)}</div>;
}
export function SubscriptionScheduleFields({ value, onChange, intervals = GOODS_SUBSCRIPTION_INTERVALS, future = false }: {
  value: SubscriptionSchedule; onChange: (value: SubscriptionSchedule) => void; intervals?: readonly GoodsSubscriptionInterval[]; future?: boolean;
}) {
  return <div className="wc-subscriptions__fields"><label>배송 주기<select value={`${value.unit}_${value.interval}`} onChange={event => {
    const [unit, interval] = event.target.value.split('_'); onChange({ ...value, unit: unit as 'week' | 'month', interval: Number(interval), monthEnd: unit === 'month' && value.monthEnd });
  }}>{intervals.map(item => <option key={item} value={item}>{GOODS_SUBSCRIPTION_INTERVAL_LABELS[item]}</option>)}</select></label>
    {future ? <label>다음 결제일<input type="date" value={value.anchorDate} min={kstToday()} required onChange={event => onChange({ ...value, anchorDate: event.target.value })} /></label>
      : <p>첫 결제는 신청 확정 후 진행하고, 이후 선택한 주기로 결제해요.</p>}
    <label>정기 결제 기준 시각 · 한국시간<input type="time" value={value.time} required onChange={event => onChange({ ...value, time: event.target.value })} /></label>
    {value.unit === 'month' && <label className="wc-subscriptions__check"><input type="checkbox" checked={value.monthEnd} onChange={event => onChange({ ...value, monthEnd: event.target.checked })} />매월 말일 기준</label>}
  </div>;
}
