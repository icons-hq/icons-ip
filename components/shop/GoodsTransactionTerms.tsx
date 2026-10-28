import { productionLeadLabel } from '@/lib/order-production';
import type { Good } from '@/lib/data';
import { krw } from '@/lib/format';
import { goodsDeliveryPaymentLabel, goodsQuantityDeliveryLabel, goodsQuantityDeliveryPreview, goodsVolumeConditionLabel } from '@/lib/goods-transaction-presentation';

const periodLabel = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
export function GoodsTransactionTerms({ good, quantity }: { good: Good; quantity: number }) {
  const offer = good.transactionOffer;
  if (offer === undefined) return null;
  if (offer === null) return <p className="wc-buy-panel__state" role="status">할인·배송 조건을 확인하지 못했습니다. 주문서에서 다시 확인해주세요.</p>;
  const volume = goodsVolumeConditionLabel(offer);const delivery = offer.delivery;
  if (!volume && !delivery && !offer.chargeGroup && !offer.production) return null;
  const baseFee = goodsQuantityDeliveryPreview(offer, quantity);
  return <section className="wc-pdp-transaction-terms" aria-label={`${good.name} 할인과 배송 조건`}>
    {offer.production ? <><strong>주문 후 제작</strong><p>결제 확인 후 {productionLeadLabel(offer.production)} 내 발송 예정입니다. 배송 기간은 별도입니다.</p>{offer.production.publicNote ? <p>{offer.production.publicNote}</p> : null}<p>제작 시작 후 취소는 접수 후 담당자가 검토합니다.</p></> : null}
    {volume ? <><strong>복수구매 할인</strong><p>{volume}</p><p>같은 굿즈의 옵션·입력 문구별 수량을 합산합니다. 추가 구성 굿즈는 각각 계산합니다.</p>
      {offer.volume?.terms?.startsAt && offer.volume.terms.endsAt ? <p>{periodLabel(offer.volume.terms.startsAt)}부터 {periodLabel(offer.volume.terms.endsAt)} 전까지 · 한국 시간</p> : null}</> : null}
    {delivery ? <><strong>배송비</strong>{delivery.quantityTerms ? <p>{goodsQuantityDeliveryLabel(delivery.quantityTerms)} · 같은 굿즈의 옵션 수량 합산</p> : null}
      {baseFee !== null ? <p>{offer.chargeGroup ? '이 굿즈만 ' : '선택 '}{quantity.toLocaleString('ko-KR')}개{offer.chargeGroup ? ' 구매 시' : ''} 기본 배송비 {krw(baseFee)} · 지역 추가배송비 별도</p> : null}
      <p>{goodsDeliveryPaymentLabel(offer)}</p>
      {delivery.paymentMode !== 'prepaid' ? offer.collector ? <p>{offer.collector.name} · {offer.collector.method}<br />환급 문의: {offer.collector.refundContact}<br />{offer.collector.instructions}</p>
        : <p>착불 수납 조건을 확인 중입니다. 주문서에서 주문 가능 여부를 확인해주세요.</p> : null}</> : null}
    {offer.chargeGroup ? <><strong>묶음배송</strong>
      <p>같은 배송 묶음의 묶음 대상 굿즈를 함께 구매하면 {offer.chargeGroup.calculationMode === 'min' ? '가장 작은' : '가장 큰'} 기본 배송비를 한 번 부과합니다. 무료배송 조건을 충족하면 기본 배송비는 무료입니다.</p>
      <p>수량별 배송비와 무료 기준은 실제 구매한 묶음 대상의 합계로 계산합니다. 정확한 선불·착불 배송비는 주문서에서 확인해주세요.</p>
      <p>{offer.chargeGroup.regionalMode === 'override' ? '지역 추가 배송비는 해당 묶음 정책으로 한 번 계산합니다.' : '지역 추가 배송비는 배송 묶음의 지역 정책을 따릅니다.'}</p>
      {!offer.chargeGroup.available ? <p role="status">묶음배송 조건을 확인 중입니다. 주문서에서 주문 가능 여부를 확인해주세요.</p> : null}
    </> : null}
  </section>;
}
