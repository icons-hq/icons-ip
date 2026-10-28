'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { closeInquiryAction, type AdminInquiryActionState } from '@/app/admin/inquiry-actions';
import { sendInquiryChatMessageAction } from '@/app/admin/inquiry-file-actions';
import { useInquiryDraft } from '@/components/admin/useInquiryDraft';
import { InquiryMessageBody } from '@/components/screens/InquiryMessageBody';
import { formatInquiryDateTime, inquiryMessageAuthorLabel, MAX_INQUIRY_BODY_LENGTH } from '@/lib/inquiries';
import { InquiryChatFiles, type InquiryChatFileEntry } from './InquiryChatFiles';
import { InquiryMessageFiles } from '@/components/screens/InquiryMessageFiles';
import type { AdminInquiryDetail } from '@/lib/admin/inquiries.server';
import { InquiryReplyTemplateTools } from './InquiryReplyTemplateTools';
import { InquiryDraftNotice } from './InquiryDraftNotice';

const EMPTY: AdminInquiryActionState = {};

function Feedback({ state }: { state: AdminInquiryActionState }) {
  return <>{Object.entries(state.errors ?? {}).map(([key, value]) => value ? <p key={key} role="alert">{value}</p> : null)}
    {state.message ? <p role="status">{state.message}</p> : null}</>;
}

/** Exact IDs from this rendered thread close the fetch/read race without consuming later arrivals. */
export function InquiryChatReadReceipt({ accountId, inquiryId, messageIds }: { accountId: string; inquiryId: string; messageIds: string[] }) {
  const router = useRouter();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const signature = messageIds.join(',');
  useEffect(() => {
    if (!signature) return;
    let active = true;
    let started = false;
    const controller = new AbortController();
    async function save() {
      if (started || document.visibilityState !== 'visible') return;
      started = true;
      try {
        const ids = signature.split(',');
        for (let index = 0; index < ids.length; index += 500) {
          const response = await fetch('/api/admin/inquiry-chat/read', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId, inquiryId, messageIds: ids.slice(index, index + 500) }), signal: controller.signal });
          const data = await response.json() as { userId?: string };
          if (!response.ok || data.userId !== accountId) throw new Error('read_unavailable');
        }
        if (active) { setError(false); router.refresh(); }
      } catch { if (active && !controller.signal.aborted) setError(true); }
    }
    void save();
    document.addEventListener('visibilitychange', save);
    return () => { active = false; controller.abort(); document.removeEventListener('visibilitychange', save); };
  }, [accountId, inquiryId, retry, router, signature]);
  return error ? <p className="admin-inquiry-chat__notice" role="status">읽음 상태를 저장하지 못했습니다. <button type="button" onClick={() => setRetry(value => value + 1)}>다시 시도</button></p> : null;
}

