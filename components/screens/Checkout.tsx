'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { placeOrderAction } from '@/app/checkout/actions';
import { PostcodeField } from '@/components/checkout/PostcodeField';
import { CouponPicker } from '@/components/checkout/CouponPicker';
import { CheckoutAddressBook } from '@/components/checkout/CheckoutAddressBook';
import { useStoreCreditQuote } from '@/components/checkout/useStoreCreditQuote';
import { useCart, useReleaseUnpaidCartOrders } from '@/components/shell/CartProvider';
import type { CatalogSnapshot } from '@/lib/catalog';
import {
  bankTransferMethodNote,
  checkoutAddressErrors,
  type CheckoutAddress,
  type CheckoutAddressErrors,
  type CheckoutAddressField,
  type CheckoutPaymentMethod,
} from '@/lib/checkout';
import { krw } from '@/lib/format';
import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { goodsCustomInputProblem } from '@/lib/goods-custom-inputs';
import { cartItemKey } from '@/lib/cart';
import { cartLineOption, cartOptionGood, goodAtQuotedPrice, optionLabel } from '@/lib/goods-options';
import { GOODS_LINE_UNAVAILABLE_MESSAGE, goodsPurchaseReasonMessage, goodsSalesQuoteProblem, quoteLineOptionLimitMessage } from '@/lib/goods-sales';
import { goodsSalePeriodBlock, goodsSalePeriodOrderNotice } from '@/lib/goods-sale-period';
import { QuoteUnavailableRefresh } from '@/components/shop/QuoteUnavailableRefresh';
import { GoodsSalePeriodRefresh } from '@/components/shop/GoodsSalePeriodRefresh';
import { PLACE_ORDER_OPTION_LIMIT_MESSAGES, PLACE_ORDER_RANDOM_OPTION_LIMIT_MESSAGE, PLACE_ORDER_RANDOM_OPTION_MESSAGE } from '@/lib/goods-option-sale-mode';
import { couponErrorNeedsPendingOrder, MIN_PAYABLE_TOTAL, type UserCouponSummary } from '@/lib/coupons';
import { PendingOrderResolution } from '@/components/checkout/PendingOrderResolution';
import type { CartCouponState } from '@/lib/coupons.server';
import { normalizeStoreCreditAmount } from '@/lib/store-credits';
import { goodsShipDateLabel } from '@/lib/goods-preorders';
import { paymentFailNoticeCopy } from '@/lib/payments/checkout-fail-copy';
import type { ComposedPostcodeAddress } from '@/lib/postcode';
import { shippingFeeLabel } from '@/lib/shipping';
import { addressBookEntryToCheckout, checkoutAddressPrefillNotice, sameCheckoutDestination, type AddressBookEntry, type CheckoutAddressPrefill } from '@/lib/address-book';
import { useShippingQuote } from '@/components/shop/useShippingQuote';
import { ShippingGroupSummary } from '@/components/shop/ShippingGroupSummary';
import { shippingGroupLabel, shippingGroupsNotice } from '@/lib/fulfillment';
import { parseShippingDestination } from '@/lib/shipping-regions';
import { orderCompleteHref } from '@/lib/routes';
import { checkoutDraftReturnHref, directCheckoutCopy, type CheckoutDraft } from '@/lib/checkout-draft';
import { useDirectCheckoutQuote, useDraftStoreCreditQuote } from './CheckoutDraftQuotes';
import { CheckoutDirectCoupon } from './CheckoutDirectCoupon';
import { CheckoutPendingOrderRelease } from './CheckoutPendingOrderRelease';
import { mergePendingOrderCauses, pendingOrderCausesFromQuote, quoteMayBeBlockedByPendingOrder } from '@/lib/checkout-selection';

/* 결제 대기 주문의 최소 결제 금액. DB 트리거(orders_korpay_minimum_amount)가 같은 값으로
   막는다 — 쿠폰·적립금은 그 아래로 깎지 않으므로 굿즈 금액+배송비가 기준이다. */
const BELOW_MINIMUM_PAYMENT_COPY = `결제 금액이 최소 결제 금액(${krw(MIN_PAYABLE_TOTAL)})보다 적어 주문할 수 없어요. 굿즈를 더 담아주세요.`;

