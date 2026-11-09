'use client';

import Link from 'next/link';
import { useActionState, useState, type FormEvent } from 'react';
import {
  hideCommunityCommentAction,
  hideCommunityPostAction,
  updateCommunityReportStatusAction,
  type AdminCatalogActionState,
} from '@/app/admin/actions';
import type { AdminReportRecord } from '@/lib/admin/moderation.server';
import type { CommunityReportStatus } from '@/lib/community';
import { Check, EyeOff, MessageSquareText } from 'lucide-react';
import { Badge } from '@/components/admin/kit/ui/badge';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/admin/kit/ui/native-select';
import { InlineNotice } from '../fields';
import { ADMIN_REPORT_STATUS_LABELS, reportTargetLabels } from '@/lib/admin/moderation';
import { statusTone } from '@/lib/admin/status-tone';
import { ConsoleListCard } from '../console/ConsoleListCard';
import { AdminStatusBadge } from '../console/AdminKit';
import { ADMIN_COUNT_CARD_GRID_CLASS, AdminCountCard, type AdminCountTone } from '../console/AdminCountCard';
import { ROW_DANGER_BUTTON_CLASS, csChipTone } from '../screens/cs-kit-classes';

const emptyState: AdminCatalogActionState = {};
const reportStatuses: CommunityReportStatus[] = ['open', 'reviewing', 'resolved', 'dismissed'];

/* 신고 처리 칸은 터치 기기에서 44px 높이를 지킨다(포인터가 거친 기기만, 데스크톱은 kit 기본 높이). */
const TOUCH_TARGET = 'pointer-coarse:h-11';

/* 처리할 신고(접수·검토중)를 위로 — 같은 상태 안의 최신순은 서버 순서 그대로다. */
const STATUS_ORDER: Record<CommunityReportStatus, number> = { open: 0, reviewing: 1, resolved: 2, dismissed: 3 };
type ReportFilter = 'all' | CommunityReportStatus;

/** 건수 카드를 누르면 이미 읽은 목록을 그 상태로 거른다(서버 재조회·URL 변경 없음). */
function ReportFilterCard({ active, count, label, onSelect, tone, quiet = false }: { active: boolean; count: number; label: string; onSelect: () => void; tone?: AdminCountTone; quiet?: boolean }) {
  return (
    <button aria-pressed={active} className="block w-full cursor-pointer rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&:hover>span]:bg-accent" data-slot="button" onClick={onSelect} type="button">
      {/* 전체는 거르지 않은 평상 상태라 강조하지 않는다(quiet) — 고른 상태만 강조된다. */}
      <AdminCountCard active={active && !quiet} count={count} label={label} tone={tone} />
    </button>
  );
}

export function confirmCommunityCommentHide(event: FormEvent<HTMLFormElement>) {
  const confirmed = window.confirm(
    '이 댓글을 숨기고 연결된 신고를 해결합니다. 현재 화면에서는 되돌릴 수 없습니다. 계속할까요?',
  );
  if (!confirmed) event.preventDefault();
}

function ReportStatusForm({ report }: { report: AdminReportRecord }) {
  const [state, action, pending] = useActionState(updateCommunityReportStatusAction, emptyState);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="reportId" type="hidden" value={report.id} />
      <NativeSelect
        aria-label={`${reportTargetLabels[report.targetType]} 신고 상태`}
        className="w-32 [&>select]:pointer-coarse:h-11"
        defaultValue={report.status}
        key={report.status}
        name="status"
      >
        {reportStatuses.map((status) => (
          <NativeSelectOption key={status} value={status}>{ADMIN_REPORT_STATUS_LABELS[status]}</NativeSelectOption>
        ))}
      </NativeSelect>
      <Button className={TOUCH_TARGET} disabled={pending} type="submit" variant="soft">
        <Check aria-hidden="true" /> {pending ? '저장 중' : '상태 저장'}
      </Button>
      <InlineNotice state={state} />
    </form>
  );
}

function HidePostForm({ report }: { report: AdminReportRecord }) {
  const [state, action, pending] = useActionState(hideCommunityPostAction, emptyState);
  if (!report.targetPostId) return null;

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="reportId" type="hidden" value={report.id} />
      <input name="postId" type="hidden" value={report.targetPostId} />
      <Button className={`${TOUCH_TARGET} ${ROW_DANGER_BUTTON_CLASS}`} disabled={pending} type="submit" variant="outline">
        <EyeOff aria-hidden="true" /> {pending ? '처리 중' : '포스트 숨김'}
      </Button>
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
      className="flex flex-wrap items-center gap-2"
      onSubmit={confirmCommunityCommentHide}
    >
      <input name="reportId" type="hidden" value={report.id} />
      <input name="commentId" type="hidden" value={report.targetCommentId} />
      <Button className={`${TOUCH_TARGET} ${ROW_DANGER_BUTTON_CLASS}`} disabled={hidden || pending} type="submit" variant="outline">
        <EyeOff aria-hidden="true" /> {hidden ? '숨김 처리됨' : pending ? '처리 중' : '댓글 숨김'}
      </Button>
      <InlineNotice state={state} />
    </form>
  );
}

