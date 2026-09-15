'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { generateGoodsOptionRows, type GoodsOptionAxis, type GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import { AdminField, AdminFormGrid } from './console/AdminKit';

type GoodsOptionEditorProps = {
  initialRows: GoodsOptionRow[];
  baseline: string[];
  basePrice: number;
  error?: string;
  axisValues?: Record<string, string>;
  onRowsChange?: (rows: GoodsOptionRow[]) => void;
  codePrefix?: string;
};

const formatWon = (value: number) => `${value.toLocaleString('ko-KR')}원`;

function optionPrice(basePrice: number, row: GoodsOptionRow) {
  return basePrice + row.extraPrice;
}

function OptionIdentityTable({ rows, update, codePrefix }: {
  rows: GoodsOptionRow[];
  update: (index: number, changes: Partial<GoodsOptionRow>) => void;
  codePrefix?: string;
}) {
  return <details className="goods-option-secondary">
    <summary>옵션 상세 정보 · 코드·ERP·바코드·안전재고</summary>
    <p className="wc-admin-option-artwork__secondary-hint">
      외부 식별자와 안전재고 기준은 주 입력과 별도로 보존됩니다. 선행 0은 텍스트로 유지하며, 안전재고는 판매 수량에서 차감하지 않는 경보 기준입니다.
    </p>
    <div className="goods-option-secondary__table" role="region" aria-label="옵션 외부 식별자와 안전재고 상세" tabIndex={0}>
      <table className="wc-admin-table goods-option-secondary-table">
        <caption className="sr-only">옵션코드·ERP 식별자·안전재고 기준</caption>
        <thead><tr>
          <th scope="col">옵션</th>
          <th scope="col">옵션코드</th>
          <th scope="col">ERP 코드</th>
          <th scope="col">ERP 품명</th>
          <th scope="col">바코드</th>
          <th scope="col">안전재고 기준</th>
        </tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.id ?? JSON.stringify(row.attributes)} data-variant-id={row.id ?? undefined}>
          <td>{row.name || `옵션 ${index + 1}`}</td>
          <td><input aria-label={`옵션 ${index + 1} 코드`} value={row.code} maxLength={120} placeholder={codePrefix ? `${codePrefix}-${String(index + 1).padStart(2, '0')}` : '저장 시 자동 생성'} onChange={(event) => update(index, { code: event.target.value })} /></td>
          <td><input aria-label={`옵션 ${index + 1} ERP 코드`} aria-describedby="goods-option-external-identity-guidance" value={row.erpCode ?? ''} maxLength={120} placeholder="미설정" onChange={(event) => update(index, { erpCode: event.target.value })} /></td>
          <td><input aria-label={`옵션 ${index + 1} ERP 품명`} aria-describedby="goods-option-external-identity-guidance" value={row.erpName ?? ''} maxLength={200} placeholder="미설정" onChange={(event) => update(index, { erpName: event.target.value })} /></td>
          <td><input aria-label={`옵션 ${index + 1} 바코드`} aria-describedby="goods-option-external-identity-guidance" value={row.barcode ?? ''} maxLength={120} placeholder="미설정" onChange={(event) => update(index, { barcode: event.target.value })} /></td>
          <td>
            <input aria-label={`옵션 ${index + 1} 안전재고 기준`} aria-describedby="goods-option-stock-guidance" value={row.lowStockThreshold ?? ''} min={0} max={2147483647} step={1} type="number" placeholder="미설정" onChange={(event) => update(index, { lowStockThreshold: event.target.value === '' ? null : Number(event.target.value) })} />
            {row.lowStockThreshold != null && row.stockQty <= row.lowStockThreshold && <small>재고 부족 · 기준 {row.lowStockThreshold.toLocaleString('ko-KR')}개 이하</small>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>
  </details>;
}

