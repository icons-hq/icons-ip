'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createCartSelectionDraftAction, type CheckoutDraftActionError } from '@/app/checkout/draft-actions';
import { CouponPicker } from '@/components/checkout/CouponPicker';
import { CartEmptyState } from '@/components/cart/CartEmptyState';
import { CartSubheader } from '@/components/cart/CartSubheader';
import { useCart, useReleaseUnpaidCartOrders } from '@/components/shell/CartProvider';
import { Icon } from '@/components/ui/Icon';
import { PriceBlock } from '@/components/wc/PriceBlock';
import { QuantityStepper } from '@/components/wc/QuantityStepper';
import { WcButton } from '@/components/wc/WcButton';
import type { CatalogSnapshot } from '@/lib/catalog';
import { goodsImageBackground } from '@/lib/goods-image';
import type { CartCouponState } from '@/lib/coupons.server';
import type { Good, Ip } from '@/lib/data';
import { krw } from '@/lib/format';
import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { goodsCustomInputProblem, goodsCustomInputSummary, type GoodsCustomInputSelection } from '@/lib/goods-custom-inputs';
import { cartItemKey, type CartItem } from '@/lib/cart';
import { cartLineOption, cartOptionGood, goodAtQuotedPrice, optionLabel, randomCartLineFold, type CartQuantityStep } from '@/lib/goods-options';
import { goodsSalesQuoteProblem, quoteLineOptionLimitMessage } from '@/lib/goods-sales';
import { shippingFeeLabel } from '@/lib/shipping';
import { useGoodsSalesPrecheckoutQuote, useShippingQuote } from '@/components/shop/useShippingQuote';
import { ShippingGroupSummary } from '@/components/shop/ShippingGroupSummary';
import { shippingGroupLabel, shippingGroupsNotice } from '@/lib/fulfillment';
import { goodsShipDateLabel, preorderSupplyLabel, type GoodsVariantSupply } from '@/lib/goods-preorders';
import { GoodsSalePeriodRefresh } from '@/components/shop/GoodsSalePeriodRefresh';
import { goodsSaleUnavailableLabel } from '@/lib/goods-sale-period';
import { ADULT_GOOD_LABEL } from '@/lib/adult-goods';
import { adultVerificationHref } from '@/lib/identity/adult-verification-routes';
import {
  cartGoodSignature, cartLineKey, cartOrderButtonLabel, cartSelectionQuantity, mergePendingOrderCauses, pendingOrderCausesFromQuote, pruneCartSelection,
  quoteCoversSelection, quoteExclusionKey, quoteLimitNotes, quoteUnavailableLines, selectedCartLines, toggleAllCartLines, toggleCartLineSelection,
  type CartLineCheckState, type QuoteLimitNote, type QuoteLineExclusion,
} from '@/lib/checkout-selection';
import { CheckoutPendingOrderRelease } from './CheckoutPendingOrderRelease';
import { PendingOrderResolution } from '@/components/checkout/PendingOrderResolution';
import { couponErrorNeedsPendingOrder } from '@/lib/coupons';

interface CartLine {
  goodId: string;
  variantId: string;
  customInputs?:GoodsCustomInputSelection;
  optionName?: string | null;
  qty: number;
  good?: Good;
  ip?: Ip;
  supply?: GoodsVariantSupply;
  /** 성인 인증이 없거나 만료된 계정에 남은 19금 굿즈 줄(ADR-0024). 주문을 막는다. */
  masked?: boolean;
  /** 옵션별 주문당 최대 수량(D7②) — 수량 스테퍼 상한. */
  orderMaxQty?: number | null;
  /** 견적이 알린 옵션별 구매 제한 위반 안내(확정 카피). */
  optionLimitMessage?: string | null;
  /** 랜덤 전환 전에 비기본 옵션 키로 담은 줄(D5②)을 '랜덤' 한 줄로 다시 담는 호출 순서. 있으면 스테퍼 대신 다시 담기다. */
  refold?: CartQuantityStep[] | null;
  /** 견적이 판정해 선택에서 뺀 사유(ADR-0030) — 화면을 연 뒤의 품절·판매기간 종료·재고 부족. 수량을 바꾸면 다시 판정한다. */
  excludedReason?: string | null;
  /** 이번 선택의 수량이 구매 조건(주문당 최소·최대, 회원 누적 한도, 옵션 한도)에 맞지 않아 체크를 푼 사유. 줄은 다시 고를 수 있다. */
  limitNote?: string | null;
}

/* 고른 줄로 주문서를 열지 못한 이유(ADR-0030). 로그인·프로필 미완료는 화면을 옮겨 안내한다. */
const CART_ORDER_ERRORS: Record<Exclude<CheckoutDraftActionError, 'auth_required' | 'onboarding_required'>, string> = {
  account_suspended: '정지된 계정은 새 주문을 만들 수 없어요.',
  invalid_request: '고른 굿즈를 다시 확인해주세요.',
  cart_changed: '다른 화면에서 장바구니가 바뀌었어요. 지금 장바구니를 확인하고 다시 주문해주세요.',
  /* 아래는 바로구매 초안의 사유다 — 장바구니 선택 초안에서는 나오지 않지만 같은 결과 타입이라 문구를 둔다. */
  adult_verification_required: '19금 굿즈는 성인 인증을 마친 회원만 주문할 수 있어요.',
  additional_good_unavailable: '추가 구성 굿즈의 판매 상태가 바뀌었어요. 다시 확인해주세요.',
  goods_unavailable: '판매 상태가 바뀐 굿즈가 있어요. 장바구니를 다시 확인해주세요.',
  custom_inputs_changed: '직접 입력 옵션 설정이 바뀌었어요. 굿즈에서 내용을 다시 확인해주세요.',
  unavailable: '주문서를 열지 못했어요. 잠시 후 다시 시도해주세요.',
};

