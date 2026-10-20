'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { deleteShoppingStoriesAction } from '@/app/admin/shopping-story-actions';
import { ADMIN_SHOPPING_STORIES_PATH, adminShoppingStoriesHref, SHOPPING_STORY_SORTS, SHOPPING_STORY_STATE_LABELS, storyDatePreset, type AdminShoppingStoryList } from '@/lib/admin/shopping-stories';
import { shoppingStoryHref } from '@/lib/shopping-stories';
import { formatOrderDateTime } from '@/lib/orders';
import { MarketingLinkIssuer } from '../marketing/MarketingLinkIssuer';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { AdminPageHeader } from '../console/AdminKit';

export function ShoppingStoriesAdminScreen({ data }: { data: AdminShoppingStoryList }) {
  const router = useRouter(); const { rows, total, filters } = data;
  const [selected, setSelected] = useState<string[]>([]), [error, setError] = useState(''), [pending, startTransition] = useTransition();
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [retry, setRetry] = useState<{ id: string; entries: { id: string; revision: number }[] } | null>(null);
  const deleting = useRef(false);
  function remove(ids: string[]) {
    if (deleting.current) return;
    const request = retry ?? { id: crypto.randomUUID(), entries: rows.filter(row => ids.includes(row.id)).map(row => ({ id: row.id, revision: row.revision })) };
    deleting.current = true;
    startTransition(async () => {
      try {
        const result = await deleteShoppingStoriesAction(request.id, request.entries);
        if (!result.ok) { setRetry(result.retrySameOperation ? request : null); setError(result.error ?? '삭제하지 못했습니다.'); return; }
        setRetry(null); setConfirmIds(null); setSelected([]); setError(''); router.refresh();
      } catch {
        setRetry(request);
        setError('삭제 결과를 확인하지 못했습니다. 같은 선택으로 다시 확인해주세요.');
      } finally {
        deleting.current = false;
      }
    });
  }
  const pages = Math.max(1, Math.ceil(total / filters.pageSize));
  return <section className="wc-admin-kit wc-admin-kit__screen admin-shopping-stories">
    <AdminPageHeader title="쇼핑스토리" actions={<Link className="wc-admin-kit__button wc-admin-kit__button--primary" href={`${ADMIN_SHOPPING_STORIES_PATH}/new`}>쇼핑스토리 등록</Link>} />
    <form className="admin-story-filters" action={ADMIN_SHOPPING_STORIES_PATH}>
      <label>제목 검색<input name="query" defaultValue={filters.query} placeholder="스토리 제목" maxLength={100} /></label>
      <label>전시상태<select name="state" defaultValue={filters.state}><option value="all">전체</option>{Object.entries(SHOPPING_STORY_STATE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>등록 시작일<input type="date" name="from" defaultValue={filters.from} /></label><label>등록 종료일<input type="date" name="to" defaultValue={filters.to} /></label>
      <label>정렬<select name="sort" defaultValue={filters.sort}>{Object.entries(SHOPPING_STORY_SORTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>목록 수<select name="pageSize" defaultValue={filters.pageSize}>{[20, 50, 100].map(size => <option key={size} value={size}>{size}개씩</option>)}</select></label>
      <div className="admin-story-actions"><button type="submit" className="btn btn-sm btn-primary">검색</button><Link className="btn btn-sm btn-ghost" href={ADMIN_SHOPPING_STORIES_PATH}>초기화</Link></div>
      <div className="admin-story-presets"><span>등록기간</span>{[1, 3, 6].map(months => <Link key={months} href={adminShoppingStoriesHref(filters, { ...storyDatePreset(months, new Date(data.checkedAt)), page: 1 })}>{months}개월</Link>)}<Link href={adminShoppingStoriesHref(filters, { from: '', to: '', page: 1 })}>전체</Link></div>
    </form>
    <div className="admin-story-list-heading"><h2>쇼핑스토리 목록 <small>총 {total.toLocaleString('ko-KR')}개</small></h2><span>공개 순서는 등록일 최신순입니다.</span></div>
    <div className="admin-story-actions"><MarketingLinkIssuer source="story" targetIds={selected} disabled={pending || !!retry} /><button type="button" disabled={pending || !!retry || !selected.length} onClick={() => setConfirmIds(selected)}>선택삭제 {selected.length ? `(${selected.length})` : ''}</button></div>
    {error ? <p role="alert">{error}</p> : null}
    <div className="admin-story-table-scroll"><table><caption className="wc-sr-only">쇼핑스토리 목록</caption><thead><tr><th><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={!!rows.length && rows.every(row => selected.includes(row.id))} disabled={pending || !!retry} onChange={event => setSelected(event.target.checked ? rows.map(row => row.id) : [])} /></th><th>수정</th><th>번호</th><th>전시상태</th><th>제목</th><th>전시 시작일</th><th>전시 종료일</th><th>최종수정일</th><th>등록일</th><th>삭제</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}><td><input aria-label={`${row.title} 선택`} type="checkbox" disabled={pending || !!retry} checked={selected.includes(row.id)} onChange={event => setSelected(items => event.target.checked ? [...items, row.id] : items.filter(id => id !== row.id))} /></td>
        <td><Link href={`${ADMIN_SHOPPING_STORIES_PATH}/${row.id}`}>수정</Link></td><td>{row.reference}</td><td><span className="admin-story-state" data-state={row.state}>{SHOPPING_STORY_STATE_LABELS[row.state]}</span></td><td><Link href={`${ADMIN_SHOPPING_STORIES_PATH}/${row.id}`}>{row.title}</Link>{row.state === 'active' ? <Link className="admin-story-public-link" href={shoppingStoryHref(row.id)} target="_blank" rel="noopener noreferrer">공개 보기 ↗</Link> : null}<small>{row.sectionCount}개 섹션 · 상품 {row.goodCount}개</small></td>
        <td>{row.startsAt ? formatOrderDateTime(row.startsAt) : '즉시'}</td><td>{row.endsAt ? formatOrderDateTime(row.endsAt) : '무기한'}</td><td>{formatOrderDateTime(row.updatedAt)}</td><td>{formatOrderDateTime(row.createdAt)}</td><td><button disabled={pending || !!retry} type="button" onClick={() => setConfirmIds([row.id])}>삭제</button></td></tr>)}{!rows.length ? <tr><td colSpan={10}>조회된 쇼핑스토리가 없습니다.</td></tr> : null}</tbody></table></div>
    <nav className="admin-story-pagination" aria-label="스토리 목록 페이지">{filters.page > 1 ? <Link href={adminShoppingStoriesHref(filters, { page: filters.page - 1 })}>이전</Link> : null}<span>{filters.page} / {pages}</span>{filters.page < pages ? <Link href={adminShoppingStoriesHref(filters, { page: filters.page + 1 })}>다음</Link> : null}</nav>
    {confirmIds ? <CustomerServiceDialog title="쇼핑스토리 삭제" onClose={() => { if (!pending && !retry) setConfirmIds(null); }} busy={pending || !!retry}>
      <p>선택한 스토리 {confirmIds.length}개를 삭제할까요? 공개 페이지와 운영 목록에서 내려가며 복원할 수 없습니다.</p>
      <ul>{rows.filter(row => confirmIds.includes(row.id)).map(row => <li key={row.id}>{row.title}</li>)}</ul>
      {error ? <p role="alert">{error}</p> : null}
      <div className="admin-story-actions"><button type="button" disabled={pending || !!retry} onClick={() => setConfirmIds(null)}>취소</button><button type="button" disabled={pending} onClick={() => remove(confirmIds)}>{pending ? '삭제 중…' : retry ? '같은 요청으로 삭제 결과 확인' : `스토리 ${confirmIds.length}개 삭제`}</button></div>
    </CustomerServiceDialog> : null}
    <p className="admin-story-help">기간은 한국 시각이며 시작 시각부터 종료 시각 직전까지 공개됩니다. 기간을 비우면 즉시·무기한 전시됩니다. 삭제하면 운영 목록과 공개 화면에서 내려가며, 복원 기능은 제공하지 않습니다.</p>
  </section>;
}