export function InquiryChatConversation({ accountId, detail }: { accountId: string; detail: AdminInquiryDetail }) {
  const router = useRouter();
  const { inquiry, messages } = detail;
  const request = useRef<FormData | null>(null);
  const [answerState, answerAction, answerPending] = useActionState(async (state: AdminInquiryActionState, formData: FormData) => {
    if (state.uncertain && request.current) formData = request.current;
    else { formData.set('operationId', crypto.randomUUID()); request.current = formData; }
    try {
      const result = await sendInquiryChatMessageAction(state, formData);
      // A failure must not look like another successful reset after an earlier send.
      return { ...result, resultKey: result.resultKey ?? state.resultKey };
    } catch { return { resultKey: state.resultKey, uncertain: true, errors: { form: '전송 결과를 확인하지 못했습니다. 같은 메시지로 다시 시도해주세요.' } }; }
  }, EMPTY);
  const [closeState, closeAction, closePending] = useActionState(closeInquiryAction, EMPTY);
  const draft = useInquiryDraft(accountId, inquiry.id, 'reply', answerState.resultKey);
  const [closeRequested, setCloseRequested] = useState(false);
  const [attachments, setAttachments] = useState<{ resultKey?: string; entries: InquiryChatFileEntry[] }>({ entries: [] });
  const textarea = useRef<HTMLTextAreaElement>(null);
  const messageList = useRef<HTMLOListElement>(null);
  const followLatest = useRef(true);
  const busy = answerPending || closePending || !draft.ready || draft.blocked;
  const messageSignature = messages.map(message => message.id).join(',');
  const attachmentEntries = attachments.resultKey === answerState.resultKey ? attachments.entries : [];
  const filesPending = attachmentEntries.some(entry => !entry.file);
  const editingBlocked = busy || !!answerState.uncertain;
  const emptyMessage = !draft.body.trim() && !attachmentEntries.some(entry => entry.file);
  useEffect(() => { if (answerState.resultKey) { followLatest.current = true; router.refresh(); } }, [answerState.resultKey, router]);
  useEffect(() => { if (closeState.message) router.refresh(); }, [closeState.message, router]);
  useEffect(() => {
    const list = messageList.current;
    if (list && followLatest.current) list.scrollTop = list.scrollHeight;
  }, [messageSignature]);
  useEffect(() => {
    const list = messageList.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (followLatest.current) list.scrollTop = list.scrollHeight; });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);
  function insertTemplate(body: string) { draft.change(body); textarea.current?.focus(); }
  return <div className="admin-inquiry-chat__conversation">
    <header className="admin-inquiry-chat__thread-header">
      <span className="admin-inquiry-chat__avatar" aria-hidden="true">{inquiry.buyerName.slice(0, 1)}</span>
      <div><strong>{inquiry.buyerName}</strong><p title={inquiry.title}>{inquiry.title}</p></div>
      <span className="admin-inquiry-chat__assignee">{inquiry.assigneeName ?? '담당자 미배정'}</span>
      {inquiry.status !== 'closed' ? <button type="button" disabled={busy} onClick={() => setCloseRequested(true)}>상담완료</button> : <span className="admin-inquiry-chat__closed">상담완료</span>}
    </header>
    {closeRequested && inquiry.status !== 'closed' ? <div className="admin-inquiry-chat__close-confirm" role="group" aria-label="상담완료 확인">
      <p>상담을 완료하면 이 대화에 추가 답변을 보낼 수 없습니다. 완료할까요?</p>
      <form action={closeAction}><input type="hidden" name="inquiryId" value={inquiry.id} />
        <button type="submit" disabled={busy}>{closePending ? '완료 처리 중' : '상담완료 확인'}</button>
        <button type="button" disabled={closePending} onClick={() => setCloseRequested(false)}>계속 상담</button>
      </form><Feedback state={closeState} />
    </div> : null}
    <InquiryChatReadReceipt accountId={accountId} inquiryId={inquiry.id} messageIds={messages.filter(message => message.author === 'user').map(message => message.id)} />
    <ol className="admin-inquiry-chat__messages" ref={messageList} aria-label="상담 대화" aria-live="polite" aria-relevant="additions"
      onScroll={() => { const list = messageList.current; if (list) followLatest.current = list.scrollHeight - list.scrollTop - list.clientHeight < 100; }}>
      {messages.map(message => <li key={message.id} data-author={message.author}>
        <span className="admin-inquiry-chat__message-author">{inquiryMessageAuthorLabel(message.author, message.authorName, inquiry.buyerName)}</span>
        <div className="admin-inquiry-chat__bubble">{message.body ? <p><InquiryMessageBody body={message.body} automatic={message.author === 'system'} /></p> : null}
          {message.imageUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noopener noreferrer" aria-label={`첨부 이미지 ${index + 1} 새 창에서 보기`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`첨부 이미지 ${index + 1}`} /></a>)}
          <InquiryMessageFiles files={message.files} messageId={message.id} />
        </div><time dateTime={message.createdAt}>{formatInquiryDateTime(message.createdAt)}</time>
      </li>)}
    </ol>
    {inquiry.status === 'closed' ? <p className="admin-inquiry-chat__completed" role="status">상담이 완료되었습니다. 고객이 새 문의를 남기면 새 대화에서 이어갈 수 있습니다.</p> :
      <form action={answerAction} className="admin-inquiry-chat__composer">
        <input type="hidden" name="inquiryId" value={inquiry.id} /><input type="hidden" name="category" value={inquiry.category} />
        <input type="hidden" name="fileIds" value={JSON.stringify(attachmentEntries.flatMap(entry => entry.file ? [entry.file.id] : []))} />
        <div className="admin-inquiry-chat__toolbar">
          <InquiryChatFiles key={answerState.resultKey ?? 'initial'} entries={attachmentEntries} disabled={editingBlocked}
            onChange={entries => setAttachments({ resultKey: answerState.resultKey, entries })} />
          <InquiryReplyTemplateTools label="자주 쓰는 문구" accountId={accountId} body={draft.body} onInsert={insertTemplate} disabled={editingBlocked} />
          <span>첨부 최대 3개 · 파일당 20MB</span>
        </div>
        <label className="sr-only" htmlFor={`chat-reply-${inquiry.id}`}>메시지</label>
        <textarea id={`chat-reply-${inquiry.id}`} ref={textarea} name="body" placeholder="메시지를 입력해 주세요" rows={3} maxLength={MAX_INQUIRY_BODY_LENGTH}
          value={draft.body} disabled={editingBlocked} onChange={event => draft.change(event.target.value)} />
        <div className="admin-inquiry-chat__send-row">
          <span>{draft.body.length}/{MAX_INQUIRY_BODY_LENGTH}</span><button className="admin-inquiry-chat__send" type="submit" disabled={busy || filesPending || !answerState.uncertain && emptyMessage}>{answerPending ? '전송 중' : answerState.uncertain ? '전송 결과 다시 확인' : '전송'}</button>
        </div>
        <Feedback state={answerState} />
        {!draft.ready || draft.blocked || draft.recovery !== null || draft.unavailable ? <InquiryDraftNotice draft={draft} pending={busy} loadingLabel="메시지 입력을 불러오는 중입니다." /> : null}
      </form>}
  </div>;
}
