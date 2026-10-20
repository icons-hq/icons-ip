'use client';
import { useState, useTransition } from 'react';
import { searchReviewEventTargetsAction } from '@/app/admin/review-event-actions';
import type { ReviewEventTarget } from '@/lib/review-events';

export function ReviewEventTargetPicker({ type, ids, initialLabels, onChange }: { type: 'goods' | 'categories'; ids: string[]; initialLabels: ReviewEventTarget[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState(''), [labels, setLabels] = useState(initialLabels), [data, setData] = useState<{ total: number; page: number; rows: ReviewEventTarget[] } | null>(null), [error, setError] = useState(''), [pending, start] = useTransition();
  function search(page = 1) { start(async () => { const result = await searchReviewEventTargetsAction(type, query, page); if (result.error) { setError(result.error); return; } if (result.data) { setData(result.data); setLabels(current => [...current, ...result.data.rows.filter(row => !current.some(item => item.id === row.id))]); setError(''); } }); }
  return <div className="admin-review-event-targets"><label>{type === 'goods' ? '상품명·상품코드' : '카테고리명'} 검색<input value={query} maxLength={100} onChange={event => setQuery(event.target.value)} /></label><button type="button" disabled={pending} onClick={() => search()}>대상 찾기</button><p>선택 {ids.length} / 500개{type === 'categories' ? ' · 하위 카테고리와 추가 카테고리 배정 상품을 포함합니다.' : ''}</p>
    <ul className="admin-review-event-targets__selected">{ids.map(id => { const label = labels.find(item => item.id === id); return <li key={id}><span>{label?.label ?? id}{label?.code ? <small>상품코드 {label.code}</small> : null}</span><button type="button" aria-label={`${label?.label ?? id} 제외`} onClick={() => onChange(ids.filter(item => item !== id))}>제외</button></li>; })}</ul>
    {error ? <p role="alert">{error}</p> : null}{data ? <><p role="status">검색 결과 {data.total}개 · {data.page}페이지</p><ul className="admin-review-event-targets__results">{data.rows.map(row => <li key={row.id}><span>{row.label}{row.code ? <small>상품코드 {row.code}</small> : null}</span><button type="button" disabled={ids.includes(row.id) || ids.length >= 500} onClick={() => onChange([...ids, row.id])}>{ids.includes(row.id) ? '선택됨' : '선택'}</button></li>)}</ul><div className="admin-review-events__actions"><button type="button" disabled={pending || data.page <= 1} onClick={() => search(data.page - 1)}>이전</button><button type="button" disabled={pending || data.page * 20 >= data.total} onClick={() => search(data.page + 1)}>다음</button></div></> : null}
  </div>;
}
