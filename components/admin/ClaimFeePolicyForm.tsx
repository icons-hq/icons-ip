'use client';
import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { readClaimFeePolicyAction, saveClaimFeePolicyAction } from '@/app/admin/claim-fee-policy-actions';
import type { ClaimFeePolicy } from '@/lib/orders/claim-fees';
import { useGoodsGroupSession } from './GoodsGroupOperation';
const draftOf = (p: ClaimFeePolicy) => ({ enabled: p.enabled, returnAmount: p.returnAmount?.toString() ?? '', exchangeAmount: p.exchangeAmount?.toString() ?? '', evidence: p.evidence, confirmed: false });
export function ClaimFeePolicyForm({ initial, actorId, sessionId }: { initial: ClaimFeePolicy; actorId: string; sessionId: string | null }) {
 const [policy, setPolicy] = useState(initial), [draft, setDraft] = useState(() => draftOf(initial)), [message, setMessage] = useState(''), [uncertain, setUncertain] = useState(false);
 const [pending, start] = useTransition(), session = useGoodsGroupSession(actorId, sessionId), busy = useRef(false), disabled = pending || session.blocked || uncertain;
 function save() {
  if (disabled || busy.current || !sessionId) return;
  if ([draft.returnAmount, draft.exchangeAmount].some(a => a !== '' && !/^[1-9][0-9]*$/.test(a))) { setMessage('기본 안내 금액은 1원 이상의 정수로 입력하거나 비워주세요.'); return; }
  busy.current = true;
  start(async () => { try { const result = await saveClaimFeePolicyAction({ ...draft, returnAmount: draft.returnAmount ? Number(draft.returnAmount) : null, exchangeAmount: draft.exchangeAmount ? Number(draft.exchangeAmount) : null }, policy.revision, crypto.randomUUID(), { actorId, sessionId });
    if (!session.current()) return;
    if ('policy' in result && result.policy) { setPolicy(result.policy); setDraft(draftOf(result.policy)); setMessage('배송비 청구 정책을 저장했습니다.'); }
    else { setUncertain(true); setMessage(result.error ?? '현재 저장본을 확인해주세요.'); }
   } catch { if (session.current()) { setUncertain(true); setMessage('저장 결과를 확인하지 못했습니다. 현재 정책을 다시 불러와주세요.'); } } finally { busy.current = false; } });
 }
 return <form className="claim-fees" onSubmit={e => { e.preventDefault(); save(); }}>
  <p><Link href="/admin/sales/claims/returns/fees">배송비 청구·입금·반환 목록</Link></p>
  <p>기본 꺼짐입니다. 켠 뒤에도 고객과 합의한 요청에만 담당자가 직접 청구합니다. 기본 안내 금액은 입력을 돕는 값이며 자동 청구되지 않습니다.</p>
  <p>입금 받을 계좌: {policy.accountReady ? '등록됨' : '미등록'} · <Link href="/admin/settings/store?section=bank_transfer">법인계좌 설정</Link></p>
  <fieldset disabled={disabled}><legend>반품·교환 배송비 청구</legend><label className="claim-fees__check"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />새 배송비 청구 사용</label>
   <label>반품 기본 안내 금액 (원, 선택)<input type="number" min={1} max={1000000} step={1} value={draft.returnAmount} onChange={e => setDraft({ ...draft, returnAmount: e.target.value })} /></label>
   <label>교환 기본 안내 금액 (원, 선택)<input type="number" min={1} max={1000000} step={1} value={draft.exchangeAmount} onChange={e => setDraft({ ...draft, exchangeAmount: e.target.value })} /></label>
   <label>정책 근거<textarea required minLength={2} maxLength={1000} rows={3} value={draft.evidence} onChange={e => setDraft({ ...draft, evidence: e.target.value })} /></label>
   <p>원 주문은 기존 전액 환불 절차를 따릅니다. 배송비 미입금만으로 반품·환불을 자동 차단하지 않습니다. 설정을 꺼도 기존 청구의 입금 확인·취소·반환은 처리할 수 있습니다.</p>
   <label className="claim-fees__check"><input type="checkbox" checked={draft.confirmed} onChange={e => setDraft({ ...draft, confirmed: e.target.checked })} />개별 고객 합의·계좌 확인·별도 수납 절차를 확인했습니다.</label>
  </fieldset><div className="claim-fees__actions"><button className="btn" type="submit" disabled={disabled || !draft.confirmed}>배송비 청구 정책 저장</button>
   <button className="btn btn-ghost" type="button" disabled={pending || session.blocked} onClick={() => start(async () => {
    try { const result = await readClaimFeePolicyAction(); if (!session.current()) return;
     if ('policy' in result && result.policy) { setPolicy(result.policy); setDraft(draftOf(result.policy)); setUncertain(false); setMessage('현재 정책을 불러왔습니다.'); } else setMessage(result.error ?? '조회하지 못했습니다.');
    } catch { if (session.current()) setMessage('현재 정책을 불러오지 못했습니다.'); }
   })}>현재 정책 다시 불러오기</button></div>{message ? <p role="status">{message}</p> : null}{session.blocked ? <p role="alert">로그인 상태가 바뀌었습니다. 다시 열어주세요.</p> : null}
 </form>;
}
