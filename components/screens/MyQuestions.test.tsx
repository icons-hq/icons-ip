import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MyProductQuestion } from '@/lib/product-questions';
import { MyQuestions } from './MyQuestions';

vi.mock('@/components/shell/CardRewardAvailability', () => ({
  useCardRewardsEnabled: () => true,
}));

function myQuestion(overrides: Partial<MyProductQuestion> = {}): MyProductQuestion {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    goodId: 'g13',
    userId: '33333333-3333-4333-8333-333333333333',
    body: '재입고 예정이 있나요?',
    status: 'visible',
    answerBody: null,
    answeredAt: null,
    createdAt: '2026-08-30T01:00:00.000Z',
    goodName: '아크릴 블록',
    goodPath: '/shop/g13?qnaPage=1#qna',
    ...overrides,
  };
}

function render(questions: MyProductQuestion[]) {
  return renderToStaticMarkup(<MyQuestions questions={questions} />);
}

describe('MyQuestions', () => {
  it('답변 대기 질문은 대상 굿즈 링크와 함께 기다리는 이유를 적는다', () => {
    const html = render([myQuestion()]);

    expect(html).toContain('>내 상품 Q&amp;A</h1>');
    expect(html).toContain('href="/shop/g13?qnaPage=1#qna"');
    expect(html).toContain('아크릴 블록');
    expect(html).toContain('답변 대기');
    expect(html).toContain('운영자가 답변을 남기면 알림으로 알려드립니다.');
    expect(html).toContain('aria-current="page"');
  });

  /* 셸 메뉴에 자리가 없으면 이 화면으로 돌아올 길이 알림 링크 하나뿐이 된다.
     이름은 '1:1 문의' 옆에 서므로 공개/비공개가 이름만으로 갈려야 한다. */
  it('마이페이지 고객센터 메뉴에 상품 Q&A 자리를 갖는다', () => {
    const html = render([myQuestion()]);
    const aside = html.slice(html.indexOf('wc-mypage__aside'), html.indexOf('wc-mypage__content'));

    expect(aside).toContain('href="/my/questions"');
    expect(aside).toContain('>상품 Q&amp;A</a>');
    expect(aside).toContain('>1:1 문의</a>');
  });

  it('답변이 달린 질문은 운영 답변을 함께 그린다', () => {
    const html = render([myQuestion({
      answerBody: '다음 주 화요일 재입고 예정입니다.',
      answeredAt: '2026-08-31T02:00:00.000Z',
    })]);

    expect(html).toContain('답변 완료');
    expect(html).toContain('ICONS 답변');
    expect(html).toContain('다음 주 화요일 재입고 예정입니다.');
  });

  /* 블라인드는 삭제가 아니다. 왜 안 보이는지 말하지 않으면 작성자는 자기 글이
     사라졌다고만 알게 되고, 물어볼 근거조차 갖지 못한다. */
  it('블라인드된 질문은 본인에게 비공개 처리됨으로 남는다', () => {
    const html = render([myQuestion({ status: 'hidden' })]);

    expect(html).toContain('비공개 처리됨');
    expect(html).toContain('wc-qna-badge--hidden');
    expect(html).toContain('굿즈 상세에는 보이지 않습니다');
    expect(html).toContain('재입고 예정이 있나요?');
  });

  it('남긴 질문이 없으면 굿즈로 가는 길을 준다', () => {
    const html = render([]);

    expect(html).toContain('아직 남긴 질문이 없어요');
    expect(html).toContain('href="/shop"');
    expect(html).not.toContain('wc-mypage__card');
  });

  /* 마이 표면에서도 공개 Q&A 와 비공개 1:1 은 다른 말이어야 한다 — 셸 메뉴의
     '1:1 문의' 항목은 예외다(그 표면의 이름 자체다). */
  it('본문 어디에도 Q&A를 문의라고 부르지 않는다', () => {
    const html = render([myQuestion()]);
    const content = html.slice(html.indexOf('wc-mypage__content'));

    expect(content).not.toContain('문의');
    expect(content).not.toContain('리뷰');
  });
});
