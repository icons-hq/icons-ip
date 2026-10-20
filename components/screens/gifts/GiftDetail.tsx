'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { closeGiftAction, issueGiftLinkAction, placeGiftAction, quoteGiftAction, reloadGiftAction, updateGiftAddressAction } from '@/app/gifts/actions';
import { GiftClaims } from '@/components/gifts/GiftClaims';
import type { GiftClaimContext } from '@/lib/gift-claims';
import { MypageShell } from '@/components/wc/MypageShell';
import { EMPTY_GIFT_ADDRESS, GiftAddressFields, GiftItems, GiftRequestFeedback } from '@/components/gifts/GiftParts';
import { useGiftRequest, useGiftUnsaved } from '@/components/gifts/useGiftRequest';
import { GoodsTransactionSummary } from '@/components/checkout/GoodsTransactionSummary';
import { normalizeCheckoutAddress, type CheckoutPaymentMethod } from '@/lib/checkout';
import { couponDisplayState, type UserCouponSummary } from '@/lib/coupons';
import { giftInvitationUrl, giftStateLabel, type GiftDetail as GiftDetailValue } from '@/lib/gifts';
import type { GoodsTransactionQuote } from '@/lib/goods-transaction';
import { transactionIssueCopy } from '@/lib/checkout-transaction';
import { routes } from '@/lib/routes';
import { krw, krwAmountWords } from '@/lib/format';

