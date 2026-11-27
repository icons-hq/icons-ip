'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { adminConfirm, adminPrompt } from '@/lib/admin/confirm';
import { readPurchaseConfirmationAction, changePurchaseConfirmationAction } from '@/app/orders/purchase-confirmation-actions';
import { CONFIRMATION_EVENT_LABELS, type ConfirmationEventKind, type PurchaseConfirmation } from '@/lib/purchase-confirmation';
import { formatOrderDateTime } from '@/lib/orders';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';
import '@/app/styles/purchase-confirmation.css';

/*
 * 고객 주문 화면과 어드민 주문 상세가 함께 쓴다(`admin`). 고객에게 보이는 글자·동작은 그대로이고, 아래 어드민용 이름·확인창만 `admin`일 때 쓴다.
 * 어드민 낱말은 '거래확정'이다(lib/admin/vocabulary). 같은 일을 고객 화면은 '구매확정'이라 부른다.
 */
const ADMIN_EVENT_LABELS: Record<ConfirmationEventKind, string> = { ...CONFIRMATION_EVENT_LABELS, request: '거래확정 요청', hold: '거래확정 보류' };
const ADMIN_DONE_MESSAGES: Partial<Record<ConfirmationEventKind, string>> = {
  request: '구매자에게 거래확정 요청 알림을 보냈습니다.',
  hold: '거래확정을 보류했습니다. 보류 사유가 고객 주문 화면에 보입니다.',
  resume: '보류를 해제했습니다.',
};
const ADMIN_RELOAD_LABEL = '상태 다시 불러오기';
const ADMIN_BACK_LABEL = '돌아가기';

/** '확정 상태' 칸의 값. 고객 화면의 글자는 그대로 두고, 어드민은 어떤 이름이든 '거래확정'으로 시작해 같은 상태를 한 이름으로 읽게 한다. */
function confirmationState(value: PurchaseConfirmation, admin: boolean) {
  if (value.status === 'done') {
    if (admin) return `${value.confirmationKind === 'buyer' ? '거래확정(구매자 직접 확정)' : value.confirmationKind === 'automatic' ? '거래확정(자동 확정)' : '거래확정'} · ${value.confirmedAt ? formatOrderDateTime(value.confirmedAt) : '시각 기록 없음'}`;
    return `${value.confirmationKind === 'buyer' ? '구매자 직접 확정' : value.confirmationKind === 'automatic' ? '자동 확정' : '구매 확정'} ·${value.confirmedAt ? formatOrderDateTime(value.confirmedAt) : '시각 미기록'}`;
  }
  return value.status === 'canceled' ? '주문 취소' : value.held ? `보류 · ${value.holdReason}` : admin ? '확정 전' : '미확정';
}

