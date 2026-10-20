import type { GoodsSizeChart } from '@/lib/goods-size-chart';

/** The public table and the editor preview use the same markup. No purchase state belongs here. */
export function GoodSizeChart({ chart }: { chart: GoodsSizeChart | null }) {
  if (!chart) return null;
  return <section className="wc-goods-size-chart" aria-label="사이즈 안내">
    <div className="wc-goods-size-chart__heading"><h2>사이즈 안내</h2><span>단위: {chart.unit}</span></div>
    <div className="wc-goods-size-chart__scroll" role="region" aria-label="사이즈 안내표 가로 스크롤" tabIndex={0}>
      <table><caption className="sr-only">사이즈별 측정 치수 (단위: {chart.unit})</caption>
        <thead><tr><th scope="col">측정 항목</th>{chart.sizes.map(size => <th key={size} scope="col">{size}</th>)}</tr></thead>
        <tbody>{chart.measurements.map(row => <tr key={row.name}><th scope="row">{row.name}</th>{row.values.map((value, index) => <td key={chart.sizes[index]}>{value}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {chart.note ? <p className="wc-goods-size-chart__note">{chart.note}</p> : null}
  </section>;
}
