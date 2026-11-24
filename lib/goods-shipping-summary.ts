import { krw } from './format';
import type { GoodShippingPolicy } from './fulfillment';
import { FULFILLMENT_METHOD_LABELS, type FulfillmentMethodTerms, type GoodsFulfillment } from './goods-fulfillment';
import type { GoodsTransactionOffer } from './goods-transaction-offers';

/*
 * 상품 상세 구매 패널의 "제공 방식" 안내 (MD-0041).
 *
 * 택배 굿즈는 `제공 방식: 택배` 한 줄 대신 `배송국가 · 배송비 · 도서산간 안내`를 보인다. 배송비 숫자는 전부 정책 데이터에서 읽는다
 * — 무료배송 기준 같은 값을 코드에 적지 않는다(운영 정책이 바뀌면 화면이 따라간다). 순수 함수라 화면과 따로 시험한다.
 */

/** 현 주문서는 국내 주소만 받는다. */
export const DOMESTIC_SHIPPING_COUNTRY_LABEL = '대한민국';
export const SHIPPING_COUNTRY_ROW_LABEL = '배송국가';
export const SHIPPING_FEE_ROW_LABEL = '배송비';
export const REMOTE_AREA_EXTRA_FEE_NOTICE = '도서산간 지역은 추가 비용이 발생할 수 있습니다.';

export interface GoodsShippingRow { label: string; value: string }

export interface GoodsParcelShipping {
  /** `배송국가`, (있으면) `배송비` 순서의 행. */
  rows: GoodsShippingRow[];
  /** 행 아래 한 문장. */
  notice: string;
}

export interface GoodsShippingSummary {
  /** `제공 방식: …` 줄에 들어갈 방식 라벨. 줄을 두지 않으면 null — 택배 하나뿐인 굿즈는 택배 블록이 줄을 대신한다. */
  methodsLabel: string | null;
  /** 택배 블록. 택배 방식이 없거나 디지털 굿즈면 null. */
  parcel: GoodsParcelShipping | null;
  /** 디지털 굿즈의 파일 제공 안내 문단을 붙인다. */
  digital: boolean;
  /** 운영자가 적은 공개 안내. */
  publicNote: string;
}

/** 0원은 숫자 대신 `무료`로 읽힌다. */
const feeText = (amount: number) => (amount === 0 ? '무료' : krw(amount));

function parcelFeeValue(
  parcel: FulfillmentMethodTerms,
  shippingPolicy: GoodShippingPolicy | null | undefined,
  offer: Pick<GoodsTransactionOffer, 'delivery' | 'chargeGroup'> | null | undefined,
): string | null {
  /* ① 방식 조건에 배송비가 직접 있으면 그 값이다. */
  if (parcel.feeAmount !== null) return `${feeText(parcel.feeAmount)}${parcel.feeBasis === 'per_item' && parcel.feeAmount > 0 ? ' (상품당)' : ''}`;
  /* ② 굿즈별 배송비 조건·묶음배송은 같은 패널의 거래 조건 블록이 정확한 조건을 이미 그린다 — 여기서 다른 숫자를 말하지 않는다. */
  if (offer?.delivery || offer?.chargeGroup) return null;
  /* ③ 출고지 배송비 정책. */
  if (!shippingPolicy) return null;
  if (shippingPolicy.feeType === 'free') return '무료';
  if (shippingPolicy.feeType === 'individual') return `${feeText(shippingPolicy.individualFee)}${shippingPolicy.individualFee > 0 ? ' (상품당 1회)' : ''}`;
  if (shippingPolicy.baseFee === 0) return '무료';
  return `${krw(shippingPolicy.baseFee)}${shippingPolicy.freeThreshold === null ? '' : ` (${krw(shippingPolicy.freeThreshold)} 이상 무료)`}`;
}

/**
 * 구매 패널 `제공 방식` 영역의 표시 모델. `fulfillment` 가 없으면(거래 조건을 못 읽은 굿즈 포함) null — 아무것도 그리지 않는다.
 * - 디지털 굿즈: 제공 방식 줄 + 공개 안내 + 파일 제공 안내(현행).
 * - 택배 하나뿐: 제공 방식 줄 없이 택배 블록만.
 * - 택배 + 다른 방식(방문수령 등): 제공 방식 줄을 남겨 고를 수 있는 수령 방식을 보이고, 택배 블록을 더한다.
 * - 택배 없음: 제공 방식 줄(현행).
 *
 * `shippingPolicy`의 세 상태를 구분한다. `undefined` = 호출부가 정책을 싣지 않았다(위시리스트 구매 시트처럼 정책을 읽지 않는 화면) —
 * 배송비를 말할 수 없으니 택배 블록을 그리지 않고 옛 `제공 방식: 택배 …` 줄로 물러난다. `null` = 상품 상세가 읽었는데 정책이 없다 —
 * 택배 블록에서 배송비 행만 뺀다(굿즈별 조건이 있으면 그것이 배송비를 말한다). 값이 있으면 정책으로 배송비를 말한다.
 */
export function goodsShippingSummary(
  fulfillment: GoodsFulfillment | null | undefined,
  shippingPolicy: GoodShippingPolicy | null | undefined,
  offer: Pick<GoodsTransactionOffer, 'delivery' | 'chargeGroup'> | null | undefined,
): GoodsShippingSummary | null {
  if (!fulfillment) return null;
  const digital = fulfillment.mode === 'digital';
  const labels = fulfillment.methods.map(method => FULFILLMENT_METHOD_LABELS[method.method]);
  const parcelTerms = digital ? undefined : fulfillment.methods.find(method => method.method === 'parcel');
  /* 정책을 싣지 않은 호출부는 택배 블록을 그릴 근거가 없다 — 택배 하나뿐이어도 옛 제공 방식 줄이 택배를 말한다. */
  const policyUnknown = shippingPolicy === undefined;
  const parcelOnly = Boolean(parcelTerms) && fulfillment.methods.length === 1 && !policyUnknown;
  const methodsLabel = parcelOnly || labels.length === 0 ? null : labels.join(' · ');
  if (!parcelTerms || policyUnknown) return { methodsLabel, parcel: null, digital, publicNote: fulfillment.publicNote };

  const rows: GoodsShippingRow[] = [{ label: SHIPPING_COUNTRY_ROW_LABEL, value: DOMESTIC_SHIPPING_COUNTRY_LABEL }];
  const fee = parcelFeeValue(parcelTerms, shippingPolicy, offer);
  if (fee !== null) rows.push({ label: SHIPPING_FEE_ROW_LABEL, value: fee });
  return { methodsLabel, parcel: { rows, notice: REMOTE_AREA_EXTRA_FEE_NOTICE }, digital, publicNote: fulfillment.publicNote };
}
