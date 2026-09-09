'use client';

import { useActionState, useState } from 'react';
import {
  addInquiryInternalNoteAction,
  reassignInquiryAction,
  type AdminInquiryActionState,
} from '@/app/admin/inquiry-actions';
import type { AdminInquiryInternalNote, AdminInquiryStaffOption } from '@/lib/admin/inquiries.server';
import { formatInquiryDateTime, MAX_INQUIRY_BODY_LENGTH } from '@/lib/inquiries';

const EMPTY_STATE: AdminInquiryActionState = {};

function Feedback({ state }: { state: AdminInquiryActionState }) {
  return <>
    {state.errors?.form ? <span role="alert">{state.errors.form}</span> : null}
    {state.errors?.body ? <span role="alert">{state.errors.body}</span> : null}
    {state.message ? <span className="muted" role="status">{state.message}</span> : null}
  </>;
}

export function InquiryAssignmentPanel({ inquiryId, assigneeId, assigneeName, staffOptions }: {
  inquiryId: string;
  assigneeId: string | null;
  assigneeName: string | null;
  staffOptions: AdminInquiryStaffOption[];
}) {
  const [state, action, pending] = useActionState(reassignInquiryAction, EMPTY_STATE);
  const [selected, setSelected] = useState(assigneeId ?? '');
  const [reason, setReason] = useState('');
  const [clearedKey, setClearedKey] = useState<string | null>(null);
  const [previousAssignee, setPreviousAssignee] = useState(assigneeId);
  if (previousAssignee !== assigneeId) {
    setPreviousAssignee(assigneeId);
    setSelected(assigneeId ?? '');
  }
  if (state.resultKey && state.resultKey !== clearedKey) {
    setClearedKey(state.resultKey);
    setReason('');
  }
  return <section className="card col" style={{ borderRadius: 12, gap: 10, padding: 16 }}>
    <strong>문의 담당자</strong>
    <span>{assigneeName ? `@${assigneeName}` : '미배정'}</span>
    <p className="muted" style={{ fontSize: 12, margin: 0 }}>첫 답변자가 자동 배정됩니다. 담당 변경은 사유와 함께 기록됩니다.</p>
    <form action={action} className="col" style={{ gap: 8 }}>
      <input name="inquiryId" type="hidden" value={inquiryId} />
      <label className="col" style={{ gap: 4 }}>
        담당자 선택
        <select name="assigneeId" onChange={(event) => setSelected(event.target.value)} value={selected}>
          <option value="">미배정</option>
          {assigneeId && !staffOptions.some((staff) => staff.id === assigneeId)
            ? <option disabled value={assigneeId}>{assigneeName ?? '기존 담당자'} (배정 불가)</option> : null}
          {staffOptions.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
        </select>
      </label>
      <label className="col" style={{ gap: 4 }}>
        변경 사유
        <textarea maxLength={500} name="reason" onChange={(event) => setReason(event.target.value)} required rows={2} value={reason} />
      </label>
      <Feedback state={state} />
      <button className="btn btn-sm" disabled={pending} type="submit">{pending ? '변경 중' : '담당자 변경'}</button>
    </form>
  </section>;
}

export function InquiryInternalNotesPanel({ inquiryId, notes }: {
  inquiryId: string;
  notes: AdminInquiryInternalNote[];
}) {
  const [state, action, pending] = useActionState(addInquiryInternalNoteAction, EMPTY_STATE);
  const [body, setBody] = useState('');
  const [clearedKey, setClearedKey] = useState<string | null>(null);
  if (state.resultKey && state.resultKey !== clearedKey) {
    setClearedKey(state.resultKey);
    setBody('');
  }
  return <section aria-label="내부 메모" className="card col" style={{ borderRadius: 12, gap: 10, padding: 16 }}>
    <strong>내부 메모 · 고객 비노출</strong>
    <p className="muted" style={{ fontSize: 12, margin: 0 }}>운영팀만 볼 수 있습니다. 고객 답변과 알림으로 전달되지 않습니다.</p>
    {notes.length ? <ol className="col" style={{ gap: 12, listStyle: 'none', margin: 0, padding: 0 }}>
      {notes.map((note) => <li className="col" key={note.id} style={{ gap: 4 }}>
        <span className="muted" style={{ fontSize: 12 }}>{note.authorName} · {formatInquiryDateTime(note.createdAt)}</span>
        <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note.body}</p>
      </li>)}
    </ol> : <span className="muted">등록된 내부 메모가 없습니다.</span>}
    <form action={action} className="col" style={{ gap: 8 }}>
      <input name="inquiryId" type="hidden" value={inquiryId} />
      <label className="col" style={{ gap: 4 }}>
        내부 메모 내용
        <textarea maxLength={MAX_INQUIRY_BODY_LENGTH} name="body" onChange={(event) => setBody(event.target.value)} required rows={4} value={body} />
      </label>
      <Feedback state={state} />
      <button className="btn btn-sm" disabled={pending} type="submit">{pending ? '저장 중' : '내부 메모 저장'}</button>
    </form>
  </section>;
}
