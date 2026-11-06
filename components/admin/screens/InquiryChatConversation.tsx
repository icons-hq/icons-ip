'use client';

import { useActionState, useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
import { CircleCheck, Send } from 'lucide-react';
import { Badge } from '@/components/admin/kit/ui/badge';
import { Button } from '@/components/admin/kit/ui/button';

const EMPTY: AdminInquiryActionState = {};

function Feedback({ state }: { state: AdminInquiryActionState }) {
  return <>{Object.entries(state.errors ?? {}).map(([key, value]) => value ? <p className="bg-transparent text-sm text-destructive" key={key} role="alert">{value}</p> : null)}
    {state.message ? <p className="text-sm text-muted-foreground" role="status">{state.message}</p> : null}</>;
}

/** 메시지 말풍선. 운영자 답변은 템플릿의 기본(primary) 면, 자동 안내는 muted 면이다. 첨부 파일 목록(공용 부품)도 말풍선 안에서 정돈한다. */
const BUBBLE_CLASS = 'rounded-2xl border bg-background px-3.5 py-2.5 text-sm text-foreground wrap-anywhere group-data-[author=staff]/message:border-transparent group-data-[author=staff]/message:bg-primary group-data-[author=staff]/message:text-primary-foreground group-data-[author=system]/message:bg-muted group-data-[author=system]/message:text-xs [&_.inquiry-message-files]:mt-2 [&_.inquiry-message-files]:grid [&_.inquiry-message-files]:list-none [&_.inquiry-message-files]:gap-2 [&_.inquiry-message-files]:p-0 [&_.inquiry-message-files_a]:underline [&_.inquiry-message-files_a]:underline-offset-2 [&_.inquiry-message-files_img]:max-h-55 [&_.inquiry-message-files_img]:rounded-md';

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
  return error ? <p className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/60 px-4 py-2 text-sm" role="status">읽음 상태를 저장하지 못했습니다. <Button onClick={() => setRetry(value => value + 1)} size="xs" type="button" variant="outline">다시 시도</Button></p> : null;
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
  const sendDisabled = busy || filesPending || !answerState.uncertain && emptyMessage;
  /* R5(MD-0022): 상담하기는 메신저처럼 Enter 전송·Shift+Enter 줄바꿈이다. 한글 조합 중 Enter(isComposing·keyCode 229)는
     글자 확정에 쓰이므로 막지 않고 전송하지 않는다. 전송 버튼과 같은 조건을 통과할 때만 같은 폼을 제출한다.
     고객문의 답변 패널은 실수 발송을 막기 위해 이 동작을 쓰지 않는다. */
  function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!sendDisabled) event.currentTarget.form?.requestSubmit();
  }
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-chat-conversation="">
    <header className="flex min-h-16 shrink-0 items-center gap-2.5 border-b bg-background px-4 py-2.5 @max-2xl/chat:gap-2 @max-2xl/chat:px-3">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted text-sm font-semibold text-foreground @max-2xl/chat:hidden" aria-hidden="true">{inquiry.buyerName.slice(0, 1)}</span>
      <div className="min-w-0 flex-1"><strong className="block truncate font-medium text-foreground">{inquiry.buyerName}</strong><p className="truncate text-xs text-muted-foreground" title={inquiry.title}>{inquiry.title}</p></div>
      <span className="max-w-24 truncate text-xs text-muted-foreground @max-2xl/chat:max-w-18">{inquiry.assigneeName ?? '담당자 미배정'}</span>
      {inquiry.status !== 'closed' ? <Button disabled={busy} onClick={() => setCloseRequested(true)} size="sm" type="button" variant="outline"><CircleCheck aria-hidden="true" />상담완료</Button> : <Badge variant="secondary">상담완료</Badge>}
    </header>
    {closeRequested && inquiry.status !== 'closed' ? <div className="flex shrink-0 flex-col gap-2 border-b bg-muted/60 px-4 py-2.5" role="group" aria-label="상담완료 확인">
      <p className="text-sm">상담을 완료하면 이 대화에 추가 답변을 보낼 수 없습니다. 완료할까요?</p>
      <form action={closeAction} className="flex flex-wrap gap-2"><input type="hidden" name="inquiryId" value={inquiry.id} />
        <Button disabled={busy} size="sm" type="submit">{closePending ? '완료 처리 중' : '상담완료 확인'}</Button>
        <Button disabled={closePending} onClick={() => setCloseRequested(false)} size="sm" type="button" variant="outline">계속 상담</Button>
      </form><Feedback state={closeState} />
    </div> : null}
    <InquiryChatReadReceipt accountId={accountId} inquiryId={inquiry.id} messageIds={messages.filter(message => message.author === 'user').map(message => message.id)} />
    <ol className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4 @max-2xl/chat:p-3" ref={messageList} aria-label="상담 대화" aria-live="polite" aria-relevant="additions"
      onScroll={() => { const list = messageList.current; if (list) followLatest.current = list.scrollHeight - list.scrollTop - list.clientHeight < 100; }}>
      {messages.map(message => <li className="group/message flex max-w-[90%] flex-col items-start gap-1 self-start data-[author=staff]:items-end data-[author=staff]:self-end data-[author=system]:items-center data-[author=system]:self-center @max-2xl/chat:max-w-[95%]" key={message.id} data-author={message.author}>
        <span className="text-xs text-muted-foreground">{inquiryMessageAuthorLabel(message.author, message.authorName, inquiry.buyerName)}</span>
        <div className={BUBBLE_CLASS}>{message.body ? <p className="leading-relaxed whitespace-pre-wrap [&_a]:underline [&_a]:underline-offset-2"><InquiryMessageBody body={message.body} automatic={message.author === 'system'} /></p> : null}
          {message.imageUrls.map((url, index) => <a className="mt-2 block first:mt-0" key={url} href={url} target="_blank" rel="noopener noreferrer" aria-label={`첨부 이미지 ${index + 1} 새 창에서 보기`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="block max-h-55 max-w-full rounded-md" src={url} alt={`첨부 이미지 ${index + 1}`} /></a>)}
          <InquiryMessageFiles files={message.files} messageId={message.id} />
        </div><time className="text-[0.65rem] text-muted-foreground tabular-nums" dateTime={message.createdAt}>{formatInquiryDateTime(message.createdAt)}</time>
      </li>)}
    </ol>
    {inquiry.status === 'closed' ? <p className="shrink-0 border-t bg-background p-4 text-center text-sm text-muted-foreground" role="status">상담이 완료되었습니다. 고객이 새 문의를 남기면 새 대화에서 이어갈 수 있습니다.</p> :
      <form action={answerAction} className="flex shrink-0 flex-col gap-2 border-t bg-background px-4 pt-2 pb-3 @max-2xl/chat:px-3" data-chat-composer="">
        <input type="hidden" name="inquiryId" value={inquiry.id} /><input type="hidden" name="category" value={inquiry.category} />
        <input type="hidden" name="fileIds" value={JSON.stringify(attachmentEntries.flatMap(entry => entry.file ? [entry.file.id] : []))} />
        <div className="flex flex-wrap items-center gap-1">
          <InquiryChatFiles key={answerState.resultKey ?? 'initial'} entries={attachmentEntries} disabled={editingBlocked}
            onChange={entries => setAttachments({ resultKey: answerState.resultKey, entries })} />
          <InquiryReplyTemplateTools label="자주 쓰는 문구" triggerVariant="ghost" accountId={accountId} body={draft.body} onInsert={insertTemplate} disabled={editingBlocked} />
          <span className="ml-auto text-xs text-muted-foreground @max-2xl/chat:hidden">첨부 최대 3개 · 파일당 20MB</span>
        </div>
        <label className="sr-only" htmlFor={`chat-reply-${inquiry.id}`}>메시지</label>
        <div className="flex flex-col rounded-lg border border-input transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-[textarea:disabled]:bg-input/50">
          <textarea id={`chat-reply-${inquiry.id}`} ref={textarea} name="body" placeholder="메시지를 입력해 주세요" rows={3} maxLength={MAX_INQUIRY_BODY_LENGTH}
            value={draft.body} disabled={editingBlocked} onChange={event => draft.change(event.target.value)} onKeyDown={sendOnEnter}
            aria-describedby={`chat-reply-${inquiry.id}-keys`}
            className="field-sizing-content max-h-45 min-h-17 w-full resize-none bg-transparent px-3 py-2 text-base leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm" data-slot="textarea" />
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 px-2 pb-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{draft.body.length}/{MAX_INQUIRY_BODY_LENGTH}</span><span id={`chat-reply-${inquiry.id}-keys`}>Enter 전송 · Shift+Enter 줄바꿈</span><Button type="submit" size="sm" disabled={sendDisabled}><Send aria-hidden="true" />{answerPending ? '전송 중' : answerState.uncertain ? '전송 결과 다시 확인' : '전송'}</Button>
          </div>
        </div>
        <Feedback state={answerState} />
        {!draft.ready || draft.blocked || draft.recovery !== null || draft.unavailable ? <InquiryDraftNotice draft={draft} pending={busy} loadingLabel="메시지 입력을 불러오는 중입니다." /> : null}
      </form>}
  </div>;
}
