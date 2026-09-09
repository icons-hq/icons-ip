'use client';

import { useActionState, useId } from 'react';
import { deleteFaqAction, saveFaqAction, type FaqActionState } from '@/app/admin/faq-actions';
import { FAQ_CATEGORIES, FAQ_QUESTION_MAX_LENGTH, FAQ_ANSWER_MAX_LENGTH, type FaqEntry } from '@/lib/faq';

const EMPTY: FaqActionState = {};
export function FaqEntryForm({ entry }: { entry?: FaqEntry }) {
  const [state, action, pending] = useActionState(saveFaqAction, EMPTY);
  const prefix = useId();
  const values = state.values;
  const value = (name: string, fallback: string) => values?.[name] ?? fallback;
  const error = (name: string) => state.errors?.[name] ? <span id={`${prefix}-${name}-error`} className="admin-faq__error" role="alert">{state.errors[name]}</span> : null;
  const fieldProps = (name: string) => ({ 'aria-invalid': Boolean(state.errors?.[name]), 'aria-describedby': state.errors?.[name] ? `${prefix}-${name}-error` : undefined });
  return <form action={action} className="admin-faq__form">
    <fieldset key={state.revision ?? 0} disabled={pending}>
      <input type="hidden" name="id" value={entry?.id ?? ''} />
      <input type="hidden" name="updatedAt" value={value('updatedAt', entry?.updatedAt ?? '')} />
      <div className="admin-faq__form-row">
        <label>카테고리<select name="category" defaultValue={value('category', entry?.category ?? 'order')} {...fieldProps('category')}>
          {FAQ_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
        </select>{error('category')}</label>
        <label>게시 상태<select name="published" defaultValue={value('published', entry?.published ? 'true' : 'false')} {...fieldProps('published')}>
          <option value="false">비공개</option><option value="true">공개</option>
        </select>{error('published')}</label>
        <label>표시 순서<input name="sortOrder" type="number" min={0} max={9999} step={1} defaultValue={value('sortOrder', String(entry?.sortOrder ?? 0))} {...fieldProps('sortOrder')} />{error('sortOrder')}</label>
      </div>
      <label>질문<input name="question" defaultValue={value('question', entry?.question ?? '')} maxLength={FAQ_QUESTION_MAX_LENGTH} required {...fieldProps('question')} />{error('question')}</label>
      <label>답변<textarea name="answer" rows={6} defaultValue={value('answer', entry?.answer ?? '')} maxLength={FAQ_ANSWER_MAX_LENGTH} required {...fieldProps('answer')} />{error('answer')}</label>
      <p className="admin-faq__hint">작은 순서부터 먼저 표시됩니다. 공개하면 고객센터와 문의 전 제안에 바로 표시됩니다.</p>
      <button type="submit">{pending ? '저장 중…' : entry ? 'FAQ 수정 저장' : 'FAQ 등록'}</button>
    </fieldset>
    {error('form')}
    {state.message ? <p role="status">{state.message}</p> : null}
  </form>;
}
export function FaqDeleteForm({ entry }: { entry: FaqEntry }) {
  const [state, action, pending] = useActionState(deleteFaqAction, EMPTY);
  return <details className="admin-faq__delete">
    <summary>FAQ 삭제</summary>
    <form action={action}>
      <input type="hidden" name="id" value={entry.id} />
      <input type="hidden" name="updatedAt" value={entry.updatedAt} />
      <p>질문과 답변을 삭제합니다. 잠시 숨기려면 게시 상태를 비공개로 바꿔주세요.</p>
      <label><input name="confirmed" type="checkbox" value="true" required disabled={pending} /> 이 FAQ를 삭제하겠습니다.</label>
      <button type="submit" disabled={pending}>{pending ? '삭제 중…' : '삭제 확정'}</button>
      {state.errors?.form ? <p role="alert">{state.errors.form}</p> : null}
      {state.message ? <p role="status">{state.message}</p> : null}
    </form>
  </details>;
}
