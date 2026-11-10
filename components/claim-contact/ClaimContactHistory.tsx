'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchAdminClaimContactHistory, fetchMyClaimContactHistory } from '@/lib/claim-contact/client';
import type { Address, ChangedField, HistoryEntry, HistoryResponse, TargetView } from '@/lib/claim-contact/contracts';
import { formatOrderDateTime } from '@/lib/orders';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from './ClaimContactSession';

const FIELD_LABELS: Record<ChangedField, string> = { recipientName: '수령인', phone: '연락처', address2: '상세주소', postalCode: '우편번호', address1: '기본 주소' };
const targetLabel = (target: 'collection' | 'reshipment', operator: boolean) => target === 'collection' ? '수거 연락처' : `교환 ${operator ? '상품' : '굿즈'} 수령 연락처`;
function unavailableCopy(value: Pick<TargetView, 'piiState' | 'unavailableReason'>): string {
  if (value.piiState === 'purged') return '연락처 정보가 삭제되어 변경 사실만 확인할 수 있습니다.';
  if (value.piiState === 'restricted') return '이 계정에는 연락처가 공개되지 않습니다.';
  if (value.piiState === 'not_applicable') return '해당 연락처가 없습니다.';
  if (value.unavailableReason === 'retention_due') return '보관기간이 지나 연락처를 표시하지 않습니다.';
  if (value.unavailableReason === 'crypto_unavailable') return '연락처 정보를 안전하게 불러오지 못했습니다.';
  return '확인할 수 있는 연락처 정보가 없습니다.';
}
function AddressView({ value }: { value: Address }) {
  return <address data-private="true" style={{ fontStyle: 'normal', overflowWrap: 'anywhere' }}>
    <span>{value.recipientName} · {value.phone}</span><br />
    <span>({value.postalCode}) {value.address1}</span>{value.address2 ? <><br /><span>{value.address2}</span></> : null}
  </address>;
}
function CurrentTarget({ value, operator }: { value: TargetView; operator: boolean }) {
  return <div>
    <h4 style={{ margin: '0 0 6px' }}>{targetLabel(value.target, operator)}</h4>
    {value.address ? <>
      <p style={{ margin: '0 0 6px' }}>{value.referenceOnly ? '원주문 배송정보 · 참고용' : value.sourceKind === 'seller_intake' ? '판매자 접수 시 확인한 정보' : '정정된 연락처'}</p>
      <AddressView value={value.address} />
    </> : <p>{unavailableCopy(value)}</p>}
  </div>;
}
function HistoryRow({ value, operator }: { value: HistoryEntry; operator: boolean }) {
  return <li style={{ borderTop: '1px solid var(--wc-hairline)', padding: '16px 0' }}>
    <p style={{ margin: '0 0 8px' }}><time dateTime={value.recordedAt}>{formatOrderDateTime(value.recordedAt)}</time> · {targetLabel(value.target, operator)} 변경</p>
    <p>변경 항목: {value.changedFields.map(field => FIELD_LABELS[field]).join(' · ')}</p>
    {value.piiState === 'available' && value.before && value.after ? <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 20 }}>
      <div><h5 style={{ margin: '0 0 6px' }}>변경 전</h5><AddressView value={value.before} /></div>
      <div><h5 style={{ margin: '0 0 6px' }}>변경 후</h5><AddressView value={value.after} /></div>
    </div> : <p>{unavailableCopy(value)}</p>}
    {operator && value.agreement ? <p data-private="true" style={{ overflowWrap: 'anywhere' }}>고객 합의 기록: {value.agreement}</p> : null}
  </li>;
}

function mergePage(previous: HistoryResponse | null, next: HistoryResponse): HistoryResponse {
  if (!previous) return next;
  const entries = new Map(previous.entries.map(entry => [entry.operationId, entry]));
  next.entries.forEach(entry => entries.set(entry.operationId, entry));
  // Once the latest read hides a target, previously loaded pages must not keep its PII visible.
  const redacted = [...entries.values()].map(entry => {
    if (!next.piiAccess || next.viewerKind === 'gift_sender') return { ...entry, piiState: 'restricted' as const, unavailableReason: null, before: null, after: null, agreement: null, actorId: null };
    const current = next.current[entry.target];
    if (current.piiState === 'available' || current.piiState === 'not_applicable') return entry;
    return { ...entry, piiState: current.piiState, unavailableReason: current.unavailableReason, before: null, after: null, agreement: null };
  });
  return { ...next, entries: redacted };
}

