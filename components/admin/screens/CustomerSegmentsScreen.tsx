'use client';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { archiveCustomerSegmentsAction, favoriteCustomerSegmentAction } from '@/app/admin/customer-segment-actions';
import { CUSTOMER_SEGMENTS_PATH, SEGMENT_GROUPS, SEGMENT_GROUP_LABELS, SEGMENT_TARGETS, SEGMENT_TARGET_LABELS, customerSegmentsHref, type SegmentList, type SegmentOverview } from '@/lib/admin/customer-segments';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '../console/AdminKit';
import { ConsolePagination } from '../console/ConsolePagination';
const number = (v: number | null | undefined) => v === null || v === undefined ? '미집계' : v.toLocaleString('ko-KR');
const time = (v: string) => new Date(v).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
export function CustomerSegmentsScreen({ data, overview }: { data: SegmentList; overview: SegmentOverview }) {
  const router = useRouter(), [pending, start] = useTransition(), [selected, setSelected] = useState<string[]>([]), [error, setError] = useState(''), [confirm, setConfirm] = useState(false), [uncertain, setUncertain] = useState(false);
  const archiveRequest = useRef<{ entries: { id: string; revision: number }[]; operationId: string } | null>(null);
  const { filters, rows, favorites, total } = data;
  function favorite(id: string, value: boolean) { setError(''); start(async () => { const result = await favoriteCustomerSegmentAction(id,value); if (result.error) setError(result.error); else router.refresh(); }); }
  function archive() { if (!archiveRequest.current) archiveRequest.current = { entries: rows.filter(row => selected.includes(row.id) && !row.presetKey).map(row => ({ id: row.id, revision: row.revision })), operationId: crypto.randomUUID() };
    const request = archiveRequest.current; start(async () => { const result = await archiveCustomerSegmentsAction(request.entries,request.operationId); if (result.error) { setError(result.error); setUncertain(!!result.uncertain); if (!result.uncertain) archiveRequest.current = null; }
      else { setSelected([]); setConfirm(false); setUncertain(false); archiveRequest.current = null; setError(''); router.refresh(); } }); }
  return <section className="wc-admin-kit wc-admin-kit__screen wc-admin-segments">
    <AdminPageHeader title="타겟 세그먼트" description="고객의 관심과 구매 이력을 조건으로 저장하고 필요할 때 다시 확인합니다." actions={<Link className="wc-admin-kit__button wc-admin-kit__button--primary" href={`${CUSTOMER_SEGMENTS_PATH}/new`}>새 세그먼트 만들기</Link>} />
    <div className="wc-admin-segments__groups">{SEGMENT_GROUPS.map(group => <Link key={group} href={customerSegmentsHref({ ...filters, group, target: 'all' },1)} aria-current={filters.group === group ? 'page' : undefined}><span>{SEGMENT_GROUP_LABELS[group]}</span><strong>{number(overview.groups[group])}{overview.groups[group] !== null ? <small>명</small> : null}</strong><small>{group === 'potential' ? '30일 관측 가능 회원 중 미방문' : group === 'visitor' ? '별도 동의 회원의 최근 30일 방문' : group === 'interested' ? '현재 관심 행동 있음' : group === 'buyer' ? '유효한 구매 이력 있음' : '유효한 주문 2회 이상'}</small></Link>)}</div>
    <p className="wc-admin-segments__hint">{time(overview.checkedAt)} 기준 · 가입 회원 중 첫구매 대상 {number(overview.firstPurchaseMembers)}명 · 고객군은 서로 겹칠 수 있습니다.</p>
    <AdminSectionCard title={`즐겨찾기 ${favorites.length}/3`} summary="운영자 개인별로 자주 쓰는 세그먼트를 최대 3개 보관합니다.">
      <div className="wc-admin-segments__favorites">{favorites.length ? favorites.map(row => <article key={row.id}><Link href={`${CUSTOMER_SEGMENTS_PATH}/${row.id}`}><span>{SEGMENT_TARGET_LABELS[row.target]}</span><strong>{row.name}</strong></Link><button type="button" disabled={pending || uncertain} onClick={() => favorite(row.id,false)} aria-label={`${row.name} 즐겨찾기 해제`}>★</button><p>최근 확인 {number(row.estimate?.matchedCount)}{row.estimate ? '명' : ''}</p></article>) : <p>목록의 별표를 눌러 즐겨찾기에 추가해주세요.</p>}</div>
    </AdminSectionCard>
    <AdminSectionCard title="세그먼트 목록">
      <form action={CUSTOMER_SEGMENTS_PATH} className="wc-admin-segments__filters">
        <label>고객군<select name="group" defaultValue={filters.group}><option value="all">전체</option>{SEGMENT_GROUPS.map(g => <option key={g} value={g}>{SEGMENT_GROUP_LABELS[g]}</option>)}</select></label>
        <label>상세 타겟<select name="target" defaultValue={filters.target}><option value="all">전체</option>{SEGMENT_TARGETS.map(t => <option key={t} value={t}>{SEGMENT_TARGET_LABELS[t]}</option>)}</select></label>
        <label>구분<select name="kind" defaultValue={filters.kind}><option value="all">전체</option><option value="preset">기본</option><option value="custom">직접 만든 세그먼트</option></select></label>
        <label>이름·ID 검색<input name="q" defaultValue={filters.query} maxLength={100} placeholder="세그먼트명 또는 CSG 번호" /></label>
        <label className="wc-admin-segments__check"><input type="checkbox" name="favorite" value="1" defaultChecked={filters.favoriteOnly} />즐겨찾기만</label>
        <label>표시 개수<select name="pageSize" defaultValue={filters.pageSize}><option value="20">20개</option><option value="50">50개</option><option value="100">100개</option></select></label><button className="wc-admin-kit__button" type="submit">조회</button><Link className="wc-admin-kit__button" href={CUSTOMER_SEGMENTS_PATH}>초기화</Link>
      </form>
      <div className="wc-admin-segments__toolbar"><p>총 <strong>{number(total)}</strong>개 · 선택 {selected.length}개</p><button type="button" className="wc-admin-kit__button" disabled={!selected.length || pending || uncertain} onClick={() => { setConfirm(true); setError(''); }}>선택 삭제</button></div>
      {error && <p role="alert" className="wc-admin-segments__error">{error}</p>}
      {confirm && <div role="alertdialog" aria-labelledby="segment-delete-title" className="wc-admin-segments__confirm"><strong id="segment-delete-title">선택한 세그먼트 {selected.length}개를 삭제할까요?</strong><p>목록과 즐겨찾기에서 제거됩니다. 과거 확인 기록은 보존됩니다.</p><button className="wc-admin-kit__button" type="button" disabled={pending} onClick={archive}>{pending ? '처리 중…' : uncertain ? '같은 삭제 요청 결과 확인' : '삭제'}</button><button className="wc-admin-kit__button" type="button" disabled={pending || uncertain} onClick={() => setConfirm(false)}>취소</button>{uncertain && <Link href={CUSTOMER_SEGMENTS_PATH}>목록 다시 열기</Link>}</div>}
      <div className="wc-admin-segments__table-wrap"><table className="wc-admin-segments__table"><thead><tr><th><input type="checkbox" aria-label="현재 페이지 직접 만든 세그먼트 전체 선택" disabled={pending || uncertain || !rows.some(r => !r.presetKey)} checked={rows.some(r => !r.presetKey) && rows.filter(r => !r.presetKey).every(r => selected.includes(r.id))} onChange={e => setSelected(e.target.checked ? rows.filter(r => !r.presetKey).map(r => r.id) : [])} /></th><th>즐겨찾기</th><th>세그먼트명</th><th>고객군·상세 타겟</th><th>최근 확인 고객수</th><th>동의 고객수</th><th>관리</th></tr></thead><tbody>
        {rows.length ? rows.map(row => <tr key={row.id}><td><input type="checkbox" aria-label={`${row.name} 선택`} disabled={!!row.presetKey || pending || uncertain} checked={selected.includes(row.id)} onChange={e => setSelected(current => e.target.checked ? [...current,row.id] : current.filter(id => id !== row.id))} /></td><td><button type="button" className="wc-admin-segments__star" aria-label={`${row.name} 즐겨찾기 ${row.favorite ? '해제' : '추가'}`} aria-pressed={row.favorite} disabled={pending || uncertain} onClick={() => favorite(row.id,!row.favorite)}>{row.favorite ? '★' : '☆'}</button></td>
          <td><Link href={`${CUSTOMER_SEGMENTS_PATH}/${row.id}`}>{row.name}</Link><small>CSG-{row.reference} · {row.presetKey ? '기본' : '직접 만듦'}</small>{!row.available && <AdminStatusBadge tone="warning">선택 대상 확인 필요</AdminStatusBadge>}</td><td>{SEGMENT_GROUP_LABELS[row.group]}<small>{SEGMENT_TARGET_LABELS[row.target]}</small></td><td>{number(row.estimate?.matchedCount)}{row.estimate && <small>{time(row.estimate.evaluatedAt)}</small>}</td><td>{number(row.estimate?.consentedCount)}</td><td><Link href={`${CUSTOMER_SEGMENTS_PATH}/${row.id}`}>상세</Link> <Link href={`${CUSTOMER_SEGMENTS_PATH}/new?copy=${row.id}`}>조건 재사용</Link></td></tr>) : <tr><td colSpan={7} className="wc-admin-segments__empty">조건에 맞는 세그먼트가 없습니다.{filters.group === 'potential' && <p>미방문·유사 상품 관심 조건은 별도 분석 동의와 관측 기간을 충족하는 회원에게 적용됩니다.</p>}</td></tr>}
      </tbody></table></div>
      <ConsolePagination page={filters.page} pageSize={filters.pageSize} total={total} hrefForPage={page => customerSegmentsHref(filters,page)} />
    </AdminSectionCard>
    <aside className="wc-admin-segments__notice"><strong>숫자를 읽는 기준</strong><p>고객수는 조건을 확인한 시점의 관찰값입니다. 현재 장바구니·찜, 구매·계정 상태와 마케팅 동의가 달라지면 다시 계산한 결과도 달라집니다. 미집계는 0명이 아닙니다.</p><p>세그먼트 저장은 조건을 보관하는 기능입니다. 외부 메시지를 발송하거나 예약하지 않습니다.</p></aside>
  </section>;
}