/** 주문 생성 거절 안내(장바구니 주문서 기준). 바로구매 주문서는 directCheckoutCopy로 굿즈 상세를 가리키게 바꾼다. */
export const checkoutActionErrorCopy = {
  account_suspended: '정지된 계정은 새 주문을 만들 수 없어요.',
  goods_custom_inputs_changed: '직접 입력 옵션 설정이 변경되었습니다. 장바구니에서 내용을 다시 확인해주세요.',
  cart_changed: '장바구니가 변경되었습니다. 새로 불러온 전체 굿즈와 수량을 확인한 뒤 다시 주문해주세요.',
  goods_purchase_restricted: '신규 굿즈 주문이 제한된 계정이에요. 자세한 내용은 고객센터에 문의해주세요.',
  invalid_address: '배송지 정보를 다시 확인해주세요.',
  invalid_request: '주문 요청을 다시 시작해주세요.',
  auth_required: '로그인이 만료됐어요. 다시 로그인해주세요.',
  onboarding_required: '프로필 설정을 먼저 완료해주세요.',
  payment_unavailable: '현재 결제 환경을 확인 중이에요. 잠시 후 다시 시도해주세요.',
  bank_transfer_blocked: '무통장 입금을 쓸 수 없는 굿즈가 담겨 있어요. 카드로 결제해주세요.',
  card_payment_blocked: '카드 결제를 쓸 수 없는 굿즈가 담겨 있어요. 결제수단을 다시 확인해주세요.',
  purchase_limit_not_configured: goodsPurchaseReasonMessage('purchase_limit_not_configured'),
  order_quantity_below_minimum: goodsPurchaseReasonMessage('order_quantity_below_minimum'),
  order_quantity_above_maximum: goodsPurchaseReasonMessage('order_quantity_above_maximum'),
  member_purchase_limit_exceeded: goodsPurchaseReasonMessage('member_purchase_limit_exceeded'),
  /* 옵션별 구매 제한(D7②)·랜덤 판매(D5②) — 장바구니 안내 뒤의 경합으로 주문 생성이 거절된 경우. */
  option_order_limit_exceeded: PLACE_ORDER_OPTION_LIMIT_MESSAGES.option_order_limit_exceeded,
  option_member_limit_exceeded: PLACE_ORDER_OPTION_LIMIT_MESSAGES.option_member_limit_exceeded,
  random_option_unavailable: PLACE_ORDER_RANDOM_OPTION_MESSAGE,
  random_option_limit_exceeded: PLACE_ORDER_RANDOM_OPTION_LIMIT_MESSAGE,
  restricted_good_blocked: '지금은 구매할 수 없는 굿즈가 담겨 있어요. 장바구니에서 빼고 다시 시도해주세요.',
  adult_verification_required: '19금 굿즈는 성인 인증을 마친 회원만 주문할 수 있어요. 마이 > 성인 인증에서 인증한 뒤 다시 시도해주세요.',
  empty_cart: '장바구니가 비어 있어요.',
  out_of_stock: '결제 직전 재고가 변경됐어요. 장바구니에서 수량을 다시 확인해주세요.',
  coupon_rejected: '적용한 쿠폰을 쓸 수 없게 됐어요. 쿠폰을 다시 선택해주세요.',
  store_credit_rejected: '적립금 잔액이나 사용 조건이 바뀌었어요. 사용 금액을 다시 확인해주세요.',
  checkout_changed: '이미 만든 주문과 요청 내용이 달라요. 내 주문에서 결제를 이어가거나 기존 주문을 취소한 뒤 다시 주문해주세요.',
  /* 견적 뒤 다른 화면에서 쿠폰 선택이 바뀐 경우(DB coupon_selection_changed). 만든 주문이 없으므로 checkout_changed 문구를 쓰지 않는다.
     lib/checkout.ts 의 mapPlaceOrderError 가 이 코드로 돌려준다. */
  coupon_selection_changed: '쿠폰 선택이 바뀌었어요. 바뀐 쿠폰으로 결제 금액을 다시 확인한 뒤 주문해주세요.',
  goods_sale_not_open: '판매기간이 시작되지 않았거나 종료된 굿즈이 있어요. 장바구니를 확인해주세요.',
  preorder_sale_not_open: '예약 접수가 종료되거나 중지된 굿즈가 있어요. 장바구니를 확인해주세요.',
  preorder_capacity_exceeded: '예약 가능한 수량이 변경됐어요. 장바구니에서 수량을 다시 확인해주세요.',
  preorder_policy_not_configured: '굿즈의 예약 조건을 확인 중입니다. 잠시 후 다시 시도해주세요.',
  shipping_region_unresolved: '배송지의 배송 가능 여부와 배송비가 변경되었습니다. 배송지와 최신 배송비를 다시 확인해주세요.',
  payment_below_minimum: BELOW_MINIMUM_PAYMENT_COPY,
  /* 결제 승인을 확인하고 있는 주문이 있다(ADR-0026·0030). 그 주문(detail)으로 안내하고 결제 버튼을 잠근다. */
  checkout_payment_in_progress: '결제 확인 중인 주문이 있어요. 그 주문의 결제 결과를 확인한 뒤 다시 시도해주세요.',
  checkout_draft_expired: '주문서를 연 지 오래되어 다시 열어야 해요. 장바구니에서 다시 주문해주세요.',
  /* 같은 주문서(초안)로 이미 무통장 접수·결제한 주문이 있다 — 다른 탭·뒤로 가기의 재제출(ADR-0030). */
  checkout_draft_used: '이미 주문한 주문서예요. 주문 내용과 결제·입금 상태를 확인해주세요.',
  unavailable: '주문을 만들지 못했어요. 잠시 후 다시 시도해주세요.',
} as const;
const actionErrors = checkoutActionErrorCopy;

/* 주문서 초안(ADR-0030)에서만 쓰는 안내. 선택 주문은 장바구니에서 고른 줄, 바로구매는 상품 상세에서 고른 굿즈다. */
const SELECTION_CART_CHANGED_COPY = '장바구니에서 고른 굿즈의 수량이나 구성이 바뀌었어요. 장바구니에서 다시 골라 주문해주세요.';
const DIRECT_DRAFT_EXPIRED_COPY = '주문서를 연 지 오래되어 다시 열어야 해요. 굿즈 상세에서 다시 구매해주세요.';
/* 고른 화면(장바구니·굿즈 상세)에서 다시 고르면 풀리는 거절. 초안 주문서는 그 화면으로 돌아가는 링크를 붙인다. */
const DRAFT_RETURN_ERRORS = new Set<string>(['cart_changed', 'checkout_draft_expired', 'goods_custom_inputs_changed', 'restricted_good_blocked',
  'empty_cart', 'out_of_stock', 'goods_sale_not_open', 'preorder_sale_not_open', 'preorder_capacity_exceeded', 'option_order_limit_exceeded',
  'option_member_limit_exceeded', 'random_option_unavailable', 'random_option_limit_exceeded', 'member_purchase_limit_exceeded',
  'order_quantity_above_maximum', 'order_quantity_below_minimum', 'adult_verification_required']);
const SALE_PERIOD_REJECTIONS = new Set<string>(['goods_sale_not_open']);
const STOCK_CHANGED_COPY = '재고가 변경된 굿즈가 있어요. 장바구니에서 수량을 확인해주세요.';

interface CheckoutProps {
  catalog: Pick<CatalogSnapshot, 'goods' | 'ips'>;
  /** 배송지 미리 채우기(주소록 기본 배송지 → 결제를 마친 직전 주문)와 주소록 — L7 · 10/14 S6a. */
  addressPrefill: CheckoutAddressPrefill;
  paymentAvailable: boolean;
  /** 법인계좌가 설정돼 있는지. 없으면 무통장 자체가 뜨지 않는다(#255). */
  bankTransferAvailable: boolean;
  resumeOrderId: string | null;
  /** 카트에 적용해 둔 쿠폰. 할인 확정은 place_order 가 한다 — 여기서는 미리보기다. */
  appliedCoupon: UserCouponSummary | null;
  /** 보유 쿠폰과 선택(장바구니와 같은 cart_coupon_selections) — 주문서 쿠폰 칸(R25). 필수다: 빠지면 보유 쿠폰을 고를 수 없다. */
  couponState: CartCouponState;
  /** 토스 failUrl 쿼리에서 서버가 형식 검증까지 마친 실패 코드. */
  paymentFailCode?: string | null;
  /**
   * 주문서 초안(ADR-0030). 있으면 그 줄만 표시·견적·주문한다 — 장바구니 선택 주문(selection)·바로구매(direct).
   * 없으면 지금처럼 계정 장바구니 전체다.
   */
  draft?: CheckoutDraft | null;
}

