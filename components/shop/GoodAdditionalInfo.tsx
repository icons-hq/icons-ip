import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Good } from '@/lib/data';
import { krw } from '@/lib/format';
import { shippingPolicyDescription, type GoodShippingPolicy } from '@/lib/fulfillment';
import { goodsShipDateLabel } from '@/lib/goods-preorders';
import { goodsQuantityDeliveryLabel } from '@/lib/goods-transaction-presentation';
import { BUSINESS_INFO, businessInfoRows, type BusinessInfo } from '@/lib/legal/business-info';
import { LEGAL_DOCUMENT_LABELS, legalDocumentHref } from '@/lib/legal/links';

/*
 * 굿즈 상세 '추가정보' 탭 (PD-06 · 11 §3 Δ4).
 *
 * `<details>` 아코디언 4개 — 고시정보 / 배송 안내 / 교환 · 반품 안내 / 판매자 정보. 내용은 기존
 * 데이터 그대로다: 고시정보(상세 패널에서 옮김 — 표는 호출부가 그려 넘긴다), 배송 정책(고객에게는 출고지 대신 배송 묶음·택배사로 말한다 — R26)·
 * 예약 발송일, 기존 교환·반품 안내, 공개 사업자 정보(푸터와 같은 소스 — 비어 있는 칸은 행이 사라진다).
 * 펼침 제목은 각 절의 이름이다 — 용어는 CONTEXT.md(고시정보)를 따른다.
 */

function InfoItem({ children, id, title }: { children: ReactNode; id: string; title: string }) {
  return (
    <details className="wc-pdp-info__item">
      <summary className="wc-pdp-info__summary">
        <span id={id}>{title}</span>
      </summary>
      <div aria-labelledby={id} className="wc-pdp-info__body" role="group">
        {children}
      </div>
    </details>
  );
}

function ShippingGuide({ goods, policy }: { goods: readonly Good[]; policy?: GoodShippingPolicy | null }) {
  const preorders = goods.flatMap(good => (good.options ?? [])
    .filter(option => option.supply?.mode === 'preorder')
    .map(option => ({ id: option.id, label: `${good.name} · ${option.name}`, date: option.supply!.expectedShipDate })));
  return (
    <div className="wc-pdp-guide">
      <ul className="wc-pdp-guide__list">
        <li>{goods[0]?.transactionOffer?.delivery?.quantityTerms ? goodsQuantityDeliveryLabel(goods[0].transactionOffer.delivery.quantityTerms)
          : policy ? shippingPolicyDescription(policy) : '배송 정책을 확인하지 못했습니다. 주문 전에 배송비를 확인해주세요.'}</li>
        {policy?.shippingNotice && <li style={{ whiteSpace: 'pre-wrap' }}>{policy.shippingNotice}</li>}
        <li>배송 묶음마다 정책 적용 굿즈의 기간 할인 적용 후, 복수구매 할인·쿠폰·적립금 차감 전 소계로 무료배송 조건을 확인합니다. 수량별 배송비에는 별도 무료 기준이 적용되지 않으며, 택배사가 달라 따로 배송되는 굿즈의 배송비는 각각 더합니다.</li>
        {/*
         * 출고 기한의 진실원은 배송·반품 정책(/legal/shipping 1. 배송 안내)이다. 여기서 더 짧은
         * 영업일 수를 따로 적으면 약관 제13조 3항이 손해배상 기준으로 삼는 "약정 배송기간"이
         * 두 개가 되어, 어느 쪽이 약정인지 정할 수 없다. 그래서 정책 문장을 그대로 싣는다.
         */}
        {preorders.length ? <>
          <li>예약판매 옵션은 아래 발송 예정일에 맞춰 공급을 준비합니다. 같은 배송 묶음의 일반 굿즈와 예약 굿즈를 함께 주문하면 가장 늦은 예정일에 함께 발송합니다. 주문서에서 최종 발송 예정일을 확인해주세요.</li>
          {preorders.map(option => <li key={option.id}>{option.label}: {goodsShipDateLabel(option.date)}</li>)}
          <li>일반 판매 옵션만 주문한 경우에는 기본 배송 정책을 따릅니다. 예약 공급 일정이 바뀌면 주문 상세에서 변경된 예정일을 확인할 수 있습니다.</li>
        </> : <li>대금을 먼저 지급하는 선지급 주문이므로, 결제가 확정된 날부터 3영업일 이내에 배송에 필요한 조치를 취합니다. 무통장 입금 주문은 입금이 확인된 날이 결제 확정일입니다. 공급 절차가 늦어지면 그 진행 상황을 알립니다.</li>}
        <li>배송지에 따른 추가 배송비는 주문서에서 주소를 입력한 뒤 확인합니다. 배송 가능 여부와 최종 배송비를 확인해야 주문할 수 있습니다.</li>
        <li>원화(KRW)로 결제하며 대한민국 주소로 배송합니다. 국내 배송대행지를 이용할 수 있고, 이후 해외 운송은 고객이 배송대행사에 별도로 신청합니다.</li>
      </ul>
    </div>
  );
}

