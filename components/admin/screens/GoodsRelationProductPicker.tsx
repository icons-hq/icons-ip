'use client';
import { useEffect, useState } from 'react';
import { findGoodsForRelationAction } from '@/app/admin/goods-relation-actions';
import type { GoodsRelationCandidates, GoodsRelationGood } from '@/lib/admin/goods-relations';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { findGoodById, GOOD_URL_ERRORS } from '@/lib/admin/good-url';
import { GoodUrlAddField } from '@/components/admin/GoodUrlAddField';
import { AdminStatusBadge } from '../console/AdminKit';
import { ConsolePagination } from '../console/ConsolePagination';
import { statusTone } from '@/lib/admin/status-tone';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '../kit/ui/table';

export function GoodsRelationProductPicker({ value, limit, onApply, onClose }: { value: GoodsRelationGood[]; limit: number; onApply: (goods: GoodsRelationGood[]) => void; onClose: () => void }) {
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState(value);
  const [data, setData] = useState<GoodsRelationCandidates | null>(null); const [pending, setPending] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    findGoodsForRelationAction('', 1).then(result => { if (alive) { if ('data' in result) setData(result.data); else setError(result.error); } })
      .catch(() => { if (alive) setError('상품을 불러오지 못했습니다. 다시 검색해주세요.'); }).finally(() => { if (alive) setPending(false); });
    return () => { alive = false; };
  }, []);
  async function search(page: number) {
    if (pending) return; setPending(true); setError('');
    try { const result = await findGoodsForRelationAction(query, page); if ('data' in result) setData(result.data); else setError(result.error); }
    catch { setError('상품을 불러오지 못했습니다. 다시 검색해주세요.'); }
    finally { setPending(false); }
  }
  function toggle(good: GoodsRelationGood) {
    if (selected.some(item => item.id === good.id)) setSelected(items => items.filter(item => item.id !== good.id));
    else if (selected.length < limit) setSelected(items => [...items, good]);
    else setError(`대표 상품을 포함해 최대 ${limit}개까지 선택할 수 있습니다.`);
  }
  return <CustomerServiceDialog title="연관상품 찾기" onClose={onClose} wide>
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2"><label className="text-sm font-medium" htmlFor="relation-good-query">상품명·판매자상품코드·상품 URL</label><div className="flex gap-2"><Input className="min-w-0 flex-1" id="relation-good-query" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(1); } }} /><Button type="button" disabled={pending} onClick={() => { void search(1); }} variant="soft">검색</Button></div></div>
      <GoodUrlAddField disabled={pending} onAdd={async id => {
        if (selected.some(item => item.id === id)) return { ok: false, message: GOOD_URL_ERRORS.exists };
        if (selected.length >= limit) return { ok: false, message: `대표 상품을 포함해 최대 ${limit}개까지 선택할 수 있습니다.` };
        const good = await findGoodById(id, async page => {
          const result = await findGoodsForRelationAction(id, page);
          if (!('data' in result)) throw new Error(result.error);
          return result.data;
        });
        if (!good) return { ok: false, message: GOOD_URL_ERRORS.notFound };
        setSelected(items => items.some(item => item.id === good.id) ? items : [...items, good]);
        return { ok: true, message: `'${good.name}' 상품을 선택했습니다. 선택 상품 적용을 눌러 반영해주세요.` };
      }} />
      <p className="text-sm tabular-nums">선택 {selected.length}개 / 최대 {limit}개 · 조회 {data?.total.toLocaleString('ko-KR') ?? '—'}개</p>
      <p className="text-sm text-muted-foreground">초안·판매 제한 상품도 미리 편성할 수 있습니다. 실제 공개 조건에 맞는 상품만 상세에 표시됩니다.</p>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}{pending ? <p className="text-sm text-muted-foreground" role="status">상품을 불러오는 중입니다.</p> : null}
      <div className="relative max-h-[510px] min-w-0 overflow-auto rounded-lg border bg-card [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-muted"><table className="w-full min-w-[560px] caption-top text-sm" data-slot="table"><caption className="px-2 py-2 text-left text-sm text-muted-foreground">연관상품 검색 결과</caption><TableHeader><TableRow><TableHead className="w-12 min-w-12">선택</TableHead><TableHead>상품명</TableHead><TableHead>판매자상품코드</TableHead><TableHead>공개 상태</TableHead></TableRow></TableHeader><TableBody>{data?.rows.map(good => <TableRow key={good.id} data-state={selected.some(item => item.id === good.id) ? 'selected' : undefined}>
        <TableCell className="relative w-12 min-w-12 p-0"><label className="absolute inset-0 flex cursor-pointer items-center justify-center"><input type="checkbox" checked={selected.some(item => item.id === good.id)} aria-label={`${good.name} 선택`} disabled={pending} onChange={() => toggle(good)} /></label></TableCell>
        <TableCell className="whitespace-normal">{good.name}<small className="block text-xs text-muted-foreground wrap-anywhere">{good.id}</small></TableCell><TableCell>{good.code}</TableCell><TableCell><AdminStatusBadge tone={statusTone('display', good.public ? 'active' : 'inactive')}>{good.public ? '공개' : '비노출'}</AdminStatusBadge></TableCell>
      </TableRow>)}</TableBody></table>{!pending && data?.total === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">조건에 맞는 상품이 없습니다.</p> : null}</div>
      <ConsolePagination label="연관상품 검색 결과 페이지" page={data?.page ?? 1} pageSize={20} total={data?.total ?? 0} unit="개" disabled={pending || !data} onPageChange={page => { void search(page); }} />
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button variant="outline" type="button" onClick={onClose}>취소</Button><Button type="button" disabled={pending || selected.length < 2 || selected.length > limit} onClick={() => onApply(selected)}>선택 상품 적용</Button></div>
    </div>
  </CustomerServiceDialog>;
}
