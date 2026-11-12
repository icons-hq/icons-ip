'use client';
import { useState, useTransition } from 'react';
import { searchReviewEventTargetsAction } from '@/app/admin/review-event-actions';
import type { ReviewEventTarget } from '@/lib/review-events';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';

const LIST_CLASS = 'flex flex-col divide-y rounded-lg border bg-background';
const ROW_CLASS = 'flex items-center justify-between gap-3 px-3 py-2 text-sm';

export function ReviewEventTargetPicker({ type, ids, initialLabels, onChange }: { type: 'goods' | 'categories'; ids: string[]; initialLabels: ReviewEventTarget[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState(''), [labels, setLabels] = useState(initialLabels), [data, setData] = useState<{ total: number; page: number; rows: ReviewEventTarget[] } | null>(null), [error, setError] = useState(''), [pending, start] = useTransition();
  function search(page = 1) { start(async () => { const result = await searchReviewEventTargetsAction(type, query, page); if (result.error) { setError(result.error); return; } if (result.data) { setData(result.data); setLabels(current => [...current, ...result.data.rows.filter(row => !current.some(item => item.id === row.id))]); setError(''); } }); }
  return <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-3" data-review-event-targets=""><div className="flex flex-wrap items-end gap-2"><label className="flex min-w-[min(100%,14rem)] flex-1 flex-col gap-1.5 text-sm font-medium">{type === 'goods' ? '상품명·판매자상품코드' : '카테고리명'} 검색<Input value={query} maxLength={100} onChange={event => setQuery(event.target.value)} /></label><Button disabled={pending} onClick={() => search()} type="button" variant="soft">대상 찾기</Button></div><p className="text-xs text-muted-foreground tabular-nums">선택 {ids.length} / 500개{type === 'categories' ? ' · 하위 카테고리와 추가 카테고리 배정 상품을 포함합니다.' : ''}</p>
    {ids.length ? <ul className={LIST_CLASS}>{ids.map(id => { const label = labels.find(item => item.id === id); return <li className={ROW_CLASS} key={id}><span className="min-w-0 wrap-anywhere">{label?.label ?? id}{label?.code ? <small className="mt-0.5 block text-xs text-muted-foreground">판매자상품코드 {label.code}</small> : null}</span><Button aria-label={`${label?.label ?? id} 제외`} onClick={() => onChange(ids.filter(item => item !== id))} size="xs" type="button" variant="ghost">제외</Button></li>; })}</ul> : null}
    {error ? <p className="bg-transparent text-sm text-destructive" role="alert">{error}</p> : null}{data ? <><p className="text-xs text-muted-foreground" role="status">검색 결과 {data.total}개 · {data.page}페이지</p><ul className={`${LIST_CLASS} max-h-100 overflow-y-auto`}>{data.rows.map(row => <li className={ROW_CLASS} key={row.id}><span className="min-w-0 wrap-anywhere">{row.label}{row.code ? <small className="mt-0.5 block text-xs text-muted-foreground">판매자상품코드 {row.code}</small> : null}</span><Button disabled={ids.includes(row.id) || ids.length >= 500} onClick={() => onChange([...ids, row.id])} size="xs" type="button" variant={ids.includes(row.id) ? 'secondary' : 'outline'}>{ids.includes(row.id) ? '선택됨' : '선택'}</Button></li>)}</ul><ConsolePagination label="대상 검색 결과 페이지" page={data.page} pageSize={20} total={data.total} unit="개" disabled={pending} onPageChange={search} /></> : null}
  </div>;
}
