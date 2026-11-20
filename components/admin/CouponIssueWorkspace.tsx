'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { executeCouponIssueAction, findCouponIssueCustomersAction, previewCouponIssueAction, readCouponIssueAction } from '@/app/admin/coupon-issuance-actions';
import { revokeUserCouponsAction } from '@/app/admin/coupon-revoke-actions';
import { COUPON_REVOKE_REASON_MAX, COUPON_REVOKE_REASON_MIN, couponRevokeSummary } from '@/lib/admin/coupon-revoke';
import { adminPrompt } from '@/lib/admin/confirm';
import { COUPON_ISSUE_PATH, couponIssueCustomerIds, couponIssueError, type CouponIssueBatch, type CouponIssueSummary, type CouponIssueTargets } from '@/lib/admin/coupon-issuance';
import { withoutAdminSavedFlag } from '@/lib/admin/saved-flag';
import type { AdminCouponRecord } from '@/lib/admin/coupons';
import type { CustomerSegment } from '@/lib/admin/customer-segments';
import { useGoodsGroupSession } from './GoodsGroupOperation';
import { SegmentPicker } from './CustomerSegmentPicker';
import { ADMIN_COUNT_CARD_GRID_CLASS, AdminCountCard } from './console/AdminCountCard';
import { AdminNotice, AdminPageHeader, AdminSectionCard, AdminStatusBadge } from './console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { Textarea } from '@/components/admin/kit/ui/textarea';

/* 고객 쿠폰 발급(템플릿 룩, ADR-0028). 대상 확인 → 확인 체크 → 확정·결과 조회 흐름과 같은 요청 재확인은 그대로다. */
/*
 * 1027T-026: [쿠폰 발급 확정]을 누를 수 없는 이유를 버튼 옆에 적는다. 판정(canExecute: 같은 운영자·같은 로그인 세션·준비 상태·유효 시간 안)은
 * 서버 값 그대로이고, 화면은 이유와 다시 준비하는 방법만 알린다. 유효 시간이 지났는지 다른 세션인지는 서버가 나눠 주지 않아 함께 적는다.
 */
function executeBlockedReason(batch: CouponIssueBatch, confirmed: boolean, uncertain: boolean): string | null {
  if (batch.status !== 'prepared') return null;
  if (!batch.canExecute) return `이 확인 결과는 유효 시간(${new Date(batch.validUntil).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}까지)이 지났거나 다른 로그인(다른 브라우저·다시 로그인한 경우 포함)이나 다른 운영자가 만든 작업이라 확정할 수 없습니다. ${batch.targetKind === 'customers'
    ? '[대상 다시 확인]을 누르면 같은 고객이 다시 채워지니 [발급 대상 확인]으로 새로 확인해주세요.'
    : '[대상 다시 확인]을 누른 뒤 세그먼트를 다시 골라 [발급 대상 확인]으로 새로 확인해주세요.'}`;
  if (!confirmed && !uncertain) return '대상과 새 발급 수를 확인했다는 확인란에 체크하면 확정할 수 있습니다.';
  return null;
}

