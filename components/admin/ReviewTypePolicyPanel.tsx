'use client';
import { useEffect, useRef, useState } from 'react';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { readReviewTypePolicyAction, saveReviewTypePolicyAction } from '@/app/admin/review-type-policy-actions';
import type { ReviewTypePolicy } from '@/lib/review-types';
import { AdminField } from './console/AdminKit';
import '@/app/styles/admin-review-types.css';
const draftOf = (p: ReviewTypePolicy) => ({ enabled: p.enabled, basis: p.basis, startDays: p.startDays?.toString() ?? '', endDays: p.endDays?.toString() ?? '', maxOrderDays: p.maxOrderDays?.toString() ?? '', rewardEligible: p.rewardEligible, evidence: p.evidence, confirmed: false });
type Draft = ReturnType<typeof draftOf>;
type Request = { values: Omit<Draft, 'startDays' | 'endDays' | 'maxOrderDays'> & { startDays: number | null; endDays: number | null; maxOrderDays: number | null }; revision: number; operation: string };
export function ReviewTypePolicyPanel({ accountId }: { accountId: string }) {
 const [open, setOpen] = useState(false);
 return <details className="admin-review-type-policy wc-admin-kit__card" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>한달사용 리뷰 작성·보상 설정</summary>
  {open ? <ClaimContactSession actorId={accountId} pendingMessage="로그인 상태를 확인하고 있습니다.">{(identity, scope) => <Panel identity={identity} scope={scope} />}</ClaimContactSession> : null}
 </details>;
}
function Panel({ identity, scope }: { identity: ClaimContactIdentity; scope: ClaimContactScope }) {
 const [policy, setPolicy] = useState<ReviewTypePolicy | null>(null), [draft, setDraft] = useState<Draft | null>(null), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState('');
 const alive = useRef(true), busy = useRef(false), dispatched = useRef<Request | null>(null);
 useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 async function read() {
  if (busy.current || uncertain) return; const ticket = scope.capture(); if (!ticket) return;
  busy.current = true; setPending(true);
  try { const result = await readReviewTypePolicyAction(); if (!alive.current || !scope.canApply(ticket)) return;
   if ('policy' in result && result.policy) { setPolicy(result.policy); setDraft(draftOf(result.policy)); setMessage('현재 설정을 불러왔습니다.'); } else setMessage(result.error ?? '설정을 읽지 못했습니다.');
  } finally { busy.current = false; if (alive.current) setPending(false); }
 }
 async function save() {
  if (busy.current || !draft || !policy || !draft.confirmed) return; const ticket = scope.capture(); if (!ticket) return;
  if ([draft.startDays, draft.endDays, draft.maxOrderDays].some(value => value && !/^[1-9][0-9]*$/.test(value))) { setMessage('기간은 일 단위 정수로 입력해주세요.'); return; }
  const request = dispatched.current ?? { values: { ...draft, startDays: draft.startDays ? Number(draft.startDays) : null, endDays: draft.endDays ? Number(draft.endDays) : null, maxOrderDays: draft.maxOrderDays ? Number(draft.maxOrderDays) : null }, revision: policy.revision, operation: crypto.randomUUID() };
  dispatched.current = request; busy.current = true; setPending(true);
  try { const result = await saveReviewTypePolicyAction(request.values, request.revision, request.operation, identity); if (!alive.current || !scope.canApply(ticket)) return;
   if ('policy' in result && result.policy) { setPolicy(result.policy); setDraft(draftOf(result.policy)); setUncertain(false); dispatched.current = null; setMessage('한달사용 리뷰 설정을 저장했습니다.'); }
   else { setMessage(result.error ?? '저장 결과를 확인하지 못했습니다.'); setUncertain(uncertain || Boolean(result.uncertain)); if (!uncertain && !result.uncertain) dispatched.current = null; }
  } catch { if (alive.current && scope.canApply(ticket)) { setUncertain(true); setMessage('저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.'); } }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 return <div><p>일반 리뷰는 배송완료 후 90일까지 유지합니다. 한달사용 리뷰는 주문·상품별로 일반 리뷰와 별도로 1회 작성할 수 있습니다. 재구매는 작성 시점의 최근 180일 내 동일 상품 배송완료 이력으로 표시합니다.</p>
  <button type="button" className="wc-admin-kit__button" disabled={pending || uncertain} onClick={() => { void read(); }}>{policy ? '현재 설정 다시 불러오기' : '현재 설정 불러오기'}</button>
  {draft ? <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={pending || uncertain}><legend>한달사용 리뷰</legend>
   <label className="admin-review-type-policy__check"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />한달사용 리뷰 작성 사용</label>
   <div className="wc-admin-kit__form-grid"><AdminField label="기간 기준" inputId="review-type-basis"><select id="review-type-basis" value={draft.basis} onChange={e => setDraft({ ...draft, basis: e.target.value as Draft['basis'] })}><option value="delivered">배송완료</option><option value="confirmed">구매확정</option></select></AdminField>
    <AdminField label="기준일 후 작성 시작 (일)" inputId="review-type-start"><input id="review-type-start" type="number" min="30" max="365" value={draft.startDays} onChange={e => setDraft({ ...draft, startDays: e.target.value })} required={draft.enabled} /></AdminField>
    <AdminField label="기준일 후 작성 마감 (일)" inputId="review-type-end"><input id="review-type-end" type="number" min="30" max="730" value={draft.endDays} onChange={e => setDraft({ ...draft, endDays: e.target.value })} required={draft.enabled} /></AdminField>
    <AdminField label="주문일 후 최대 기간 (일, 선택)" inputId="review-type-order"><input id="review-type-order" type="number" min="1" max="1095" value={draft.maxOrderDays} onChange={e => setDraft({ ...draft, maxOrderDays: e.target.value })} /></AdminField></div>
   <label className="admin-review-type-policy__check"><input type="checkbox" checked={draft.rewardEligible} onChange={e => setDraft({ ...draft, rewardEligible: e.target.checked })} />한달사용 리뷰도 BEST 보상·리뷰이벤트 대상에 포함</label>
   <p>보상 여부 변경에는 마케팅 권한이 필요합니다. 실제 지급은 별도 활성 정책과 선정 조건을 따르며, 리뷰 작성만으로 지급하지 않습니다.</p>
   <AdminField label="설정 근거" inputId="review-type-evidence"><textarea id="review-type-evidence" minLength={2} maxLength={1000} value={draft.evidence} onChange={e => setDraft({ ...draft, evidence: e.target.value })} required /></AdminField>
   <p>저장한 설정은 기존 주문을 포함한 신규 한달사용 리뷰 작성에 즉시 적용됩니다. 이미 작성한 리뷰의 수정 기한과 보상 자격은 작성 당시 값을 유지합니다. 공개된 일반·한달사용 리뷰는 모두 평점에 포함합니다.</p>
   <label className="admin-review-type-policy__check"><input type="checkbox" checked={draft.confirmed} onChange={e => setDraft({ ...draft, confirmed: e.target.checked })} required />작성 기간과 기존 주문 적용 범위, 보상 조건을 확인했습니다.</label>
  </fieldset><button type="submit" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={pending || !draft.confirmed}>{uncertain ? '같은 요청으로 저장 결과 확인' : '한달사용 리뷰 설정 저장'}</button></form> : null}
  {message ? <p role="status">{message}</p> : null}
 </div>;
}
