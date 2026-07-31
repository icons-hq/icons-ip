import { describe, expect, it, vi } from 'vitest';
import { getAdminModerationRecords } from './moderation.server';

const mocks = vi.hoisted(() => ({
  records: [] as Array<{ table: string; select: string; ids: string[] }>,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: (table: string) => {
      const state = { select: '' };
      const rows = table === 'reports'
        ? [{
            id: '33333333-3333-4333-8333-333333333333',
            target_type: 'comment',
            target_id: '11111111-1111-4111-8111-111111111111',
            reporter_id: 'reporter-1',
            reason: '신고 사유',
            status: 'open',
            created_at: '2026-07-17T00:00:00.000Z',
          }]
        : table === 'comments'
          ? [{
              id: '11111111-1111-4111-8111-111111111111',
              post_id: '22222222-2222-4222-8222-222222222222',
              user_id: 'author-1',
              text: '숨김 처리된 원문 댓글',
              status: 'hidden',
            }]
          : table === 'public_profiles'
            ? [
                { id: 'reporter-1', nickname: '신고자' },
                { id: 'author-1', nickname: '작성자' },
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
          return Promise.resolve({ data: rows.filter((row) => ids.includes(row.id)), error: null });
        },
      };
      return query;
    },
  }),
}));

describe('getAdminModerationRecords', () => {
  it('retains a hidden comment original for staff and exposes its moderation state', async () => {
    await expect(getAdminModerationRecords()).resolves.toEqual({
      reports: [expect.objectContaining({
        targetType: 'comment',
        targetCommentId: '11111111-1111-4111-8111-111111111111',
        targetCommentStatus: 'hidden',
        targetLabel: '숨김 처리된 원문 댓글',
        targetPostId: '22222222-2222-4222-8222-222222222222',
      })],
    });
    expect(mocks.records).toContainEqual({
      table: 'comments',
      select: 'id,post_id,user_id,text,status',
      ids: ['11111111-1111-4111-8111-111111111111'],
    });
  });
});