export function PurchaseConfirmationPanel({ orderId, orderNumber, actorId, admin = false, claimOpen = false }: { orderId: string; /** 어드민 확인창이 어느 주문인지 말하는 번호. 고객 화면은 주지 않는다. */ orderNumber?: string; actorId: string; admin?: boolean; /** 진행 중인 취소·반품·교환이 있으면 자동 구매확정은 보류된다(DB 배치가 건너뜀) — 예정 시각을 말하지 않는다. */ claimOpen?: boolean }) {
  const [value, setValue] = useState<PurchaseConfirmation | null>(null), [identity, setIdentity] = useState<GoodsGroupIdentity | null>(null);
  const [message, setMessage] = useState(''), [blocked, setBlocked] = useState(false), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  useClaimPreviewBusy(pending); /* 목록 위 주문 상세 팝업(S36-075)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const [ack, setAck] = useState(false), alive = useRef(true), identityRef = useRef<GoodsGroupIdentity | null>(null), busy = useRef(false);
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
      }).catch(() => { if (active && identityRef.current === next) setMessage(admin ? `거래확정 상태를 불러오지 못했습니다. 잠시 뒤 [${ADMIN_RELOAD_LABEL}]를 눌러 주세요.` : '구매확정 상태를 불러오지 못했습니다. 다시 확인해주세요.'); });
    }).data.subscription;
    return () => { active = false; alive.current = false; subscription.unsubscribe(); };
  }, [actorId, orderId, admin]);
  const current = (id: GoodsGroupIdentity) => alive.current && identityRef.current === id;
  async function read() {
    if (!identity || busy.current) return; busy.current = true; setPending(true);
    try { const result = await readPurchaseConfirmationAction(orderId, admin); if (!current(identity)) return;
      if ('value' in result) { setValue(result.value); setUncertain(false); setMessage('현재 상태를 불러왔습니다.'); } else setMessage(result.error);
    } catch { if (current(identity)) setMessage(admin ? `상태를 불러오지 못했습니다. 잠시 뒤 [${ADMIN_RELOAD_LABEL}]를 다시 눌러 주세요.` : '현재 상태를 불러오지 못했습니다. 다시 확인해주세요.'); }
    finally { busy.current = false; if (current(identity)) setPending(false); }
  }
  async function act(kind: 'confirm' | 'extend' | 'request' | 'hold' | 'resume', note = '') {
    if (!value || !identity || blocked || uncertain || busy.current) return;
    busy.current = true; setPending(true); setMessage('');
    try {
      const result = await changePurchaseConfirmationAction(orderId, kind, note, value.revision, crypto.randomUUID(), identity, admin, ack);
      if (!current(identity)) return;
      if ('value' in result) { setValue(result.value); setAck(false); setMessage(admin ? ADMIN_DONE_MESSAGES[kind] ?? '처리했습니다.' : `${CONFIRMATION_EVENT_LABELS[kind]} 처리를 확인했습니다.`); router.refresh(); }
      else { setUncertain(true); setMessage(result.error); }
    } catch { if (current(identity)) { setUncertain(true); setMessage(admin ? `처리됐는지 확인하지 못했습니다. [${ADMIN_RELOAD_LABEL}]를 눌러 주세요.` : '결과가 불명확합니다. 현재 상태를 다시 불러와주세요.'); } }
    finally { busy.current = false; if (current(identity)) setPending(false); }
  }
  /* 어드민의 세 버튼은 고객 알림·보류·보류 해제라 누르기 전에 무엇이 일어나는지 말한다. 보류 사유는 고객 주문 화면에 보이므로 그 자리에서 받는다. */
  async function adminAct(kind: 'request' | 'hold' | 'resume') {
    if (!value || pending || busy.current) return;
    const target = orderNumber ? `주문 ${orderNumber}` : '이 주문';
    if (kind === 'hold') {
      const reason = await adminPrompt({
        title: '거래확정 보류', message: `${target}의 거래확정을 보류합니다. 보류하면 자동 확정이 멈추고 구매자도 직접 거래확정할 수 없습니다. 아래 사유는 고객 주문 화면에 그대로 보입니다.`,
        confirmLabel: '보류', cancelLabel: ADMIN_BACK_LABEL,
        input: { label: '고객에게 보일 보류 사유 (필수)', placeholder: '예: 상품 사진 확인이 끝나면 거래확정할 수 있습니다.', minLength: 1, maxLength: 500 },
      });
      if (reason !== null) await act('hold', reason);
      return;
    }
    const due = value.automaticActive && value.autoDueAt ? ` 자동 확정 예정 시각(${formatOrderDateTime(value.autoDueAt)})이 이미 지났으면 다음 자동 처리에서 바로 거래확정되고, 정책에 따라 적립금이 지급됩니다.` : '';
    const ok = await adminConfirm(kind === 'request'
      ? { title: '거래확정 요청 알림', message: `${target}의 구매자에게 거래확정 요청 알림을 보냅니다. 한 주문에 한 번만 보낼 수 있습니다.`, confirmLabel: '알림 보내기', cancelLabel: ADMIN_BACK_LABEL }
      : { title: '보류 해제', message: `${target}의 보류를 풉니다. 구매자가 직접 거래확정할 수 있게 됩니다.${due}`, confirmLabel: '보류 해제', cancelLabel: ADMIN_BACK_LABEL });
    if (ok) await act(kind);
  }
  const disabled = pending || blocked || uncertain || !identity;
  if (blocked) return <p role="alert">{admin ? '로그인이 바뀌었습니다. 주문 화면을 다시 열어 주세요.' : '로그인 계정 또는 세션이 바뀌었습니다. 주문 화면을 다시 열어주세요.'}</p>;
  return <section className="purchase-confirmation" aria-label={admin ? '거래확정' : '구매확정'}>
    <h3>{admin ? '거래확정' : '구매확정'}</h3>
    <p>{admin ? '거래확정되면 주문 당시 정책에 따라 적립금이 지급됩니다.' : '구매확정 시 주문 당시 정책에 따라 적립금을 지급합니다. 구매확정 이후에도 반품·교환은 별도 신청 자격과 기한을 적용합니다.'}</p>
    {!value ? <p role="status">{message || (admin ? '거래확정 상태를 확인하고 있습니다.' : '구매확정 상태를 확인하고 있습니다.')}</p> : <>
      <dl><div><dt>{admin ? '거래확정 상태' : '확정 상태'}</dt><dd>{confirmationState(value, admin)}</dd></div>
        {value.status === 'delivered' && !claimOpen ? <div><dt>자동 확정</dt><dd>{value.automaticActive && value.autoDueAt ? `${formatOrderDateTime(value.autoDueAt)} 예정${value.held ? ' · 보류 해제 전까지 중지' : ''}` : admin ? '자동 확정 안 함' : '자동 확정 꺼짐 또는 적용 대상 아님'}</dd></div> : null}
        {value.requestedAt ? <div><dt>{admin ? '거래확정 요청' : '구매확정 요청'}</dt><dd>{formatOrderDateTime(value.requestedAt)} · {admin ? '앱 알림' : '인앱 알림'}</dd></div> : null}</dl>
      {admin && value.status === 'delivered' ? <div className="purchase-confirmation__actions">
        {value.held ? <button type="button" disabled={disabled} onClick={() => void adminAct('resume')}>보류 해제</button> : <>
          <button type="button" disabled={disabled || !value.canConfirm || !!value.requestedAt} onClick={() => void adminAct('request')}>거래확정 요청 알림</button>
          <button type="button" disabled={disabled || !value.canConfirm} onClick={() => void adminAct('hold')}>거래확정 보류</button></>}
      </div> : !admin && value.status === 'delivered' ? <>
        <label className="purchase-confirmation__ack"><input type="checkbox" checked={ack} disabled={disabled} onChange={e => setAck(e.target.checked)} />받은 상품과 구매확정·기간 연장 내용을 확인했습니다.</label>
        <div className="purchase-confirmation__actions"><button type="button" disabled={disabled || !ack || !value.canConfirm} onClick={() => void act('confirm')}>구매확정</button>
          {value.canExtend ? <button type="button" disabled={disabled || !ack} onClick={() => void act('extend')}>구매확정 {value.extensionDays}일 연장 (1회)</button> : null}</div>
        {value.extensionUsed ? <p>이 주문의 구매확정 기간을 한 번 연장했습니다.</p> : null}
      </> : null}
      <details><summary>{admin ? '거래확정 이력' : '구매확정 이력'} ({value.history.length})</summary>{value.history.length ? <ol>{value.history.map(e => <li key={e.id}><time dateTime={e.at}>{formatOrderDateTime(e.at)}</time> · {(admin ? ADMIN_EVENT_LABELS : CONFIRMATION_EVENT_LABELS)[e.kind]}{e.note ? ` · ${e.note}` : ''}</li>)}</ol> : <p>기록된 이력이 없습니다.</p>}</details>
      {message ? <p role="status">{message}</p> : null}
    </>}
    <button type="button" disabled={pending || !identity} onClick={() => void read()}>{admin ? ADMIN_RELOAD_LABEL : '구매확정 상태 다시 불러오기'}</button>
  </section>;
}
