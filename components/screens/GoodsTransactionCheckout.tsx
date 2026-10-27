'use client';
import { couponBenefitLabel, couponDisplayState, type UserCouponSummary } from '@/lib/coupons';
import type { CouponCombinationPolicy } from '@/lib/coupon-combinations';
import { FULFILLMENT_METHOD_LABELS, fulfillmentNeedsAddress, type FulfillmentMethod } from '@/lib/goods-fulfillment';
import type { GoodsTransactionOffer } from '@/lib/goods-transaction-offers';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { placeCartTransactionAction, resumeCartTransactionAction, type CartTransactionError, type CartTransactionPlaceResult } from '@/app/checkout/transaction-actions';
import { PostcodeField } from '@/components/checkout/PostcodeField';
import { GoodsTransactionSummary } from '@/components/checkout/GoodsTransactionSummary';
import { useCartTransactionQuote } from '@/components/checkout/useCartTransactionQuote';
import { useCart, useReleaseUnpaidCartOrders } from '@/components/shell/CartProvider';
import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { cartItemKey, type CartItem } from '@/lib/cart';
import type { CatalogSnapshot } from '@/lib/catalog';
import { bankTransferMethodNote, checkoutAddressErrors, type CheckoutAddress, type CheckoutPaymentMethod } from '@/lib/checkout';
import { orderCompleteHref } from '@/lib/routes';
import { cartTransactionRequestTooLarge, parseCartTransactionInput, parseCartTransactionRecovery, transactionIssueCopy, type CartTransactionRecovery, type CheckoutDeliveryChoices } from '@/lib/checkout-transaction';
import { krw } from '@/lib/format';
import type { GoodsTransactionDisplay } from '@/lib/goods-transaction';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { paymentFailNoticeCopy } from '@/lib/payments/checkout-fail-copy';
import { createClient } from '@/lib/supabase/client';
import { normalizeStoreCreditAmount } from '@/lib/store-credits';

export const cartTransactionErrorCopy: Record<CartTransactionError, string> = {
  order_too_large: '한 번에 처리할 수 있는 주문 정보 크기를 초과했어요. 장바구니 품목을 나누어 주문해주세요.',
  checkout_unavailable: '주문 환경을 확인 중이에요. 새로고침 후 다시 확인해주세요.',
  invalid_request: '주문 정보를 다시 확인해주세요.', auth_changed: '로그인 계정이 바뀌었어요. 새로고침 후 다시 확인해주세요.',
  account_unavailable: '현재 계정으로 새 주문을 만들 수 없어요.', payment_unavailable: '선택한 결제수단을 현재 사용할 수 없어요.',
  cart_changed: '장바구니가 변경되었어요. 최신 품목과 수량을 확인해주세요.', coupon_changed: '선택한 쿠폰이 변경되었어요. 장바구니에서 다시 확인해주세요.',
  quote_changed: '가격이나 배송 조건이 변경되었어요. 새로 확인한 금액으로 다시 주문해주세요.',
  checkout_conflict: '이미 요청한 주문을 확인해주세요. 같은 요청으로 다른 주문을 만들 수 없어요.', unavailable: '주문을 확인하지 못했어요. 잠시 후 다시 시도해주세요.',
  payment_in_progress: '앞서 결제한 주문의 승인 결과를 확인하고 있어요. 확인이 끝난 뒤 다시 시도해주세요.',
};

interface Props {
  accountId: string; catalog: Pick<CatalogSnapshot, 'goods' | 'ips'>; latestAddress: CheckoutAddress | null;
  paymentAvailable: boolean; bankTransferAvailable: boolean; resumeOrderId: string | null;
  coupons?: UserCouponSummary[]; couponPolicy?: CouponCombinationPolicy | null;
  userCouponId: string | null; paymentFailCode?: string | null;
}

