'use client';
import { useEffect, useRef, useState } from 'react';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { readGoodsProductionAction, saveGoodsProductionAction } from '@/app/admin/production-actions';
import { type GoodsProductionPolicy } from '@/lib/order-production';
import { AdminField } from './console/AdminKit';
import '@/app/styles/admin-order-production.css';
const draftOf = (p: GoodsProductionPolicy) => ({ enabled: p.enabled, leadDays: p.leadDays?.toString() ?? '', dayBasis: p.dayBasis, closedDates: p.closedDates.join('\n'), publicNote: p.publicNote, evidence: p.evidence, confirmed: false });
type Draft = ReturnType<typeof draftOf>;
/** showDisabledReason=false면 잠금 이유 문장을 본문에 그리지 않는다(상품 편집기가 패널 위에 공통 잠금 안내를 보일 때). 잠금은 disabledReason이 맡는다. */
type Props = { goodId: string; accountId: string; disabledReason?: string; showDisabledReason?: boolean };
export function GoodsProductionPanel(props: Props) { return <ClaimContactSession actorId={props.accountId} pendingMessage="로그인 상태를 확인하고 있습니다.">{(identity, scope) => <Panel {...props} identity={identity} scope={scope} />}</ClaimContactSession>; }
function Panel({ goodId, disabledReason, showDisabledReason = true, identity, scope }: Props & { identity: ClaimContactIdentity; scope: ClaimContactScope }) {
 const [policy, setPolicy] = useState<GoodsProductionPolicy | null>(null), [draft, setDraft] = useState<Draft | null>(null), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState('');
 const alive = useRef(true), busy = useRef(false), dispatched = useRef<{ values: unknown; revision: number; operation: string } | null>(null);
 useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 async function read() { if (busy.current || uncertain) return; const ticket = scope.capture(); if (!ticket) return; busy.current = true; setPending(true);
  try { const result = await readGoodsProductionAction(goodId); if (!alive.current || !scope.canApply(ticket)) return;
   if ('policy' in result && result.policy) { setPolicy(result.policy); setDraft(draftOf(result.policy)); setMessage('현재 주문제작 설정을 불러왔습니다.'); } else setMessage(result.error ?? '설정을 읽지 못했습니다.');
  } finally { busy.current = false; if (alive.current) setPending(false); }
 }
 async function save() { if (busy.current || disabledReason || !draft || !policy || !draft.confirmed) return; const ticket = scope.capture(); if (!ticket) return;
  if (draft.leadDays && !/^[1-9][0-9]*$/.test(draft.leadDays)) { setMessage('발송 예정 기간은 1~365일의 정수로 입력해주세요.'); return; }
  const request = dispatched.current ?? { values: { ...draft, leadDays: draft.leadDays ? Number(draft.leadDays) : null, closedDates: draft.dayBasis === 'calendar' ? [] : draft.closedDates.split(/[\s,]+/).map(d => d.trim()).filter(Boolean) }, revision: policy.revision, operation: crypto.randomUUID() };
  dispatched.current = request; busy.current = true; setPending(true);
  try { const result = await saveGoodsProductionAction(goodId, request.values, request.revision, request.operation, identity); if (!alive.current || !scope.canApply(ticket)) return;
   if ('policy' in result && result.policy) { setPolicy(result.policy); setDraft(draftOf(result.policy)); dispatched.current = null; setUncertain(false); setMessage('주문제작 설정을 저장했습니다. 새 주문부터 적용됩니다.'); }
   else { setMessage(result.error ?? '결과를 확인하지 못했습니다.'); setUncertain(uncertain || Boolean(result.uncertain)); if (!uncertain && !result.uncertain) dispatched.current = null; }
  } catch { if (alive.current && scope.canApply(ticket)) { setUncertain(true); setMessage('저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.'); } }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 return <div className="admin-order-production"><p>주문 후 제작하는 상품의 발송 예정 기간을 설정합니다. 실제 제작 시작·완료는 결제된 주문 상세에서 기록하며, 제작 완료 전에는 출고지시와 발송을 처리할 수 없습니다.</p>
  <button type="button" className="wc-admin-kit__button" disabled={pending || uncertain} onClick={() => { void read(); }}>현재 주문제작 설정 불러오기</button>
  {draft ? <form onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={pending || uncertain || Boolean(disabledReason)}><legend>주문 후 제작</legend>
   <label className="admin-order-production__check"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />주문제작 사용</label>
   <div className="wc-admin-kit__form-grid"><AdminField label="결제 확인 후 발송 예정 기간 (일)" inputId="production-lead"><input id="production-lead" type="number" min="1" max="365" required={draft.enabled} value={draft.leadDays} onChange={e => setDraft({ ...draft, leadDays: e.target.value })} /></AdminField>
    <AdminField label="기간 계산 기준" inputId="production-basis"><select id="production-basis" value={draft.dayBasis} onChange={e => setDraft({ ...draft, dayBasis: e.target.value as Draft['dayBasis'] })}><option value="calendar">달력일 · 주말 포함</option><option value="business">영업일 · 토·일 및 설정 휴무일 제외</option></select></AdminField></div>
   {draft.dayBasis === 'business' ? <AdminField label="휴무일 (YYYY-MM-DD, 한 줄에 하나)" inputId="production-closed"><textarea id="production-closed" rows={4} value={draft.closedDates} onChange={e => setDraft({ ...draft, closedDates: e.target.value })} /><small>공휴일을 자동 조회하지 않습니다. 발송하지 않는 공휴일·휴무일을 직접 등록해주세요.</small></AdminField> : null}
   <AdminField label="고객에게 표시할 제작 안내" inputId="production-public"><input id="production-public" maxLength={1000} value={draft.publicNote} onChange={e => setDraft({ ...draft, publicNote: e.target.value })} /></AdminField>
   <AdminField label="설정 근거 (관리자만 표시)" inputId="production-evidence"><input id="production-evidence" minLength={2} maxLength={1000} required value={draft.evidence} onChange={e => setDraft({ ...draft, evidence: e.target.value })} /></AdminField>
   <p>결제 확인 당일은 계산에서 제외하고 마지막 날 한국 시간 자정 전까지를 발송 예정 기한으로 표시합니다. 기존 주문의 기간·휴무일은 바뀌지 않습니다. 제작 시작 후 취소도 접수하며 담당자가 검토합니다. 예약판매와 동시에 적용할 수 없습니다.</p>
   <label className="admin-order-production__check"><input type="checkbox" checked={draft.confirmed} onChange={e => setDraft({ ...draft, confirmed: e.target.checked })} required />발송 예정 기간·계산 기준·취소 검토 절차를 확인했습니다.</label>
  </fieldset><button type="submit" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={pending || !draft.confirmed || Boolean(disabledReason)}>{uncertain ? '같은 요청으로 저장 결과 확인' : '주문제작 설정 저장'}</button></form> : null}
  {showDisabledReason && disabledReason ? <p role="status">{disabledReason}</p> : null}{message ? <p role="status">{message}</p> : null}
 </div>;
}
