'use client';

import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { ErpItemMatch } from '@/lib/admin/erp-items';
import {
  applyErpItemToGoodsOption, applyGoodsOptionBulkEdit, collapseGoodsOptionRows, generateGoodsOptionRows, goodsOptionRowKey,
  goodsOptionStockTotals, isSingleGoodsOption, parseGoodsOptionBulkEdit, removeGoodsOptionRows,
  type GoodsOptionAxis, type GoodsOptionBulkInput, type GoodsOptionRow,
} from '@/lib/admin/goods-option-editor';
import { formatWon, planErpSalePrice } from '@/lib/admin/goods-price-editor';
import { AdminField } from './console/AdminKit';
import { ErpItemNameInput } from './ErpItemNameInput';

type GoodsOptionEditorProps = {
  rows: GoodsOptionRow[];
  baseline: string[];
  /** 옵션가를 더하는 판매 기준 금액(할인하면 할인가, 아니면 판매가) */
  basePrice: number;
  /** 판매가·할인 입력이 잘못되면 false. 옵션가로 ERP 판매가를 적용하지 않는다. */
  basePriceValid?: boolean;
  /** 현재 적용 중인 할인 금액(원) */
  discountAmount?: number;
  error?: string;
  axisValues?: Record<string, string>;
  onRowsChange: Dispatch<SetStateAction<GoodsOptionRow[]>>;
  codePrefix?: string;
  /** 옵션의 ERP 품명에서 반입된 ERP 품목을 골랐을 때 */
  onErpItemSelect?: (item: ErpItemMatch) => void;
  /** 옵션 미사용 상품에서 ERP 판매가 적용을 누르면 판매가 칸에 넣는다 */
  onRegularPriceApply?: (price: number) => void;
  /** 옵션 상세 정보 표 아래에 보이는 ERP 카테고리 안내 */
  erpNotice?: ReactNode;
};

type ErpRowState = { item: ErpItemMatch; message?: string; failed?: boolean };
type OptionUsage = 'on' | 'off';

const EMPTY_AXES: GoodsOptionAxis[] = [{ name: '', values: '' }, { name: '', values: '' }];
const EMPTY_BULK: GoodsOptionBulkInput = { extraPrice: '', stockQty: '', isActive: '' };
const STOCK_GUIDANCE = 'ICONS에서 판매할 수량이며 주문하면 차감됩니다. 안전재고는 부족 알림 기준입니다.';

function wholeNumber(raw: string): number {
  return raw === '' ? 0 : Number(raw);
}

