'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { listCategoryTemplatesAction, saveCategoryTemplatesAction, type CategoryTemplateResult } from '@/app/admin/category-template-actions';
import { selectedCategoryPath, usableTemplateCategory, type CategoryTemplate, type CategoryTemplateChange, type CategoryTemplatePage } from '@/lib/admin/category-templates';
import type { AdminCategoryNode } from '@/lib/admin/category';
import { kstDateTimeText } from '@/lib/admin/list-export';
import { AdminSelect } from '../console/AdminSelect';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '../kit/ui/table';
import { CustomerServiceDialog } from './CustomerServiceDialog';

/* kit 표 모양의 가로 스크롤 영역(ConsoleGrid와 같다): 키보드로 스크롤되도록 바깥 상자가 스크롤 상자다. */
const TABLE_REGION = 'relative min-w-0 overflow-x-auto rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

export function CategoryTemplateTree({ categories, value, onChange, disabled }: { categories: AdminCategoryNode[]; value: string; onChange: (id: string) => void; disabled: boolean }) {
  const path = selectedCategoryPath(categories, value);
  return <div className="grid max-w-full grid-cols-[repeat(4,minmax(10.625rem,1fr))] overflow-x-auto rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50" role="region" aria-label="카테고리 단계 선택 가로 스크롤" tabIndex={0}>
    {[0, 1, 2, 3].map(level => {
      const parent = level === 0 ? null : path[level - 1]?.id;
      const rows = parent === undefined ? [] : categories.filter(row => row.parentId === parent && !row.archivedAt);
      return <ol className="m-0 flex h-[280px] min-w-0 list-none flex-col gap-0.5 overflow-y-auto border-r p-1.5 last:border-r-0" key={level} aria-label={`${level + 1}단계 카테고리`}>{rows.length ? rows.map(row => <li key={row.id}><Button className="h-auto min-h-8 w-full justify-between py-1.5 text-left font-normal whitespace-normal aria-pressed:bg-muted aria-pressed:font-medium" variant="ghost" type="button" disabled={disabled} aria-pressed={path[level]?.id === row.id} onClick={() => onChange(row.id)}>{row.name}{row.childCount > 0 ? <ChevronRight aria-hidden="true" className="text-muted-foreground" /> : null}</Button></li>) : <li className="px-2 py-1.5 text-xs text-muted-foreground">{level === 0 ? '등록된 카테고리가 없습니다.' : '이전 단계를 선택해주세요.'}</li>}</ol>;
    })}
  </div>;
}

