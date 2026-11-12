import { CustomerServiceTabs, CustomerServiceResultsHeader } from './CustomerServiceListParts';
import { CUSTOMER_SERVICE_PAGE_SIZES } from '@/lib/admin/customer-service-list';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronDown, ListFilter } from 'lucide-react';
import { InquiryLiveUpdates } from '@/components/screens/InquiryLiveUpdates';
import { InquiryPreviewLink } from './InquiryPreviewLink';
import { INQUIRY_LIVE_CLASS, INQUIRY_SLA_TONE_CLASS, csChipTone } from './cs-kit-classes';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { AdminSelect } from '@/components/admin/console/AdminSelect';
import { statusTone } from '@/lib/admin/status-tone';
import {
  ConsoleCountChips,
  ConsoleFilterField,
  ConsoleFilterPanel,
  ConsoleGrid,
  ConsolePagination,
  type ConsoleGridColumn,
  type ConsoleGridRow,
} from '@/components/admin/console';
import {
  ADMIN_INQUIRY_CATEGORY_OPTIONS,
  ADMIN_INQUIRY_SEARCH_FIELDS,
  ADMIN_INQUIRY_STATUS_OPTIONS,
  ADMIN_INQUIRY_SATISFACTION_OPTIONS,
  adminInquiryDetailHref,
  adminInquiryHref,
  adminInquiryPreviewHref,
  isAdminInquiryOverdue,
  type AdminInquiryConsoleData,
} from '@/lib/admin/inquiries';
import {
  ADMIN_INQUIRY_STATUS_LABELS,
  formatInquiryDateTime,
  INQUIRY_CATEGORY_LABELS,
  inquiryElapsedLabel,
  inquiryReferenceLabel,
  inquirySlaState,
  INQUIRY_STATUSES,
} from '@/lib/inquiries';
import { orderReferenceLabel } from '@/lib/orders';
import { INQUIRY_SATISFACTION_LABELS, inquirySatisfactionPercent } from '@/lib/inquiry-satisfaction';

/* 어드민 1:1 문의 큐(#253).
 *
 * 정렬은 서버가 "미답변 먼저, 오래 기다린 것 먼저"로 고정한다. 운영자가 컬럼을 눌러
 * 정렬을 바꾸는 화면이 아니다 — 이 큐에서 순서를 정하는 것은 취향이 아니라 SLA다.
 *
 * 경과시간 칸은 단순 경과가 아니라 1차 답변 기한까지 남은 시간을 말한다. "3시간 지남"은
 * 늦었는지 아닌지를 알려주지 않는다.
 *
 * 템플릿 룩(ADR-0028): 결과 카드 안에 머리 → 조회 조건(접기) → 목록 → 페이지 → 상태별 집계·만족도, 그 아래 안내 순서다. */

/* 1440 화면(표 폭 약 1100px)에서 담당자가 카드 끝에 잘리지 않게 폭을 나눴다(합 1094px). '연결 주문'은 주문 시각을 넣은 20자리
   주문번호(text-xs)가 다 보이는 폭이 기준이고, 늘린 만큼 두 줄에서 잘리는 제목 칸을 줄였다(전체 제목은 title로 본다).
   미답변 큐에서는 전부 미평가인 참고 칸(답변 만족도)은 기본으로 빼고, 조회항목 설정에서 켠다 — 만족도 필터·요약은 그대로다. */
const COLUMNS: ConsoleGridColumn[] = [
  { key: 'reference', label: '문의번호', width: '72px' },
  { key: 'category', label: '유형', width: '88px' },
  { key: 'title', label: '제목', width: '124px' },
  { key: 'status', label: '상태', width: '96px' },
  { key: 'action', label: '처리', width: '88px' },
  { key: 'buyer', label: '구매자', width: '96px' },
  { key: 'times', label: '접수 · 최근', width: '154px' },
  { key: 'sla', label: '1차 답변 기한', align: 'end', width: '120px' },
  { key: 'order', label: '연결 주문', width: '172px' },
  { key: 'handler', label: '담당자', width: '84px' },
  { key: 'satisfaction', label: '답변 만족도', width: '88px', defaultVisible: false },
];

const DAY_MS = 86_400_000;

/** 24시간을 넘긴 미답변 문의의 실제 대기 일수. 그 밖에는 null. */
function inquiryOverdueDays(inquiry: { status: string; waitingSince: string | null }, now: Date) {
  if (!isAdminInquiryOverdue(inquiry, now)) return null;
  return Math.floor((now.getTime() - Date.parse(inquiry.waitingSince as string)) / DAY_MS);
}

