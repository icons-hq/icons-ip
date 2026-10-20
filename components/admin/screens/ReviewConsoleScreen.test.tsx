import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../ReviewExportDownloadButton', () => ({ ReviewExportDownloadButton: ({ accountId, href, total }: { accountId: string; href: string; total: number }) =>
  <button data-export-account={accountId} data-export-href={href} data-export-total={total}>엑셀 다운로드</button> }));
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
    helpfulCount: 3,
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
  it('다운로드는 서버에 적용된 조건 전체와 계정에 연결하고 페이지·상세 상태를 제외한다', () => {
    const filters = { ...DEFAULT_ADMIN_REVIEW_FILTERS, page: 3, pageSize: 20, sort: 'helpful_desc' as const, photo: 'with' as const, reviewId: '55555555-5555-4555-8555-555555555555' };
    const html = renderToStaticMarkup(<ReviewConsoleScreen data={data({ filters, total: 101 })} accountId="review-operator" initialDetail="other-review" now={NOW} />);
    expect(html).toContain('data-export-account="review-operator"'); expect(html).toContain('data-export-total="101"');
    const href = /data-export-href="([^"]+)"/.exec(html)![1].replaceAll('&amp;', '&');
    const url = new URL(href, 'https://example.test'); expect(url.pathname).toBe('/api/admin/reviews/export');
    expect(url.searchParams.get('sort')).toBe('helpful_desc'); expect(url.searchParams.get('photo')).toBe('with'); expect(url.searchParams.get('reviewId')).toBe(filters.reviewId);
    for (const key of ['page', 'pageSize', 'detail', 'selected', 'accountId']) expect(url.searchParams.has(key)).toBe(false);
  });
  it.each(['good_name_asc', 'photo_count_desc'] as const)('정렬 %s 선택과 BEST 필터를 페이지 링크에 유지한다', (sort) => {
    const html = render({ filters: { ...DEFAULT_ADMIN_REVIEW_FILTERS, sort, best: 'needs_review', query: '정렬 검증', field: 'good', page: 2 }, total: 41 });
    expect(html).toContain('상품명순');
    expect(html).toContain('첨부사진수순');
    expect(html).toContain(`value="${sort}" selected=""`);
    expect(html).toContain(`sort=${sort}`);
    expect(html).toContain('best=needs_review');
    expect(html).toContain('page=3');
  });

  it('검색을 먼저 배치하고 저평점 바로가기는 결과 목록 앞에 유지한다', () => {
    const html = render();

    const pinnedIndex = html.indexOf('admin-console-pinned-filter');
    const panelIndex = html.indexOf('admin-console-filters');

    expect(pinnedIndex).toBeGreaterThanOrEqual(0);
    expect(panelIndex).toBeLessThan(pinnedIndex);
    expect(pinnedIndex).toBeLessThan(html.indexOf('admin-console-grid-table'));
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

    for (const label of ['작성일', '상품', '평점', '리뷰 내용', '사진', '작성자', '신고', '상태', '답글']) {
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
