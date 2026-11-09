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
import { Check, EyeOff, Inbox, MessageSquareText, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/admin/kit/ui/badge';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/admin/kit/ui/native-select';
import { InlineNotice } from '../fields';
import { ADMIN_REPORT_STATUS_LABELS, reportTargetLabels } from '@/lib/admin/moderation';
import { statusTone } from '@/lib/admin/status-tone';
import { ConsoleListCard } from '../console/ConsoleListCard';
import { AdminStatusBadge } from '../console/AdminKit';
import { AdminCountCard, type AdminCountTone } from '../console/AdminCountCard';
import { ROW_DANGER_BUTTON_CLASS, csChipTone } from '../screens/cs-kit-classes';

const emptyState: AdminCatalogActionState = {};
const reportStatuses: CommunityReportStatus[] = ['open', 'reviewing', 'resolved', 'dismissed'];

/* 신고 처리 칸은 터치 기기에서 44px 높이를 지킨다(포인터가 거친 기기만, 데스크톱은 kit 기본 높이). */
const TOUCH_TARGET = 'pointer-coarse:h-11';

/* 처리할 신고(접수·검토중)를 위로 — 같은 상태 안의 최신순은 서버 순서 그대로다. */
const STATUS_ORDER: Record<CommunityReportStatus, number> = { open: 0, reviewing: 1, resolved: 2, dismissed: 3 };
type ReportFilter = 'all' | CommunityReportStatus;

/* 다른 문의·리뷰 화면과 같은 날짜 표기(한국 시각, 초 없음). */
const reportTimeFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const isActiveReport = (report: AdminReportRecord) => report.status === 'open' || report.status === 'reviewing';
/* 숨김 버튼은 댓글·포스트 모두 같은 규칙이다 — 처리할 신고는 빨간 글자 테두리 버튼, 끝난 신고는 같은 테두리에 회색 글자다. 꺼진 버튼처럼 보이지 않게 테두리는 언제나 둔다. */
const hideButtonClass = (report: AdminReportRecord) => `${TOUCH_TARGET} ${isActiveReport(report) ? ROW_DANGER_BUTTON_CLASS : 'text-muted-foreground hover:text-destructive'}`;

/** 건수 카드를 누르면 이미 읽은 목록을 그 상태로 거른다(서버 재조회·URL 변경 없음). */
function ReportFilterCard({ active, count, icon, label, onSelect, tone, quiet = false }: { active: boolean; count: number; icon?: LucideIcon; label: string; onSelect: () => void; tone?: AdminCountTone; quiet?: boolean }) {
  return (
    <button aria-pressed={active} className="block w-full cursor-pointer rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&:hover>span]:bg-accent" data-slot="button" onClick={onSelect} type="button">
      {/* 전체는 거르지 않은 평상 상태라 강조하지 않는다(quiet) — 고른 상태만 강조된다. */}
      <AdminCountCard active={active && !quiet} count={count} icon={icon} label={label} tone={tone} />
    </button>
  );
}

export function confirmCommunityCommentHide(event: FormEvent<HTMLFormElement>) {
  const confirmed = window.confirm(
    '이 댓글을 숨기고 연결된 신고를 해결합니다. 현재 화면에서는 되돌릴 수 없습니다. 계속할까요?',
  );
  if (!confirmed) event.preventDefault();
}

export function confirmCommunityPostHide(event: FormEvent<HTMLFormElement>) {
  const confirmed = window.confirm(
    '이 포스트를 숨기고 연결된 신고를 처리완료로 바꿉니다. 현재 화면에서는 되돌릴 수 없습니다. 계속할까요?',
  );
  if (!confirmed) event.preventDefault();
}

function ReportStatusForm({ report, label }: { report: AdminReportRecord; label: string }) {
  const [state, action, pending] = useActionState(updateCommunityReportStatusAction, emptyState);
  /* 선택칸은 제출 뒤 폼 초기화로 저장된 값에 돌아오는 비제어 입력이다 — 고른 값만 따로 기억해 버튼 강조에 쓰고, 제출하면 지운다. */
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2" onSubmit={() => setPicked(null)}>
      <input name="reportId" type="hidden" value={report.id} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <NativeSelect
        aria-label={`${reportTargetLabels[report.targetType]} 신고 상태`}
        className="w-32 [&>select]:pointer-coarse:h-11"
        defaultValue={report.status}
        key={report.status}
        name="status"
        onChange={(event) => setPicked(event.target.value)}
      >
        {reportStatuses.map((status) => (
          <NativeSelectOption key={status} value={status}>{ADMIN_REPORT_STATUS_LABELS[status]}</NativeSelectOption>
        ))}
      </NativeSelect>
      {/* 바뀐 게 없으면 누를 일이 없는 버튼이다 — 상태를 고른 뒤에만 강조한다. */}
      <Button className={TOUCH_TARGET} disabled={pending} type="submit" variant={picked !== null && picked !== report.status ? 'soft' : 'outline'}>
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
    <form action={action} className="flex flex-wrap items-center gap-2" onSubmit={confirmCommunityPostHide}>
      <input name="reportId" type="hidden" value={report.id} />
      <input name="postId" type="hidden" value={report.targetPostId} />
      <Button className={hideButtonClass(report)} disabled={pending} type="submit" variant="outline">
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
      <Button className={hideButtonClass(report)} disabled={hidden || pending} type="submit" variant="outline">
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
    <div className="flex min-w-0 flex-col gap-4">
      {reports.length ? <div className="flex flex-col gap-1.5" data-report-summary="">
        <div aria-label="신고 상태별 건수" className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="group">
          <ReportFilterCard active={filter === 'all'} count={reports.length} icon={Inbox} label="전체" onSelect={() => setFilter('all')} quiet />
          {reportStatuses.map((status) => <ReportFilterCard active={filter === status} count={countOf(status)} key={status} label={ADMIN_REPORT_STATUS_LABELS[status]} onSelect={() => setFilter(status)} tone={csChipTone('report', status)} />)}
        </div>
        <p className="text-xs text-muted-foreground">숫자를 누르면 그 상태만 봅니다. 최근 신고 {reports.length.toLocaleString('ko-KR')}건 기준이며 처리할 신고를 먼저 보여줍니다.</p>
      </div> : null}
      {/* 신고 목록 카드(콘솔 목록 카드) — 신고 한 건이 카드 하나라 어디까지가 한 건인지 테두리로 보인다. 빈 목록도 카드 안에 보인다. */}
      <ConsoleListCard aria-label="신고 목록">
      {visible.length ? <div className="flex flex-col gap-3">{visible.map((report) => {
        const canHide = isActiveReport(report) && Boolean(report.targetCommentId || report.targetPostId);
        return <article className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border-strong text-sm" data-report-card="" key={report.id}>
          <div className="flex min-w-0 flex-col gap-2.5 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <AdminStatusBadge tone={statusTone('report', report.status)}>{ADMIN_REPORT_STATUS_LABELS[report.status]}</AdminStatusBadge>
              <Badge variant="secondary">{reportTargetLabels[report.targetType]}</Badge>
              <span className="text-xs text-muted-foreground tabular-nums">{reportTimeFormatter.format(new Date(report.createdAt))}</span>
              <span className="ml-auto text-xs text-muted-foreground">신고자 @{report.reporterName} · 대상 @{report.targetAuthorName}</span>
            </div>
            {/* 어느 쪽이 사유이고 어느 쪽이 문제의 글인지 이름표로 말한다. */}
            <dl className="grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5">
              {report.reason ? <><dt className="text-xs text-muted-foreground">신고 사유</dt><dd className="font-semibold break-words text-foreground">{report.reason}</dd></> : null}
              <dt className="text-xs text-muted-foreground">신고된 {reportTargetLabels[report.targetType]}</dt>
              <dd className="rounded-md bg-muted/60 px-2.5 py-1.5 leading-snug break-words text-foreground">{report.targetLabel}</dd>
            </dl>
          </div>
          {/* 처리 줄은 선 없이 옅은 면으로 나눈다(신고끼리의 테두리와 겹치지 않게). 왼쪽은 숨김(신고도 함께 처리완료), 오른쪽은 숨기지 않고 상태만 바꾸는 길이다. */}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 bg-muted/40 px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <HideCommentForm report={report} />
              <HidePostForm report={report} />
              <ReviewModerationLink report={report} />
              {canHide ? <span className="text-xs text-muted-foreground">숨기면 이 신고는 처리완료로 바뀝니다.</span> : null}
            </div>
            <ReportStatusForm label={canHide ? '숨기지 않고 상태만 변경' : '상태 변경'} report={report} />
          </div>
        </article>;
      })}</div> : (
        <div className="py-10 text-center" role="status">
          <p className="text-sm font-medium">처리할 신고가 없습니다.</p>
          <p className="mt-1.5 text-sm text-muted-foreground">{reports.length ? '다른 상태를 골라 확인해주세요.' : '커뮤니티 신고가 접수되면 이곳에 표시됩니다.'}</p>
        </div>
      )}
      </ConsoleListCard>
    </div>
  );
}
