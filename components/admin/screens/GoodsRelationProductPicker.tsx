'use client';
import { useEffect, useState } from 'react';
import { findGoodsForRelationAction } from '@/app/admin/goods-relation-actions';
import type { GoodsRelationCandidates, GoodsRelationGood } from '@/lib/admin/goods-relations';
import { CustomerServiceDialog } from './CustomerServiceDialog';

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
    <div className="admin-relation-picker">
      <div className="admin-relation-picker__search"><label htmlFor="relation-good-query">상품명·상품코드·상품번호</label><input id="relation-good-query" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(1); } }} /><button type="button" className="btn btn-sm" disabled={pending} onClick={() => { void search(1); }}>검색</button></div>
      <p>선택 {selected.length}개 / 최대 {limit}개 · 조회 {data?.total.toLocaleString('ko-KR') ?? '—'}개</p>
      <p className="muted">초안·판매 제한 상품도 미리 편성할 수 있습니다. 실제 공개 조건에 맞는 상품만 상세에 표시됩니다.</p>
      {error ? <p role="alert">{error}</p> : null}{pending ? <p role="status">상품을 불러오는 중입니다.</p> : null}
      <div className="admin-relation-table"><table><caption>연관상품 검색 결과</caption><thead><tr><th>선택</th><th>상품명</th><th>상품코드</th><th>공개 상태</th></tr></thead><tbody>{data?.rows.map(good => <tr key={good.id}>
        <td><input type="checkbox" checked={selected.some(item => item.id === good.id)} aria-label={`${good.name} 선택`} disabled={pending} onChange={() => toggle(good)} /></td>
        <td>{good.name}<small>{good.id}</small></td><td>{good.code}</td><td>{good.public ? '공개' : '비노출'}</td>
      </tr>)}</tbody></table>{!pending && data?.total === 0 ? <p>조건에 맞는 상품이 없습니다.</p> : null}</div>
      <div className="admin-relation-picker__pages"><button type="button" disabled={pending || !data || data.page <= 1} onClick={() => { void search((data?.page ?? 1) - 1); }}>이전</button><span>{data?.page ?? 1} / {data ? Math.max(1, Math.ceil(data.total / 20)) : 1}</span><button type="button" disabled={pending || !data || data.page * 20 >= data.total} onClick={() => { void search((data?.page ?? 1) + 1); }}>다음</button></div>
      <div className="admin-relation-picker__actions"><button type="button" className="btn" disabled={pending || selected.length < 2 || selected.length > limit} onClick={() => onApply(selected)}>선택 상품 적용</button><button type="button" className="btn btn-ghost" onClick={onClose}>취소</button></div>
    </div>
  </CustomerServiceDialog>;
}
