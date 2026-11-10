import 'server-only';
import ExcelJS from 'exceljs';
import { CUSTOMER_PURCHASE_GROUP_LABEL, customerPurchaseShare, type CustomerPurchaseFilters, type CustomerPurchasePeriod, type CustomerPurchaseReport } from './customer-purchase-report';

export async function buildCustomerPurchaseWorkbook(data: CustomerPurchaseReport, filters: CustomerPurchaseFilters, generatedAt = new Date()) {
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'ICONS'; workbook.created = generatedAt;
  function table(name: string, headers: string[], rows: (string | number | null)[][]) {
    const sheet = workbook.addWorksheet(name);
    const metadata = name === '조회 정보';
    sheet.columns = headers.map(header => ({ header, width: metadata ? header === '항목' ? 48 : 104 : 22 }));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    rows.forEach(values => {
      const row = sheet.addRow(values);
      row.eachCell((cell, column) => {
        cell.font = { name: '맑은 고딕', size: 11 };
        cell.alignment = { vertical: 'middle', wrapText: metadata };
        cell.numFmt = typeof cell.value === 'number' ? /비중|객단가/.test(headers[column - 1]) ? '#,##0.00' : '#,##0' : '@';
      });
      row.height = metadata ? Math.max(24, Math.ceil(String(values[1] ?? '').length / 48) * 18) : 22;
    });
    sheet.getRow(1).font = { name: '맑은 고딕', bold: true, size: 11 };
    sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
    sheet.getRow(1).height = 30;
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF0F5' } };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: headers.length } };
  }
  function rows(period: CustomerPurchasePeriod, label: string) {
    const all = period.rows.find(row => row.group === 'all')!;
    return period.rows.map(row => [label, period.from, period.to, CUSTOMER_PURCHASE_GROUP_LABEL[row.group], row.customerCount,
      row.group === 'all' ? null : customerPurchaseShare(row.customerCount, all.customerCount), row.orderCount,
      row.itemSubtotal, row.couponAmount, row.productSalesAmount,
      row.group === 'all' || row.productSalesAmount === null || all.productSalesAmount === null ? null : customerPurchaseShare(row.productSalesAmount, all.productSalesAmount),
      row.storeCreditAmount, row.cashProductAmount, row.averagePerCustomer, row.monetaryIssueOrderCount]);
  }
  const headers = ['종류', '기간 시작일(KST)', '기간 종료일(KST)', '고객분류', '결제고객수', '고객 비중(%)', '결제 주문수', '상품금액 합계(원)', '쿠폰 할인(원)', '상품 판매금액(원)', '판매금액 비중(%)', '사용 적립금(원)', '상품 실결제액(원)', '객단가(원)', '금액 확인 필요 주문수'];
  table('조회·비교 기간', headers, [...rows(data.current, '조회'), ...(data.comparison ? rows(data.comparison, '비교') : [])]);
  table(filters.grain === 'week' ? '13주 주간 추이' : '13개월 월간 추이', headers, [...data.trend].reverse().flatMap(period => rows(period, filters.grain === 'week' ? '주간' : '월간')));
  table('조회 정보', ['항목', '내용'], [
    ['집계 단위', filters.grain === 'week' ? '마감된 주간(월요일~일요일)' : '마감된 월간(첫날~말일)'],
    ['조회 기간', `${data.current.from} ~ ${data.current.to}`], ['비교 기간', data.comparison ? `${data.comparison.from} ~ ${data.comparison.to}` : '비교하지 않음'],
    ['결제 기준', '상품 주문의 실제 승인·입금 시각. 이후 취소·반품도 포함. 티켓·미결제 취소·결제 시각 미확인 제외.'],
    ['신규/재구매', '각 결제 직전 180일 경계 포함. 이전 결제가 있으면 재구매. 같은 시각은 주문번호 오름차순으로 판단.'],
    ['고객 비중', '기간 중 유형이 바뀐 고객은 신규·재구매에 중복 포함되어 합계가 100%를 넘을 수 있음. 주문·금액은 중복 없음.'],
    ['상품 판매금액', '상품 단가×수량의 합계−복수구매 할인−쿠폰 할인. 사용 적립금 포함·배송비 제외.'],
    ['상품 실결제액', '상품 판매금액−사용 적립금. 배송비 제외.'],
    ['객단가', '상품 판매금액÷중복 제거 결제고객수. 소수 둘째 자리까지.'],
    ['금액 확인 필요', '주문 스냅샷 불일치 포함 유형·기간의 금액과 객단가는 빈칸. 고객수·주문수는 포함.'],
    ['시각 미확인 집계', '각 기간에 생성된 결제 완료 이력 주문 중 승인·입금 시각 미확인 주문. 결제 기간에 귀속하지 않음.'],
    ['조회기간 시각 미확인', data.current.unknownPaidAtCount], ...(data.comparison ? [['비교기간 시각 미확인', data.comparison.unknownPaidAtCount]] as (string | number)[][] : []),
    ...data.trend.map(period => [`${period.from} ~ ${period.to} 생성 주문 시각 미확인`, period.unknownPaidAtCount]),
    ['생성시각(UTC)', generatedAt.toISOString()], ['기존 고객현황', '주문 생성일·현재 인정 상태·조회기간 내 반복 구매 기준과 다름.'],
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
