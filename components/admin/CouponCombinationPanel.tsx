'use client';
import { useEffect, useRef, useState } from 'react';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { readCouponCombinationPolicyAction, saveCouponCombinationPolicyAction } from '@/app/admin/coupon-combination-actions';
import type { AdminCouponCombinationPolicy } from '@/lib/coupon-combinations';
import '@/app/styles/admin-coupon-combinations.css';
const draftOf = (p: AdminCouponCombinationPolicy) => ({ stackingEnabled: p.stackingEnabled, maxGoodsCoupons: p.maxGoodsCoupons, shippingEnabled: p.shippingEnabled, evidence: '', confirmed: false });
export function CouponCombinationPanel({ accountId }: { accountId: string }) { return <details className="admin-coupon-combinations wc-admin-kit"><summary>쿠폰 중복 사용·배송비 할인 정책</summary><ClaimContactSession actorId={accountId} pendingMessage="로그인 상태를 확인하고 있습니다.">{(identity, scope) => <Panel identity={identity} scope={scope} />}</ClaimContactSession></details>; }
function Panel({ identity, scope }: { identity: ClaimContactIdentity; scope: ClaimContactScope }) {
 const [policy, setPolicy] = useState<AdminCouponCombinationPolicy | null>(null), [draft, setDraft] = useState<ReturnType<typeof draftOf> | null>(null), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState('');
 const alive = useRef(true), busy = useRef(false), sent = useRef<{ values: ReturnType<typeof draftOf>; revision: number; operation: string } | null>(null);
 useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 async function read() {
  if (busy.current || uncertain) return; const ticket = scope.capture(); if (!ticket) return; busy.current = true; setPending(true);
  try { const result = await readCouponCombinationPolicyAction(); if (!alive.current || !scope.canApply(ticket)) return;
   if (result.policy) { setPolicy(result.policy); setDraft(draftOf(result.policy)); setMessage('저장된 정책을 불러왔습니다.'); } else setMessage(result.error ?? '정책을 불러오지 못했습니다.');
  } finally { busy.current = false; if (alive.current) setPending(false); }
 }
 async function save() {
  if (busy.current || !draft || !policy || !draft.confirmed) return; const ticket = scope.capture(); if (!ticket) return;
  const request = sent.current ?? { values: draft, revision: policy.revision, operation: crypto.randomUUID() }; sent.current = request; busy.current = true; setPending(true);
  try { const result = await saveCouponCombinationPolicyAction(request.values, request.revision, request.operation, identity); if (!alive.current || !scope.canApply(ticket)) return;
   if (result.policy) { setPolicy(result.policy); setDraft(draftOf(result.policy)); sent.current = null; setUncertain(false); setMessage('정책을 저장하고 현재 값을 다시 확인했습니다.'); }
   else { setMessage(result.error ?? '저장 결과를 확인하지 못했습니다.'); setUncertain(uncertain || Boolean(result.uncertain)); if (!uncertain && !result.uncertain) sent.current = null; }
  } catch { if (alive.current && scope.canApply(ticket)) { setUncertain(true); setMessage('저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.'); } }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 return <div><p>기본값은 중복 사용·배송비 쿠폰 모두 사용 안 함입니다. 중복 사용은 선택한 모든 쿠폰이 허용한 경우에만 적용됩니다.</p>
  <button type="button" className="wc-admin-kit__button" disabled={pending || uncertain} onClick={() => { void read(); }}>현재 정책 불러오기</button>
  {draft && policy ? <form onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={pending || uncertain}><legend>새 주문에 적용할 쿠폰 정책</legend>
   <label><input type="checkbox" checked={draft.stackingEnabled} onChange={e => setDraft({ ...draft, stackingEnabled: e.target.checked })} />쿠폰 중복 사용 허용</label>
   <label>상품 쿠폰 최대 사용 수<select value={draft.maxGoodsCoupons} onChange={e => setDraft({ ...draft, maxGoodsCoupons: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}장</option>)}</select></label>
   <label><input type="checkbox" checked={draft.shippingEnabled} onChange={e => setDraft({ ...draft, shippingEnabled: e.target.checked })} />배송비 쿠폰 사용 허용 · 주문당 1장</label>
   <p>상품 쿠폰은 선택 순서대로 남은 상품 금액에 적용합니다. 배송비 쿠폰은 그다음 선결제 운송비에 적용하며 설치비·착불 운송비는 제외합니다. 최소 주문 금액은 복수구매 할인 후, 쿠폰 할인 전의 대상 상품 소계로 확인합니다.</p>
   <label>설정 근거<input value={draft.evidence} maxLength={1000} minLength={2} required onChange={e => setDraft({ ...draft, evidence: e.target.value })} /></label>
   <label><input type="checkbox" checked={draft.confirmed} required onChange={e => setDraft({ ...draft, confirmed: e.target.checked })} />중복 사용 조건과 할인 대상 금액을 확인했습니다.</label>
  </fieldset><button type="submit" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={pending || !draft.confirmed}>{uncertain ? '같은 요청으로 저장 결과 확인' : '쿠폰 정책 저장'}</button></form> : null}
  {message ? <p role="status">{message}</p> : null}
 </div>;
}
