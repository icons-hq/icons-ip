import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReviewConsoleScreen } from './ReviewConsoleScreen';
import {
  DEFAULT_ADMIN_REVIEW_FILTERS,
  type AdminReviewConsoleData,
  type AdminReviewRow,
} from '@/lib/admin/reviews';

/* 행 처리 패널은 'use client'라 서버 렌더 문자열에 훅이 섞이면 안 된다.
   여기서는 콘솔 구조(고정 필터·칩·그리드)만 검증한다. */
vi.mock('./ReviewActionPanel', () => ({
  ReviewActionPanel: ({ review }: { review: AdminReviewRow }) => (
    <span data-testid={`action-${review.id}`} />
  ),
}));

const NOW = new Date('2026-08-18T00:00:00.000Z');

function row(overrides: Partial<AdminReviewRow> = {}): AdminReviewRow {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    goodId: 'g13',
    goodName: '아크릴 블록',
    orderId: '66666666-6666-4666-8666-666666666666',
    userId: '77777777-7777-4777-8777-777777777777',
    authorName: 'fan_777777',
    authorEmail: 'fan@icons.gg',
    rating: 2,
    body: '색이 사진과 달라서 아쉬웠어요',
    imageUrls: [],
    imageCount: 0,
    status: 'visible',
    hiddenReason: null,
    hiddenAt: null,
    adminReply: null,
    adminReplyAt: null,
    replyAuthorName: null,
    reportCount: 0,
    openReportCount: 0,
    createdAt: '2026-08-17T02:00:00.000Z',
    editedAt: null,
    ...overrides,
  };
}

function data(overrides: Partial<AdminReviewConsoleData> = {}): AdminReviewConsoleData {
  return {
    filters: DEFAULT_ADMIN_REVIEW_FILTERS,
    rows: [row()],
    counts: { total: 12, lowRating: 3, awaitingReply: 5, hidden: 1, reported: 2 },
    pageSize: 20,
    total: 12,
    ...overrides,
  };
}

function render(overrides: Partial<AdminReviewConsoleData> = {}) {
  return renderToStaticMarkup(<ReviewConsoleScreen data={data(overrides)} now={NOW} />);
}

describe('ReviewConsoleScreen', () => {
  /* 리뷰 운영에서 가장 급한 일은 낮은 별점을 먼저 읽는 것이다. 그 조건이 셀렉트
     사이에 섞여 있으면 "찾아서 거는" 필터가 된다. */
  it('저평점 필터를 필터 패널보다 위에 고정한다', () => {
    const html = render();

    const pinnedIndex = html.indexOf('admin-console-pinned-filter');
    const panelIndex = html.indexOf('admin-console-filters');

    expect(pinnedIndex).toBeGreaterThanOrEqual(0);
    expect(pinnedIndex).toBeLessThan(panelIndex);
    expect(html).toContain('저평점 리뷰 3건');
    expect(html).toContain('저평점만 보기');
  });

  it('저평점 필터가 켜져 있으면 해제 링크로 바뀐다', () => {
    const html = render({ filters: { ...DEFAULT_ADMIN_REVIEW_FILTERS, lowRating: true } });

    expect(html).toContain('저평점 필터 해제');
    expect(html).not.toContain('저평점만 보기');
  });

  /* 0건 칩을 감추면 "정말 0건"과 "집계를 못 불러온 것"을 구분할 수 없다. */
  it('0건 상태도 칩으로 남긴다', () => {
    const html = render({
      counts: { total: 0, lowRating: 0, awaitingReply: 0, hidden: 0, reported: 0 },
      rows: [],
      total: 0,
    });

    expect(html).toContain('답글 미등록');
    expect(html).toContain('블라인드');
    expect(html).toContain('조건에 맞는 리뷰가 없습니다.');
  });

  it('요구된 그리드 칸을 모두 그린다', () => {
    const html = render();

    for (const label of ['작성일', '굿즈', '평점', '리뷰 내용', '사진', '작성자', '신고', '상태', '답글']) {
      expect(html).toContain(label);
    }
  });

  /* 별점을 색으로만 구분하면 저대비 환경에서 강조가 사라진다. */
  it('저평점 행에 데이터 표시를 남긴다', () => {
    expect(render()).toContain('data-low-rating="true"');
    expect(render({ rows: [row({ rating: 5 })] })).not.toContain('data-low-rating="true"');
  });

  /* 신고가 0건인 리뷰와 "신고는 있었지만 다 처리된" 리뷰는 다른 상황이다. */
  it('미처리 신고와 처리된 신고를 다르게 적는다', () => {
    expect(render({ rows: [row({ openReportCount: 2, reportCount: 3 })] }))
      .toContain('2건 미처리');
    expect(render({ rows: [row({ openReportCount: 0, reportCount: 3 })] }))
      .toContain('3건 처리됨');
  });

  it('답글 등록 여부를 그린다', () => {
    const html = render({
      rows: [row({ adminReply: '불편을 드려 죄송합니다', adminReplyAt: '2026-08-17T05:00:00.000Z', replyAuthorName: '운영자' })],
    });

    expect(html).toContain('등록됨');
    expect(html).toContain('@운영자');
  });

  /* 딥링크로 한 건만 보일 때 이유를 말하지 않으면 목록이 비었다고 읽힌다. */
  it('신고 딥링크에는 전체 목록으로 돌아가는 길을 남긴다', () => {
    const html = render({
      filters: { ...DEFAULT_ADMIN_REVIEW_FILTERS, reviewId: '55555555-5555-4555-8555-555555555555' },
    });

    expect(html).toContain('신고된 리뷰 한 건만 보고 있습니다');
    expect(html).toContain('전체 목록으로 돌아가기');
  });

  /* v1에는 리뷰 보상이 없다(#254 확정). 없는 개념의 칸을 두면 다음 사람이 찾는다. */
  it('보상·적립 표기를 두지 않는다', () => {
    const html = render();

    expect(html).not.toContain('적립');
    expect(html).not.toContain('포인트');
  });
});
