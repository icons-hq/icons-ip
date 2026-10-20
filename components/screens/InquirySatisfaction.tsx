'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { readInquirySatisfactionOperationAction, setInquirySatisfactionAction } from '@/app/my/inquiries/satisfaction-actions';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { createClient } from '@/lib/supabase/client';
import { formatInquiryDateTime } from '@/lib/inquiries';
import { INQUIRY_SATISFACTION_LABELS, parseInquirySatisfactionRequest,
  type InquirySatisfactionLoad, type InquirySatisfactionRequest, type InquirySatisfactionValue, type MyInquirySatisfaction } from '@/lib/inquiry-satisfaction';

const STORAGE_PREFIX = 'icons:inquiry-satisfaction:pending:v1:';

export function InquirySatisfaction({ result }: { result: InquirySatisfactionLoad }) {
  const router = useRouter();
  return result.ok ? <Evaluation key={`${result.value.actorId}:${result.value.sessionId}:${result.value.inquiryId}`} initial={result.value} />
    : <section className="wc-mypage__notice" aria-label="답변 만족도">
      <strong>답변 만족도</strong><p role="alert">만족도 정보를 불러오지 못했습니다.</p>
      <button type="button" className="wc-btn" onClick={() => router.refresh()}>다시 불러오기</button>
    </section>;
}

