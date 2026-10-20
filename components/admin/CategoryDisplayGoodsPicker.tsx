'use client';
import { useEffect, useRef, useState } from 'react';
import { searchCategoryDisplayGoodsAction } from '@/app/admin/category-display-actions';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import type { StoryGoodCandidates, StoryGoodCandidate } from '@/lib/admin/shopping-story-picker';
import { krw } from '@/lib/format';

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
    <div className="admin-category-display__picker">
      <form onSubmit={event => { event.preventDefault(); void search(1, { query, categoryId }); }}>
        <label>상품명 / 상품코드<input value={query} maxLength={100} onChange={event => setQuery(event.target.value)} autoFocus /></label>
        <label>상품 카테고리<select value={categoryId} onChange={event => setCategoryId(event.target.value)}><option value="">전체</option>{data?.categories.map(category => <option key={category.id} value={category.id}>{category.path}</option>)}</select></label>
        <button type="submit" disabled={pending}>검색</button>
      </form>
      <p>조회 {data?.total.toLocaleString() ?? '—'}개 · 선택 {picked.length.toLocaleString()} / {limit.toLocaleString()}개</p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="admin-category-display__table"><table><caption className="sr-only">전시할 상품 선택</caption><thead><tr><th>선택</th><th>상품명 / 상품코드</th><th>판매가</th><th>노출 상태</th></tr></thead>
        <tbody>{data?.rows.map(row => <tr key={row.id}><td><input type="checkbox" aria-label={`${row.name} 선택`} checked={picked.includes(row.id)} disabled={pending || !picked.includes(row.id) && picked.length >= limit}
          onChange={() => setPicked(current => current.includes(row.id) ? current.filter(id => id !== row.id) : [...current, row.id])} /></td><td><strong>{row.name}</strong><small>{row.code}</small></td><td>{krw(row.price)}</td><td>{row.published ? row.soldOut ? '품절' : '노출 중' : '비노출'}</td></tr>)}</tbody></table></div>
      {data && !data.rows.length ? <p>조회된 상품이 없습니다.</p> : null}
      <nav aria-label="상품 선택 페이지"><button type="button" disabled={pending || !data || data.page <= 1} onClick={() => { if (data) void search(data.page - 1); }}>이전</button><span>{data?.page ?? 1} / {Math.max(1, Math.ceil((data?.total ?? 0) / 20))}</span><button type="button" disabled={pending || !data || data.page * 20 >= data.total} onClick={() => { if (data) void search(data.page + 1); }}>다음</button></nav>
      <footer><button type="button" onClick={onClose}>취소</button><button type="button" disabled={pending} onClick={() => onApply(picked, [...known.current.values()])}>선택 완료</button></footer>
    </div>
  </CustomerServiceDialog>;
}