export function CouponIssueWorkspace({ coupon, actorId, sessionId, initial = null, justSaved = false, recent = [] }: {
  coupon: AdminCouponRecord; actorId: string; sessionId: string | null; initial?: CouponIssueBatch | null;
  /** 이 쿠폰의 최근 발급 작업(완료·실패). 눌러서 결과 표를 다시 연다. */ recent?: CouponIssueSummary[];
  /** 혜택 등록에서 고객지정 혜택을 처음 저장하고 옮겨 왔다(주소의 한 번용 saved 표시). */
  justSaved?: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<'customers' | 'segment'>('customers'), [ids, setIds] = useState(''), [query, setQuery] = useState(''), [customers, setCustomers] = useState<{ id: string; nickname: string; maskedEmail: string; operator?: boolean }[]>([]);
  const [segment, setSegment] = useState<CustomerSegment | null>(null), [batch, setBatch] = useState(initial), [confirmed, setConfirmed] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false);
  const [pending, start] = useTransition(), session = useGoodsGroupSession(actorId, sessionId), searchSequence = useRef(0), previewRequest = useRef<{ id: string; targets: CouponIssueTargets } | null>(null);
  const blocked = pending || uncertain || session.blocked;
  /* 잘못 발급한 쿠폰 개별 회수(PAY-034): 완료된 작업의 결과 줄에서 미사용 쿠폰을 골라 회수한다. */
  const [picked, setPicked] = useState<Set<string>>(new Set()), [revokeNotice, setRevokeNotice] = useState('');
  const revocable = (row: CouponIssueBatch['rows'][number]) => row.userCouponId !== null && row.heldStatus === 'active' && !row.revokedAt;
  function togglePick(id: string, on: boolean) { setPicked(current => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; }); }
  async function revoke() {
    if (!batch || !picked.size || !session.current()) return;
    const ids = [...picked], reason = await adminPrompt({
      title: `쿠폰 ${ids.length}장 회수`, destructive: true, confirmLabel: '회수',
      message: `선택한 ${ids.length}장은 고객 쿠폰함에서 사라지고 쓸 수 없게 됩니다. 되돌릴 수 없고, 지정·코드 발급으로는 같은 쿠폰을 같은 고객에게 다시 발급하지 않습니다(매월 지급하는 등급 쿠폰은 다음 달 지급분이 새로 들어갑니다). 결제 대기 주문이 잡은 쿠폰이나 이미 사용한 쿠폰은 회수되지 않습니다.`,
      input: { label: '회수 사유', placeholder: '예: 다른 고객에게 잘못 발급', minLength: COUPON_REVOKE_REASON_MIN, maxLength: COUPON_REVOKE_REASON_MAX },
    });
    if (reason === null) return;
    start(async () => {
      const result = await revokeUserCouponsAction({ userCouponIds: ids, reason, operationId: crypto.randomUUID() }); if (!session.current()) return;
      if (!result.ok) { setError(result.error); return; }
      setError(''); setPicked(new Set()); setRevokeNotice(couponRevokeSummary(result.result));
      const refreshed = await readCouponIssueAction(batch.id); if (refreshed.batch) setBatch(refreshed.batch);
    });
  }
  /* 저장 결과 문장은 이 화면에 머무는 동안만 보이고, 주소의 표시는 지워 새로고침에 다시 뜨지 않게 한다. */
  const [saved] = useState(justSaved);
  useEffect(() => {
    if (justSaved) window.history.replaceState(null, '', withoutAdminSavedFlag(`${window.location.pathname}${window.location.search}`));
  }, [justSaved]);
  const executeReason = batch && !pending && !session.blocked ? executeBlockedReason(batch, confirmed, uncertain) : null;
  function changed() { setBatch(null); setConfirmed(false); setError(''); setPicked(new Set()); setRevokeNotice(''); previewRequest.current = null; }
  /* 세그먼트 작업을 다시 준비할 때 고를 세그먼트 이름(작업 조회로 화면이 새로 열리면 고른 세그먼트가 비어 있다). */
  const [segmentHint, setSegmentHint] = useState<{ name: string | null } | null>(null);
  const idsInput = useRef<HTMLTextAreaElement>(null), segmentBox = useRef<HTMLDivElement>(null);
  /* [대상 다시 확인] 뒤에는 결과 카드와 버튼이 사라진다 — 포커스가 몸통으로 떨어지지 않게 다시 고를 자리(고객 ID 칸·세그먼트 조회 칸)로 옮긴다. */
  function focusTargets(target: 'customers' | 'segment') {
    requestAnimationFrame(() => (target === 'segment' ? segmentBox.current?.querySelector<HTMLInputElement>('input') : idsInput.current)?.focus());
  }
  function retarget() { changed(); focusTargets(kind); }
  /* 확정할 수 없는 준비 작업을 다시 준비한다. 그 작업의 방식으로 돌아가, 입력이 비었으면 고객을 다시 채우고 세그먼트는 이름을 보여 다시 고르게 한다(판정은 새 확인이 다시 한다). */
  function reprepare() {
    if (!batch) return;
    setKind(batch.targetKind);
    if (batch.targetKind === 'segment') { if (!segment) setSegmentHint({ name: batch.segmentName }); }
    else if (!couponIssueCustomerIds(ids)) setIds(batch.rows.map(row => row.userId).join('\n'));
    changed(); focusTargets(batch.targetKind);
  }
  function find() { const current = ++searchSequence.current; start(async () => {
    const result = await findCouponIssueCustomersAction(query); if (!session.current() || current !== searchSequence.current) return;
      if ('rows' in result && result.rows) { setCustomers(result.rows); setError(result.rows.length ? '' : '조건에 맞는 고객이 없습니다.'); } else setError(result.error ?? '고객을 조회하지 못했습니다.');
  }); }
  function preview() {
    if (!session.current() || !sessionId) return;
    const userIds = couponIssueCustomerIds(ids), targets: CouponIssueTargets | null = kind === 'customers' ? userIds ? { kind, userIds } : null : segment ? { kind, segmentId: segment.id, revision: segment.revision } : null;
    if (!targets) { setError('발급할 고객의 회원번호를 넣거나 세그먼트를 선택해주세요.'); return; }
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
  return <section className="flex min-w-0 flex-col gap-4">
    <AdminPageHeader title="고객 쿠폰 발급" description={`${coupon.name} · ${coupon.code}`} actions={<Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={`/admin/sales/coupons?couponCode=${encodeURIComponent(coupon.code)}`}>혜택 정보</Link>} />
    {saved ? <AdminNotice role="status" tone="success">{coupon.code} 쿠폰을 저장했습니다. 고객지정 혜택은 아래에서 대상을 확인하고 발급을 확정해야 쿠폰함에 들어갑니다.</AdminNotice> : null}
    <AdminSectionCard title="발급 대상 선택"><p className="leading-relaxed text-muted-foreground">지정 고객 또는 저장한 세그먼트의 현재 고객에게 쿠폰함으로 발급합니다. 기존 보유 쿠폰은 추가 발급하지 않습니다. 한 작업에 최대 1,000명이며 알림 발송은 별도입니다.</p>
      <fieldset className="flex min-w-0 flex-col gap-4" disabled={blocked}><legend className="sr-only">발급 대상 방식</legend><div className="flex flex-wrap gap-6"><label className="flex items-center gap-2"><input type="radio" name="coupon-issue-kind" checked={kind === 'customers'} onChange={() => { setKind('customers'); setSegmentHint(null); changed(); }} /> 지정 고객</label><label className="flex items-center gap-2"><input type="radio" name="coupon-issue-kind" checked={kind === 'segment'} onChange={() => { setKind('segment'); setSegmentHint(null); changed(); }} /> 세그먼트</label></div>
        {kind === 'customers' ? <><div className="flex flex-wrap items-end gap-2.5"><label className="flex min-w-0 flex-1 basis-60 flex-col gap-1.5 font-medium">고객 닉네임·회원번호·정확한 이메일<Input value={query} maxLength={200} onChange={event => { setQuery(event.target.value); searchSequence.current++; }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); find(); } }} /></label><Button type="button" variant="outline" onClick={find}>고객 조회</Button></div>
          {customers.length ? <ul className="grid gap-2">{customers.map(customer => <li className="flex flex-col items-start justify-between gap-2 rounded-lg border px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3" key={customer.id}><span className="min-w-0 [overflow-wrap:anywhere]">{customer.nickname} · {customer.maskedEmail}{customer.operator ? <> · <AdminStatusBadge tone="neutral">운영자 계정</AdminStatusBadge></> : null}</span><Button aria-label={`대상 추가 ${customer.nickname}`} className="shrink-0" type="button" size="sm" variant="outline" disabled={ids.split(/[\s,;]+/).includes(customer.id)} onClick={() => { setIds(current => `${current.trim()}\n${customer.id}`.trim()); changed(); }}>대상 추가</Button></li>)}</ul> : null}
          <label className="flex min-w-0 flex-col gap-2 font-medium"><span>발급할 고객 회원번호 <small className="text-xs font-normal text-muted-foreground">한 줄에 하나 · 고객 조회의 &lsquo;대상 추가&rsquo;로도 채워짐 · 같은 번호는 한 번만 반영</small></span><Textarea className="font-mono text-xs" ref={idsInput} rows={5} value={ids} maxLength={185000} onChange={event => { setIds(event.target.value); changed(); }} /></label>
        </> : <div className="flex min-w-0 flex-col gap-2" ref={segmentBox}>
          {segmentHint && !segment ? <p className="text-sm leading-relaxed text-muted-foreground" data-coupon-issue-segment-hint="">{segmentHint.name ? <>이전 작업의 세그먼트는 <strong className="font-medium text-foreground">{segmentHint.name}</strong>입니다. 아래에서 다시 조회해 골라 주세요.</> : '이전 작업의 세그먼트를 아래에서 다시 조회해 골라 주세요.'}</p> : null}
          <SegmentPicker selected={segment} disabled={blocked} showMarketingConsent={false} onSelect={value => { setSegment(value); setSegmentHint(null); changed(); }} />
        </div>}
      </fieldset><Button className="self-start" type="button" variant={batch ? 'soft' : 'default'} disabled={blocked} onClick={preview}>발급 대상 확인</Button>
    </AdminSectionCard>
    {batch ? <AdminSectionCard title="발급 확인 결과"><p className="[overflow-wrap:anywhere]">작업 번호 <Link className="underline underline-offset-4" href={`${COUPON_ISSUE_PATH}?couponCode=${encodeURIComponent(coupon.code)}&batchId=${batch.id}`}>{batch.id}</Link></p>
      <p className="flex flex-wrap items-center gap-2">상태: <AdminStatusBadge tone={statusTone('couponIssue', batch.status)}>{{ prepared: batch.canExecute ? '발급 전 확인' : '유효 시간 지남·실행 불가', invalid: '입력 확인 필요', completed: '발급 완료', failed: '발급 실패' }[batch.status]}</AdminStatusBadge>{batch.segmentName ? <span>{batch.segmentName}</span> : null}</p>
      <div className={ADMIN_COUNT_CARD_GRID_CLASS}><AdminCountCard count={batch.targetCount} label="확인한 대상" unit="명" /><AdminCountCard count={batch.plannedCount} label="새 발급 예정" tone="info" unit="명" /><AdminCountCard count={batch.existingCount - batch.rows.filter(row => row.excluded === 'revoked').length} label="기보유" unit="명" />{batch.rows.some(row => row.excluded === 'revoked') ? <AdminCountCard count={batch.rows.filter(row => row.excluded === 'revoked').length} label="회수 이력 제외" tone="warning" unit="명" /> : null}<AdminCountCard count={batch.issuedCount} label="실제 새 발급" tone="success" unit="명" /></div>
      {batch.error ? <AdminNotice role="alert" tone="danger">{couponIssueError(batch.error)}</AdminNotice> : null}
      <div className="min-w-0 overflow-x-auto rounded-lg border outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&>[data-slot=table-container]]:overflow-visible" role="region" aria-label="발급 대상 결과" tabIndex={0}><Table className="min-w-[800px] text-xs"><TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent">{batch.status === 'completed' ? <TableHead className="w-10"><span className="sr-only">회수할 쿠폰 선택</span></TableHead> : null}<TableHead>현재 닉네임</TableHead><TableHead>회원번호</TableHead><TableHead>확인 결과</TableHead><TableHead>쿠폰 발급 번호</TableHead></TableRow></TableHeader><TableBody>{batch.rows.map(row => <TableRow key={row.userId}>{batch.status === 'completed' ? <TableCell>{row.userCouponId && revocable(row) ? <input type="checkbox" aria-label={`쿠폰 회수 선택 ${row.nickname}`} checked={picked.has(row.userCouponId)} disabled={blocked} onChange={event => togglePick(row.userCouponId as string, event.target.checked)} /> : null}</TableCell> : null}<TableCell>{row.nickname}</TableCell><TableCell className="font-mono">{row.userId}</TableCell><TableCell>{row.reason ? couponIssueError(row.reason) : row.excluded === 'revoked' ? '회수 이력으로 제외(발급하지 않음)' : row.revokedAt ? '회수함' : row.heldStatus === 'used' ? '사용·결제 대기 주문 사용 중' : row.userCouponId ? '쿠폰 보유 확인' : '새 발급 대상'}</TableCell><TableCell className="font-mono">{row.userCouponId ?? '—'}</TableCell></TableRow>)}</TableBody></Table></div>
      {batch.status === 'completed' ? <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5"><p className="min-w-0 flex-1 text-sm leading-relaxed text-muted-foreground">잘못 발급한 쿠폰은 위 표에서 고객을 골라 회수합니다. 미사용 쿠폰만 회수되고 되돌릴 수 없습니다.</p>
        <Button type="button" variant="outline" disabled={blocked || !picked.size} onClick={revoke}>선택한 쿠폰 회수{picked.size ? ` (${picked.size})` : ''}</Button></div> : null}
      {revokeNotice ? <AdminNotice role="status" tone="success">{revokeNotice}</AdminNotice> : null}
      {batch.status === 'prepared' ? <><p className="leading-relaxed text-muted-foreground">{new Date(batch.validUntil).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}까지 {batch.canExecute ? '이 확인 결과로 발급할 수 있습니다' : '쓸 수 있던 확인 결과입니다(지금은 발급할 수 없습니다)'}. 발급을 확정할 때 고객 자격·세그먼트 조건·쿠폰 한도를 다시 확인합니다. 대상을 확인한 뒤 새로 조건에 맞게 된 고객은 추가하지 않습니다.</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} disabled={blocked} onChange={event => setConfirmed(event.target.checked)} /> 대상과 새 발급 수를 확인했습니다.</label></> : null}
      <div className="flex flex-wrap gap-2">
        {batch.status === 'prepared' ? <Button aria-describedby={executeReason ? 'coupon-issue-execute-reason' : undefined} type="button" disabled={pending || session.blocked || !batch.canExecute || !confirmed && !uncertain} onClick={execute}>{uncertain ? '같은 발급 요청 결과 확인' : '쿠폰 발급 확정'}</Button> : null}
        <Button type="button" variant="outline" disabled={pending || session.blocked} onClick={read}>현재 작업 결과 조회</Button>
        {['failed','invalid'].includes(batch.status) ? <Button type="button" variant="outline" disabled={blocked} onClick={retarget}>대상 다시 확인</Button>
          : batch.status === 'prepared' && !batch.canExecute ? <Button type="button" variant="outline" disabled={blocked} onClick={reprepare}>대상 다시 확인</Button> : null}
      </div>
      {executeReason ? <p className="text-sm leading-relaxed text-muted-foreground" id="coupon-issue-execute-reason">{executeReason}</p> : null}
    </AdminSectionCard> : null}
    {recent.length ? <AdminSectionCard title="최근 발급 작업"><ul className="grid gap-2">{recent.map(job => <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm" key={job.id}>
      <span className="min-w-0 [overflow-wrap:anywhere]"><time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time> · 대상 {job.targetCount}명 · 새 발급 {job.issuedCount}명{job.revokedCount ? ` · 회수 ${job.revokedCount}장` : ''}{job.status === 'failed' ? ' · 발급 실패' : ''}</span>
      <Link className="underline underline-offset-4" href={`${COUPON_ISSUE_PATH}?couponCode=${encodeURIComponent(coupon.code)}&batchId=${job.id}`}>결과 열기</Link></li>)}</ul></AdminSectionCard> : null}
    {error ? <AdminNotice role="alert" tone="danger">{error}</AdminNotice> : null}{session.blocked ? <AdminNotice role="alert" tone="danger">로그인 상태가 바뀌었습니다. 현재 계정으로 다시 열어주세요.</AdminNotice> : null}
  </section>;
}
