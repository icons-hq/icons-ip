'use client';
import { useState, useTransition } from 'react';
import { readPurchaseConfirmationPolicyAction, savePurchaseConfirmationPolicyAction } from '@/app/admin/purchase-confirmation-actions';
import type { PurchaseConfirmationPolicy } from '@/lib/purchase-confirmation';
import { useGoodsGroupSession } from './GoodsGroupOperation';
import { AdminField } from './console/AdminKit';
import '@/app/styles/purchase-confirmation.css';
const draftOf = (p: PurchaseConfirmationPolicy) => ({ autoEnabled: p.autoEnabled, days: p.autoAfterDays?.toString() ?? '', extension: p.buyerExtensionDays?.toString() ?? '', evidence: p.evidence, acknowledged: false });
export function PurchaseConfirmationPolicyForm({ initial, actorId, sessionId }: { initial: PurchaseConfirmationPolicy; actorId: string; sessionId: string | null }) {
  const [policy, setPolicy] = useState(initial), [draft, setDraft] = useState(() => draftOf(initial)), [message, setMessage] = useState(''), [uncertain, setUncertain] = useState(false);
  const [pending, start] = useTransition(), session = useGoodsGroupSession(actorId, sessionId), disabled = pending || session.blocked || uncertain;
  function save() { if (disabled || !sessionId) return;
    if ([draft.days, draft.extension].some(v => v !== '' && !/^[1-9][0-9]*$/.test(v))) { setMessage('기간은 1일 이상의 정수로 입력해주세요.'); return; }
    start(async () => {
      const result = await savePurchaseConfirmationPolicyAction({ autoEnabled: draft.autoEnabled, autoAfterDays: draft.days ? Number(draft.days) : null,
        buyerExtensionDays: draft.extension ? Number(draft.extension) : null, evidence: draft.evidence, acknowledged: draft.acknowledged }, policy.revision, crypto.randomUUID(), { actorId, sessionId });
      if (!session.current()) return;
      if ('policy' in result && result.policy) { setPolicy(result.policy); setDraft(draftOf(result.policy)); setMessage('구매확정 정책을 저장했습니다.'); }
      else { setUncertain(true); setMessage(result.error ?? '현재 저장본을 확인해주세요.'); }
    });
  }
  return <form className="purchase-confirmation" onSubmit={e => { e.preventDefault(); save(); }}>
    <p>자동 구매확정은 기본 꺼짐입니다. 켜면 이미 배송완료된 주문도 배송완료일 기준으로 확정됩니다 — 기한이 없던 배송완료 주문에 배송완료일 + 설정 기간을 저장하므로, 그 날짜가 이미 지난 주문은 다음 자동 처리(매일 오전 3시)에 확정됩니다. 이미 기한을 받은 주문은 그때의 기간을 유지합니다. 자동 확정을 끄면 이전 정책이 적용된 주문의 자동 처리도 멈춥니다.</p>
    <fieldset disabled={disabled}><legend>자동 확정·구매자 연장</legend><label className="purchase-confirmation__ack"><input type="checkbox" checked={draft.autoEnabled} onChange={e => setDraft({ ...draft, autoEnabled: e.target.checked })} />자동 구매확정 사용</label>
      <div className="wc-admin-kit__form-grid"><AdminField label="배송완료 후 자동 확정까지 (일)" inputId="confirmation-auto-days"><input id="confirmation-auto-days" type="number" min="1" max="36500" step="1" value={draft.days} onChange={e => setDraft({ ...draft, days: e.target.value })} /></AdminField>
        <AdminField label="구매자 1회 연장 기간 (일, 비우면 연장 미제공)" inputId="confirmation-extension"><input id="confirmation-extension" type="number" min="1" max="36500" step="1" value={draft.extension} onChange={e => setDraft({ ...draft, extension: e.target.value })} /></AdminField></div>
      <AdminField label="정책 근거·운영 메모" inputId="confirmation-evidence"><textarea id="confirmation-evidence" maxLength={2000} rows={3} value={draft.evidence} onChange={e => setDraft({ ...draft, evidence: e.target.value })} /></AdminField>
      <p>모든 배송 건이 도착하고 진행 중인 클레임·보류가 없어야 확정합니다. 구매자 직접 확정은 자동 설정과 별개입니다. 반품·교환 기한은 배송일과 사유를 기준으로 계속 검사합니다.</p>
      <label className="purchase-confirmation__ack"><input type="checkbox" checked={draft.acknowledged} onChange={e => setDraft({ ...draft, acknowledged: e.target.checked })} />적용 시점·적립금 지급·반품/교환 자격을 확인했습니다.</label>
    </fieldset>
    <div className="purchase-confirmation__actions"><button type="submit" disabled={disabled || !draft.acknowledged}>구매확정 정책 저장</button><button type="button" disabled={pending || session.blocked} onClick={() => start(async () => {
      const result = await readPurchaseConfirmationPolicyAction(); if (!session.current()) return;
      if ('policy' in result && result.policy) { setPolicy(result.policy); setDraft(draftOf(result.policy)); setUncertain(false); setMessage('현재 저장본을 불러왔습니다.'); } else setMessage(result.error ?? '조회하지 못했습니다.');
    })}>현재 정책 다시 불러오기</button></div>{message ? <p role="status">{message}</p> : null}{session.blocked ? <p role="alert">로그인 상태가 바뀌었습니다. 다시 열어주세요.</p> : null}
  </form>;
}