function Evaluation({ initial }: { initial: MyInquirySatisfaction }) {
  const router = useRouter();
  const scope = useMemo(() => createGoodsDescriptionToolScope(initial.actorId), [initial.actorId]);
  const identity = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot);
  const [pending, startTransition] = useTransition();
  const requestRef = useRef<InquirySatisfactionRequest | null>(null);
  const busy = useRef(false);
  const [request, setRequest] = useState<InquirySatisfactionRequest | null>(null);
  const [choice, setChoice] = useState<{ target: string; value: InquirySatisfactionValue }>({ target: `${initial.answerId}:${initial.revision}`, value: initial.value });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [conflictSource, setConflictSource] = useState<MyInquirySatisfaction | null>(null);
  const [confirmed, setConfirmed] = useState<{ source: MyInquirySatisfaction; value: MyInquirySatisfaction } | null>(null);
  const current = confirmed?.source === initial ? confirmed.value : initial;
  const conflicted = conflictSource === initial;
  const target = `${current.answerId}:${current.revision}`;
  const selection = choice.target === target ? choice.value : current.value;
  const storageKey = `${STORAGE_PREFIX}${initial.actorId}:${initial.sessionId}:${initial.inquiryId}`;

  function remember(next: InquirySatisfactionRequest | null) {
    requestRef.current = next; setRequest(next);
    try { if (next) sessionStorage.setItem(storageKey, JSON.stringify(next)); else sessionStorage.removeItem(storageKey); } catch { /* Memory still freezes the request. */ }
  }
  useEffect(() => {
    scope.setEnabled(true); scope.activate();
    let restored = false;
    const loseIdentity = () => {
      scope.authenticate(null, null); requestRef.current = null; busy.current = false;
      setRequest(null); setMessage(''); setError('로그인 상태가 변경됐습니다. 화면을 새로고침해주세요.');
      try { sessionStorage.removeItem(storageKey); } catch { /* The next identity cannot replay this key. */ }
    };
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, loseIdentity);
    const subscription = createClient().auth.onAuthStateChange((_event, session) => {
      const sessionId = session ? inquiryDraftSessionId(session.access_token) : null;
      if (session?.user.id !== initial.actorId || sessionId !== initial.sessionId) { loseIdentity(); return; }
      scope.authenticate(session.user.id, sessionId);
      if (restored || scope.getSnapshot().blocked) return;
      restored = true;
      try {
        const stored = sessionStorage.getItem(storageKey);
        const frozen = stored ? parseInquirySatisfactionRequest(JSON.parse(stored)) : null;
        if (frozen && frozen.inquiryId === initial.inquiryId && frozen.expectedActorId === initial.actorId && frozen.expectedSessionId === initial.sessionId) {
          requestRef.current = frozen; setRequest(frozen);
          setError('저장 결과를 확인하지 못한 평가가 있습니다. 같은 요청의 결과를 확인해주세요.');
        } else if (stored) sessionStorage.removeItem(storageKey);
      } catch { /* Malformed or unavailable storage cannot authorize a write. */ }
    }).data.subscription;
    return () => { scope.dispose(); subscription.unsubscribe(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, loseIdentity); };
  }, [initial.actorId, initial.sessionId, initial.inquiryId, scope, storageKey]);
  useEffect(() => {
    if (!request) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [request]);

  function dispatch(frozen: InquirySatisfactionRequest, recover = false) {
    const ticket = scope.capture(); if (!ticket || busy.current) return;
    busy.current = true; remember(frozen); setError(''); setMessage('');
    startTransition(async () => {
      try {
        const result = await (recover ? readInquirySatisfactionOperationAction : setInquirySatisfactionAction)(frozen);
        if (!scope.canApply(ticket)) return;
        busy.current = false;
        if (!result.ok) {
          setError(result.error);
          if (result.kind === 'conflict' || result.kind === 'invalid') { remember(null); setConflictSource(initial); }
          return;
        }
        setConfirmed({ source: initial, value: result.value.current });
        if (result.value.operation === 'unresolved') { setError('저장된 결과를 아직 찾지 못했습니다. 같은 요청을 다시 보내거나 결과를 다시 확인해주세요.'); return; }
        remember(null); setChoice({ target: `${result.value.current.answerId}:${result.value.current.revision}`, value: result.value.current.value });
        const oldAnswer = result.value.receipt.expectedAnswerId !== result.value.current.answerId;
        setMessage(oldAnswer ? '이전 답변에 대한 평가 결과를 확인했습니다. 새 답변은 별도로 평가해주세요.' : '평가 결과를 확인했습니다.');
        router.refresh();
      } catch {
        if (scope.canApply(ticket)) { busy.current = false; setError('평가 저장 결과를 확인하지 못했습니다. 같은 요청의 결과를 확인해주세요.'); }
      }
    });
  }
  function save(desiredValue: InquirySatisfactionValue) {
    if (requestRef.current || !current.canEvaluate || !current.answerId || conflicted) return;
    dispatch({ operationId: crypto.randomUUID(), inquiryId: initial.inquiryId, expectedActorId: initial.actorId,
      expectedSessionId: initial.sessionId, expectedAnswerId: current.answerId, expectedRevision: current.revision, desiredValue });
  }
  const locked = pending || !identity.ready || identity.blocked || !current.canEvaluate || Boolean(request) || conflicted;
  return <section className="wc-mypage__notice wc-inquiry-satisfaction" aria-labelledby="inquiry-satisfaction-heading">
    <strong id="inquiry-satisfaction-heading">답변 만족도</strong>
    {identity.blocked ? <p>로그인 상태를 다시 확인해주세요.</p> : <>
      <p>{current.answerCreatedAt ? `${formatInquiryDateTime(current.answerCreatedAt)} 운영자 답변` : '아직 평가할 운영자 답변이 없습니다.'}</p>
      <p>현재 평가: {INQUIRY_SATISFACTION_LABELS[current.value ?? 'unrated']}{current.ratedAt ? ` · ${formatInquiryDateTime(current.ratedAt)}` : ''}</p>
      {current.unavailableReason === 'account_unavailable' ? <p>현재 계정 상태에서는 평가를 변경할 수 없습니다.</p> : null}
      {current.answerId ? <>
        <fieldset disabled={locked}><legend>이 답변이 도움이 되었나요?</legend>
          <label><input type="radio" name="inquiry-satisfaction" checked={selection === 'satisfied'} onChange={() => setChoice({ target, value: 'satisfied' })} /> 만족</label>
          <label><input type="radio" name="inquiry-satisfaction" checked={selection === 'dissatisfied'} onChange={() => setChoice({ target, value: 'dissatisfied' })} /> 불만족</label>
        </fieldset>
        <div className="wc-mypage__form-actions">
          <button className="wc-btn" type="button" disabled={locked || selection === null} onClick={() => save(selection)}>평가 저장</button>
          {current.value !== null ? <button className="wc-btn" type="button" disabled={locked} onClick={() => save(null)}>평가 철회</button> : null}
        </div>
      </> : null}
    </>}
    {pending ? <p role="status">평가 결과 확인 중</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {request && !identity.blocked ? <div className="wc-mypage__form-actions">
      <button className="wc-btn" type="button" disabled={pending || !identity.ready} onClick={() => dispatch(request, true)}>저장 결과 확인</button>
      <button className="wc-btn" type="button" disabled={pending || !identity.ready} onClick={() => dispatch(request)}>같은 요청 다시 보내기</button>
    </div> : null}
    {conflicted || identity.blocked ? <button className="wc-btn" type="button" disabled={pending} onClick={() => {
      // A fresh server response, not an automatic request rebase.
      router.refresh();
    }}>최신 상태 확인</button> : null}
    <small>새 운영자 답변이 등록되면 해당 답변을 새로 평가할 수 있습니다. 평가는 문의 상태를 변경하지 않습니다.</small>
  </section>;
}
