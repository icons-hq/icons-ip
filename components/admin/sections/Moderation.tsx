'use client';

import { useActionState, type FormEvent } from 'react';
import {
  hideCommunityCommentAction,
  hideCommunityPostAction,
  updateCommunityReportStatusAction,
  type AdminCatalogActionState,
} from '@/app/admin/actions';
import type { AdminReportRecord } from '@/lib/admin/moderation.server';
import type { CommunityReportStatus } from '@/lib/community';
import { Icon } from '@/components/ui/Icon';
import { InlineNotice } from '../fields';

const emptyState: AdminCatalogActionState = {};
const reportStatuses: CommunityReportStatus[] = ['open', 'reviewing', 'resolved', 'dismissed'];

export function confirmCommunityCommentHide(event: FormEvent<HTMLFormElement>) {
  const confirmed = window.confirm(
    '이 댓글을 숨기고 연결된 신고를 해결합니다. 현재 화면에서는 되돌릴 수 없습니다. 계속할까요?',
  );
  if (!confirmed) event.preventDefault();
}

export const reportTargetLabels = {
  post: '포스트',
  comment: '댓글',
  user: '사용자',
} as const;

function ReportStatusForm({ report }: { report: AdminReportRecord }) {
  const [state, action, pending] = useActionState(updateCommunityReportStatusAction, emptyState);

  return (
    <form action={action} className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
      <input name="reportId" type="hidden" value={report.id} />
      <select
        aria-label={`${reportTargetLabels[report.targetType]} 신고 상태`}
        className="admin-field-control"
        defaultValue={report.status}
        key={report.status}
        name="status"
        style={{
          background: 'rgba(255,255,255,.045)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: 13,
          minHeight: 44,
          outline: 'none',
          padding: '0 10px',
        }}
      >
        {reportStatuses.map((status) => (
          <option key={status} value={status}>{status}</option>
        ))}
      </select>
      <button className="btn btn-sm admin-field-control" disabled={pending} style={{ minHeight: 44 }}>
        <Icon name="check" size={14} /> {pending ? '저장 중' : '상태 저장'}
      </button>
      <InlineNotice state={state} />
    </form>
  );
}

function HidePostForm({ report }: { report: AdminReportRecord }) {
  const [state, action, pending] = useActionState(hideCommunityPostAction, emptyState);
  if (!report.targetPostId) return null;

  return (
    <form action={action} className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
      <input name="reportId" type="hidden" value={report.id} />
      <input name="postId" type="hidden" value={report.targetPostId} />
      <button className="btn btn-sm admin-field-control" disabled={pending} style={{ minHeight: 44 }}>
        <Icon name="shield" size={14} /> {pending ? '처리 중' : '포스트 숨김'}
      </button>
      <InlineNotice state={state} />
    </form>
  );
}

function HideCommentForm({ report }: { report: AdminReportRecord }) {
  const [state, action, pending] = useActionState(hideCommunityCommentAction, emptyState);
  if (!report.targetCommentId) return null;

  const hidden = report.targetCommentStatus === 'hidden';

  return (
    <form
      action={action}
      className="row"
      onSubmit={confirmCommunityCommentHide}
      style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}
    >
      <input name="reportId" type="hidden" value={report.id} />
      <input name="commentId" type="hidden" value={report.targetCommentId} />
      <button className="btn btn-sm admin-field-control" disabled={hidden || pending} style={{ minHeight: 44 }}>
        <Icon name="shield" size={14} /> {hidden ? '숨김 처리됨' : pending ? '처리 중' : '댓글 숨김'}
      </button>
      <InlineNotice state={state} />
    </form>
  );
}

export function ModerationSection({ reports }: { reports: AdminReportRecord[] }) {
  return (
    <section className="col" style={{ gap: 12 }}>
      {reports.map((report) => (
        <article key={report.id} className="card col" style={{ borderRadius: 10, gap: 12, padding: 16 }}>
          <div className="between" style={{ gap: 12, alignItems: 'start' }}>
            <div className="col" style={{ gap: 6, minWidth: 0 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                <span className="tag">{reportTargetLabels[report.targetType]}</span>
                <span className="tag" style={{ color: 'var(--violet-2)' }}>{report.status}</span>
                <span className="faint mono" style={{ fontSize: 11 }}>{new Date(report.createdAt).toLocaleString('ko-KR')}</span>
              </div>
              <strong style={{ fontSize: 15, lineHeight: 1.4 }}>{report.targetLabel}</strong>
              <div className="muted" style={{ fontSize: 13 }}>
                신고자 @{report.reporterName} · 대상 @{report.targetAuthorName}
              </div>
              {report.reason && <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: 0 }}>{report.reason}</p>}
            </div>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            <ReportStatusForm report={report} />
            <HideCommentForm report={report} />
            <HidePostForm report={report} />
          </div>
        </article>
      ))}
      {!reports.length && (
        <div className="card" style={{ borderRadius: 10, padding: 18 }}>
          <div style={{ fontWeight: 700 }}>처리할 신고가 없습니다.</div>
          <p className="muted" style={{ marginTop: 6 }}>커뮤니티 신고가 접수되면 이곳에 표시됩니다.</p>
        </div>
      )}
    </section>
  );
}
