'use client';
import { useEffect, useState } from 'react';
import { findGoodsForAnnouncementAction } from '@/app/admin/goods-announcement-actions';
import { GOODS_ANNOUNCEMENT_GOOD_LIMIT, type GoodsAnnouncementCandidates, type GoodsAnnouncementGood } from '@/lib/admin/goods-announcements';
import { CustomerServiceDialog } from './CustomerServiceDialog';

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
  const lastPage = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  return <CustomerServiceDialog title="상품찾기" onClose={onClose}>
    <div className="admin-announcement-picker">
      <div className="admin-announcement-picker__search"><label htmlFor="announcement-good-query">상품명·상품코드·상품번호</label>
        <input id="announcement-good-query" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(1); } }} />
        <button className="btn btn-sm" disabled={pending} onClick={() => { void search(1); }} type="button">검색</button>
      </div>
      <p>선택 {selected.length.toLocaleString('ko-KR')}개 / 최대 {GOODS_ANNOUNCEMENT_GOOD_LIMIT}개 · 조회 {result?.total.toLocaleString('ko-KR') ?? '—'}개</p>
      {error ? <p role="alert">{error}</p> : null}
      {pending ? <p role="status">상품을 불러오는 중입니다.</p> : null}
      <div className="admin-announcement-picker__table"><table><caption>공지 연결 상품 검색 결과</caption><thead><tr><th>선택</th><th>상품명</th><th>상품코드</th><th>상품번호</th></tr></thead>
        <tbody>{result?.rows.map(good => <tr key={good.id}><td><input type="checkbox" aria-label={`${good.name} 선택`} checked={selected.some(item => item.id === good.id)} onChange={() => toggle(good)} disabled={pending} /></td><td>{good.name}</td><td>{good.code}</td><td>{good.id}</td></tr>)}</tbody>
      </table>{!pending && result?.total === 0 ? <p>조건에 맞는 상품이 없습니다. 상품명·코드 또는 검색어를 확인해주세요.</p> : null}</div>
      <div className="admin-announcement-picker__pages"><button className="btn btn-sm btn-ghost" disabled={pending || !result || result.page <= 1} onClick={() => { void search((result?.page ?? 1) - 1); }} type="button">이전</button><span>{result?.page ?? 1} / {lastPage}</span><button className="btn btn-sm btn-ghost" disabled={pending || !result || result.page >= lastPage} onClick={() => { void search((result?.page ?? 1) + 1); }} type="button">다음</button></div>
      <div className="admin-announcement-picker__actions"><button className="btn" disabled={pending || !selected.length} onClick={() => onApply(selected)} type="button">상품등록</button><button className="btn btn-ghost" onClick={onClose} type="button">취소</button></div>
    </div>
  </CustomerServiceDialog>;
}
