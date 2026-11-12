import {
  goodsKcDisclosureRows, goodsOtherCertificationRow,
  type GoodsKcDisclosure as Disclosure, type GoodsOtherCertificationDisclosure,
} from '@/lib/goods-kc';

/*
 * 상품 상세의 제품 안전정보. KC 고지(검토를 마친 모델) 뒤에 판매자가 고객 노출을 고른 기타 인증(SHEET-014·ADR-0036)을
 * 같은 표 모양으로 잇는다. 기타 인증은 KC 고지를 대신하지 않으며, KC 표가 없어도 기타 인증만으로 이 영역을 보인다.
 */
export function GoodsKcDisclosure({ disclosures, otherCertifications = [], title = '제품 안전정보' }: {
  disclosures: readonly Disclosure[]; otherCertifications?: readonly GoodsOtherCertificationDisclosure[]; title?: string;
}) {
  if (!disclosures.length && !otherCertifications.length) return null;
  return <section className="wc-pdp-notice" aria-label={title}>
    <h2 className="wc-pdp-panel__title">{title}</h2>
    {disclosures.map((disclosure, index) => <div className="wc-pdp-notice__scroll" key={`${index}:${disclosure.modelName}:${disclosure.scheme}`}>
      <table className="wc-pdp-notice__table">
        {disclosure.modelName ? <caption className="wc-pdp-notice__caption">{disclosure.modelName}</caption> : null}
        <tbody>{goodsKcDisclosureRows(disclosure, { sole: disclosures.length === 1 }).map(([label, value]) => <tr key={label}>
          <th scope="row">{label}</th><td style={{ whiteSpace: 'pre-wrap' }}>{value}</td>
        </tr>)}</tbody>
      </table>
    </div>)}
    {otherCertifications.length ? <div className="wc-pdp-notice__scroll" data-other-certifications="">
      <table className="wc-pdp-notice__table">
        <caption className="wc-pdp-notice__caption">기타 인증</caption>
        <tbody>{otherCertifications.map((certification, index) => {
          const [label, value] = goodsOtherCertificationRow(certification);
          return <tr key={`${index}:${certification.kind}:${certification.number}`}><th scope="row">{label}</th><td style={{ whiteSpace: 'pre-wrap' }}>{value}</td></tr>;
        })}</tbody>
      </table>
    </div> : null}
  </section>;
}
