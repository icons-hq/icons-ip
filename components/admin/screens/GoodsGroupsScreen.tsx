'use client';
import Link from 'next/link';
import { Fragment, useRef, useState, useTransition } from 'react';
import { searchGoodsGroupConsoleAction } from '@/app/admin/goods-group-actions';
import { GOODS_GROUPS_PATH, goodsGroupConversionHref, goodsGroupHref, type GoodsGroupPage, type GoodsGroupSnapshot } from '@/lib/admin/goods-groups';
import { formatWon } from '@/lib/admin/goods-price-editor';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { GoodsGroupEditor } from '../GoodsGroupEditor';
import { GoodsBulkToolbar } from '../GoodsBulkToolbar';
import { GROUP_BUTTON, GROUP_PRIMARY, GroupPager, GroupTable, useGoodsGroupSession } from '../GoodsGroupOperation';
import { DEFAULT_GROUP_FILTERS, GROUP_SEARCH_FIELDS, GROUP_SORTS, GROUP_STATUSES, goodsGroupConsoleHref, type GoodsGroupConsole, type GoodsGroupFilters } from '@/lib/admin/goods-group-console';

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
  function load(next: GoodsGroupFilters = { ...filters, page: 1 }) {
    if (!identity || !session.current() || pending) return;
    const ticket = ++sequence.current; setError(''); startTransition(async () => {
      try { let result = await searchGoodsGroupConsoleAction(next, identity); if (!session.current() || ticket !== sequence.current) return;
        if ('value' in result && next.page > Math.max(1, Math.ceil(result.value.total / result.value.pageSize))) {
          next = { ...next, page: Math.max(1, Math.ceil(result.value.total / result.value.pageSize)) }; result = await searchGoodsGroupConsoleAction(next, identity);
        }
        if (!session.current() || ticket !== sequence.current) return;
        if ('error' in result) { setError(result.error); if (result.authChanged) session.deny(); } else {
          setPage(result.value); setConsoleData(result.value); setApplied(next); setFilters(next); setExpanded(new Set()); setSelected([]);
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
  if (session.blocked) return <p role="alert">로그인 상태가 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.</p>;
  if (initialGroup) return <><AdminPageHeader title={initialGroup.name} description="그룹상품의 판매옵션 구성을 관리합니다." />
    <GoodsGroupEditor key={`${initialGroup.id}:${actorId}:${sessionId}`} initial={initialGroup} newGroupId={initialGroup.id} actorId={actorId} sessionId={sessionId} /></>;
  return <section className="wc-admin-kit admin-console admin-goods-worklist admin-group-console" aria-busy={pending}>
    <nav className="admin-goods-worklist__tabs" aria-label="상품 목록"><Link href="/admin/catalog/goods">전체 상품 조회/수정</Link><span aria-current="page">그룹상품 조회/수정</span></nav>
    <div className="admin-goods-worklist__status-strip">{GROUP_STATUSES.map(status => <button type="button" key={status.value} disabled={pending} aria-pressed={applied.status === status.value} onClick={() => load({ ...applied, status: status.value, page: 1 })}>
      <span className="admin-goods-worklist__status-icon" aria-hidden="true">▦</span><span>{status.label}<strong>{consoleData?.counts[status.value]?.toLocaleString('ko-KR') ?? '—'}<small>건</small></strong></span></button>)}</div>
    <form className="admin-goods-search" role="search" onSubmit={event => { event.preventDefault(); if (filters.from && filters.to && filters.from > filters.to) { setError('시작일은 종료일보다 늦을 수 없습니다.'); return; } load(); }}>
      <div className="admin-goods-search__row admin-goods-search__row--query"><label htmlFor="group-query">검색어</label><div className="admin-goods-search__content">
        <fieldset className="admin-goods-search__choices"><legend className="sr-only">검색 항목</legend>{GROUP_SEARCH_FIELDS.map(field => <label key={field.value}><input type="radio" name="group-field" value={field.value} checked={filters.field === field.value} disabled={pending} onChange={() => change('field', field.value)} />{field.label}</label>)}</fieldset>
        <input id="group-query" type="search" value={filters.query} maxLength={100} disabled={pending} onChange={event => change('query', event.target.value)} /></div></div>
      <div className="admin-goods-search__row"><span id="group-status-label">공개 상태</span><fieldset className="admin-goods-search__choices" aria-labelledby="group-status-label">{GROUP_STATUSES.map(status => <label key={status.value}><input type="radio" name="group-status" checked={filters.status === status.value} disabled={pending} onChange={() => change('status', status.value)} />{status.label}</label>)}</fieldset></div>
      <div className="admin-goods-search__row"><label htmlFor="group-category">카테고리</label><div className="admin-goods-search__selects"><select id="group-category" value={filters.categoryId} disabled={pending} onChange={event => change('categoryId', event.target.value)}><option value="">전체 카테고리</option>{categories.map(row => <option key={row.id} value={row.id}>{'　'.repeat(Math.max(0, row.depth - 1))}{row.name}</option>)}</select></div></div>
      <div className="admin-goods-search__row"><span id="group-period-label">기간</span><div className="admin-goods-search__period" role="group" aria-labelledby="group-period-label">
        <select aria-label="기간 기준" value={filters.dateField} disabled={pending} onChange={event => change('dateField', event.target.value as GoodsGroupFilters['dateField'])}><option value="created">그룹상품등록일</option><option value="updated">그룹상품수정일</option></select>
        <div className="admin-group-console__presets">{[['오늘', 0], ['1주일', 6], ['1개월', 29], ['3개월', 89], ['6개월', 179], ['1년', 364], ['전체', null]].map(([label, days]) => <button key={label} type="button" disabled={pending} onClick={() => period(days as number | null)}>{label}</button>)}</div>
        <div className="admin-goods-search__dates"><input aria-label="시작일" type="date" value={filters.from ?? ''} disabled={pending} onChange={event => change('from', event.target.value || null)} /><span>~</span><input aria-label="종료일" type="date" value={filters.to ?? ''} disabled={pending} onChange={event => change('to', event.target.value || null)} /></div>
      </div></div>
      <details className="admin-goods-search__advanced"><summary>상세검색 <span aria-hidden="true">⌄</span></summary><div className="admin-goods-search__row"><span>상세검색</span><div className="admin-goods-search__advanced-fields">
        <select aria-label="옵션 재고" value={filters.stock} disabled={pending} onChange={event => change('stock', event.target.value as GoodsGroupFilters['stock'])}><option value="all">재고 전체</option><option value="available">재고 있는 옵션 포함</option><option value="soldout">품절 옵션 포함</option></select>
        <select aria-label="출고지" value={filters.originId} disabled={pending} onChange={event => change('originId', event.target.value)}><option value="">출고지 전체</option>{origins.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        <select aria-label="배송비" value={filters.shippingFee} disabled={pending} onChange={event => change('shippingFee', event.target.value as GoodsGroupFilters['shippingFee'])}><option value="all">배송비 전체</option><option value="free">무료배송 상품 포함</option><option value="paid">배송비 설정 상품 포함</option></select>
      </div></div></details>
      <div className="admin-goods-search__actions"><button className={GROUP_PRIMARY} type="submit" disabled={pending}>{pending ? '조회 중…' : '검색'}</button><button className={GROUP_BUTTON} type="button" disabled={pending} onClick={() => load({ ...DEFAULT_GROUP_FILTERS })}>초기화</button></div>
    </form>
    {error ? <p role="alert">{error}</p> : null}{page ? <div className="admin-goods-worklist__results"><div className="admin-goods-worklist__result-header"><h3>그룹목록 <span>(총 <strong>{page.total.toLocaleString('ko-KR')}</strong>개)</span></h3><div className="admin-goods-worklist__result-controls">
      <select aria-label="그룹상품 정렬" disabled={pending} value={applied.sort} onChange={event => load({ ...applied, sort: event.target.value as GoodsGroupFilters['sort'], page: 1 })}>{GROUP_SORTS.map(row => <option key={row.value} value={row.value}>{row.label}</option>)}</select>
      <select aria-label="그룹상품 목록수" disabled={pending} value={page.pageSize} onChange={event => load({ ...applied, pageSize: Number(event.target.value), page: 1 })}>{[20, 50, 100].map(size => <option key={size} value={size}>{size}개씩</option>)}</select></div></div>
      <div className="admin-goods-worklist__toolbar"><Link className={GROUP_BUTTON} href={goodsGroupConversionHref()}>선택형 옵션에서 그룹 전환</Link><Link className={GROUP_BUTTON} href={`${GOODS_GROUPS_PATH}/new?mode=assemble`}>기존 상품으로 그룹 구성</Link><p>그룹상품명을 눌러 구성·공통정보 수정 또는 그룹 해제를 진행할 수 있습니다.</p></div>
      {identity ? <GoodsBulkToolbar kind="groups" identity={identity} selectedIds={selected} disabled={pending}
        shippingGoodIds={[...new Set(page.rows.filter(group => selected.includes(group.id)).flatMap(group => group.members.map(member => member.goodId)))]}
        onCompleted={() => { setSelected([]); load(applied); }} /> : null}
      <GroupTable label="그룹상품 목록"><thead><tr><th><input type="checkbox" aria-label="현재 페이지 그룹상품 전체 선택" disabled={pending || !page.rows.some(group => !group.archivedAt)} checked={page.rows.some(group => !group.archivedAt) && page.rows.filter(group => !group.archivedAt).every(group => selected.includes(group.id))}
        onChange={event => setSelected(event.target.checked ? page.rows.filter(group => !group.archivedAt).map(group => group.id) : [])} /></th><th>그룹상품</th><th>옵션명</th><th>판매옵션</th><th>공개 상품</th><th>상태</th><th>카테고리</th><th>그룹상품등록일</th><th>그룹상품수정일</th></tr></thead><tbody>
      {page.rows.map(group => <Fragment key={group.id}><tr><td><input type="checkbox" aria-label={`${group.name} 선택`} disabled={pending || Boolean(group.archivedAt)} checked={selected.includes(group.id)} onChange={event => setSelected(current => event.target.checked ? [...current, group.id] : current.filter(id => id !== group.id))} /></td><td><Link className="admin-console-grid-link" href={goodsGroupHref(group.id)}>{group.name}</Link><br /><small>{group.id}</small>
        {group.members.length ? <div><button className={GROUP_BUTTON} type="button" disabled={pending} aria-expanded={expanded.has(group.id)} aria-controls={`group-members-${group.id}`}
          aria-label={`${group.name} 판매옵션 ${expanded.has(group.id) ? '접기' : '펼치기'}`} onClick={() => {
            if (!session.current()) return;
            setExpanded(current => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; });
          }}>{expanded.has(group.id) ? '판매옵션 접기' : '판매옵션 펼치기'}</button></div> : null}</td><td>{group.optionNames.join(' / ')}</td>
        <td data-align="end">{group.members.length}개</td><td data-align="end">{group.members.filter(member => member.publishedAt && !member.archivedAt).length}개</td><td><AdminStatusBadge tone={group.archivedAt ? 'neutral' : 'success'}>{group.archivedAt ? '연결 해제' : '사용 중'}</AdminStatusBadge></td>
        <td>{consoleData?.metadata[group.id]?.category ?? '미지정'}</td>{(['createdAt', 'updatedAt'] as const).map(key => <td key={key}>{consoleData?.metadata[group.id]?.[key] ? new Date(consoleData.metadata[group.id][key]).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—'}</td>)}</tr>
        {expanded.has(group.id) ? <tr id={`group-members-${group.id}`}><td colSpan={9}><GroupTable label={`${group.name} 개별 상품`}><thead><tr><th>상품·판매자상품코드</th><th>판매옵션</th><th>판매가</th><th>재고수량</th><th>공개 상태</th></tr></thead><tbody>
          {group.members.map(member => <tr key={member.goodId}><td><Link className="admin-console-grid-link" href={`/admin/catalog/goods?goodId=${encodeURIComponent(member.goodId)}`}>{member.name}</Link><br /><small>{member.code ?? member.goodId}</small></td>
            <td>{member.values.join(' / ')}</td><td data-align="end">{formatWon(member.price)}</td><td data-align="end">{member.stockQty.toLocaleString('ko-KR')}개</td><td>{member.archivedAt ? '보관' : member.publishedAt ? '공개' : '미공개'}</td></tr>)}
        </tbody></GroupTable></td></tr> : null}</Fragment>)}
      {!page.rows.length ? <tr><td colSpan={9} className="admin-console-grid-empty">검색 조건에 맞는 그룹상품이 없습니다.</td></tr> : null}</tbody></GroupTable>
      <GroupPager {...page} disabled={pending} onChange={number => load({ ...applied, page: number })} /></div> : <p role="status">목록을 조회해주세요.</p>}
  </section>;
}
