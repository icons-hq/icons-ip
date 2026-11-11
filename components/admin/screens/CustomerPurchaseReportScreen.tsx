import { CustomerPurchaseFilters } from '@/components/admin/CustomerPurchaseFilters';
import { CustomerPurchaseTrend } from '@/components/admin/CustomerPurchaseTrend';
import { CustomerPurchaseDataTable } from '@/components/admin/CustomerPurchaseDataTable';
import { ConsoleGrid } from '@/components/admin/console';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { CUSTOMER_PURCHASE_GROUP_LABEL, customerPurchaseShare, customerPurchaseValue as value, type CustomerPurchaseFilters as Filters, type CustomerPurchaseReport } from '@/lib/admin/customer-purchase-report';
import { adminStatsChange } from '@/lib/admin/stats';

const NOTE_CLASS = 'text-sm leading-relaxed text-muted-foreground';

/* 템플릿 룩(ADR-0028): 조회 조건 카드 → 요약 카드 → 유형별 비중 카드 → 기간 상세 표 → 추이 → 데이터 표 → 집계 기준. */
export function CustomerPurchaseReportScreen({ filters, data, now }: { filters: Filters; data: CustomerPurchaseReport | null; now: Date }) {
  const all = data?.current.rows.find(row => row.group === 'all');
  const priorAll = data?.comparison?.rows.find(row => row.group === 'all');
  return <div className="flex min-w-0 flex-col gap-4" data-customer-purchase="">
    <CustomerPurchaseFilters key={JSON.stringify(filters)} filters={filters} now={now.toISOString()} />
    {data && all ? <>
      <div className="flex flex-col gap-1"><h2 className="text-lg font-semibold tracking-tight text-foreground">신규/재구매 분석</h2>
        <p className={NOTE_CLASS}>실제 승인·입금 시점의 상품 주문 기준입니다. 이후 취소·반품된 결제도 포함합니다.</p></div>
      <div className="grid gap-3 sm:grid-cols-3">{([
        ['결제고객수', all.customerCount, priorAll?.customerCount, '명'],
        ['상품 판매금액', all.productSalesAmount, priorAll?.productSalesAmount, '원'],
        ['객단가', all.averagePerCustomer, priorAll?.averagePerCustomer, '원'],
      ] as const).map(([label, amount, previous, unit]) => <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4 text-card-foreground" key={label}><span className="text-xs text-muted-foreground">{label}</span><strong className="text-2xl font-semibold text-foreground tabular-nums">{value(amount, label === '객단가' ? 2 : 0)}{amount === null ? '' : unit}</strong>{data.comparison ? <small className="text-xs text-muted-foreground tabular-nums">비교기간 {value(previous ?? null, 2)}{previous === null || previous === undefined ? '' : unit} · {amount === null || previous === null || previous === undefined ? '비교 불가' : adminStatsChange(amount, previous)}</small> : null}</div>)}</div>
      {all.monetaryIssueOrderCount > 0 ? <AdminNotice role="status" tone="warning">주문 금액 확인이 필요한 결제 {value(all.monetaryIssueOrderCount)}건이 포함되어 상품 금액과 객단가를 표시하지 않습니다. 결제고객수·주문수는 포함됩니다.</AdminNotice> : null}
      {data.current.unknownPaidAtCount > 0 ? <AdminNotice role="status" tone="warning">조회기간 내 생성된 결제 완료 이력 주문 중 승인·입금 시각 미확인 {value(data.current.unknownPaidAtCount)}건은 분석에서 제외되었습니다.</AdminNotice> : null}
      <section aria-label="고객 유형별 비중" className="flex min-w-0 flex-col rounded-xl border bg-card text-card-foreground"><h3 className="border-b px-4 py-3 text-base font-semibold text-foreground">고객 유형별 비중</h3><div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">{data.current.rows.filter(row => row.group !== 'all').map(row => {
        const share = customerPurchaseShare(row.customerCount, all.customerCount);
        const salesShare = row.productSalesAmount === null || all.productSalesAmount === null ? null : customerPurchaseShare(row.productSalesAmount, all.productSalesAmount);
        return <article className="flex min-w-0 flex-col gap-3 p-4" key={row.group}><h4 className="text-sm font-semibold text-foreground">{CUSTOMER_PURCHASE_GROUP_LABEL[row.group]} 고객</h4><dl className="grid gap-2.5 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">결제고객수</dt><dd className="text-right tabular-nums">{value(row.customerCount)}명 / {share === null ? '—' : `${value(share, 1)}%`}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">상품 판매금액</dt><dd className="text-right tabular-nums">{value(row.productSalesAmount)}{row.productSalesAmount === null ? '' : '원'} / {salesShare === null ? '—' : `${value(salesShare, 1)}%`}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">객단가</dt><dd className="text-right tabular-nums">{value(row.averagePerCustomer, 2)}{row.averagePerCustomer === null ? '' : '원'}</dd></div>
        </dl></article>;
      })}</div><p className="border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground">각 결제 직전 180일 안에 이전 결제가 있으면 재구매입니다. 기간 중 신규에서 재구매로 바뀐 고객은 두 유형에 포함되어 고객 비중 합계가 100%를 넘을 수 있습니다.</p></section>
      <h3 className="text-base font-semibold text-foreground">조회·비교 기간 상세</h3>
      <ConsoleGrid caption="고객 구매 분석 기간별 요약" columns={[
        { key: 'period', label: '기간(KST)', width: '230px' }, { key: 'group', label: '고객분류', width: '100px' },
        { key: 'customers', label: '결제고객수', align: 'end', width: '110px' }, { key: 'orders', label: '결제 주문수', align: 'end', width: '110px' },
        { key: 'subtotal', label: '상품금액 합계', align: 'end', width: '135px' }, { key: 'coupon', label: '쿠폰 할인', align: 'end', width: '110px' },
        { key: 'sales', label: '상품 판매금액', align: 'end', width: '140px' }, { key: 'credits', label: '사용 적립금', align: 'end', width: '110px' },
        { key: 'cash', label: '상품 실결제액', align: 'end', width: '140px' }, { key: 'average', label: '객단가', align: 'end', width: '110px' },
        { key: 'issue', label: '금액 확인 필요', align: 'end', width: '115px' },
      ]} rows={[data.current, ...(data.comparison ? [data.comparison] : [])].flatMap((period, i) => period.rows.map(row => ({
        id: `${i}-${row.group}`, cells: [<span className="whitespace-nowrap tabular-nums" key="period">{i ? '비교' : '조회'} {period.from} ~ {period.to}</span>, CUSTOMER_PURCHASE_GROUP_LABEL[row.group], value(row.customerCount), value(row.orderCount), value(row.itemSubtotal), value(row.couponAmount), value(row.productSalesAmount), value(row.storeCreditAmount), value(row.cashProductAmount), value(row.averagePerCustomer, 2), row.monetaryIssueOrderCount ? `${value(row.monetaryIssueOrderCount)}건` : '—'],
      })))} />
      {data.comparison && data.comparison.unknownPaidAtCount > 0 ? <p className={NOTE_CLASS}>비교기간 내 생성된 결제 완료 이력 주문 중 승인·입금 시각 미확인 {value(data.comparison.unknownPaidAtCount)}건은 분석에서 제외되었습니다.</p> : null}
      <CustomerPurchaseTrend periods={data.trend} grain={filters.grain} />
      <CustomerPurchaseDataTable key={`${filters.grain}:${filters.from}:${filters.to}`} periods={data.trend} grain={filters.grain} />
      <details className="rounded-xl border bg-muted/30 px-4 py-3 text-sm leading-relaxed"><summary className="cursor-pointer font-medium text-foreground">집계 기준과 금액 계산</summary><ul className="mt-2 flex list-disc flex-col gap-2 pl-5 text-muted-foreground">
        <li>상품 판매금액 = 주문 당시 상품 단가 × 수량의 합계 − 복수구매 할인 − 쿠폰 할인. 사용 적립금은 포함하며 배송비는 제외합니다.</li>
        <li>상품 실결제액 = 상품 판매금액 − 사용 적립금. 객단가 = 상품 판매금액 ÷ 중복을 제거한 결제고객수입니다.</li>
        <li>승인·입금 근거가 있는 상품 주문만 집계합니다. 티켓, 미결제 취소, 결제 시각 미확인 주문은 제외합니다. 같은 결제 시각에는 주문번호 오름차순으로 신규·재구매를 판단합니다.</li>
        <li>신규·재구매 이력은 각 결제 전 180일 경계를 포함합니다. 결제 주문과 금액은 한 유형에만 집계합니다.</li>
        <li>주문 스냅샷의 금액이 맞지 않으면 해당 고객유형·기간의 금액 전체를 표시하지 않습니다. 확인 필요 주문수를 표와 엑셀에 함께 표시합니다.</li>
        <li>추이의 기간별 시각 미확인 건수는 엑셀의 내려받기 정보 시트에서 확인할 수 있습니다. 고객현황의 기간 내 재구매율과는 집계 기준이 다릅니다.</li>
      </ul></details>
    </> : null}
  </div>;
}