function OptionDetailTable({ rows, single, update, erpRows, onErpChange, onErpSelect, onErpPrice, notice }: {
  rows: GoodsOptionRow[];
  single: boolean;
  update: (key: string, changes: Partial<GoodsOptionRow>) => void;
  erpRows: Record<string, ErpRowState>;
  onErpChange: (key: string, value: string) => void;
  onErpSelect: (key: string, item: ErpItemMatch) => void;
  onErpPrice: (key: string, salePrice: number) => void;
  notice?: ReactNode;
}) {
  return <details className="goods-option-secondary">
    <summary>옵션 상세 정보 · ERP 품명·ERP 코드·바코드·안전재고</summary>
    <p id="goods-option-external-identity-guidance" className="wc-admin-option-artwork__secondary-hint">
      ERP 품명을 입력해 반입된 ERP 품목을 고르면 ERP 코드·바코드를 채우고 카테고리·판매가를 제안합니다. ERP 코드·바코드는 관리코드와 따로 저장하며 선행 0을 유지합니다. 비워 두면 미설정입니다.
    </p>
    <div className="goods-option-secondary__table" role="region" aria-label="옵션 ERP 정보와 안전재고 상세" tabIndex={0}>
      <table className="wc-admin-table goods-option-secondary-table">
        <caption className="sr-only">옵션별 ERP 품명·ERP 코드·바코드·안전재고 기준</caption>
        <thead><tr>
          <th scope="col">옵션</th>
          <th scope="col">ERP 품명</th>
          <th scope="col">ERP 코드</th>
          <th scope="col">바코드</th>
          <th scope="col">안전재고 기준</th>
        </tr></thead>
        <tbody>{rows.map((row, index) => {
          const key = goodsOptionRowKey(row);
          const erp = erpRows[key];
          const erpSalePrice = erp?.item.salePrice ?? null;
          return <tr key={key} data-variant-id={row.id ?? undefined}>
            <td>{single
              ? <input aria-label="기본 옵션명" value={row.name} maxLength={200} onChange={(event) => update(key, { name: event.target.value })} />
              : row.name || `옵션 ${index + 1}`}</td>
            <td>
              <ErpItemNameInput value={row.erpName ?? ''} onChange={(value) => onErpChange(key, value)} onSelect={(item) => onErpSelect(key, item)}
                ariaLabel={`옵션 ${index + 1} ERP 품명`} ariaDescribedBy="goods-option-external-identity-guidance" maxLength={200} placeholder="미설정" />
              {erpSalePrice !== null && <button type="button" className="btn btn-ghost goods-option-erp-price" onClick={() => onErpPrice(key, erpSalePrice)}>
                ERP 판매가 {formatWon(erpSalePrice)} 적용
              </button>}
              {erp?.message && <small role="status" className={erp.failed ? 'goods-option-erp-message goods-option-erp-message--failed' : 'goods-option-erp-message'}>{erp.message}</small>}
            </td>
            <td><input aria-label={`옵션 ${index + 1} ERP 코드`} aria-describedby="goods-option-external-identity-guidance" value={row.erpCode ?? ''} maxLength={120} placeholder="미설정" onChange={(event) => update(key, { erpCode: event.target.value })} /></td>
            <td><input aria-label={`옵션 ${index + 1} 바코드`} aria-describedby="goods-option-external-identity-guidance" value={row.barcode ?? ''} maxLength={120} placeholder="미설정" onChange={(event) => update(key, { barcode: event.target.value })} /></td>
            <td>
              <input aria-label={`옵션 ${index + 1} 안전재고 기준`} aria-describedby="goods-option-stock-guidance" value={row.lowStockThreshold ?? ''} min={0} max={2147483647} step={1} type="number" placeholder="미설정" onChange={(event) => update(key, { lowStockThreshold: event.target.value === '' ? null : Number(event.target.value) })} />
              {row.lowStockThreshold != null && row.stockQty <= row.lowStockThreshold && <small>재고 부족 · 기준 {row.lowStockThreshold.toLocaleString('ko-KR')}개 이하</small>}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {notice}
  </details>;
}

function OptionInputs({ axes, rows, hidden, setAxes, setRows }: {
  axes: GoodsOptionAxis[];
  rows: GoodsOptionRow[];
  hidden: boolean;
  setAxes: Dispatch<SetStateAction<GoodsOptionAxis[]>>;
  setRows: Dispatch<SetStateAction<GoodsOptionRow[]>>;
}) {
  const [generationError, setGenerationError] = useState('');
  return <section className="goods-option-inputs" aria-labelledby="goods-option-inputs-title" hidden={hidden}>
    <div className="goods-option-inputs__heading">
      <h5 id="goods-option-inputs-title">옵션 입력</h5>
      <span>옵션명 최대 2개 · 옵션 최대 100개</span>
    </div>
    {axes.map((axis, index) => <div className="goods-option-inputs__row" key={index}>
      <AdminField inputId={`option-axis-${index}`} label={`옵션명${index ? ' 2 (선택)' : ' 1'}`}>
        <input id={`option-axis-${index}`} name={`optionAxisName${index}`} value={axis.name} maxLength={40} placeholder={index ? '예: 사이즈' : '예: 색상'} onChange={(event) => setAxes((old) => old.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
      </AdminField>
      <AdminField inputId={`option-values-${index}`} label={`옵션값${index ? ' 2' : ' 1'} (쉼표로 구분)`}>
        <input id={`option-values-${index}`} name={`optionAxisValues${index}`} value={axis.values} placeholder={index ? '예: S, M, L' : '예: 빨강, 파랑'} onChange={(event) => setAxes((old) => old.map((item, i) => i === index ? { ...item, values: event.target.value } : item))} />
      </AdminField>
    </div>)}
    <p className="wc-admin-option-artwork__secondary-hint">
      이미 있는 조합의 옵션가·재고수량·관리코드·ERP 정보는 그대로 둡니다. 목록에서 빠진 조합은 저장할 때 지워지며, 주문·장바구니에 쓰인 옵션은 삭제 대신 보관됩니다.
    </p>
    <button type="button" className="btn btn-ghost" onClick={() => {
      const result = generateGoodsOptionRows(axes.filter((axis, i) => i === 0 || axis.name.trim() || axis.values.trim()), rows);
      if (!result.ok) { setGenerationError(result.error); return; }
      setRows(result.rows); setGenerationError('');
    }}>옵션목록으로 적용</button>
    {generationError && <p role="alert">{generationError}</p>}
  </section>;
}

function OptionList({ rows, basePrice, codePrefix, update, setRows }: {
  rows: GoodsOptionRow[];
  basePrice: number;
  codePrefix?: string;
  update: (key: string, changes: Partial<GoodsOptionRow>) => void;
  setRows: Dispatch<SetStateAction<GoodsOptionRow[]>>;
}) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [bulk, setBulk] = useState<GoodsOptionBulkInput>(EMPTY_BULK);
  const [bulkMessage, setBulkMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const keys = rows.map(goodsOptionRowKey);
  /* 지워지거나 다시 만든 행의 선택은 남기지 않는다. */
  const selected = new Set(keys.filter((key) => checked.has(key)));
  const allSelected = selected.size === rows.length;
  function move(index: number, direction: number) {
    setRows((current) => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; });
  }
  function toggle(key: string, on: boolean) {
    setChecked(() => { const next = new Set(selected); if (on) next.add(key); else next.delete(key); return next; });
  }
  function applyBulk() {
    const parsed = parseGoodsOptionBulkEdit(bulk);
    if (!parsed.ok) { setBulkMessage({ text: parsed.error, failed: true }); return; }
    setRows((current) => applyGoodsOptionBulkEdit(current, selected, parsed.edit));
    setBulkMessage({ text: `선택한 옵션 ${selected.size}개를 수정했습니다. 저장해야 반영됩니다.`, failed: false });
  }
  function removeSelected() {
    const result = removeGoodsOptionRows(rows, selected);
    if (!result.ok) { setBulkMessage({ text: result.error, failed: true }); return; }
    setRows(result.rows); setChecked(new Set());
    setBulkMessage({ text: `옵션 ${selected.size}개를 목록에서 뺐습니다. 주문·장바구니에 쓰인 옵션은 저장할 때 삭제 대신 보관됩니다.`, failed: false });
  }
  return <section className="goods-option-list" aria-labelledby="goods-option-list-title">
    <div className="goods-option-list__heading">
      <h5 id="goods-option-list-title">옵션목록 (총 {rows.length.toLocaleString('ko-KR')}개)</h5>
      <span>옵션가는 판매가(할인하면 할인가)에 더하는 금액입니다.</span>
    </div>
    <div className="goods-option-bulk" role="group" aria-label="선택목록 일괄수정">
      <label className="goods-option-bulk__all">
        <input type="checkbox" aria-label="옵션 전체 선택" checked={rows.length > 0 && allSelected}
          ref={(node) => { if (node) node.indeterminate = selected.size > 0 && !allSelected; }}
          onChange={(event) => setChecked(event.target.checked ? new Set(keys) : new Set())} />
        <span>{selected.size ? `${selected.size}개 선택` : '전체 선택'}</span>
      </label>
      <label>옵션가<input type="text" inputMode="numeric" aria-label="선택 옵션 옵션가" placeholder="변경 안 함" value={bulk.extraPrice} onChange={(event) => setBulk((old) => ({ ...old, extraPrice: event.target.value }))} /></label>
      <label>재고수량<input type="text" inputMode="numeric" aria-label="선택 옵션 재고수량" placeholder="변경 안 함" value={bulk.stockQty} onChange={(event) => setBulk((old) => ({ ...old, stockQty: event.target.value }))} /></label>
      <label>사용여부<select aria-label="선택 옵션 사용여부" value={bulk.isActive} onChange={(event) => setBulk((old) => ({ ...old, isActive: event.target.value as GoodsOptionBulkInput['isActive'] }))}>
        <option value="">변경 안 함</option><option value="active">사용</option><option value="stopped">중지</option>
      </select></label>
      <button type="button" className="btn btn-ghost" disabled={!selected.size} onClick={applyBulk}>선택목록 일괄수정</button>
      <button type="button" className="btn btn-ghost" disabled={!selected.size} onClick={removeSelected}>선택삭제</button>
    </div>
    {bulkMessage && <p className={bulkMessage.failed ? 'goods-option-bulk__message goods-option-bulk__message--failed' : 'goods-option-bulk__message'} role="status">{bulkMessage.text}</p>}
    <div className="admin-option-editor__table goods-option-primary-table" role="region" aria-label="옵션목록 편집표" tabIndex={0}>
      <table className="wc-admin-table">
        <caption className="sr-only">선택·옵션명·옵션가·재고수량·사용여부·관리코드·순서·삭제</caption>
        <thead><tr>
          <th scope="col"><span className="sr-only">선택</span></th>
          <th scope="col">옵션명</th>
          <th scope="col">옵션가</th>
          <th scope="col">재고수량</th>
          <th scope="col">사용여부</th>
          <th scope="col">관리코드</th>
          <th scope="col">순서</th>
          <th scope="col">삭제</th>
        </tr></thead>
        <tbody>{rows.map((row, index) => {
          const key = keys[index];
          return <tr key={key} data-variant-id={row.id ?? undefined} data-selected={selected.has(key) || undefined}>
            <td><input type="checkbox" aria-label={`옵션 ${index + 1} 선택`} checked={selected.has(key)} onChange={(event) => toggle(key, event.target.checked)} /></td>
            <td>
              <input aria-label={`옵션 ${index + 1} 이름`} value={row.name} maxLength={200} onChange={(event) => update(key, { name: event.target.value })} />
              {row.isActive === false && <small className="goods-option-row-status">사용 중지 · 주문 기록과 재고 보존</small>}
            </td>
            <td>
              <input aria-label={`옵션 ${index + 1} 옵션가`} value={row.extraPrice} min={0} step={1} type="number" onChange={(event) => update(key, { extraPrice: wholeNumber(event.target.value) })} />
              <small className="goods-option-primary-table__sale">판매 {formatWon(basePrice + (Number.isFinite(row.extraPrice) ? row.extraPrice : 0))}</small>
            </td>
            <td><input aria-label={`옵션 ${index + 1} 재고수량`} aria-describedby="goods-option-stock-guidance" value={row.stockQty} min={0} step={1} type="number" onChange={(event) => update(key, { stockQty: wholeNumber(event.target.value) })} /></td>
            <td><select aria-label={`옵션 ${index + 1} 사용여부`} value={row.isActive === false ? 'stopped' : 'active'} onChange={(event) => update(key, { isActive: event.target.value === 'active' })}>
              <option value="active">사용</option><option value="stopped">중지</option>
            </select></td>
            <td><input aria-label={`옵션 ${index + 1} 관리코드`} value={row.code} maxLength={120} placeholder={codePrefix ? `${codePrefix}-${String(index + 1).padStart(2, '0')}` : '저장 시 자동 생성'} onChange={(event) => update(key, { code: event.target.value })} /></td>
            <td><div className="row goods-option-row-actions">
              <button type="button" className="btn btn-ghost" aria-label={`옵션 ${index + 1} 위로`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
              <button type="button" className="btn btn-ghost" aria-label={`옵션 ${index + 1} 아래로`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>↓</button>
            </div></td>
            <td><button type="button" className="btn btn-ghost" aria-label={`옵션 ${index + 1} 삭제`} disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => goodsOptionRowKey(item) !== key))}>삭제</button></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}

function SingleStock({ row, basePrice, codePrefix, update }: {
  row: GoodsOptionRow;
  basePrice: number;
  codePrefix?: string;
  update: (key: string, changes: Partial<GoodsOptionRow>) => void;
}) {
  const key = goodsOptionRowKey(row);
  /* 옵션가는 옵션 없이 파는 상품에 보통 쓰지 않는다. 기존 값이 있을 때만 보이고 편집 중에는 사라지지 않는다. */
  const [extraVisible, setExtraVisible] = useState(false);
  return <div className="goods-option-stock__grid">
    <AdminField inputId="goods-single-stock" label="재고수량">
      <span className="goods-amount-input">
        <input id="goods-single-stock" aria-describedby="goods-option-stock-guidance" value={row.stockQty} min={0} step={1} type="number" onChange={(event) => update(key, { stockQty: wholeNumber(event.target.value) })} />
        <span aria-hidden="true">개</span>
      </span>
    </AdminField>
    <AdminField inputId="goods-single-code" label="관리코드 (선택)" hint="ICONS 자체 옵션코드입니다. 비워 두면 저장할 때 만듭니다.">
      <input id="goods-single-code" aria-describedby="goods-single-code-hint" value={row.code} maxLength={120} placeholder={codePrefix ? `${codePrefix}-01` : '저장 시 자동 생성'} onChange={(event) => update(key, { code: event.target.value })} />
    </AdminField>
    {(extraVisible || row.extraPrice !== 0) && <AdminField inputId="goods-single-extra-price" label="기본 옵션 옵션가" hint="판매가(할인하면 할인가)에 더하는 금액입니다. 0원이면 판매가 그대로 판매합니다.">
      <span className="goods-amount-input">
        <input id="goods-single-extra-price" aria-describedby="goods-single-extra-price-hint" value={row.extraPrice} min={0} step={1} type="number" onChange={(event) => { setExtraVisible(true); update(key, { extraPrice: wholeNumber(event.target.value) }); }} />
        <span aria-hidden="true">원</span>
      </span>
      <small className="goods-option-primary-table__sale">판매 {formatWon(basePrice + (Number.isFinite(row.extraPrice) ? row.extraPrice : 0))}</small>
    </AdminField>}
  </div>;
}

export function GoodsOptionEditor({
  rows, baseline, basePrice, basePriceValid = true, discountAmount = 0, error, axisValues, onRowsChange: setRows, codePrefix,
  onErpItemSelect, onRegularPriceApply, erpNotice,
}: GoodsOptionEditorProps) {
  const firstAttributes = rows[0]?.attributes ?? {};
  const initialAxes = Object.keys(firstAttributes).map((name) => ({ name, values: [...new Set(rows.map((row) => row.attributes[name]))].join(', ') }));
  const [axes, setAxes] = useState<GoodsOptionAxis[]>(() => [0, 1].map((i) => ({ name: axisValues?.[`optionAxisName${i}`] ?? initialAxes[i]?.name ?? '', values: axisValues?.[`optionAxisValues${i}`] ?? initialAxes[i]?.values ?? '' })));
  const single = isSingleGoodsOption(rows);
  const [optionUsage, setOptionUsage] = useState<OptionUsage>(() => {
    if (axisValues?.optionUsage === 'on' || axisValues?.optionUsage === 'off') return axisValues.optionUsage;
    return !single || axes.some((axis) => axis.name.trim() || axis.values.trim()) ? 'on' : 'off';
  });
  const [erpRows, setErpRows] = useState<Record<string, ErpRowState>>({});
  const optionsEnabled = !single || optionUsage === 'on';
  const singleRow = single ? rows[0] : undefined;
  const stock = goodsOptionStockTotals(rows);

  function update(key: string, changes: Partial<GoodsOptionRow>) {
    setRows((current) => current.map((row) => goodsOptionRowKey(row) === key ? { ...row, ...changes } : row));
  }
  function changeOptionUsage(next: OptionUsage) {
    if (next === 'off' && !single) {
      const first = rows[0];
      const removed = rows.length - 1;
      const message = `옵션 사용을 설정안함으로 바꾸면 첫 옵션 '${first?.name ?? ''}'이 옵션값 없이 기본 옵션으로 남습니다(관리코드·재고수량·ERP 정보 유지).`
        + (removed ? ` 나머지 옵션 ${removed}개는 옵션목록에서 빠지고, 주문·장바구니에 쓰인 옵션은 저장할 때 삭제 대신 보관됩니다.` : '')
        + ' 계속할까요?';
      if (!window.confirm(message)) return;
      setRows((current) => collapseGoodsOptionRows(current));
      setAxes(EMPTY_AXES);
    }
    setOptionUsage(next);
  }
  function selectErp(key: string, item: ErpItemMatch) {
    setRows((current) => current.map((row) => goodsOptionRowKey(row) === key ? applyErpItemToGoodsOption(row, item) : row));
    setErpRows((current) => ({ ...current, [key]: { item } }));
    onErpItemSelect?.(item);
  }
  function changeErpName(key: string, value: string) {
    update(key, { erpName: value });
    /* 직접 고친 품명에는 이전에 고른 품목의 판매가 제안을 남기지 않는다. */
    setErpRows((current) => { if (!current[key]) return current; const next = { ...current }; delete next[key]; return next; });
  }
  function applyErpPrice(key: string, salePrice: number) {
    const plan = planErpSalePrice({ salePrice, mode: single ? 'single' : 'multiple', basePrice: basePriceValid ? basePrice : null, discountAmount });
    const record = (message: string, failed: boolean) => setErpRows((current) => current[key] ? { ...current, [key]: { ...current[key], message, failed } } : current);
    if (!plan.ok) { record(plan.error, true); return; }
    if (plan.target === 'regularPrice') {
      if (!onRegularPriceApply) { record('판매가 칸에서 직접 입력해주세요.', true); return; }
      onRegularPriceApply(plan.value);
    } else update(key, { extraPrice: plan.value });
    record(plan.message, false);
  }

  return <div className="col admin-option-editor wc-admin-option-artwork" style={{ gap: 16 }} data-option-mode={single ? 'single' : 'multiple'}>
    <section className="goods-option-stock" aria-labelledby="goods-option-stock-title">
      <h4 id="goods-option-stock-title">재고수량</h4>
      <p id="goods-option-stock-guidance" className="wc-admin-option-artwork__hint">{STOCK_GUIDANCE}</p>
      {singleRow ? <SingleStock row={singleRow} basePrice={basePrice} codePrefix={codePrefix} update={update} />
        : <p className="goods-option-stock__total">
          <span>옵션 재고수량 합계</span><strong>{stock.total.toLocaleString('ko-KR')}개</strong>
          {stock.active !== stock.total && <small>사용 중 옵션 {stock.active.toLocaleString('ko-KR')}개</small>}
          <small>옵션목록에서 옵션별로 입력합니다.</small>
        </p>}
      {singleRow?.lowStockThreshold != null && singleRow.stockQty <= singleRow.lowStockThreshold && <p className="goods-option-single__warning" role="status">재고 부족 · 안전재고 기준 {singleRow.lowStockThreshold.toLocaleString('ko-KR')}개 이하</p>}
    </section>

    <fieldset className="goods-choice goods-option-usage">
      <legend>옵션</legend>
      <label><input type="radio" name="optionUsage" value="on" checked={optionsEnabled} onChange={() => changeOptionUsage('on')} />설정함</label>
      <label><input type="radio" name="optionUsage" value="off" checked={!optionsEnabled} onChange={() => changeOptionUsage('off')} />설정안함</label>
      <span className="goods-choice__hint">색상·사이즈처럼 고객이 골라 사는 상품이면 설정합니다. 설정안함은 옵션 선택 없이 판매합니다.</span>
    </fieldset>

    <OptionInputs axes={axes} rows={rows} hidden={!optionsEnabled} setAxes={setAxes} setRows={setRows} />
    {optionsEnabled && (single
      ? <p className="goods-option-list__empty" role="status">옵션목록 (총 0개) · 옵션명과 옵션값을 입력하고 옵션목록으로 적용을 누르세요. 적용 전에는 옵션 없이 판매하는 상품으로 저장됩니다.</p>
      : <OptionList rows={rows} basePrice={basePrice} codePrefix={codePrefix} update={update} setRows={setRows} />)}

    <OptionDetailTable rows={rows} single={single} update={update} erpRows={erpRows} onErpChange={changeErpName}
      onErpSelect={selectErp} onErpPrice={applyErpPrice} notice={erpNotice} />
    {error && <p role="alert">{error}</p>}
    {rows.every((row) => row.isActive === false) && <p role="status">모든 옵션이 사용 중지되어 고객이 구매할 수 없습니다.</p>}
    <input type="hidden" name="variants" value={JSON.stringify(rows)} readOnly />
    <input type="hidden" name="variantBaseline" value={JSON.stringify(baseline)} readOnly />
  </div>;
}