/* 랜덤 전환 전에 담은 줄의 안내. 이 줄의 수량을 바꾸면 DB가 키 줄로 합쳐 화면이 갑자기 바뀌므로 다시 담기 하나만 둔다. */
const RANDOM_REFOLD_NOTICE = '판매 방식이 바뀌기 전에 담은 줄이에요. 다시 담으면 랜덤 한 줄로 합쳐집니다.';

const NO_EXCLUSIONS: ReadonlyMap<string, QuoteLineExclusion> = new Map();
const NO_LIMIT_NOTES: ReadonlyMap<string, QuoteLimitNote> = new Map();

/** 체크를 푼 굿즈의 구매 조건 사유와, 그때(체크를 푼 뒤) 그 굿즈 줄 집합의 서명. 서명이 바뀌면 낡은 사유라 보이지 않는다. */
interface CartLimitNote extends QuoteLimitNote {
  readonly signature: string;
}

function isSoldOut(good: Good) {
  return good.stock === 'soldout' || good.stockQty <= 0;
}

/** 주문을 막는 라인인지. 카탈로그에서 사라진 굿즈·품절·재고 초과가 여기 걸린다. */
function isUnavailable(line: CartLine) {
  if (line.masked || !line.good) return true;
  return Boolean(goodsSaleUnavailableLabel(line.good.salePeriod)) || isSoldOut(line.good) || line.qty > line.good.stockQty || Boolean(goodsCustomInputProblem(line.good.customInputs,line.customInputs));
}

function lineStateLabel(good: Good, qty: number) {
  const saleLabel = goodsSaleUnavailableLabel(good.salePeriod); if (saleLabel) return saleLabel;
  if (isSoldOut(good)) return '품절';
  if (qty > good.stockQty) return `재고 ${good.stockQty}개만 남음`;
  if (good.stock === 'low') return `재고 ${good.stockQty}개 남음`;
  return null;
}

interface CartLineSelection {
  checked: boolean;
  /** 주문할 수 없는 줄은 체크할 수 없다 — 선택에서 자동으로 빠진다(ADR-0030). */
  selectable: boolean;
  onChange: (checked: boolean) => void;
}

/* 같은 굿즈의 옵션·직접입력 줄을 화면 읽기 프로그램이 구별하도록 체크박스 이름에 옵션과 직접입력 요약을 더한다. */
function cartLineCheckLabel(name: string, optionName?: string | null, customInputs?: GoodsCustomInputSelection): string {
  const inputs = goodsCustomInputSummary(customInputs).replaceAll('\n', ' / ');
  return [name, optionName, inputs].filter(Boolean).join(' · ');
}

/* 줄 선택 체크박스(ADR-0030 · 1014-031). 접근 이름은 굿즈 이름·옵션·직접입력 요약이고, 고를 수 없는 줄은 비활성으로 남겨
   이유는 상태 문구가 말한다. */