const addressFieldOrder: CheckoutAddressField[] = [
  'recipientName',
  'phone',
  'postalCode',
  'address1',
  'address2',
  'deliveryNote',
];

/*
 * 선택된 수단의 게이트 하나만 본다. 라디오 disabled·제출 버튼·submit 가드가
 * 전부 이 판정을 공유해야 한다 — 가드만 카드 게이트를 보면 무통장만 열린
 * 구성에서 버튼은 활성인데 제출이 조용히 무시된다. 서버도 placeOrderAction에서
 * 같은 수단별 판정을 한다.
 */
/**
 * 주문서 머리 안내. 장바구니 전체 주문은 지금 문구 그대로이고, 선택 주문은 고르지 않은 굿즈가 남는다는 것을,
 * 바로구매는 장바구니를 바꾸지 않는다는 것을 덧붙인다(ADR-0030).
 */
export function checkoutSubcopy(source: CheckoutDraft['source'] | null, paymentMethod: CheckoutPaymentMethod): string {
  if (source === 'direct') {
    return paymentMethod === 'bank_transfer'
      ? '고른 굿즈만 주문해요. 주문을 접수하면 입금 계좌와 기한을 안내해요. 장바구니는 바뀌지 않아요.'
      : '고른 굿즈만 주문해요. 결제하기를 누르면 바로 결제 화면이 열려요. 장바구니는 바뀌지 않아요.';
  }
  if (source === 'selection') {
    return paymentMethod === 'bank_transfer'
      ? '장바구니에서 고른 굿즈만 주문해요. 접수한 굿즈만 장바구니에서 빠지고, 고르지 않은 굿즈는 그대로 남아요.'
      : '장바구니에서 고른 굿즈만 주문해요. 결제하기를 누르면 바로 결제 화면이 열리고, 고르지 않은 굿즈는 결제 뒤에도 장바구니에 남아요.';
  }
  return paymentMethod === 'bank_transfer'
    ? '주문을 접수하면 입금 계좌와 기한을 안내해요. 접수한 굿즈는 장바구니에서 빠져요.'
    : '결제하기를 누르면 바로 결제 화면이 열려요. 결제를 마치기 전까지 장바구니는 그대로예요.';
}

/** 결제 버튼 아래 안내. 장바구니 전체 주문은 지금 문구 그대로다. */
export function checkoutSubmitCaption(source: CheckoutDraft['source'] | null, paymentMethod: CheckoutPaymentMethod): string {
  if (source === 'direct') {
    return paymentMethod === 'bank_transfer'
      ? '주문이 접수되면 입금 계좌와 기한을 안내해요. 장바구니는 바뀌지 않아요.'
      : '다음 화면에서 결제수단을 고르고 결제를 마쳐요. 장바구니는 바뀌지 않아요.';
  }
  if (source === 'selection') {
    return paymentMethod === 'bank_transfer'
      ? '주문이 접수되면 입금 계좌와 기한을 안내해요. 고른 굿즈만 장바구니에서 빠져요.'
      : '다음 화면에서 결제수단을 고르고 결제를 마쳐요. 결제가 끝나면 고른 굿즈만 장바구니에서 빠져요.';
  }
  return paymentMethod === 'bank_transfer'
    ? '주문이 접수되면 입금 계좌와 기한을 안내해요. 접수한 굿즈는 장바구니에서 빠져요.'
    : '다음 화면에서 결제수단을 고르고 결제를 마쳐요. 결제가 끝나면 주문한 굿즈가 장바구니에서 빠져요.';
}

export function checkoutMethodAvailable(
  paymentMethod: CheckoutPaymentMethod,
  gates: { card: boolean; bankTransfer: boolean },
): boolean {
  return paymentMethod === 'bank_transfer' ? gates.bankTransfer : gates.card;
}

