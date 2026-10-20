/* eslint-disable @next/next/no-img-element -- Catalog thumbnails use existing hosted media with fixed dimensions. */
'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { readGoodsOptionImportAction, searchGoodsOptionImportAction } from '@/app/admin/goods-option-import-actions';
import { goodsOptionImportTargetVersion, planGoodsOptionImport, type GoodsOptionImportContext, type GoodsOptionImportFilters,
  type GoodsOptionImportPage, type GoodsOptionImportPlan, type GoodsOptionImportSource } from '@/lib/admin/goods-option-import';
import type { GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import { formatWon } from '@/lib/admin/goods-price-editor';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';

const INITIAL_FILTERS: GoodsOptionImportFilters = { query: '', field: 'name', categoryId: '', page: 1 };
const EMPTY: GoodsOptionImportPage = { rows: [], total: 0, page: 1, pageSize: 20 };
const STALE = '비교 중인 가격·옵션 또는 상품 정보가 바뀌었습니다. 현재 입력을 유지했으니 다시 비교해주세요.';
type Comparison = { source: GoodsOptionImportSource; targetVersion: string; fingerprint: string; includePrices: boolean; plan: GoodsOptionImportPlan };

/** Keep picker inputs outside the product's native form and autosave listeners. */
export function GoodsOptionImportPicker(props: Parameters<typeof GoodsOptionImportDialog>[0]) {
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="wc-root wc-admin" onChange={event => event.stopPropagation()} onSubmit={event => event.stopPropagation()}>
    <GoodsOptionImportDialog {...props} />
  </div>, document.body);
}

