import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ADMIN_PRODUCT_QUESTION_FILTERS,
  type AdminProductQuestionConsoleData,
  type AdminProductQuestionRow,
} from '@/lib/admin/product-questions';
import { QnaConsoleScreen } from './QnaConsoleScreen';

/* 행 처리 패널은 'use client'라 서버 렌더 문자열에 훅이 섞이면 안 된다.
   여기서는 콘솔 구조(고정 줄·칩·그리드)만 검증한다. */
vi.mock('./QnaActionPanel', () => ({
  QnaActionPanel: ({ question }: { question: AdminProductQuestionRow }) => (
    <span data-testid={`action-${question.id}`} />
  ),
}));

function row(overrides: Partial<AdminProductQuestionRow> = {}): AdminProductQuestionRow {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    goodId: 'g13',
    goodName: '아크릴 블록',
    userId: '77777777-7777-4777-8777-777777777777',
    authorName: 'fan_777777',
    body: '사이즈가 궁금해요',
    hidden: false,
    answerBody: null,
    answeredAt: null,
    answeredByName: null,
    createdAt: '2026-08-31T02:00:00.000Z',
    ...overrides,
  };
}

function data(
  overrides: Partial<AdminProductQuestionConsoleData> = {},
): AdminProductQuestionConsoleData {
  return {
    filters: DEFAULT_ADMIN_PRODUCT_QUESTION_FILTERS,
    rows: [row()],
    counts: { total: 12, unanswered: 5, answered: 6, hidden: 1 },
    pageSize: 20,
    total: 12,
    ...overrides,
  };
}

function render(overrides: Partial<AdminProductQuestionConsoleData> = {}) {
  return renderToStaticMarkup(<QnaConsoleScreen data={data(overrides)} />);
}

describe('QnaConsoleScreen', () => {
  /* 구매 전 질문은 답이 늦으면 그대로 이탈이 된다 — 미답변 건수가 다른 조건
     사이에 섞여 있으면 "찾아서 거는" 필터가 된다. */
  it('미답변 건수를 목록 맨 위에 고정한다', () => {
    const markup = render();

    expect(markup).toContain('admin-console-pinned-filter');
    expect(markup).toContain('답변 미등록 5건');
    expect(markup).toContain('미답변만 보기');
  });

  it('미답변 필터가 걸려 있으면 해제 링크로 바뀐다', () => {
    const markup = render({ filters: { status: 'unanswered', page: 2 } });

    expect(markup).toContain('미답변 필터 해제');
  });

  it('상태별 칩 네 개를 0건이라도 전부 그린다', () => {
    const markup = render({ counts: { total: 0, unanswered: 0, answered: 0, hidden: 0 } });

    expect(markup).toContain('전체 0건');
    expect(markup).toContain('답변 미등록 0건');
    expect(markup).toContain('답변 완료 0건');
    expect(markup).toContain('비노출 0건');
  });

  it('행에 굿즈·작성자·본문 미리보기를 싣는다', () => {
    const markup = render();

    expect(markup).toContain('/shop/g13#qna');
    expect(markup).toContain('아크릴 블록');
    expect(markup).toContain('@fan_777777');
    expect(markup).toContain('사이즈가 궁금해요');
  });

  it('답변 여부와 답변자를 상태로 읽어 준다', () => {
    const answered = render({
      rows: [row({
        answerBody: '235mm 입니다',
        answeredAt: '2026-08-31T05:00:00.000Z',
        answeredByName: '운영자A',
      })],
    });

    expect(answered).toContain('등록됨');
    expect(answered).toContain('@운영자A');
    expect(render()).toContain('미등록');
  });

  /* 색만으로 구분하지 않는다 — 비노출 상태는 문구로도 남아야 한다. */
  it('비노출 질문을 상태 값과 문구 양쪽으로 표시한다', () => {
    const markup = render({ rows: [row({ hidden: true })] });

    expect(markup).toContain('data-question-status="hidden"');
    expect(markup).toContain('비노출');
  });

  it('조건에 맞는 질문이 없으면 그 사실을 말한다', () => {
    const markup = render({ rows: [], total: 0 });

    expect(markup).toContain('조건에 맞는 질문이 없습니다.');
  });

  /* 공개 Q&A 와 비공개 1:1 문의를 섞으면 운영자가 공개 표면에 1:1 답변 문구를
     그대로 쓴다(CONTEXT.md). 두 콘솔의 차이를 화면이 직접 말한다. */
  it('비공개 1:1 문의와 다른 표면임을 안내한다', () => {
    const markup = render();

    expect(markup).toContain('/admin/cs/inquiries');
    expect(markup).toContain('굿즈 상세에 공개로 붙는 구매 전 질문');
  });

  it('페이지네이션이 전체 건수를 그대로 읽는다', () => {
    const markup = render();

    expect(markup).toContain('전체 12건');
  });
});
