import Link from 'next/link';
import { ConsoleGrid, type ConsoleGridColumn } from '@/components/admin/console';
import { StatsComparison } from '@/components/admin/StatsComparison';
import { BENEFIT_REPORT_PATH, benefitCohortRate, benefitReportHref, benefitTrend, type BenefitIssuances, type BenefitMetrics, type BenefitReport, type BenefitReportFilters } from '@/lib/admin/benefit-report';
import { adminStatsDateInputs } from '@/lib/admin/stats';
import { krw } from '@/lib/format';

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
    <nav aria-label="혜택 종류" className="admin-benefit-report-tabs"><Link aria-current="page" href={BENEFIT_REPORT_PATH}>쿠폰</Link>{admin ? <Link href="/admin/sales/store-credits">적립금 지급내역</Link> : null}</nav>
    <form className="admin-coupon-filters admin-sales-filters" action={BENEFIT_REPORT_PATH} method="get" key={benefitReportHref(filters)}>
      <h2>혜택 지급 조회</h2>
      {filters.code ? <><input type="hidden" name="code" value={filters.code} /><input type="hidden" name="detail" value={filters.detail} /></> : null}
      <div className="admin-sales-filter-rows">
        <div className="admin-sales-filter-field"><label htmlFor="benefit-query">혜택이름 / ID</label><div className="admin-sales-filter-value"><input id="benefit-query" type="search" name="q" maxLength={100} defaultValue={filters.query} placeholder="혜택이름 또는 쿠폰 ID" /></div></div>
        <div className="admin-sales-filter-field"><label htmlFor="benefit-discount">할인종류</label><div className="admin-sales-filter-value"><select id="benefit-discount" name="discount" defaultValue={filters.discount}><option value="all">전체</option><option value="fixed">정액 할인</option><option value="percent">정률 할인</option></select></div></div>
        <div className="admin-sales-filter-field"><label htmlFor="benefit-segment">타겟팅 대상</label><div className="admin-sales-filter-value"><select id="benefit-segment" name="segment" defaultValue={filters.segment}><option value="all">전체</option><option value="first_purchase">첫 구매 고객</option><option value="repeat_purchase">재구매 고객</option><option value="targeted">지정 고객</option></select></div></div>
        <div className="admin-sales-filter-field"><span>조회기간</span><div className="admin-sales-filter-value">
          <div className="admin-benefit-report-dates"><select name="bucket" aria-label="집계 단위" defaultValue={filters.bucket ?? 'day'}><option value="day">일간</option><option value="week">주간</option><option value="month">월간</option></select><input name="from" type="date" aria-label="조회 시작일" defaultValue={dates.from} required /><span>~</span><input name="to" type="date" aria-label="조회 종료일" defaultValue={dates.to} required /></div>
          <label><input type="checkbox" name="compare" value="previous" defaultChecked={filters.compare} /> 직전 동일 기간 비교</label>
        </div></div>
      </div>
      <div className="admin-sales-filter-actions"><button type="submit" className="btn admin-sales-search">조회</button><Link className="btn btn-ghost" href={BENEFIT_REPORT_PATH}>초기화</Link></div>
    </form>
  </>;
}

