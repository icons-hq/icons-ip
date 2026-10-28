import { CustomerServiceTabs, CustomerServiceResultsHeader } from './CustomerServiceListParts';
import { CUSTOMER_SERVICE_PAGE_SIZES } from '@/lib/admin/customer-service-list';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import Link from 'next/link';
import { InquiryLiveUpdates } from '@/components/screens/InquiryLiveUpdates';
import { InquiryPreviewLink } from './InquiryPreviewLink';
import {
  ConsoleCountChips,
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
 * 늦었는지 아닌지를 알려주지 않는다. */

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'reference', label: '문의번호', width: '92px' },
  { key: 'category', label: '유형', width: '110px' },
  { key: 'title', label: '제목', width: '320px' },
  { key: 'buyer', label: '구매자', width: '130px' },
  { key: 'order', label: '연결 주문', width: '110px' },
  { key: 'status', label: '상태', width: '90px' },
  { key: 'satisfaction', label: '답변 만족도', width: '110px' },
  { key: 'times', label: '접수 · 최근', width: '160px' },
  { key: 'sla', label: '1차 답변 기한', align: 'end', width: '130px' },
  { key: 'handler', label: '담당자', width: '110px' },
  { key: 'action', label: '처리', width: '120px' },
];

const CHIP_TONES = {
  open: 'warning',
  answered: 'info',
  closed: 'default',
} as const;

