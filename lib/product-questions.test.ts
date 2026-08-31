import { describe, expect, it } from 'vitest';
import {
  MAX_PRODUCT_QUESTION_BODY_LENGTH,
  goodQuestionsHref,
  normalizeGoodQuestionOptions,
  normalizeProductQuestionForm,
  productQuestionAuthorName,
  productQuestionPageWindow,
  productQuestionState,
  questionStateLabel,
} from './product-questions';

const USER_ID = '33333333-3333-4333-8333-333333333333';

describe('questionStateLabel', () => {
  it('답변 여부로 대기·완료를 가른다', () => {
    expect(questionStateLabel({ status: 'visible', answerBody: null })).toBe('답변 대기');
    expect(questionStateLabel({ status: 'visible', answerBody: '내일 재입고됩니다.' })).toBe('답변 완료');
  });

  /* 답변이 달린 뒤 내려간 글에 "답변 완료"만 적으면 작성자는 자기 글이 왜 굿즈
     상세에서 사라졌는지 알 방법이 없다. */
  it('블라인드가 답변 여부를 이긴다', () => {
    expect(productQuestionState({ status: 'hidden', answerBody: '답변' })).toBe('hidden');
    expect(questionStateLabel({ status: 'hidden', answerBody: '답변' })).toBe('비공개 처리됨');
  });
});

describe('productQuestionAuthorName', () => {
  /* 같은 굿즈 상세에서 리뷰는 닉네임을 그대로 보여 준다 — Q&A만 다르게 접으면
     같은 사람이 두 이름으로 보인다. */
  it('닉네임이 있으면 그대로 쓰고 없으면 리뷰와 같은 fan_ 폴백을 쓴다', () => {
    expect(productQuestionAuthorName({ nickname: '아이콘즈팬', userId: USER_ID })).toBe('아이콘즈팬');
    expect(productQuestionAuthorName({ nickname: '  ', userId: USER_ID })).toBe('fan_333333');
    expect(productQuestionAuthorName({ nickname: null, userId: USER_ID })).toBe('fan_333333');
  });
});

describe('goodQuestionsHref', () => {
  /* 1페이지에서도 파라미터를 뺀 "깨끗한" URL을 만들면 굿즈 상세가 상세정보 탭에서
     열리고, #qna 앵커가 숨겨진 패널을 가리켜 클릭이 아무 일도 하지 않는다. */
  it('1페이지에서도 qnaPage를 실어 Q&A 탭으로 도착시킨다', () => {
    expect(goodQuestionsHref('g13')).toBe('/shop/g13?qnaPage=1#qna');
    expect(goodQuestionsHref('g13', 3)).toBe('/shop/g13?qnaPage=3#qna');
    expect(goodQuestionsHref('g13', 0)).toBe('/shop/g13?qnaPage=1#qna');
  });
});

describe('normalizeGoodQuestionOptions', () => {
  it('모르는 페이지 값은 1로 접는다', () => {
    expect(normalizeGoodQuestionOptions({})).toEqual({ page: 1 });
    expect(normalizeGoodQuestionOptions({ qnaPage: '4' })).toEqual({ page: 4 });
    expect(normalizeGoodQuestionOptions({ qnaPage: '-2' })).toEqual({ page: 1 });
    expect(normalizeGoodQuestionOptions({ qnaPage: 'last' })).toEqual({ page: 1 });
    expect(normalizeGoodQuestionOptions({ qnaPage: ['2', '3'] })).toEqual({ page: 1 });
  });
});

describe('productQuestionPageWindow', () => {
  /* 끝 페이지에서 창이 줄어들면 페이저 폭이 흔들려 다음 클릭 지점이 이동한다. */
  it('페이지 수가 넉넉하면 창 크기를 유지한다', () => {
    expect(productQuestionPageWindow(1, 10)).toEqual([1, 2, 3, 4, 5]);
    expect(productQuestionPageWindow(10, 10)).toEqual([6, 7, 8, 9, 10]);
    expect(productQuestionPageWindow(1, 2)).toEqual([1, 2]);
  });
});

describe('normalizeProductQuestionForm', () => {
  function formOf(entries: Record<string, string>) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(entries)) formData.set(key, value);
    return formData;
  }

  it('앞뒤 공백을 지우고 굿즈와 본문을 넘긴다', () => {
    const result = normalizeProductQuestionForm(formOf({ goodId: ' g13 ', body: '  재입고 예정이 있나요?  ' }));

    expect(result).toEqual({ ok: true, value: { goodId: 'g13', body: '재입고 예정이 있나요?' } });
  });

  it('빈 본문과 굿즈 없는 제출을 막는다', () => {
    const blank = normalizeProductQuestionForm(formOf({ goodId: 'g13', body: '   ' }));
    expect(blank.ok).toBe(false);
    expect(blank.ok === false && blank.errors.body).toBe('질문 내용을 입력해주세요.');

    const noGood = normalizeProductQuestionForm(formOf({ body: '질문' }));
    expect(noGood.ok).toBe(false);
    expect(noGood.ok === false && noGood.errors.form).toContain('굿즈를 찾을 수 없습니다');
  });

  /* DB의 CHECK 상한과 같은 경계여야 한다 — 한쪽만 넓히면 화면은 통과시키는데
     저장이 거절되는 폼이 된다. */
  it('DB 상한과 같은 1000자 경계를 쓴다', () => {
    const atLimit = normalizeProductQuestionForm(
      formOf({ goodId: 'g13', body: '가'.repeat(MAX_PRODUCT_QUESTION_BODY_LENGTH) }),
    );
    expect(atLimit.ok).toBe(true);

    const over = normalizeProductQuestionForm(
      formOf({ goodId: 'g13', body: '가'.repeat(MAX_PRODUCT_QUESTION_BODY_LENGTH + 1) }),
    );
    expect(over.ok).toBe(false);
    expect(over.ok === false && over.errors.body).toContain('1000자 이내');
  });
});
