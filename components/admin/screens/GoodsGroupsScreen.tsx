'use client';
import Link from 'next/link';
import { Fragment, useRef, useState, useTransition } from 'react';
import { Archive, Boxes, ChevronDown, Eye, FilePen } from 'lucide-react';
import { searchGoodsGroupConsoleAction } from '@/app/admin/goods-group-actions';
import { GOODS_GROUPS_PATH, goodsGroupConversionHref, goodsGroupHref, type GoodsGroupPage, type GoodsGroupSnapshot } from '@/lib/admin/goods-groups';
import { formatWon } from '@/lib/admin/goods-price-editor';
import { kstDay } from '@/lib/admin/kst';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { ADMIN_COUNT_CARD_GRID_CLASS, AdminCountCard } from '../console/AdminCountCard';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminSelect } from '../console/AdminSelect';
import { Button, buttonVariants } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '../kit/ui/table';
import { GoodsGroupEditor } from '../GoodsGroupEditor';
import { GoodsBulkToolbar } from '../GoodsBulkToolbar';
import { GoodsGroupsMenuNote } from './GoodsGroupsMenuNote';
import { GroupPager, GroupTable, useGoodsGroupSession } from '../GoodsGroupOperation';
import { DEFAULT_GROUP_FILTERS, GROUP_SEARCH_FIELDS, GROUP_SORTS, GROUP_STATUSES, goodsGroupConsoleHref, type GoodsGroupConsole, type GoodsGroupFilters } from '@/lib/admin/goods-group-console';

/* 셸의 콘솔 전환과 같은 탭 모양(템플릿 룩, ADR-0028). */
const TAB = 'inline-flex h-7 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-primary-soft-foreground aria-[current=page]:shadow-sm';
const CHOICE = 'inline-flex min-h-7 cursor-pointer items-center gap-2 text-sm';
const ROW = 'grid gap-2 border-b py-3 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4';
const ROW_LABEL = 'text-sm font-medium sm:pt-1.5';
const PRESET = 'inline-flex h-7 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50';
const STATUS_ICONS = { all: Boxes, published: Eye, draft: FilePen, archived: Archive } as const;

