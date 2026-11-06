'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadCategoryCodesAction } from '@/app/admin/category-code-actions';
import { CATEGORY_EXPORT_API_PATH, type AdminCategoryNode } from '@/lib/admin/category';
import { categoryCodeChoices } from '@/lib/admin/category-code-finder';
import { selectedCategoryPath, usableTemplateCategory } from '@/lib/admin/category-templates';
import { Copy, Download } from 'lucide-react';
import { CategoryTemplateTree, CategoryTemplatesScreen } from './screens/CategoryTemplatesScreen';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import { Button, buttonVariants } from './kit/ui/button';
import { Input } from './kit/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from './kit/ui/table';

/* 찾기 방식 전환(셸의 콘솔 전환과 같은 모양, 템플릿 룩). */
const MODE = 'text-muted-foreground hover:bg-transparent aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm';

export function CategoryCodeFinder({ onClose }: { onClose: () => void }) {
  const [categories, setCategories] = useState<AdminCategoryNode[] | null>(null);
  const [mode, setMode] = useState<'search' | 'tree' | 'templates'>('search');
  const [query, setQuery] = useState(''), [page, setPage] = useState(1), [selectedId, setSelectedId] = useState('');
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const mounted = useRef(true), sequence = useRef(0);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  async function load() {
    const current = ++sequence.current; setPending(true); setMessage('');
    try {
      const result = await loadCategoryCodesAction();
      if (!mounted.current || current !== sequence.current) return;
      if (result.ok) { setCategories(result.categories); setSelectedId(''); setPage(1); setError(false); }
      else { setCategories(null); setMessage(result.error); setError(true); }
    } catch {
      if (mounted.current && current === sequence.current) { setCategories(null); setMessage('카테고리 코드를 불러오지 못했습니다. 다시 조회해주세요.'); setError(true); }
    } finally { if (mounted.current && current === sequence.current) setPending(false); }
  }
  const selected = categories?.find(row => row.id === selectedId);
  const usable = Boolean(categories && usableTemplateCategory(categories, selectedId));
  const choices = useMemo(() => categoryCodeChoices(categories ?? []), [categories]);
  const rows = choices.filter(row => `${row.path} ${row.code}`.toLocaleLowerCase('ko').includes(query.trim().toLocaleLowerCase('ko')));
  const lastPage = Math.max(1, Math.ceil(rows.length / 20));
  function select(id: string) { setSelectedId(id); setMessage(''); setError(false); }
  async function copy() {
    if (!selected || !usable || pending) return;
    try { await navigator.clipboard.writeText(selected.code); if (mounted.current) { setMessage('카테고리 코드를 복사했습니다. 엑셀의 고객 카테고리 코드 또는 추가 카테고리 코드 칸에 붙여넣으세요.'); setError(false); } }
    catch { if (mounted.current) { setMessage('자동 복사를 허용하지 않는 환경입니다. 아래 코드 입력칸을 선택해 복사해주세요.'); setError(true); } }
  }
  /* 4단계 카테고리 선택(단계당 170px)이 들어가도록 넓은 팝업으로 연다. */
  return <CustomerServiceDialog title="카테고리 찾기" onClose={onClose} wide>
    <section className="flex min-w-0 flex-col gap-4" aria-busy={pending} data-admin-screen="category-code-finder">
      <div className="flex flex-wrap items-center gap-2">
        <a className={buttonVariants({ variant: 'outline' })} data-slot="button" href={CATEGORY_EXPORT_API_PATH}><Download aria-hidden="true" />전체코드 CSV 다운로드</a>
        <Button variant="outline" type="button" disabled={pending} onClick={() => void load()}>최신 카테고리 다시 조회</Button>
      </div>
      <p className="text-sm text-muted-foreground">ICONS 자체 양식에 사용하는 코드입니다. 새로 연결할 수 있는 사용 중 말단만 선택하며, 전체코드 CSV에는 상위·보관 분류와 상태도 포함합니다.</p>
      <div className="inline-flex w-fit flex-wrap rounded-lg bg-muted p-0.5" role="group" aria-label="카테고리 찾기 방식">
        {([['search', '카테고리명 검색'], ['tree', '카테고리 선택'], ['templates', '카테고리 템플릿']] as const).map(([value, label]) => <Button key={value} variant="ghost" size="sm" type="button" className={MODE} aria-pressed={mode === value} disabled={pending || !categories} onClick={() => setMode(value)}>{label}</Button>)}
      </div>
      {pending ? <p className="text-sm text-muted-foreground" role="status">카테고리 코드를 불러오는 중…</p> : null}
      {message ? <p className={`text-sm${error ? ' text-destructive' : ''}`} role={error ? 'alert' : 'status'}>{message}</p> : null}
      {categories && !pending ? <>
        {mode === 'search' ? <>
          <label className="flex flex-col gap-2 text-sm font-medium">카테고리명·코드<Input type="search" maxLength={120} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
          <p className="text-sm tabular-nums">조회 결과 {rows.length.toLocaleString('ko-KR')}건</p>
          <div className="relative min-w-0 overflow-x-auto rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50" role="region" aria-label="카테고리 코드 목록 가로 스크롤" tabIndex={0}><table className="w-full min-w-[640px] caption-bottom text-sm" data-slot="table"><caption className="sr-only">사용 가능한 카테고리 코드</caption><TableHeader><TableRow className="bg-muted/50"><TableHead className="w-20">선택</TableHead><TableHead>카테고리</TableHead><TableHead>코드</TableHead></TableRow></TableHeader><TableBody>
            {rows.slice((page - 1) * 20, page * 20).map(row => <TableRow key={row.id} data-state={selectedId === row.id ? 'selected' : undefined}><TableCell><Button size="xs" variant="outline" type="button" className="aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground" aria-pressed={selectedId === row.id} onClick={() => select(row.id)}>선택</Button></TableCell><TableCell className="whitespace-normal">{row.path}</TableCell><TableCell className="tabular-nums">{row.code}</TableCell></TableRow>)}
            {!rows.length ? <TableRow><TableCell className="h-24 text-center text-muted-foreground" colSpan={3}>선택할 수 있는 카테고리가 없습니다.</TableCell></TableRow> : null}
          </TableBody></table></div>
          <nav className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm" aria-label="카테고리 코드 페이지"><span className="text-muted-foreground tabular-nums">{page} / {lastPage} 페이지</span><span className="flex items-center gap-1.5"><Button size="sm" variant="outline" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</Button><Button size="sm" variant="outline" type="button" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>다음</Button></span></nav>
        </> : mode === 'tree' ? <CategoryTemplateTree categories={categories} value={selectedId} onChange={select} disabled={false} />
          : <CategoryTemplatesScreen selectionHint="템플릿을 선택하면 아래에 카테고리 코드가 표시됩니다. 코드 복사 후 ICONS 상품 엑셀에 붙여넣으세요." onSelect={template => {
            if (!template.usable || !usableTemplateCategory(categories, template.categoryId)) { setMessage('현재 사용할 수 없는 카테고리입니다. 최신 카테고리를 다시 조회해주세요.'); setError(true); return; }
            select(template.categoryId);
          }} />}
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4" data-category-code-finder="selection"><p className="text-sm">선택한 카테고리: <strong className="font-medium">{selectedCategoryPath(categories, selectedId).map(row => row.name).join(' > ') || '선택 안 함'}</strong></p>
          <label className="flex flex-col gap-2 text-sm font-medium">선택한 카테고리 코드<Input className="bg-background sm:max-w-sm" readOnly value={usable ? selected?.code ?? '' : ''} onFocus={event => event.target.select()} /></label>
          {selected && !usable ? <p className="text-sm text-muted-foreground">사용 중인 마지막 단계 카테고리까지 선택해주세요.</p> : null}
          <Button className="self-start" type="button" disabled={!usable} onClick={() => void copy()}><Copy aria-hidden="true" />코드 복사</Button>
        </div>
      </> : null}
    </section>
  </CustomerServiceDialog>;
}
