import type { CommunityReportStatus } from '@/lib/community';

export type AdminModerationFieldErrors = Record<string, string>;

export interface AdminReportStatusFormValue {
  reportId: string;
  status: CommunityReportStatus;
}

export interface AdminHidePostFormValue {
  postId: string;
  reportId: string | null;
}

export interface AdminHideCommentFormValue {
  commentId: string;
  reportId: string;
}

export type AdminModerationFormResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: AdminModerationFieldErrors };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPORT_STATUSES = new Set<CommunityReportStatus>(['open', 'reviewing', 'resolved', 'dismissed']);

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function readUuid(formData: FormData, key: string) {
  const value = readString(formData, key);
  return UUID_PATTERN.test(value) ? value : null;
}

export function normalizeAdminReportStatusForm(
  formData: FormData,
): AdminModerationFormResult<AdminReportStatusFormValue> {
  const reportId = readUuid(formData, 'reportId');
  const status = readString(formData, 'status') as CommunityReportStatus;
  const errors: AdminModerationFieldErrors = {};

  if (!reportId) errors.reportId = '신고를 찾을 수 없습니다.';
  if (!REPORT_STATUSES.has(status)) errors.status = '신고 상태를 선택해주세요.';

  if (!reportId || !REPORT_STATUSES.has(status)) return { ok: false, errors };

  return {
    ok: true,
    value: {
      reportId,
      status,
    },
  };
}

export function normalizeAdminHidePostForm(
  formData: FormData,
): AdminModerationFormResult<AdminHidePostFormValue> {
  const postId = readUuid(formData, 'postId');
  const reportId = readUuid(formData, 'reportId');

  if (!postId) {
    return {
      ok: false,
      errors: {
        postId: '포스트를 찾을 수 없습니다.',
      },
    };
  }

  return {
    ok: true,
    value: {
      postId,
      reportId,
    },
  };
}

export function normalizeAdminHideCommentForm(
  formData: FormData,
): AdminModerationFormResult<AdminHideCommentFormValue> {
  const commentId = readUuid(formData, 'commentId');
  const reportId = readUuid(formData, 'reportId');
  const errors: AdminModerationFieldErrors = {};

  if (!commentId) errors.commentId = '댓글을 찾을 수 없습니다.';
  if (!reportId) errors.reportId = '신고를 찾을 수 없습니다.';

  if (!commentId || !reportId) return { ok: false, errors };

  return {
    ok: true,
    value: { commentId, reportId },
  };
}