export function GoodsGroupsScreen({ initialPage, initialGroup, initialQuery = '', initialConsole, initialFilters, categories = [], origins = [], actorId, sessionId }: {
  initialPage: GoodsGroupPage | null; initialGroup: GoodsGroupSnapshot | null; initialQuery?: string; actorId: string; sessionId: string | null;
  initialConsole?: GoodsGroupConsole | null; initialFilters?: GoodsGroupFilters; categories?: { id: string; name: string; depth: number }[]; origins?: { id: string; name: string }[];
}) {
  const session = useGoodsGroupSession(actorId, sessionId), identity = sessionId ? { actorId, sessionId } : null;
  const [page, setPage] = useState(initialPage), [consoleData, setConsoleData] = useState(initialConsole);
  const [filters, setFilters] = useState(initialFilters ?? { ...DEFAULT_GROUP_FILTERS, query: initialQuery });
  const [applied, setApplied] = useState(filters), [error, setError] = useState('');
  const [pending, startTransition] = useTransition(); const sequence = useRef(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string[]>([]);
  /** `keepSelection`: 일괄 변경 확정 뒤 다시 읽을 때 선택을 유지한다(R11). 다시 읽은 페이지에 없거나 보관된 그룹은 뺀다. */
  function load(next: GoodsGroupFilters = { ...filters, page: 1 }, keepSelection = false) {
    if (!identity || !session.current() || pending) return;
    const ticket = ++sequence.current; setError(''); startTransition(async () => {
      try { let result = await searchGoodsGroupConsoleAction(next, identity); if (!session.current() || ticket !== sequence.current) return;
        if ('value' in result && next.page > Math.max(1, Math.ceil(result.value.total / result.value.pageSize))) {
          next = { ...next, page: Math.max(1, Math.ceil(result.value.total / result.value.pageSize)) }; result = await searchGoodsGroupConsoleAction(next, identity);
        }
        if (!session.current() || ticket !== sequence.current) return;
        if ('error' in result) { setError(result.error); if (result.authChanged) session.deny(); } else {
          const kept = new Set(result.value.rows.filter(group => !group.archivedAt).map(group => group.id));
          setPage(result.value); setConsoleData(result.value); setApplied(next); setFilters(next); setExpanded(new Set());
          setSelected(current => keepSelection ? current.filter(id => kept.has(id)) : []);
          window.history.replaceState(null, '', goodsGroupConsoleHref(next));
        }
      } catch { if (session.current()) setError('그룹상품 목록을 불러오지 못했습니다. 현재 목록을 유지합니다.'); }
    });
  }
  function change<K extends keyof GoodsGroupFilters>(key: K, value: GoodsGroupFilters[K]) { setFilters(current => ({ ...current, [key]: value })); }
  function period(days: number | null) {
    if (days === null) { setFilters(current => ({ ...current, from: null, to: null })); return; }
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
    const start = new Date(`${today}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - days);
    setFilters(current => ({ ...current, from: start.toISOString().slice(0, 10), to: today }));
  }
  if (session.blocked) return <p className="text-sm text-destructive" role="alert">로그인 상태가 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.</p>;
  if (initialGroup) return <><AdminPageHeader title={initialGroup.name} description="그룹상품의 판매옵션 구성을 관리합니다." />
    <GoodsGroupEditor key={`${initialGroup.id}:${actorId}:${sessionId}`} initial={initialGroup} newGroupId={initialGroup.id} actorId={actorId} sessionId={sessionId} /></>;
  const selectableRows = page?.rows.filter(group => !group.archivedAt) ?? [];
  /* 접힌 조건이 걸려 있으면 펼쳐 둔다. 입력 중 값이 아니라 적용한 값으로 정해 고르는 동안 접히지 않는다. */
  const advancedApplied = Boolean(applied.from || applied.to || applied.stock !== 'all' || applied.originId || applied.shippingFee !== 'all');
  return <section className="flex min-w-0 flex-col gap-4" aria-busy={pending} data-admin-screen="goods-groups">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><nav className="inline-flex w-fit rounded-lg bg-muted p-0.5" aria-label="상품 목록"><Link className={TAB} href="/admin/catalog/goods">전체 상품 조회/수정</Link><span aria-current="page" className={TAB}>그룹상품 조회/수정</span></nav><GoodsGroupsMenuNote /></div>
    {/* 조회가 화면 상태라 칸이 링크가 아니라 버튼이다 — 눌림·포커스·호버는 버튼이, 모양은 공용 건수 칸이 맡는다. */}
    <div className={ADMIN_COUNT_CARD_GRID_CLASS} data-goods-groups="status">{GROUP_STATUSES.map(status => <button type="button" key={status.value} disabled={pending} aria-pressed={applied.status === status.value} onClick={() => load({ ...applied, status: status.value, page: 1 })}
      className="min-w-0 rounded-xl text-left outline-none hover:[&>span]:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50">
      <AdminCountCard active={applied.status === status.value} count={consoleData?.counts[status.value] ?? null} icon={STATUS_ICONS[status.value]} label={status.label} /></button>)}</div>
    <form className="flex min-w-0 flex-col rounded-xl border bg-card px-4 text-card-foreground" role="search" onSubmit={event => { event.preventDefault(); if (filters.from && filters.to && filters.from > filters.to) { setError('시작일은 종료일보다 늦을 수 없습니다.'); return; } load(); }}>
      <div className={ROW}><label className={ROW_LABEL} htmlFor="group-query">검색어</label><div className="flex min-w-0 flex-col gap-2">
        <fieldset className="flex flex-wrap gap-x-5 gap-y-1"><legend className="sr-only">검색 항목</legend>{GROUP_SEARCH_FIELDS.map(field => <label className={CHOICE} key={field.value}><input type="radio" name="group-field" value={field.value} checked={filters.field === field.value} disabled={pending} onChange={() => change('field', field.value)} />{field.label}</label>)}</fieldset>
        <Input className="sm:max-w-xl" id="group-query" type="search" value={filters.query} maxLength={100} disabled={pending} onChange={event => change('query', event.target.value)} /></div></div>
      <div className={ROW}><label className={ROW_LABEL} htmlFor="group-category">카테고리</label><div><AdminSelect id="group-category" value={filters.categoryId} disabled={pending} onChange={event => change('categoryId', event.target.value)} wrapperClassName="w-full sm:w-52"><option value="">전체 카테고리</option>{categories.map(row => <option key={row.id} value={row.id}>{'　'.repeat(Math.max(0, row.depth - 1))}{row.name}</option>)}</AdminSelect></div></div>
      {/* 상품 조회와 같은 구성: 자주 쓰는 조건만 첫 화면에 두고, 공개 상태(위 건수 칸이 현재 값을 보여 준다)·기간·상세 조건은 접는다. */}
      <div className="relative"><details className="group/advanced" open={advancedApplied}><summary className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} my-2 w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden`} data-slot="button">상세검색 <ChevronDown aria-hidden="true" className="transition-transform group-open/advanced:rotate-180" /></summary><div className="border-t">
        <div className={ROW}><span className={ROW_LABEL} id="group-status-label">공개 상태</span><fieldset className="flex flex-wrap gap-x-5 gap-y-1 sm:pt-1" aria-labelledby="group-status-label">{GROUP_STATUSES.map(status => <label className={CHOICE} key={status.value}><input type="radio" name="group-status" checked={filters.status === status.value} disabled={pending} onChange={() => change('status', status.value)} />{status.label}</label>)}</fieldset></div>
        <div className={ROW}><span className={ROW_LABEL} id="group-period-label">기간</span><div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="group-period-label">
          <AdminSelect aria-label="기간 기준" value={filters.dateField} disabled={pending} onChange={event => change('dateField', event.target.value as GoodsGroupFilters['dateField'])} wrapperClassName="w-40"><option value="created">그룹상품등록일</option><option value="updated">그룹상품수정일</option></AdminSelect>
          <div className="inline-flex flex-wrap rounded-lg bg-muted p-0.5">{[['오늘', 0], ['1주일', 6], ['1개월', 29], ['3개월', 89], ['6개월', 179], ['1년', 364], ['전체', null]].map(([label, days]) => <button className={PRESET} key={label} type="button" disabled={pending} onClick={() => period(days as number | null)}>{label}</button>)}</div>
          <div className="flex min-w-0 items-center gap-1.5"><Input className="w-36" aria-label="시작일" type="date" value={filters.from ?? ''} disabled={pending} onChange={event => change('from', event.target.value || null)} /><span aria-hidden="true" className="text-muted-foreground">~</span><Input className="w-36" aria-label="종료일" type="date" value={filters.to ?? ''} disabled={pending} onChange={event => change('to', event.target.value || null)} /></div>
        </div></div>
        <div className="grid gap-2 py-3 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4"><span className={ROW_LABEL}>상세검색</span><div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:max-w-3xl">
        <AdminSelect aria-label="옵션 재고" value={filters.stock} disabled={pending} onChange={event => change('stock', event.target.value as GoodsGroupFilters['stock'])}><option value="all">재고 전체</option><option value="available">재고 있는 옵션 포함</option><option value="soldout">품절 옵션 포함</option></AdminSelect>
        <AdminSelect aria-label="출고지" value={filters.originId} disabled={pending} onChange={event => change('originId', event.target.value)}><option value="">출고지 전체</option>{origins.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</AdminSelect>
        <AdminSelect aria-label="배송비" value={filters.shippingFee} disabled={pending} onChange={event => change('shippingFee', event.target.value as GoodsGroupFilters['shippingFee'])}><option value="all">배송비 전체</option><option value="free">무료배송 상품 포함</option><option value="paid">배송비 설정 상품 포함</option></AdminSelect>
      </div></div></div></details>
      <div className="absolute top-1.5 right-0 flex gap-2"><Button variant="ghost" type="button" disabled={pending} onClick={() => load({ ...DEFAULT_GROUP_FILTERS })}>초기화</Button><Button type="submit" disabled={pending} variant="soft">{pending ? '조회 중…' : '검색'}</Button></div></div>
    </form>
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}{page ? <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base leading-snug font-medium">그룹목록 <span className="text-sm font-normal text-muted-foreground">(총 <strong className="font-semibold text-foreground tabular-nums">{page.total.toLocaleString('ko-KR')}</strong>개)</span></h3><div className="flex flex-wrap items-center gap-2">
      <AdminSelect aria-label="그룹상품 정렬" disabled={pending} value={applied.sort} onChange={event => load({ ...applied, sort: event.target.value as GoodsGroupFilters['sort'], page: 1 })}>{GROUP_SORTS.map(row => <option key={row.value} value={row.value}>{row.label}</option>)}</AdminSelect>
      <AdminSelect aria-label="그룹상품 목록수" disabled={pending} value={page.pageSize} onChange={event => load({ ...applied, pageSize: Number(event.target.value), page: 1 })}>{[20, 50, 100].map(size => <option key={size} value={size}>{size}개씩</option>)}</AdminSelect></div></div>
      <div className="flex flex-wrap items-center gap-2"><Link className={buttonVariants()} data-slot="button" href={`${GOODS_GROUPS_PATH}/new?mode=assemble`}>기존 상품으로 그룹 구성</Link><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={goodsGroupConversionHref()}>선택형 옵션에서 그룹 전환</Link><p className="text-sm text-muted-foreground">그룹상품명을 눌러 구성·공통정보 수정 또는 그룹 해제를 진행할 수 있습니다.</p></div>
      {identity ? <GoodsBulkToolbar kind="groups" identity={identity} selectedIds={selected} disabled={pending}
        shippingGoodIds={[...new Set(page.rows.filter(group => selected.includes(group.id)).flatMap(group => group.members.map(member => member.goodId)))]}
        onCompleted={() => load(applied, true)}
        selectionActions={selected.length ? <Button size="sm" variant="ghost" type="button" disabled={pending} onClick={() => setSelected([])}>선택 해제</Button> : undefined} /> : null}
      <GroupTable label="그룹상품 목록" className="min-w-[960px]"><TableHeader><TableRow className="bg-muted/50"><TableHead className="relative w-10 min-w-10 p-0">{/* 칸 전체가 클릭 영역이다(ConsoleGrid와 같다). */}<label className="absolute inset-0 flex cursor-pointer items-center justify-center"><input type="checkbox" aria-label="현재 페이지 그룹상품 전체 선택" disabled={pending || !selectableRows.length} checked={selectableRows.length > 0 && selectableRows.every(group => selected.includes(group.id))}
        onChange={event => setSelected(event.target.checked ? selectableRows.map(group => group.id) : [])} /></label></TableHead><TableHead>그룹상품</TableHead><TableHead>옵션명</TableHead><TableHead className="text-right">판매옵션</TableHead><TableHead className="text-right">공개 상품</TableHead><TableHead>상태</TableHead><TableHead>카테고리</TableHead><TableHead>그룹상품등록일</TableHead><TableHead>그룹상품수정일</TableHead></TableRow></TableHeader><TableBody>
      {page.rows.map(group => <Fragment key={group.id}><TableRow data-state={selected.includes(group.id) ? 'selected' : undefined}><TableCell className="relative w-10 min-w-10 p-0"><label className="absolute inset-0 flex cursor-pointer items-center justify-center"><input type="checkbox" aria-label={`${group.name} 선택`} disabled={pending || Boolean(group.archivedAt)} checked={selected.includes(group.id)} onChange={event => setSelected(current => event.target.checked ? [...current, group.id] : current.filter(id => id !== group.id))} /></label></TableCell><TableCell className="whitespace-normal"><Link className="font-medium underline-offset-4 hover:underline" href={goodsGroupHref(group.id)}>{group.name}</Link><small className="block text-xs text-muted-foreground tabular-nums" title={group.id}>{group.id.length > 8 ? `${group.id.slice(0, 8)}…` : group.id}</small>
        {group.members.length ? <div className="mt-1.5"><Button size="xs" variant="outline" type="button" disabled={pending} aria-expanded={expanded.has(group.id)} aria-controls={`group-members-${group.id}`}
          aria-label={`${group.name} 판매옵션 ${expanded.has(group.id) ? '접기' : '펼치기'}`} onClick={() => {
            if (!session.current()) return;
            setExpanded(current => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; });
          }}>{expanded.has(group.id) ? '판매옵션 접기' : '판매옵션 펼치기'}</Button></div> : null}</TableCell><TableCell className="whitespace-normal">{group.optionNames.join(' / ')}</TableCell>
        <TableCell className="text-right tabular-nums">{group.members.length}개</TableCell><TableCell className="text-right tabular-nums">{group.members.filter(member => member.publishedAt && !member.archivedAt).length}개</TableCell><TableCell><AdminStatusBadge tone={statusTone('goodsGroup', group.archivedAt ? 'archived' : 'active')}>{group.archivedAt ? '연결 해제' : '사용 중'}</AdminStatusBadge></TableCell>
        <TableCell className="whitespace-normal">{consoleData?.metadata[group.id]?.category ?? '미지정'}</TableCell>{(['createdAt', 'updatedAt'] as const).map(key => <TableCell className="tabular-nums" key={key}>{consoleData?.metadata[group.id]?.[key] ? kstDay(new Date(consoleData.metadata[group.id][key])).replaceAll('-', '.') : '—'}</TableCell>)}</TableRow>
        {expanded.has(group.id) ? <TableRow className="hover:bg-transparent" id={`group-members-${group.id}`}><TableCell className="bg-muted/30" colSpan={9}><GroupTable label={`${group.name} 개별 상품`} className="min-w-[640px]"><TableHeader><TableRow><TableHead>상품·판매자상품코드</TableHead><TableHead>판매옵션</TableHead><TableHead className="text-right">판매가</TableHead><TableHead className="text-right">재고수량</TableHead><TableHead>공개 상태</TableHead></TableRow></TableHeader><TableBody>
          {group.members.map(member => <TableRow key={member.goodId}><TableCell className="whitespace-normal"><Link className="font-medium underline-offset-4 hover:underline" href={`/admin/catalog/goods?goodId=${encodeURIComponent(member.goodId)}`}>{member.name}</Link><small className="block text-xs text-muted-foreground">{member.code ?? member.goodId}</small></TableCell>
            <TableCell className="whitespace-normal">{member.values.join(' / ')}</TableCell><TableCell className="text-right tabular-nums">{formatWon(member.price)}</TableCell><TableCell className="text-right tabular-nums">{member.stockQty.toLocaleString('ko-KR')}개</TableCell><TableCell><AdminStatusBadge tone={statusTone('publication', member.archivedAt ? 'archived' : member.publishedAt ? 'published' : 'draft')}>{member.archivedAt ? '보관' : member.publishedAt ? '공개' : '미공개'}</AdminStatusBadge></TableCell></TableRow>)}
        </TableBody></GroupTable></TableCell></TableRow> : null}</Fragment>)}
      {/* 하나도 없는 것과 검색에 안 걸린 것은 다른 안내다 — 처음이면 위 주 버튼으로 시작하게 한다. */}
      {!page.rows.length ? <TableRow><TableCell className="h-24 text-center whitespace-normal text-muted-foreground" colSpan={9}>{consoleData?.counts.all === 0 ? '아직 등록한 그룹상품이 없습니다. 위의 기존 상품으로 그룹 구성을 눌러 첫 그룹상품을 만들어주세요.' : '검색 조건에 맞는 그룹상품이 없습니다.'}</TableCell></TableRow> : null}</TableBody></GroupTable>
      <GroupPager {...page} disabled={pending} onChange={number => load({ ...applied, page: number })} /></div> : <p className="text-sm text-muted-foreground" role="status">목록을 조회해주세요.</p>}
  </section>;
}