export function GoodsOptionImportDialog({ context, categories, currentRows, basePrice, fingerprint, onApply, onClose }: {
  context: GoodsOptionImportContext;
  categories: { id: string; name: string }[];
  currentRows: GoodsOptionRow[];
  basePrice: number;
  fingerprint: string;
  onApply: (plan: GoodsOptionImportPlan, expectedFingerprint: string) => boolean;
  onClose: () => void;
}) {
  const [filters, setFilters] = useState(INITIAL_FILTERS), [appliedFilters, setAppliedFilters] = useState(INITIAL_FILTERS);
  const [data, setData] = useState(EMPTY), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(''), [includePrices, setIncludePrices] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const active = useRef(true), operation = useRef(false), readSequence = useRef({ value: 0 });
  const live = useRef({ context, fingerprint, currentRows, basePrice, includePrices, onApply });
  useEffect(() => { live.current = { context, fingerprint, currentRows, basePrice, includePrices, onApply }; }, [context, fingerprint, currentRows, basePrice, includePrices, onApply]);
  useEffect(() => {
    active.current = true;
    const requests = readSequence.current;
    const sequence = ++requests.value;
    searchGoodsOptionImportAction(INITIAL_FILTERS).then(result => {
      if (!active.current || readSequence.current.value !== sequence) return;
      if (!result.ok) setError(result.error);
      else if (result.accountId !== live.current.context.accountId) setError('로그인 계정이 바뀌었습니다. 상품 화면을 다시 열어주세요.');
      else setData(result.data);
    }).catch(() => { if (active.current && readSequence.current.value === sequence) setError('상품 목록을 불러오지 못했습니다. 다시 검색해주세요.'); })
      .finally(() => { if (active.current && readSequence.current.value === sequence) setBusy(false); });
    return () => { active.current = false; requests.value++; };
  }, []);

  function canContinue(expected: string, sequence: number) {
    const current = live.current;
    return active.current && readSequence.current.value === sequence && !current.context.pending && !current.context.blockedReason && current.fingerprint === expected;
  }
  async function run(task: (sequence: number) => Promise<void>) {
    if (busy || operation.current || context.pending || context.blockedReason) return;
    const sequence = ++readSequence.current.value;
    operation.current = true; setBusy(true); setError('');
    try { await task(sequence); }
    catch { if (active.current && readSequence.current.value === sequence) { setComparison(null); setError('상품과 옵션을 확인하지 못했습니다. 현재 입력을 유지했으니 다시 비교해주세요.'); } }
    finally { operation.current = false; if (active.current && readSequence.current.value === sequence) setBusy(false); }
  }
  async function search(next: GoodsOptionImportFilters, sequence: number) {
    setComparison(null); setSelectedId('');
    const result = await searchGoodsOptionImportAction(next);
    if (!active.current || readSequence.current.value !== sequence) return;
    if (!result.ok) { setError(result.error); return; }
    if (result.accountId !== live.current.context.accountId) { setError('로그인 계정이 바뀌었습니다. 상품 화면을 다시 열어주세요.'); return; }
    setData(result.data); setAppliedFilters({ ...next, page: result.data.page });
  }
  async function compare(sourceId: string, sequence: number) {
    const captured = live.current;
    setSelectedId(sourceId); setComparison(null);
    const result = await readGoodsOptionImportAction({ sourceId, targetId: captured.context.target?.id ?? null });
    if (!active.current || readSequence.current.value !== sequence) return;
    if (!canContinue(captured.fingerprint, sequence) || captured.includePrices !== live.current.includePrices) { setError(STALE); return; }
    if (!result.ok) { setError(result.error); return; }
    if (result.accountId !== captured.context.accountId || result.source.id !== sourceId) { setError('현재 계정과 불러올 상품을 확인하지 못했습니다. 다시 비교해주세요.'); return; }
    if (result.targetVersion !== goodsOptionImportTargetVersion(captured.context.target)) { setError('상품을 연 뒤 서버의 옵션·가격·재고가 바뀌었습니다. 작성 문구를 보관하고 상품 화면을 새로고침해주세요.'); return; }
    const planned = planGoodsOptionImport({ current: captured.currentRows, source: result.source, basePrice: captured.basePrice, includePrices: captured.includePrices });
    if (!planned.ok) { setError(planned.error); return; }
    setComparison({ source: result.source, targetVersion: result.targetVersion, fingerprint: captured.fingerprint, includePrices: captured.includePrices, plan: planned.plan });
  }
  async function apply(sequence: number) {
    const captured = comparison;
    if (!captured || !canContinue(captured.fingerprint, sequence) || captured.includePrices !== live.current.includePrices) { setComparison(null); setError(STALE); return; }
    const result = await readGoodsOptionImportAction({ sourceId: captured.source.id, targetId: live.current.context.target?.id ?? null });
    if (!active.current || readSequence.current.value !== sequence) return;
    if (!canContinue(captured.fingerprint, sequence) || captured.includePrices !== live.current.includePrices) { setComparison(null); setError(STALE); return; }
    if (!result.ok) { setComparison(null); setError(result.error); return; }
    if (result.accountId !== live.current.context.accountId || result.source.id !== captured.source.id
      || result.source.version !== captured.source.version || result.targetVersion !== captured.targetVersion) {
      setComparison(null); setError('원본 또는 대상 상품의 저장 정보가 바뀌었습니다. 자동으로 덮어쓰지 않았으니 다시 비교해주세요.'); return;
    }
    if (!live.current.onApply(captured.plan, captured.fingerprint)) { setComparison(null); setError(STALE); return; }
    onClose();
  }
  const stale = comparison !== null && (comparison.fingerprint !== fingerprint || comparison.includePrices !== includePrices);
  const blocked = Boolean(context.blockedReason) || context.pending;
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <CustomerServiceDialog title="다른 상품 옵션 불러오기" onClose={onClose} wide>
    <section className="goods-option-import">
      <p>상품 하나의 선택형 옵션을 현재 작성 중인 상품에 가져옵니다. 같은 조합은 기존 ID·재고·관리코드를 유지하고, 새 조합은 재고 0으로 만듭니다. 적용 후 상품을 저장해야 반영됩니다.</p>
      {context.blockedReason && <p role="alert">{context.blockedReason}</p>}
      <div className="goods-option-import__search" role="search" aria-label="옵션을 가져올 상품 검색">
        <label>검색 대상<select value={filters.field} disabled={busy || blocked} onChange={event => setFilters(current => ({ ...current, field: event.target.value as GoodsOptionImportFilters['field'] }))}>
          <option value="name">상품명</option><option value="code">상품코드·옵션코드</option><option value="id">상품번호</option>
        </select></label>
        <label>검색어<input maxLength={100} value={filters.query} disabled={busy || blocked} onChange={event => setFilters(current => ({ ...current, query: event.target.value }))}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void run(sequence => search({ ...filters, page: 1 }, sequence)); } }} /></label>
        <label>카테고리<select value={filters.categoryId} disabled={busy || blocked} onChange={event => setFilters(current => ({ ...current, categoryId: event.target.value }))}>
          <option value="">전체</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select></label>
        <button type="button" className="btn btn-ghost" disabled={busy || blocked} onClick={() => void run(sequence => search({ ...filters, page: 1 }, sequence))}>검색</button>
      </div>
      <p role="status">{busy ? '상품 정보를 확인하고 있습니다.' : `검색 결과 ${data.total.toLocaleString('ko-KR')}개`}</p>
      {error && <p role="alert">{error}</p>}
      <div className="goods-option-import__results">
        {data.rows.map(row => <article key={row.id} data-selected={selectedId === row.id || undefined}>
          {row.imageUrl && <img src={row.imageUrl} width={52} height={52} alt="" />}
          <div><strong>{row.name}</strong><small>{row.code} · {row.categoryName ?? '미분류'} · {row.published ? '공개' : '비공개'}</small></div>
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy || blocked || row.id === context.target?.id} onClick={() => void run(sequence => compare(row.id, sequence))}>
            {row.id === context.target?.id ? '현재 상품' : '옵션 비교'}
          </button>
        </article>)}
      </div>
      <nav className="goods-option-import__actions" aria-label="옵션 원본 상품 목록 페이지">
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy || blocked || data.page <= 1} onClick={() => void run(sequence => search({ ...appliedFilters, page: data.page - 1 }, sequence))}>이전</button>
        <span>{data.page} / {pageCount}</span>
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy || blocked || data.page >= pageCount} onClick={() => void run(sequence => search({ ...appliedFilters, page: data.page + 1 }, sequence))}>다음</button>
      </nav>
      <label className="goods-option-import__prices"><input type="checkbox" checked={includePrices} disabled={busy || blocked} onChange={event => setIncludePrices(event.target.checked)} />옵션가도 불러오기</label>
      <p className="muted">선택하면 원본의 일반 저장 기준가와 옵션 금액의 차액을 적용합니다. 현재 상품의 판매가·할인·판매기간은 유지합니다. 원본 재고·관리코드·ERP·KC 정보와 직접입력형 옵션은 가져오지 않습니다.</p>
      {stale && <p role="alert">{STALE}</p>}
      {comparison && <section className="goods-option-import__comparison" aria-label="옵션 적용 전 비교">
        <h3>{comparison.source.name} · 적용 전 비교</h3>
        <p>기존 조합 {comparison.plan.retained}개 유지 · 새 옵션 {comparison.plan.added}개 · 기존 옵션 {comparison.plan.stopped}개 사용 중지 · 기존 옵션가 {comparison.plan.priceChanged}개 변경</p>
        <p>원본에 없는 기존 옵션은 ID·재고·주문 기록을 보존하며 사용 중지합니다. 이미 중지된 옵션은 자동으로 사용 상태가 되지 않습니다. 옵션 구성이 바뀌면 저장 후 KC를 다시 검토해주세요.</p>
        <div className="goods-option-import__table" role="region" aria-label="불러올 옵션과 보존할 기존 옵션" tabIndex={0}>
          <table className="wc-admin-table"><thead><tr><th scope="col">옵션</th><th scope="col">처리</th><th scope="col">현재 옵션가</th><th scope="col">적용 옵션가</th><th scope="col">적용 판매금액</th><th scope="col">재고수량</th></tr></thead>
            <tbody>{comparison.plan.changes.map((row, index) => <tr key={index}><td>{row.name}</td><td>{row.kind === 'added' ? '새 옵션' : row.kind === 'stopped' ? '사용 중지·보존' : row.active ? '기존 유지' : '기존 중지 유지'}</td>
              <td>{row.oldExtraPrice === null ? '—' : formatWon(row.oldExtraPrice)}</td><td>{formatWon(row.extraPrice)}</td><td>{formatWon(basePrice + row.extraPrice)}</td><td>{row.stockQty.toLocaleString('ko-KR')}개</td></tr>)}</tbody>
          </table>
        </div>
      </section>}
      <div className="goods-option-import__actions">
        {selectedId && <button type="button" className="btn btn-ghost" disabled={busy || blocked} onClick={() => void run(sequence => compare(selectedId, sequence))}>다시 비교</button>}
        <button type="button" className="btn" disabled={busy || blocked || !comparison || stale} onClick={() => void run(apply)}>현재 초안에 적용</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>취소</button>
      </div>
    </section>
  </CustomerServiceDialog>;
}
