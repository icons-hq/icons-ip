import ExcelJS from 'exceljs';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getTrafficReport } from '@/lib/admin/store-analytics.server';
import { trafficFilters, trafficLabel, TRAFFIC_DIMENSIONS, TRAFFIC_STATE_LABELS } from '@/lib/admin/store-analytics';
export const runtime='nodejs';
export async function GET(request:Request){
 await requireAdminScreenAccess('/admin/stats/traffic');
 const search=new URL(request.url).searchParams;const filters=trafficFilters(Object.fromEntries(search));
 if(filters.error)return Response.json({error:filters.error},{status:400});
 try{
  const report=await getTrafficReport(filters,true);if(report.total>10000)return Response.json({error:'결과가 10,000개를 초과합니다. 기간이나 항목 검색을 좁혀주세요.'},{status:400});
  const workbook=new ExcelJS.Workbook();const overview=workbook.addWorksheet('조회 조건');
  overview.addRows([['ICONS 방문·유입 통계'],['조회 기간',`${report.from} ~ ${report.to}`],['비교 기간',report.comparisonFrom?`${report.comparisonFrom} ~ ${report.comparisonTo}`:'비교 안 함'],['비교 방식',filters.compare==='year'?'전년 같은 기간':filters.compare==='previous'?'직전 같은 기간':'비교 안 함'],['추이 단위',filters.grain==='week'?'주별':filters.grain==='month'?'월별':'일별'],['분석 기준',TRAFFIC_DIMENSIONS[filters.dimension]],['선택 항목',report.selectedLabel||'전체'],['검색어',filters.query],['추출 시각',report.observedAt],['수집 사용',report.collection.enabled?'사용':'비활성'],['정상 관측 일수',report.coverage.observed_days],['일부/진행 중 일수',report.coverage.partial_days],['미측정 일수',report.coverage.missing_days],['보존 합계 일수',report.coverage.archived_days],['안내','빈 수치는 미측정 또는 금액 배분 미지원입니다. 세션은 고유 고객수가 아닙니다.'],['전환','같은 세션에서 생성하고 7일 내 카드 승인 또는 무통장 입금 확인이 완료된 주문. 방문일 귀속. 0원 주문·티켓 제외.'],['금액','배송비·할인·적립금을 반영한 실제 결제금액. 완료 환불을 별도 차감.'],['보존','원자료 90일, 일별 합계 13개월. 보존 합계는 최종 관측 시점 이후 환불 미반영.']]);
  overview.getColumn(1).width=24;overview.getColumn(2).width=110;overview.getColumn(2).alignment={wrapText:true};
  const sheet=workbook.addWorksheet('분석 결과');sheet.addRow(['항목 번호','항목명','방문 세션','전체 열람','상품 상세 열람','링크 유입','결제 주문','전환 세션','전환율(%)','실제 결제금액','완료 환불금액','환불 차감금액','비교 방문 세션','비교 결제 주문','비교 전환율(%)','보존 합계','최종 관측 시각']);
  for(const row of report.rows)sheet.addRow([row.key,trafficLabel(filters.dimension,row.key,row.label),row.metrics.sessions,row.metrics.pageViews,row.metrics.productViews,row.metrics.linkLandings,row.metrics.orders,row.metrics.convertedSessions,row.metrics.conversionRate,row.metrics.grossAmount,row.metrics.refundAmount,row.metrics.netAmount,row.comparison?.sessions??null,row.comparison?.orders??null,row.comparison?.conversionRate??null,row.archived?'예':'아니오',row.observedUntil]);
  sheet.columns.forEach((column,index)=>{column.width=index<2?36:18;});sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:'Q1'};sheet.getRow(1).font={bold:true};
  const trend=workbook.addWorksheet('추이');trend.addRow(['일자','관측 상태','방문 세션','상품 상세 열람','결제 주문','전환율(%)','보존 합계']);for(const row of report.trend)trend.addRow([row.date,row.states.map(state=>TRAFFIC_STATE_LABELS[state]||state).join(', '),row.metrics.sessions,row.metrics.productViews,row.metrics.orders,row.metrics.conversionRate,row.archived?'예':'아니오']);trend.columns.forEach(column=>{column.width=22;});
  const buffer=await workbook.xlsx.writeBuffer();return new Response(new Uint8Array(buffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="icons-traffic-${report.from}-${report.to}.xlsx"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){unstable_rethrow(error);return Response.json({error:'방문 통계 파일을 만들지 못했습니다.'},{status:503});}
}
