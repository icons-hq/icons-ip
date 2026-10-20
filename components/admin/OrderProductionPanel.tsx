'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { readOrderProductionAction, changeOrderProductionAction } from '@/app/admin/production-actions';
import { PRODUCTION_STATE_LABELS, productionLeadLabel, type OrderProduction } from '@/lib/order-production';
import { SellerClaimIntakeButton } from './screens/SellerClaimIntakeForm';
import '@/app/styles/admin-order-production.css';
const time = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' });
type Props = { initial: OrderProduction | null; actorId: string; canManage: boolean };
export function OrderProductionPanel(props: Props) {
 if (props.initial?.jobs.length === 0) return null;
 return <ClaimContactSession actorId={props.actorId} pendingMessage="로그인 상태를 확인하고 있습니다.">{(identity, scope) => <Panel {...props} identity={identity} scope={scope} />}</ClaimContactSession>;
}
function Panel({ initial, identity, scope, canManage }: Props & { identity: ClaimContactIdentity; scope: ClaimContactScope }) {
 const [document, setDocument] = useState(initial), [jobId, setJobId] = useState(''), [evidence, setEvidence] = useState(''), [confirmed, setConfirmed] = useState(false), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState('');
 const router = useRouter(), busy = useRef(false), alive = useRef(true), dispatched = useRef<{ jobId: string; kind: 'start' | 'complete'; revision: number; operation: string; evidence: string } | null>(null);
 useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 const selected = document?.jobs.find(j => j.id === jobId), kind = selected?.canStart ? 'start' : selected?.canComplete ? 'complete' : null;
 async function read() { if (!document || busy.current || uncertain) return; const ticket = scope.capture(); if (!ticket) return; busy.current = true; setPending(true);
  try { const result = await readOrderProductionAction(document.orderId); if (!alive.current || !scope.canApply(ticket)) return;
   if ('document' in result && result.document) { setDocument(result.document); setMessage('현재 제작 현황을 불러왔습니다.'); } else setMessage(result.error ?? '현황을 확인하지 못했습니다.');
  } finally { busy.current = false; if (alive.current) setPending(false); }
 }
 async function save() { if (!document || !selected || !confirmed || busy.current || !canManage || (!kind && !uncertain)) return; const ticket = scope.capture(); if (!ticket) return;
  const request = dispatched.current ?? { jobId: selected.id, kind: kind!, revision: selected.revision, operation: crypto.randomUUID(), evidence: evidence.trim() };
  dispatched.current = request; busy.current = true; setPending(true);
  try { const result = await changeOrderProductionAction(document.orderId, request.jobId, request.kind, request.revision, request.operation, request.evidence, identity); if (!alive.current || !scope.canApply(ticket)) return;
   if ('document' in result && result.document) { setDocument(result.document); dispatched.current = null; setUncertain(false); setEvidence(''); setConfirmed(false); setMessage(request.kind === 'start' ? '제작 시작을 기록했습니다.' : '제작 완료를 기록했습니다. 실제 발송은 배송 처리에서 진행해주세요.'); router.refresh(); }
   else { setMessage(result.error ?? '결과를 확인하지 못했습니다.'); setUncertain(uncertain || Boolean(result.uncertain)); if (!uncertain && !result.uncertain) dispatched.current = null; }
  } catch { if (alive.current && scope.canApply(ticket)) { setUncertain(true); setMessage('저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.'); } }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 if (!document) return <p role="status">주문제작 현황을 읽지 못했습니다. 화면을 새로고침해주세요.</p>;
 return <section className="admin-order-production wc-admin-kit__card" aria-label="주문제작 처리"><h2>주문제작 처리</h2><p>상품별 실제 제작 시작·완료를 기록합니다. 교환 제작은 전체 회수 확인 후 별도 이력으로 처리합니다. 제작 완료와 발송 완료는 각각 기록합니다.</p>
  <button type="button" className="wc-admin-kit__button" disabled={pending || uncertain} onClick={() => { void read(); }}>현재 제작 현황 다시 확인</button>
  <ul className="admin-order-production__jobs">{document.jobs.map(job => <li key={job.id}><strong>{job.goodName} · {job.quantity}개{job.claimId ? ' · 교환 제작' : ''}</strong><p>{PRODUCTION_STATE_LABELS[job.state]} · {productionLeadLabel(job.terms)} 내 발송 예정</p>
   <p>{job.basisAt ? `기준 시각 ${time(job.basisAt)}` : '결제 확인 대기'}{job.dueAt ? ` · 발송 예정 기한 ${time(job.dueAt)}` : ''}</p>
   {job.startedAt ? <p>제작 시작 {time(job.startedAt)}</p> : null}{job.completedAt ? <p>제작 완료 {time(job.completedAt)}</p> : null}
   {job.history.length ? <details><summary>제작 처리 이력 {job.history.length}건</summary><ul>{job.history.map(event => <li key={event.id}>{event.kind === 'start' ? '시작' : '완료'} · {time(event.at)} · {event.evidence}</li>)}</ul></details> : null}
  </li>)}</ul>
  {canManage && (uncertain || document.jobs.some(j => j.canStart || j.canComplete)) ? <form onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={pending || uncertain}><legend>제작 상태 기록</legend>
   <label>대상 상품<select value={jobId} onChange={e => { setJobId(e.target.value); setEvidence(''); setConfirmed(false); }} required><option value="">선택해주세요</option>{document.jobs.filter(j => j.canStart || j.canComplete || j.id === jobId).map(j => <option key={j.id} value={j.id}>{j.goodName}{j.claimId ? ' (교환 제작)' : ''} · {PRODUCTION_STATE_LABELS[j.state]}</option>)}</select></label>
   <label>작업 확인 근거<input value={evidence} onChange={e => setEvidence(e.target.value)} required minLength={2} maxLength={1000} /></label>
   <label className="admin-order-production__check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required />실제 제작 {kind === 'complete' ? '완료를' : '시작을'} 확인했습니다.</label>
  </fieldset><button type="submit" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={pending || !confirmed || !selected || !kind && !uncertain}>{uncertain ? '같은 요청으로 결과 확인' : kind === 'complete' ? '제작 완료 기록' : '제작 시작 기록'}</button></form> : null}
  {canManage && document.canCancel ? <><p>발송 전 취소는 접수 후 검토할 수 있습니다. 제작 시작 후에는 자동 환불하지 않습니다.</p><SellerClaimIntakeButton orderId={document.orderId} mode="cancel" /></> : null}
  {message ? <p role="status">{message}</p> : null}
 </section>;
}
