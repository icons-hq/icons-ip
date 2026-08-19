import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminModerationRecords } from './moderation.server';

const COMMENT_REPORT = {
  id: '33333333-3333-4333-8333-333333333333',
  target_type: 'comment',
  target_id: '11111111-1111-4111-8111-111111111111',
  reporter_id: 'reporter-1',
  reason: '신고 사유',
  status: 'open',
  created_at: '2026-07-17T00:00:00.000Z',
};

const REVIEW_REPORT = {
  id: '44444444-4444-4444-8444-444444444444',
  target_type: 'review',
  target_id: '55555555-5555-4555-8555-555555555555',
  reporter_id: 'reporter-1',
  reason: '허위 후기로 의심됩니다',
  status: 'open',
  created_at: '2026-08-18T00:00:00.000Z',
};

const mocks = vi.hoisted(() => ({
  records: [] as Array<{ table: string; select: string; ids: string[] }>,
  reports: [] as Array<Record<string, unknown>>,
  reviews: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: (table: string) => {
      const state = { select: '' };
      const rows: Array<Record<string, unknown>> = table === 'reports'
        ? mocks.reports
        : table === 'comments'
          ? [{
              id: '11111111-1111-4111-8111-111111111111',
              post_id: '22222222-2222-4222-8222-222222222222',
              user_id: 'author-1',
              text: '숨김 처리된 원문 댓글',
              status: 'hidden',
            }]
          : table === 'reviews'
            ? mocks.reviews
            : table === 'public_profiles'
              ? [
                  { id: 'reporter-1', nickname: '신고자' },
                  { id: 'author-1', nickname: '작성자' },
                  { id: 'review-author-1', nickname: '리뷰 작성자' },
                ]
              : [];
      const query = {
        select(value: string) {
          state.select = value;
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return Promise.resolve({ data: rows, error: null });
        },
        in(_column: string, ids: string[]) {
          mocks.records.push({ table, select: state.select, ids });
          return Promise.resolve({
            data: rows.filter((row) => ids.includes(row.id as string)),
            error: null,
          });
        },
      };
      return query;
    },
  }),
}));

beforeEach(() => {
  mocks.records = [];
  mocks.reports = [COMMENT_REPORT];
  mocks.reviews = [];
});

describe('getAdminModerationRecords', () => {
  it('retains a hidden comment original for staff and exposes its moderation state', async () => {
    await expect(getAdminModerationRecords()).resolves.toEqual({
      reports: [expect.objectContaining({
        targetType: 'comment',
        targetCommentId: '11111111-1111-4111-8111-111111111111',
        targetCommentStatus: 'hidden',
        targetLabel: '숨김 처리된 원문 댓글',
        targetPostId: '22222222-2222-4222-8222-222222222222',
        targetReviewId: null,
      })],
    });
    expect(mocks.records).toContainEqual({
      table: 'comments',
      select: 'id,post_id,user_id,text,status',
      ids: ['11111111-1111-4111-8111-111111111111'],
    });
  });

  /* 리뷰 신고(#254)도 같은 큐로 온다. 대상 라벨이 없으면 신고 카드가 무엇에 대한
     것인지 알 수 없어 운영자가 판단할 근거를 잃는다. */
  it('리뷰 신고의 대상 라벨과 작성자를 만든다', async () => {
    mocks.reports = [REVIEW_REPORT];
    mocks.reviews = [{
      id: '55555555-5555-4555-8555-555555555555',
      user_id: 'review-author-1',
      body: '색이 사진과 달라서 아쉬웠어요',
    }];

    await expect(getAdminModerationRecords()).resolves.toEqual({
      reports: [expect.objectContaining({
        targetType: 'review',
        targetLabel: '색이 사진과 달라서 아쉬웠어요',
        targetAuthorName: '리뷰 작성자',
        targetReviewId: '55555555-5555-4555-8555-555555555555',
        /* 리뷰는 포스트·댓글 숨김 액션의 대상이 아니다 — 두 id가 비어야 화면이
           그 버튼을 그리지 않는다(DB도 report_target_mismatch로 막는다). */
        targetPostId: null,
        targetCommentId: null,
      })],
    });
  });

  /* 작성자가 이미 지운 리뷰는 행이 없다. 라벨을 비우면 신고 카드가 정체불명이 된다. */
  it('삭제된 리뷰 신고에도 읽을 수 있는 라벨을 남긴다', async () => {
    mocks.reports = [REVIEW_REPORT];
    mocks.reviews = [];

    const { reports } = await getAdminModerationRecords();
    expect(reports[0].targetLabel).toBe('삭제된 리뷰');
  });
});
