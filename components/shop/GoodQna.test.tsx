import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaskedProductQuestion, ProductQuestion } from '@/lib/product-questions';
import type { GoodQuestionSection } from '@/lib/product-questions.server';
import { GoodQna } from './GoodQna';
import { keepSecretChoiceAcrossFormReset } from './QuestionComposer';

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  pending: false,
  state: {} as { errors?: { body?: string; form?: string }; message?: string; resultKey?: string },
  submit: vi.fn(),
}));

vi.mock('@/app/shop/question-actions', () => ({ askProductQuestionAction: mocks.action }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: () => [mocks.state, mocks.submit, mocks.pending],
  };
});

function question(overrides: Partial<ProductQuestion> = {}): ProductQuestion & { masked: false } {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    goodId: 'g13',
    userId: '33333333-3333-4333-8333-333333333333',
    body: '재입고 예정이 있나요?',
    status: 'visible' as const,
    isSecret: false,
    answerBody: null,
    answeredAt: null,
    createdAt: '2026-08-30T01:00:00.000Z',
    authorName: '아이콘즈팬',
    ...overrides,
    masked: false,
  };
}

/* DB 가 가린 남의 비밀글 줄. 본문·답변·작성자 필드가 아예 없다. */
function maskedQuestion(overrides: Partial<MaskedProductQuestion> = {}): MaskedProductQuestion {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    goodId: 'g13',
    answered: false,
    createdAt: '2026-08-29T01:00:00.000Z',
    ...overrides,
    masked: true,
    isSecret: true,
  };
}

function render(section: Partial<GoodQuestionSection> = {}) {
  return renderToStaticMarkup(
    <GoodQna
      goodId="g13"
      section={{
        questions: [question()],
        count: 1,
        page: 1,
        pageCount: 1,
        ...section,
      }}
    />,
  );
}

beforeEach(() => {
  mocks.state = {};
  mocks.pending = false;
});

