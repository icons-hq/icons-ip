'use client';

import { useActionState, useId, useState } from 'react';
import {
  addInquiryInternalNoteAction,
  reassignInquiryAction,
  type AdminInquiryActionState,
} from '@/app/admin/inquiry-actions';
import type { AdminInquiryInternalNote, AdminInquiryStaffOption } from '@/lib/admin/inquiries.server';
import { formatInquiryDateTime, MAX_INQUIRY_BODY_LENGTH } from '@/lib/inquiries';
import { useInquiryDraft } from '@/components/admin/useInquiryDraft';
import { AdminSelect } from '@/components/admin/console/AdminSelect';
import { Button } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { InquiryDraftNotice } from './InquiryDraftNotice';
import { useInquiryPreviewBusy } from './CustomerServiceDialog';

const EMPTY_STATE: AdminInquiryActionState = {};

/** 카드 테두리. 상담하기 컨텍스트처럼 바깥 카드 안에 들어갈 때는 framed={false}로 테두리를 뺀다. */
const FRAME_CLASS = 'rounded-xl border bg-card p-4 text-card-foreground';

function Feedback({ state }: { state: AdminInquiryActionState }) {
  return <>
    {state.errors?.form ? <span className="text-sm text-destructive" role="alert">{state.errors.form}</span> : null}
    {state.errors?.body ? <span className="text-sm text-destructive" role="alert">{state.errors.body}</span> : null}
    {state.message ? <span className="text-sm text-muted-foreground" role="status">{state.message}</span> : null}
  </>;
}

export function InquiryAssignmentPanel({ inquiryId, assigneeId, assigneeName, staffOptions, framed = true }: {
  inquiryId: string;
  assigneeId: string | null;
  assigneeName: string | null;
  staffOptions: AdminInquiryStaffOption[];
  framed?: boolean;
}) {
  const [state, action, pending] = useActionState(reassignInquiryAction, EMPTY_STATE);
  useInquiryPreviewBusy(pending); /* 목록 위 문의 팝업(R4)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const [selected, setSelected] = useState(assigneeId ?? '');
  const [reason, setReason] = useState('');
  const [clearedKey, setClearedKey] = useState<string | null>(null);
  const [previousAssignee, setPreviousAssignee] = useState(assigneeId);
  const id = useId();
  if (previousAssignee !== assigneeId) {
    setPreviousAssignee(assigneeId);
    setSelected(assigneeId ?? '');
  }
  if (state.resultKey && state.resultKey !== clearedKey) {
    setClearedKey(state.resultKey);
    setReason('');
  }
  return <section className={`flex min-w-0 flex-col gap-3 ${framed ? FRAME_CLASS : ''}`}>
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium text-foreground">문의 담당자</h3>
      <p className="text-sm">{assigneeName ? `@${assigneeName}` : '미배정'}</p>
      <p className="text-xs text-muted-foreground">첫 답변자가 자동 배정됩니다. 담당 변경은 사유와 함께 기록됩니다.</p>
    </div>
    <form action={action} className="flex flex-col gap-3">
      <input name="inquiryId" type="hidden" value={inquiryId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-assignee`}>담당자 선택</Label>
        <AdminSelect id={`${id}-assignee`} name="assigneeId" onChange={(event) => setSelected(event.target.value)} value={selected}>
          <option value="">미배정</option>
          {assigneeId && !staffOptions.some((staff) => staff.id === assigneeId)
            ? <option disabled value={assigneeId}>{assigneeName ?? '기존 담당자'} (배정 불가)</option> : null}
          {staffOptions.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
        </AdminSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-reason`}>변경 사유</Label>
        <Textarea id={`${id}-reason`} maxLength={500} name="reason" onChange={(event) => setReason(event.target.value)} required rows={2} value={reason} />
      </div>
      <Feedback state={state} />
      <Button className="self-start" disabled={pending} size="sm" type="submit">{pending ? '변경 중' : '담당자 변경'}</Button>
    </form>
  </section>;
}

export function InquiryInternalNotesPanel({ inquiryId, notes, accountId = '', framed = true }: {
  inquiryId: string;
  notes: AdminInquiryInternalNote[];
  accountId?: string;
  framed?: boolean;
}) {
  const [state, action, pending] = useActionState(addInquiryInternalNoteAction, EMPTY_STATE);
  useInquiryPreviewBusy(pending); /* 목록 위 문의 팝업(R4)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const draft = useInquiryDraft(accountId, inquiryId, 'note', state.resultKey);
  const { body, change: setBody } = draft;
  const busy = pending || !draft.ready || draft.blocked;
  const id = useId();
  return <section aria-label="내부 메모" className={`flex min-w-0 flex-col gap-3 ${framed ? FRAME_CLASS : ''}`}>
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium text-foreground">내부 메모 · 고객 비노출</h3>
      <p className="text-xs text-muted-foreground">운영팀만 볼 수 있습니다. 고객 답변과 알림으로 전달되지 않습니다.</p>
    </div>
    {notes.length ? <ol className="flex flex-col gap-2">
      {notes.map((note) => <li className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2" key={note.id}>
        <span className="text-xs text-muted-foreground">{note.authorName} · {formatInquiryDateTime(note.createdAt)}</span>
        <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere">{note.body}</p>
      </li>)}
    </ol> : <p className="text-sm text-muted-foreground">등록된 내부 메모가 없습니다.</p>}
    <InquiryDraftNotice draft={draft} pending={busy} loadingLabel="메모 입력을 불러오는 중입니다." />
    <form action={action} className="flex flex-col gap-3">
      <input name="inquiryId" type="hidden" value={inquiryId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-body`}>내부 메모 내용</Label>
        <Textarea className="min-h-24" disabled={busy} id={`${id}-body`} maxLength={MAX_INQUIRY_BODY_LENGTH} name="body" onChange={(event) => setBody(event.target.value)} required rows={4} value={body} />
      </div>
      <Feedback state={state} />
      <Button className="self-start" disabled={busy} size="sm" type="submit">{pending ? '저장 중' : '내부 메모 저장'}</Button>
    </form>
  </section>;
}
