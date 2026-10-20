'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { executeCouponIssueAction, findCouponIssueCustomersAction, previewCouponIssueAction, readCouponIssueAction } from '@/app/admin/coupon-issuance-actions';
import { COUPON_ISSUE_PATH, couponIssueCustomerIds, couponIssueError, type CouponIssueBatch, type CouponIssueTargets } from '@/lib/admin/coupon-issuance';
import type { AdminCouponRecord } from '@/lib/admin/coupons';
import type { CustomerSegment } from '@/lib/admin/customer-segments';
import { useGoodsGroupSession } from './GoodsGroupOperation';
import { SegmentPicker } from './CustomerSegmentPicker';
import { AdminPageHeader, AdminSectionCard } from './console/AdminKit';
import '@/app/styles/admin-marketing-messages.css';
import '@/app/styles/admin-coupon-issuance.css';
export function CouponIssueWorkspace({ coupon, actorId, sessionId, initial = null }: { coupon: AdminCouponRecord; actorId: string; sessionId: string | null; initial?: CouponIssueBatch | null }) {
  const router = useRouter();
  const [kind, setKind] = useState<'customers' | 'segment'>('customers'), [ids, setIds] = useState(''), [query, setQuery] = useState(''), [customers, setCustomers] = useState<{ id: string; nickname: string; maskedEmail: string }[]>([]);
  const [segment, setSegment] = useState<CustomerSegment | null>(null), [batch, setBatch] = useState(initial), [confirmed, setConfirmed] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false);
  const [pending, start] = useTransition(), session = useGoodsGroupSession(actorId, sessionId), searchSequence = useRef(0), previewRequest = useRef<{ id: string; targets: CouponIssueTargets } | null>(null);
  const blocked = pending || uncertain || session.blocked;
  function changed() { setBatch(null); setConfirmed(false); setError(''); previewRequest.current = null; }
  function find() { const current = ++searchSequence.current; start(async () => {
    const result = await findCouponIssueCustomersAction(query); if (!session.current() || current !== searchSequence.current) return;
      if ('rows' in result && result.rows) { setCustomers(result.rows); setError(result.rows.length ? '' : '조건에 맞는 고객이 없습니다.'); } else setError(result.error ?? '고객을 조회하지 못했습니다.');
  }); }
  function preview() {
    if (!session.current() || !sessionId) return;
    const userIds = couponIssueCustomerIds(ids), targets: CouponIssueTargets | null = kind === 'customers' ? userIds ? { kind, userIds } : null : segment ? { kind, segmentId: segment.id, revision: segment.revision } : null;
    if (!targets) { setError('고객 ID를 입력하거나 세그먼트를 선택해주세요.'); return; }
    previewRequest.current ??= { id: crypto.randomUUID(), targets }; const request = previewRequest.current;
    start(async () => {
      const result = await previewCouponIssueAction(request.id, coupon.code, request.targets, { actorId, sessionId }); if (!session.current()) return;
      if (result.batch) { setBatch(result.batch); setConfirmed(false); setError(''); } else setError(result.error);
    });
  }
  function execute() { if (!batch || !session.current() || !sessionId) return; const id = batch.id;
    start(async () => {
      const result = await executeCouponIssueAction(id, { actorId, sessionId }, confirmed || uncertain); if (!session.current()) return;
      if (result.batch) { setBatch(result.batch); setConfirmed(false); setError(''); setUncertain(false); router.replace(`${COUPON_ISSUE_PATH}?couponCode=${encodeURIComponent(coupon.code)}&batchId=${result.batch.id}`, { scroll: false }); }
      else { setError(result.error); setUncertain(Boolean(result.uncertain)); }
    });
  }
  function read() { if (!batch) return; start(async () => { const result = await readCouponIssueAction(batch.id); if (!session.current()) return;
    if (result.batch) { setBatch(result.batch); setUncertain(false); setConfirmed(false); setError(''); router.replace(`${COUPON_ISSUE_PATH}?couponCode=${encodeURIComponent(coupon.code)}&batchId=${result.batch.id}`, { scroll: false }); } else setError(result.error);
  }); }
  return <section className="wc-admin-kit admin-coupon-issuance wc-admin-marketing">
    <AdminPageHeader title="고객 쿠폰 발급" description={`${coupon.name} · ${coupon.code}`} actions={<Link className="wc-admin-kit__button" href={`/admin/sales/coupons?couponCode=${encodeURIComponent(coupon.code)}`}>혜택 정보</Link>} />
    <AdminSectionCard title="발급 대상 선택"><p>지정 고객 또는 저장한 세그먼트의 현재 고객에게 쿠폰함으로 발급합니다. 기존 보유 쿠폰은 추가 발급하지 않습니다. 한 작업에 최대 1,000명이며 알림 발송은 별도입니다.</p>
      <fieldset disabled={blocked}><legend className="sr-only">발급 대상 방식</legend><div className="admin-coupon-issuance__modes"><label><input type="radio" name="coupon-issue-kind" checked={kind === 'customers'} onChange={() => { setKind('customers'); changed(); }} /> 지정 고객</label><label><input type="radio" name="coupon-issue-kind" checked={kind === 'segment'} onChange={() => { setKind('segment'); changed(); }} /> 세그먼트</label></div>
        {kind === 'customers' ? <><div className="wc-admin-marketing__picker-search"><label>고객 닉네임·ID·정확한 이메일<input value={query} maxLength={200} onChange={event => { setQuery(event.target.value); searchSequence.current++; }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); find(); } }} /></label><button type="button" className="wc-admin-kit__button" onClick={find}>고객 조회</button></div>
          {customers.length ? <ul className="admin-coupon-issuance__customers">{customers.map(customer => <li key={customer.id}><span>{customer.nickname} · {customer.maskedEmail}</span><button type="button" className="wc-admin-kit__button" disabled={ids.split(/[\s,;]+/).includes(customer.id)} onClick={() => { setIds(current => `${current.trim()}\n${customer.id}`.trim()); changed(); }}>대상 추가<span className="sr-only"> {customer.nickname}</span></button></li>)}</ul> : null}
          <label className="wc-admin-marketing__field">발급할 고객 ID <small>한 줄에 하나 · 중복 ID는 한 번만 반영</small><textarea rows={5} value={ids} maxLength={185000} onChange={event => { setIds(event.target.value); changed(); }} /></label>
        </> : <SegmentPicker selected={segment} disabled={blocked} showMarketingConsent={false} onSelect={value => { setSegment(value); changed(); }} />}
      </fieldset><button type="button" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={blocked} onClick={preview}>발급 대상 확인</button>
    </AdminSectionCard>
    {batch ? <AdminSectionCard title="발급 확인 결과"><p>작업 ID <Link href={`${COUPON_ISSUE_PATH}?couponCode=${encodeURIComponent(coupon.code)}&batchId=${batch.id}`}>{batch.id}</Link></p>
      <p>상태: <strong>{{ prepared: '발급 전 확인', invalid: '입력 확인 필요', completed: '발급 완료', failed: '발급 실패' }[batch.status]}</strong>{batch.segmentName ? ` · ${batch.segmentName}` : ''}</p>
      <div className="wc-admin-marketing__metrics"><div><span>확인한 대상</span><strong>{batch.targetCount.toLocaleString('ko-KR')}명</strong></div><div><span>새 발급 예정</span><strong>{batch.plannedCount.toLocaleString('ko-KR')}명</strong></div><div><span>기보유</span><strong>{batch.existingCount.toLocaleString('ko-KR')}명</strong></div><div><span>실제 새 발급</span><strong>{batch.issuedCount.toLocaleString('ko-KR')}명</strong></div></div>
      {batch.error ? <p role="alert">{couponIssueError(batch.error)}</p> : null}
      <div className="admin-coupon-issuance__table" role="region" aria-label="발급 대상 결과" tabIndex={0}><table><thead><tr><th>현재 닉네임</th><th>고객 ID</th><th>확인 결과</th><th>쿠폰 발급 ID</th></tr></thead><tbody>{batch.rows.map(row => <tr key={row.userId}><td>{row.nickname}</td><td>{row.userId}</td><td>{row.reason ? couponIssueError(row.reason) : row.userCouponId ? '쿠폰 보유 확인' : '새 발급 대상'}</td><td>{row.userCouponId ?? '—'}</td></tr>)}</tbody></table></div>
      {batch.status === 'prepared' ? <><p>{new Date(batch.validUntil).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}까지 유효합니다. 실행 시 자격·세그먼트·쿠폰 한도를 다시 검사합니다. 확인 이후 새로 조건에 들어온 고객은 추가하지 않습니다.</p>
        <label className="admin-coupon-issuance__confirm"><input type="checkbox" checked={confirmed} disabled={blocked} onChange={event => setConfirmed(event.target.checked)} /> 대상과 새 발급 수를 확인했습니다.</label>
        <button type="button" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={pending || session.blocked || !batch.canExecute || !confirmed && !uncertain} onClick={execute}>{uncertain ? '같은 발급 요청 결과 확인' : '쿠폰 발급 확정'}</button></> : null}
      <button type="button" className="wc-admin-kit__button" disabled={pending || session.blocked} onClick={read}>현재 작업 결과 조회</button>
      {['failed','invalid'].includes(batch.status) ? <button type="button" className="wc-admin-kit__button" disabled={blocked} onClick={changed}>대상 다시 확인</button> : null}
    </AdminSectionCard> : null}
    {error ? <p role="alert">{error}</p> : null}{session.blocked ? <p role="alert">로그인 상태가 바뀌었습니다. 현재 계정으로 다시 열어주세요.</p> : null}
  </section>;
}
