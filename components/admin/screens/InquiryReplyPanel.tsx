'use client';

import { useActionState, useId, useRef } from 'react';
import { Send } from 'lucide-react';
import { useInquiryDraft } from '@/components/admin/useInquiryDraft';
import { Button } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { InquiryDraftNotice } from './InquiryDraftNotice';
import { useInquiryPreviewBusy } from './CustomerServiceDialog';
import { KIT_INPUT_CLASS } from './cs-kit-classes';
import {
  answerInquiryAction,
  closeInquiryAction,
  type AdminInquiryActionState,
} from '@/app/admin/inquiry-actions';
import { InquiryReplyTemplateTools } from './InquiryReplyTemplateTools';
import {
  INQUIRY_IMAGE_ACCEPT,
  MAX_INQUIRY_BODY_LENGTH,
  MAX_INQUIRY_IMAGES,
  type InquiryCategory,
} from '@/lib/inquiries';

/* 답변 작성 패널(#253).
 *
 * 템플릿은 작성 중인 답변을 "대체"한다(10/27 회의 후속 R3, MD-0011). 뒤에 덧붙이면 운영자가
 * 매번 기존 문장을 지워야 했다. 작성 중인 내용이 있으면 템플릿 도구가 "작성 중인 내용을
 * 템플릿으로 바꿀까요?" 확인을 거친 뒤에만 바꾸므로, 실수로 쓰던 답변을 잃지 않는다.
 * 고객문의·상담하기·상품문의·리뷰 답변이 같은 도구(InquiryReplyTemplateTools·CsReplyTemplateTools)로
 * 같은 동작과 안내 문구를 쓴다.
 *
 * [답변 발송]과 [종결]은 다른 폼이다. 하나의 폼에 두 버튼을 두면 브라우저 기본 제출
 * (엔터)이 어느 쪽으로 갈지 마크업 순서에 좌우된다. 고객문의 답변은 실수 발송을 막기 위해
 * Enter 전송을 쓰지 않는다(상담하기만 Enter 전송, R5). */

const EMPTY_STATE: AdminInquiryActionState = {};

function Feedback({ state }: { state: AdminInquiryActionState }) {
  return (
    <>
      {state.errors?.form ? (
        <span className="text-sm text-destructive" role="alert">{state.errors.form}</span>
      ) : null}
      {state.errors?.body ? (
        <span className="text-sm text-destructive" role="alert">{state.errors.body}</span>
      ) : null}
      {state.errors?.images ? (
        <span className="text-sm text-destructive" role="alert">{state.errors.images}</span>
      ) : null}
      {state.message ? (
        <span className="text-sm text-muted-foreground" role="status">{state.message}</span>
      ) : null}
    </>
  );
}

export function InquiryReplyPanel({
  category,
  closed,
  inquiryId,
  accountId = '',
}: {
  category: InquiryCategory;
  closed: boolean;
  inquiryId: string;
  accountId?: string;
}) {
  const [answerState, answerAction, answerPending] = useActionState(answerInquiryAction, EMPTY_STATE);
  const [closeState, closeAction, closePending] = useActionState(closeInquiryAction, EMPTY_STATE);
  useInquiryPreviewBusy(answerPending || closePending); /* 목록 위 문의 팝업(R4)에서 발송·종결을 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const draft = useInquiryDraft(accountId, inquiryId, 'reply', answerState.resultKey);
  const { body, change: setBody } = draft;
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const busy = answerPending || closePending || !draft.ready || draft.blocked;
  const id = useId();

  function insertTemplate(nextBody: string) {
    setBody(nextBody);
    bodyRef.current?.focus();
  }

  if (closed) {
    return (
      <section className="flex flex-col gap-1.5 rounded-xl border bg-muted/40 p-4">
        <strong className="text-sm font-medium">종결된 문의입니다.</strong>
        <span className="text-sm text-muted-foreground">
          종결 후에도 기록은 남습니다. 구매자가 이어서 물으려면 새 문의를 접수해야 합니다.
        </span>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-medium text-foreground">답변 작성</h3>
        <InquiryReplyTemplateTools accountId={accountId} body={body} onInsert={insertTemplate} disabled={busy} />
      </div>
      <InquiryDraftNotice draft={draft} pending={busy} />

      <form action={answerAction} className="flex flex-col gap-3">
        <input name="category" type="hidden" value={category} />
        <input name="inquiryId" type="hidden" value={inquiryId} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-body`}>답변 내용</Label>
          <Textarea
            className="max-h-[60vh] min-h-40"
            disabled={busy}
            id={`${id}-body`}
            maxLength={MAX_INQUIRY_BODY_LENGTH}
            name="body"
            onChange={(event) => setBody(event.target.value)}
            placeholder="구매자가 메일에서 그대로 읽습니다. 결론을 먼저 적어주세요."
            ref={bodyRef}
            rows={8}
            value={body}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-images`}>이미지 첨부 · 최대 {MAX_INQUIRY_IMAGES}장</Label>
          <input className={KIT_INPUT_CLASS} data-slot="input" id={`${id}-images`} key={answerState.resultKey ?? 'initial'} disabled={busy} accept={INQUIRY_IMAGE_ACCEPT} multiple name="images" type="file" />
        </div>
        <div className="flex justify-end">
          <Button disabled={busy} type="submit">
            <Send aria-hidden="true" />{answerPending ? '발송 중' : '답변 발송'}
          </Button>
        </div>
        <Feedback state={answerState} />
      </form>

      <form action={closeAction} className="flex flex-col gap-2 border-t pt-4">
        <input name="inquiryId" type="hidden" value={inquiryId} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            답변 후 7일 동안 추가 질문이 없으면 자동으로 종결됩니다.
          </span>
          <Button disabled={busy} size="sm" type="submit" variant="outline">
            {closePending ? '종결 중' : '지금 종결'}
          </Button>
        </div>
        <Feedback state={closeState} />
      </form>
    </section>
  );
}
