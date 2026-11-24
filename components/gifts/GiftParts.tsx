import type { CheckoutAddress, CheckoutAddressErrors } from '@/lib/checkout';
import { PostcodeField } from '@/components/checkout/PostcodeField';
import { focusCheckoutElementWhenReady } from '@/components/checkout/focus-when-ready';
import type { GiftFailure, GiftItem } from '@/lib/gifts';
import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { publicMediaUrl } from '@/lib/media';
import { checkoutRestrictionNotice, type CheckoutClaimRestrictions } from '@/lib/checkout-acknowledgement';

/** 선물 받기 문맥의 검색 실패 문구(주문서 문구는 '주문할 수 있어요'라 맞지 않는다). */
export const GIFT_POSTCODE_FAILED_MESSAGE = '주소 검색을 열지 못했어요. 우편번호와 기본 주소를 직접 입력해도 선물을 받을 수 있어요.';
export const EMPTY_GIFT_ADDRESS: CheckoutAddress = { recipientName: '', phone: '', postalCode: '', address1: '', address2: '', deliveryNote: '' };
/** restrictions가 있으면 주문서와 같은 줄별 청약철회·교환 제한 고지를 그린다 — 결제 전 동의가 보인 고지로 기록하는 목록이다. */
export function GiftItems({ items, restrictions }: { items: readonly GiftItem[]; restrictions?: CheckoutClaimRestrictions | null }) {
  return <ul className="wc-gifts__items">{items.map((item, index) => {
    const image = item.imagePath ? publicMediaUrl(item.imagePath) : null;
    return <li key={`${item.variantId}:${index}`}>
      {image ? <span className="wc-gifts__item-image">{/* Existing verified catalog media. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" loading="lazy" width={80} height={80} /></span> : null}
      <div><strong>{item.name}</strong><p>{item.variantName} · {item.qty.toLocaleString()}개</p><GoodsCustomInputsSummary selection={item.customInputs} />{restrictions && Object.hasOwn(restrictions, item.goodId) ? <p className="wc-gifts__restriction" data-claim-restriction=""><strong>{checkoutRestrictionNotice(restrictions[item.goodId])}</strong></p> : null}</div>
    </li>;
  })}</ul>;
}
/**
 * 선물 받을 배송지 칸. 주소는 주문서와 같은 검색 부품(PostcodeField)으로 확정한다 — 검색 결과는 잠기고 손 입력은 검색을 열지
 * 못했을 때만 열린다. 잠긴 칸은 브라우저 필수 검사에서 빠지므로 제출은 useAddressFormGuard 가 검사한다(공동주택 확인 포함).
 * 선물 수령인 주소는 주소록에 담지 않는다.
 */
export function GiftAddressFields({ value, disabled, onChange, errors = {}, onSearched, idPrefix = 'gift-address' }: {
  value: CheckoutAddress; disabled: boolean; onChange: (value: CheckoutAddress) => void;
  errors?: CheckoutAddressErrors; onSearched?: (apartment: boolean) => void; idPrefix?: string;
}) {
  const field = (key: keyof CheckoutAddress, text: string) => onChange({ ...value, [key]: text });
  const id = (key: keyof CheckoutAddress) => `${idPrefix}-${key}`;
  const invalid = (key: keyof CheckoutAddressErrors) => ({ 'aria-invalid': Boolean(errors[key]), 'aria-describedby': errors[key] ? `${id(key)}-error` : undefined });
  const error = (key: keyof CheckoutAddressErrors) => errors[key] ? <small className="checkout-field-error" id={`${id(key)}-error`}>{errors[key]}</small> : null;
  return <fieldset className="wc-gifts__address" disabled={disabled}><legend>받을 배송지</legend>
    <label>받는 분<input id={id('recipientName')} required autoComplete="name" maxLength={50} {...invalid('recipientName')} value={value.recipientName} onChange={e => field('recipientName', e.target.value)} />{error('recipientName')}</label>
    <label>연락처<input id={id('phone')} required type="tel" autoComplete="tel" maxLength={20} {...invalid('phone')} value={value.phone} onChange={e => field('phone', e.target.value)} />{error('phone')}</label>
    <PostcodeField idPrefix={idPrefix} postalCode={value.postalCode} address1={value.address1} errors={{ postalCode: errors.postalCode, address1: errors.address1 }}
      failedMessage={GIFT_POSTCODE_FAILED_MESSAGE}
      onChange={(key, text) => field(key, text)}
      onSelect={({ postalCode, address1, apartment }) => {
        onChange({ ...value, postalCode, address1 });
        onSearched?.(apartment);
        focusCheckoutElementWhenReady(id('address2'));
      }} />
    <label className="wc-gifts__address-wide">상세 주소<input id={id('address2')} autoComplete="address-line2" maxLength={200} placeholder="예: 101동 1203호" {...invalid('address2')} value={value.address2 ?? ''} onChange={e => field('address2', e.target.value)} />{error('address2')}</label>
    <label className="wc-gifts__address-wide">배송 메모<input id={id('deliveryNote')} maxLength={200} {...invalid('deliveryNote')} value={value.deliveryNote ?? ''} onChange={e => field('deliveryNote', e.target.value)} />{error('deliveryNote')}</label>
  </fieldset>;
}
export function GiftRequestFeedback({ failure, blocked, pending, retry }: { failure: GiftFailure | null; blocked: boolean; pending: boolean; retry: () => void }) {
  if (blocked) return <p role="alert">로그인 계정이 바뀌었습니다. 화면을 새로 열어주세요.</p>;
  return <>{pending ? <p role="status">처리 중입니다.</p> : null}{failure ? <div role="alert"><p>{failure.error}</p>{failure.uncertain ? <button type="button" disabled={pending} onClick={retry}>같은 요청 결과 확인</button> : null}</div> : null}</>;
}
export function GiftEmpty({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="wc-gifts__empty"><h2>{title}</h2>{children}</section>;
}
