import 'server-only';
import ExcelJS from 'exceljs';
import { CUSTOMER_PURCHASE_GROUP_LABEL, customerPurchaseShare, type CustomerPurchaseFilters, type CustomerPurchasePeriod, type CustomerPurchaseReport } from './customer-purchase-report';
import { kstDateTimeText } from './list-export';
import { WORKBOOK_NUMBER_FORMAT } from './workbook-format';
import { addSafeWorkbookInfoSheet, addWorkbookTable, tableColumn as column } from './workbook-table';

const COLUMNS = [
  column('종류', 'text', 8), column('기간 시작일', 'date', 14), column('기간 종료일', 'date', 14), column('고객분류', 'text', 12),
  column('결제고객수', 'count'), column('고객 비중(%)', 'number'), column('결제 주문수', 'count'), column('상품금액 합계', 'amount'),
  column('쿠폰 할인', 'amount'), column('상품 판매금액', 'amount'), column('판매금액 비중(%)', 'number'), column('사용 적립금', 'amount'),
  column('상품 실결제액', 'amount'), column('객단가', 'number', 14, WORKBOOK_NUMBER_FORMAT), column('금액 확인 필요 주문수', 'count'),
];

export async function buildCustomerPurchaseWorkbook(data: CustomerPurchaseReport, filters: CustomerPurchaseFilters, generatedAt = new Date()) {
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'ICONS'; workbook.created = generatedAt;
  function rows(period: CustomerPurchasePeriod, label: string) {
    const all = period.rows.find(row => row.group === 'all')!;
    return period.rows.map(row => [label, period.from, period.to, CUSTOMER_PURCHASE_GROUP_LABEL[row.group], row.customerCount,
      row.group === 'all' ? null : customerPurchaseShare(row.customerCount, all.customerCount), row.orderCount,
      row.itemSubtotal, row.couponAmount, row.productSalesAmount,
      row.group === 'all' || row.productSalesAmount === null || all.productSalesAmount === null ? null : customerPurchaseShare(row.productSalesAmount, all.productSalesAmount),
      row.storeCreditAmount, row.cashProductAmount, row.averagePerCustomer, row.monetaryIssueOrderCount]);
  }
  addWorkbookTable(workbook, '조회·비교 기간', COLUMNS, [...rows(data.current, '조회'), ...(data.comparison ? rows(data.comparison, '비교') : [])]);
  addWorkbookTable(workbook, filters.grain === 'week' ? '13주 주간 추이' : '13개월 월간 추이', COLUMNS, [...data.trend].reverse().flatMap(period => rows(period, filters.grain === 'week' ? '주간' : '월간')));
  addSafeWorkbookInfoSheet(workbook, [
    ['화면', '신규/재구매 분석'],
    ['집계 단위', filters.grain === 'week' ? '마감된 주간(월요일~일요일)' : '마감된 월간(첫날~말일)'],
    ['조회 기간', `${data.current.from} ~ ${data.current.to}`], ['비교 기간', data.comparison ? `${data.comparison.from} ~ ${data.comparison.to}` : '비교하지 않음'],
    ['내려받은 시각 (KST)', kstDateTimeText(generatedAt.toISOString())],
    ['결제 기준', '상품 주문의 실제 승인·입금 시각. 이후 취소·반품도 포함. 티켓·미결제 취소·결제 시각 미확인 제외.'],
    ['신규/재구매', '각 결제 직전 180일 경계 포함. 이전 결제가 있으면 재구매. 같은 시각은 주문번호 오름차순으로 판단.'],
    ['고객 비중', '기간 중 유형이 바뀐 고객은 신규·재구매에 중복 포함되어 합계가 100%를 넘을 수 있음. 주문·금액은 중복 없음.'],
    ['상품 판매금액', '상품 단가×수량의 합계−복수구매 할인−쿠폰 할인. 사용 적립금 포함·배송비 제외.'],
    ['상품 실결제액', '상품 판매금액−사용 적립금. 배송비 제외.'],
    ['객단가', '상품 판매금액÷중복 제거 결제고객수. 원 단위로 표시합니다.'],
    ['금액 확인 필요', '주문 스냅샷 불일치 포함 유형·기간의 금액과 객단가는 빈칸. 고객수·주문수는 포함.'],
    ['시각 미확인 집계', '각 기간에 생성된 결제 완료 이력 주문 중 승인·입금 시각 미확인 주문. 결제 기간에 귀속하지 않음.'],
    ['조회기간 시각 미확인', data.current.unknownPaidAtCount.toLocaleString('ko-KR')],
    ...(data.comparison ? [['비교기간 시각 미확인', data.comparison.unknownPaidAtCount.toLocaleString('ko-KR')]] as const : []),
    ...data.trend.map(period => [`${period.from} ~ ${period.to} 생성 주문 시각 미확인`, period.unknownPaidAtCount.toLocaleString('ko-KR')] as const),
    ['기존 고객현황', '주문 생성일·현재 인정 상태·조회기간 내 반복 구매 기준과 다름.'],
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
