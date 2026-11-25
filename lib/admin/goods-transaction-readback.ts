import { calculateGoodsQuantityDelivery, parseGoodsDeliveryQuantityTerms, type GoodsDeliveryQuantityTerms } from '@/lib/goods-delivery-pricing';
import { parseGoodsVolumeDiscountTerms } from '@/lib/goods-volume-discount';
import { krwAmountWords } from '@/lib/format';
import type { GoodsTermsDraft } from '@/lib/admin/goods-transaction-terms';

/*
 * 복수구매 할인·수량별 배송비 입력을 운영자가 읽는 한 줄로 되읽는다('글보다 화면' 3단계).
 * 금액은 고객 화면과 결제가 쓰는 계산(calculateGoodsQuantityDelivery)으로 구하고, 입력이 규칙에 맞지 않으면 아무것도 말하지 않는다.
 * 저장 전 입력(문자열)을 보는 읽기 전용 함수라 저장·계산 계약을 바꾸지 않는다.
 */
type DeliveryFields = GoodsTermsDraft['delivery']['fields'];
type VolumeFields = GoodsTermsDraft['volume']['fields'];

const integer = (value: string): number | null => (/^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null);
const count = (value: number) => `${value.toLocaleString('ko-KR')}개`;

/** 입력한 칸 값으로 수량별 배송비 규칙을 만든다. '상품의 배송비 그대로'이거나 값이 규칙에 맞지 않으면 null. */
export function goodsDeliveryTermsFromFields(fields: DeliveryFields): GoodsDeliveryQuantityTerms | null {
  const baseFee = integer(fields.baseFee);
  if (fields.kind === 'repeat') return parseGoodsDeliveryQuantityTerms({ kind: 'repeat', baseFee, interval: integer(fields.interval) });
  if (fields.kind === 'tier2') return parseGoodsDeliveryQuantityTerms({ kind: 'tier2', baseFee, firstLimit: integer(fields.firstLimit), extra1: integer(fields.extra1) });
  if (fields.kind === 'tier3') {
    return parseGoodsDeliveryQuantityTerms({ kind: 'tier3', baseFee, firstLimit: integer(fields.firstLimit), secondLimit: integer(fields.secondLimit),
      extra1: integer(fields.extra1), extra2: integer(fields.extra2) });
  }
  return null;
}

export interface GoodsDeliveryReadbackRow { from: number; to: number | null; fee: number }

/** 개수 구간마다 받는 배송비. 마지막 구간의 to가 null이면 그 개수부터 끝까지다. 반복형은 처음 세 구간만 보인다. */
export function goodsDeliveryReadbackRows(terms: GoodsDeliveryQuantityTerms): GoodsDeliveryReadbackRow[] {
  if (terms.kind === 'repeat') {
    return [0, 1, 2].map((step) => ({ from: step * terms.interval + 1, to: (step + 1) * terms.interval, fee: calculateGoodsQuantityDelivery(step * terms.interval + 1, terms) }));
  }
  const limits = terms.kind === 'tier2' ? [terms.firstLimit] : [terms.firstLimit, terms.secondLimit];
  return [1, ...limits.map((limit) => limit + 1)].map((from, index) => ({ from, to: index < limits.length ? limits[index] : null, fee: calculateGoodsQuantityDelivery(from, terms) }));
}

/** "1~2개 3,000원 · 3~4개 6,000원 · 5~6개 9,000원 · …" 같은 한 줄. 규칙에 맞지 않는 입력이면 null. */
export function goodsDeliveryReadback(fields: DeliveryFields): string | null {
  const terms = goodsDeliveryTermsFromFields(fields);
  if (!terms) return null;
  const rows = goodsDeliveryReadbackRows(terms).map((row) => {
    const range = row.to === null ? `${count(row.from)}부터` : row.to === row.from ? count(row.from) : `${row.from.toLocaleString('ko-KR')}~${count(row.to)}`;
    return `${range} ${krwAmountWords(row.fee)}`;
  });
  return `${rows.join(' · ')}${terms.kind === 'repeat' ? ' · …' : ''}`;
}

/** 고객 화면(상품 상세·주문서)이 말하는 배송비 결제 방식과 같은 말(lib/goods-transaction-presentation.ts의 goodsDeliveryPaymentLabel). */
export const GOODS_DELIVERY_PAYMENT_READBACK: Record<string, string> = {
  prepaid: '배송비는 주문 시 선결제',
  collect: '배송비는 배송 시 결제(착불)',
  buyer_choice: '주문서에서 배송비 선결제 또는 착불 선택',
};

const period = (value: string) => value.replace('T', ' ').slice(0, 16);

/** 복수구매 할인 입력의 한 줄 요약. 조건·할인값이 규칙에 맞지 않으면 null이고, 기간은 시작·종료를 함께 넣어야 말한다. */
export function goodsVolumeReadback(fields: VolumeFields): string | null {
  const terms = parseGoodsVolumeDiscountTerms({ condition: fields.condition, threshold: integer(fields.threshold), discountKind: fields.discountKind,
    discountValue: integer(fields.discountValue), startsAt: null, endsAt: null });
  if (!terms) return null;
  const when = terms.condition === 'quantity' ? `같은 상품을 ${count(terms.threshold)} 이상 사면` : `같은 상품의 정상가 합계가 ${krwAmountWords(terms.threshold)} 이상이면`;
  const discount = terms.discountKind === 'percent' ? `${terms.discountValue}%` : krwAmountWords(terms.discountValue);
  const head = `${when} 개당 ${discount}씩 깎아 줍니다.`;
  if (!fields.startsAt && !fields.endsAt) return `${head} 기간 제한 없이 항상 적용됩니다.`;
  if (!fields.startsAt || !fields.endsAt) return `${head} 기간은 시작과 종료를 함께 넣어야 합니다.`;
  return `${head} ${period(fields.startsAt)}부터 ${period(fields.endsAt)}까지(KST) 적용됩니다.`;
}

/** 옵션 기간 할인 입력의 한 줄 요약. 할인가는 판매가보다 낮아야 하고 시작이 종료보다 앞서야 하며, 맞지 않으면 말하지 않는다. */
export function goodsPricePeriodReadback(input: { optionName: string; price: number; discountPrice: string; startsAt: string; endsAt: string }): string | null {
  const discount = integer(input.discountPrice);
  if (discount === null || discount < 1 || discount >= input.price || !input.startsAt || !input.endsAt || input.startsAt >= input.endsAt) return null;
  return `${input.optionName}: ${period(input.startsAt)}부터 ${period(input.endsAt)}까지(KST) ${krwAmountWords(discount)}에 팝니다. 판매가 ${krwAmountWords(input.price)}보다 ${krwAmountWords(input.price - discount)} 낮고, 끝나면 ${krwAmountWords(input.price)}으로 돌아갑니다.`;
}
