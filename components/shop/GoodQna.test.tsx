import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoodQuestionSection } from '@/lib/product-questions.server';
import { GoodQna } from './GoodQna';

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

function question(overrides: Partial<GoodQuestionSection['questions'][number]> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    goodId: 'g13',
    userId: '33333333-3333-4333-8333-333333333333',
    body: '재입고 예정이 있나요?',
    status: 'visible' as const,
    answerBody: null,
    answeredAt: null,
    createdAt: '2026-08-30T01:00:00.000Z',
    authorName: '아이콘즈팬',
    ...overrides,
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
    expect(html).toContain('상품 Q&amp;A');
  });
});
