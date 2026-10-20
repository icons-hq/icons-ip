'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readCsReplyOperationAction, readCsReplySourceAction } from '@/app/admin/cs-draft-actions';
import { parseQuestionReplyDraft, parseReviewReplyDraft, type CsReplyDraft } from '@/lib/admin/cs-editor-drafts';
import { parseCsReplyOperation, parseCsReplyReceipt, type CsReplyActionResult, type CsReplyOperation } from '@/lib/admin/cs-reply-mutations';
import type { CsReplySource } from '@/lib/admin/cs-reply-sources';
import { useCsEditorDraft } from './useCsEditorDraft';
const retainPendingReply = (value: CsReplyDraft) => Boolean(value.pending);

export function useCsReplyDraft({ accountId, initialSource, enabled, saveAction }: {
  accountId: string; initialSource: CsReplySource; enabled: boolean;
  saveAction: (state: CsReplyActionResult, form: FormData) => Promise<CsReplyActionResult>;
}) {
  const draft = useCsEditorDraft({ accountId, scope: `${initialSource.surface}-reply`, recordId: initialSource.id, enabled,
    parse: initialSource.surface === 'review' ? parseReviewReplyDraft : parseQuestionReplyDraft, retainUntilResolved: retainPendingReply });
  const targetKey = `${accountId}:${initialSource.surface}:${initialSource.id}`;
  const sourceKey = `${targetKey}:${initialSource.sourceVersion}`;
  const activeTarget = useRef<string | null>(targetKey), readSequence = useRef(0), inFlight = useRef(false);
  useEffect(() => {
    activeTarget.current = targetKey;
    return () => { activeTarget.current = null; };
  }, [targetKey]);
  const [latest, setLatest] = useState<{ key: string; source: CsReplySource } | null>(null);
  const [checking, setChecking] = useState(false), [sourceError, setSourceError] = useState('');
  const [submitting, setSubmitting] = useState(false), [state, setState] = useState<CsReplyActionResult>({});
  const source = latest?.key === sourceKey ? latest.source : initialSource;
  const body = draft.value?.body ?? source.reply ?? '';
  const pendingOperation = draft.value?.pending;
  const hasUnresolvedOperation = Boolean(pendingOperation || draft.recovery?.pending);
  const changedSource = draft.value !== null && draft.value.sourceVersion !== source.sourceVersion;
  const contextReady = latest?.key === sourceKey && source.revision !== undefined;
  const isActive = draft.isActive, restoreStoredDraft = draft.restore;

  const readCurrent = useCallback(async (restore = false) => {
    if (!isActive()) return;
    const sequence = ++readSequence.current;
    setChecking(true); setSourceError('');
    try {
      const result = await readCsReplySourceAction({ id: initialSource.id, surface: initialSource.surface });
      if (!isActive() || activeTarget.current !== targetKey || sequence !== readSequence.current) return;
      if (!result.ok) { setSourceError(result.error); return; }
      if (result.accountId !== accountId || result.source.id !== initialSource.id || result.source.surface !== initialSource.surface || result.source.revision === undefined) {
        setSourceError('현재 계정 또는 답변 대상을 확인하지 못했습니다. 화면을 새로고침해주세요.'); return;
      }
      setLatest({ key: sourceKey, source: result.source });
      if (restore) restoreStoredDraft();
    } catch { if (isActive() && sequence === readSequence.current) setSourceError('현재 저장본을 읽지 못했습니다. 초안을 유지했으니 다시 확인해주세요.'); }
    finally { if (sequence === readSequence.current) setChecking(false); }
  }, [accountId, initialSource.id, initialSource.surface, isActive, restoreStoredDraft, sourceKey, targetKey]);
  useEffect(() => {
    const sequence = readSequence;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (enabled && draft.ready && !draft.blocked) void readCurrent();
      // A closed inline row stays mounted. Its cancelled read cannot clear this
      // flag in finally because the sequence guard correctly ignores it.
      else setChecking(false);
    });
    return () => { cancelled = true; sequence.current++; };
  }, [enabled, draft.ready, draft.blocked, readCurrent]);

  const editingLocked = !contextReady || !draft.ready || draft.blocked || draft.recovery !== null || checking || submitting || Boolean(sourceError) || hasUnresolvedOperation;
  async function send(operation: CsReplyOperation, recover: boolean) {
    if (inFlight.current || !isActive() || operation.accountId !== accountId || operation.id !== initialSource.id || operation.surface !== initialSource.surface) return;
    inFlight.current = true; setSubmitting(true); setState({});
    const stillActive = () => isActive() && activeTarget.current === targetKey;
    try {
      let result: CsReplyActionResult;
      if (recover) {
        const readback = await readCsReplyOperationAction(operation);
        if (!stillActive()) return;
        if (!readback.ok || readback.accountId !== accountId) {
          setState({ errors: { form: readback.ok ? '현재 계정의 저장 결과가 아닙니다.' : readback.error } }); return;
        }
        if (readback.receipt) result = { replyOutcome: { kind: 'saved', receipt: readback.receipt }, message: '앞서 요청한 답변이 저장된 것을 확인했습니다.' };
        else result = await dispatch(operation); // Keep the frozen ID/body: the first request may still be running.
      } else result = await dispatch(operation);
      if (!stillActive()) return;
      const outcome = result.replyOutcome;
      if (outcome?.kind === 'saved') {
        if (!parseCsReplyReceipt(outcome.receipt, operation)) { setState({ errors: { form: '저장 결과가 요청과 일치하지 않습니다. 같은 요청으로 결과를 다시 확인해주세요.' } }); return; }
        draft.discard(); setState(result); await readCurrent();
      } else if (recover || outcome?.kind === 'uncertain') setState(result);
      else {
        draft.change({ body: operation.body, sourceVersion: `reply:${operation.expectedRevision}` });
        setState(result); await readCurrent();
      }
    } catch {
      if (stillActive()) setState({ errors: { form: '연결이 끊겨 저장 결과를 확인하지 못했습니다. 같은 요청으로 결과를 확인해주세요.' } });
    } finally { inFlight.current = false; setSubmitting(false); }
  }
  async function dispatch(operation: CsReplyOperation) {
    const form = new FormData();
    form.set(initialSource.surface === 'review' ? 'reviewId' : 'questionId', operation.id);
    form.set(initialSource.surface === 'review' ? 'reply' : 'answer', operation.body);
    form.set('accountId', operation.accountId); form.set('operationId', operation.operationId); form.set('expectedRevision', operation.expectedRevision);
    return saveAction({}, form);
  }
  async function submit() {
    if (editingLocked || changedSource || inFlight.current) return;
    const operation = parseCsReplyOperation({ operationId: crypto.randomUUID(), accountId, id: initialSource.id,
      surface: initialSource.surface, expectedRevision: source.revision, body: body.trim() });
    if (!operation || !draft.change({ body, sourceVersion: source.sourceVersion, pending: operation })) return;
    if (!draft.getCurrentSnapshot().saved) {
      draft.change({ body, sourceVersion: source.sourceVersion });
      setState({ errors: { form: '이 브라우저에 저장 요청을 보관할 수 없습니다. 문구를 복사한 뒤 브라우저 저장 공간을 확인해주세요. 답변은 전송하지 않았습니다.' } });
      return;
    }
    await send(operation, false);
  }
  return {
    ...draft, body, source, changedSource, checking, sourceError, editingLocked, submitting, state, hasUnresolvedOperation,
    submit, retry: () => pendingOperation ? send(pendingOperation, true) : Promise.resolve(),
    change: (next: string) => { if (!editingLocked) draft.change({ body: next, sourceVersion: draft.value?.sourceVersion ?? source.sourceVersion }); },
    restore: () => {
      // A deleted/now-inaccessible source cannot prevent receipt recovery.
      if (draft.recovery?.pending) { restoreStoredDraft(); return readCurrent(); }
      return readCurrent(true);
    }, refreshSource: () => readCurrent(),
    acknowledge: () => { if (!editingLocked) draft.change({ body, sourceVersion: source.sourceVersion }); },
    discard: () => { if (!hasUnresolvedOperation && !submitting) { draft.discard(); setSourceError(''); setState({}); } },
  };
}
