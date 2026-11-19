'use client';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { readClaimFeePolicyAction, saveClaimFeePolicyAction } from '@/app/admin/claim-fee-policy-actions';
import type { ClaimFeePolicy } from '@/lib/orders/claim-fees';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { useGoodsGroupSession } from './GoodsGroupOperation';
/* 템플릿 룩(ADR-0028). 고객 화면과 같이 쓰는 claim-fees.css 클래스는 쓰지 않는다 — 그 요소 규칙이 kit 입력을 덮는다. */
const LINK = 'underline underline-offset-4';
const CHECK = 'flex items-start gap-2 leading-relaxed';
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
    else { setUncertain(true); setMessage(result.error ?? '저장됐는지 확인하지 못했습니다. [현재 정책 다시 불러오기]로 저장된 내용을 확인해주세요.'); }
   } catch { if (session.current()) { setUncertain(true); setMessage('저장됐는지 확인하지 못했습니다. [현재 정책 다시 불러오기]를 눌러 저장된 내용을 확인해주세요.'); } } finally { busy.current = false; } });
 }
 return <form className="flex min-w-0 flex-col gap-4 text-sm" data-claim-fee-policy="" onSubmit={e => { e.preventDefault(); save(); }}>
  <p><Link className={LINK} href="/admin/sales/claims/returns/fees">배송비 청구·입금·반환 목록</Link></p>
  <p className="text-muted-foreground">처음에는 꺼져 있습니다. 켜도 자동으로 청구되지 않고, 고객과 합의한 요청에만 담당자가 요청 상세에서 직접 청구합니다. 기본 안내 금액은 청구할 때 금액 칸에 미리 채워지는 값입니다.</p>
  <p className="flex flex-wrap items-center gap-2">입금 받을 계좌 <AdminStatusBadge tone={policy.accountReady ? 'success' : 'warning'}>{policy.accountReady ? '등록됨' : '미등록'}</AdminStatusBadge> <Link className={LINK} href="/admin/settings/store?section=bank_transfer">법인계좌 설정</Link></p>
  <fieldset className="m-0 flex min-w-0 flex-col gap-4 rounded-lg border p-4" disabled={disabled}><legend className="float-left w-full p-0 font-medium">반품·교환 배송비 청구</legend>
   <label className={CHECK}><input className="mt-0.5" type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} /><span>새 배송비 청구 사용</span></label>
   <div className="grid gap-4 sm:grid-cols-2">
    <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor="claim-fee-policy-return">반품 기본 안내 금액 (원, 선택)</Label><Input className="tabular-nums" id="claim-fee-policy-return" type="number" min={1} max={1000000} step={1} value={draft.returnAmount} onChange={e => setDraft({ ...draft, returnAmount: e.target.value })} /></div>
    <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor="claim-fee-policy-exchange">교환 기본 안내 금액 (원, 선택)</Label><Input className="tabular-nums" id="claim-fee-policy-exchange" type="number" min={1} max={1000000} step={1} value={draft.exchangeAmount} onChange={e => setDraft({ ...draft, exchangeAmount: e.target.value })} /></div>
   </div>
   <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor="claim-fee-policy-evidence">정책 근거</Label><Textarea id="claim-fee-policy-evidence" required minLength={2} maxLength={1000} rows={3} value={draft.evidence} onChange={e => setDraft({ ...draft, evidence: e.target.value })} /></div>
   <p className="text-muted-foreground">주문 환불은 이 청구와 상관없이 원래 환불 절차대로 진행합니다. 고객이 배송비를 입금하지 않았다는 이유만으로 반품·환불이 자동으로 막히지 않습니다. 설정을 꺼도 이미 만든 청구의 입금 확인·취소·반환은 처리할 수 있습니다.</p>
   <label className={CHECK}><input className="mt-0.5" type="checkbox" checked={draft.confirmed} onChange={e => setDraft({ ...draft, confirmed: e.target.checked })} /><span>개별 고객 합의·계좌 확인·별도 수납 절차를 확인했습니다.</span></label>
  </fieldset><div className="flex flex-wrap items-center gap-2"><Button type="submit" disabled={disabled || !draft.confirmed}>배송비 청구 정책 저장</Button>
   <Button type="button" variant="outline" disabled={pending || session.blocked} onClick={() => start(async () => {
    try { const result = await readClaimFeePolicyAction(); if (!session.current()) return;
     if ('policy' in result && result.policy) { setPolicy(result.policy); setDraft(draftOf(result.policy)); setUncertain(false); setMessage('현재 정책을 불러왔습니다.'); } else setMessage(result.error ?? '현재 정책을 불러오지 못했습니다. 잠시 뒤 다시 눌러주세요.');
    } catch { if (session.current()) setMessage('현재 정책을 불러오지 못했습니다. 잠시 뒤 다시 눌러주세요.'); }
   })}>현재 정책 다시 불러오기</Button></div>{message ? <p className="text-muted-foreground" role="status">{message}</p> : null}{session.blocked ? <p className="text-destructive" role="alert">로그인 상태가 바뀌었습니다. 새로고침해 이 화면을 다시 열어주세요.</p> : null}
 </form>;
}
