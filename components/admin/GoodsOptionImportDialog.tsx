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
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { GOOD_INPUT_CLASS, GOOD_TABLE_FRAME_CLASS } from './GoodEditorParts';

const INITIAL_FILTERS: GoodsOptionImportFilters = { query: '', field: 'name', categoryId: '', page: 1 };
const EMPTY: GoodsOptionImportPage = { rows: [], total: 0, page: 1, pageSize: 20 };
const STALE = '비교 중인 가격·옵션 또는 상품 정보가 바뀌었습니다. 현재 입력을 유지했으니 다시 비교해주세요.';
type Comparison = { source: GoodsOptionImportSource; targetVersion: string; fingerprint: string; includePrices: boolean; plan: GoodsOptionImportPlan };
/* 템플릿 룩(ADR-0028). 테스트가 이 컴포넌트를 함수로 불러 네이티브 버튼·체크박스를 찾으므로 버튼은 네이티브에 kit 모양을 입힌다. */
const FIELD_LABEL_CLASS = 'text-sm font-medium text-foreground';
const HEAD_CLASS = 'px-3 text-xs font-medium text-muted-foreground';

/** Keep picker inputs outside the product's native form and autosave listeners. */
export function GoodsOptionImportPicker(props: Parameters<typeof GoodsOptionImportDialog>[0]) {
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="wc-admin" onChange={event => event.stopPropagation()} onSubmit={event => event.stopPropagation()}>
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
    <section className="flex min-w-0 flex-col gap-4 text-sm" data-good-option-import-dialog="">
      <p className="text-muted-foreground">상품 하나의 선택형 옵션을 현재 작성 중인 상품에 가져옵니다. 같은 조합은 기존 ID·재고·관리코드를 유지하고, 새 조합은 재고 0으로 만듭니다. 적용 후 상품을 저장해야 반영됩니다.</p>
      {context.blockedReason && <p className="text-destructive" role="alert">{context.blockedReason}</p>}
      <div className="grid min-w-0 items-end gap-3 sm:grid-cols-[9.5rem_minmax(0,1fr)_minmax(0,1fr)_auto]" role="search" aria-label="옵션을 가져올 상품 검색">
        <div className="flex min-w-0 flex-col gap-2">
          <label className={FIELD_LABEL_CLASS} htmlFor="goods-option-import-field">검색 대상</label>
          <NativeSelect className="w-full" id="goods-option-import-field" value={filters.field} disabled={busy || blocked} onChange={event => setFilters(current => ({ ...current, field: event.target.value as GoodsOptionImportFilters['field'] }))}>
            <option value="name">상품명</option><option value="code">상품코드·옵션코드</option><option value="id">상품번호</option>
          </NativeSelect>
        </div>
        <label className={`flex min-w-0 flex-col gap-2 ${FIELD_LABEL_CLASS}`}>검색어<input className={GOOD_INPUT_CLASS} data-slot="input" maxLength={100} value={filters.query} disabled={busy || blocked} onChange={event => setFilters(current => ({ ...current, query: event.target.value }))}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void run(sequence => search({ ...filters, page: 1 }, sequence)); } }} /></label>
        <div className="flex min-w-0 flex-col gap-2">
          <label className={FIELD_LABEL_CLASS} htmlFor="goods-option-import-category">카테고리</label>
          <NativeSelect className="w-full" id="goods-option-import-category" value={filters.categoryId} disabled={busy || blocked} onChange={event => setFilters(current => ({ ...current, categoryId: event.target.value }))}>
            <option value="">전체</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </NativeSelect>
        </div>
        <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={busy || blocked} onClick={() => void run(sequence => search({ ...filters, page: 1 }, sequence))}>검색</button>
      </div>
      <p className="text-muted-foreground" role="status">{busy ? '상품 정보를 확인하고 있습니다.' : `검색 결과 ${data.total.toLocaleString('ko-KR')}개`}</p>
      {error && <p className="text-destructive" role="alert">{error}</p>}
      <div className="flex min-w-0 flex-col gap-2">
        {data.rows.map(row => <article key={row.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border p-3 data-selected:border-primary data-selected:ring-1 data-selected:ring-primary sm:flex-nowrap" data-selected={selectedId === row.id || undefined}>
          {row.imageUrl && <img className="size-13 shrink-0 rounded-md bg-muted object-cover" src={row.imageUrl} width={52} height={52} alt="" />}
          <div className="min-w-0 flex-1 wrap-anywhere"><strong className="font-medium">{row.name}</strong><small className="mt-1 block text-xs text-muted-foreground">{row.code} · {row.categoryName ?? '미분류'} · {row.published ? '공개' : '비공개'}</small></div>
          <button type="button" className={`${buttonVariants({ variant: 'outline', size: 'sm' })} ml-auto`} data-slot="button" disabled={busy || blocked || row.id === context.target?.id} onClick={() => void run(sequence => compare(row.id, sequence))}>
            {row.id === context.target?.id ? '현재 상품' : '옵션 비교'}
          </button>
        </article>)}
      </div>
      <nav className="flex flex-wrap items-center justify-end gap-3" aria-label="옵션 원본 상품 목록 페이지">
        <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" disabled={busy || blocked || data.page <= 1} onClick={() => void run(sequence => search({ ...appliedFilters, page: data.page - 1 }, sequence))}>이전</button>
        <span className="text-muted-foreground tabular-nums">{data.page} / {pageCount}</span>
        <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" disabled={busy || blocked || data.page >= pageCount} onClick={() => void run(sequence => search({ ...appliedFilters, page: data.page + 1 }, sequence))}>다음</button>
      </nav>
      <label className="inline-flex w-fit cursor-pointer items-center gap-2 font-medium has-disabled:cursor-not-allowed has-disabled:opacity-50"><input type="checkbox" checked={includePrices} disabled={busy || blocked} onChange={event => setIncludePrices(event.target.checked)} />옵션가도 불러오기</label>
      <p className="text-muted-foreground">선택하면 원본의 일반 저장 기준가와 옵션 금액의 차액을 적용합니다. 현재 상품의 판매가·할인·판매기간은 유지합니다. 원본 재고·관리코드·ERP·KC 정보와 직접입력형 옵션은 가져오지 않습니다.</p>
      {stale && <p className="text-destructive" role="alert">{STALE}</p>}
      {comparison && <section className="flex min-w-0 flex-col gap-3 border-t pt-4" aria-label="옵션 적용 전 비교">
        <h3 className="text-base leading-snug font-medium">{comparison.source.name} · 적용 전 비교</h3>
        <p>기존 조합 {comparison.plan.retained}개 유지 · 새 옵션 {comparison.plan.added}개 · 기존 옵션 {comparison.plan.stopped}개 사용 중지 · 기존 옵션가 {comparison.plan.priceChanged}개 변경</p>
        <p className="text-muted-foreground">원본에 없는 기존 옵션은 ID·재고·주문 기록을 보존하며 사용 중지합니다. 이미 중지된 옵션은 자동으로 사용 상태가 되지 않습니다. 옵션 구성이 바뀌면 저장 후 KC를 다시 검토해주세요.</p>
        <div className={GOOD_TABLE_FRAME_CLASS} role="region" aria-label="불러올 옵션과 보존할 기존 옵션" tabIndex={0}>
          <Table className="min-w-[41rem]"><TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead scope="col" className={HEAD_CLASS}>옵션</TableHead><TableHead scope="col" className={HEAD_CLASS}>처리</TableHead><TableHead scope="col" className={`${HEAD_CLASS} text-right`}>현재 옵션가</TableHead><TableHead scope="col" className={`${HEAD_CLASS} text-right`}>적용 옵션가</TableHead><TableHead scope="col" className={`${HEAD_CLASS} text-right`}>적용 판매금액</TableHead><TableHead scope="col" className={`${HEAD_CLASS} text-right`}>재고수량</TableHead></TableRow></TableHeader>
            <TableBody>{comparison.plan.changes.map((row, index) => <TableRow key={index}><TableCell className="px-3 whitespace-normal wrap-anywhere">{row.name}</TableCell><TableCell className="px-3">{row.kind === 'added' ? '새 옵션' : row.kind === 'stopped' ? '사용 중지·보존' : row.active ? '기존 유지' : '기존 중지 유지'}</TableCell>
              <TableCell className="px-3 text-right tabular-nums">{row.oldExtraPrice === null ? '—' : formatWon(row.oldExtraPrice)}</TableCell><TableCell className="px-3 text-right tabular-nums">{formatWon(row.extraPrice)}</TableCell><TableCell className="px-3 text-right tabular-nums">{formatWon(basePrice + row.extraPrice)}</TableCell><TableCell className="px-3 text-right tabular-nums">{row.stockQty.toLocaleString('ko-KR')}개</TableCell></TableRow>)}</TableBody>
          </Table>
        </div>
      </section>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
        {selectedId && <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={busy || blocked} onClick={() => void run(sequence => compare(selectedId, sequence))}>다시 비교</button>}
        <button type="button" className={buttonVariants()} data-slot="button" disabled={busy || blocked || !comparison || stale} onClick={() => void run(apply)}>현재 초안에 적용</button>
        <button type="button" className={buttonVariants({ variant: 'ghost' })} data-slot="button" onClick={onClose}>취소</button>
      </div>
    </section>
  </CustomerServiceDialog>;
}
