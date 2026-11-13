import Link from 'next/link';
import { ChevronDown, ListFilter } from 'lucide-react';
import { ConsoleFilterPanel, ConsoleGrid, ConsoleListCard, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { MANAGER_ROLE_LABELS } from '@/lib/admin/access';
import {
  INQUIRY_OPERATOR_HISTORY_PATH,
  OPERATOR_INQUIRY_EVENT_LABELS,
  inquiryOperatorHistoryHref,
  type InquiryOperatorHistoryData,
  type InquiryOperatorHistoryFilters,
  type OperatorInquiryEvent,
} from '@/lib/admin/inquiry-operator-history';
import { statusTone } from '@/lib/admin/status-tone';
import { ADMIN_INQUIRY_STATUS_LABELS, formatInquiryDateTime, inquiryReferenceLabel } from '@/lib/inquiries';

/*
 * 운영자별 처리 이력(1014-105) — 템플릿 룩(ADR-0028). 사용자 결정(2026-11-12) "운영자별 처리 이력": 누가 언제 답변·완료했는지 운영자별 목록.
 * 운영자 활동 기록이라 매니저 관리 권한으로만 열고, 조회할 때마다 열람 기록이 남는다. 처리 기록은 지난 기록이라 상태 색을 쓰지 않는다
 * (문의 상태 칸만 상태 표의 색을 따른다). 문의 하나의 처리 이력은 고객문의 상세·상담하기에서 그 문의를 여는 운영자 누구나 본다.
 */

const SUMMARY_COLUMNS: ConsoleGridColumn[] = [
  { key: 'operator', label: '운영자', width: '160px', required: true },
  { key: 'role', label: '역할', width: '120px' },
  { key: 'answers', label: '답변', width: '80px', align: 'end' },
  { key: 'closes', label: '완료', width: '80px', align: 'end' },
  { key: 'reassignments', label: '담당 변경', width: '90px', align: 'end' },
  { key: 'inquiries', label: '처리 문의', width: '90px', align: 'end' },
  { key: 'last', label: '마지막 처리', width: '170px' },
  { key: 'action', label: '처리 목록', width: '110px' },
];

const EVENT_COLUMNS: ConsoleGridColumn[] = [
  { key: 'at', label: '처리 시각', width: '170px', required: true },
  { key: 'kind', label: '처리', width: '200px' },
  { key: 'inquiry', label: '문의', width: '280px' },
  { key: 'status', label: '현재 문의 상태', width: '120px' },
];

const count = (value: number) => <span className="tabular-nums">{value.toLocaleString('ko-KR')}</span>;

function eventLabel(event: OperatorInquiryEvent) {
  const label = OPERATOR_INQUIRY_EVENT_LABELS[event.kind];
  return event.kind === 'reassigned' ? `${label} · ${event.fromName ?? '미배정'} → ${event.toName ?? '미배정'}` : label;
}

export function InquiryOperatorHistoryScreen({ data, filters }: { data: InquiryOperatorHistoryData; filters: InquiryOperatorHistoryFilters }) {
  const detail = data.detail;
  const selected = filters.operator ? data.operators.find(row => row.operatorId === filters.operator) ?? null : null;
  return <section className="flex min-w-0 flex-col gap-4 text-sm text-foreground" aria-label="운영자별 처리 이력" data-admin-kit="inquiry-operator-history">
    <AdminNotice title="누가 언제 고객 문의에 답변·완료·담당 변경을 했는지 운영자별로 확인합니다.">
      <p>고객문의 관리의 답변과 상담하기의 메시지 전송이 모두 답변으로 셉니다. 7일 동안 고객 응답이 없어 자동으로 종결된 문의는 운영자 완료에 넣지 않습니다. 첫 답변으로 담당자가 자동 지정된 것은 따로 세지 않고, 담당 변경은 담당자를 바꾼 운영자에게 셉니다.</p>
      <p>운영자 활동 기록이라 매니저 관리 권한이 있는 계정만 열 수 있고, 이 화면을 조회할 때마다 열람 기록이 남습니다. 문의 하나의 처리 이력은 고객문의 상세와 상담하기의 처리 이력에서 확인합니다.</p>
    </AdminNotice>
    {/* 고객문의 관리처럼 조회 조건을 접어 둔다 — 320 폭에서 두 날짜 입력이 한 줄로 카드 밖에 나가지 않게, 펼쳐도 종료일이 다음 줄로 접힌다
        (공유 조회 조건 부품은 그대로 두고 이 화면의 줄만 감싼다). 고른 기간은 아래 집계 카드 설명에 늘 보인다. */}
    <details className="group/search min-w-0" data-cs-search="" open={filters.periodChosen || filters.rangeAdjusted}>
      <summary className={`${buttonVariants({ size: 'sm', variant: 'outline' })} w-fit list-none [&::-webkit-details-marker]:hidden`} data-slot="button"><ListFilter aria-hidden="true" />검색 조건 <ChevronDown aria-hidden="true" className="transition-transform group-open/search:rotate-180" /></summary>
      <ConsoleFilterPanel action={INQUIRY_OPERATOR_HISTORY_PATH} idPrefix="inquiry-operator-history" className="mt-3 [&_[data-console-filter=period]>div>div:last-child]:flex-wrap"
        hiddenFields={filters.operator ? { operator: filters.operator } : undefined}
        resetHref={INQUIRY_OPERATOR_HISTORY_PATH}
        dateRange={{ from: filters.from, to: filters.to, label: '처리 기간' }} />
    </details>
    {filters.rangeAdjusted ? <AdminNotice role="status" tone="warning" title="조회 기간을 최근 1개월로 바꿔 조회했습니다.">
      처리 기간은 시작일이 종료일보다 늦지 않은 날짜로, 최대 1년(366일)까지 고를 수 있습니다.
    </AdminNotice> : null}
    <ConsoleListCard title="운영자별 집계" total={data.operators.length} unit="명"
      description={`${data.from} ~ ${data.to}(KST) 답변·완료·담당 변경 기록이 있는 운영자입니다. 마지막 처리 순입니다.`}>
      <ConsoleGrid caption="운영자별 문의 처리 집계" preferencesKey="cs-inquiry-operator-history" columns={SUMMARY_COLUMNS}
        emptyLabel="이 기간에 문의를 처리한 운영자가 없습니다."
        rows={data.operators.map(row => {
          const href = inquiryOperatorHistoryHref(filters, { operator: row.operatorId, page: 1 });
          const current = row.operatorId === filters.operator;
          return { id: row.operatorId, href, cells: [
            <span className="font-medium" key="operator">{row.name}</span>,
            row.managerRole ? MANAGER_ROLE_LABELS[row.managerRole] : <span className="text-muted-foreground" key="role">역할 미지정</span>,
            count(row.answers), count(row.closes), count(row.reassignments), count(row.inquiries),
            <time className="tabular-nums" dateTime={row.lastAt} key="last">{formatInquiryDateTime(row.lastAt)}</time>,
            <Link aria-current={current ? 'true' : undefined} aria-label={`${row.name}의 처리 목록 보기`} className={buttonVariants({ size: 'sm', variant: current ? 'soft' : 'outline' })} data-slot="button" href={href} key="action">{current ? '보는 중' : '처리 목록'}</Link>,
          ] };
        })} />
    </ConsoleListCard>
    {detail ? <ConsoleListCard title={`${detail.name}의 처리 목록`} total={detail.total} id="operator-history-detail"
      description={selected ? `답변 ${selected.answers.toLocaleString('ko-KR')}건 · 완료 ${selected.closes.toLocaleString('ko-KR')}건 · 담당 변경 ${selected.reassignments.toLocaleString('ko-KR')}건 · 최신순` : '이 기간의 처리 기록이 없습니다.'}
      actions={<Link className={buttonVariants({ size: 'sm', variant: 'outline' })} data-slot="button" href={inquiryOperatorHistoryHref(filters, { operator: null, page: 1 })}>목록 닫기</Link>}>
      <ConsoleGrid caption={`${detail.name}의 문의 처리 목록`} preferencesKey="cs-inquiry-operator-history-events" columns={EVENT_COLUMNS}
        emptyLabel="이 기간에 이 운영자의 처리 기록이 없습니다."
        rows={detail.items.map(event => ({ id: event.id, cells: [
          <time className="tabular-nums" dateTime={event.at} key="at">{formatInquiryDateTime(event.at)}</time>,
          <span className="wrap-anywhere" key="kind">{eventLabel(event)}</span>,
          event.inquiryId ? <Link className="font-medium underline underline-offset-4 hover:text-muted-foreground" href={`/admin/cs/inquiries/${event.inquiryId}`} key="inquiry">
            {event.reference ? `${inquiryReferenceLabel(event.reference)} ` : ''}{event.title ?? '제목 없음'}</Link>
            : <span className="text-muted-foreground" key="inquiry">삭제된 문의</span>,
          event.status ? <AdminStatusBadge key="status" tone={statusTone('inquiry', event.status)}>{ADMIN_INQUIRY_STATUS_LABELS[event.status]}</AdminStatusBadge> : '—',
        ] }))} />
      <ConsolePagination label="처리 목록 페이지" page={detail.page} pageSize={detail.pageSize} total={detail.total}
        hrefForPage={page => inquiryOperatorHistoryHref(filters, { page })} />
    </ConsoleListCard> : null}
  </section>;
}
