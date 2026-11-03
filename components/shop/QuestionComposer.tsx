'use client';

import { useActionState, useId, useState } from 'react';
import { askProductQuestionAction, type ProductQuestionActionState } from '@/app/shop/question-actions';
import { WcButton } from '@/components/wc/WcButton';
import {
  MAX_PRODUCT_QUESTION_BODY_LENGTH,
  SECRET_PRODUCT_QUESTION_HINT,
  SECRET_PRODUCT_QUESTION_OPTION_LABEL,
} from '@/lib/product-questions';

/* 굿즈 상세 Q&A 탭의 질문 입력(#330).
 *
 * 비로그인에게도 보인다. 폼을 감추면 "질문할 수 없는 상품"으로 보이고, 로그인은
 * 제출 시점에 액션이 요구한다(공개 브라우징 원칙).
 *
 * 여기서 쓰는 말은 전부 "질문"이다 — 같은 상세 화면 아래에 비공개 1:1 진입점이
 * 따로 있어서, 두 표면이 같은 낱말을 쓰면 사용자는 자기 글이 공개인지 비공개인지
 * 구분할 수 없게 된다. */

const EMPTY_STATE: ProductQuestionActionState = {};

/**
 * 입력 칸.
 *
 * 성공한 등록마다 바뀌는 `resultKey` 로 통째로 remount 시켜 값과 글자 수를 함께
 * 비운다 — 두 상태를 effect 로 되돌리면 둘 중 하나만 비워지는 날이 온다.
 */
function QuestionField({ error }: { error?: string }) {
  const [value, setValue] = useState('');

  return (
    <label className="wc-qna-form__field">
      <span className="wc-sr-only">질문 내용</span>
      <textarea
        className="wc-qna-form__input"
        maxLength={MAX_PRODUCT_QUESTION_BODY_LENGTH}
        name="body"
        onChange={(event) => setValue(event.target.value)}
        placeholder="구성, 사이즈, 재입고처럼 이 굿즈에 대해 궁금한 점을 남겨주세요."
        rows={4}
        value={value}
      />
      <span className="wc-qna-form__count">
        {value.length} / {MAX_PRODUCT_QUESTION_BODY_LENGTH}
      </span>
      {error ? <span className="wc-qna-form__error" role="alert">{error}</span> : null}
    </label>
  );
}

/**
 * 폼 초기화가 비밀글 선택을 풀지 않게 한다.
 *
 * React 19 의 폼 액션은 제출이 끝나면 결과와 무관하게 `form.reset()` 을 부른다. 제어 체크박스라도
 * React 는 `defaultChecked` 를 처음 그릴 때만 맞추므로, 등록이 실패하면 화면의 체크가 조용히
 * 풀리고 다시 누른 제출은 숨기려던 질문을 공개로 올린다. 바꿀 때마다 기본값을 현재 선택으로
 * 옮겨 두면 초기화가 같은 선택으로 되돌아온다. 체크를 비우는 것은 성공한 등록뿐이다
 * (`resultKey` remount — 입력 칸과 같은 규칙).
 */
export function keepSecretChoiceAcrossFormReset(input: { checked: boolean; defaultChecked: boolean }) {
  input.defaultChecked = input.checked;
  return input.checked;
}

/** 비밀글 선택(MD-0023). 범위 안내는 체크박스의 설명으로 읽힌다. */
function SecretOption() {
  const [checked, setChecked] = useState(false);
  const hintId = useId();

  return (
    <div className="wc-qna-form__secret">
      <label className="wc-qna-form__secret-label">
        <input
          aria-describedby={hintId}
          checked={checked}
          name="secret"
          onChange={(event) => setChecked(keepSecretChoiceAcrossFormReset(event.currentTarget))}
          type="checkbox"
          value="true"
        />
        <span>{SECRET_PRODUCT_QUESTION_OPTION_LABEL}</span>
      </label>
      <span className="wc-qna-form__secret-hint" id={hintId}>{SECRET_PRODUCT_QUESTION_HINT}</span>
    </div>
  );
}

export function QuestionComposer({ goodId, next }: { goodId: string; next: string }) {
  const [state, action, pending] = useActionState(askProductQuestionAction, EMPTY_STATE);

  return (
    <form action={action} className="wc-qna-form">
      <input name="goodId" type="hidden" value={goodId} />
      <input name="next" type="hidden" value={next} />

      <QuestionField error={state.errors?.body} key={state.resultKey ?? 'new'} />
      <SecretOption key={`secret-${state.resultKey ?? 'new'}`} />

      <div className="wc-qna-form__actions">
        <p className="wc-qna-form__note">
          비밀글이 아닌 질문과 답변은 굿즈 상세에 공개됩니다. 주문번호·연락처 같은 개인정보는 남기지 마세요.
        </p>
        <WcButton disabled={pending} type="submit" variant="primary">
          {pending ? '등록 중' : '질문 등록'}
        </WcButton>
      </div>

      {/* 성공과 실패가 같은 자리에서 읽힌다 — 결과를 찾아 화면을 훑게 하지 않는다. */}
      <p aria-live="polite" className="wc-qna-form__result">
        {state.errors?.form ? (
          <span className="wc-qna-form__error">{state.errors.form}</span>
        ) : state.message ? (
          <span className="wc-qna-form__success">{state.message}</span>
        ) : null}
      </p>
    </form>
  );
}
