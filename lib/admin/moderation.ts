import { isUuid } from '@/lib/uuid';
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

const REPORT_STATUSES = new Set<CommunityReportStatus>(['open', 'reviewing', 'resolved', 'dismissed']);

/** 신고 처리 상태의 운영자 표기. 값(open 등)은 DB 계약이고 화면은 이 이름을 보인다. */
export const ADMIN_REPORT_STATUS_LABELS: Record<CommunityReportStatus, string> = { open: '접수', reviewing: '검토중', resolved: '처리완료', dismissed: '기각' };

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function readUuid(formData: FormData, key: string) {
  const value = readString(formData, key);
  return isUuid(value) ? value : null;
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
export const reportTargetLabels = {
  post: '포스트', comment: '댓글', review: '리뷰', user: '사용자',
} as const;
