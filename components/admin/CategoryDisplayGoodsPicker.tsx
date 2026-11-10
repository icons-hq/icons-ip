'use client';
import { useEffect, useRef, useState } from 'react';
import { searchCategoryDisplayGoodsAction } from '@/app/admin/category-display-actions';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import type { StoryGoodCandidates, StoryGoodCandidate } from '@/lib/admin/shopping-story-picker';
import { krw } from '@/lib/format';
import { findGoodById, GOOD_URL_ERRORS } from '@/lib/admin/good-url';
import { GoodUrlAddField } from './GoodUrlAddField';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';

export function CategoryDisplayGoodsPicker({ selected, limit, onlyPublished = false, onApply, onClose }: {
  selected: string[]; limit: number; onlyPublished?: boolean; onApply: (ids: string[], rows: StoryGoodCandidate[]) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState(''), [categoryId, setCategoryId] = useState(''), [applied, setApplied] = useState({ query: '', categoryId: '' });
  const [picked, setPicked] = useState(selected), [data, setData] = useState<StoryGoodCandidates | null>(null), [pending, setPending] = useState(true), [error, setError] = useState('');
  const ticket = useRef(0), known = useRef(new Map<string, StoryGoodCandidate>());
  async function search(page: number, next = applied) {
    const token = ++ticket.current; setPending(true); setError('');
    try {
      const result = await searchCategoryDisplayGoodsAction(next.query, page, next.categoryId || null, onlyPublished);
      if (token !== ticket.current) return;
      if ('error' in result) setError(result.error);
      else { setData(result.data); setApplied(next); result.data.rows.forEach(row => known.current.set(row.id, row)); }
    } catch { if (token === ticket.current) setError('상품을 불러오지 못했습니다. 선택은 유지됩니다.'); }
    finally { if (token === ticket.current) setPending(false); }
  }
  useEffect(() => {
    const token = ++ticket.current;
    void searchCategoryDisplayGoodsAction('', 1, null, onlyPublished).then(result => {
      if (token !== ticket.current) return;
      if ('error' in result) setError(result.error);
      else { setData(result.data); result.data.rows.forEach(row => known.current.set(row.id, row)); }
    }).catch(() => { if (token === ticket.current) setError('상품을 불러오지 못했습니다. 선택은 유지됩니다.'); })
      .finally(() => { if (token === ticket.current) setPending(false); });
    return () => { ticket.current += 1; };
  }, [onlyPublished]);
  return <CustomerServiceDialog title="전시 상품 선택" onClose={onClose} wide>
    <div className="flex min-w-0 flex-col gap-3">
      <form className="grid items-end gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={event => { event.preventDefault(); void search(1, { query, categoryId }); }}>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">상품명 / 상품코드<Input value={query} maxLength={100} onChange={event => setQuery(event.target.value)} autoFocus /></label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">상품 카테고리<NativeSelect className="w-full" value={categoryId} onChange={event => setCategoryId(event.target.value)}><option value="">전체</option>{data?.categories.map(category => <option key={category.id} value={category.id}>{category.path}</option>)}</NativeSelect></label>
        <Button type="submit" disabled={pending} variant="soft">검색</Button>
      </form>
      <GoodUrlAddField disabled={pending} onAdd={async id => {
        if (picked.includes(id)) return { ok: false, message: GOOD_URL_ERRORS.exists };
        if (picked.length >= limit) return { ok: false, message: `최대 ${limit.toLocaleString()}개까지 선택할 수 있습니다.` };
        const row = await findGoodById(id, async page => {
          const result = await searchCategoryDisplayGoodsAction(id, page, null, onlyPublished);
          if ('error' in result) throw new Error(result.error);
          return result.data;
        });
        if (!row) return { ok: false, message: GOOD_URL_ERRORS.notFound };
        known.current.set(row.id, row);
        setPicked(current => current.includes(row.id) ? current : [...current, row.id]);
        return { ok: true, message: `'${row.name}' 상품을 선택했습니다. 선택 완료를 눌러 반영해주세요.` };
      }} />
      <p className="text-sm tabular-nums">조회 {data?.total.toLocaleString() ?? '—'}개 · 선택 {picked.length.toLocaleString()} / {limit.toLocaleString()}개</p>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="overflow-hidden rounded-lg border [&>[data-slot=table-container]]:max-h-[400px]"><Table className="min-w-[520px] text-xs"><caption className="sr-only">전시할 상품 선택</caption><TableHeader className="sticky top-0 z-10 bg-muted"><TableRow className="hover:bg-transparent"><TableHead>선택</TableHead><TableHead>상품명 / 상품코드</TableHead><TableHead className="text-right">판매가</TableHead><TableHead>노출 상태</TableHead></TableRow></TableHeader>
        <TableBody>{data?.rows.map(row => <TableRow data-state={picked.includes(row.id) ? 'selected' : undefined} key={row.id}><TableCell><input type="checkbox" aria-label={`${row.name} 선택`} checked={picked.includes(row.id)} disabled={pending || !picked.includes(row.id) && picked.length >= limit}
          onChange={() => setPicked(current => current.includes(row.id) ? current.filter(id => id !== row.id) : [...current, row.id])} /></TableCell><TableCell className="whitespace-normal"><strong className="block font-medium [overflow-wrap:anywhere]">{row.name}</strong><small className="block text-[11px] text-muted-foreground">{row.code}</small></TableCell><TableCell className="text-right tabular-nums">{krw(row.price)}</TableCell><TableCell><AdminStatusBadge tone={!row.published ? statusTone('display', 'inactive') : row.soldOut ? statusTone('stock', 'soldout') : statusTone('display', 'active')}>{row.published ? row.soldOut ? '품절' : '노출 중' : '비노출'}</AdminStatusBadge></TableCell></TableRow>)}</TableBody></Table></div>
      {data && !data.rows.length ? <p className="py-6 text-center text-sm text-muted-foreground">조회된 상품이 없습니다.</p> : null}
      <ConsolePagination label="상품 선택 페이지" page={data?.page ?? 1} pageSize={20} total={data?.total ?? 0} unit="개" disabled={pending || !data} onPageChange={page => { if (data) void search(page); }} />
      <footer className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button type="button" onClick={onClose} variant="outline">취소</Button><Button type="button" disabled={pending} onClick={() => onApply(picked, [...known.current.values()])}>선택 완료</Button></footer>
    </div>
  </CustomerServiceDialog>;
}