export function Checkout({
  catalog,
  addressPrefill,
  paymentAvailable,
  bankTransferAvailable,
  resumeOrderId,
  appliedCoupon,
  couponState,
  paymentFailCode = null,
  draft = null,
}: CheckoutProps) {
  const router = useRouter();
  const { items: cartItems, ready, mode, pending: cartPending, error: cartError, refresh } = useCart();
  /* 초안이 있으면 그 줄만 주문한다(선택 주문·바로구매). 장바구니 전체가 아니다(ADR-0030). */
  const items = draft ? draft.lines : cartItems;
  const direct = draft?.source === 'direct';
  const draftReturnHref = checkoutDraftReturnHref(draft);
  /* 바로구매 주문서의 안내는 장바구니가 아니라 굿즈 상세로 돌려보낸다(ADR-0030 — 바로구매는 장바구니를 거치지 않는다). */
  const copyFor = (message: string) => (direct ? directCheckoutCopy(message) : message);
  /* 결제를 마치지 않은 이전 주문이 쿠폰·적립금·구매 한도를 잡고 있으면 먼저 닫는다(ADR-0026). 장바구니 주문서는 장바구니
     출처만 닫고, 바로구매 주문서는 아무것도 닫지 않는다 — 보기만으로 다른 탭의 결제를 끊지 않는다. 견적이 그 주문 때문에
     막히면 아래 안내가 그 주문을 알리고 고객이 누를 때만 닫는다(ADR-0030). */
  const released = useReleaseUnpaidCartOrders(direct ? 'none' : 'cart');
  /* 바로구매 쿠폰은 이 주문서에서 따로 고른다 — 장바구니 쿠폰 선택은 바꾸지 않는다. */
  const [directCouponId, setDirectCouponId] = useState<string | null>(null);
  const checkoutKey = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /* 쿠폰 칸의 변경 액션이 진행 중이면 결제를 잠근다(R25) — 끝나기 전의 주문은 이전 쿠폰으로 나가 거절된다. */
  const [couponPending, setCouponPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /* 접수 거절 코드. 판매기간 거절이면 굿즈 이름을 말하는 한 줄 안내(salePeriodNotice)가 일반 문구를 대신한다(T22i·QA1c S-D2-11). */
  const [submitErrorCode, setSubmitErrorCode] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState(false);
  /* 초안 주문이 장바구니 변경·초안 만료로 거절되면 고른 화면(장바구니·상품 상세)으로 돌아가는 링크를 붙인다. */
  const [draftReturnNeeded, setDraftReturnNeeded] = useState(false);
  /* 주문을 막은 주문(ADR-0030): 같은 주문서로 이미 접수·결제한 주문이거나 결제 승인을 확인하고 있는 주문. 있으면 그 주문으로
     안내하고 결제 버튼을 잠근다 — 같은 주문서로 두 번 청구되지 않게. */
  const [blockingOrderId, setBlockingOrderId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<CheckoutAddressErrors>({});
  /* 카드 게이트가 닫혀 있으면 열려 있는 무통장으로 시작한다 — 고를 수 없는
     라디오가 선택된 채 뜨지 않게. 두 게이트 prop은 서버가 내려주는 고정값이다. */
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>(
    paymentAvailable || !bankTransferAvailable ? 'card' : 'bank_transfer',
  );
  const prefilled = addressPrefill.address;
  const [address, setAddress] = useState<CheckoutAddress>({
    recipientName: prefilled?.recipientName ?? '',
    phone: prefilled?.phone ?? '',
    postalCode: prefilled?.postalCode ?? '',
    address1: prefilled?.address1 ?? '',
    address2: prefilled?.address2 ?? '',
    deliveryNote: prefilled?.deliveryNote ?? '',
  });
  /* 미리 채운 배송지를 그대로 두는 동안만 출처를 안내한다(S6a — 사실대로). */
  const prefillNotice = prefilled && sameCheckoutDestination(prefilled, address)
    ? checkoutAddressPrefillNotice(addressPrefill.source) : null;
  const destination = parseShippingDestination({ postalCode: address.postalCode, address1: address.address1 });
  const cartQuote = useShippingQuote(items, ready && released && !direct, appliedCoupon?.id ?? '', destination);
  const directQuote = useDirectCheckoutQuote(items, ready && released && direct, directCouponId, destination);
  const shipping = direct ? directQuote : cartQuote;
  /* 이 주문서의 쿠폰: 바로구매는 주문서에서 고른 쿠폰, 아니면 장바구니 쿠폰 선택이다. */
  const orderCoupon = direct ? couponState.coupons.find((held) => held.id === directCouponId) ?? null : appliedCoupon;
  const [storeCreditInput, setStoreCreditInput] = useState('');
  const requestedStoreCredits = normalizeStoreCreditAmount(storeCreditInput);
  /* 적립금 사용 한도도 이 주문서의 품목 기준이다 — 초안이면 그 줄과 쿠폰으로, 아니면 장바구니 전체로 묻는다. */
  const cartCredits = useStoreCreditQuote(requestedStoreCredits, draft ? null : shipping.sales?.calculatedAt ?? null, destination);
  const draftCredits = useDraftStoreCreditQuote(requestedStoreCredits, draft ? shipping.sales?.calculatedAt ?? null : null, destination, items,
    direct ? { kind: 'direct', userCouponId: directCouponId } : { kind: 'cart' });
  const credits = draft ? draftCredits : cartCredits;
  const creditProblem = requestedStoreCredits === null ? '적립금은 0 이상의 원 단위 정수로 입력해주세요.'
    : requestedStoreCredits > 0 && credits.quote && !credits.quote.valid ? actionErrors.store_credit_rejected : null;
  const creditReady = requestedStoreCredits === 0 || (requestedStoreCredits !== null && credits.quote?.valid === true);
  const usedStoreCredits = creditReady ? requestedStoreCredits ?? 0 : 0;

  const lines = useMemo(() => {
    const goodsById = new Map(catalog.goods.map((good) => [good.id, good]));
    const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));
    const prices = new Map(shipping.sales?.lines.map(line => [cartItemKey(line.goodId, line.variantId), line]));
    return items.map((item) => {
      const quoteLine = prices.get(cartItemKey(item.goodId, item.variantId));
      const good = goodAtQuotedPrice(cartOptionGood(goodsById.get(item.goodId), item.variantId), quoteLine);
      const option = item.variantId ? cartLineOption(good, item.variantId) : good?.options?.find(option => option.isDefault);
      /* 랜덤 판매 굿즈(D5②)는 카탈로그가 옵션을 '랜덤' 하나로 접어 두었다. 옵션별 구매 제한(D7②) 위반은 품목 줄이 말한다. */
      const optionName = optionLabel(option, good?.options?.length ?? 0);
      return { ...item, good, supply: quoteLine?.supply ?? option?.supply,
        optionName, ip: good ? ipsById.get(good.ip) : undefined,
        optionLimitMessage: good ? quoteLineOptionLimitMessage(quoteLine, optionName ?? good.name) : null };
    });
  }, [catalog.goods, catalog.ips, items, shipping.sales]);
  const subtotal = shipping.sales?.subtotal ?? lines.reduce((sum, line) => sum + (line.good?.price ?? 0) * line.qty, 0);
  /* 표시용 예상치다. 결제 금액은 place_order가 확정한 orders.total을 따른다. */
  const shippingFee = shipping.quote?.totalFee ?? 0;
  const shippingReady = shipping.quote?.checkoutAllowed === true && shipping.quote.finalTotalFee !== null;
  const couponDiscount = shipping.sales?.coupon?.discount ?? 0;
  const couponSelectionChanged = Boolean(shipping.sales && (shipping.sales.coupon?.userCouponId ?? null) !== (orderCoupon?.id ?? null));
  const quotedCouponName = !couponSelectionChanged && orderCoupon ? orderCoupon.coupon.name : shipping.sales?.coupon?.couponCode;
  const couponLabel = quotedCouponName ? `쿠폰 할인 (${quotedCouponName})` : '쿠폰 할인';
  const unavailable = lines.some(({ good, qty,customInputs }) => (
    !good || Boolean(goodsCustomInputProblem(good.customInputs,customInputs)) || good.stock === 'soldout' || good.stockQty < qty
  ));
  /* 판매기간이 끝났거나 시작 전인 굿즈는 공통 '재고 변경' 안내 대신 그 굿즈와 이유를 말한다(QA1 S-D2-11). 주문은 지금처럼 잠긴다. */
  const salePeriodNotice = goodsSalePeriodOrderNotice(lines.flatMap(({ good }) => (good ? [good] : [])), direct ? 'direct' : 'cart');
  /* 주문서가 스스로 재견적해 줄이 주문 불가가 됐는데 카탈로그의 판매기간은 옛 값이면(운영자가 종료 시각을 앞당긴 경우 등) 서버 속성을 한 번 다시 읽어
     위 안내를 띄운다. 일반 '재고 변경' 문구는 그 안내가 없을 때만 남는다(QA2 S-W1m-02). */
  const quoteUnavailableSignature = salePeriodNotice ? null
    : [...new Set((shipping.sales?.lines ?? []).filter((line) => !line.available).map((line) => line.goodId))].sort().join(',') || null;
  /* 결제 대기 주문 해소 안내(ADR-0030)의 원인 조건 — 그 굿즈(옵션)를 담은 주문(재고·회원 누적 한도), 그 쿠폰을 쓴 주문(쿠폰 사용),
     첫구매 예약만 모든 결제 대기 주문(견적 사유·주문 생성의 첫구매 거절). 재고가 모자란 굿즈는 본인 결제 대기 주문이 잡고 있을 수 있다. */
  const stockGoodIds = [...new Set([
    ...lines.flatMap(({ good, goodId, qty }) => (good && (good.stock === 'soldout' || good.stockQty < qty) ? [goodId] : [])),
    ...(shipping.sales?.lines ?? []).flatMap((line) => (!line.available && line.supply && line.supply.availableQty < line.qty ? [line.goodId] : [])),
  ])];
  const pendingOrderCauses = mergePendingOrderCauses(
    shipping.sales ? pendingOrderCausesFromQuote(shipping.sales) : {},
    { stockGoodIds, firstPurchase: pendingOrder },
  );
  /*
   * 한 굿즈라도 무통장을 막았으면 주문 전체가 막힌다 — 주문 단위로 선점 창이
   * 정해지므로 품목별로 다른 기한을 줄 수 없다. 서버도 place_order에서 같은
   * 판단을 한다(여기 판단은 UI 안내일 뿐 게이트가 아니다).
   */
  const bankTransferBlockedByCart = lines.some(({ good }) => good?.allowBankTransfer === false);
  /* 쿠폰·적립금은 최소 결제 금액 아래로 깎지 않으므로, 굿즈 금액+배송비가 그 아래면 주문
     생성이 DB에서 거절된다. 견적이 확정된 뒤에만 판정해 제출 전에 막는다. */
  const belowMinimumPayment = shippingReady && Boolean(shipping.sales)
    && subtotal + (shipping.quote?.finalTotalFee ?? shippingFee) < MIN_PAYABLE_TOTAL;
  const purchaseProblem = shipping.sales
    ? goodsSalesQuoteProblem(shipping.sales) ?? (belowMinimumPayment ? BELOW_MINIMUM_PAYMENT_COPY : null)
    : null;
  const cardSelectable = paymentAvailable && shipping.sales?.paymentMethods.card === true;
  const bankTransferSelectable = bankTransferAvailable && !bankTransferBlockedByCart && shipping.sales?.paymentMethods.bankTransfer === true;
  const selectedPaymentMethod = checkoutMethodAvailable(paymentMethod, { card: cardSelectable, bankTransfer: bankTransferSelectable })
    ? paymentMethod : cardSelectable ? 'card' : bankTransferSelectable ? 'bank_transfer' : paymentMethod;
  const methodAvailable = checkoutMethodAvailable(selectedPaymentMethod, {
    card: cardSelectable,
    bankTransfer: bankTransferSelectable,
  });

  const setField = (field: keyof CheckoutAddress, value: string) => {
    setAddress((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  /* 주소록에서 고르면 그 배송지로 채우고, '새 배송지 입력'이면 비운다. 배송 메모는 주문서에 적은 값을 둔다. */
  const pickAddressBookEntry = (entry: AddressBookEntry | null) => {
    setAddress((current) => entry
      ? addressBookEntryToCheckout(entry, current.deliveryNote ?? '')
      : { recipientName: '', phone: '', postalCode: '', address1: '', address2: '', deliveryNote: current.deliveryNote ?? '' });
    setFieldErrors({});
  };

  /* 검색 결과는 우편번호와 기본 주소만 덮어쓴다. 상세 주소는 사용자 몫이라
     이미 적어둔 값을 지우지 않는다. */
  const applySearchedAddress = ({ postalCode, address1 }: ComposedPostcodeAddress) => {
    setAddress((current) => ({ ...current, postalCode, address1 }));
    setFieldErrors((current) => {
      if (!current.postalCode && !current.address1) return current;
      const next = { ...current };
      delete next.postalCode;
      delete next.address1;
      return next;
    });
    window.requestAnimationFrame(() => {
      document.getElementById('checkout-address2')?.focus();
    });
  };

  /* 선택 주문 초안을 만든 뒤 다른 탭에서 고른 줄이 바뀌었다 — 주문하면 DB가 PT409로 거절하므로 먼저 막는다. */
  const draftStale = draft?.stale === true;
  /* 고객이 결제 대기 주문을 취소했으면 견적·적립금·쿠폰 상태를 다시 읽는다. */
  const retryAfterRelease = () => {
    setSubmitError(null);
    setPendingOrder(false);
    shipping.refresh();
    credits.refresh();
    router.refresh();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || cartPending || couponPending || mode !== 'server' || unavailable || !methodAvailable || !shippingReady || !shipping.sales || purchaseProblem || !creditReady || couponSelectionChanged || draftStale || blockingOrderId) return;

    const nextFieldErrors = checkoutAddressErrors(address);
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      const firstInvalidField = addressFieldOrder.find((field) => nextFieldErrors[field]);
      if (firstInvalidField) {
        window.requestAnimationFrame(() => {
          document.getElementById(`checkout-${firstInvalidField}`)?.focus();
        });
      }
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setSubmitErrorCode(null);
    setPendingOrder(false);
    setDraftReturnNeeded(false);
    checkoutKey.current ??= crypto.randomUUID();
    let result: Awaited<ReturnType<typeof placeOrderAction>>;
    try {
      result = await placeOrderAction(address, checkoutKey.current, selectedPaymentMethod, requestedStoreCredits,
        direct ? directCouponId : shipping.sales.coupon?.userCouponId ?? null, items, draft?.id);
    } catch {
      setSubmitError(actionErrors.unavailable);
      setSubmitting(false);
      return;
    }
    if (!result.ok) {
      if(result.error==='cart_changed') await refresh();
      setSubmitErrorCode(result.error);
      /* 주문서를 연 뒤 판매기간이 바뀌었으면 카탈로그를 다시 읽어 그 굿즈 이름을 알린다. */
      if (SALE_PERIOD_REJECTIONS.has(result.error)) router.refresh();
      setSubmitError(result.pendingOrder ? '진행 중인 다른 주문을 완료하거나 취소한 뒤 다시 시도해주세요.'
        : draft?.source === 'selection' && result.error === 'cart_changed' ? SELECTION_CART_CHANGED_COPY
          : direct && result.error === 'checkout_draft_expired' ? DIRECT_DRAFT_EXPIRED_COPY
            : copyFor(actionErrors[result.error]));
      setDraftReturnNeeded(Boolean(draft) && DRAFT_RETURN_ERRORS.has(result.error));
      if (result.error === 'checkout_draft_used' || result.error === 'checkout_payment_in_progress') setBlockingOrderId(result.orderId ?? null);
      setPendingOrder(result.pendingOrder === true);
      shipping.refresh();
      credits.refresh();
      setSubmitting(false);
      return;
    }

    /* 카드: 장바구니는 결제가 확정될 때까지 그대로다. 결제 화면이 바로 결제를 준비한다(S8).
       무통장: 접수 = 주문 완료(입금대기)라 장바구니에서 빠졌다. 완료 화면이 입금 안내를 보인다. */
    await refresh();
    window.scrollTo(0, 0);
    router.push(selectedPaymentMethod === 'bank_transfer' ? orderCompleteHref(result.orderId) : `/checkout/${result.orderId}`);
  };

  if (!ready || cartPending || !released) {
    return (
      <main className="wc-root wc-receipt checkout-page">
        <div className="wrap checkout-loading" role="status">계정 장바구니를 확인하고 있어요.</div>
      </main>
    );
  }

  if (mode !== 'server') {
    return (
      <main className="wc-root wc-receipt checkout-page">
        <div className="wrap checkout-empty card">
          <h1>장바구니를 계정에 연결하지 못했어요</h1>
          <p>{cartError ?? '로그인 상태와 네트워크를 확인한 뒤 다시 시도해주세요.'}</p>
          <button className="btn btn-holo" type="button" onClick={() => void refresh()}>다시 연결</button>
          <Link className="btn btn-ghost" href="/cart">장바구니로 돌아가기</Link>
        </div>
      </main>
    );
  }

  const paymentFailNotice = paymentFailCode ? (
    <p className="checkout-error" role="alert">
      {paymentFailNoticeCopy(paymentFailCode)}
    </p>
  ) : null;

  if (lines.length === 0) {
    // 카드 주문은 결제가 끝날 때까지 장바구니를 남기므로(ADR-0026) 여기에 오는 것은 장바구니가
    // 정말 비었을 때다. 무통장 입금 대기 주문이 있으면 그 입금 안내로 잇는다.
    return (
      <main className="wc-root wc-receipt checkout-page">
        <div className="wrap checkout-empty card">
          <h1>{resumeOrderId ? '진행 중인 주문이 있어요' : '주문할 굿즈가 없어요'}</h1>
          {paymentFailNotice}
          <p>{resumeOrderId
            ? '결제를 기다리거나 입금을 기다리는 주문이 있어요. 이어서 결제하거나 입금 안내를 확인할 수 있어요.'
            : '장바구니에 굿즈를 담은 뒤 다시 와주세요.'}</p>
          {resumeOrderId && (
            <Link className="btn btn-holo" href={`/checkout/${resumeOrderId}`}>주문 이어가기</Link>
          )}
          <Link className={resumeOrderId ? 'btn btn-ghost' : 'btn btn-holo'} href="/shop">굿즈 보러 가기</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="wc-root wc-receipt checkout-page">
      {/* 주문서를 연 채 판매기간이 끝나거나 시작되면 카탈로그를 다시 읽어 그 굿즈를 바로 알린다(QA1 S-D2-11, 장바구니와 같은 경계). */}
      <GoodsSalePeriodRefresh goods={lines.flatMap((line) => (line.good ? [line.good] : []))} />
      <QuoteUnavailableRefresh signature={quoteUnavailableSignature} />
      <header className="wc-receipt__head">
        <div className="wrap">
          <h1 className="wc-receipt__title">배송지와 결제 금액을 확인해주세요</h1>
          <p className="wc-receipt__subcopy">{checkoutSubcopy(draft?.source ?? null, paymentMethod)}</p>
          {paymentFailNotice}
          {draftStale ? (
            <p className="checkout-error" role="alert">
              {SELECTION_CART_CHANGED_COPY} <Link href={draftReturnHref}>장바구니로 돌아가기</Link>
            </p>
          ) : null}
        </div>
      </header>

      <form className="wrap checkout-layout" onSubmit={submit} aria-busy={submitting} noValidate>
        <section className="checkout-form card" aria-labelledby="shipping-title">
          <div className="checkout-section-heading">
            <span className="checkout-step mono">01</span>
            <div>
              <h2 id="shipping-title">배송지</h2>
              <p>{prefillNotice ?? '수령에 필요한 정보만 주문에 안전하게 저장합니다.'}</p>
              {/* 1014-020 '너무 정보가 많아요' — 법정 고지가 아닌 설명은 한 줄 요약만 보이고 펼쳐 읽는다. */}
              <details className="checkout-note">
                <summary>국내 배송·원화 결제만 제공해요</summary>
                <p>원화(KRW) 결제·국내 배송만 제공합니다. 국내 배송대행지 주소도 사용할 수 있으며, 이후 해외 운송은 고객이 별도로 진행합니다.</p>
              </details>
            </div>
          </div>

          <CheckoutAddressBook address={address} book={addressPrefill.book} disabled={submitting} onAddressErrors={setFieldErrors} onPick={pickAddressBookEntry} />

          {/* 문의 런처가 입력칸 오른쪽 끝을 가리지 않게, 이 칸들과 겹치는 동안은 런처를 비켜 둔다(QA2b minor 5). */}
          <div className="checkout-fields" data-inquiry-avoid="">
            <label>
              <span>받는 분</span>
              <input id="checkout-recipientName" required autoComplete="name" maxLength={50} aria-invalid={Boolean(fieldErrors.recipientName)} aria-describedby={fieldErrors.recipientName ? 'checkout-recipientName-error' : undefined} value={address.recipientName} onChange={(event) => setField('recipientName', event.target.value)} />
              {fieldErrors.recipientName && <small id="checkout-recipientName-error" className="checkout-field-error">{fieldErrors.recipientName}</small>}
            </label>
            <label>
              <span>연락처</span>
              <input id="checkout-phone" required autoComplete="tel" inputMode="tel" maxLength={20} aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? 'checkout-phone-error' : undefined} placeholder="010-1234-5678" value={address.phone} onChange={(event) => setField('phone', event.target.value)} />
              {fieldErrors.phone && <small id="checkout-phone-error" className="checkout-field-error">{fieldErrors.phone}</small>}
            </label>
            <PostcodeField
              error={fieldErrors.postalCode}
              onChange={(postalCode) => setField('postalCode', postalCode)}
              onSelect={applySearchedAddress}
              value={address.postalCode}
            />
            <label className="checkout-field--wide">
              <span>기본 주소</span>
              <input id="checkout-address1" required autoComplete="address-line1" maxLength={200} aria-invalid={Boolean(fieldErrors.address1)} aria-describedby={fieldErrors.address1 ? 'checkout-address1-error' : undefined} value={address.address1} onChange={(event) => setField('address1', event.target.value)} />
              {fieldErrors.address1 && <small id="checkout-address1-error" className="checkout-field-error">{fieldErrors.address1}</small>}
            </label>
            <label className="checkout-field--wide">
              <span>상세 주소 <em>선택</em></span>
              <input id="checkout-address2" autoComplete="address-line2" maxLength={200} aria-invalid={Boolean(fieldErrors.address2)} aria-describedby={fieldErrors.address2 ? 'checkout-address2-error' : undefined} placeholder="예: 101동 1203호" value={address.address2 ?? ''} onChange={(event) => setField('address2', event.target.value)} />
              {fieldErrors.address2 && <small id="checkout-address2-error" className="checkout-field-error">{fieldErrors.address2}</small>}
            </label>
            <label className="checkout-field--wide">
              <span>배송 메모 <em>선택</em></span>
              <input id="checkout-deliveryNote" maxLength={200} aria-invalid={Boolean(fieldErrors.deliveryNote)} aria-describedby={fieldErrors.deliveryNote ? 'checkout-deliveryNote-error' : undefined} placeholder="예: 문 앞에 놓아주세요" value={address.deliveryNote ?? ''} onChange={(event) => setField('deliveryNote', event.target.value)} />
              {fieldErrors.deliveryNote && <small id="checkout-deliveryNote-error" className="checkout-field-error">{fieldErrors.deliveryNote}</small>}
            </label>
          </div>
        </section>

        <aside className="checkout-summary card" aria-label="최종 주문 요약" data-inquiry-avoid="">
          <div className="checkout-section-heading checkout-section-heading--compact">
            <span className="checkout-step mono">02</span>
            <h2>주문 확인</h2>
          </div>
          <div className="checkout-items">
            {lines.map(({ goodId, variantId, good, ip, qty, optionName, supply,customInputs, optionLimitMessage }) => {
              const saleBlock = good ? goodsSalePeriodBlock(good) : null;
              return (
              <div className="checkout-item" data-sale-period-block={saleBlock ?? undefined} key={cartItemKey(goodId, variantId,customInputs)}>
                <div>
                  <span>{ip?.title ?? 'ICONS'} · {good?.type ?? '판매 종료'}</span>
                  <strong>{good?.name ?? goodId}</strong>
                  {optionName ? <span>{optionName}</span> : null}
                  <GoodsCustomInputsSummary selection={customInputs} />
                  {good && goodsCustomInputProblem(good.customInputs,customInputs) && <span>{goodsCustomInputProblem(good.customInputs,customInputs)}</span>}
                  {supply?.mode === 'preorder' ? <span>예약판매 · {goodsShipDateLabel(supply.expectedShipDate)}</span> : null}
                  {optionLimitMessage ? <span>{optionLimitMessage}</span> : null}
                  {saleBlock ? <span role="status"><strong>{saleBlock === 'ended' ? '판매기간이 끝나 지금은 주문할 수 없어요' : '아직 판매 전이라 지금은 주문할 수 없어요'}</strong></span> : null}
                </div>
                <span className="mono">{qty} × {krw(good?.price ?? 0)}</span>
              </div>
              );
            })}
          </div>
          <dl className="checkout-totals">
            <div><dt>굿즈 금액</dt><dd>{krw(subtotal)}</dd></div>
            {/* 쿠폰 행은 할인이 0원이어도 둔다 — 바로 아래 쿠폰 칸에서 고르고 바꾼다(R25). */}
            <div><dt>{couponLabel}</dt><dd>−{krw(couponDiscount)}</dd></div>
            {usedStoreCredits > 0 && <div><dt>적립금 사용</dt><dd>−{krw(usedStoreCredits)}</dd></div>}
            <div><dt>배송비</dt><dd>{shippingReady ? shippingFeeLabel(shippingFee) : shipping.quote ? '배송지 확인 후 확정' : '확인 중'}</dd></div>
            <div className="checkout-total"><dt>결제 금액</dt><dd>{salePeriodNotice ? '주문할 수 없는 굿즈를 뺀 뒤 표시' : shippingReady && creditReady ? krw(subtotal + shippingFee - couponDiscount - usedStoreCredits) : '배송비·사용 조건 확인 후 표시'}</dd></div>
          </dl>

          {direct ? (
            <CheckoutDirectCoupon
              couponState={couponState}
              disabled={submitting}
              onSelect={setDirectCouponId}
              quote={shipping.sales?.coupon ?? null}
              selectedUserCouponId={directCouponId}
            />
          ) : (
            <CouponPicker
              appliedCoupon={appliedCoupon}
              couponState={couponState}
              disabled={submitting}
              onPendingChange={setCouponPending}
              quote={shipping.sales?.coupon ?? null}
              surface="checkout"
            />
          )}

          <fieldset className="checkout-method checkout-credit" disabled={submitting} aria-describedby="checkout-credit-note">
            <legend>적립금 사용</legend>
            <label className="checkout-credit__label" htmlFor="checkout-store-credits">사용 금액 (원)</label>
            <input id="checkout-store-credits" type="text" inputMode="numeric" value={storeCreditInput}
              disabled={credits.quote?.enabled === false || !shippingReady} aria-invalid={Boolean(creditProblem)}
              onChange={event => setStoreCreditInput(event.target.value)} placeholder="0" />
            {credits.quote ? <p className="checkout-credit__note" id="checkout-credit-note">{credits.quote.enabled
              ? !shippingReady ? `보유 ${krw(credits.quote.available)} · 사용 한도는 배송지 확인 후 안내합니다.`
                : `보유 ${krw(credits.quote.available)} · 이 주문에서 최대 ${krw(credits.quote.maxUse)} 사용 가능${credits.quote.minUse ? ` · 최소 ${krw(credits.quote.minUse)}` : ''}`
              : '현재 적립금 사용을 준비 중입니다.'}</p> : <p className="checkout-credit__note" id="checkout-credit-note">적립금 잔액과 이 주문의 사용 조건을 확인합니다.</p>}
            <details className="checkout-note">
              <summary>적립금 사용 기준</summary>
              <p>1원 단위로 굿즈 금액에 사용합니다. 배송비는 제외하며 쿠폰 적용 뒤 남은 금액에 적용됩니다.</p>
            </details>
            {credits.loading ? <p role="status">적립금 사용 조건을 확인하고 있어요.</p> : null}
            {credits.error ? <p role="alert">{credits.error} <button type="button" onClick={credits.refresh}>다시 조회</button></p> : null}
            {creditProblem ? <p className="checkout-error" role="alert">{creditProblem}</p> : null}
            {(requestedStoreCredits ?? 0) > 0 && <button type="button" onClick={() => setStoreCreditInput('')}>적립금 사용 취소</button>}
          </fieldset>

          {shipping.quote && shippingGroupsNotice(shipping.quote.groups) ? <p className="money-caption">{shippingGroupsNotice(shipping.quote.groups)}</p> : null}
          {shipping.quote?.groups.map((group, index, groups) => <section className="wc-shipping-group" key={group.originId}><h3>{shippingGroupLabel(groups, index)}</h3><ShippingGroupSummary group={group} /></section>)}
          {shipping.loading ? <p role="status">현재 가격과 배송비를 확인하고 있어요.</p> : null}
          {shipping.error ? <div role="alert"><p>{shipping.error}</p><button type="button" onClick={shipping.refresh}>가격·배송비 다시 확인</button></div> : null}
          {purchaseProblem && !(salePeriodNotice && purchaseProblem === GOODS_LINE_UNAVAILABLE_MESSAGE) ? <p className="checkout-error" role="alert">{copyFor(purchaseProblem)}
            {/* 첫구매 예약처럼 DB가 결제 대기 주문 때문이라고 알린 쿠폰 막힘은 그 주문 목록으로 잇는다(#540, 무통장 입금 대기 포함). */}
            {couponErrorNeedsPendingOrder(shipping.sales?.coupon?.reason) ? <PendingOrderResolution /> : null}
            {direct && !quoteMayBeBlockedByPendingOrder(shipping.sales ?? { goods: [], lines: [] }) ? <> <Link href={draftReturnHref}>굿즈로 돌아가기</Link></> : null}
          </p> : null}
          {couponSelectionChanged ? <p className="checkout-error" role="alert">다른 화면에서 선택한 쿠폰이 변경되었습니다. <button type="button" onClick={() => router.refresh()}>현재 쿠폰 다시 확인</button></p> : null}

          <fieldset className="checkout-method" aria-describedby="checkout-method-note">
            <legend>결제수단</legend>
            <label className="checkout-method-option">
              <input
                type="radio"
                name="paymentMethod"
                value="card"
                checked={selectedPaymentMethod === 'card'}
                disabled={!cardSelectable}
                onChange={() => setPaymentMethod('card')}
              />
              <span>
                <strong>신용·체크카드</strong>
                <small>{shipping.sales?.paymentMethods.card === false ? '이 주문에는 카드를 쓸 수 없는 굿즈가 있어요.' : '결제 후 바로 확정됩니다. 재고 선점 15분.'}</small>
              </span>
            </label>
            <label className="checkout-method-option">
              <input
                type="radio"
                name="paymentMethod"
                value="bank_transfer"
                checked={selectedPaymentMethod === 'bank_transfer'}
                disabled={!bankTransferSelectable}
                onChange={() => setPaymentMethod('bank_transfer')}
              />
              <span>
                <strong>무통장 입금</strong>
                <small>
                  {bankTransferMethodNote({
                    accountConfigured: bankTransferAvailable,
                    goodsAllow: bankTransferBlockedByCart || shipping.sales?.paymentMethods.bankTransfer === false
                      ? false
                      : shipping.sales ? true : null,
                  })}
                </small>
              </span>
            </label>
          </fieldset>
          {/* 결제수단 칸(aria-describedby)은 접힌 안내도 설명으로 읽는다. 펼쳐 볼 수 있게 접기만 한다(1014-020). */}
          <details className="checkout-note">
            <summary>결제수단 변경 안내</summary>
            <p id="checkout-method-note">결제수단은 주문을 만들 때 고정됩니다. 바꾸려면 주문을 취소하고 다시 만들어야 해요.</p>
          </details>

          {(unavailable || salePeriodNotice) && <p className="checkout-error" role="alert">{salePeriodNotice ?? copyFor(STOCK_CHANGED_COPY)}
            {draft ? <> <Link href={draftReturnHref}>{direct ? '굿즈로 돌아가기' : '장바구니로 돌아가기'}</Link></> : null}</p>}
          {!methodAvailable && <p className="checkout-error" role="alert">선택한 결제수단을 지금은 쓸 수 없어요. 다른 수단을 골라주세요.</p>}
          {submitError && !(salePeriodNotice && submitErrorCode && SALE_PERIOD_REJECTIONS.has(submitErrorCode)) && <p className="checkout-error" role="alert">{submitError}{pendingOrder ? <PendingOrderResolution /> : null}
            {blockingOrderId ? <> <Link href={`/orders/${encodeURIComponent(blockingOrderId)}`}>주문 보기</Link></> : null}
            {draftReturnNeeded ? <> <Link href={draftReturnHref}>{draft?.source === 'direct' ? '굿즈로 돌아가기' : '장바구니로 돌아가기'}</Link></> : null}</p>}
          {/* 결제 대기 주문(다른 탭의 바로구매·장바구니 주문)이 쿠폰·구매 한도·재고를 잡고 있을 수 있다 — 주문서를 열기만 해서는 그
              결제를 끊지 않으므로 실제로 찾았을 때만 그 주문을 알리고, 고객이 확인했을 때만 닫는다(ADR-0030). 경고 글과 나눈 상자다. */}
          <CheckoutPendingOrderRelease causes={pendingOrderCauses} onReleased={retryAfterRelease} />
          <button className="btn btn-holo checkout-submit" disabled={submitting || cartPending || couponPending || unavailable || !methodAvailable || !shippingReady || !shipping.sales || Boolean(purchaseProblem) || !creditReady || couponSelectionChanged || draftStale || Boolean(blockingOrderId)}>
            {submitting
              ? '재고를 확인하는 중'
              : selectedPaymentMethod === 'bank_transfer' ? '주문하고 입금 안내 받기' : '결제하기'}
          </button>
          <p className="money-caption">{checkoutSubmitCaption(draft?.source ?? null, selectedPaymentMethod)}</p>
          <Link className="checkout-back" href={draftReturnHref}>{draft?.source === 'direct' ? '← 굿즈로 돌아가기' : '← 장바구니 수정'}</Link>
        </aside>
      </form>
    </main>
  );
}