function OptionAxesEditor({ axes, rows, generationError, setAxes, setRows, setGenerationError }: {
  axes: GoodsOptionAxis[];
  rows: GoodsOptionRow[];
  generationError: string;
  setAxes: Dispatch<SetStateAction<GoodsOptionAxis[]>>;
  setRows: Dispatch<SetStateAction<GoodsOptionRow[]>>;
  setGenerationError: Dispatch<SetStateAction<string>>;
}) {
  return <details className="goods-option-axes" open={rows.length > 1 || undefined}>
    <summary>여러 옵션으로 전환 · 옵션 축 설정 · 최대 100개 조합</summary>
    <p className="wc-admin-option-artwork__secondary-hint">
      현재 옵션 행과 일치하는 조합의 가격·재고·코드·외부 식별자는 유지합니다. 빠진 조합은 저장 시 제거되며 주문·장바구니에 쓰인 옵션은 보관됩니다.
    </p>
    <AdminFormGrid>{axes.map((axis, index) => <div className="admin-option-editor__axis" key={index}>
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
    {generationError && <p role="alert">{generationError}</p>}
  </details>;
}

function OptionPrimaryTable({ rows, basePrice, update, move, setRows }: {
  rows: GoodsOptionRow[];
  basePrice: number;
  update: (index: number, changes: Partial<GoodsOptionRow>) => void;
  move: (index: number, direction: number) => void;
  setRows: Dispatch<SetStateAction<GoodsOptionRow[]>>;
}) {
  return <div className="admin-option-editor__table goods-option-primary-table" role="region" aria-label="핵심 옵션 편집표" tabIndex={0}>
    <table className="wc-admin-table">
      <caption className="sr-only">옵션명·추가금액·옵션 판매가·할당 재고·사용 상태</caption>
      <thead><tr>
        <th scope="col">옵션명</th>
        <th scope="col">추가금액</th>
        <th scope="col">옵션 판매가</th>
        <th scope="col">할당 재고</th>
        <th scope="col">사용 상태</th>
        <th scope="col">순서·제거</th>
      </tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.id ?? JSON.stringify(row.attributes)} data-variant-id={row.id ?? undefined}>
        <td>
          <input aria-label={`옵션 ${index + 1} 이름`} value={row.name} maxLength={200} onChange={(event) => update(index, { name: event.target.value })} />
          {row.isActive === false && <small className="goods-option-row-status">사용 중지된 옵션 · 주문 참조와 재고 보존</small>}
        </td>
        <td><input aria-label={`옵션 ${index + 1} 추가금액`} value={row.extraPrice} min={0} step={1} type="number" onChange={(event) => update(index, { extraPrice: Number(event.target.value) })} /></td>
        <td className="goods-option-primary-table__price">{formatWon(optionPrice(basePrice, row))}</td>
        <td><input aria-label={`옵션 ${index + 1} ${row.id ? '할당 재고' : '초기 할당 재고'}`} value={row.stockQty} min={0} step={1} type="number" onChange={(event) => update(index, { stockQty: Number(event.target.value) })} /></td>
        <td><select aria-label={`옵션 ${index + 1} 사용 상태`} value={row.isActive === false ? 'stopped' : 'active'} onChange={(event) => update(index, { isActive: event.target.value === 'active' })}>
          <option value="active">사용</option><option value="stopped">중지</option>
        </select></td>
        <td><div className="row goods-option-row-actions">
          <button type="button" className="btn btn-ghost" aria-label={`옵션 ${index + 1} 위로`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
          <button type="button" className="btn btn-ghost" aria-label={`옵션 ${index + 1} 아래로`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>↓</button>
          <button type="button" className="btn btn-ghost" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>제거</button>
        </div></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function GoodsOptionEditor({ initialRows, baseline, basePrice, error, axisValues, onRowsChange, codePrefix }: GoodsOptionEditorProps) {
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
  const isSimple = rows.length === 1 && Object.keys(rows[0]?.attributes ?? {}).length === 0;
  const simpleRow = rows[0];

  return <div className="col admin-option-editor wc-admin-option-artwork" style={{ gap: 16 }} data-option-mode={isSimple ? 'single' : 'multiple'}>
    <p className="wc-admin-option-artwork__intro">
      {isSimple ? '옵션이 없는 굿즈도 내부에서는 기본 옵션 한 개로 저장됩니다. 기준 판매가에 추가금액을 더한 옵션 판매가와 할당 재고를 입력하세요.' : '옵션명·옵션 판매가·할당 재고·사용 상태를 먼저 확인하세요. 외부 식별자와 안전재고는 옵션 상세 정보에서 관리합니다.'}
    </p>
    <p id="goods-option-stock-guidance" className="wc-admin-option-artwork__hint">안전재고는 부족 경보 기준입니다. 재고 10개·기준 3개이면 10개 모두 판매할 수 있습니다. 비워두면 경보하지 않으며, 사용 중지는 재고와 주문 이력을 보존합니다.</p>
    <p id="goods-option-external-identity-guidance" className="wc-admin-option-artwork__hint">ERP 코드·ERP 품명·바코드는 옵션별 외부 식별자입니다. 자체 옵션코드와 별도로 입력하며, 선행 0은 유지됩니다. 비워두면 미설정으로 저장합니다.</p>

    {isSimple && simpleRow ? <section className="goods-option-single" aria-labelledby="goods-option-single-title">
      <div className="goods-option-single__heading">
        <div><h4 id="goods-option-single-title">기본 옵션</h4><p>옵션 선택 없이 판매하는 굿즈의 내부 기본 옵션입니다.</p></div>
        <span className="wc-admin-option-artwork__badge">옵션 1개</span>
      </div>
      <div className="goods-option-single__grid">
        <AdminField inputId="goods-single-option-name" label="옵션명">
          <input id="goods-single-option-name" aria-label="기본 옵션명" value={simpleRow.name} maxLength={200} onChange={(event) => update(0, { name: event.target.value })} />
        </AdminField>
        <div className="goods-option-single__readout"><span>기준 판매가</span><strong>{formatWon(basePrice)}</strong><small>굿즈의 기준 판매가 입력에서 수정</small></div>
        <AdminField inputId="goods-single-extra-price" label="추가금액">
          <input id="goods-single-extra-price" aria-label="기본 옵션 추가금액" value={simpleRow.extraPrice} min={0} step={1} type="number" onChange={(event) => update(0, { extraPrice: Number(event.target.value) })} />
        </AdminField>
        <div className="goods-option-single__readout goods-option-single__readout--emphasis"><span>옵션 판매가</span><strong>{formatWon(optionPrice(basePrice, simpleRow))}</strong><small>기준 판매가 + 추가금액</small></div>
        <AdminField inputId="goods-single-stock" label="할당 재고" hint="안전재고 기준은 옵션 상세 정보에서 별도로 설정합니다.">
          <input id="goods-single-stock" aria-label="기본 옵션 할당 재고" value={simpleRow.stockQty} min={0} step={1} type="number" onChange={(event) => update(0, { stockQty: Number(event.target.value) })} />
        </AdminField>
        <div className="goods-option-single__readout"><span>사용 상태</span><strong>{simpleRow.isActive === false ? '사용 중지' : '사용 중'}</strong><small>중지해도 옵션 ID·코드·재고·주문 참조는 보존</small></div>
      </div>
      {simpleRow.lowStockThreshold != null && simpleRow.stockQty <= simpleRow.lowStockThreshold && <p className="goods-option-single__warning" role="status">재고 부족 · 안전재고 기준 {simpleRow.lowStockThreshold.toLocaleString('ko-KR')}개 이하</p>}
    </section> : <OptionPrimaryTable rows={rows} basePrice={basePrice} update={update} move={move} setRows={setRows} />}

    <OptionIdentityTable rows={rows} update={update} codePrefix={codePrefix} />
    <OptionAxesEditor axes={axes} rows={rows} generationError={generationError} setAxes={setAxes} setRows={setRows} setGenerationError={setGenerationError} />
    {error && <p role="alert">{error}</p>}
    {rows.every((row) => row.isActive === false) && <p role="status">모든 옵션이 사용 중지되어 고객이 구매할 수 없습니다.</p>}
    <input type="hidden" name="variants" value={JSON.stringify(rows)} readOnly />
    <input type="hidden" name="variantBaseline" value={JSON.stringify(baselineSnapshot)} readOnly />
  </div>;
}