export function InquiryQueueScreen({
  data,
  now = new Date(),
}: {
  data: AdminInquiryConsoleData;
  /** SLA·경과시간 기준 시각. 테스트 주입용. */
  now?: Date;
}) {
  const { counts, filters, pageSize, rows, total } = data;
  const satisfactionPercent = data.satisfactionSummary ? inquirySatisfactionPercent(data.satisfactionSummary) : null;

  const rowsForGrid: ConsoleGridRow[] = rows.map((row) => {
    const sla = inquirySlaState(
      { answeredAt: row.answeredAt, createdAt: row.createdAt, status: row.status },
      now,
    );

    return {
      id: row.id,
      href: adminInquiryDetailHref(row.id, filters),
      cells: [
        <span className="mono" key="reference">{inquiryReferenceLabel(row.reference)}</span>,
        <span key="category">{adminGoodsCopy(INQUIRY_CATEGORY_LABELS[row.category])}</span>,
        <span className="admin-cs-inquiry-title" key="title">
          <InquiryPreviewLink href={adminInquiryPreviewHref(row.id, filters)}>{row.title}</InquiryPreviewLink>
          {isAdminInquiryOverdue(row, now) ? <span data-sla-tone="danger"> · 미답변 24시간 경과</span> : null}
          {row.messageCount > 1 ? (
            <span className="muted"> · {row.messageCount}건</span>
          ) : null}
        </span>,
        <span key="buyer">@{row.buyerName}</span>,
        row.orderId ? (
          <span className="mono" key="order">{orderReferenceLabel(row.orderId, row.orderNumber)}</span>
        ) : (
          <span className="muted" key="order">-</span>
        ),
        <span key="status">{ADMIN_INQUIRY_STATUS_LABELS[row.status]}</span>,
        <span key="satisfaction">{row.satisfaction === undefined ? '확인 불가' : INQUIRY_SATISFACTION_LABELS[row.satisfaction ?? 'unrated']}</span>,
        <span key="times">
          <time dateTime={row.createdAt}>{formatInquiryDateTime(row.createdAt)}</time>
          <br />
          <span className="muted">최근 {inquiryElapsedLabel(row.lastMessageAt, now)} 전</span>
        </span>,
        /* SLA는 운영자가 가장 먼저 보는 값이라 톤을 데이터 속성으로 남겨 CSS가 강조한다. */
        <span data-sla-tone={sla.tone} key="sla">{sla.label}</span>,
        row.assigneeName
          ? <span key="handler">@{row.assigneeName}</span>
          : <span className="muted" key="handler">미배정</span>,
        <InquiryPreviewLink className="admin-cs-open" href={adminInquiryPreviewHref(row.id, filters)} key="action">답변처리</InquiryPreviewLink>,
      ],
    };
  });

  return (
    <section className="admin-console wc-admin-kit admin-cs-console admin-cs-console--inquiries">
      <ConsoleFilterPanel
        action="/admin/cs/inquiries"
        dateRange={{
          from: filters.from,
          label: '접수일',
          presetHref: (range) => adminInquiryHref(filters, {
            from: range.from,
            page: 1,
            to: range.to,
          }),
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
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="admin-inquiry-category">
            문의 유형
          </label>
          <select defaultValue={filters.category} id="admin-inquiry-category" name="category">
            {ADMIN_INQUIRY_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="admin-inquiry-satisfaction">답변 만족도</label>
          <select defaultValue={filters.satisfaction ?? 'all'} id="admin-inquiry-satisfaction" name="satisfaction">
            {ADMIN_INQUIRY_SATISFACTION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </ConsoleFilterPanel>



      <section className="admin-cs-results" aria-label="고객문의 목록">
      <CustomerServiceResultsHeader title="고객문의 목록" total={total} pageSize={pageSize} pageSizeOptions={CUSTOMER_SERVICE_PAGE_SIZES.map(size => ({ value: String(size), label: `${size}개씩`, href: adminInquiryHref(filters, { pageSize: size, page: 1 }) }))}></CustomerServiceResultsHeader>
      <div className="admin-cs-results__toolbar">문의 제목 또는 답변처리를 누르면 목록 위 팝업에서 문의·연결 주문을 보고 바로 답변할 수 있습니다.</div>
      <ConsoleGrid
        caption="1:1 문의 목록"
        preferencesKey="cs-inquiries"
        columns={COLUMNS}
        emptyLabel="조건에 맞는 문의가 없습니다."
        rows={rowsForGrid}
      />

      <ConsolePagination
        hrefForPage={(page) => adminInquiryHref(filters, { page })}
        label="문의 목록 페이지"
        page={filters.page}
        pageSize={pageSize}
        total={total}
      />
      <div className="admin-cs-results__context">
      <CustomerServiceTabs active="inquiries" />
      <InquiryLiveUpdates audience="staff" />
      <ConsoleCountChips
        chips={INQUIRY_STATUSES.map((status) => ({
          active: filters.status === status,
          count: counts[status] ?? 0,
          href: adminInquiryHref(filters, { page: 1, status }),
          label: ADMIN_INQUIRY_STATUS_LABELS[status],
          tone: CHIP_TONES[status],
        }))}
        label="상태별 건수"
      />

      <section className="admin-cs-satisfaction-summary" aria-label="답변 만족도 요약">
        {data.satisfactionSummary ? <>
          <strong>평가 응답 중 만족 비율 {satisfactionPercent === null ? '—' : `${satisfactionPercent.toLocaleString('ko-KR')}%`}</strong>
          <span>만족 {data.satisfactionSummary.satisfied.toLocaleString('ko-KR')} · 불만족 {data.satisfactionSummary.dissatisfied.toLocaleString('ko-KR')} · 미평가 {data.satisfactionSummary.unrated.toLocaleString('ko-KR')}</span>
          <small>{satisfactionPercent === null ? '평가 응답 없음 · ' : ''}만족도 선택을 제외한 현재 조회 조건 기준입니다. 만족·불만족 응답만 비율에 포함합니다.</small>
        </> : <p role="alert">만족도 요약을 불러오지 못했습니다.</p>}
      </section>

      </div>
      </section>

      <p className="admin-cs-help">
        미답변 24시간 배지는 주말을 포함한 실제 대기 시간이며 오래 기다린 문의부터 정렬합니다. 1차 답변 목표는 영업일 기준 24시간입니다. 답변 후 7일 동안 추가 질문이 없으면 문의는 자동으로
        종결됩니다. 취소·반품·교환을 실제로 처리하려면{' '}
        <Link href="/admin/sales/orders">주문 통합검색</Link>에서 해당 주문의 클레임 경로를 이용하세요.
      </p>
    </section>
  );
}
