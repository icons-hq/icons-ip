import { krw } from '@/lib/format';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import type { ShippingChargeDetails } from '@/lib/shipping-charge-groups';

/** These amounts are the saved calculation, already included in shipping totals. */
export function ShippingChargeDetailsDisplay({ details, names = {}, admin = false }: {
  details: ShippingChargeDetails; names?: Record<string, string>; admin?: boolean;
}) {
  const noun = admin ? adminGoodsCopy('굿즈') : '굿즈';
  /* 출고지는 운영 어휘다 — 고객 화면은 배송 묶음으로 말한다(R26). */
  const origin = admin ? '출고지' : '배송 묶음';
  return <details className="wc-shipping-charge-details">
    <summary>묶음배송 계산 내역</summary>
    <p>아래 금액은 선불·착불 배송비 합계에 이미 포함되어 있습니다.</p>
    <p>묶음 금액은 기간 할인 후, 복수구매 할인·쿠폰·적립금 적용 전 기준입니다.</p>
    <ol>{details.groups.map((group, index) => <li key={group.groupId}>
      <h4>묶음 {index + 1} · {group.mode === 'min' ? '최소 배송비 부과' : '최대 배송비 부과'}</h4>
      <p>{group.goodIds.map((id, goodIndex) => names[id] ?? `${noun} ${goodIndex + 1}`).join(' · ')}</p>
      <dl>
        <div><dt>합계 수량</dt><dd>{group.quantity.toLocaleString('ko-KR')}개</dd></div>
        <div><dt>묶음 대상 {noun} 금액</dt><dd>{krw(group.subtotal)}</dd></div>
        <div><dt>묶음 기본 배송비</dt><dd>{group.baseFee === 0 ? '무료' : krw(group.baseFee)}</dd></div>
        <div><dt>지역 추가 배송비</dt><dd>{group.regionMode === 'override'
          ? `${krw(group.regionalFee)} · 묶음당 1회`
          : `${origin} 지역 정책에 포함`}</dd></div>
        {admin ? <div><dt>주문 당시 그룹 설정</dt><dd>버전 {group.revision}</dd></div> : null}
      </dl>
    </li>)}</ol>
    {details.unassignedBaseFee > 0 ? <p>묶음 외 기본 배송비: {krw(details.unassignedBaseFee)}</p> : null}
    {details.originRegionFeeUnit !== null ? <p>{origin} 지역 추가 배송비: {krw(details.originRegionalFee)}
      {' · '}{details.originRegionFeeUnit === 'per_shipment' ? (admin ? '출고지 배송 건당 부과' : '배송 건당 부과') : `${origin} 정책의 ${noun} 단위 부과`}</p> : null}
  </details>;
}
