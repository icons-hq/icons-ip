'use client';

import { useActionState, useRef, useState } from 'react';
import {
  answerInquiryAction,
  closeInquiryAction,
  deleteInquiryReplyTemplateAction,
  saveInquiryReplyTemplateAction,
  type AdminInquiryActionState,
} from '@/app/admin/inquiry-actions';
import type { AdminInquiryReplyTemplate } from '@/lib/admin/inquiries.server';
import {
  INQUIRY_IMAGE_ACCEPT,
  MAX_INQUIRY_BODY_LENGTH,
  MAX_INQUIRY_IMAGES,
  type InquiryCategory,
} from '@/lib/inquiries';

/* 답변 작성 패널(#253).
 *
 * 템플릿은 "삽입"이지 "치환"이 아니다. 이미 쓰던 문장을 지우고 덮어쓰면 운영자가
 * 작성 중이던 내용을 잃는다 — 커서 위치를 모르는 서버 렌더 폼에서는 뒤에 붙이는 편이
 * 유일하게 안전한 삽입이다.
 *
 * [답변 발송]과 [종결]은 다른 폼이다. 하나의 폼에 두 버튼을 두면 브라우저 기본 제출
 * (엔터)이 어느 쪽으로 갈지 마크업 순서에 좌우된다. */

const EMPTY_STATE: AdminInquiryActionState = {};

function Feedback({ state }: { state: AdminInquiryActionState }) {
  return (
    <>
      {state.errors?.form ? (
        <span role="alert" style={{ fontSize: 12.5 }}>{state.errors.form}</span>
      ) : null}
      {state.errors?.body ? (
        <span role="alert" style={{ fontSize: 12.5 }}>{state.errors.body}</span>
      ) : null}
      {state.errors?.images ? (
        <span role="alert" style={{ fontSize: 12.5 }}>{state.errors.images}</span>
      ) : null}
      {state.message ? (
        <span className="muted" role="status" style={{ fontSize: 12.5 }}>{state.message}</span>
      ) : null}
    </>
  );
}

export function InquiryReplyPanel({
  category,
  closed,
  inquiryId,
  templates,
}: {
  category: InquiryCategory;
  closed: boolean;
  inquiryId: string;
  templates: AdminInquiryReplyTemplate[];
}) {
  const [answerState, answerAction, answerPending] = useActionState(answerInquiryAction, EMPTY_STATE);
  const [closeState, closeAction, closePending] = useActionState(closeInquiryAction, EMPTY_STATE);
  const [templateState, templateAction, templatePending] = useActionState(
    saveInquiryReplyTemplateAction,
    EMPTY_STATE,
  );
  const [deleteState, deleteAction] = useActionState(deleteInquiryReplyTemplateAction, EMPTY_STATE);
  const [body, setBody] = useState('');
  const [clearedKey, setClearedKey] = useState<string | null>(null);
  const [templateFormOpen, setTemplateFormOpen] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  /* 발송에 성공하면 작성창을 비운다. 남겨 두면 운영자가 같은 답변을 한 번 더 보낸다.
     effect가 아니라 렌더 중 조정이다 — 액션 결과에 맞춰 상태를 맞추는 일이라
     한 번 더 렌더될 뿐 화면이 두 번 깜빡이지 않는다. */
  if (answerState.resultKey && answerState.resultKey !== clearedKey) {
    setClearedKey(answerState.resultKey);
    setBody('');
  }

  function insertTemplate(templateBody: string) {
    setBody((current) => (current.trim() ? `${current}\n\n${templateBody}` : templateBody));
    bodyRef.current?.focus();
  }

  if (closed) {
    return (
      <section className="card col" style={{ borderRadius: 12, gap: 8, padding: 18 }}>
        <strong>종결된 문의입니다.</strong>
        <span className="muted" style={{ fontSize: 13 }}>
          종결 후에도 기록은 남습니다. 구매자가 이어서 물으려면 새 문의를 접수해야 합니다.
        </span>
      </section>
    );
  }

  return (
    <section className="card col" style={{ borderRadius: 12, gap: 14, padding: 18 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <strong>답변 작성</strong>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => setTemplateFormOpen((open) => !open)}
          type="button"
        >
          {templateFormOpen ? '템플릿 저장 닫기' : '현재 답변을 템플릿으로 저장'}
        </button>
      </div>

      {templates.length ? (
        <div className="col" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>답변 템플릿</span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, justifyContent: 'flex-start' }}>
            {templates.map((template) => (
              <span key={template.id} className="row" style={{ gap: 4 }}>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => insertTemplate(template.body)}
                  title={template.body}
                  type="button"
                >
                  {template.title}
                </button>
                <form action={deleteAction}>
                  <input name="inquiryId" type="hidden" value={inquiryId} />
                  <input name="templateId" type="hidden" value={template.id} />
                  <button
                    aria-label={`${template.title} 템플릿 삭제`}
                    className="btn btn-sm btn-ghost"
                    type="submit"
                  >
                    ×
                  </button>
                </form>
              </span>
            ))}
          </div>
          <Feedback state={deleteState} />
        </div>
      ) : null}

      <form action={answerAction} className="col" style={{ gap: 10 }}>
        <input name="category" type="hidden" value={category} />
        <input name="inquiryId" type="hidden" value={inquiryId} />
        <label className="col" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>답변 내용</span>
          <textarea
            maxLength={MAX_INQUIRY_BODY_LENGTH}
            name="body"
            onChange={(event) => setBody(event.target.value)}
            placeholder="구매자가 메일에서 그대로 읽습니다. 결론을 먼저 적어주세요."
            ref={bodyRef}
            rows={8}
            value={body}
          />
        </label>
        <label className="col" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            이미지 첨부 · 최대 {MAX_INQUIRY_IMAGES}장
          </span>
          <input accept={INQUIRY_IMAGE_ACCEPT} multiple name="images" type="file" />
        </label>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" disabled={answerPending} type="submit">
            {answerPending ? '발송 중' : '답변 발송'}
          </button>
        </div>
        <Feedback state={answerState} />
      </form>

      {templateFormOpen ? (
        <form action={templateAction} className="col" style={{ gap: 8 }}>
          <input name="inquiryId" type="hidden" value={inquiryId} />
          <input name="templateBody" type="hidden" value={body} />
          <label className="col" style={{ gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>템플릿 이름</span>
            <input maxLength={40} name="templateTitle" placeholder="예: 배송 지연 안내" type="text" />
          </label>
          <span className="muted" style={{ fontSize: 12 }}>
            위 답변 입력창의 현재 내용을 그대로 저장합니다.
          </span>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" disabled={templatePending} type="submit">
              {templatePending ? '저장 중' : '템플릿 저장'}
            </button>
          </div>
          <Feedback state={templateState} />
        </form>
      ) : null}

      <form action={closeAction} className="col" style={{ gap: 6 }}>
        <input name="inquiryId" type="hidden" value={inquiryId} />
        <div className="row" style={{ alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            답변 후 7일 동안 추가 질문이 없으면 자동으로 종결됩니다.
          </span>
          <button className="btn btn-sm btn-ghost" disabled={closePending} type="submit">
            {closePending ? '종결 중' : '지금 종결'}
          </button>
        </div>
        <Feedback state={closeState} />
      </form>
    </section>
  );
}