describe('GoodQna', () => {
  it('질문을 작성자·날짜·상태와 함께 그린다', () => {
    const html = render();

    expect(html).toContain('wc-qna-item');
    expect(html).toContain('@아이콘즈팬');
    expect(html).toContain('재입고 예정이 있나요?');
    expect(html).toContain('답변 대기');
    expect(html).toContain('dateTime="2026-08-30T01:00:00.000Z"');
    expect(html).toContain('질문 1건');
  });

  /* 답변은 질문 아래 들여 붙는다 — 화자가 갈리지 않으면 운영 답변이 다른 구매자의
     말처럼 읽힌다. */
  it('운영 답변을 질문 아래 별도 블록으로 붙인다', () => {
    const html = render({
      questions: [question({
        answerBody: '다음 주 화요일 재입고 예정입니다.',
        answeredAt: '2026-08-31T02:00:00.000Z',
      })],
    });

    expect(html).toContain('wc-qna-item__answer');
    expect(html).toContain('ICONS 답변');
    expect(html).toContain('다음 주 화요일 재입고 예정입니다.');
    expect(html).toContain('답변 완료');
  });

  it('질문이 없으면 첫 질문을 권한다', () => {
    const html = render({ questions: [], count: 0 });

    expect(html).toContain('아직 등록된 질문이 없어요. 첫 질문을 남겨보세요.');
    expect(html).not.toContain('wc-qna-item');
    /* 목록이 비어도 물어볼 자리는 남는다. */
    expect(html).toContain('name="body"');
  });

  /* 범위를 벗어난 페이지에서 "첫 질문을 남겨보세요"를 띄우면 앞 페이지의 질문들이
     없던 일이 된다. */
  it('질문은 있는데 이 페이지가 비면 첫 질문을 권하지 않는다', () => {
    const html = render({ questions: [], count: 12, page: 9, pageCount: 2 });

    expect(html).toContain('질문 12건');
    expect(html).toContain('이 페이지에는 질문이 없습니다.');
    expect(html).not.toContain('첫 질문을 남겨보세요');
  });

  /* 페이지 링크는 qnaPage 를 달고 있어야 도착한 화면이 Q&A 탭에서 열린다. */
  it('페이지가 여러 장이면 Q&A 탭으로 돌아오는 링크를 그린다', () => {
    const html = render({ page: 2, pageCount: 3, count: 25 });

    expect(html).toContain('href="/shop/g13?qnaPage=1#qna"');
    expect(html).toContain('href="/shop/g13?qnaPage=3#qna"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('>이전<');
    expect(html).toContain('>다음<');
  });

  it('페이지가 한 장이면 페이저를 그리지 않는다', () => {
    expect(render()).not.toContain('wc-pagination');
  });

  /* 비로그인에게도 폼을 보여 준다 — 감추면 "질문할 수 없는 상품"으로 보인다.
     로그인은 제출 시점에 액션이 요구한다. */
  it('로그인 여부와 무관하게 질문 입력 폼을 싣는다', () => {
    const html = render();

    expect(html).toContain('name="goodId"');
    expect(html).toContain('value="g13"');
    expect(html).toContain('name="next"');
    expect(html).toContain('value="/shop/g13?qnaPage=1#qna"');
    expect(html).toContain('>질문 등록<');
    expect(html).toContain('aria-live="polite"');
  });

  it('등록 결과를 폼 아래 한 자리에서 알린다', () => {
    mocks.state = { message: '질문을 등록했어요. 답변이 달리면 알림으로 알려드려요.' };
    expect(render()).toContain('질문을 등록했어요');

    mocks.state = { errors: { body: '질문 내용을 입력해주세요.' } };
    const html = render();
    expect(html).toContain('질문 내용을 입력해주세요.');
    expect(html).toContain('role="alert"');
  });

  /*
   * 상품 Q&A 와 비공개 1:1 문의는 다른 표면이다(CONTEXT.md). 이 지면이 "문의"라는
   * 말을 한 번이라도 쓰면 사용자는 자기 글이 공개인지 비공개인지 구분할 수 없고,
   * 같은 상세 화면 아래에 있는 1:1 진입점과 목적지를 섞는다.
   */
  it('공개 Q&A 지면에 문의·리뷰 어휘를 쓰지 않는다', () => {
    const html = render({
      questions: [question({ answerBody: '답변입니다.', answeredAt: '2026-08-31T02:00:00.000Z' })],
    });

    expect(html).not.toContain('문의');
    expect(html).not.toContain('리뷰');
    expect(html).toContain('굿즈 Q&amp;A');
  });
});

describe('GoodQna 비밀글 (MD-0023)', () => {
  /* 남의 비밀글은 줄의 자리만 지킨다 — 작성일과 답변 여부는 남고, 본문 자리에는 한 문장만 선다. */
  it('가린 비밀글은 "비밀글입니다."와 작성일·답변 여부만 그린다', () => {
    const html = render({
      questions: [maskedQuestion({ answered: true })],
      count: 1,
    });

    expect(html).toContain('비밀글입니다.');
    expect(html).toContain('>비밀글<');
    expect(html).toContain('답변 완료');
    expect(html).toContain('dateTime="2026-08-29T01:00:00.000Z"');
    expect(html).toContain('wc-qna-item is-secret');
    /* 누가 숨겨 물었는지도 비밀이다 — 작성자 자리와 답변 블록이 없다. */
    expect(html).not.toContain('wc-qna-item__author');
    expect(html).not.toContain('wc-qna-item__answer');
    expect(html).not.toContain('ICONS 답변');
    expect(html).toContain('질문 1건');
  });

  it('가린 비밀글도 답변 전이면 답변 대기로 읽힌다', () => {
    const html = render({ questions: [maskedQuestion({ answered: false })] });

    expect(html).toContain('답변 대기');
    expect(html).not.toContain('is-answered');
  });

  /* 작성자 본인에게는 DB 가 원문을 준다. 다른 사람에게는 가려진다는 것을 같은 줄에서 알린다. */
  it('작성자에게 열린 비밀글은 원문·답변을 비밀글 표시와 함께 그린다', () => {
    const html = render({
      questions: [question({
        isSecret: true,
        body: '배송지를 바꿀 수 있나요?',
        answerBody: '출고 전이면 바꿀 수 있습니다.',
        answeredAt: '2026-08-31T02:00:00.000Z',
      })],
    });

    expect(html).toContain('배송지를 바꿀 수 있나요?');
    expect(html).toContain('출고 전이면 바꿀 수 있습니다.');
    expect(html).toContain('>비밀글<');
    expect(html).toContain('@아이콘즈팬');
    expect(html).not.toContain('비밀글입니다.');
  });

  it('비밀글이 아닌 질문에는 비밀글 표시가 없다', () => {
    const html = render();

    expect(html).not.toContain('wc-qna-item__secret');
    expect(html).not.toContain('is-secret');
  });

  it('공개 질문과 가린 비밀글이 한 목록에 섞여도 각자의 모양으로 선다', () => {
    const html = render({ questions: [question(), maskedQuestion()], count: 2 });

    expect(html).toContain('재입고 예정이 있나요?');
    expect(html).toContain('비밀글입니다.');
    expect(html.match(/<li class="wc-qna-item/g)).toHaveLength(2);
  });

  /* 작성 폼의 비밀글 선택. 기본은 공개이고, 체크박스가 보내는 값은 `secret=true` 하나다. */
  it('작성 폼에 비밀글 선택과 공개 범위 안내를 싣는다', () => {
    const html = render();

    expect(html).toContain('비밀글로 질문하기');
    expect(html).toContain('판매자와 작성자만 볼 수 있습니다.');
    const checkbox = html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? '';
    expect(checkbox).toContain('name="secret"');
    expect(checkbox).toContain('value="true"');
    expect(checkbox).not.toContain('checked');
    /* 안내 문장이 체크박스의 설명으로 읽힌다. */
    const describedBy = checkbox.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
    expect(html).toContain('비밀글이 아닌 질문과 답변은 굿즈 상세에 공개됩니다.');
  });
});

describe('keepSecretChoiceAcrossFormReset', () => {
  /* React 19 폼 액션은 제출이 끝나면 결과와 무관하게 form.reset() 을 부른다. 제어 체크박스라도
     기본값이 처음 값(false)에 머물면, 등록이 실패한 뒤 체크가 조용히 풀려 다시 누른 제출이 숨기려던
     질문을 공개로 올린다. 바꿀 때마다 기본값을 현재 선택으로 옮겨 reset 이 같은 선택으로 돌아오게 한다. */
  it('바꿀 때마다 기본값을 현재 선택으로 옮긴다', () => {
    const input = { checked: true, defaultChecked: false };

    expect(keepSecretChoiceAcrossFormReset(input)).toBe(true);
    expect(input.defaultChecked).toBe(true);

    input.checked = false;
    expect(keepSecretChoiceAcrossFormReset(input)).toBe(false);
    expect(input.defaultChecked).toBe(false);
  });
});
