'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { deleteShoppingStoriesAction } from '@/app/admin/shopping-story-actions';
import { ADMIN_SHOPPING_STORIES_PATH, adminShoppingStoriesHref, SHOPPING_STORY_SORTS, SHOPPING_STORY_STATE_LABELS, storyDatePreset, type AdminShoppingStoryList } from '@/lib/admin/shopping-stories';
import { shoppingStoryHref } from '@/lib/shopping-stories';
import { formatOrderDateTime } from '@/lib/orders';
import { MarketingLinkIssuer } from '../marketing/MarketingLinkIssuer';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { AdminNotice, AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { ConsoleFilterField } from '../console/ConsoleFilterPanel';
import { CONSOLE_TABLE_FRAME_CLASS, ConsoleListCard, ConsoleTableEmptyRow, ConsoleTableHeader } from '../console/ConsoleListCard';
import { ConsolePagination } from '../console/ConsolePagination';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/admin/kit/ui/table';

/* 쇼핑스토리 목록(템플릿 룩, ADR-0028). 조회 조건 카드는 ConsoleFilterPanel과 같은 모양이다 — 등록기간 프리셋(1·3·6개월)과
   검색어 길이 제한을 그대로 두려고 칸을 직접 놓는다. URL 키(query·state·from·to·sort·pageSize)는 그대로다. */
const PRESET = 'inline-flex h-7 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground';

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
  return <section className="flex min-w-0 flex-col gap-4">
    <AdminPageHeader title="쇼핑스토리" actions={<Link className={buttonVariants()} data-slot="button" href={`${ADMIN_SHOPPING_STORIES_PATH}/new`}><Plus aria-hidden="true" />쇼핑스토리 등록</Link>} />
    <form className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" action={ADMIN_SHOPPING_STORIES_PATH}>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <ConsoleFilterField className="min-w-[min(100%,16rem)] flex-1" htmlFor="story-filter-query" label="제목 검색"><Input id="story-filter-query" name="query" defaultValue={filters.query} placeholder="스토리 제목" maxLength={100} /></ConsoleFilterField>
        <ConsoleFilterField htmlFor="story-filter-state" label="전시상태"><NativeSelect className="w-36" id="story-filter-state" name="state" defaultValue={filters.state}><option value="all">전체</option>{Object.entries(SHOPPING_STORY_STATE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></ConsoleFilterField>
        <ConsoleFilterField htmlFor="story-filter-from" label="등록 시작일"><Input className="w-40" id="story-filter-from" type="date" name="from" defaultValue={filters.from} /></ConsoleFilterField>
        <ConsoleFilterField htmlFor="story-filter-to" label="등록 종료일"><Input className="w-40" id="story-filter-to" type="date" name="to" defaultValue={filters.to} /></ConsoleFilterField>
        <ConsoleFilterField htmlFor="story-filter-sort" label="정렬"><NativeSelect className="w-40" id="story-filter-sort" name="sort" defaultValue={filters.sort}>{Object.entries(SHOPPING_STORY_SORTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></ConsoleFilterField>
        <ConsoleFilterField htmlFor="story-filter-size" label="목록 수"><NativeSelect className="w-32" id="story-filter-size" name="pageSize" defaultValue={filters.pageSize}>{[20, 50, 100].map(size => <option key={size} value={size}>{size}개씩</option>)}</NativeSelect></ConsoleFilterField>
        <ConsoleFilterField label="등록기간"><div className="inline-flex flex-wrap rounded-lg bg-muted p-0.5">{[1, 3, 6].map(months => <Link className={PRESET} key={months} href={adminShoppingStoriesHref(filters, { ...storyDatePreset(months, new Date(data.checkedAt)), page: 1 })}>{months}개월</Link>)}<Link className={PRESET} href={adminShoppingStoriesHref(filters, { from: '', to: '', page: 1 })}>전체</Link></div></ConsoleFilterField>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3"><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={ADMIN_SHOPPING_STORIES_PATH}>초기화</Link><Button type="submit" variant="soft">검색</Button></div>
    </form>
    <ConsoleListCard title="쇼핑스토리 목록" total={total} unit="개" actions={<span className="text-xs text-muted-foreground">공개 순서는 등록일 최신순입니다.</span>}>
    <div className="flex flex-wrap items-center gap-2"><MarketingLinkIssuer source="story" targetIds={selected} disabled={pending || !!retry} /><Button type="button" variant="destructive" disabled={pending || !!retry || !selected.length} onClick={() => setConfirmIds(selected)}><Trash2 aria-hidden="true" />선택삭제 {selected.length ? `(${selected.length})` : ''}</Button></div>
    {error ? <AdminNotice role="alert" tone="danger">{error}</AdminNotice> : null}
    <div aria-label="쇼핑스토리 목록 가로 스크롤" className={`${CONSOLE_TABLE_FRAME_CLASS} [&>[data-slot=table-container]]:overflow-visible`} role="region" tabIndex={0}><Table className="min-w-[1130px] text-xs"><caption className="sr-only">쇼핑스토리 목록</caption><ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-10"><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={!!rows.length && rows.every(row => selected.includes(row.id))} disabled={pending || !!retry} onChange={event => setSelected(event.target.checked ? rows.map(row => row.id) : [])} /></TableHead><TableHead>수정</TableHead><TableHead className="text-right">번호</TableHead><TableHead>전시상태</TableHead><TableHead>제목</TableHead><TableHead>전시 시작일</TableHead><TableHead>전시 종료일</TableHead><TableHead>최종수정일</TableHead><TableHead>등록일</TableHead><TableHead>삭제</TableHead></TableRow></ConsoleTableHeader>
      <TableBody>{rows.map(row => <TableRow data-state={selected.includes(row.id) ? 'selected' : undefined} key={row.id}><TableCell><input aria-label={`${row.title} 선택`} type="checkbox" disabled={pending || !!retry} checked={selected.includes(row.id)} onChange={event => setSelected(items => event.target.checked ? [...items, row.id] : items.filter(id => id !== row.id))} /></TableCell>
        <TableCell><Link className="underline-offset-4 hover:underline" href={`${ADMIN_SHOPPING_STORIES_PATH}/${row.id}`}>수정</Link></TableCell><TableCell className="text-right tabular-nums">{row.reference}</TableCell><TableCell><AdminStatusBadge tone={statusTone('story', row.state)}>{SHOPPING_STORY_STATE_LABELS[row.state]}</AdminStatusBadge></TableCell><TableCell className="min-w-[220px] whitespace-normal"><Link className="font-medium underline-offset-4 hover:underline" href={`${ADMIN_SHOPPING_STORIES_PATH}/${row.id}`}>{row.title}</Link>{row.state === 'active' ? <Link className="mt-1 flex w-fit items-center gap-1 text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={shoppingStoryHref(row.id)} target="_blank" rel="noopener noreferrer">공개 보기 <ExternalLink aria-hidden="true" className="size-3" /></Link> : null}<small className="mt-1 block text-[11px] text-muted-foreground">{row.sectionCount}개 섹션 · 상품 {row.goodCount}개</small></TableCell>
        <TableCell className="tabular-nums">{row.startsAt ? formatOrderDateTime(row.startsAt) : '즉시'}</TableCell><TableCell className="tabular-nums">{row.endsAt ? formatOrderDateTime(row.endsAt) : '무기한'}</TableCell><TableCell className="tabular-nums">{formatOrderDateTime(row.updatedAt)}</TableCell><TableCell className="tabular-nums">{formatOrderDateTime(row.createdAt)}</TableCell><TableCell><Button disabled={pending || !!retry} type="button" onClick={() => setConfirmIds([row.id])} size="xs" variant="destructive">삭제</Button></TableCell></TableRow>)}{!rows.length ? <ConsoleTableEmptyRow colSpan={10}>조회된 쇼핑스토리가 없습니다.</ConsoleTableEmptyRow> : null}</TableBody></Table></div>
    <ConsolePagination hrefForPage={page => adminShoppingStoriesHref(filters, { page })} label="스토리 목록 페이지" page={filters.page} pageSize={filters.pageSize} total={total} />
    </ConsoleListCard>
    {confirmIds ? <CustomerServiceDialog title="쇼핑스토리 삭제" onClose={() => { if (!pending && !retry) setConfirmIds(null); }} busy={pending || !!retry}>
      <div className="flex flex-col gap-3">
        <p>선택한 스토리 {confirmIds.length}개를 삭제할까요? 공개 페이지와 운영 목록에서 내려가며 복원할 수 없습니다.</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{rows.filter(row => confirmIds.includes(row.id)).map(row => <li key={row.id}>{row.title}</li>)}</ul>
        {error ? <p className="text-destructive" role="alert">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={pending || !!retry} onClick={() => setConfirmIds(null)}>취소</Button><Button type="button" variant="destructive" disabled={pending} onClick={() => remove(confirmIds)}>{pending ? '삭제 중…' : retry ? '같은 요청으로 삭제 결과 확인' : `스토리 ${confirmIds.length}개 삭제`}</Button></div>
      </div>
    </CustomerServiceDialog> : null}
    <p className="text-xs leading-relaxed text-muted-foreground">기간은 한국 시각이며 시작 시각부터 종료 시각 직전까지 공개됩니다. 기간을 비우면 즉시·무기한 전시됩니다. 삭제하면 운영 목록과 공개 화면에서 내려가며, 복원 기능은 제공하지 않습니다.</p>
  </section>;
}