function CartLineCheck({ label, selection }: { label: string; selection: CartLineSelection }) {
  const { pending } = useCart();
  return (
    <label className="wc-cart__line-check">
      <input
        aria-label={`${label} 선택`}
        checked={selection.selectable && selection.checked}
        disabled={!selection.selectable || pending}
        onChange={(event) => selection.onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

/* 행 = [체크 · 썸네일 64(모바일 80) · 브랜드·이름·단가·상태] 다음 줄에 회색 옵션 밴드 [옵션·직접 입력 | 수량 | ×],
   그 아래 오른쪽에 줄 금액(CT-04 · 레퍼런스 실측). 표시 배치만 바꾼다 — 수량·삭제 호출과 금액 계산은 그대로다. */
function CartLineRow({ line, selection }: { line: CartLine; selection: CartLineSelection }) {
  const { pending, remove, setQuantity } = useCart();
  const { good, goodId, variantId, ip, qty, optionName, supply,customInputs, orderMaxQty, optionLimitMessage, refold } = line;

  if (line.masked) {
    return (
      <li className="wc-cart__line wc-cart__line--selectable wc-cart__line--unavailable">
        <CartLineCheck label={ADULT_GOOD_LABEL} selection={selection} />
        <span aria-hidden className="wc-cart__line-media wc-product-card__adult-cover">
          <span className="wc-product-card__adult-mark">19</span>
        </span>
        <div className="wc-cart__line-info">
          <p className="wc-cart__line-brand">{ip?.title ?? 'ICONS'}</p>
          <p className="wc-cart__line-name">{ADULT_GOOD_LABEL}</p>
          <p className="wc-cart__line-state">
            성인 인증 후 구매할 수 있어요. <Link href={adultVerificationHref('/cart')}>성인 인증하기</Link>
          </p>
        </div>
        <button
          aria-label={`${ADULT_GOOD_LABEL} 장바구니에서 삭제`}
          className="wc-cart__remove"
          disabled={pending}
          onClick={() => void remove(goodId, variantId,customInputs)}
          type="button"
        >
          <Icon name="close" size={18} />
        </button>
      </li>
    );
  }

  if (!good) {
    return (
      <li className="wc-cart__line wc-cart__line--selectable wc-cart__line--unavailable">
        <CartLineCheck label={cartLineCheckLabel(`판매 종료된 굿즈 ${goodId}`, null, customInputs)} selection={selection} />
        <span aria-hidden className="wc-cart__line-media" />
        <div className="wc-cart__line-info">
          <p className="wc-cart__line-name">판매 종료된 굿즈 ({goodId})</p>
          <p className="wc-cart__line-state">판매 종료</p>
        </div>
        <div className="wc-cart__line-band">
          <div className="wc-cart__line-detail" />
          <button
            aria-label={`판매 종료된 굿즈 ${goodId} 삭제`}
            className="wc-cart__remove"
            disabled={pending}
            onClick={() => void remove(goodId, variantId,customInputs)}
            type="button"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      </li>
    );
  }

  const soldOut = isSoldOut(good) || Boolean(goodsSaleUnavailableLabel(good.salePeriod));
  const stateLabel = goodsSaleUnavailableLabel(good.salePeriod) ?? (supply?.mode === 'preorder' ? preorderSupplyLabel(supply) : lineStateLabel(good, qty));
  const href = `/shop/${goodId}`;

  return (
    <li className={`wc-cart__line wc-cart__line--selectable${isUnavailable(line) || line.excludedReason ? ' wc-cart__line--unavailable' : ''}`}>
      <CartLineCheck label={cartLineCheckLabel(good.name, optionName, customInputs)} selection={selection} />
      {/* 바로 옆 이름 링크와 목적지가 같다 — 접근성 트리에서는 숨긴다(ProductCard 와 같은 규칙). */}
      <Link
        aria-hidden
        className="wc-cart__line-media"
        href={href}
        style={{ background: goodsImageBackground(good.img) }}
        tabIndex={-1}
      />
      <div className="wc-cart__line-info">
        <p className="wc-cart__line-brand">{ip?.title ?? 'ICONS'}</p>
        <Link className="wc-cart__line-name" href={href}>{good.name}</Link>
        <PriceBlock showDiscountRate={good.showDiscountRate} compareAtPrice={good.compareAtPrice} price={good.price} />
        {goodsCustomInputProblem(good.customInputs,customInputs) && <p className="wc-cart__line-state">{goodsCustomInputProblem(good.customInputs,customInputs)} <Link href={href}>내용 다시 확인</Link></p>}
        {stateLabel ? <p className="wc-cart__line-state">{stateLabel}</p> : null}
        {optionLimitMessage && !line.excludedReason && !line.limitNote ? <p className="wc-cart__line-state">{optionLimitMessage}</p> : null}
        {line.excludedReason ? <p className="wc-cart__line-state">{line.excludedReason}</p> : null}
        {line.limitNote && !line.excludedReason ? <p className="wc-cart__line-state">{line.limitNote}</p> : null}
        {refold && !soldOut ? <p className="wc-cart__line-state">{RANDOM_REFOLD_NOTICE}</p> : null}
        {supply?.mode === 'preorder' ? <p className="wc-cart__line-state">{goodsShipDateLabel(supply.expectedShipDate)}</p> : null}
      </div>
      <div className="wc-cart__line-band">
        <div className="wc-cart__line-detail">
          {optionName ? <p className="wc-cart__line-option">{optionName}</p> : null}
          <GoodsCustomInputsSummary selection={customInputs} />
        </div>
        {/* 품절 라인은 늘릴 수도 줄일 수도 없다 — 스테퍼 대신 삭제만 남긴다. 랜덤 전환 전에 담은 줄은 다시 담기로 키 줄에 합친다. */}
        {soldOut ? null : refold ? (
          <button
            aria-label={`${good.name} 랜덤 한 줄로 다시 담기`}
            disabled={pending}
            onClick={() => void (async () => {
              for (const step of refold) await setQuantity(goodId, step.qty, good.stockQty, step.variantId, customInputs);
            })()}
            style={{ flex: 'none', height: 32, padding: '0 12px', border: '1px solid var(--wc-line-control)', background: 'var(--wc-surface)',
              color: 'var(--wc-ink)', font: 'inherit', fontSize: 13, cursor: 'pointer' }}
            type="button"
          >
            다시 담기
          </button>
        ) : (
          <QuantityStepper
            label={`${good.name} 수량`}
            max={orderMaxQty ? Math.min(good.stockQty, orderMaxQty) : good.stockQty}
            onChange={(next) => void setQuantity(goodId, next, good.stockQty, variantId,customInputs)}
            value={qty}
          />
        )}
        <button
          aria-label={`${good.name} 장바구니에서 삭제`}
          className="wc-cart__remove"
          disabled={pending}
          onClick={() => void remove(goodId, variantId,customInputs)}
          type="button"
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      <p className="wc-cart__line-total">{krw(good.price * qty)}</p>
    </li>
  );
}

export function Cart({
  catalog,
  couponState,
  transactionMode = 'legacy',
  giftAvailable = false,
}: {
  catalog: Pick<CatalogSnapshot, 'goods' | 'ips'>;
  couponState: CartCouponState;
  transactionMode?: 'legacy' | 'transaction' | 'unavailable';
  giftAvailable?: boolean;
}) {
  const { error, items, mode, pending, ready, legacyItems = [], removeLegacyItem, refresh, removeLines } = useCart();
  const router = useRouter();
  const transactionActive = transactionMode === 'transaction';
  /* 선택은 고객이 체크를 푼 줄만 기억한다 — 들어오면 전체 체크, 새로 동기화된 줄도 체크된 채다(ADR-0030). */
  const [deselectedState, setDeselected] = useState<ReadonlySet<string>>(() => new Set());
  const deselected = pruneCartSelection(deselectedState, items);
  const [confirmingClear, setConfirmingClear] = useState(false);
  /* 전체 비우기 확인(alertdialog): 열면 포커스를 안으로(취소) 옮기고, 닫으면 연 버튼으로 돌려준다. */
  const clearTriggerRef = useRef<HTMLButtonElement>(null);
  const clearCancelRef = useRef<HTMLButtonElement>(null);
  const clearWasOpen = useRef(false);
  useEffect(() => {
    if (confirmingClear) clearCancelRef.current?.focus();
    else if (clearWasOpen.current) clearTriggerRef.current?.focus();
    clearWasOpen.current = confirmingClear;
  }, [confirmingClear]);
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  /* 결제를 마치지 않은 이전 주문이 쿠폰·구매 한도를 잡고 있으면 견적 전에 닫는다(ADR-0026). */
  const released = useReleaseUnpaidCartOrders();
  /* 견적이 알려 준 배송 묶음(출고지)별 이름(택배사). 줄을 모두 해제해도 묶음 머리를 같은 이름으로 유지한다. */
  const [carrierLabels, setCarrierLabels] = useState<ReadonlyMap<string, string | null>>(() => new Map());

  /* 고를 수 있는지는 카탈로그 판매 상태로 먼저 정한다. 화면을 연 뒤의 품절·판매기간 종료·재고 부족은 견적이 알리므로,
     견적이 '이 줄은 주문할 수 없다'고 판정한 줄도 선택에서 빼고 사유를 줄에 보인다(ADR-0030 확정 동작 2 — 전체 주문을 막지
     않는다). 견적은 고른 줄만 받으므로 빠진 줄은 다음 견적에 없다 — 그래서 뺀 기록은 다음 카탈로그 새로고침(또는 그 줄의
     수량 변경)까지 유지해, 견적과 선택이 서로를 바꾸며 흔들리지 않게 한다. */
  const [exclusionState, setExclusionState] = useState<{ catalog: CatalogSnapshot['goods']; lines: ReadonlyMap<string, QuoteLineExclusion> }>(
    () => ({ catalog: catalog.goods, lines: NO_EXCLUSIONS }));
  const exclusions = exclusionState.catalog === catalog.goods ? exclusionState.lines : NO_EXCLUSIONS;
  /* 구매 조건(주문당 최소·최대, 회원 누적 한도, 옵션 한도)은 이번 선택의 수량 문제라 줄을 비활성으로 빼지 않는다 — 그 굿즈의
     줄 체크만 풀고 사유를 보인다. 고객이 다시 고르면 그 선택으로 다시 견적하고, 그 굿즈 줄 집합(줄 키·수량·체크)이 바뀌면
     (체크·해제·삭제·수량 변경) 낡은 사유를 바로 지운다. */
  const [limitNoteState, setLimitNotes] = useState<ReadonlyMap<string, CartLimitNote>>(() => new Map());
  const goodsById = useMemo(() => new Map(catalog.goods.map((good) => [good.id, good])), [catalog.goods]);
  const selectable = useCallback((item: CartItem) => {
    const catalogGood = goodsById.get(item.goodId);
    if (catalogGood?.masked) return false;
    if (exclusions.has(quoteExclusionKey(item))) return false;
    return !isUnavailable({ ...item, good: cartOptionGood(catalogGood, item.variantId) });
  }, [exclusions, goodsById]);
  const selectedItems = useMemo(() => selectedCartLines(items, deselected, selectable), [items, deselected, selectable]);
  const selectedKeys = new Set(selectedItems.map(cartLineKey));
  /* 굿즈 줄 집합의 지금 서명(줄 키·수량·체크)이 사유를 받을 때와 다르면 낡은 사유라 보이지 않는다. */
  const currentLineChecks: CartLineCheckState[] = items.map((item) => {
    const key = cartLineKey(item);
    return { goodId: item.goodId, key, qty: item.qty, checked: selectedKeys.has(key) };
  });
  const limitNotes = new Map([...limitNoteState].filter(([goodId, note]) => cartGoodSignature(currentLineChecks, goodId) === note.signature));
  /* 견적·쿠폰 대상 소계·배송비·예상 총액은 고른 줄 기준이다(1014-032). */
  const shipping = useShippingQuote(selectedItems, ready && released && transactionMode === 'legacy', couponState.selectedUserCouponId ?? '');
  const precheckout = useGoodsSalesPrecheckoutQuote(selectedItems, ready && released && transactionActive);
  const productQuote = transactionActive ? precheckout : shipping;
  const sales = productQuote.sales;
  /* 지금 고른 줄의 견적이 주문할 수 없는 줄·구매 조건을 새로 알리면 선택에서 뺀다(렌더 중 파생 상태 갱신). 견적이 지금 선택을
     옵션별 수량까지 덮을 때만 보고, 새로 뺄 줄이 있을 때만 갱신한다 — 뺀 뒤의 견적은 남은 줄만 판정하므로 흔들리지 않는다. */
  const quoteCovers = Boolean(sales && quoteCoversSelection(selectedItems, sales));
  const foundExclusions = sales && quoteCovers ? quoteUnavailableLines(selectedItems, sales) : NO_EXCLUSIONS;
  const foundLimits = sales && quoteCovers
    ? quoteLimitNotes(selectedItems, sales, (item) => {
      const good = cartOptionGood(goodsById.get(item.goodId), item.variantId);
      return optionLabel(cartLineOption(good, item.variantId), good?.options?.length ?? 0) ?? good?.name ?? item.goodId;
    })
    : NO_LIMIT_NOTES;
  if ([...foundExclusions.keys()].some((key) => !exclusions.has(key))) {
    setExclusionState({ catalog: catalog.goods, lines: new Map([...exclusions, ...foundExclusions]) });
  }
  if (foundLimits.size > 0) {
    const nextDeselected = new Set<string>();
    for (const key of deselected) nextDeselected.add(key);
    for (const note of foundLimits.values()) for (const key of note.lines.keys()) nextDeselected.add(key);
    setDeselected(nextDeselected);
    const nextLineChecks: CartLineCheckState[] = items.map((item) => {
      const key = cartLineKey(item);
      return { goodId: item.goodId, key, qty: item.qty, checked: selectable(item) && !nextDeselected.has(key) };
    });
    setLimitNotes(new Map([...limitNotes, ...[...foundLimits].map(([goodId, note]) => [goodId, {
      ...note, signature: cartGoodSignature(nextLineChecks, goodId),
    }] as const)]));
  }

  /* 줄에 보일 구매 조건 사유(줄 키 → 사유). 줄 목록(lines) 메모와 따로 붙인다. */
  const limitNoteMessages = new Map([...limitNotes.values()].flatMap((note) => [...note.lines]));
  const withLimitNote = (line: CartLine): CartLine => {
    const note = limitNoteMessages.get(cartLineKey(line));
    return note ? { ...line, limitNote: note } : line;
  };
  const lines = useMemo<CartLine[]>(() => {
    const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));
    const prices = new Map(sales?.lines.map(line => [cartItemKey(line.goodId, line.variantId), line]));

    return items.map((item) => {
      const quoteLine = prices.get(cartItemKey(item.goodId, item.variantId));
      const catalogGood = goodsById.get(item.goodId);
      /* 성인 인증 전에 남은 19금 굿즈 줄은 가림 줄이다(ADR-0024) — 옵션·가격을 읽지 않는다. */
      if (catalogGood?.masked) return { ...item, masked: true, ip: ipsById.get(catalogGood.ip) };
      const good = goodAtQuotedPrice(cartOptionGood(catalogGood, item.variantId), quoteLine);
      const option = cartLineOption(good, item.variantId);
      /* 랜덤 판매 굿즈(D5②)는 카탈로그가 옵션을 '랜덤' 하나로 접어 두었다 — 옵션명이 그대로 '랜덤'이다. */
      const optionName = optionLabel(option, good?.options?.length ?? 0);
      return {
        ...item,
        optionName,
        good,
        supply: quoteLine?.supply ?? option?.supply,
        ip: good ? ipsById.get(good.ip) : undefined,
        orderMaxQty: quoteLine?.optionLimit?.orderMaxQty ?? option?.orderMaxQty ?? null,
        optionLimitMessage: good ? quoteLineOptionLimitMessage(quoteLine, optionName ?? good.name) : null,
        refold: good ? randomCartLineFold(catalogGood, items, item, mode === 'server' ? 'server' : 'local', good.stockQty) : null,
        excludedReason: exclusions.get(quoteExclusionKey(item))?.message ?? null,
      };
    });
  }, [catalog.ips, exclusions, goodsById, items, mode, sales]);

  const selectedLines = lines.filter((line) => selectedKeys.has(cartLineKey(line)));
  const selectableLines = lines.filter(selectable);
  const allSelected = selectableLines.length > 0 && selectedLines.length === selectableLines.length;
  /* 주문 버튼의 N은 고른 줄의 수량 합이다(SHEET-007 — 데스크톱·모바일 같은 문구). */
  const selectedQuantity = cartSelectionQuantity(selectedItems);
  const subtotal = sales?.subtotal ?? selectedLines.reduce((total, line) => (
    total + (line.good ? line.good.price * line.qty : 0)
  ), 0);
  /* 주문할 수 없는 줄은 선택에서 빠질 뿐 나머지 주문을 막지 않는다(ADR-0030). 수량을 줄이면 살 수 있는 줄(남은 재고가 있다)이
     있을 때만 수량 조정을 권한다 — 품절·판매기간 종료는 수량으로 풀리지 않는다. 개수는 주문 버튼·배지·전체 비우기 확인과 같은
     수량 합이다. */
  const unavailableLines = lines.filter((line) => !selectable(line));
  const unavailableCount = cartSelectionQuantity(unavailableLines);
  const reducibleUnavailable = unavailableLines.some((line) => (exclusions.get(quoteExclusionKey(line))?.reducible === true
    || Boolean(line.good && !line.masked && !isSoldOut(line.good) && !goodsSaleUnavailableLabel(line.good.salePeriod) && line.qty > line.good.stockQty)));
  /* 결제 대기 주문 해소 안내(ADR-0030)의 원인 조건: 재고 부족·회원 누적 한도는 그 굿즈(옵션)를 담은 결제 대기 주문, 쿠폰 사용은
     그 쿠폰을 쓴 주문, 첫구매 예약만 모든 결제 대기 주문이다 — 무관한 결제 대기 주문의 취소를 권하지 않는다. 본인 결제 대기 주문이
     재고를 잡고 있으면 카탈로그부터 품절·재고 부족으로 보인다. */
  const stockGoodIds = [...new Set(lines.flatMap((line) => (line.good && !line.masked && !goodsSaleUnavailableLabel(line.good.salePeriod)
    && (isSoldOut(line.good) || line.qty > line.good.stockQty || exclusions.get(quoteExclusionKey(line))?.stockShort === true) ? [line.goodId] : [])))];
  const pendingOrderCauses = mergePendingOrderCauses(
    sales ? pendingOrderCausesFromQuote(sales) : {},
    ...[...limitNotes.values()].map((note) => note.pendingCauses),
    { stockGoodIds },
  );
  /* 구매 조건 때문에 체크를 푼 굿즈의 수량 합(주문 버튼과 같은 단위). */
  const limitNoteCount = cartSelectionQuantity(items.filter((item) => limitNoteMessages.has(cartLineKey(item))));
  /* 배송 묶음 머리·순서는 카탈로그(굿즈의 출고지, 장바구니 줄 순서)로 정한다 — 고른 줄의 견적은 고르지 않은 묶음을 모르므로,
     줄을 해제해도 그 묶음 머리가 사라지거나 줄이 묶음 밖으로 흩어지지 않게 한다. 묶음 이름(택배사)은 견적이 알려 준 값을
     기억해 쓴다. 거래 런타임 장바구니는 배송 묶음을 주문서에서 계산하므로 묶지 않는다. */
  const quoteGroups = useMemo(() => new Map((shipping.quote?.groups ?? []).map((group) => [group.originId, group])), [shipping.quote]);
  if ([...quoteGroups.values()].some((group) => carrierLabels.get(group.originId) !== (group.carrierLabel ?? null))) {
    setCarrierLabels(new Map([...carrierLabels, ...[...quoteGroups.values()].map((group) => [group.originId, group.carrierLabel ?? null] as const)]));
  }
  /* 첫 견적 전에는 지금처럼 묶지 않는다 — 택배사 이름을 모르는 머리가 잠깐 보였다 바뀌지 않게. */
  const groupsKnown = quoteGroups.size > 0 || carrierLabels.size > 0;
  const displayGroups = transactionActive || !groupsKnown ? [] : [...new Set(lines.flatMap((line) => (line.good?.originId ? [line.good.originId] : [])))]
    .map((originId) => {
      const quote = quoteGroups.get(originId) ?? null;
      return { originId, carrierLabel: quote ? quote.carrierLabel ?? null : carrierLabels.get(originId) ?? null, quote };
    });
  /* 표시용 예상치다. 실제 청구액은 place_order가 같은 정책으로 다시 계산한다. */
  const shippingFee = shipping.quote?.totalFee ?? 0;
  const shippingFinal = shipping.quote?.checkoutAllowed === true && shipping.quote.finalTotalFee !== null;
  const shippingCanContinue = Boolean(shipping.quote && shipping.quote.groups.every(group => group.finalFee !== null || group.regionStatus === 'address_required'));
  const purchaseProblem = sales ? goodsSalesQuoteProblem(sales) : null;
  const couponSelectionChanged = !transactionActive && Boolean(shipping.sales && (shipping.sales.coupon?.userCouponId ?? null) !== couponState.selectedUserCouponId);
  const canCheckout = transactionMode !== 'unavailable' && selectedItems.length > 0 && !pending && !ordering && Boolean(sales) && !purchaseProblem
    && (transactionActive || shippingCanContinue && !couponSelectionChanged);

  const lineSelection = (line: CartLine): CartLineSelection => ({
    checked: !deselected.has(cartLineKey(line)),
    selectable: selectable(line),
    onChange: (checked) => setDeselected(toggleCartLineSelection(deselected, cartLineKey(line), checked)),
  });
  /* 결제 대기 주문을 닫았으면 그 주문 때문에 뺀 기록·사유를 지우고 견적·카탈로그를 다시 읽는다 — 결제 대기 주문 때문에 체크를
     푼 줄(회원 누적·옵션 누적 한도)은 다시 체크한다. */
  const releaseRetry = () => {
    const pendingLines = new Set([...limitNotes.values()].filter((note) => note.pendingOrderMayBlock).flatMap((note) => [...note.lines.keys()]));
    if (pendingLines.size) setDeselected(new Set([...deselected].filter((key) => !pendingLines.has(key))));
    setExclusionState({ catalog: catalog.goods, lines: NO_EXCLUSIONS });
    setLimitNotes(new Map());
    productQuote.refresh();
    router.refresh();
  };
  const removeSelected = () => {
    if (!selectedLines.length) return;
    setConfirmingClear(false);
    void removeLines(selectedLines);
  };
  const clearAll = () => {
    setConfirmingClear(false);
    void removeLines(lines);
  };
  /* 고른 줄로 주문서 초안을 만들고 주문서로 간다(1014-031). 로그인 전 장바구니는 로그인 뒤 장바구니로 돌아와
     계정 장바구니에서 다시 고른다 — 합쳐진 계정 장바구니를 보지 않은 채 주문서로 가지 않는다. */
  const startCheckout = async () => {
    if (!canCheckout) return;
    if (mode !== 'server') {
      router.push(`/login?next=${encodeURIComponent('/cart')}`);
      return;
    }
    setOrdering(true);
    setOrderError(null);
    try {
      const result = await createCartSelectionDraftAction(selectedItems.map(({ goodId, variantId, qty, customInputs }) => (
        { goodId, variantId, qty, ...(customInputs ? { customInputs } : {}) })));
      if (result.ok) {
        router.push(result.href);
        return;
      }
      if (result.error === 'auth_required') router.push(`/login?next=${encodeURIComponent('/cart')}`);
      else if (result.error === 'onboarding_required') router.push(`/onboarding?next=${encodeURIComponent('/cart')}`);
      else {
        if (result.error === 'cart_changed') await refresh();
        setOrderError(CART_ORDER_ERRORS[result.error]);
      }
    } catch {
      setOrderError(CART_ORDER_ERRORS.unavailable);
    } finally {
      setOrdering(false);
    }
  };

  const appliedCoupon = couponState.coupons.find(
    (held) => held.id === couponState.selectedUserCouponId,
  ) ?? null;
  const couponDiscount = shipping.sales?.coupon?.discount ?? 0;
  /* 예상 총액은 배송비가 확정된 기존 계약에서만 숫자다. 금액은 요약 표에만 두고 주문 버튼은 'N개 주문하기'다(SHEET-007). */
  const estimatedTotal = !transactionActive && shippingFinal ? subtotal + shippingFee - couponDiscount : null;

  return (
    <div className="wc-root wc-cart">
      <GoodsSalePeriodRefresh goods={lines.flatMap(line => line.good ? [line.good] : [])} />
      <CartSubheader />
      <div className="wc-container">
        <h1 className="wc-cart__title">장바구니</h1>
        {ready ? (
          <p className="wc-cart__mode">{mode === 'server' ? '계정에 저장됨' : '이 기기에 저장됨'}</p>
        ) : null}

        {error ? <p className="wc-cart__error" role="alert">{error}</p> : null}
        {legacyItems.length > 0 ? <section aria-label="이전 장바구니 확인">
          <p>이전 장바구니를 현재 옵션에 연결하고 있습니다. 확인하지 못한 항목은 그대로 보관합니다.</p>
          <ul>{legacyItems.map((item) => <li key={item.goodId}>
            이전 굿즈 ({item.goodId}) · {item.qty}개
            <button className="wc-btn" disabled={pending} type="button" onClick={() => removeLegacyItem(item.goodId)}>이 항목 삭제</button>
          </li>)}</ul>
          <button className="wc-btn" disabled={pending} type="button" onClick={() => void refresh()}>다시 확인</button>
        </section> : null}

        {!ready ? (
          <p aria-live="polite" className="wc-cart__loading" role="status">
            {legacyItems.length && !pending ? '이전 장바구니를 확인해주세요.' : '장바구니를 불러오는 중이에요.'}
          </p>
        ) : lines.length === 0 ? (
          <CartEmptyState />
        ) : (
          <div className="wc-cart__layout">
            <div aria-busy={pending} className="wc-cart__list-col">
              {/* 선택 바(ADR-0030 · 1014-031·035·036): 전체 선택 · 선택 삭제 · 전체 비우기(확인). */}
              <div className="wc-cart__select-bar">
                <label className="wc-cart__select-all">
                  <input
                    checked={allSelected}
                    disabled={pending || selectableLines.length === 0}
                    onChange={(event) => setDeselected(toggleAllCartLines(deselected, selectableLines.map(cartLineKey), event.target.checked))}
                    type="checkbox"
                  />
                  <span>{`전체 선택 (${selectedLines.length}/${selectableLines.length})`}</span>
                </label>
                <div className="wc-cart__select-actions">
                  <button className="wc-cart__select-action" disabled={pending || selectedLines.length === 0} onClick={removeSelected} type="button">
                    선택 삭제
                  </button>
                  <button
                    aria-expanded={confirmingClear}
                    className="wc-cart__select-action"
                    disabled={pending}
                    onClick={() => setConfirmingClear((open) => !open)}
                    ref={clearTriggerRef}
                    type="button"
                  >
                    전체 비우기
                  </button>
                </div>
              </div>
              {confirmingClear ? (
                <div aria-labelledby="cart-clear-title" className="wc-cart__clear-confirm" role="alertdialog"
                  onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setConfirmingClear(false); } }}>
                  {/* 개수는 주문 버튼·장바구니 배지와 같은 수량 단위다. */}
                  <p id="cart-clear-title">{`장바구니의 굿즈 ${cartSelectionQuantity(lines)}개를 모두 삭제할까요?`}</p>
                  <div className="wc-cart__clear-actions">
                    <button className="wc-btn" disabled={pending} onClick={() => setConfirmingClear(false)} ref={clearCancelRef} type="button">취소</button>
                    <button className="wc-btn primary" disabled={pending} onClick={clearAll} type="button">전체 비우기</button>
                  </div>
                </div>
              ) : null}
              {shipping.quote && shippingGroupsNotice(shipping.quote.groups) ? <p className="wc-cart__summary-note">{shippingGroupsNotice(shipping.quote.groups)}</p> : null}
              {displayGroups.map((group, index, groups) => (
                <section className="wc-shipping-group" key={group.originId} aria-label={`${shippingGroupLabel(groups, index)} 굿즈`}>
                  <h2>{shippingGroupLabel(groups, index)}</h2>
                  <ul className="wc-cart__list">
                    {lines.filter(line => line.good?.originId === group.originId).map(line => <CartLineRow key={cartItemKey(line.goodId, line.variantId,line.customInputs)} line={withLimitNote(line)} selection={lineSelection(line)} />)}
                  </ul>
                  {group.quote ? <ShippingGroupSummary group={group.quote} /> : null}
                </section>
              ))}
              <ul className="wc-cart__list">
                {lines.filter(line => !displayGroups.some(group => line.good?.originId === group.originId))
                  .map(line => <CartLineRow key={cartItemKey(line.goodId, line.variantId,line.customInputs)} line={withLimitNote(line)} selection={lineSelection(line)} />)}
              </ul>
            </div>

            <aside aria-label="주문 요약" className="wc-cart__aside">
              <table className="wc-cart__summary">
                <tbody>
                  <tr>
                    <th scope="row">{transactionActive ? '복수구매 할인 전 굿즈 금액' : '총 굿즈 금액'}</th>
                    <td>{krw(subtotal)}</td>
                  </tr>
                  <tr>
                    <th scope="row">쿠폰 할인</th>
                    <td>{transactionActive ? '주문서에서 확인' : `−${krw(couponDiscount)}`}</td>
                  </tr>
                  <tr>
                    <th scope="row">배송비</th>
                    <td>{transactionActive ? '배송지·선불/착불 선택 후 확정' : shippingFinal ? shippingFeeLabel(shippingFee) : shipping.quote ? '배송지 입력 후 확정' : '확인 중'}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">예상 총액</th>
                    {/* 금액이면 26/700 으로 키우고(CT-01), 안내 문구면 금액 서체로 키우지 않는다. */}
                    <td className={estimatedTotal !== null ? 'wc-cart__total' : 'wc-cart__total wc-cart__total--pending'}>
                      {estimatedTotal !== null ? krw(estimatedTotal) : transactionActive ? '주문서에서 할인·배송비 확인 후 표시' : '배송비 확인 후 표시'}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <p className="wc-cart__summary-note">{transactionActive ? '복수구매 할인과 수량별 배송비는 주문서에서 계산합니다. 착불 배송비는 수령 시 별도로 납부합니다.' : '배송 묶음별 배송비를 합산합니다. 주문을 만들 때 서버가 최종 금액을 확인합니다.'}</p>
              {transactionMode === 'unavailable' && <p role="alert">주문 조건을 확인하지 못했습니다. 새로고침 후 다시 확인해주세요.</p>}
              {productQuote.loading ? <p role="status">{transactionActive ? '현재 가격과 구매 조건을 확인하고 있어요.' : '현재 가격과 배송비를 확인하고 있어요.'}</p> : null}
              {productQuote.error ? <div role="alert"><p>{productQuote.error}</p><button type="button" onClick={productQuote.refresh}>{transactionActive ? '가격·구매 조건 다시 확인' : '가격·배송비 다시 확인'}</button></div> : null}
              {/* 첫구매 예약처럼 DB가 결제 대기 주문 때문이라고 알린 쿠폰 막힘은 그 주문 목록으로 잇는다(#540, 무통장 입금 대기 포함). */}
              {purchaseProblem ? <p className="wc-cart__error" role="alert">{purchaseProblem}
                {!transactionActive && couponErrorNeedsPendingOrder(shipping.sales?.coupon?.reason) ? <PendingOrderResolution /> : null}
              </p> : null}
              {sales?.goods.filter(good => good.memberRemainingQty !== null).map(good => <p key={good.goodId}>
                {catalog.goods.find(item => item.id === good.goodId)?.name} · 회원 추가 구매 가능 {good.memberRemainingQty}개
              </p>)}

              {mode === 'server' ? (
                <CouponPicker
                  appliedCoupon={appliedCoupon}
                  couponState={couponState}
                  quote={transactionActive ? null : shipping.sales?.coupon ?? null}
                  shippingCouponsAtCheckout={transactionActive}
                  surface="cart"
                />
              ) : (
                <div className="wc-cart__coupon-slot">
                  <p className="wc-cart__coupon-title">쿠폰</p>
                  <p className="wc-cart__coupon-desc">로그인하면 보유 쿠폰을 적용할 수 있어요.</p>
                </div>
              )}

              {couponSelectionChanged ? <p className="wc-cart__coupon-warning" role="alert">다른 화면에서 선택한 쿠폰이 변경되었습니다. <button type="button" onClick={() => window.location.reload()}>현재 쿠폰 다시 확인</button></p> : null}

              {unavailableCount > 0 ? (
                <p className="wc-cart__warning" role="alert">
                  {`주문할 수 없는 굿즈 ${unavailableCount}개는 주문에서 빠져요.${reducibleUnavailable ? ' 수량을 줄이면 다시 고를 수 있어요.' : ''}`}
                </p>
              ) : null}
              {limitNoteCount > 0 ? (
                <p className="wc-cart__warning" role="status">
                  {`구매 조건에 맞지 않는 굿즈 ${limitNoteCount}개는 체크를 풀었어요. 굿즈의 안내를 확인하고 다시 골라주세요.`}
                </p>
              ) : null}
              {/* 결제 대기 주문(다른 탭의 바로구매 등)이 쿠폰·한도·재고를 잡고 있을 수 있다 — 장바구니를 열기만 해서는 그 결제를
                  끊지 않으므로 실제로 찾았을 때만 그 주문을 알리고, 고객이 확인했을 때만 닫는다(ADR-0030). 경고 글과 나눈 상자다. */}
              {mode === 'server' ? (
                <CheckoutPendingOrderRelease causes={pendingOrderCauses} onReleased={releaseRetry} />
              ) : null}
              {selectedItems.length === 0 && selectableLines.length > 0 ? (
                <p className="wc-cart__warning" role="status">주문할 굿즈를 골라주세요.</p>
              ) : null}
              {selectedLines.length < lines.length && selectedItems.length > 0 ? (
                <p className="wc-cart__selection-note">고른 굿즈만 주문해요. 고르지 않은 굿즈는 결제 뒤에도 장바구니에 남아요.</p>
              ) : null}
              {orderError ? <p className="wc-cart__error" role="alert">{orderError}</p> : null}

              {/* 데스크톱은 요약 박스 안 312×56, 모바일은 이 묶음이 하단 고정 바가 된다(CT-03). 버튼은 모든 폭에서
                  'N개 주문하기'(N = 고른 줄의 수량 합, SHEET-007)이고 금액은 위 요약 표가 보인다. 고른 줄로 주문서 초안을 만든 뒤
                  주문서로 간다(ADR-0030). */}
              <div className="wc-cart__cta-bar">
                <WcButton
                  ariaDisabled={ordering}
                  className="wc-cart__checkout"
                  disabled={!canCheckout && !ordering}
                  onClick={() => void startCheckout()}
                  variant="primary"
                >
                  <span className="wc-cart__checkout-count">{cartOrderButtonLabel(selectedQuantity)}</span>
                </WcButton>
              </div>
              {giftAvailable ? <Link className="wc-cart__gift" href="/gifts/new">장바구니에서 선물 준비</Link> : null}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
