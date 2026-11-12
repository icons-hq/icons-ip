'use client';

import { useActionState, useId, useRef } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { deleteFaqAction, saveFaqAction, type FaqActionState } from '@/app/admin/faq-actions';
import { FAQ_CATEGORIES, FAQ_QUESTION_MAX_LENGTH, FAQ_ANSWER_MAX_LENGTH, FAQ_WIDGET_TOPICS, type FaqEntry } from '@/lib/faq';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { AdminSelect } from '@/components/admin/console/AdminSelect';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { DIALOG_BODY, DIALOG_HEADER, DIALOG_TITLE, NATIVE_DIALOG } from '@/components/admin/settings-kit';
import { FIELD_LABEL_CLASS } from './cs-kit-classes';
import { useAdminLeaveGuard } from '../useAdminLeaveGuard';

const EMPTY: FaqActionState = {};
const LABEL_CLASS = 'flex min-w-0 flex-col gap-1.5';
export function FaqEntryForm({ entry }: { entry?: FaqEntry }) {
  const [state, action, pending] = useActionState(saveFaqAction, EMPTY);
  const { formRef } = useAdminLeaveGuard({ serverState: state });
  const prefix = useId();
  const values = state.values;
  const value = (name: string, fallback: string) => values?.[name] ?? fallback;
  const error = (name: string) => state.errors?.[name] ? <span id={`${prefix}-${name}-error`} className="text-sm text-destructive" role="alert">{state.errors[name]}</span> : null;
  const fieldProps = (name: string) => ({ 'aria-invalid': Boolean(state.errors?.[name]), 'aria-describedby': state.errors?.[name] ? `${prefix}-${name}-error` : undefined });
  /* 필수·형식 검사는 서버가 칸마다 돌려준다(입력값 유지) — 브라우저 말풍선 대신 칸 아래 오류로 통일한다. */
  return <form action={action} className="flex flex-col gap-3" data-faq-form="" noValidate ref={formRef}>
    <fieldset className="flex min-w-0 flex-col gap-4 disabled:opacity-60" key={state.revision ?? 0} disabled={pending}>
      <input type="hidden" name="id" value={entry?.id ?? ''} />
      <input type="hidden" name="updatedAt" value={value('updatedAt', entry?.updatedAt ?? '')} />
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>카테고리</span><AdminSelect name="category" defaultValue={value('category', entry?.category ?? 'order')} {...fieldProps('category')}>
          {FAQ_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{adminGoodsCopy(category.label)}</option>)}
        </AdminSelect>{error('category')}</label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>게시 상태</span><AdminSelect name="published" defaultValue={value('published', entry?.published ? 'true' : 'false')} {...fieldProps('published')}>
          <option value="false">비공개</option><option value="true">공개</option>
        </AdminSelect>{error('published')}</label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>표시 순서</span><Input name="sortOrder" type="number" min={0} max={9999} step={1} defaultValue={value('sortOrder', String(entry?.sortOrder ?? 0))} {...fieldProps('sortOrder')} />{error('sortOrder')}</label>
      </div>
      <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>질문</span><Input name="question" defaultValue={value('question', entry?.question ?? '')} maxLength={FAQ_QUESTION_MAX_LENGTH} required {...fieldProps('question')} />{error('question')}</label>
      <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>답변</span><Textarea className="min-h-36" name="answer" rows={6} defaultValue={value('answer', entry?.answer ?? '')} maxLength={FAQ_ANSWER_MAX_LENGTH} required {...fieldProps('answer')} />{error('answer')}</label>
      {/* 0901-044: 고객 상담 위젯의 FAQ 위 유형 버튼이 보여 줄 대표 답변. 버튼마다 하나라 저장하면 다른 FAQ의 지정이 풀린다. */}
      <div className={LABEL_CLASS}>
        <label className={`${LABEL_CLASS} sm:max-w-xs`}><span className={FIELD_LABEL_CLASS}>상담 위젯 버튼</span><AdminSelect name="widgetTopic" defaultValue={value('widgetTopic', entry?.widgetTopic ?? '')} aria-describedby={`${prefix}-widgetTopic-hint${state.errors?.widgetTopic ? ` ${prefix}-widgetTopic-error` : ''}`} aria-invalid={Boolean(state.errors?.widgetTopic)}>
          <option value="">지정 안 함</option>
          {FAQ_WIDGET_TOPICS.map((topic) => <option key={topic.id} value={topic.id}>{topic.label}</option>)}
        </AdminSelect></label>
        <span className="text-xs text-muted-foreground" id={`${prefix}-widgetTopic-hint`}>고객 상담 위젯의 FAQ 위 버튼을 누르면 이 FAQ가 답으로 보입니다. 버튼마다 하나만 지정되며, 다른 FAQ에 지정돼 있었다면 이 FAQ로 바뀝니다. 공개 FAQ일 때만 고객에게 보입니다.</span>
        {error('widgetTopic')}
      </div>
      <p className="text-xs text-muted-foreground">작은 순서부터 먼저 표시됩니다. 공개하면 고객센터와 문의 전 제안에 바로 표시됩니다.</p>
      <Button className="self-start" type="submit">{pending ? '저장 중…' : entry ? 'FAQ 수정 저장' : 'FAQ 등록'}</Button>
    </fieldset>
    {error('form')}
    {state.message ? <p className="text-sm text-success" role="status">{state.message}</p> : null}
  </form>;
}
/** 화면 머리의 등록 버튼 + 등록 팝업. 폼은 그대로 등록 저장을 하고, 저장 후에는 안내를 보이며 다음 등록을 받는다. */
export function FaqCreateDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <Button onClick={() => dialog.current?.showModal()} type="button"><Plus aria-hidden="true" />새 FAQ 등록</Button>
    <dialog aria-label="새 FAQ 등록" className={NATIVE_DIALOG} ref={dialog}>
      <header className={DIALOG_HEADER}><h2 className={DIALOG_TITLE}>새 FAQ 등록</h2><Button aria-label="새 FAQ 등록 닫기" onClick={() => dialog.current?.close()} size="icon-sm" type="button" variant="ghost"><X /></Button></header>
      <div className={DIALOG_BODY}><FaqEntryForm /></div>
    </dialog>
  </>;
}
export function FaqDeleteForm({ entry }: { entry: FaqEntry }) {
  const [state, action, pending] = useActionState(deleteFaqAction, EMPTY);
  return <details className="group/delete border-t pt-4">
    <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm text-destructive underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">FAQ 삭제<ChevronDown aria-hidden="true" className="size-4 transition-transform group-open/delete:rotate-180" /></summary>
    <form action={action} className="mt-3 flex flex-col items-start gap-3 rounded-lg border border-danger-border bg-danger-soft p-4">
      <input type="hidden" name="id" value={entry.id} />
      <input type="hidden" name="updatedAt" value={entry.updatedAt} />
      <p className="text-sm">질문과 답변을 삭제합니다. 잠시 숨기려면 게시 상태를 비공개로 바꿔주세요.</p>
      <label className="flex items-center gap-2 text-sm"><input name="confirmed" type="checkbox" value="true" required disabled={pending} /> 이 FAQ를 삭제하겠습니다.</label>
      <Button disabled={pending} size="sm" type="submit" variant="destructive">{pending ? '삭제 중…' : '삭제 확정'}</Button>
      {state.errors?.form ? <p className="bg-transparent text-sm text-destructive" role="alert">{state.errors.form}</p> : null}
      {state.message ? <p className="text-sm text-success" role="status">{state.message}</p> : null}
    </form>
  </details>;
}