export function BenefitReportScreen({ data, comparison, issuances = null, filters, admin, now = new Date() }: { data: BenefitReport; comparison: BenefitReport | null; issuances?: BenefitIssuances | null; filters: BenefitReportFilters; admin: boolean; now?: Date }) {
  const trend = benefitTrend(data.daily, filters, now);
  const resolvedFilters = { ...filters, ...adminStatsDateInputs(filters, now) };
  const showIssuances = Boolean(filters.code && filters.detail === 'issuances');
  const issuanceExportTooLarge = showIssuances && Boolean(issuances && issuances.totalCount > 10000);
  const count = filters.code ? showIssuances ? issuances?.totalCount ?? null : data.useCount : data.couponCount;
  return <section className="admin-console admin-stats admin-benefits-console wc-admin-kit">
    <BenefitReportControls filters={filters} admin={admin} now={now} />
    <div className="admin-stats-summary">
      <div><span>기간 발급수</span><strong>{data.summary.issued.toLocaleString('ko-KR')}장</strong></div>
      <div><span>기간 결제 사용수</span><strong>{data.summary.paidUses.toLocaleString('ko-KR')}건</strong></div>
      <div><span>쿠폰 할인금액</span><strong>{krw(data.summary.discountAmount)}</strong></div>
      <div><span>기간 발급분 현재 사용률</span><strong>{benefitCohortRate(data.summary)}</strong></div>
    </div>
    {comparison ? <StatsComparison filters={filters} now={now} rows={[
      { label: '발급수', current: data.summary.issued, previous: comparison.summary.issued, unit: '장' },
      { label: '결제 사용수', current: data.summary.paidUses, previous: comparison.summary.paidUses, unit: '건' },
      { label: '쿠폰 할인금액', current: data.summary.discountAmount, previous: comparison.summary.discountAmount, unit: '원' },
    ]} /> : null}
    <details className="admin-benefit-report-definitions"><summary>집계 기준 확인</summary><ul>
      <li>한국시간 기준, 최대 366일입니다. 발급수는 발급일, 결제 사용수·할인·주문금액은 쿠폰 적용일, 복구수는 복구일 기준입니다.</li>
      <li>결제 사용수는 조회 시점에 결제완료·발주확인·배송중·배송완료·거래확정인 주문만 포함합니다. 결제 대기와 취소·반품으로 복구된 사용은 제외됩니다.</li>
      <li>기간 발급분 사용률은 해당 기간에 발급된 쿠폰 중 현재 결제가 유지되는 사용 비율입니다. 기간 사용수 ÷ 기간 발급수와는 다르며, 조회 후 취소에 따라 달라질 수 있습니다.</li>
      <li>사용 주문금액은 할인·적립금 적용 후 주문 총액입니다. 검색·할인종류·대상 필터는 현재 쿠폰 설정을 기준으로 합니다. 주·월의 일부 기간은 조회기간 안의 실적만 합산합니다.</li>
      <li>엑셀은 혜택·사용 상세·발급 상세 각각 최대 10,000건입니다. 발급 상세를 선택해도 사용 상세를 함께 내보내므로 사용 이력이 한도를 넘으면 기간을 줄여야 합니다.</li>
    </ul></details>
    <div className="admin-benefit-report-heading"><h2>혜택 지급현황 <span>(총 {data.couponCount.toLocaleString('ko-KR')}개)</span></h2>{issuanceExportTooLarge ? <p>발급 상세 엑셀은 최대 10,000건입니다. 기간이나 혜택 조건을 줄여주세요.</p> : <a className="btn btn-ghost" href={benefitReportHref(resolvedFilters, '/api/admin/benefit-workbook')}>엑셀 다운로드</a>}</div>
    {filters.code ? <p>선택한 혜택: <strong>{filters.code}</strong> · <Link href={benefitReportHref({ ...resolvedFilters, code: '', page: 1 })}>전체 혜택 보기</Link></p> : null}
    <ConsoleGrid caption="혜택별 지급현황" preferencesKey="benefit-report-coupons" columns={[{ key: 'name', label: '혜택이름', width: '220px' }, { key: 'code', label: '혜택 ID', width: '160px' }, ...metricColumns]}
      rows={data.coupons.map(row => ({ id: row.code, cells: [<Link key="name" href={benefitReportHref({ ...resolvedFilters, code: row.code, detail: 'uses', page: 1 })}>{row.name}</Link>, row.code,
        <Link key="issued" aria-label={`${row.name} 발급 ${row.issued.toLocaleString('ko-KR')}장 상세`} href={benefitReportHref({ ...resolvedFilters, code: row.code, detail: 'issuances', page: 1 })}>{row.issued.toLocaleString('ko-KR')}</Link>, ...metricCells(row).slice(1)] }))} emptyLabel="조회기간에 발급·결제 사용·복구된 혜택이 없습니다." />
    {filters.code ? <nav aria-label="쿠폰 상세 종류" className="admin-benefit-report-tabs">
      <Link aria-current={!showIssuances ? 'page' : undefined} href={benefitReportHref({ ...resolvedFilters, detail: 'uses', page: 1 })}>사용 상세</Link>
      <Link aria-current={showIssuances ? 'page' : undefined} href={benefitReportHref({ ...resolvedFilters, detail: 'issuances', page: 1 })}>발급 상세</Link>
    </nav> : null}
    {showIssuances ? <section className="admin-benefit-issuances" aria-labelledby="benefit-issuance-heading">
      <h3 id="benefit-issuance-heading">쿠폰 발급 상세</h3>
      {issuances ? <>
        <p>발급 전체 <strong>{issuances.totalCount.toLocaleString('ko-KR')}장</strong> · 현재 결제 사용 집계 <strong>{issuances.paidUseCount.toLocaleString('ko-KR')}장</strong> · 조회시각(KST) {issuanceDate(issuances.asOf)}</p>
        <p>조회기간에 발급된 쿠폰입니다. ‘예’는 현재 결제가 유지되어 기간 발급분 사용률에 포함되는 건입니다. ‘아니오’는 사용 가능이나 환불 완료를 뜻하지 않습니다. 발급·취소가 진행 중이면 먼저 읽은 상단 요약과 차이가 날 수 있습니다.</p>
        <ConsoleGrid caption="쿠폰 발급 상세" preferencesKey="benefit-report-issuances" columns={[
          { key: 'id', label: '발급 ID', width: '300px' }, { key: 'coupon', label: '쿠폰 ID', width: '180px' },
          { key: 'date', label: '발급일시(KST)', width: '190px' }, { key: 'paid', label: '현재 결제 사용 집계 여부', width: '200px' },
        ]} rows={issuances.rows.map(row => ({ id: row.id, cells: [row.id, row.couponCode, issuanceDate(row.issuedAt), row.isPaidUse ? '예' : '아니오'] }))} emptyLabel={issuances.totalCount ? '이 페이지에는 발급 내역이 없습니다.' : '선택한 조건과 기간에 발급된 쿠폰이 없습니다.'} />
        {filters.page > 1 && issuances.rows.length === 0 ? <Link href={benefitReportHref({ ...resolvedFilters, page: 1 })}>발급 상세 첫 페이지</Link> : null}
      </> : <p role="alert">발급 상세를 읽지 못했습니다. <Link href={benefitReportHref(resolvedFilters)}>다시 조회</Link></p>}
    </section> : null}
    {filters.code && !showIssuances ? <><h3>쿠폰 사용 상세</h3><ConsoleGrid caption="쿠폰 사용 상세" preferencesKey="benefit-report-uses" columns={[
      { key: 'order', label: '주문번호', width: '300px' }, { key: 'date', label: '적용일시(KST)', width: '180px' }, { key: 'status', label: '현재 상태', width: '100px' },
      { key: 'discount', label: '할인금액', align: 'end', width: '130px' }, { key: 'amount', label: '주문금액', align: 'end', width: '130px' }, { key: 'released', label: '복구일시(KST)', width: '180px' },
    ]} rows={data.uses.map(row => ({ id: row.id, cells: [<Link key="order" href={`/admin/sales/orders/${row.orderId}`}>{row.orderId}</Link>, new Date(row.appliedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }), useStatus[row.status], krw(row.discountAmount), krw(row.orderAmount), row.releasedAt ? new Date(row.releasedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—'] }))} emptyLabel="선택한 기간에 쿠폰 사용 이력이 없습니다." /></> : null}
    {count !== null ? <nav className="admin-benefit-report-pagination" aria-label="혜택 리포트 페이지">{filters.page > 1 ? <Link href={benefitReportHref({ ...resolvedFilters, page: filters.page - 1 })}>이전</Link> : null}<span>{filters.page} / {Math.max(1, Math.ceil(count / 50))} 페이지 · {count.toLocaleString('ko-KR')}개</span>{filters.page * 50 < count ? <Link href={benefitReportHref({ ...resolvedFilters, page: filters.page + 1 })}>다음</Link> : null}</nav> : null}
    <h3>{filters.bucket === 'week' ? '주간' : filters.bucket === 'month' ? '월간' : '일간'} 혜택 추이</h3>
    <ConsoleGrid caption="기간별 혜택 추이" preferencesKey="benefit-report-daily" columns={[{ key: 'date', label: '기준일(KST)', width: '130px' }, ...metricColumns]} rows={trend.map(row => ({ id: row.date, cells: [row.date, ...metricCells(row)] }))} />
  </section>;
}