export function CategoryTemplatesScreen({ categories = [], onSelect, selectionHint }: { categories?: AdminCategoryNode[]; onSelect?: (template: CategoryTemplate) => void; selectionHint?: string }) {
  const [data, setData] = useState<CategoryTemplatePage | null>(null), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<string[]>([]), [categoryId, setCategoryId] = useState('');
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const busy = useRef(false), mounted = useRef(true), readSequence = useRef(0), request = useRef<{ items: CategoryTemplateChange[]; archived: boolean; id: string } | null>(null);
  useEffect(() => {
    mounted.current = true; const sequence = ++readSequence.current;
    void listCategoryTemplatesAction('', false, 1).then(result => {
      if (!mounted.current || sequence !== readSequence.current) return;
      if (result.ok) setData(result.value); else { setMessage(result.error); setError(true); }
    }).catch(() => { if (mounted.current && sequence === readSequence.current) { setMessage('템플릿을 불러오지 못했습니다. 다시 조회해주세요.'); setError(true); } });
    return () => { mounted.current = false; };
  }, []);
  async function load(page = 1, nextQuery = search, nextArchived = archived) {
    if (busy.current || uncertain) return;
    busy.current = true; setPending(true); const sequence = ++readSequence.current;
    try {
      let result = await listCategoryTemplatesAction(nextQuery, nextArchived, page);
      if (result.ok && page > Math.max(1, Math.ceil(result.value.total / 20))) result = await listCategoryTemplatesAction(nextQuery, nextArchived, Math.max(1, Math.ceil(result.value.total / 20)));
      if (!mounted.current || sequence !== readSequence.current) return;
      if (result.ok) { setData(result.value); setSearch(nextQuery); setArchived(nextArchived); setSelected([]); setConflict(false); setError(false); setMessage(''); }
      else { setMessage(result.error); setError(true); }
    } catch { if (mounted.current && sequence === readSequence.current) { setMessage('템플릿을 불러오지 못했습니다. 선택은 유지합니다.'); setError(true); } }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function save(items: CategoryTemplateChange[], nextArchived: boolean) {
    if (busy.current || conflict) return;
    request.current ??= { items, archived: nextArchived, id: crypto.randomUUID() };
    const fixed = request.current; busy.current = true; readSequence.current++; setPending(true); setMessage('');
    let result: CategoryTemplateResult<CategoryTemplate[]>;
    try { result = await saveCategoryTemplatesAction(fixed.items, fixed.archived, fixed.id); }
    catch { result = { ok: false, uncertain: true, error: '저장 결과를 확인하지 못했습니다. 같은 요청 결과를 확인해주세요.' }; }
    busy.current = false; if (!mounted.current) return; setPending(false);
    if (!result.ok) { setMessage(result.error); setError(true); setUncertain(Boolean(result.uncertain)); setConflict(Boolean(result.conflict)); if (!result.uncertain) request.current = null; return; }
    request.current = null; setUncertain(false); setSelected([]); setCategoryId(''); setError(false);
    // Refresh with the same filters; an emptied last page returns to the preceding page.
    const nextPage = data?.page ?? 1;
    busy.current = true; setPending(true); const sequence = ++readSequence.current;
    try {
      let refreshed = await listCategoryTemplatesAction(search, archived, nextPage);
      if (refreshed.ok && nextPage > Math.max(1, Math.ceil(refreshed.value.total / 20))) refreshed = await listCategoryTemplatesAction(search, archived, Math.max(1, Math.ceil(refreshed.value.total / 20)));
      if (!mounted.current || sequence !== readSequence.current) return;
      if (refreshed.ok) { setData(refreshed.value); setMessage(`${result.value.length}개 카테고리 템플릿을 ${fixed.archived ? '보관' : '등록·복구'}했습니다.`); }
      else { setMessage('저장은 완료됐지만 최신 목록을 불러오지 못했습니다. 다시 조회해주세요.'); setError(true); }
    } catch { if (mounted.current) { setMessage('저장은 완료됐지만 최신 목록을 불러오지 못했습니다. 다시 조회해주세요.'); setError(true); } }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  const locked = pending || uncertain;
  const selectedRows = data?.rows.filter(row => selected.includes(row.categoryId)) ?? [];
  const searchFields = <>
    <label className="flex min-w-[min(100%,15rem)] flex-1 flex-col gap-2 text-sm font-medium">카테고리 이름·코드<Input type="search" value={query} maxLength={120} disabled={locked} onChange={event => setQuery(event.target.value)} /></label>
    {!onSelect ? <label className="flex flex-col gap-2 text-sm font-medium">보관 상태<AdminSelect value={archived ? 'archived' : 'active'} disabled={locked} onChange={event => void load(1, search, event.target.value === 'archived')} wrapperClassName="w-40"><option value="active">사용 중</option><option value="archived">보관됨</option></AdminSelect></label> : null}
    <Button type={onSelect ? 'button' : 'submit'} disabled={locked} onClick={onSelect ? () => void load(1, query, archived) : undefined}>검색</Button>
  </>;
  const searchBox = 'flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 text-card-foreground';
  return <section className="flex min-w-0 flex-col gap-4" aria-busy={pending} data-admin-screen="category-templates">
    <p className="max-w-prose text-sm text-muted-foreground">{selectionHint ?? '자주 쓰는 마지막 단계 카테고리를 저장합니다. 상품에서 불러온 뒤 기본 상품 저장을 누르면 적용됩니다. 템플릿 보관으로 기존 상품 분류가 바뀌지 않습니다.'}</p>
    {onSelect ? <div className={searchBox} role="search" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void load(1, query, archived); } }}>{searchFields}</div>
      : <form className={searchBox} onSubmit={event => { event.preventDefault(); void load(1, query, archived); }}>{searchFields}</form>}
    {message ? <p className={`text-sm${error ? ' text-destructive' : ''}`} role={error ? 'alert' : 'status'}>{message}</p> : null}
    {uncertain ? <Button className="self-start" type="button" disabled={pending} onClick={() => void save(request.current?.items ?? [], request.current?.archived ?? false)}>같은 요청 결과 확인</Button> : null}
    {conflict ? <Button className="self-start" variant="outline" type="button" disabled={pending} onClick={() => void load(data?.page ?? 1)}>최신 목록 다시 조회</Button> : null}
    {data ? <>
      <div className="flex flex-wrap items-center gap-3"><strong className="text-sm font-medium tabular-nums">조회 결과 {data.total.toLocaleString('ko-KR')}건</strong>{!onSelect ? <Button size="sm" variant="outline" type="button" disabled={locked || conflict || !selectedRows.length} onClick={() => void save(selectedRows.map(row => ({ categoryId: row.categoryId, revision: row.revision })), !archived)}>{archived ? '선택 복구' : '선택 보관'} {selectedRows.length}개</Button> : null}</div>
      <div className={TABLE_REGION} role="region" aria-label="카테고리 템플릿 목록 가로 스크롤" tabIndex={0}><table className="w-full min-w-[640px] caption-bottom text-sm" data-slot="table"><caption className="sr-only">카테고리 템플릿 목록</caption><TableHeader><TableRow className="bg-muted/50">
        {onSelect ? <TableHead className="w-20">선택</TableHead> : <TableHead className="relative w-10 p-0"><label className="absolute inset-0 flex cursor-pointer items-center justify-center"><input type="checkbox" aria-label="현재 페이지 모두 선택" checked={data.rows.length > 0 && data.rows.every(row => selected.includes(row.categoryId))} disabled={locked || !data.rows.length} onChange={event => setSelected(event.target.checked ? data.rows.map(row => row.categoryId) : [])} /></label></TableHead>}<TableHead>카테고리</TableHead><TableHead>등록일</TableHead>
      </TableRow></TableHeader><TableBody>{data.rows.map(row => <TableRow key={row.categoryId} data-state={selected.includes(row.categoryId) ? 'selected' : undefined}>{onSelect ? <TableCell><Button size="xs" variant="outline" type="button" disabled={locked || !row.usable} onClick={() => onSelect(row)}>선택</Button></TableCell> : <TableCell className="relative w-10 p-0"><label className="absolute inset-0 flex cursor-pointer items-center justify-center"><input type="checkbox" aria-label={`${row.path.join(' > ')} 선택`} checked={selected.includes(row.categoryId)} disabled={locked} onChange={event => setSelected(current => event.target.checked ? [...current, row.categoryId] : current.filter(id => id !== row.categoryId))} /></label></TableCell>}<TableCell className="whitespace-normal">{row.path.join(' > ')}<small className="block text-xs text-muted-foreground">{row.code}{!row.usable ? ' · 사용 불가: 보관됐거나 하위 카테고리가 있습니다.' : ''}</small></TableCell><TableCell className="tabular-nums">{kstDateTimeText(row.createdAt)}</TableCell></TableRow>)}{!data.rows.length ? <TableRow><TableCell className="h-24 text-center text-muted-foreground" colSpan={3}>등록된 카테고리 템플릿이 없습니다.</TableCell></TableRow> : null}</TableBody></table></div>
      <nav className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm" aria-label="카테고리 템플릿 페이지"><span className="text-muted-foreground tabular-nums">{data.page} / {Math.max(1, Math.ceil(data.total / 20))} 페이지</span><span className="flex items-center gap-1.5"><Button size="sm" variant="outline" type="button" disabled={locked || data.page <= 1} onClick={() => void load(data.page - 1)}>이전</Button><Button size="sm" variant="outline" type="button" disabled={locked || data.page * 20 >= data.total} onClick={() => void load(data.page + 1)}>다음</Button></span></nav>
    </> : <p className="text-sm text-muted-foreground" role="status">{message ? '조회 후에 템플릿을 관리할 수 있습니다.' : '템플릿을 불러오는 중…'}</p>}
    {!onSelect ? <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground sm:p-5" data-category-templates="register"><h2 className="text-base leading-snug font-medium">카테고리 템플릿 등록</h2><CategoryTemplateTree categories={categories} value={categoryId} onChange={setCategoryId} disabled={locked || conflict} /><p className="text-sm">선택한 카테고리: <strong className="font-medium">{selectedCategoryPath(categories, categoryId).map(row => row.name).join(' > ') || '선택 안 함'}</strong></p><Button className="self-start" type="button" disabled={locked || conflict || !data || !usableTemplateCategory(categories, categoryId)} onClick={() => void save([{ categoryId, revision: 0 }], false)}>등록</Button><p className="text-sm text-muted-foreground">이미 등록된 분류는 중복 등록하지 않습니다. 보관한 템플릿은 보관됨 목록에서 복구해주세요.</p></section> : null}
  </section>;
}

export function CategoryTemplatePicker({ onSelect, onClose }: { onSelect: (template: CategoryTemplate) => void; onClose: () => void }) {
  // The picker belongs to the product form's React tree, but never its DOM form.
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="wc-admin"><CustomerServiceDialog title="카테고리 템플릿" onClose={onClose} wide><CategoryTemplatesScreen onSelect={onSelect} /></CustomerServiceDialog></div>, document.body);
}
