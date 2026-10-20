import type { CheckoutAddress } from '@/lib/checkout';
import type { GiftFailure, GiftItem } from '@/lib/gifts';
import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { publicMediaUrl } from '@/lib/media';

export const EMPTY_GIFT_ADDRESS: CheckoutAddress = { recipientName: '', phone: '', postalCode: '', address1: '', address2: '', deliveryNote: '' };
export function GiftItems({ items }: { items: readonly GiftItem[] }) {
  return <ul className="wc-gifts__items">{items.map((item, index) => {
    const image = item.imagePath ? publicMediaUrl(item.imagePath) : null;
    return <li key={`${item.variantId}:${index}`}>
      {image ? <span className="wc-gifts__item-image">{/* Existing verified catalog media. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" loading="lazy" width={80} height={80} /></span> : null}
      <div><strong>{item.name}</strong><p>{item.variantName} · {item.qty.toLocaleString()}개</p><GoodsCustomInputsSummary selection={item.customInputs} /></div>
    </li>;
  })}</ul>;
}
export function GiftAddressFields({ value, disabled, onChange }: { value: CheckoutAddress; disabled: boolean; onChange: (value: CheckoutAddress) => void }) {
  const field = (key: keyof CheckoutAddress, text: string) => onChange({ ...value, [key]: text });
  return <fieldset className="wc-gifts__address" disabled={disabled}><legend>받을 배송지</legend>
    <label>받는 분<input required autoComplete="name" maxLength={50} value={value.recipientName} onChange={e => field('recipientName', e.target.value)} /></label>
    <label>연락처<input required type="tel" autoComplete="tel" maxLength={20} value={value.phone} onChange={e => field('phone', e.target.value)} /></label>
    <label>우편번호<input required inputMode="numeric" autoComplete="postal-code" pattern="[0-9]{5}" maxLength={5} value={value.postalCode} onChange={e => field('postalCode', e.target.value)} /></label>
    <label>기본 주소<input required autoComplete="address-line1" maxLength={200} value={value.address1} onChange={e => field('address1', e.target.value)} /></label>
    <label>상세 주소<input autoComplete="address-line2" maxLength={200} value={value.address2 ?? ''} onChange={e => field('address2', e.target.value)} /></label>
    <label>배송 메모<input maxLength={200} value={value.deliveryNote ?? ''} onChange={e => field('deliveryNote', e.target.value)} /></label>
  </fieldset>;
}
export function GiftRequestFeedback({ failure, blocked, pending, retry }: { failure: GiftFailure | null; blocked: boolean; pending: boolean; retry: () => void }) {
  if (blocked) return <p role="alert">로그인 계정이 바뀌었습니다. 화면을 새로 열어주세요.</p>;
  return <>{pending ? <p role="status">처리 중입니다.</p> : null}{failure ? <div role="alert"><p>{failure.error}</p>{failure.uncertain ? <button type="button" disabled={pending} onClick={retry}>같은 요청 결과 확인</button> : null}</div> : null}</>;
}
export function GiftEmpty({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="wc-gifts__empty"><h2>{title}</h2>{children}</section>;
}
