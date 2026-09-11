import { goodsKcDisclosureRows, type GoodsKcDisclosure as Disclosure } from '@/lib/goods-kc';

export function GoodsKcDisclosure({ disclosures, title = '제품 안전정보' }: { disclosures: readonly Disclosure[]; title?: string }) {
  if (!disclosures.length) return null;
  return <section className="wc-pdp-notice" aria-label={title}>
    <h2 className="wc-pdp-panel__title">{title}</h2>
    {disclosures.map((disclosure, index) => <div className="wc-pdp-notice__scroll" key={`${index}:${disclosure.modelName}:${disclosure.scheme}`}>
      <table className="wc-pdp-notice__table">
        <caption className="wc-pdp-notice__caption">{disclosure.modelName}</caption>
        <tbody>{goodsKcDisclosureRows(disclosure).map(([label, value]) => <tr key={label}>
          <th scope="row">{label}</th><td style={{ whiteSpace: 'pre-wrap' }}>{value}</td>
        </tr>)}</tbody>
      </table>
    </div>)}
  </section>;
}
