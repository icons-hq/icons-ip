'use client';
import Link from 'next/link';
import { useCallback, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createGiftAction } from '@/app/gifts/actions';
import { useCart } from '@/components/shell/CartProvider';
import { MypageShell } from '@/components/wc/MypageShell';
import { GiftEmpty, GiftRequestFeedback } from '@/components/gifts/GiftParts';
import { useGiftRequest, useGiftUnsaved } from '@/components/gifts/useGiftRequest';
import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { cartItemKey } from '@/lib/cart';
import type { Good } from '@/lib/data';
import { giftSelectionFromCart, GIFT_MESSAGE_LIMIT, GIFT_RANDOM_OPTION_UNSUPPORTED_MESSAGE } from '@/lib/gifts';
import { routes } from '@/lib/routes';

export function GiftNew({ actorId, goods, available }: { actorId: string; goods: readonly Good[]; available: boolean }) {
  const cart = useCart(), router = useRouter(), reasonId = useId();
  /* 선물은 랜덤 판매 굿즈를 받지 않는다(ADR-0027 · m27 CUST-1) — 줄은 보이되 고를 수 없게 두고 이유를 말한다. */
  const giftable = (goodId: string) => goods.find(row => row.id === goodId)?.optionSaleMode !== 'random';
  const [selected, setSelected] = useState<Record<string, string>>({}), [message, setMessage] = useState(''), [created, setCreated] = useState(false);
  const lost = useCallback(() => { setSelected({}); setMessage(''); }, []);
  const request = useGiftRequest(actorId, lost);
  const selectedItems = cart.items.filter(item => giftable(item.goodId) && Object.hasOwn(selected, cartItemKey(item.goodId, item.variantId, item.customInputs)))
    .map(item => ({ ...item, qty: Number(selected[cartItemKey(item.goodId, item.variantId, item.customInputs)]) }));
  const invalidSelection = selectedItems.some(item => !Number.isSafeInteger(item.qty) || item.qty < 1);
  useGiftUnsaved(!created && !request.blocked && (selectedItems.length > 0 || Boolean(message) || request.pending || Boolean(request.failure?.uncertain)));
  return <MypageShell active={routes.gifts()}><div className="wc-gifts"><header><Link href={routes.gifts()}>선물함</Link><h1>선물 준비</h1>
    <p>장바구니에서 선물할 굿즈를 골라주세요. 받는 사람이 수락하고 배송지를 입력하면 결제할 수 있어요.</p></header>
    {!available ? <GiftEmpty title="지금은 새 선물을 준비할 수 없어요"><Link href={routes.gifts()}>기존 선물 확인</Link></GiftEmpty> : request.blocked ? <GiftRequestFeedback {...request} /> :
      !cart.ready ? <p role="status">장바구니를 확인하고 있어요.</p> : cart.items.length === 0 ? <GiftEmpty title="장바구니에 굿즈를 담아주세요"><Link href={'/shop'}>굿즈 둘러보기</Link></GiftEmpty> :
      <form onSubmit={event => {
        event.preventDefault(); const selection = giftSelectionFromCart(selectedItems); if (!selection) return;
        const id = crypto.randomUUID(), operationId = crypto.randomUUID();
        request.run(() => createGiftAction(id, selection, message, operationId, actorId), result => { setCreated(true); router.push(routes.gift(result.gift.id)); });
      }}><fieldset disabled={request.locked}><legend>선물할 굿즈</legend><ul className="wc-gifts__selection">{cart.items.map((item, index) => {
        const key = cartItemKey(item.goodId, item.variantId, item.customInputs), good = goods.find(row => row.id === item.goodId);
        const option = good?.options?.find(row => row.id === item.variantId), random = good?.optionSaleMode === 'random', chosen = !random && Object.hasOwn(selected, key);
        return <li key={key}><label><input type="checkbox" checked={chosen} disabled={!good || random} aria-describedby={random ? `${reasonId}-${index}` : undefined}
          onChange={event => setSelected(previous => { const next = { ...previous }; if (event.target.checked) next[key] = String(item.qty); else delete next[key]; return next; })} />{good?.name ?? '판매 종료된 굿즈'}{option?.name ? ` · ${option.name}` : ''}</label>
          {random ? <p id={`${reasonId}-${index}`}>{GIFT_RANDOM_OPTION_UNSUPPORTED_MESSAGE}</p> : null}
          <GoodsCustomInputsSummary selection={item.customInputs} />{chosen ? <label>선물 수량<input aria-label={`${good?.name ?? '굿즈'} 선물 수량`} type="number" inputMode="numeric" min={1} max={item.qty} required value={selected[key]}
            onChange={event => setSelected(previous => ({ ...previous, [key]: event.target.value }))} /></label> : null}</li>;
      })}</ul><label>선물 메시지<textarea maxLength={GIFT_MESSAGE_LIMIT} rows={4} value={message} onChange={event => setMessage(event.target.value)} /></label>
      <p>한 선물에는 굿즈·옵션 조합을 최대 100개까지 선택할 수 있어요.</p>
      <p>선택한 굿즈와 메시지는 준비가 끝나면 바꿀 수 없어요. 가격과 배송비는 결제 전에 다시 확인해요.</p>
      <button type="submit" disabled={invalidSelection || selectedItems.length === 0 || selectedItems.length > 100}>선물 준비하기</button></fieldset><GiftRequestFeedback {...request} /></form>}
  </div></MypageShell>;
}