function ReturnGuide({ policy }: { policy?: GoodShippingPolicy | null }) {
  const terms = policy?.claimPolicy;
  return (
    <div className="wc-pdp-guide">
      <ul className="wc-pdp-guide__list">
        {terms?.restrictionReason && <li style={{ whiteSpace: 'pre-wrap' }}>굿즈별 확인 조건: {terms.restrictionReason} · 고객센터에 사유를 접수하면 개별 확인합니다.</li>}
        {terms && <>
          <li>고객 귀책 반품비(편도): {terms.returnFee === null ? '확인 후 안내' : krw(terms.returnFee)}</li>
          <li>최초 무료배송 후 반품비(왕복 합계): {terms.returnFreeShippingFee === null ? '확인 후 안내' : krw(terms.returnFreeShippingFee)}</li>
          <li>고객 귀책 교환비(왕복 합계): {terms.exchangeFee === null ? '확인 후 안내' : krw(terms.exchangeFee)}</li>
        </>}
        {policy?.returnExchangeNotice && <li style={{ whiteSpace: 'pre-wrap' }}>{policy.returnExchangeNotice}</li>}
        {policy?.returnAddress && <li>회수 주소: {policy.returnAddress} · 먼저 고객센터에 접수한 뒤 안내에 따라 보내주세요.</li>}
        {policy?.cs && (policy.cs.name || policy.cs.phone || policy.cs.email) && <li>고객센터: {[policy.cs.name, policy.cs.phone, policy.cs.email].filter(Boolean).join(' · ')}</li>}
        <li>굿즈를 받은 날부터 7일 이내에 청약철회를 신청할 수 있습니다.</li>
        <li>단순 변심으로 반품하는 경우 반송비는 구매자가 부담하며 착불로 보내주세요.</li>
        <li>굿즈가 파손·오배송된 경우에는 반송비를 ICONS가 부담합니다.</li>
        <li>사용·훼손해 재판매가 어려워진 굿즈는 청약철회가 제한될 수 있습니다.</li>
      </ul>
      {/* 요약만 두면 반송비 부담·반품 절차·환급 기한을 확인할 곳이 없다. 전문은 정책 문서가 진실원이다. */}
      <Link className="wc-pdp-guide__link" href={legalDocumentHref('shipping')}>
        {LEGAL_DOCUMENT_LABELS.shipping} 전문 보기
      </Link>
    </div>
  );
}

export function GoodAdditionalInfo({
  goods,
  notice,
  sellerInfo = BUSINESS_INFO,
  shippingPolicy,
}: {
  /** 고시정보 표(또는 미등록 안내). */
  notice: ReactNode;
  /** 배송 안내가 예약 발송일을 읽는 굿즈 — 본품과 지금 고른 추가 구성. */
  goods: readonly Good[];
  sellerInfo?: BusinessInfo;
  shippingPolicy?: GoodShippingPolicy | null;
}) {
  const sellerRows = businessInfoRows(sellerInfo);

  return (
    <div className="wc-pdp-info">
      <InfoItem id="pdp-notice-heading" title="고시정보">
        {notice}
      </InfoItem>
      <InfoItem id="pdp-shipping-heading" title="배송 안내">
        <ShippingGuide goods={goods} policy={shippingPolicy} />
      </InfoItem>
      <InfoItem id="pdp-return-heading" title="교환 · 반품 안내">
        <ReturnGuide policy={shippingPolicy} />
      </InfoItem>
      {/* 사업자 정보가 아직 확정 전이면(#239) 있는 값만 보이고, 하나도 없으면 칸을 두지 않는다. */}
      {sellerRows.length ? (
        <InfoItem id="pdp-seller-heading" title="판매자 정보">
          <div className="wc-pdp-notice__scroll">
            <table className="wc-pdp-seller__table">
              <tbody>
                {sellerRows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </InfoItem>
      ) : null}
    </div>
  );
}