/*
 * 리뷰 신고(#254)는 여기서 처리하지 않는다.
 *
 * 블라인드는 사유와 감사 로그가 붙는 행위라 리뷰 콘솔의 폼이 맡고, DB도 리뷰
 * 신고가 포스트·댓글 숨김으로 소비되는 것을 report_target_mismatch로 막는다.
 * 그래서 이 카드에는 처리 버튼 대신 정확한 대상으로 가는 링크만 둔다 — 검색으로
 * 근처를 찾게 만들면 운영자가 엉뚱한 리뷰를 내릴 수 있다.
 */
function ReviewModerationLink({ report }: { report: AdminReportRecord }) {
  if (!report.targetReviewId) return null;

  return (
    <Link
      className={`${buttonVariants({ variant: 'outline' })} ${TOUCH_TARGET}`}
      data-slot="button"
      href={`/admin/cs/reviews?reviewId=${report.targetReviewId}`}
    >
      <MessageSquareText aria-hidden="true" /> 리뷰 관리에서 열기
    </Link>
  );
}

export function ModerationSection({ reports }: { reports: AdminReportRecord[] }) {
  const [filter, setFilter] = useState<ReportFilter>('all');
  const countOf = (status: CommunityReportStatus) => reports.filter((report) => report.status === status).length;
  const visible = reports
    .filter((report) => filter === 'all' || report.status === filter)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  return (
    /* 신고 목록 카드(콘솔 목록 카드) — 신고 한 건이 한 줄이고, 빈 목록도 카드 안에 보인다. */
    <ConsoleListCard aria-label="신고 목록">
      {reports.length ? <div className="flex flex-col gap-1.5" data-report-summary="">
        <div aria-label="신고 상태별 건수" className={ADMIN_COUNT_CARD_GRID_CLASS} role="group">
          <ReportFilterCard active={filter === 'all'} count={reports.length} label="전체" onSelect={() => setFilter('all')} quiet />
          {reportStatuses.map((status) => <ReportFilterCard active={filter === status} count={countOf(status)} key={status} label={ADMIN_REPORT_STATUS_LABELS[status]} onSelect={() => setFilter(status)} tone={csChipTone('report', status)} />)}
        </div>
        <p className="text-xs text-muted-foreground">최근 신고 {reports.length.toLocaleString('ko-KR')}건 기준입니다. 처리할 신고를 먼저 보여줍니다.</p>
      </div> : null}
      {visible.length ? <div className="flex flex-col divide-y">{visible.map((report) => (
        <article className="flex min-w-0 flex-col gap-3 py-4 text-sm first:pt-0 last:pb-0" key={report.id}>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{reportTargetLabels[report.targetType]}</Badge>
              <AdminStatusBadge tone={statusTone('report', report.status)}>{ADMIN_REPORT_STATUS_LABELS[report.status]}</AdminStatusBadge>
              <span className="text-xs text-muted-foreground tabular-nums">{new Date(report.createdAt).toLocaleString('ko-KR')}</span>
            </div>
            {/* 판단 기준인 신고 사유를 먼저, 신고된 글은 인용으로 물러난다. */}
            {report.reason && <p className="font-semibold break-words text-foreground">{report.reason}</p>}
            <p className="rounded-md bg-muted/60 px-3 py-2 leading-snug break-words text-foreground">{report.targetLabel}</p>
            <p className="text-xs text-muted-foreground">
              신고자 @{report.reporterName} · 대상 @{report.targetAuthorName}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <ReportStatusForm report={report} />
            <HideCommentForm report={report} />
            <HidePostForm report={report} />
            <ReviewModerationLink report={report} />
          </div>
        </article>
      ))}</div> : (
        <div className="py-10 text-center" role="status">
          <p className="text-sm font-medium">처리할 신고가 없습니다.</p>
          <p className="mt-1.5 text-sm text-muted-foreground">{reports.length ? '다른 상태를 골라 확인해주세요.' : '커뮤니티 신고가 접수되면 이곳에 표시됩니다.'}</p>
        </div>
      )}
    </ConsoleListCard>
  );
}