function newGiftToken() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
export function GiftDetail({ actorId, initialGift, coupons, initialClaimContext }: { actorId: string; initialGift: GiftDetailValue; coupons: readonly UserCouponSummary[] | null; initialClaimContext: GiftClaimContext | null }) {
  const router = useRouter(), [gift, setGift] = useState(initialGift), [address, setAddress] = useState(initialGift.address ?? { ...EMPTY_GIFT_ADDRESS });
  const [link, setLink] = useState<string | null>(null), [copyStatus, setCopyStatus] = useState(''), [quote, setQuote] = useState<GoodsTransactionQuote | null>(null);
  const [couponId, setCouponId] = useState(''), [credit, setCredit] = useState('0'), [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>('card');
  const [quoteExpired, setQuoteExpired] = useState(false), [message, setMessage] = useState('');
  const lost = useCallback(() => { setGift(previous => ({ ...previous, senderLabel: '', recipientLabel: null, message: '', items: [], address: null, addressRevision: null, order: null, shipments: [] })); setAddress({ ...EMPTY_GIFT_ADDRESS }); setLink(null); setQuote(null); setCouponId(''); setCredit('0'); setMessage(''); }, []);
  const request = useGiftRequest(actorId, lost);
  const addressDirty = gift.isRecipient && gift.state === 'accepted' && JSON.stringify(address) !== JSON.stringify(gift.address);
  useGiftUnsaved(!request.blocked && (addressDirty || request.pending || Boolean(request.failure?.uncertain)));
  useEffect(() => {
    if (quote?.state !== 'quoted') return;
    const timeout = setTimeout(() => setQuoteExpired(true), Math.max(0, Date.parse(quote.expiresAt) - Date.now()));
    return () => clearTimeout(timeout);
  }, [quote]);
  const applyGift = (next: GiftDetailValue) => { setGift(next); setQuote(null); setMessage('처리 결과를 확인했습니다.'); if (next.state !== 'awaiting_acceptance') setLink(null); };
  const reload = () => request.recover(() => reloadGiftAction(gift.id, actorId), result => {
    applyGift(result.gift); if (!addressDirty) setAddress(result.gift.address ?? { ...EMPTY_GIFT_ADDRESS });
  });
  const receipt = gift.order;
  return <MypageShell active={routes.gifts()}><div className="wc-gifts"><header><Link href={routes.gifts()}>선물함</Link><h1>{request.blocked ? '선물 상세' : gift.party === 'sender' ? '보낸 선물' : `${gift.senderLabel}님의 선물`}</h1>
    <p>{giftStateLabel(gift.state, gift.order?.status)}</p></header>{!request.blocked ? <>
      <GiftItems items={gift.items} />{gift.message ? <blockquote>{gift.message}</blockquote> : null}
      {gift.party === 'sender' && gift.state === 'awaiting_acceptance' ? <section><h2>선물 링크 전달</h2><p>링크를 받은 사람이 로그인한 뒤 수락할 수 있어요. 필요한 사람에게만 전달해주세요.</p>
        <button type="button" disabled={request.locked} onClick={() => {
          const token = newGiftToken(), operationId = crypto.randomUUID(), revision = gift.revision;
          request.run(() => issueGiftLinkAction(gift.id, revision, token, operationId, actorId), result => {
            applyGift(result.gift); setLink(giftInvitationUrl(location.origin, token)); setCopyStatus('');
          });
        }}>{link ? '새 링크 발급' : '선물 링크 발급'}</button>
        {link ? <div className="wc-gifts__copy"><input aria-label="선물 링크" value={link} readOnly autoComplete="off" spellCheck={false} /><button type="button" onClick={() => { void navigator.clipboard.writeText(link).then(() => setCopyStatus('링크를 복사했습니다.'), () => setCopyStatus('링크를 선택한 뒤 직접 복사해주세요.')); }}>링크 복사</button><p role="status">{copyStatus}</p></div> : null}
        <p>새 링크를 발급하면 이전 링크는 사용할 수 없어요. 링크는 이 화면을 벗어나면 보관되지 않아요.</p></section> : null}
      {gift.isRecipient && gift.state === 'accepted' ? <section><h2>배송지 확인</h2><form onSubmit={event => {
        event.preventDefault(); const destination = normalizeCheckoutAddress(address); if (!destination) return;
        const operationId = crypto.randomUUID(), revision = gift.revision;
        request.run(() => updateGiftAddressAction(gift.id, revision, destination, operationId, actorId), result => { applyGift(result.gift); setAddress(result.gift.address ?? { ...EMPTY_GIFT_ADDRESS }); });
      }}><GiftAddressFields value={address} disabled={request.locked} onChange={setAddress} /><button type="submit" disabled={request.locked || !addressDirty}>배송지 변경</button></form><p>보낸 사람이 주문을 시작하기 전까지 변경할 수 있어요.</p></section> : null}
      {gift.party === 'sender' && gift.state === 'accepted' ? <section><h2>선물 결제</h2><p>{gift.recipientLabel}님이 수락하고 배송지를 입력했어요. 배송비는 보낸 사람이 결제해요.</p>
        <fieldset disabled={request.locked}><legend>결제 혜택</legend><label>쿠폰<select value={couponId} disabled={coupons === null} onChange={event => { setCouponId(event.target.value); setQuote(null); request.clear(); }}><option value="">사용 안 함</option>
          {(coupons ?? []).filter(row => couponDisplayState(row) === 'usable').map(row => <option key={row.id} value={row.id}>{row.coupon.name}</option>)}</select></label>
          {coupons === null ? <p>쿠폰을 불러오지 못했어요. 잠시 후 화면을 다시 열어주세요.</p> : null}
          <label>사용할 적립금<input type="number" min={0} step={1} inputMode="numeric" value={credit} onChange={event => { setCredit(event.target.value); setQuote(null); request.clear(); }} /></label>
          <button type="button" onClick={() => {
            const amount = Number(credit); if (!Number.isSafeInteger(amount) || amount < 0) return;
            const revision = gift.revision, coupon = couponId || null;
            request.run(() => quoteGiftAction(gift.id, revision, coupon, amount, actorId), result => { setQuote(result.quote); setQuoteExpired(false); setMessage(''); });
          }}>최종 결제금액 확인</button></fieldset>
        {quote?.state === 'blocked' ? <ul role="alert">{quote.issues.map((issue, index) => <li key={`${issue.code}:${index}`}>{transactionIssueCopy[issue.code]}</li>)}</ul> : null}
        {quote?.state === 'quoted' ? <><GoodsTransactionSummary display={quote.display} names={Object.fromEntries(gift.items.map(item => [item.goodId, item.name]))} /><p>사용 가능한 적립금: {krw(quote.display.storeCreditMaximum)}</p>
          <fieldset disabled={request.locked || quoteExpired}><legend>결제수단</legend>{quote.display.paymentMethods.card ? <label className="wc-gifts__check"><input type="radio" name="gift-payment" checked={paymentMethod === 'card'} onChange={() => setPaymentMethod('card')} />카드 결제</label> : null}
            {quote.display.paymentMethods.bankTransfer ? <label className="wc-gifts__check"><input type="radio" name="gift-payment" checked={paymentMethod === 'bank_transfer'} onChange={() => setPaymentMethod('bank_transfer')} />무통장 입금</label> : null}
            <button type="button" disabled={paymentMethod === 'card' ? !quote.display.paymentMethods.card : !quote.display.paymentMethods.bankTransfer} onClick={() => {
              const quoteId = quote.quoteId, checkoutKey = crypto.randomUUID(), method = paymentMethod;
              request.run(() => placeGiftAction(gift.id, quoteId, checkoutKey, method, actorId), result => { setQuote(null); router.push(`/checkout/${result.orderId}`); });
            }}>{krwAmountWords(quote.display.totals.onlineTotal)} 결제 진행</button></fieldset>
          {quoteExpired ? <p role="status">견적 시간이 지났어요. 최종 결제금액을 다시 확인해주세요.</p> : <p>결제를 진행할 때 가격·재고·배송지를 한 번 더 확인해요.</p>}</> : null}
      </section> : null}
      {receipt ? <section><h2>주문 진행</h2><p>{({ pending: '결제 대기', paid: '결제 완료', confirmed: '굿즈 준비', shipping: '배송 중', delivered: '배송 완료', done: '주문 완료', canceled: '취소' } as Record<string, string>)[receipt.status]}</p>
        {gift.party === 'sender' ? <><p>결제금액 {krw(receipt.total ?? 0)}</p><Link href={receipt.status === 'pending' ? `/checkout/${receipt.id}` : `/orders/${receipt.id}`}>{receipt.status === 'pending' ? '결제 이어가기' : '결제·취소 내역 확인'}</Link></> : <p>취소·반품으로 발생한 환불금은 보낸 사람에게 돌아가요.</p>}
        {gift.isRecipient && gift.address ? <address>{gift.address.recipientName} · {gift.address.phone}<br />({gift.address.postalCode}) {gift.address.address1} {gift.address.address2}<br />{gift.address.deliveryNote}</address> : null}
        <ul>{gift.shipments.map(shipment => <li key={shipment.id}>{({ ready: '배송 준비', shipping: '배송 중', delivered: '배송 완료', canceled: '취소' })[shipment.status]}{shipment.expectedShipDate ? ` · 발송 예정 ${shipment.expectedShipDate}` : ''}{gift.isRecipient && shipment.trackingNumber ? <p>{shipment.carrier} · {shipment.trackingNumber}</p> : null}</li>)}</ul>
      </section> : null}
      {initialClaimContext ? <GiftClaims actorId={actorId} orderId={receipt?.id} initialContext={initialClaimContext} /> : null}
      {['awaiting_acceptance', 'accepted'].includes(gift.state) ? <section><h2>선물 관리</h2><button type="button" disabled={request.locked} onClick={() => {
        if (!confirm('이 선물을 취소할까요? 아직 결제된 금액은 없어요.')) return;
        const operationId = crypto.randomUUID(), revision = gift.revision;
        request.run(() => closeGiftAction(gift.id, revision, operationId, actorId), result => { applyGift(result.gift); setAddress({ ...EMPTY_GIFT_ADDRESS }); });
      }}>선물 취소</button></section> : null}
      <button type="button" disabled={request.pending || Boolean(request.failure?.uncertain)} onClick={reload}>최신 상태 확인</button>
      {message ? <p role="status">{message}</p> : null}
    </> : null}<GiftRequestFeedback {...request} /></div></MypageShell>;
}
