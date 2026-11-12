import Link from 'next/link';
import { Download } from 'lucide-react';
import { ConsoleGrid, ConsoleListCard, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { StatsComparison } from '@/components/admin/StatsComparison';
import { BENEFIT_REPORT_PATH, benefitCohortRate, benefitReportHref, benefitTrend, type BenefitIssuances, type BenefitMetrics, type BenefitReport, type BenefitReportFilters } from '@/lib/admin/benefit-report';
import { adminStatsDateInputs } from '@/lib/admin/stats';
import { krw } from '@/lib/format';
import { ConsoleFilterField } from '@/components/admin/console';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { StatsSummaryGrid, StatsSummaryTile } from '@/components/admin/StatsSummary';

/* 혜택 리포트 — 템플릿 룩(ADR-0028). 조회 키(q·discount·segment·bucket·from·to·compare·code·detail)는 그대로다. */
const TABS = 'inline-flex w-fit max-w-full flex-wrap rounded-lg bg-muted p-0.5';
const TAB = 'inline-flex h-7 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm';
const SECTION_TITLE = 'text-base font-medium text-foreground';
const PAGE_LINK = buttonVariants({ size: 'sm', variant: 'outline' });

const metricColumns: ConsoleGridColumn[] = [
  { key: 'issued', label: '발급수', width: '100px', align: 'end' },
  { key: 'paidUses', label: '결제 사용수', width: '110px', align: 'end' },
  { key: 'discount', label: '쿠폰 할인금액', width: '140px', align: 'end' },
  { key: 'amount', label: '사용 주문금액', width: '140px', align: 'end' },
  { key: 'released', label: '복구수', width: '90px', align: 'end' },
  { key: 'rate', label: '기간 발급분 사용률', width: '150px', align: 'end' },
];
const metricCells = (row: BenefitMetrics) => [row.issued.toLocaleString('ko-KR'), row.paidUses.toLocaleString('ko-KR'), krw(row.discountAmount), krw(row.orderAmount), row.released.toLocaleString('ko-KR'), benefitCohortRate(row)];
const useStatus = { paid: '결제 완료', pending: '결제 대기', released: '복구', other: '기타' };
const issuanceDate = (value: string) => new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');

export function BenefitReportControls({ filters, admin, now = new Date() }: { filters: BenefitReportFilters; admin: boolean; now?: Date }) {
  const dates = adminStatsDateInputs(filters, now);
  return <>
    <nav aria-label="혜택 종류" className={TABS}><Link className={TAB} aria-current="page" href={BENEFIT_REPORT_PATH}>쿠폰</Link>{admin ? <Link className={TAB} href="/admin/sales/store-credits">적립금 지급내역</Link> : null}</nav>
    <form className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground print:hidden" data-sales-filters="" action={BENEFIT_REPORT_PATH} method="get" key={benefitReportHref(filters)}>
      <h2 className={SECTION_TITLE}>혜택 지급 조회</h2>
      {filters.code ? <><input type="hidden" name="code" value={filters.code} /><input type="hidden" name="detail" value={filters.detail} /></> : null}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <ConsoleFilterField className="min-w-[min(100%,16rem)] flex-1" htmlFor="benefit-query" label="혜택이름 / ID"><Input id="benefit-query" type="search" name="q" maxLength={100} defaultValue={filters.query} placeholder="혜택이름 또는 쿠폰 ID" /></ConsoleFilterField>
        <ConsoleFilterField htmlFor="benefit-discount" label="할인종류"><NativeSelect id="benefit-discount" name="discount" defaultValue={filters.discount}><option value="all">전체</option><option value="fixed">정액 할인</option><option value="percent">정률 할인</option></NativeSelect></ConsoleFilterField>
        <ConsoleFilterField htmlFor="benefit-segment" label="타겟팅 대상"><NativeSelect id="benefit-segment" name="segment" defaultValue={filters.segment}><option value="all">전체</option><option value="first_purchase">첫 구매 고객</option><option value="repeat_purchase">재구매 고객</option><option value="targeted">지정 고객</option></NativeSelect></ConsoleFilterField>
        <ConsoleFilterField label="조회기간"><div className="flex flex-wrap items-center gap-2">
          <NativeSelect name="bucket" aria-label="집계 단위" defaultValue={filters.bucket ?? 'day'}><option value="day">일간</option><option value="week">주간</option><option value="month">월간</option></NativeSelect><span className="flex flex-wrap items-center gap-1.5"><Input className="w-36" name="from" type="date" aria-label="조회 시작일" defaultValue={dates.from} required /><span aria-hidden="true" className="text-muted-foreground">~</span><Input className="w-36" name="to" type="date" aria-label="조회 종료일" defaultValue={dates.to} required /></span>
          <label className="flex items-center gap-2"><input type="checkbox" name="compare" value="previous" defaultChecked={filters.compare} /> 직전 동일 기간 비교</label>
        </div></ConsoleFilterField>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3"><Link className={buttonVariants({ variant: 'ghost' })} data-slot="button" href={BENEFIT_REPORT_PATH}>초기화</Link><Button type="submit" variant="soft">검색</Button></div>
    </form>
  </>;
}

export function BenefitReportScreen({ data, comparison, issuances = null, filters, admin, now = new Date() }: { data: BenefitReport; comparison: BenefitReport | null; issuances?: BenefitIssuances | null; filters: BenefitReportFilters; admin: boolean; now?: Date }) {
  const trend = benefitTrend(data.daily, filters, now);
  const resolvedFilters = { ...filters, ...adminStatsDateInputs(filters, now) };
  const showIssuances = Boolean(filters.code && filters.detail === 'issuances');
  const issuanceExportTooLarge = showIssuances && Boolean(issuances && issuances.totalCount > 10000);
  const count = filters.code ? showIssuances ? issuances?.totalCount ?? null : data.useCount : data.couponCount;
  /* 페이지 이동은 지금 보이는 목록(혜택 목록, 또는 선택한 혜택의 사용·발급 상세) 카드 안에 둔다. */
  const pagination = count !== null ? <ConsolePagination label="혜택 리포트 페이지" page={filters.page} pageSize={50} total={count} unit="개" hrefForPage={page => benefitReportHref({ ...resolvedFilters, page })} /> : null;
  return <section className="flex min-w-0 flex-col gap-4 text-sm" data-admin-benefit-report="">
    <BenefitReportControls filters={filters} admin={admin} now={now} />
    <StatsSummaryGrid>
      <StatsSummaryTile label="기간 발급수" value={`${data.summary.issued.toLocaleString('ko-KR')}장`} />
      <StatsSummaryTile label="기간 결제 사용수" value={`${data.summary.paidUses.toLocaleString('ko-KR')}건`} />
      <StatsSummaryTile label="쿠폰 할인금액" value={krw(data.summary.discountAmount)} />
      <StatsSummaryTile label="기간 발급분 현재 사용률" value={benefitCohortRate(data.summary)} />
    </StatsSummaryGrid>
    {comparison ? <StatsComparison filters={filters} now={now} rows={[
      { label: '발급수', current: data.summary.issued, previous: comparison.summary.issued, unit: '장' },
      { label: '결제 사용수', current: data.summary.paidUses, previous: comparison.summary.paidUses, unit: '건' },
      { label: '쿠폰 할인금액', current: data.summary.discountAmount, previous: comparison.summary.discountAmount, format: krw },
    ]} /> : null}
    <details className="rounded-lg border bg-muted/40 px-4 py-3"><summary className="cursor-pointer font-medium">집계 기준 확인</summary><ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
      <li>KST 기준, 최대 366일입니다. 발급수는 발급일, 결제 사용수·할인·주문금액은 쿠폰 적용일, 복구수는 복구일 기준입니다.</li>
      <li>결제 사용수는 조회 시점에 결제완료·발주확인·배송중·배송완료·거래확정인 주문만 포함합니다. 결제 대기와 취소·반품으로 복구된 사용은 제외됩니다.</li>
      <li>기간 발급분 사용률은 해당 기간에 발급된 쿠폰 중 현재 결제가 유지되는 사용 비율입니다. 기간 사용수 ÷ 기간 발급수와는 다르며, 조회 후 취소에 따라 달라질 수 있습니다.</li>
      <li>사용 주문금액은 할인·적립금 적용 후 주문 총액입니다. 검색·할인종류·대상 필터는 현재 쿠폰 설정을 기준으로 합니다. 주·월의 일부 기간은 조회기간 안의 실적만 합산합니다.</li>
      <li>엑셀은 혜택·사용 상세·발급 상세 각각 최대 10,000건입니다. 발급 상세를 선택해도 사용 상세를 함께 내보내므로 사용 이력이 한도를 넘으면 기간을 줄여야 합니다.</li>
    </ul></details>
    <ConsoleListCard title="혜택 지급현황" total={data.couponCount} unit="개" actions={issuanceExportTooLarge ? <p className="text-warning">발급 상세 엑셀은 최대 10,000건입니다. 기간이나 혜택 조건을 줄여주세요.</p> : <a className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" href={benefitReportHref(resolvedFilters, '/api/admin/benefit-workbook')}><Download aria-hidden="true" />엑셀 다운로드</a>}>
      {filters.code ? <p className="text-muted-foreground">선택한 혜택: <strong className="font-medium text-foreground">{filters.code}</strong> · <Link className="underline underline-offset-4" href={benefitReportHref({ ...resolvedFilters, code: '', page: 1 })}>전체 혜택 보기</Link></p> : null}
    <ConsoleGrid caption="혜택별 지급현황" preferencesKey="benefit-report-coupons" columns={[{ key: 'name', label: '혜택이름', width: '220px' }, { key: 'code', label: '혜택 ID', width: '160px' }, ...metricColumns]}
      rows={data.coupons.map(row => ({ id: row.code, cells: [<Link key="name" className="font-medium underline-offset-4 hover:underline" href={benefitReportHref({ ...resolvedFilters, code: row.code, detail: 'uses', page: 1 })}>{row.name}</Link>, row.code,
        <Link key="issued" className="tabular-nums underline underline-offset-4" aria-label={`${row.name} 발급 ${row.issued.toLocaleString('ko-KR')}장 상세`} href={benefitReportHref({ ...resolvedFilters, code: row.code, detail: 'issuances', page: 1 })}>{row.issued.toLocaleString('ko-KR')}</Link>, ...metricCells(row).slice(1)] }))} emptyLabel="조회기간에 발급·결제 사용·복구된 혜택이 없습니다." />
      {!filters.code ? pagination : null}
    </ConsoleListCard>
    {filters.code ? <nav aria-label="쿠폰 상세 종류" className={TABS}>
      <Link className={TAB} aria-current={!showIssuances ? 'page' : undefined} href={benefitReportHref({ ...resolvedFilters, detail: 'uses', page: 1 })}>사용 상세</Link>
      <Link className={TAB} aria-current={showIssuances ? 'page' : undefined} href={benefitReportHref({ ...resolvedFilters, detail: 'issuances', page: 1 })}>발급 상세</Link>
    </nav> : null}
    {showIssuances ? <ConsoleListCard aria-labelledby="benefit-issuance-heading" headingLevel={3} title={<span id="benefit-issuance-heading">쿠폰 발급 상세</span>}>
      {issuances ? <>
        <p>발급 전체 <strong className="font-medium tabular-nums">{issuances.totalCount.toLocaleString('ko-KR')}장</strong> · 현재 결제 사용 집계 <strong className="font-medium tabular-nums">{issuances.paidUseCount.toLocaleString('ko-KR')}장</strong> · 조회시각(KST) {issuanceDate(issuances.asOf)}</p>
        <p className="text-muted-foreground">조회기간에 발급된 쿠폰입니다. ‘예’는 현재 결제가 유지되어 기간 발급분 사용률에 포함되는 건입니다. ‘아니오’는 사용 가능이나 환불 완료를 뜻하지 않습니다. 발급·취소가 진행 중이면 먼저 읽은 상단 요약과 차이가 날 수 있습니다.</p>
        <ConsoleGrid caption="쿠폰 발급 상세" preferencesKey="benefit-report-issuances" columns={[
          { key: 'id', label: '발급 ID', width: '300px' }, { key: 'coupon', label: '쿠폰 ID', width: '180px' },
          { key: 'date', label: '발급일시(KST)', width: '190px' }, { key: 'paid', label: '현재 결제 사용 집계 여부', width: '200px' },
        ]} rows={issuances.rows.map(row => ({ id: row.id, cells: [row.id, row.couponCode, issuanceDate(row.issuedAt), row.isPaidUse ? '예' : '아니오'] }))} emptyLabel={issuances.totalCount ? '이 페이지에는 발급 내역이 없습니다.' : '선택한 조건과 기간에 발급된 쿠폰이 없습니다.'} />
        {filters.page > 1 && issuances.rows.length === 0 ? <Link className={`${PAGE_LINK} self-start`} data-slot="button" href={benefitReportHref({ ...resolvedFilters, page: 1 })}>발급 상세 첫 페이지</Link> : null}
      </> : <AdminNotice role="alert" tone="danger">발급 상세를 읽지 못했습니다. <Link className="font-medium underline underline-offset-4" href={benefitReportHref(resolvedFilters)}>다시 조회</Link></AdminNotice>}
    {pagination}
    </ConsoleListCard> : null}
    {filters.code && !showIssuances ? <ConsoleListCard headingLevel={3} title="쿠폰 사용 상세"><ConsoleGrid caption="쿠폰 사용 상세" preferencesKey="benefit-report-uses" columns={[
      { key: 'order', label: '주문번호', width: '300px' }, { key: 'date', label: '적용일시(KST)', width: '180px' }, { key: 'status', label: '현재 상태', width: '100px' },
      { key: 'discount', label: '할인금액', align: 'end', width: '130px' }, { key: 'amount', label: '주문금액', align: 'end', width: '130px' }, { key: 'released', label: '복구일시(KST)', width: '180px' },
    ]} rows={data.uses.map(row => ({ id: row.id, cells: [<Link key="order" className="tabular-nums underline-offset-4 hover:underline" href={`/admin/sales/orders/${row.orderId}`}>{row.orderId}</Link>, new Date(row.appliedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }), useStatus[row.status], krw(row.discountAmount), krw(row.orderAmount), row.releasedAt ? new Date(row.releasedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—'] }))} emptyLabel="선택한 기간에 쿠폰 사용 이력이 없습니다." />{pagination}</ConsoleListCard> : null}
    <ConsoleListCard headingLevel={3} title={<>{filters.bucket === 'week' ? '주간' : filters.bucket === 'month' ? '월간' : '일간'} 혜택 추이</>}>
    <ConsoleGrid caption="기간별 혜택 추이" preferencesKey="benefit-report-daily" columns={[{ key: 'date', label: '기준일(KST)', width: '130px' }, ...metricColumns]} rows={trend.map(row => ({ id: row.date, cells: [row.date, ...metricCells(row)] }))} />
    </ConsoleListCard>
  </section>;
}
