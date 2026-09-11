'use client';
import { useEffect, useState } from 'react';
import { generateGoodsOptionRows, type GoodsOptionAxis, type GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import { AdminField, AdminFormGrid } from './console/AdminKit';

export function GoodsOptionEditor({ initialRows, baseline, basePrice, error, axisValues, onRowsChange, codePrefix }: {
  initialRows: GoodsOptionRow[]; baseline: string[]; basePrice: number; error?: string; axisValues?: Record<string, string>; onRowsChange?: (rows: GoodsOptionRow[]) => void; codePrefix?: string;
}) {
  const [rows, setRows] = useState(initialRows);
  // Fresh option props must not authorize rows from an older editor mount.
  // Keep the optimistic baseline in the same snapshot as the editable rows.
  const [baselineSnapshot] = useState(() => [...baseline]);
  useEffect(() => { onRowsChange?.(rows); }, [rows, onRowsChange]);
  const firstAttributes = initialRows[0]?.attributes ?? {};
  const initialAxes = Object.keys(firstAttributes).map((name) => ({ name, values: [...new Set(initialRows.map((row) => row.attributes[name]))].join(', ') }));
  const [axes, setAxes] = useState<GoodsOptionAxis[]>([0, 1].map((i) => ({ name: axisValues?.[`optionAxisName${i}`] ?? initialAxes[i]?.name ?? '', values: axisValues?.[`optionAxisValues${i}`] ?? initialAxes[i]?.values ?? '' })));
  const [generationError, setGenerationError] = useState('');
  function update(index: number, changes: Partial<GoodsOptionRow>) { setRows((current) => current.map((row, i) => i === index ? { ...row, ...changes } : row)); }
  function move(index: number, direction: number) { setRows((current) => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; }); }
  return <div className="col" style={{ gap: 16 }}>
    <p>옵션코드는 자동 제안을 참고해 비워두면 저장 시 확정됩니다. 단일 상품은 기본 옵션의 초기 재고만 입력하면 됩니다. 추가 옵션은 축을 입력한 뒤 조합을 생성하세요. 첫 행이 기본 옵션입니다.</p>
    <p id="goods-option-stock-guidance">안전재고는 부족 경보 기준입니다. 재고 10개·기준 3개이면 10개 모두 판매할 수 있습니다. 비워두면 경보하지 않으며, 사용 중지는 재고와 주문 이력을 보존합니다.</p>
    <p id="goods-option-external-identity-guidance">ERP 코드·ERP 품명·바코드는 옵션별 외부 식별자입니다. 자체 옵션코드와 별도로 입력하며, 선행 0은 유지됩니다. 비워두면 미설정으로 저장합니다.</p>
    <details open={rows.length > 1 || undefined}>
      <summary>옵션 축 설정 · 최대 100개 조합</summary>
      <AdminFormGrid>{axes.map((axis, index) => <div key={index}>
        <AdminField inputId={`option-axis-${index}`} label={`옵션 축 ${index + 1}${index ? ' (선택)' : ''}`}>
          <input id={`option-axis-${index}`} name={`optionAxisName${index}`} value={axis.name} maxLength={40} placeholder={index ? '사이즈' : '색상'} onChange={(event) => setAxes((old) => old.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
        </AdminField>
        <AdminField inputId={`option-values-${index}`} label="값 (쉼표로 구분)">
          <input id={`option-values-${index}`} name={`optionAxisValues${index}`} value={axis.values} placeholder={index ? 'S, M, L' : '빨강, 파랑'} onChange={(event) => setAxes((old) => old.map((item, i) => i === index ? { ...item, values: event.target.value } : item))} />
        </AdminField>
      </div>)}</AdminFormGrid>
      <button type="button" className="btn btn-ghost" onClick={() => {
        const result = generateGoodsOptionRows(axes.filter((axis, i) => i === 0 || axis.name.trim() || axis.values.trim()), rows);
        if (!result.ok) { setGenerationError(result.error); return; }
        setRows(result.rows); setGenerationError('');
      }}>조합 생성</button>
      <p>같은 조합의 가격·재고·코드는 유지합니다. 빠진 조합은 저장할 때 제거되며, 주문이나 장바구니에 쓰인 옵션은 보관됩니다.</p>
    </details>
    {(error || generationError) && <p role="alert">{error || generationError}</p>}
    {rows.every((row) => row.isActive === false) && <p role="status">모든 옵션이 사용 중지되어 고객이 구매할 수 없습니다.</p>}
    <div style={{ overflowX: 'auto' }}><table className="wc-admin-table"><caption className="sr-only">옵션별 가격·할당 재고·ERP 식별자·사용 상태</caption>
      <thead><tr><th>옵션</th><th>옵션코드</th><th>ERP 코드</th><th>ERP 품명</th><th>바코드</th><th>추가금액</th><th>옵션 판매가</th><th>재고</th><th>안전재고 기준</th><th>사용 상태</th><th>순서·제거</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.id ?? JSON.stringify(row.attributes)}>
        <td><input aria-label={`옵션 ${index + 1} 이름`} value={row.name} maxLength={200} onChange={(event) => update(index, { name: event.target.value })} /></td>
        <td><input aria-label={`옵션 ${index + 1} 코드`} value={row.code} maxLength={120} placeholder={codePrefix ? `${codePrefix}-${String(index + 1).padStart(2, '0')}` : '저장 시 자동 생성'} onChange={(event) => update(index, { code: event.target.value })} /></td>
        <td><input aria-label={`옵션 ${index + 1} ERP 코드`} aria-describedby="goods-option-external-identity-guidance" value={row.erpCode ?? ''} maxLength={120} placeholder="미설정" onChange={(event) => update(index, { erpCode: event.target.value })} /></td>
        <td><input aria-label={`옵션 ${index + 1} ERP 품명`} aria-describedby="goods-option-external-identity-guidance" value={row.erpName ?? ''} maxLength={200} placeholder="미설정" onChange={(event) => update(index, { erpName: event.target.value })} /></td>
        <td><input aria-label={`옵션 ${index + 1} 바코드`} aria-describedby="goods-option-external-identity-guidance" value={row.barcode ?? ''} maxLength={120} placeholder="미설정" onChange={(event) => update(index, { barcode: event.target.value })} /></td>
        <td><input aria-label={`옵션 ${index + 1} 추가금액`} value={row.extraPrice} min={0} step={1} type="number" onChange={(event) => update(index, { extraPrice: Number(event.target.value) })} /></td>
        <td>{(basePrice + row.extraPrice).toLocaleString('ko-KR')}원</td>
        <td><input aria-label={`옵션 ${index + 1} ${row.id ? '재고' : '초기 재고'}`} value={row.stockQty} min={0} step={1} type="number" onChange={(event) => update(index, { stockQty: Number(event.target.value) })} /></td>
        <td><input aria-label={`옵션 ${index + 1} 안전재고 기준`} aria-describedby="goods-option-stock-guidance" value={row.lowStockThreshold ?? ''} min={0} max={2147483647} step={1} type="number" placeholder="미설정" onChange={(event) => update(index, { lowStockThreshold: event.target.value === '' ? null : Number(event.target.value) })} />
          {row.lowStockThreshold != null && row.stockQty <= row.lowStockThreshold && <small>재고 부족 · 기준 {row.lowStockThreshold.toLocaleString('ko-KR')}개 이하</small>}</td>
        <td><select aria-label={`옵션 ${index + 1} 사용 상태`} value={row.isActive === false ? 'stopped' : 'active'} onChange={(event) => update(index, { isActive: event.target.value === 'active' })}>
          <option value="active">사용</option><option value="stopped">중지</option>
        </select></td>
        <td><div className="row"><button type="button" className="btn btn-ghost" aria-label={`옵션 ${index + 1} 위로`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" className="btn btn-ghost" aria-label={`옵션 ${index + 1} 아래로`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" className="btn btn-ghost" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>제거</button></div></td>
      </tr>)}</tbody>
    </table></div>
    <input type="hidden" name="variants" value={JSON.stringify(rows)} readOnly />
    <input type="hidden" name="variantBaseline" value={JSON.stringify(baselineSnapshot)} readOnly />
  </div>;
}
