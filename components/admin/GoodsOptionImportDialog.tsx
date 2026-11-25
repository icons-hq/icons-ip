'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { readGoodsOptionImportAction, searchGoodsOptionImportAction } from '@/app/admin/goods-option-import-actions';
import { goodsOptionImportTargetVersion, planGoodsOptionImport, validOptionImportGoodId, type GoodsOptionImportContext,
  type GoodsOptionImportPlan, type GoodsOptionImportSource } from '@/lib/admin/goods-option-import';
import type { GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import { formatWon } from '@/lib/admin/goods-price-editor';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import { AdminPickerPanel } from '@/components/admin/console/AdminPickerDialog';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { ADMIN_GOODS_PICKER_FIELDS, adminGoodsPickerCategoryOptions, adminGoodsPickerRowView, type AdminGoodsPickerRow } from './AdminGoodsPicker';
import { GOOD_TABLE_FRAME_CLASS, GoodReadback } from './GoodEditorParts';

/*
 * 다른 상품 옵션 불러오기. 두 단계다.
 *   1. 상품 고르기 — 공용 선택창(AdminPickerPanel, 화면 규칙 1). 불러올 선택형 옵션이 없는 상품과 지금 편집 중인 상품은
 *      조회에서 빼고 한 줄로 알린다(규칙 2). 총 개수와 페이지는 걸러 낸 뒤의 수다.
 *   2. 옵션 비교 → [이대로 불러오기] — 무엇이 남고·생기고·사용 중지되는지 표로 보여 준 뒤 지금 입력에 넣는다.
 * 2단계의 확인(로그인 계정·고른 상품과 지금 상품의 저장본·입력 지문)은 비교할 때와 불러오기 직전에 한 번씩 다시 한다.
 */
/* 다시 하는 방법은 단계마다 다르다: 목록에서는 상품을 다시 고르고, 비교 화면에서는 [다시 비교]를 누른다. */
const RETRY = { pick: '상품을 다시 선택해 주세요.', compare: '[다시 비교]를 눌러 주세요.' } as const;
const staleMessage = (stage: keyof typeof RETRY) => `비교하는 동안 지금 상품의 가격이나 옵션이 바뀌었습니다. 입력한 내용은 그대로이니 ${RETRY[stage]}`;
const ACCOUNT_CHANGED = '로그인 계정이 바뀌었습니다. 상품 화면을 다시 열어주세요.';
type Comparison = { source: GoodsOptionImportSource; targetVersion: string; fingerprint: string; includePrices: boolean; plan: GoodsOptionImportPlan };
type Selected = { id: string; name: string };
/* 템플릿 룩(ADR-0028). 테스트가 이 컴포넌트를 함수로 불러 네이티브 버튼·체크박스를 찾으므로 버튼은 네이티브에 kit 모양을 입힌다. */
const HEAD_CLASS = 'px-3 text-xs font-medium text-muted-foreground';
const CHANGE_LABEL = { added: '새 옵션', stopped: '사용 중지', kept: '그대로', keptStopped: '사용 중지 그대로' } as const;

/** 목록에서 뺄 지금 편집 중인 상품. 새 상품이거나 검색 조건으로 보낼 수 없는 값이면 빼지 않는다(그 상품을 고르면 서버가 거절한다). */
function excludedGoodId(context: GoodsOptionImportContext): string | null {
  return context.target && validOptionImportGoodId(context.target.id) ? context.target.id : null;
}

/** Keep picker inputs outside the product's native form and autosave listeners. */
export function GoodsOptionImportPicker(props: Parameters<typeof GoodsOptionImportDialog>[0]) {
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="wc-admin" onChange={event => event.stopPropagation()} onInput={event => event.stopPropagation()} onSubmit={event => event.stopPropagation()}>
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
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [selected, setSelected] = useState<Selected | null>(null), [includePrices, setIncludePrices] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const active = useRef(true), operation = useRef(false), readSequence = useRef({ value: 0 });
  const live = useRef({ context, fingerprint, currentRows, basePrice, includePrices, onApply });
  useEffect(() => { live.current = { context, fingerprint, currentRows, basePrice, includePrices, onApply }; }, [context, fingerprint, currentRows, basePrice, includePrices, onApply]);
  /* 창을 닫은 뒤 늦게 도착한 응답은 작성 중인 상품을 바꾸지 않는다. */
  useEffect(() => {
    active.current = true;
    const requests = readSequence.current;
    return () => { active.current = false; requests.value++; };
  }, []);

  /* 고른 상품의 비교가 한 번 끝나면 비교 화면(2단계)에 머문다. 그 전에는 목록(1단계)에서 이유를 보이고 다른 상품을 바로 고르게 한다. */
  const stage = selected ? 'compare' : 'pick';
  function canContinue(expected: string, sequence: number) {
    const current = live.current;
    return active.current && readSequence.current.value === sequence && !current.context.pending && !current.context.blockedReason && current.fingerprint === expected;
  }
  async function run(task: (sequence: number) => Promise<void>) {
    if (busy || operation.current || context.pending || context.blockedReason) return;
    const sequence = ++readSequence.current.value;
    operation.current = true; setBusy(true); setError('');
    try { await task(sequence); }
    catch { if (active.current && readSequence.current.value === sequence) { setComparison(null); setError(`상품과 옵션을 확인하지 못했습니다. 입력한 내용은 그대로이니 ${RETRY[stage]}`); } }
    finally { operation.current = false; if (active.current && readSequence.current.value === sequence) setBusy(false); }
  }
  /*
   * 1단계 목록. 같은 상품 검색에 "선택형 옵션이 있는 상품만"과 "지금 편집 중인 상품 제외"를 건다 — 고를 수 없는 상품은 목록에 넣지 않는다.
   * 그사이 로그인 계정이 바뀐 응답은 받지 않는다.
   */
  const load: AdminPickerLoader<AdminGoodsPickerRow> = async (request) => {
    const editing = excludedGoodId(live.current.context);
    const result = await searchGoodsOptionImportAction({ query: request.query, field: request.field || 'name', categoryId: request.filter, page: request.page,
      optionSourcesOnly: true, ...(editing ? { excludeGoodId: editing } : {}) });
    if (!result.ok) return { error: result.error };
    if (result.accountId !== live.current.context.accountId) return { error: ACCOUNT_CHANGED };
    return result.data;
  };
  async function compare(source: Selected, sequence: number) {
    const captured = live.current;
    setComparison(null);
    const result = await readGoodsOptionImportAction({ sourceId: source.id, targetId: captured.context.target?.id ?? null });
    if (!active.current || readSequence.current.value !== sequence) return;
    if (!canContinue(captured.fingerprint, sequence) || captured.includePrices !== live.current.includePrices) { setError(staleMessage(stage)); return; }
    if (!result.ok) { setError(result.error); return; }
    if (result.accountId !== captured.context.accountId || result.source.id !== source.id) { setError(`현재 계정과 불러올 상품을 확인하지 못했습니다. ${RETRY[stage]}`); return; }
    if (result.targetVersion !== goodsOptionImportTargetVersion(captured.context.target)) { setError('이 상품 화면을 연 뒤 다른 곳에서 옵션·가격·재고가 바뀌었습니다. 입력하던 내용을 따로 적어 둔 뒤 상품 화면을 새로고침해주세요.'); return; }
    const planned = planGoodsOptionImport({ current: captured.currentRows, source: result.source, basePrice: captured.basePrice, includePrices: captured.includePrices });
    if (!planned.ok) { setError(planned.error); return; }
    setSelected(source);
    setComparison({ source: result.source, targetVersion: result.targetVersion, fingerprint: captured.fingerprint, includePrices: captured.includePrices, plan: planned.plan });
  }
  async function apply(sequence: number) {
    const captured = comparison;
    if (!captured || !canContinue(captured.fingerprint, sequence) || captured.includePrices !== live.current.includePrices) { setComparison(null); setError(staleMessage('compare')); return; }
    const result = await readGoodsOptionImportAction({ sourceId: captured.source.id, targetId: live.current.context.target?.id ?? null });
    if (!active.current || readSequence.current.value !== sequence) return;
    if (!canContinue(captured.fingerprint, sequence) || captured.includePrices !== live.current.includePrices) { setComparison(null); setError(staleMessage('compare')); return; }
    if (!result.ok) { setComparison(null); setError(result.error); return; }
    if (result.accountId !== live.current.context.accountId || result.source.id !== captured.source.id
      || result.source.version !== captured.source.version || result.targetVersion !== captured.targetVersion) {
      setComparison(null); setError('비교한 뒤에 고른 상품이나 지금 상품이 다른 곳에서 바뀌었습니다. 불러오지 않았으니 [다시 비교]를 눌러 주세요.'); return;
    }
    if (!live.current.onApply(captured.plan, captured.fingerprint)) { setComparison(null); setError(staleMessage('compare')); return; }
    onClose();
  }
  /* 선택창의 [선택]. 비교가 끝나도 창은 닫지 않는다(false) — 비교 화면으로 넘어가거나, 불러올 수 없는 이유를 목록 위에 보인다. */
  async function choose(row: AdminGoodsPickerRow) {
    await run(sequence => compare({ id: row.id, name: row.name }, sequence));
    return false;
  }
  function pickAnother() {
    if (busy) return;
    setSelected(null); setComparison(null); setError('');
  }
  const stale = comparison !== null && (comparison.fingerprint !== fingerprint || comparison.includePrices !== includePrices);
  const blockedReason = context.blockedReason ?? (context.pending ? '상품을 저장하고 있습니다. 저장이 끝난 뒤 다시 눌러 주세요.' : null);
  const blocked = Boolean(blockedReason);
  /* 옵션가를 함께 불러올지는 두 단계 어디서나 고른다. 고른 뒤에 바꾸면 [다시 비교]로 표를 다시 만든다. */
  const priceToggle = <label className="inline-flex w-fit cursor-pointer items-center gap-2 font-medium has-disabled:cursor-not-allowed has-disabled:opacity-50">
    <input type="checkbox" checked={includePrices} disabled={busy || blocked} onChange={event => setIncludePrices(event.target.checked)} />옵션가도 불러오기
  </label>;
  return <CustomerServiceDialog title="다른 상품 옵션 불러오기" onClose={onClose} wide>
    <div className="flex min-w-0 flex-col gap-4 text-sm" data-good-option-import-dialog="" data-good-option-import-stage={stage}>
      {error && <p className="text-destructive wrap-anywhere" role="alert">{error}</p>}
      {selected === null ? <AdminPickerPanel<AdminGoodsPickerRow>
        blockedReason={blockedReason}
        description="고른 상품의 옵션명과 옵션값을 불러옵니다. 재고와 코드는 불러오지 않습니다."
        excludedNote={excludedGoodId(context) ? '옵션이 없는 상품과 지금 편집 중인 상품은 목록에서 뺐습니다.' : '옵션이 없는 상품은 목록에서 뺐습니다.'}
        filterLabel="카테고리"
        filterOptions={categories.length ? adminGoodsPickerCategoryOptions(categories) : undefined}
        footer={priceToggle}
        load={load}
        onClose={onClose}
        onSelect={choose}
        rowKey={good => good.id}
        rowView={adminGoodsPickerRowView}
        searchFields={ADMIN_GOODS_PICKER_FIELDS}
        searchPlaceholder="상품명·상품 자동코드"
        showImages
      /> : <>
        <section className="flex min-w-0 flex-col gap-3" aria-label="옵션을 불러오기 전 비교">
          <h3 className="text-base leading-snug font-medium wrap-anywhere">{selected.name}</h3>
          {blockedReason && <p className="text-destructive" role="alert">{blockedReason}</p>}
          {priceToggle}
          {stale && <p className="text-destructive" role="alert">{staleMessage('compare')}</p>}
          {busy && !comparison && <p className="text-muted-foreground" role="status">옵션을 비교하고 있습니다.</p>}
          {comparison && <>
            <GoodReadback>지금 옵션 그대로 {comparison.plan.retained}개 · 새 옵션 {comparison.plan.added}개 · 사용 중지 {comparison.plan.stopped}개 · 옵션가 바뀜 {comparison.plan.priceChanged}개</GoodReadback>
            <div className={GOOD_TABLE_FRAME_CLASS} role="region" aria-label="불러올 옵션과 지금 옵션" tabIndex={0}>
              <Table className="min-w-[41rem]"><TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead scope="col" className={HEAD_CLASS}>옵션</TableHead><TableHead scope="col" className={HEAD_CLASS}>불러온 뒤</TableHead><TableHead scope="col" className={`${HEAD_CLASS} text-right`}>지금 옵션가</TableHead><TableHead scope="col" className={`${HEAD_CLASS} text-right`}>불러온 뒤 옵션가</TableHead><TableHead scope="col" className={`${HEAD_CLASS} text-right`}>불러온 뒤 판매 금액</TableHead><TableHead scope="col" className={`${HEAD_CLASS} text-right`}>재고수량</TableHead></TableRow></TableHeader>
                <TableBody>{comparison.plan.changes.map((row, index) => <TableRow key={index}><TableCell className="px-3 whitespace-normal wrap-anywhere">{row.name}</TableCell><TableCell className="px-3">{CHANGE_LABEL[row.kind === 'kept' && !row.active ? 'keptStopped' : row.kind]}</TableCell>
                  <TableCell className="px-3 text-right tabular-nums">{row.oldExtraPrice === null ? '—' : formatWon(row.oldExtraPrice)}</TableCell><TableCell className="px-3 text-right tabular-nums">{formatWon(row.extraPrice)}</TableCell><TableCell className="px-3 text-right tabular-nums">{formatWon(basePrice + row.extraPrice)}</TableCell><TableCell className="px-3 text-right tabular-nums">{row.kind === 'added' ? '비어 있음' : `${row.stockQty.toLocaleString('ko-KR')}개`}</TableCell></TableRow>)}</TableBody>
              </Table>
            </div>
            {/* 화면에 보이지 않는 결과만 한 줄로 남긴다: 저장해야 반영되고, 옵션이 바뀌면 KC를 다시 검토한다. */}
            <p className="text-muted-foreground">불러온 뒤 상품을 저장해야 반영됩니다. 옵션이 바뀌면 저장한 뒤 KC를 다시 검토해 주세요.</p>
          </>}
        </section>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <button type="button" className={`${buttonVariants({ variant: 'ghost' })} mr-auto`} data-slot="button" disabled={busy} onClick={pickAnother}>다른 상품 고르기</button>
          <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={busy || blocked} onClick={() => void run(sequence => compare(selected, sequence))}>다시 비교</button>
          <button type="button" className={buttonVariants()} data-slot="button" disabled={busy || blocked || !comparison || stale} onClick={() => void run(apply)}>이대로 불러오기</button>
          <button type="button" className={buttonVariants({ variant: 'ghost' })} data-slot="button" onClick={onClose}>닫기</button>
        </div>
      </>}
    </div>
  </CustomerServiceDialog>;
}