export function GoodsTransactionCheckout({ accountId, catalog, latestAddress, paymentAvailable, bankTransferAvailable, resumeOrderId, userCouponId, coupons = [], couponPolicy, paymentFailCode }: Props) {
  const router = useRouter(), cart = useCart();
  /* 결제를 마치지 않은 이전 장바구니 주문이 쿠폰·적립금·구매 한도를 잡고 있으면 견적 전에 닫는다(ADR-0026). */
  const released = useReleaseUnpaidCartOrders();
  const [address, setAddress] = useState<CheckoutAddress>(latestAddress ?? { recipientName: '', phone: '', postalCode: '', address1: '', address2: '', deliveryNote: '' });
  const [selectedCoupons, setSelectedCoupons] = useState<string[]>(userCouponId ? [userCouponId] : []), [shippingCoupon, setShippingCoupon] = useState('');
  const [verifiedOffers, setVerifiedOffers] = useState<GoodsTransactionOffer[]>([]);
  const [creditInput, setCreditInput] = useState(''), [choices, setChoices] = useState<CheckoutDeliveryChoices>({});
  const [method, setMethod] = useState<CheckoutPaymentMethod>(paymentAvailable || !bankTransferAvailable ? 'card' : 'bank_transfer');
  const [session, setSession] = useState<string | null>(null), [authBlocked, setAuthBlocked] = useState(false);
  const [recovery, setRecovery] = useState<CartTransactionRecovery | null>(null), [frozen, setFrozen] = useState<{ display: GoodsTransactionDisplay; items: CartItem[] } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lane = useRef(false), epoch = useRef(0), storageKey = `icons.cart-order-recovery.v1:${accountId}`;
  const names = useMemo(() => Object.fromEntries(catalog.goods.map(good => [good.id, good.name])), [catalog.goods]);
  useEffect(() => {
    const authenticationEpoch = epoch;
    let active = true, currentSession: string | null = null, blocked = false;
    const invalidate = () => {
      if (!active || blocked) return; blocked = true; authenticationEpoch.current++; setSession(null); setAuthBlocked(true); setRecovery(null); setFrozen(null);
      setAddress({ recipientName: '', phone: '', postalCode: '', address1: '' }); setCreditInput(''); setChoices({}); setSelectedCoupons([]); setShippingCoupon('');
      try { sessionStorage.removeItem(storageKey); } catch { /* no browser persistence */ }
    };
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, invalidate);
    const { data } = createClient().auth.onAuthStateChange((_event, value) => {
      if (!active || blocked) return;
      const id = value ? inquiryDraftSessionId(value.access_token) : null;
      if (value?.user.id !== accountId || !id || currentSession !== null && currentSession !== id) { invalidate(); return; }
      if (currentSession === null) {
        currentSession = id; setSession(id);
        try {
          const saved = parseCartTransactionRecovery(JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'));
          if (saved?.expectedActorId === accountId && saved.sessionId === id) setRecovery(saved);
          else sessionStorage.removeItem(storageKey);
        } catch { /* storage can be disabled; no private fields are stored */ }
      }
    });
    return () => { active = false; authenticationEpoch.current++; data.subscription.unsubscribe(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, invalidate); };
  }, [accountId, storageKey]);
  useEffect(() => {
    if (!recovery) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect);
  }, [recovery]);
  const selectedGoods = new Set(cart.items.map(item => item.goodId));
  const offers = [...selectedGoods].flatMap(id => {
    const offer = verifiedOffers.find(o => o.goodId === id) ?? catalog.goods.find(g => g.id === id)?.transactionOffer;
    return offer ? [offer] : [];
  });
  const currentChoices: CheckoutDeliveryChoices = Object.fromEntries([...selectedGoods].map(id => {
    const offer = offers.find(o => o.goodId === id), selected = choices[id];
    const methods = offer?.fulfillment?.methods ?? [{ method: 'parcel' as const }];
    const method = typeof selected === 'object' && methods.some(m => m.method === selected.method) ? selected.method : methods[0].method;
    const paymentMode = method !== 'parcel' ? 'prepaid' : typeof selected === 'object' ? selected.paymentMode : selected ?? (offer?.delivery?.paymentMode === 'collect' ? 'collect' : 'prepaid');
    return [id, { method, paymentMode }];
  }));
  const needsAddress = Object.values(currentChoices).some(choice => typeof choice === 'string' || fulfillmentNeedsAddress(choice.method));
  const amount = normalizeStoreCreditAmount(creditInput);
  const combinedIds = [...selectedCoupons, ...(shippingCoupon ? [shippingCoupon] : [])];
  const rawInput = { expectedActorId: accountId, items: cart.items, address: needsAddress ? address : { kind: 'none' }, deliveryChoices: currentChoices, userCouponId: couponPolicy ? combinedIds[0] ?? null : userCouponId, ...(couponPolicy ? { userCouponIds: combinedIds } : {}), storeCreditAmount: amount };
  const input = parseCartTransactionInput(rawInput), tooLarge = cartTransactionRequestTooLarge(rawInput);
  const quotes = useCartTransactionQuote(input, Boolean(session && !authBlocked && cart.ready && cart.mode === 'server' && !cart.pending && released), busy || recovery !== null, setVerifiedOffers);
  const quote = quotes.result?.ok ? quotes.result.quote : null;
  const currentDisplay = quote?.state === 'quoted' ? quote.display : null, display = recovery ? frozen?.display : currentDisplay;
  const visibleItems = recovery ? frozen?.items ?? [] : cart.items;
  const selectable = { card: paymentAvailable && currentDisplay?.paymentMethods.card === true, bank_transfer: bankTransferAvailable && currentDisplay?.paymentMethods.bankTransfer === true };
  const effectiveMethod = selectable[method] ? method : selectable.card ? 'card' : selectable.bank_transfer ? 'bank_transfer' : method;
  const canSubmit = Boolean(session && !authBlocked && input && quote?.state === 'quoted' && selectable[effectiveMethod] && !cart.pending && !busy && !recovery);
  const addressErrors = needsAddress ? checkoutAddressErrors(address) : {};

  function remember(value: CartTransactionRecovery | null) {
    setRecovery(value);
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* server receipt remains recoverable from order history */ }
  }
  async function acceptResult(result: CartTransactionPlaceResult, capturedEpoch: number, paymentMethod: CheckoutPaymentMethod) {
    if (capturedEpoch !== epoch.current) return;
    if (result.ok) {
      remember(null); setFrozen(null);
      /* 카드는 결제 화면이 바로 결제를 준비하고(S8) 장바구니는 결제 확정까지 남는다. 무통장은 접수가 곧
         주문 완료라 완료 화면에서 입금 안내를 본다(D12). */
      const next = paymentMethod === 'bank_transfer' ? orderCompleteHref(result.orderId) : `/checkout/${result.orderId}`;
      try { await cart.refresh(); } finally { if (capturedEpoch === epoch.current) router.push(next); }
      return;
    }
    if (result.uncertain) setError('주문 생성 결과를 확인 중이에요. 아래 버튼으로 같은 주문을 다시 확인해주세요.');
    else {
      remember(null); setFrozen(null); setError(cartTransactionErrorCopy[result.error]); quotes.refresh();
      if (result.error === 'cart_changed') await cart.refresh();
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !input || !session || quote?.state !== 'quoted' || lane.current) return;
    if (Date.parse(quote.expiresAt) <= Date.now()) { quotes.refresh(); setError(cartTransactionErrorCopy.quote_changed); return; }
    lane.current = true; setBusy(true); setError(''); const capturedEpoch = epoch.current;
    const marker: CartTransactionRecovery = { version: 1, expectedActorId: accountId, sessionId: session, quoteId: quote.quoteId, checkoutKey: crypto.randomUUID(), paymentMethod: effectiveMethod };
    remember(marker); setFrozen({ display: quote.display, items: input.items });
    try { await acceptResult(await placeCartTransactionAction({ ...input, quoteId: marker.quoteId, checkoutKey: marker.checkoutKey, paymentMethod: marker.paymentMethod }), capturedEpoch, marker.paymentMethod); }
    catch { if (capturedEpoch === epoch.current) setError('주문 생성 결과를 확인하지 못했어요. 같은 주문 다시 확인을 눌러주세요.'); }
    finally { lane.current = false; if (capturedEpoch === epoch.current) setBusy(false); }
  }
  async function resume() {
    if (!recovery || !session || authBlocked || lane.current) return;
    lane.current = true; setBusy(true); setError(''); const capturedEpoch = epoch.current;
    try { await acceptResult(await resumeCartTransactionAction(recovery), capturedEpoch, recovery.paymentMethod); }
    catch { if (capturedEpoch === epoch.current) setError('주문 결과를 확인하지 못했어요. 잠시 후 같은 주문을 다시 확인해주세요.'); }
    finally { lane.current = false; if (capturedEpoch === epoch.current) setBusy(false); }
  }

  if (authBlocked) return <main className="wc-root checkout-page"><div className="wrap card"><h1>로그인 상태를 다시 확인해주세요</h1><p>{cartTransactionErrorCopy.auth_changed}</p><button type="button" className="btn btn-holo" onClick={() => window.location.reload()}>새로고침</button></div></main>;
  if (!session || !cart.ready || !released) return <main className="wc-root checkout-page"><p className="wrap" role="status">계정과 장바구니를 확인하고 있어요.</p></main>;
  if (cart.mode !== 'server') return <main className="wc-root checkout-page"><div className="wrap card"><h1>장바구니를 계정에 연결해주세요</h1><p>{cart.error}</p><button type="button" onClick={() => void cart.refresh()}>다시 연결</button></div></main>;
  if (!cart.items.length && !recovery) return <main className="wc-root checkout-page"><div className="wrap card"><h1>{resumeOrderId ? '진행 중인 주문이 있어요' : '주문할 굿즈가 없어요'}</h1>{resumeOrderId && <><p>결제를 기다리거나 입금을 기다리는 주문이 있어요. 이어서 결제하거나 입금 안내를 확인할 수 있어요.</p><Link className="btn btn-holo" href={`/checkout/${resumeOrderId}`}>주문 이어가기</Link></>}<Link href="/cart">장바구니로 돌아가기</Link></div></main>;

  return <main className="wc-root wc-receipt checkout-page">
    <header className="wc-receipt__head"><div className="wrap"><h1 className="wc-receipt__title">받을 방식과 최종 결제금액을 확인해주세요</h1><p className="wc-receipt__subcopy">복수구매 할인, 쿠폰, 적립금과 배송비를 함께 확인합니다.</p>{paymentFailCode && <p role="alert">{paymentFailNoticeCopy(paymentFailCode)}</p>}</div></header>
    <form className="wrap checkout-layout" onSubmit={submit} aria-busy={busy}>
      <section className="checkout-form card" aria-labelledby="transaction-address-title">
        <h2 id="transaction-address-title">받을 방식과 배송지</h2>
        {recovery && <p>앞서 요청한 주문의 배송지는 서버에 보관되어 있습니다. 같은 주문을 다시 확인한 뒤 주문서에서 확인해주세요.</p>}
        <fieldset hidden={recovery !== null} disabled={busy || recovery !== null} className="checkout-transaction-fields">{needsAddress ? <div className="checkout-fields">
          {(['recipientName', 'phone'] as const).map(field => <label key={field}><span>{field === 'recipientName' ? '받는 분' : '연락처'}</span><input required id={`checkout-${field}`} autoComplete={field === 'recipientName' ? 'name' : 'tel'} maxLength={field === 'recipientName' ? 50 : 20} value={address[field]} onChange={event => setAddress(value => ({ ...value, [field]: event.target.value }))} /></label>)}
          <PostcodeField value={address.postalCode} onChange={postalCode => setAddress(value => ({ ...value, postalCode }))} onSelect={({ postalCode, address1 }) => setAddress(value => ({ ...value, postalCode, address1 }))} />
          {(['address1', 'address2', 'deliveryNote'] as const).map(field => <label className="checkout-field--wide" key={field}><span>{{ address1: '기본 주소', address2: '상세 주소 · 선택', deliveryNote: '배송 메모 · 선택' }[field]}</span><input id={`checkout-${field}`} required={field === 'address1'} autoComplete={field === 'address1' ? 'address-line1' : field === 'address2' ? 'address-line2' : 'off'} maxLength={200} value={address[field] ?? ''} onChange={event => setAddress(value => ({ ...value, [field]: event.target.value }))} /></label>)}
        </div> : <p>선택한 수령 방식에는 배송 주소를 입력하지 않습니다. 디지털 파일은 결제가 확인된 주문자의 계정에서 받을 수 있습니다.</p>}
        {Object.keys(addressErrors).length > 0 && <p>받는 분, 연락처, 우편번호와 기본 주소를 입력하면 최종 금액을 확인할 수 있어요.</p>}
        {offers.filter(offer => selectedGoods.has(offer.goodId)).map(offer => {
          const choice = currentChoices[offer.goodId];
          const selectedMethod = typeof choice === 'object' ? choice.method : 'parcel';
          const selectedPayment = typeof choice === 'object' ? choice.paymentMode : choice ?? 'prepaid';
          return <div key={offer.goodId}>
            {offer.fulfillment ? <label className="checkout-transaction-choice">{names[offer.goodId] ?? '굿즈'} 받을 방식<select value={selectedMethod} onChange={event => setChoices(value => ({ ...value, [offer.goodId]: { method: event.target.value as FulfillmentMethod, paymentMode: event.target.value === 'parcel' ? selectedPayment : 'prepaid' } }))}>
              {offer.fulfillment.methods.map(m => <option key={m.method} value={m.method}>{FULFILLMENT_METHOD_LABELS[m.method]}{m.feeAmount !== null && m.feeAmount > 0 ? ` · ${krw(m.feeAmount)} / ${m.feeBasis === 'per_item' ? '개' : '굿즈별 주문'}` : ''}</option>)}
            </select></label> : null}
            {selectedMethod === 'parcel' && offer.delivery?.paymentMode === 'buyer_choice' ? <label className="checkout-transaction-choice">{names[offer.goodId] ?? '굿즈'} 배송비 결제방법<select value={selectedPayment} onChange={event => setChoices(value => ({ ...value, [offer.goodId]: { method: selectedMethod, paymentMode: event.target.value as 'prepaid' | 'collect' } }))}><option value="prepaid">선불 · 주문할 때 결제</option><option value="collect" disabled={!offer.collectReady}>착불 · 받을 때 결제</option></select></label> : null}
            {offer.fulfillment?.publicNote ? <p>{offer.fulfillment.publicNote}</p> : null}
            {selectedMethod === 'digital' ? <p>파일을 처음 제공한 시점을 기록합니다. 다운로드를 시작한 주문의 취소 요청은 담당자가 검토합니다.</p> : null}
          </div>;
        })}
        {couponPolicy ? <fieldset className="checkout-coupon-selection"><legend>쿠폰 선택</legend>
          <p>굿즈 쿠폰은 위에서부터 남은 굿즈 금액에 적용합니다. 배송비 쿠폰은 선결제 운송비만 할인하며 설치비·착불 비용은 제외합니다.</p>
          {Array.from({ length: couponPolicy.stackingEnabled ? couponPolicy.maxGoodsCoupons : 1 }, (_, index) => <label className="checkout-transaction-choice" key={index}>굿즈 쿠폰 {index + 1}<select aria-label={`굿즈 쿠폰 ${index + 1}`} value={selectedCoupons[index] ?? ''} onChange={e => setSelectedCoupons(current => { const next = [...current]; next[index] = e.target.value; return next.filter(Boolean); })}>
            <option value="">사용 안 함</option>{coupons.filter(held => held.coupon.benefitKind !== 'shipping' && (couponDisplayState(held) === 'usable' || selectedCoupons.includes(held.id))).map(held => <option key={held.id} value={held.id} disabled={selectedCoupons.includes(held.id) && selectedCoupons[index] !== held.id}>{held.coupon.name} · {couponBenefitLabel(held.coupon)}{held.coupon.stackable ? ' · 중복 허용' : ' · 단독 사용'}</option>)}
          </select></label>)}
          {couponPolicy.shippingEnabled ? <label className="checkout-transaction-choice">배송비 쿠폰<select aria-label="배송비 쿠폰" value={shippingCoupon} onChange={e => setShippingCoupon(e.target.value)}><option value="">사용 안 함</option>{coupons.filter(held => held.coupon.benefitKind === 'shipping' && (couponDisplayState(held) === 'usable' || held.id === shippingCoupon)).map(held => <option key={held.id} value={held.id}>{held.coupon.name} · {couponBenefitLabel(held.coupon)}{held.coupon.stackable ? ' · 중복 허용' : ' · 단독 사용'}</option>)}</select></label> : null}
          <p>{couponPolicy.stackingEnabled ? '선택한 모든 쿠폰이 중복 사용을 허용해야 함께 적용할 수 있습니다.' : '현재는 굿즈 쿠폰 또는 배송비 쿠폰 1장만 사용할 수 있습니다.'} 대상 굿즈·최소 구매 금액·사용기간은 최종 금액 확인 시 검사합니다.</p>
          {combinedIds.length ? <button type="button" onClick={() => { setSelectedCoupons([]); setShippingCoupon(''); }}>쿠폰 선택 모두 해제</button> : null}
        </fieldset> : coupons.length ? <p>쿠폰 조합 정책을 확인하지 못했습니다. 장바구니에서 선택한 굿즈 쿠폰 1장을 확인합니다.</p> : null}
        <label className="checkout-transaction-choice">사용할 적립금<input inputMode="numeric" value={creditInput} onChange={event => setCreditInput(event.target.value)} placeholder="0" aria-invalid={amount === null} /></label>
        {amount === null && <p role="alert">적립금은 0 이상의 원 단위 정수로 입력해주세요.</p>}
        {currentDisplay && <p>이 주문에서 최대 {krw(currentDisplay.storeCreditMaximum)} 사용 가능</p>}
        </fieldset>
      </section>
      <aside className="checkout-receipt card" aria-label="주문 내역과 결제금액">
        <h2>주문 내역</h2><div className="checkout-items">{visibleItems.map(item => {
          const price = display?.lines.find(line => line.goodId === item.goodId && line.variantId === item.variantId)?.unitPrice;
          return <div className="checkout-item" key={cartItemKey(item.goodId, item.variantId, item.customInputs)}><div><strong>{names[item.goodId] ?? '굿즈'}</strong><span>{catalog.goods.find(good => good.id === item.goodId)?.options?.find(option => option.id === item.variantId)?.name}</span><GoodsCustomInputsSummary selection={item.customInputs} /></div><span>{item.qty}개{price !== undefined ? ` × ${krw(price)}` : ''}</span></div>;
        })}</div>
        {display && <GoodsTransactionSummary display={display} names={names} />}
        {quotes.loading && <p role="status">할인과 배송비를 확인하고 있어요.</p>}
        {!input && !recovery && <p role={tooLarge ? 'alert' : undefined}>{tooLarge ? cartTransactionErrorCopy.order_too_large : '수령 방식과 필요한 배송지·적립금 입력을 완료하면 최종 금액을 표시합니다.'}</p>}
        {quote?.state === 'blocked' && !recovery && <div role="alert">{quote.issues.map((issue, index) => <p key={`${issue.code}:${issue.goodId}:${index}`}>{issue.goodId ? `${names[issue.goodId] ?? '굿즈'}: ` : ''}{transactionIssueCopy[issue.code]}</p>)}</div>}
        {quotes.result && !quotes.result.ok && !recovery && <p role="alert">{cartTransactionErrorCopy[quotes.result.error]}</p>}
        {quotes.result && !quotes.result.ok && quotes.result.error === 'cart_changed' && !recovery && <button type="button" onClick={() => void cart.refresh()}>장바구니 새로 불러오기</button>}
        {quotes.result && !quotes.result.ok && quotes.result.error === 'coupon_changed' && !recovery && <button type="button" onClick={() => router.refresh()}>현재 쿠폰 다시 확인</button>}
        {!recovery && <>
          {/* legacy 주문서와 같은 결제수단 선택지 마크업·스타일을 쓴다 — 사유 문구가 선택지 이름과 붙지 않게(10/14 S26). */}
          <fieldset disabled={busy} className="checkout-method"><legend>결제수단</legend>{(['card', 'bank_transfer'] as const).map(value => <label className="checkout-method-option" key={value}><input type="radio" name="paymentMethod" value={value} checked={effectiveMethod === value} disabled={!selectable[value]} onChange={() => setMethod(value)} />
            <span>
              <strong>{value === 'card' ? '카드' : '무통장 입금'}</strong>
              {/* 두 주문서가 같은 사유 문구를 쓴다(S26). */}
              {value === 'bank_transfer' && <small>{bankTransferMethodNote({ accountConfigured: bankTransferAvailable, goodsAllow: currentDisplay ? currentDisplay.paymentMethods.bankTransfer : null })}</small>}
            </span>
          </label>)}</fieldset>
          <button type="button" className="btn btn-ghost" disabled={!input || busy || cart.pending} onClick={quotes.refresh}>금액 다시 확인</button>
          <button className="btn btn-holo checkout-submit" disabled={!canSubmit}>{busy ? '주문 확인 중' : effectiveMethod === 'bank_transfer' ? '주문하고 입금 안내 받기' : '결제하기'}</button>
        </>}
        {recovery && <section aria-label="주문 요청 복구"><p>앞서 요청한 주문을 확인한 뒤 진행해주세요.</p><button type="button" className="btn btn-holo" disabled={busy} onClick={() => void resume()}>{busy ? '같은 주문 확인 중' : '같은 주문 다시 확인'}</button><Link href="/orders?pending=1">진행 중인 주문 보기</Link></section>}
        {error && <p className="checkout-error" role="alert">{error}</p>}<Link href="/cart">장바구니 확인</Link>
      </aside>
    </form>
  </main>;
}
