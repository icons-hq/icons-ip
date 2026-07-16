import { describe, expect, it } from 'vitest';
import {
  normalizeAdminHideCommentForm,
  normalizeAdminHidePostForm,
} from './moderation';

const COMMENT_ID = '11111111-1111-4111-8111-111111111111';
const POST_ID = '22222222-2222-4222-8222-222222222222';
const REPORT_ID = '33333333-3333-4333-8333-333333333333';

describe('admin moderation form normalizers', () => {
  it('keeps the reported comment and report IDs together', () => {
    const formData = new FormData();
    formData.set('commentId', COMMENT_ID);
    formData.set('reportId', REPORT_ID);

    expect(normalizeAdminHideCommentForm(formData)).toEqual({
      ok: true,
      value: { commentId: COMMENT_ID, reportId: REPORT_ID },
    });
  });

  it('rejects a missing or malformed comment/report pair', () => {
    const formData = new FormData();
    formData.set('commentId', 'not-a-uuid');

    expect(normalizeAdminHideCommentForm(formData)).toEqual({
      ok: false,
      errors: {
        commentId: '댓글을 찾을 수 없습니다.',
        reportId: '신고를 찾을 수 없습니다.',
      },
    });
  });

  it('preserves the existing parent-post moderation normalizer', () => {
    const formData = new FormData();
    formData.set('postId', POST_ID);
    formData.set('reportId', REPORT_ID);

    expect(normalizeAdminHidePostForm(formData)).toEqual({
      ok: true,
      value: { postId: POST_ID, reportId: REPORT_ID },
    });
  });
});
