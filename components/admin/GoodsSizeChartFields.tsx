'use client';

import { useId } from 'react';
import { GOODS_SIZE_LIMITS, type GoodsSizeChart } from '@/lib/goods-size-chart';

export function GoodsSizeChartFields({ chart, onChange }: { chart: GoodsSizeChart; onChange: (chart: GoodsSizeChart) => void }) {
  const id = useId();
  const updateSize = (index: number, value: string) => onChange({ ...chart, sizes: chart.sizes.map((size, at) => at === index ? value : size) });
  const removeSize = (index: number) => onChange({ ...chart, sizes: chart.sizes.filter((_, at) => at !== index), measurements: chart.measurements.map(row => ({ ...row, values: row.values.filter((_, at) => at !== index) })) });
  const addSize = () => onChange({ ...chart, sizes: [...chart.sizes, ''], measurements: chart.measurements.map(row => ({ ...row, values: [...row.values, ''] })) });
  const updateRow = (index: number, change: Partial<GoodsSizeChart['measurements'][number]>) => onChange({ ...chart, measurements: chart.measurements.map((row, at) => at === index ? { ...row, ...change } : row) });
  return <div className="admin-goods-size-chart__fields">
    <label>치수 단위<select value={chart.unit} onChange={event => onChange({ ...chart, unit: event.target.value as 'cm' | 'mm' })}><option value="cm">cm</option><option value="mm">mm</option></select></label>
    <p id={`${id}-guide`} className="admin-goods-size-chart__hint">단위를 바꿔도 입력한 숫자는 변환되지 않습니다. 사이즈명 10자·10개, 측정 항목명 20자·10개까지 입력합니다. 치수는 0.1~99,999, 소수 한 자리까지 입력해주세요.</p>
    {chart.sizes.length ? <>
      <div className="admin-goods-size-chart__scroll" role="region" aria-label="사이즈 입력표 가로 스크롤" tabIndex={0}>
        <table aria-describedby={`${id}-guide`}><caption className="wc-sr-only">사이즈별 치수 입력</caption>
          <thead><tr><th scope="col">측정 항목</th>{chart.sizes.map((size, index) => <th key={index} scope="col"><label><span className="wc-sr-only">사이즈명 {index + 1}</span><input value={size} onChange={event => updateSize(index, event.target.value)} placeholder="사이즈명" /></label><button type="button" className="btn btn-sm" aria-label={`사이즈 ${index + 1} 삭제`} disabled={chart.sizes.length <= 1} onClick={() => removeSize(index)}>삭제</button></th>)}<th scope="col">행 관리</th></tr></thead>
          <tbody>{chart.measurements.map((row, rowIndex) => <tr key={rowIndex}>
            <th scope="row"><label><span className="wc-sr-only">측정 항목명 {rowIndex + 1}</span><input value={row.name} onChange={event => updateRow(rowIndex, { name: event.target.value })} placeholder="측정 항목명" /></label></th>
            {row.values.map((value, columnIndex) => <td key={columnIndex}><label><span className="wc-sr-only">{row.name || `측정 항목 ${rowIndex + 1}`} · {chart.sizes[columnIndex] || `사이즈 ${columnIndex + 1}`} 치수</span><input inputMode="decimal" type="text" maxLength={32} value={value} onChange={event => updateRow(rowIndex, { values: row.values.map((cell, at) => at === columnIndex ? event.target.value : cell) })} /></label></td>)}
            <td><button type="button" className="btn btn-sm" aria-label={`측정 항목 ${rowIndex + 1} 삭제`} disabled={chart.measurements.length <= 1} onClick={() => onChange({ ...chart, measurements: chart.measurements.filter((_, index) => index !== rowIndex) })}>삭제</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="admin-goods-size-chart__actions"><button className="btn" type="button" disabled={chart.sizes.length >= GOODS_SIZE_LIMITS.sizes} onClick={addSize}>사이즈 추가</button><button className="btn" type="button" disabled={chart.measurements.length >= GOODS_SIZE_LIMITS.measurements} onClick={() => onChange({ ...chart, measurements: [...chart.measurements, { name: '', values: chart.sizes.map(() => '') }] })}>측정 항목 추가</button></div>
      <label>측정 안내 (선택 · 500자)<textarea rows={3} value={chart.note} onChange={event => onChange({ ...chart, note: event.target.value })} /><small>{Array.from(chart.note).length} / 500자</small></label>
    </> : <div className="admin-goods-size-chart__empty"><p>등록된 사이즈표가 없습니다. 표를 작성하거나 템플릿을 불러오세요.</p><button className="btn" type="button" onClick={() => onChange({ ...chart, sizes: [''], measurements: [{ name: '', values: [''] }] })}>표 작성 시작</button></div>}
  </div>;
}
