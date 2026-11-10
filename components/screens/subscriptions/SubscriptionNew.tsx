'use client';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MypageShell } from '@/components/wc/MypageShell';
import { GoodsCustomInputsFields } from '@/components/shop/GoodsCustomInputs';
import { SubscriptionAddressFields, SubscriptionRequestFeedback, SubscriptionScheduleFields, kstToday } from '@/components/subscriptions/SubscriptionParts';
import { useSubscriptionRequest, useSubscriptionUnsaved } from '@/components/subscriptions/useSubscriptionRequest';
import { prepareGoodsSubscriptionAction } from '@/app/my/subscriptions/actions';
import { prepareGoodsCustomInputSelection, goodsCustomInputValues } from '@/lib/goods-custom-inputs';
import type { Good } from '@/lib/data';
import type { CheckoutAddress } from '@/lib/checkout';
import type { SubscriptionOffer } from '@/lib/subscriptions/customer';
import type { SubscriptionSchedule } from '@/lib/subscriptions/schedule';
import type { UserCouponSummary } from '@/lib/coupons';
import { couponDisplayState, couponBenefitLabel } from '@/lib/coupons';
import { routes } from '@/lib/routes';

const EMPTY_ADDRESS: CheckoutAddress = { recipientName: '', phone: '', postalCode: '', address1: '', address2: '', deliveryNote: '' };
export function SubscriptionNew({ actorId, goods, offers, coupons, canEnroll, initialGoodId }: {
  actorId: string; goods: readonly Good[]; offers: readonly SubscriptionOffer[]; coupons: readonly UserCouponSummary[] | null; canEnroll: boolean; initialGoodId?: string;
}) {
  const eligible = goods.filter(good => offers.some(offer => offer.goodId === good.id));
  const initial = eligible.find(good => good.id === initialGoodId) ?? eligible[0], router = useRouter();
  const [goodId, setGoodId] = useState(initial?.id ?? ''), [variantId, setVariantId] = useState(initial?.options?.find(option => option.isDefault)?.id ?? initial?.options?.[0]?.id ?? '');
  const [qty, setQty] = useState(String(initial?.minOrderQty ?? 1)), [custom, setCustom] = useState<Record<string, string>>({}), [address, setAddress] = useState(EMPTY_ADDRESS);
  const [schedule, setSchedule] = useState<SubscriptionSchedule>(() => {
    const [unit, interval] = (offers.find(item => item.goodId === initial?.id)?.intervals[0] ?? 'month_1').split('_');
    return { unit: unit as 'month' | 'week', interval: Number(interval), anchorDate: kstToday(), time: '09:00', monthEnd: false };
  });
  const [coupon, setCoupon] = useState(''), [credit, setCredit] = useState('0'), [delivery, setDelivery] = useState<'prepaid' | 'collect'>('prepaid');
  const [error, setError] = useState(''), [created, setCreated] = useState(false);
  const lost = useCallback(() => { setAddress(EMPTY_ADDRESS); setCustom({}); setCoupon(''); setCredit('0'); }, []);
  const request = useSubscriptionRequest(actorId, lost), good = eligible.find(item => item.id === goodId), offer = offers.find(item => item.goodId === goodId);
  useSubscriptionUnsaved(!created && !request.blocked && (Boolean(address.recipientName || address.address1) || request.pending || Boolean(request.failure?.uncertain)));
  function selectGood(id: string) {
    const next = eligible.find(item => item.id === id), nextOffer = offers.find(item => item.goodId === id); if (!next || !nextOffer) return;
    setGoodId(id); setVariantId(next.options?.find(option => option.isDefault)?.id ?? next.options?.[0]?.id ?? ''); setCustom({}); setQty(String(next.minOrderQty ?? 1));
    const [unit, interval] = nextOffer.intervals[0].split('_'); setSchedule(previous => ({ ...previous, unit: unit as 'month' | 'week', interval: Number(interval), monthEnd: false }));
  }
  return <MypageShell active={routes.subscriptions()}><div className="wc-subscriptions"><header><Link href={routes.subscriptions()}>정기구매 내역</Link><h1>정기배송 신청</h1>
    <p>굿즈와 배송 주기를 정하고 첫 결제와 이후 결제 금액을 확인해 주세요.</p></header>
    {!canEnroll ? <section className="wc-subscriptions__card"><h2>지금은 새 정기구매를 신청할 수 없어요</h2><p>기존 정기구매와 결제카드는 내역에서 관리할 수 있습니다.</p></section>
      : !eligible.length ? <section className="wc-subscriptions__card"><h2>신청 가능한 굿즈가 없습니다</h2><Link href="/shop">굿즈 둘러보기</Link></section>
        : !request.blocked && <form className="wc-subscriptions__card" onSubmit={event => {
          event.preventDefault(); setError(''); if (!good || !offer) return;
          const selected = prepareGoodsCustomInputSelection(good.customInputs, custom); if (!selected.ok) { setError(selected.error); return; }
          const quantity = Number(qty), creditAmount = Number(credit);
          if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(creditAmount) || creditAmount < 0) { setError('수량과 적립금은 0 이상의 정수로 입력해주세요. 굿즈는 1개 이상 선택해야 합니다.'); return; }
          const interval = `${schedule.unit}_${schedule.interval}`; if (!offer.intervals.some(value => value === interval)) { setError('이 굿즈에서 제공하는 배송 주기를 선택해주세요.'); return; }
          const input = { expectedActorId: actorId, operationId: crypto.randomUUID(), selection: [{ goodId, variantId, qty: quantity,
            inputRevision: selected.selection?.revision ?? 0, inputValues: goodsCustomInputValues(selected.selection) }], address,
            schedule: { ...schedule, anchorDate: kstToday() }, deliveryChoices: good.transactionOffer?.delivery?.paymentMode === 'buyer_choice' ? { [goodId]: delivery } : {}, userCouponId: coupon || null, storeCreditAmount: creditAmount };
          request.run(() => prepareGoodsSubscriptionAction(input), plan => { setCreated(true); router.push(routes.subscription(plan.id)); });
        }}><fieldset disabled={request.locked}><legend>굿즈와 배송 정보</legend>
          <label>정기배송 굿즈<select value={goodId} onChange={event => selectGood(event.target.value)}>{eligible.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div className="wc-subscriptions__fields"><label>옵션<select value={variantId} onChange={event => setVariantId(event.target.value)} required>{good?.options?.map(option => <option key={option.id} value={option.id} disabled={option.supply?.mode === 'preorder'}>{option.name}</option>)}</select></label>
            <label>회차별 수량<input type="number" min={good?.minOrderQty ?? 1} max={good?.maxOrderQty ?? undefined} step={1} value={qty} required onChange={event => setQty(event.target.value)} /></label></div>
          {good && <GoodsCustomInputsFields goodId={good.id} config={good.customInputs} values={custom} onChange={(id, value) => setCustom(previous => ({ ...previous, [id]: value }))} />}
          {offer?.message && <p>{offer.message}</p>}
          <SubscriptionScheduleFields value={schedule} intervals={offer?.intervals} onChange={setSchedule} />
          <h2>받는 분과 배송지</h2><SubscriptionAddressFields value={address} onChange={setAddress} />
          {good?.transactionOffer?.delivery?.paymentMode === 'buyer_choice' ? <label>배송비 결제<select value={delivery} onChange={event => setDelivery(event.target.value as 'prepaid' | 'collect')}><option value="prepaid">선불</option><option value="collect">착불 · 수령 시 별도 납부</option></select></label>
            : <p>배송비: {good?.transactionOffer?.delivery?.paymentMode === 'collect' ? '착불 · 수령 시 별도 납부' : '온라인 선불 결제'}</p>}
          <h2>첫 회차 혜택</h2><div className="wc-subscriptions__fields"><label>보유 쿠폰<select value={coupon} onChange={event => setCoupon(event.target.value)} disabled={coupons === null}>
            <option value="">사용 안 함</option>{coupons?.filter(item => item.coupon.benefitKind !== 'shipping' && couponDisplayState(item) === 'usable').map(item => <option key={item.id} value={item.id}>{item.coupon.name} · {couponBenefitLabel(item.coupon)}</option>)}</select></label>
            <label>첫 회차에 사용할 적립금<input type="number" inputMode="numeric" min={0} step={1} value={credit} onChange={event => setCredit(event.target.value)} required /></label></div>
          {coupons === null && <p role="status">쿠폰을 불러오지 못했습니다. 쿠폰 없이 진행하거나 새로고침해 주세요.</p>}
          <p>쿠폰과 적립금은 첫 회차에만 적용합니다. 다음 회차는 쿠폰·적립금 없이 계산한 금액을 따로 보여드려요.</p>
          {error && <p role="alert">{error}</p>}<button type="submit" disabled={request.locked || !variantId}>결제 금액과 신청 내용 확인</button>
        </fieldset></form>}
    <SubscriptionRequestFeedback {...request} />
  </div></MypageShell>;
}
