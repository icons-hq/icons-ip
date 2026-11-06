'use client';

import Link from 'next/link';
import { useActionState, type FormEvent } from 'react';
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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/admin/kit/ui/empty';
import { NativeSelect, NativeSelectOption } from '@/components/admin/kit/ui/native-select';
import { InlineNotice } from '../fields';
import { reportTargetLabels } from '@/lib/admin/moderation';
import { SECTION_CARD } from './SectionLayout';

const emptyState: AdminCatalogActionState = {};
const reportStatuses: CommunityReportStatus[] = ['open', 'reviewing', 'resolved', 'dismissed'];

/* 신고 처리 칸은 터치 기기에서 44px 높이를 지킨다(포인터가 거친 기기만, 데스크톱은 kit 기본 높이). */
const TOUCH_TARGET = 'pointer-coarse:h-11';

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
          <NativeSelectOption key={status} value={status}>{status}</NativeSelectOption>
        ))}
      </NativeSelect>
      <Button className={TOUCH_TARGET} disabled={pending} type="submit">
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
      <Button className={TOUCH_TARGET} disabled={pending} type="submit" variant="destructive">
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
      <Button className={TOUCH_TARGET} disabled={hidden || pending} type="submit" variant="destructive">
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
  return (
    <section className="flex min-w-0 flex-col gap-3">
      {reports.map((report) => (
        <article className={SECTION_CARD} key={report.id}>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{reportTargetLabels[report.targetType]}</Badge>
              <Badge className="text-[var(--wc-info)]" variant="outline">{report.status}</Badge>
              <span className="text-xs text-muted-foreground tabular-nums">{new Date(report.createdAt).toLocaleString('ko-KR')}</span>
            </div>
            <p className="text-base leading-snug font-medium break-words text-foreground">{report.targetLabel}</p>
            <p className="text-sm text-muted-foreground">
              신고자 @{report.reporterName} · 대상 @{report.targetAuthorName}
            </p>
            {report.reason && <p className="text-sm break-words">{report.reason}</p>}
          </div>
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t pt-4">
            <ReportStatusForm report={report} />
            <HideCommentForm report={report} />
            <HidePostForm report={report} />
            <ReviewModerationLink report={report} />
          </div>
        </article>
      ))}
      {!reports.length && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>처리할 신고가 없습니다.</EmptyTitle>
            <EmptyDescription>커뮤니티 신고가 접수되면 이곳에 표시됩니다.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  );
}