function HistoryPanel({ identity, scope, orderId, claimId, operator }: {
  identity: ClaimContactIdentity; scope: ClaimContactScope; orderId: string; claimId: string; operator: boolean;
}) {
  const [open, setOpen] = useState(false), [view, setView] = useState<HistoryResponse | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), busy = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const regionId = `claim-contact-history-${claimId}`;

  useEffect(() => {
    alive.current = true;
    const hide = () => {
      if (document.visibilityState === 'visible') return;
      generation.current++; controller.current?.abort(); controller.current = null; busy.current = false;
      setView(null); setOpen(false); setPending(false); setError('');
    };
    document.addEventListener('visibilitychange', hide);
    return () => { alive.current = false; controller.current?.abort(); controller.current = null; document.removeEventListener('visibilitychange', hide); };
  }, []);
  function close() {
    generation.current++; controller.current?.abort(); controller.current = null; busy.current = false;
    setView(null); setOpen(false); setPending(false); setError('');
  }
  async function load(more: boolean) {
    if (busy.current || document.visibilityState !== 'visible') return;
    const ticket = scope.capture(), cursor = more ? view?.nextCursor : null;
    if (!ticket || more && !cursor) return;
    const sequence = ++generation.current, requestId = crypto.randomUUID(), abort = new AbortController();
    controller.current = abort; busy.current = true; setPending(true); setOpen(true); setError('');
    if (!more) setView(null);
    try {
      const request = { requestId, orderId, claimId, limit: 20, cursor: cursor ?? null };
      const result = await (operator ? fetchAdminClaimContactHistory : fetchMyClaimContactHistory)(request, { expectedIdentity: identity, signal: abort.signal });
      if (!alive.current || sequence !== generation.current || !scope.canApply(ticket) || document.visibilityState !== 'visible') return;
      if ('code' in result) {
        if (result.authChanged) { scope.authenticate(null, null); return; }
        setError(result.message); return;
      }
      if (result.requestId !== requestId || result.viewerId !== identity.actorId || result.sessionId !== identity.sessionId
        || result.orderId !== orderId || result.claimId !== claimId) { setError('현재 요청과 다른 이력입니다. 닫은 뒤 다시 확인해주세요.'); return; }
      if (more && cursor && result.nextCursor?.operationId === cursor.operationId && result.nextCursor.recordedAt === cursor.recordedAt) {
        setError('이력 조회 위치가 바뀌었습니다. 닫은 뒤 다시 확인해주세요.'); return;
      }
      setView(previous => mergePage(more ? previous : null, result));
    } catch {
      if (alive.current && sequence === generation.current && scope.canApply(ticket)) setError('변경 이력을 확인하지 못했습니다. 다시 조회해주세요.');
    } finally {
      if (alive.current && sequence === generation.current && scope.canApply(ticket)) { busy.current = false; controller.current = null; setPending(false); }
    }
  }
  const internal = operator && view?.viewerKind === 'operator';
  return <section aria-label="반품·교환 연락처 변경 이력" className="col" style={{ alignItems: 'stretch', gap: 12 }}>
    <h3 style={{ margin: 0 }}>반품·교환 연락처</h3>
    {!open ? <button className="btn btn-sm btn-ghost" type="button" aria-expanded={false} aria-controls={regionId} onClick={() => { void load(false); }}>연락처 변경 이력 확인</button>
      : <div id={regionId} className="col" style={{ alignItems: 'stretch', gap: 16 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn-sm btn-ghost" type="button" onClick={close}>연락처 이력 닫기</button>
          <button className="btn btn-sm btn-ghost" type="button" disabled={pending} onClick={() => { void load(false); }}>최신 이력 다시 확인</button>
        </div>
        <p style={{ margin: 0 }}>연락처는 이 화면에서만 표시되며, 다른 탭으로 이동하거나 닫으면 지워집니다.</p>
        {view ? <>
          {view.viewerKind === 'gift_sender' ? <p>선물을 받는 분의 연락처는 보낸 분에게 공개되지 않습니다. 변경 일시와 항목만 확인할 수 있습니다.</p> : null}
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 24 }}>
            <CurrentTarget value={view.current.collection} operator={operator} />
            <CurrentTarget value={view.current.reshipment} operator={operator} />
          </div>
          <div><h4 style={{ margin: '0 0 6px' }}>재출고 확정 시 확인한 수령 연락처</h4>
            {view.reshipmentDestination.source === 'legacy_unconfirmed' ? <p>기존 재출고 기록에는 수령 연락처 확인 내역이 없습니다.</p>
              : view.reshipmentDestination.source === 'none' ? <p>재출고 수령 연락처 확인 내역이 없습니다.</p>
                : <>{view.reshipmentDestination.recordedAt ? <p><time dateTime={view.reshipmentDestination.recordedAt}>{formatOrderDateTime(view.reshipmentDestination.recordedAt)}</time> 확인</p> : null}
                  {view.reshipmentDestination.address ? <AddressView value={view.reshipmentDestination.address} /> : <p>{unavailableCopy(view.reshipmentDestination)}</p>}</>}
          </div>
          <div><h4 style={{ margin: '0 0 6px' }}>변경 내역</h4>
            {view.entries.length ? <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>{view.entries.map(entry => <HistoryRow key={entry.operationId} value={entry} operator={internal} />)}</ol>
              : <p>연락처 변경 내역이 없습니다.</p>}
          </div>
          {view.nextCursor ? <button className="btn btn-sm btn-ghost" type="button" disabled={pending} onClick={() => { void load(true); }}>이전 변경 내역 더 보기</button> : null}
        </> : null}
        {pending ? <p role="status">변경 이력을 확인하고 있습니다.</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>}
  </section>;
}

export function ClaimContactHistory({ actorId, orderId, claimId, operator = false }: {
  actorId: string; orderId: string; claimId: string; operator?: boolean;
}) {
  return <ClaimContactSession actorId={actorId}>{(identity, scope) => <HistoryPanel key={`${orderId}:${claimId}:${operator}`} identity={identity} scope={scope} orderId={orderId} claimId={claimId} operator={operator} />}</ClaimContactSession>;
}
