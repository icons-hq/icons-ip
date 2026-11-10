'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { readPurchaseConfirmationAction, changePurchaseConfirmationAction } from '@/app/orders/purchase-confirmation-actions';
import { CONFIRMATION_EVENT_LABELS, type PurchaseConfirmation } from '@/lib/purchase-confirmation';
import { formatOrderDateTime } from '@/lib/orders';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';
import '@/app/styles/purchase-confirmation.css';
export function PurchaseConfirmationPanel({ orderId, actorId, admin = false }: { orderId: string; actorId: string; admin?: boolean }) {
  const [value, setValue] = useState<PurchaseConfirmation | null>(null), [identity, setIdentity] = useState<GoodsGroupIdentity | null>(null);
  const [message, setMessage] = useState(''), [blocked, setBlocked] = useState(false), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [note, setNote] = useState(''), [ack, setAck] = useState(false), alive = useRef(true), identityRef = useRef<GoodsGroupIdentity | null>(null), busy = useRef(false);
  const router = useRouter();
  useEffect(() => {
    let active = true; alive.current = true; identityRef.current = null;
    const subscription = createClient().auth.onAuthStateChange((_event, session) => {
      const sessionId = session ? inquiryDraftSessionId(session.access_token) : null;
      if (!active) return;
      if (session?.user.id !== actorId || !sessionId || identityRef.current && identityRef.current.sessionId !== sessionId) {
        identityRef.current = null; setIdentity(null); setValue(null); setBlocked(true); return;
      }
      if (identityRef.current) return;
      const next = { actorId, sessionId }; identityRef.current = next; setIdentity(next);
      void readPurchaseConfirmationAction(orderId, admin).then(result => {
        if (!active || identityRef.current !== next) return;
        if ('value' in result) setValue(result.value); else setMessage(result.error);
      }).catch(() => { if (active && identityRef.current === next) setMessage('구매확정 상태를 불러오지 못했습니다. 다시 확인해주세요.'); });
    }).data.subscription;
    return () => { active = false; alive.current = false; subscription.unsubscribe(); };
  }, [actorId, orderId, admin]);
  const current = (id: GoodsGroupIdentity) => alive.current && identityRef.current === id;
  async function read() {
    if (!identity || busy.current) return; busy.current = true; setPending(true);
    try { const result = await readPurchaseConfirmationAction(orderId, admin); if (!current(identity)) return;
      if ('value' in result) { setValue(result.value); setUncertain(false); setMessage('현재 상태를 불러왔습니다.'); } else setMessage(result.error);
    } catch { if (current(identity)) setMessage('현재 상태를 불러오지 못했습니다. 다시 확인해주세요.'); }
    finally { busy.current = false; if (current(identity)) setPending(false); }
  }
  async function act(kind: 'confirm' | 'extend' | 'request' | 'hold' | 'resume') {
    if (!value || !identity || blocked || uncertain || busy.current) return;
    busy.current = true; setPending(true); setMessage('');
    try {
      const result = await changePurchaseConfirmationAction(orderId, kind, note, value.revision, crypto.randomUUID(), identity, admin, ack);
      if (!current(identity)) return;
      if ('value' in result) { setValue(result.value); setAck(false); setNote(''); setMessage(`${CONFIRMATION_EVENT_LABELS[kind]} 처리를 확인했습니다.`); router.refresh(); }
      else { setUncertain(true); setMessage(result.error); }
    } catch { if (current(identity)) { setUncertain(true); setMessage('결과가 불명확합니다. 현재 상태를 다시 불러와주세요.'); } }
    finally { busy.current = false; if (current(identity)) setPending(false); }
  }
  const disabled = pending || blocked || uncertain || !identity;
  if (blocked) return <p role="alert">로그인 계정 또는 세션이 바뀌었습니다. 주문 화면을 다시 열어주세요.</p>;
  return <section className="purchase-confirmation" aria-label="구매확정">
    <h3>구매확정</h3>
    <p>구매확정 시 주문 당시 정책에 따라 적립금을 지급합니다. 구매확정 이후에도 반품·교환은 별도 신청 자격과 기한을 적용합니다.</p>
    {!value ? <p role="status">{message || '구매확정 상태를 확인하고 있습니다.'}</p> : <>
      <dl><div><dt>확정 상태</dt><dd>{value.status === 'done' ? `${value.confirmationKind === 'buyer' ? '구매자 직접 확정' : value.confirmationKind === 'automatic' ? '자동 확정' : '거래확정'} · ${value.confirmedAt ? formatOrderDateTime(value.confirmedAt) : '시각 미기록'}` : value.status === 'canceled' ? '주문 취소' : value.held ? `보류 · ${value.holdReason}` : '미확정'}</dd></div>
        {value.status === 'delivered' ? <div><dt>자동 확정</dt><dd>{value.automaticActive && value.autoDueAt ? `${formatOrderDateTime(value.autoDueAt)} 예정${value.held ? ' · 보류 해제 전까지 중지' : ''}` : '자동 확정 꺼짐 또는 적용 대상 아님'}</dd></div> : null}
        {value.requestedAt ? <div><dt>구매확정 요청</dt><dd>{formatOrderDateTime(value.requestedAt)} · 인앱 알림</dd></div> : null}</dl>
      {admin && value.status === 'delivered' ? <>
        <label>고객에게 표시할 보류 사유<textarea value={note} onChange={e => setNote(e.target.value)} disabled={disabled} maxLength={500} rows={2} /></label>
        <div className="purchase-confirmation__actions"><button type="button" disabled={disabled || !value.canConfirm || !!value.requestedAt} onClick={() => void act('request')}>구매확정 요청 알림</button>
          <button type="button" disabled={disabled || !value.canConfirm || !note.trim()} onClick={() => void act('hold')}>구매확정 보류</button>
          <button type="button" disabled={disabled || !value.held} onClick={() => void act('resume')}>보류 해제</button></div>
        {value.held && value.autoDueAt ? <p>예정 시각이 지난 보류를 해제하면 다음 자동 처리에서 확정될 수 있습니다.</p> : null}
      </> : !admin && value.status === 'delivered' ? <>
        <label className="purchase-confirmation__ack"><input type="checkbox" checked={ack} disabled={disabled} onChange={e => setAck(e.target.checked)} />받은 굿즈와 구매확정·기간 연장 내용을 확인했습니다.</label>
        <div className="purchase-confirmation__actions"><button type="button" disabled={disabled || !ack || !value.canConfirm} onClick={() => void act('confirm')}>구매확정</button>
          {value.canExtend ? <button type="button" disabled={disabled || !ack} onClick={() => void act('extend')}>구매확정 {value.extensionDays}일 연장 (1회)</button> : null}</div>
        {value.extensionUsed ? <p>이 주문의 구매확정 기간을 한 번 연장했습니다.</p> : null}
      </> : null}
      <details><summary>구매확정 이력 ({value.history.length})</summary>{value.history.length ? <ol>{value.history.map(e => <li key={e.id}><time dateTime={e.at}>{formatOrderDateTime(e.at)}</time> · {CONFIRMATION_EVENT_LABELS[e.kind]}{e.note ? ` · ${e.note}` : ''}</li>)}</ol> : <p>기록된 이력이 없습니다.</p>}</details>
      {message ? <p role="status">{message}</p> : null}
    </>}
    <button type="button" disabled={pending || !identity} onClick={() => void read()}>구매확정 상태 다시 불러오기</button>
  </section>;
}
