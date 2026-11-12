'use client';
import { useEffect, useState } from 'react';
import { findGoodsForAnnouncementAction } from '@/app/admin/goods-announcement-actions';
import { GOODS_ANNOUNCEMENT_GOOD_LIMIT, type GoodsAnnouncementCandidates, type GoodsAnnouncementGood } from '@/lib/admin/goods-announcements';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { ConsolePagination } from '../console/ConsolePagination';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '../kit/ui/table';

export function GoodsAnnouncementProductPicker({ value, onApply, onClose }: {
  value: GoodsAnnouncementGood[]; onApply: (goods: GoodsAnnouncementGood[]) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState(value);
  const [result, setResult] = useState<GoodsAnnouncementCandidates | null>(null);
  const [pending, setPending] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    findGoodsForAnnouncementAction('', 1).then(response => {
      if (!alive) return; if ('data' in response) setResult(response.data); else setError(response.error);
    }).catch(() => { if (alive) setError('상품을 불러오지 못했습니다. 다시 검색해주세요.'); })
      .finally(() => { if (alive) setPending(false); });
    return () => { alive = false; };
  }, []);
  async function search(page: number) {
    if (pending) return; setPending(true); setError('');
    try { const response = await findGoodsForAnnouncementAction(query, page); if ('data' in response) setResult(response.data); else setError(response.error); }
    catch { setError('상품을 불러오지 못했습니다. 다시 검색해주세요.'); }
    finally { setPending(false); }
  }
  function toggle(good: GoodsAnnouncementGood) {
    if (selected.some(item => item.id === good.id)) setSelected(items => items.filter(item => item.id !== good.id));
    else if (selected.length < GOODS_ANNOUNCEMENT_GOOD_LIMIT) setSelected(items => [...items, good]);
    else setError(`상품은 최대 ${GOODS_ANNOUNCEMENT_GOOD_LIMIT}개까지 선택할 수 있습니다.`);
  }
  return <CustomerServiceDialog title="상품찾기" onClose={onClose}>
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2"><label className="text-sm font-medium" htmlFor="announcement-good-query">상품명·판매자상품코드·상품 URL</label>
        <div className="flex gap-2"><Input className="min-w-0 flex-1" id="announcement-good-query" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(1); } }} />
          <Button disabled={pending} onClick={() => { void search(1); }} type="button" variant="soft">검색</Button></div>
      </div>
      <p className="text-sm tabular-nums">선택 {selected.length.toLocaleString('ko-KR')}개 / 최대 {GOODS_ANNOUNCEMENT_GOOD_LIMIT}개 · 조회 {result?.total.toLocaleString('ko-KR') ?? '—'}개</p>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {pending ? <p className="text-sm text-muted-foreground" role="status">상품을 불러오는 중입니다.</p> : null}
      <div className="relative max-h-[420px] min-w-0 overflow-auto rounded-lg border bg-card [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-muted"><table className="w-full caption-top text-sm" data-slot="table"><caption className="px-2 py-2 text-left text-sm text-muted-foreground">공지 연결 상품 검색 결과</caption><TableHeader><TableRow><TableHead className="w-12 min-w-12">선택</TableHead><TableHead>상품명</TableHead><TableHead>판매자상품코드</TableHead><TableHead>상품 URL</TableHead></TableRow></TableHeader>
        <TableBody>{result?.rows.map(good => <TableRow key={good.id} data-state={selected.some(item => item.id === good.id) ? 'selected' : undefined}><TableCell className="relative w-12 min-w-12 p-0"><label className="absolute inset-0 flex cursor-pointer items-center justify-center"><input type="checkbox" aria-label={`${good.name} 선택`} checked={selected.some(item => item.id === good.id)} onChange={() => toggle(good)} disabled={pending} /></label></TableCell><TableCell className="whitespace-normal">{good.name}</TableCell><TableCell>{good.code}</TableCell><TableCell className="wrap-anywhere">{good.id}</TableCell></TableRow>)}</TableBody>
      </table>{!pending && result?.total === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">조건에 맞는 상품이 없습니다. 상품명·코드 또는 검색어를 확인해주세요.</p> : null}</div>
      <ConsolePagination label="상품 검색 결과 페이지" page={result?.page ?? 1} pageSize={result?.pageSize ?? 20} total={result?.total ?? 0} unit="개" disabled={pending || !result} onPageChange={page => { void search(page); }} />
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button variant="outline" onClick={onClose} type="button">취소</Button><Button disabled={pending || !selected.length} onClick={() => onApply(selected)} type="button">상품등록</Button></div>
    </div>
  </CustomerServiceDialog>;
}
