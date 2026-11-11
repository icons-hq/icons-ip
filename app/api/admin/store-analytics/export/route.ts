import ExcelJS from 'exceljs';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getTrafficReport } from '@/lib/admin/store-analytics.server';
import { trafficFilters, trafficLabel, TRAFFIC_DIMENSIONS, TRAFFIC_STATE_LABELS } from '@/lib/admin/store-analytics';
import { adminListExportContentDisposition, kstDateTimeText, kstFileStamp } from '@/lib/admin/list-export';
import { addSafeWorkbookInfoSheet, addWorkbookTable, tableColumn as column } from '@/lib/admin/workbook-table';
export const runtime='nodejs';
export async function GET(request:Request){
 await requireAdminScreenAccess('/admin/stats/traffic');
 const search=new URL(request.url).searchParams;const filters=trafficFilters(Object.fromEntries(search));
 if(filters.error)return Response.json({error:filters.error},{status:400});
 try{
  const report=await getTrafficReport(filters,true);if(report.total>10000)return Response.json({error:'결과가 10,000개를 초과합니다. 기간이나 항목 검색을 좁혀주세요.'},{status:400});
  const generatedAt=new Date(),stamp=kstFileStamp(generatedAt),marketing=filters.dimension==='link';
  const workbook=new ExcelJS.Workbook();workbook.creator='ICONS';workbook.created=generatedAt;
  addWorkbookTable(workbook,'분석 결과',[column('항목 번호','code',36),column('항목명','text',36),column('방문 세션','count'),column('전체 열람','count'),column('상품 상세 열람','count'),column('링크 유입','count'),column('결제 주문','count'),column('전환 세션','count'),column('전환율(%)','number'),column('실제 결제금액','amount'),column('완료 환불금액','amount'),column('환불 차감금액','amount'),column('비교 방문 세션','count'),column('비교 결제 주문','count'),column('비교 전환율(%)','number'),column('보존 합계','text',10),column('최종 관측 시각','date')],
   report.rows.map(row=>[row.key,trafficLabel(filters.dimension,row.key,row.label),row.metrics.sessions,row.metrics.pageViews,row.metrics.productViews,row.metrics.linkLandings,row.metrics.orders,row.metrics.convertedSessions,row.metrics.conversionRate,row.metrics.grossAmount,row.metrics.refundAmount,row.metrics.netAmount,row.comparison?.sessions??null,row.comparison?.orders??null,row.comparison?.conversionRate??null,row.archived?'예':'아니오',kstDateTimeText(row.observedUntil)]));
  addWorkbookTable(workbook,'추이',[column('일자','date',14),column('관측 상태','text',22),column('방문 세션','count'),column('상품 상세 열람','count'),column('결제 주문','count'),column('전환율(%)','number'),column('보존 합계','text',10)],
   report.trend.map(row=>[row.date,row.states.map(state=>TRAFFIC_STATE_LABELS[state]||state).join(', '),row.metrics.sessions,row.metrics.productViews,row.metrics.orders,row.metrics.conversionRate,row.archived?'예':'아니오']));
  addSafeWorkbookInfoSheet(workbook,[['화면',marketing?'마케팅 링크 성과':'방문·유입 분석'],['조회 기간',`${report.from} ~ ${report.to}`],['비교 기간',report.comparisonFrom?`${report.comparisonFrom} ~ ${report.comparisonTo}`:'비교 안 함'],['비교 방식',filters.compare==='year'?'전년 같은 기간':filters.compare==='previous'?'직전 같은 기간':'비교 안 함'],['추이 단위',filters.grain==='week'?'주별':filters.grain==='month'?'월별':'일별'],['분석 기준',TRAFFIC_DIMENSIONS[filters.dimension]],['선택 항목',report.selectedLabel||'전체'],['검색어',filters.query||'전체'],['집계 시각 (KST)',kstDateTimeText(report.observedAt)],['내려받은 시각 (KST)',kstDateTimeText(generatedAt.toISOString())],['건수',`${report.total.toLocaleString('ko-KR')}개 항목`],['수집 사용',report.collection.enabled?'사용':'비활성'],['정상 관측 일수',report.coverage.observed_days],['일부/진행 중 일수',report.coverage.partial_days],['미측정 일수',report.coverage.missing_days],['보존 합계 일수',report.coverage.archived_days],['안내','빈 수치는 미측정 또는 금액 배분 미지원입니다. 세션은 고유 고객수가 아닙니다.'],['전환','같은 세션에서 생성하고 7일 내 카드 승인 또는 무통장 입금 확인이 완료된 주문. 방문일 귀속. 0원 주문·티켓 제외.'],['금액','배송비·할인·적립금을 반영한 실제 결제금액. 완료 환불을 별도 차감.'],['보존','원자료 90일, 일별 합계 13개월. 보존 합계는 최종 관측 시점 이후 환불 미반영.']]);
  const buffer=await workbook.xlsx.writeBuffer();return new Response(new Uint8Array(buffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':adminListExportContentDisposition(`icons-${marketing?'마케팅링크성과':'방문유입분석'}-${stamp}.xlsx`,`icons-${marketing?'marketing-links':'traffic'}-${stamp}.xlsx`),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){unstable_rethrow(error);return Response.json({error:'방문 통계 파일을 만들지 못했습니다.'},{status:503});}
}