export function InquiryQueueScreen({
  data,
  now = new Date(),
  pendingBadge,
}: {
  data: AdminInquiryConsoleData;
  /** SLA·경과시간 기준 시각. 테스트 주입용. */
  now?: Date;
  /** 미답변 바로가기. 혼자 한 줄을 차지하지 않게 목록 제목 옆에 둔다. */
  pendingBadge?: ReactNode;
}) {
  const { counts, filters, pageSize, rows, total } = data;
  const satisfactionPercent = data.satisfactionSummary ? inquirySatisfactionPercent(data.satisfactionSummary) : null;
  /* 조회 조건은 접어 두어 첫 화면을 문의가 차지한다(기본 미답변 큐가 아니면 어떤 조건인지 보이게 펼친다). */
  const hasSearch = filters.status !== 'open' || Boolean(filters.from || filters.to || filters.query) || filters.category !== 'all' || (filters.satisfaction ?? 'all') !== 'all';

  const rowsForGrid: ConsoleGridRow[] = rows.map((row) => {
    const sla = inquirySlaState(
      { answeredAt: row.answeredAt, createdAt: row.createdAt, status: row.status },
      now,
    );
    const overdueDays = inquiryOverdueDays(row, now);

    return {
      id: row.id,
      href: adminInquiryDetailHref(row.id, filters),
      cells: [
        <span className="tabular-nums" key="reference">{inquiryReferenceLabel(row.reference)}</span>,
        <span key="category">{adminGoodsCopy(INQUIRY_CATEGORY_LABELS[row.category])}</span>,
        /* 긴 제목은 두 줄에서 자른다(줄 높이를 고르게, 전체는 title). */
        <span className="line-clamp-2" key="title">
          <InquiryPreviewLink className="font-medium text-primary underline-offset-4 hover:underline" href={adminInquiryPreviewHref(row.id, filters)} title={row.title}>{row.title}</InquiryPreviewLink>
          {row.messageCount > 1 ? (
            <span className="ml-1.5 text-muted-foreground">· {row.messageCount}건</span>
          ) : null}
        </span>,
        /* 위험색은 기준이 되는 1차 답변 기한 칸 하나에만 쓴다. 실제 대기 일수는 상태 아래 회색 글자로 물러나 비슷한 숫자 둘이 다투지 않는다. */
        <span className="flex flex-col items-start gap-1" key="status">
          <AdminStatusBadge tone={statusTone('inquiry', row.status)}>{ADMIN_INQUIRY_STATUS_LABELS[row.status]}</AdminStatusBadge>
          {overdueDays !== null ? (
            <span className="text-xs text-muted-foreground tabular-nums" title="미답변 24시간 경과">{overdueDays}일 경과</span>
          ) : null}
        </span>,
        <InquiryPreviewLink button className={buttonVariants({ size: 'xs', variant: row.status === 'open' ? 'soft' : 'ghost' })} href={adminInquiryPreviewHref(row.id, filters)} key="action">답변처리</InquiryPreviewLink>,
        <span className="block max-w-[4.5rem] truncate" key="buyer" title={`@${row.buyerName}`}>@{row.buyerName}</span>,
        /* 기한이 지난 줄은 상태 칸의 경과일이 대기 시간을 이미 말한다 — 같은 뜻의 '최근 N일 전'을 또 적지 않는다. */
        <span key="times">
          <time className="tabular-nums" dateTime={row.createdAt}>{formatInquiryDateTime(row.createdAt)}</time>
          {overdueDays === null ? <span className="block text-xs text-muted-foreground">최근 {inquiryElapsedLabel(row.lastMessageAt, now)} 전</span> : null}
        </span>,
        /* SLA는 운영자가 가장 먼저 보는 값이라 톤을 데이터 속성으로 남기고 그 값으로 강조한다. */
        <span className={`whitespace-nowrap ${INQUIRY_SLA_TONE_CLASS}`} data-sla-tone={sla.tone} key="sla">{sla.label}</span>,
        row.orderId ? (
          <span className="text-xs tabular-nums whitespace-nowrap" key="order">{orderReferenceLabel(row.orderId, row.orderNumber)}</span>
        ) : (
          <span className="text-muted-foreground" key="order">-</span>
        ),
        row.assigneeName
          ? <span className="block max-w-[3.75rem] truncate" key="handler" title={`@${row.assigneeName}`}>@{row.assigneeName}</span>
          : <span className="text-muted-foreground" key="handler">미배정</span>,
        /* 평가가 없는 줄은 글자로 물러나고, 고객이 남긴 평가만 배지로 보인다. */
        row.satisfaction
          ? <AdminStatusBadge key="satisfaction" tone={statusTone('inquirySatisfaction', row.satisfaction)}>{INQUIRY_SATISFACTION_LABELS[row.satisfaction]}</AdminStatusBadge>
          : <span className="text-muted-foreground" key="satisfaction">{row.satisfaction === undefined ? '확인 불가' : INQUIRY_SATISFACTION_LABELS.unrated}</span>,
      ],
    };
  });

  return (
    <div className="flex min-w-0 flex-col gap-4" data-cs-console="inquiries">
      <section aria-label="고객문의 목록" className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground">
        <CustomerServiceResultsHeader aside={pendingBadge} title="고객문의 목록" total={total} pageSize={pageSize} pageSizeOptions={CUSTOMER_SERVICE_PAGE_SIZES.map(size => ({ value: String(size), label: `${size}개씩`, href: adminInquiryHref(filters, { pageSize: size, page: 1 }) }))} />
        <details className="group/search" data-cs-search="" open={hasSearch}>
          <summary className={`${buttonVariants({ size: 'sm', variant: 'outline' })} w-fit list-none [&::-webkit-details-marker]:hidden`} data-slot="button"><ListFilter aria-hidden="true" />검색 조건 <ChevronDown aria-hidden="true" className="transition-transform group-open/search:rotate-180" /></summary>
          <ConsoleFilterPanel
            action="/admin/cs/inquiries"
            className="mt-3"
            dateRange={{
              from: filters.from,
              label: '접수일',
              to: filters.to,
            }}
            now={now}
            hiddenFields={{ pageSize: String(pageSize) }}
            resetHref={adminInquiryHref({
              category: 'all',
              field: 'all',
              from: null,
              page: 1,
              query: '',
              status: 'open',
              to: null,
              satisfaction: 'all',
            })}
            search={{
              fields: ADMIN_INQUIRY_SEARCH_FIELDS,
              fieldName: 'field',
              fieldValue: filters.field,
              placeholder: '제목 · 구매자 · 주문번호 · 문의번호',
              value: filters.query,
            }}
            statusFilter={{ options: ADMIN_INQUIRY_STATUS_OPTIONS, value: filters.status }}
          >
            <ConsoleFilterField htmlFor="admin-inquiry-category" label="문의 유형">
              <AdminSelect defaultValue={filters.category} id="admin-inquiry-category" name="category" wrapperClassName="w-40">
                {ADMIN_INQUIRY_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </AdminSelect>
            </ConsoleFilterField>
            <ConsoleFilterField htmlFor="admin-inquiry-satisfaction" label="답변 만족도">
              <AdminSelect defaultValue={filters.satisfaction ?? 'all'} id="admin-inquiry-satisfaction" name="satisfaction" wrapperClassName="w-40">
                {ADMIN_INQUIRY_SATISFACTION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </AdminSelect>
            </ConsoleFilterField>
          </ConsoleFilterPanel>
        </details>
        <ConsoleGrid
          caption="1:1 문의 목록"
          preferencesKey="cs-inquiries"
          columns={COLUMNS}
          emptyLabel="조건에 맞는 문의가 없습니다."
          rows={rowsForGrid}
        >
          {/* 안내는 조회항목 설정과 한 줄에 둔다 — 표가 한 줄 위로 올라온다. */}
          <p className="text-xs text-muted-foreground">답변처리를 누르면 목록 위 팝업에서 문의와 연결 주문을 보고 바로 답변합니다.</p>
        </ConsoleGrid>

        <ConsolePagination
          hrefForPage={(page) => adminInquiryHref(filters, { page })}
          label="문의 목록 페이지"
          page={filters.page}
          pageSize={pageSize}
          total={total}
        />
        <div className={`flex min-w-0 flex-col gap-3 border-t pt-4 ${INQUIRY_LIVE_CLASS}`}>
          <CustomerServiceTabs active="inquiries" />
          <InquiryLiveUpdates audience="staff" />
          <ConsoleCountChips
            chips={INQUIRY_STATUSES.map((status) => ({
              active: filters.status === status,
              count: counts[status] ?? 0,
              href: adminInquiryHref(filters, { page: 1, status }),
              label: ADMIN_INQUIRY_STATUS_LABELS[status],
              tone: csChipTone('inquiry', status),
            }))}
            label="상태별 건수"
          />

          {data.satisfactionSummary ? (
            <section aria-label="답변 만족도 요약" className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
              <strong className="font-semibold text-foreground">평가 응답 중 만족 비율 {satisfactionPercent === null ? '—' : `${satisfactionPercent.toLocaleString('ko-KR')}%`}</strong>
              <span className="text-muted-foreground tabular-nums">만족 {data.satisfactionSummary.satisfied.toLocaleString('ko-KR')} · 불만족 {data.satisfactionSummary.dissatisfied.toLocaleString('ko-KR')} · 미평가 {data.satisfactionSummary.unrated.toLocaleString('ko-KR')}</span>
              <small className="basis-full text-xs text-muted-foreground">{satisfactionPercent === null ? '평가 응답 없음 · ' : ''}만족도 선택을 제외한 현재 조회 조건 기준입니다. 만족·불만족 응답만 비율에 포함합니다.</small>
            </section>
          ) : <AdminNotice role="alert" tone="danger">만족도 요약을 불러오지 못했습니다.</AdminNotice>}
        </div>
      </section>

      <p className="text-sm leading-relaxed text-muted-foreground">
        오래 기다린 문의부터 보여줍니다. 빨간 기한은 영업일 24시간 기준이고, 회색 경과일은 주말을 포함한 실제 대기 시간입니다. 답변 후 7일 동안 추가 질문이 없으면 자동으로 종결됩니다.
        취소·반품·교환은{' '}
        <Link className="font-medium text-foreground underline underline-offset-4" href="/admin/sales/orders">주문 통합검색</Link>에서 처리하세요.
      </p>
    </div>
  );
}
