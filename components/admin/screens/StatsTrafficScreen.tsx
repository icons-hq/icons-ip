import Link from 'next/link';
import { Download, Search } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { CONSOLE_FILTER_CARD_CLASS, ConsoleFilterActions, ConsoleGrid, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { StatsTrafficChart } from '@/components/admin/charts/StatsTrafficChart';
import { STATS_NOTE, STATS_SEGMENTED, STATS_SEGMENT_LINK, StatsSummaryGrid, StatsSummaryTile } from '@/components/admin/StatsSummary';
import { NOTICE_PLACEMENT_LABELS, noticeTrafficTitle, TRAFFIC_DIMENSIONS, TRAFFIC_STATE_LABELS, trafficDifference, trafficHref, trafficLabel, trafficNumber, type NoticeTrafficReport, type TrafficCoverage, type TrafficFilters, type TrafficMetric, type TrafficReport } from '@/lib/admin/store-analytics';
const CARDS:{key:TrafficMetric;label:string;suffix?:string}[]=[{key:'sessions',label:'방문 세션'},{key:'productViews',label:'상품 상세 열람'},{key:'orders',label:'결제 주문'},{key:'conversionRate',label:'결제 전환율',suffix:'%'},{key:'grossAmount',label:'실제 결제금액',suffix:'원'},{key:'netAmount',label:'환불 차감금액',suffix:'원'}];
const COLUMNS:ConsoleGridColumn[]=[{key:'label',label:'분석 항목',width:'240px'},{key:'sessions',label:'방문 세션',align:'end',width:'110px'},{key:'views',label:'전체 열람',align:'end',width:'100px'},{key:'product',label:'상품 상세',align:'end',width:'100px'},{key:'landings',label:'링크 유입',align:'end',width:'100px'},{key:'orders',label:'결제 주문',align:'end',width:'120px'},{key:'rate',label:'전환율',align:'end',width:'100px'},{key:'change',label:'방문 증감',align:'end',width:'110px'},{key:'gross',label:'실제 결제금액',align:'end',width:'130px'},{key:'refund',label:'완료 환불금액',align:'end',width:'130px'},{key:'net',label:'환불 차감금액',align:'end',width:'140px'},{key:'observation',label:'관측',width:'170px'}];
const NOTICE_COLUMNS:ConsoleGridColumn[]=[{key:'title',label:'공지',width:'280px'},{key:'placement',label:'종류',width:'130px'},{key:'impressions',label:'노출',align:'end',width:'100px'},{key:'impressionSessions',label:'노출 세션',align:'end',width:'110px'},{key:'clicks',label:'클릭',align:'end',width:'100px'},{key:'clickSessions',label:'클릭 세션',align:'end',width:'110px'},{key:'clickRate',label:'클릭률',align:'end',width:'100px'}];
const OUTLINE_SM=buttonVariants({variant:'outline',size:'sm'});
const ALERT='rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive';
const DETAILS='group rounded-lg border bg-muted/40 px-4 py-3 text-sm';
const DETAILS_SUMMARY='cursor-pointer font-medium';
const DETAILS_LIST='mt-2 flex list-disc flex-col gap-1.5 pl-5 text-muted-foreground';
function coverageText(value:TrafficCoverage){return `정상 관측 ${value.observed_days}일 · 일부/진행 중 ${value.partial_days}일 · 미측정 ${value.missing_days}일${value.archived_days?` · 보존 합계 ${value.archived_days}일`:''}`;}
function dateTime(value:string|null){return value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'없음';}
/* 상단 공지(텍스트 공지 바·띠배너) 노출·클릭. undefined = 이 화면에서 다루지 않음(마케팅 링크 성과), null = 읽기 실패. */
/* 데이터분석 목록 카드(StatsSection·ConsoleListCard와 같은 흰 카드). */
const LIST_CARD='flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground';
function NoticeTrafficSection({report}:{report:NoticeTrafficReport|null}){
 return <section aria-labelledby="traffic-notices-title" className={LIST_CARD} data-console-list="">
  <h3 className="flex flex-wrap items-baseline gap-2 text-base font-medium" id="traffic-notices-title">상단 공지 노출·클릭 {report?<small className="text-xs font-normal text-muted-foreground tabular-nums">{report.rows.length.toLocaleString('ko-KR')}개</small>:null}</h3>
  {report===null?<p className={ALERT} role="alert">공지 노출·클릭 집계를 불러오지 못했습니다. 새로고침해주세요.</p>
   :<ConsoleGrid caption="상단 공지 노출·클릭" preferencesKey="traffic-notices" columns={NOTICE_COLUMNS} emptyLabel="이 기간에 집계된 공지 노출이 없습니다."
    rows={report.rows.map(row=>({id:`${row.curationId}:${row.placement}`,cells:[noticeTrafficTitle(row),NOTICE_PLACEMENT_LABELS[row.placement]??row.placement,trafficNumber(row.impressions),trafficNumber(row.impressionSessions),trafficNumber(row.clicks),trafficNumber(row.clickSessions),row.clickRate===null?'계산 불가':trafficNumber(row.clickRate,'%')]}))}/>}
  <p className={STATS_NOTE}>방문 통계에 동의한 공개 화면 방문에서 공지가 절반 이상 보인 횟수와 버튼·배너를 누른 횟수입니다. 한 화면에서는 공지마다 한 번만 세고, 클릭은 같은 방문에서 노출된 뒤에만 셉니다. 클릭률은 노출 대비 클릭입니다.</p>
 </section>;
}
export function StatsTrafficScreen({report,filters,marketing=false,noticeReport}:{report:TrafficReport|null;filters:TrafficFilters;marketing?:boolean;noticeReport?:NoticeTrafficReport|null}){
 const base=marketing?'/admin/stats/marketing':'/admin/stats/traffic';const financial=!filters.key||filters.dimension==='channel'||filters.dimension==='link';
 const dimensionFinancial=filters.dimension==='channel'||filters.dimension==='link';
 const title=marketing?'마케팅 링크 성과':'방문·유입 분석';
 const idPrefix=marketing?'marketing-traffic':'traffic';
 return <div className="flex min-w-0 flex-col gap-4" data-stats-screen={marketing?'marketing':'traffic'}>
  <AdminPageHeader title={title} description="선택 동의한 공개 화면 방문과 실제 결제 전환을 확인합니다."
   actions={marketing?<Link className={OUTLINE_SM} data-slot="button" href="/admin/marketing/links">마케팅 링크 관리</Link>:<Link className={OUTLINE_SM} data-slot="button" href="/admin/stats/marketing">마케팅 링크 성과</Link>}/>
  <nav aria-label="빠른 조회 기간" className={STATS_SEGMENTED}>{[1,7,30].map(days=><Link className={STATS_SEGMENT_LINK} key={days} href={`${base}?days=${days}&dimension=${filters.dimension}&compare=${filters.compare}&grain=${filters.grain}`}>{days===1?'오늘':`최근 ${days}일`}</Link>)}</nav>
  <form action={base} className={CONSOLE_FILTER_CARD_CLASS}>
   <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
   <div className="flex flex-wrap items-end gap-1.5">
    <div className="flex flex-col gap-1.5"><label className="text-sm leading-none font-medium" htmlFor={`${idPrefix}-from`}>시작일</label><Input className="w-40" defaultValue={filters.from} id={`${idPrefix}-from`} name="from" required type="date"/></div>
    <span aria-hidden="true" className="pb-1.5 text-muted-foreground">~</span>
    <div className="flex flex-col gap-1.5"><label className="text-sm leading-none font-medium" htmlFor={`${idPrefix}-to`}>종료일</label><Input className="w-40" defaultValue={filters.to} id={`${idPrefix}-to`} name="to" required type="date"/></div>
   </div>
   <div className="flex flex-col gap-1.5"><label className="text-sm leading-none font-medium" htmlFor={`${idPrefix}-compare`}>비교</label><NativeSelect defaultValue={filters.compare} id={`${idPrefix}-compare`} name="compare"><option value="previous">직전 같은 기간</option><option value="year">전년 같은 기간</option><option value="none">비교 안 함</option></NativeSelect></div>
   <div className="flex flex-col gap-1.5"><label className="text-sm leading-none font-medium" htmlFor={`${idPrefix}-grain`}>추이 단위</label><NativeSelect defaultValue={filters.grain} id={`${idPrefix}-grain`} name="grain"><option value="day">일별</option><option value="week">주별</option><option value="month">월별</option></NativeSelect></div>
   </div>
   <input type="hidden" name="dimension" value={filters.dimension}/>{filters.key?<input type="hidden" name="key" value={filters.key}/>:null}
   <ConsoleFilterActions><Link className={buttonVariants({variant:'outline'})} data-slot="button" href={base}>초기화</Link><button className={buttonVariants()} data-slot="button" type="submit">조회</button></ConsoleFilterActions>
  </form>
  {filters.error?<p className={ALERT} role="alert">{filters.error}</p>:null}
  {!report?null:<>
   <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground" role="status"><strong className="font-medium text-foreground">{report.collection.enabled?'수집 사용 중':'수집 비활성'}</strong><span>{coverageText(report.coverage)}</span><span>수집 시작 {dateTime(report.collection.startedAt)}</span>
    {report.collection.lastHeartbeatAt&&Date.parse(report.observedAt)-Date.parse(report.collection.lastHeartbeatAt)>180000?<span className="font-medium text-[var(--wc-warning)]">최근 수집 점검 기록이 3분 이상 지났습니다.</span>:null}
    {report.collection.retentionBacklog>0?<span className="font-medium text-[var(--wc-warning)]">보존 정리 대기 방문 {report.collection.retentionBacklog.toLocaleString('ko-KR')}건</span>:null}
   </div>
   {report.selectedKey?<p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">선택 항목: <strong className="font-medium">{trafficLabel(report.dimension,report.selectedKey,report.selectedLabel||report.selectedKey)}</strong> <Link className="ml-1 underline underline-offset-4" href={trafficHref(base,filters,{key:'',page:1})}>전체 보기</Link></p>:null}
   <StatsSummaryGrid>{CARDS.map(card=><StatsSummaryTile key={card.key} label={card.label} value={!financial&&['grossAmount','netAmount'].includes(card.key)?'배분 안 함':trafficNumber(report.summary[card.key],card.suffix)}>
    {report.comparison?<small className="text-xs text-muted-foreground tabular-nums">{trafficDifference(report.summary[card.key],report.comparison[card.key],card.key==='conversionRate')} {card.suffix==='원'&&report.summary[card.key]!==null&&report.comparison[card.key]!==null?'원':''} · 비교 {trafficNumber(report.comparison[card.key],card.suffix)}</small>:null}</StatsSummaryTile>)}</StatsSummaryGrid>
   {report.comparisonCoverage?<p className={STATS_NOTE}>비교 기간 {report.comparisonFrom} ~ {report.comparisonTo}: {coverageText(report.comparisonCoverage)}</p>:null}
   <StatsTrafficChart rows={report.trend} comparison={report.comparisonTrend}/>
   {!marketing?<nav aria-label="분석 기준" className={STATS_SEGMENTED}>{Object.entries(TRAFFIC_DIMENSIONS).filter(([key])=>key!=='link').map(([key,label])=><Link aria-current={filters.dimension===key?'page':undefined} className={STATS_SEGMENT_LINK} key={key} href={trafficHref(base,filters,{dimension:key as TrafficFilters['dimension'],key:'',query:'',page:1})}>{label}</Link>)}</nav>:null}
   <section aria-labelledby={`${idPrefix}-results-title`} className={LIST_CARD} data-console-list="">
    <div className="flex flex-wrap items-center gap-2">
     <h3 className="mr-auto flex flex-wrap items-baseline gap-2 text-base font-medium" id={`${idPrefix}-results-title`}>{TRAFFIC_DIMENSIONS[filters.dimension]}별 결과 <small className="text-xs font-normal text-muted-foreground tabular-nums">{report.total.toLocaleString('ko-KR')}개</small></h3>
     <form action={base} className="flex w-full min-w-0 gap-1.5 sm:w-auto"><input type="hidden" name="from" value={filters.from}/><input type="hidden" name="to" value={filters.to}/><input type="hidden" name="dimension" value={filters.dimension}/><input type="hidden" name="compare" value={filters.compare}/><input type="hidden" name="grain" value={filters.grain}/>{filters.key?<input type="hidden" name="key" value={filters.key}/>:null}<Input aria-label="통계 항목 검색" className="min-w-0 flex-1 sm:w-52 sm:flex-none" defaultValue={filters.query} maxLength={100} name="q" placeholder="항목명·번호 검색"/><button className={buttonVariants({variant:'outline'})} data-slot="button" type="submit"><Search aria-hidden="true"/>검색</button></form>
     <a className={OUTLINE_SM} data-slot="button" href={trafficHref('/api/admin/store-analytics/export',filters,{page:1})}><Download aria-hidden="true"/>엑셀 다운로드</a>
    </div>
    <ConsoleGrid caption={`${title} 분석 항목`} preferencesKey={`traffic-${filters.dimension}`} columns={COLUMNS} emptyLabel={report.summary.sessions===null?'수집 전이거나 관측 자료가 없어 수치를 표시할 수 없습니다.':'조건에 맞는 관측 항목이 없습니다.'}
     rows={report.rows.map(row=>({id:row.key,cells:[<Link className="font-medium underline-offset-4 hover:underline" key="label" href={trafficHref(base,filters,{key:row.key,page:1})}>{trafficLabel(filters.dimension,row.key,row.label)}</Link>,trafficNumber(row.metrics.sessions),trafficNumber(row.metrics.pageViews),trafficNumber(row.metrics.productViews),trafficNumber(row.metrics.linkLandings),trafficNumber(row.metrics.orders),trafficNumber(row.metrics.conversionRate,'%'),row.comparison?trafficDifference(row.metrics.sessions,row.comparison.sessions):'비교 없음',dimensionFinancial?trafficNumber(row.metrics.grossAmount,'원'):'배분 안 함',dimensionFinancial?trafficNumber(row.metrics.refundAmount,'원'):'배분 안 함',dimensionFinancial?trafficNumber(row.metrics.netAmount,'원'):'배분 안 함',row.archived?`보존 합계 · ${dateTime(row.observedUntil)}`:row.metrics.sessions===null?'미측정':'관측 자료']}))}/>
    <ConsolePagination label="분석 결과 페이지" page={filters.page} pageSize={20} total={report.total} unit="개" hrefForPage={page=>trafficHref(base,filters,{page})}/>
   </section>
   {!marketing&&noticeReport!==undefined?<NoticeTrafficSection report={noticeReport}/>:null}
   <details className={DETAILS}><summary className={DETAILS_SUMMARY}>지표 정의와 집계 범위</summary><ul className={DETAILS_LIST}>
    <li>방문 세션은 같은 브라우저의 짧은 방문 구간입니다. 30분 비활동·최대 24시간·한국 날짜 변경 시 분리하며 고유 고객수와 다릅니다.</li>
    <li>링크 유입은 발급된 링크의 목적지 화면을 연 횟수입니다. 새로고침도 열람이며 HTTP 리다이렉트·프리패치는 세지 않습니다.</li>
    <li>주문 생성 때 마지막으로 관측한 외부·링크 경로를 고정하고, 해당 주문이 7일 내 카드 승인 또는 무통장 입금 확인으로 확정되면 방문일에 귀속합니다. 전액 적립금 등 결제금액 0원 주문과 티켓은 제외합니다.</li>
    <li>실제 결제금액에는 할인·적립금·배송비가 반영됩니다. 총액은 이후 환불에도 유지하고 완료 환불금액을 별도로 차감합니다. 상품·IP·카테고리별 주문은 방문한 상품을 실제 구매한 경우이며 금액을 임의 배분하지 않습니다.</li>
    <li>하나의 방문이 여러 항목에 포함될 수 있어 항목별 세션·전환을 더한 값은 전체와 다릅니다. 광고비 원장이 없어 광고비와 ROAS는 미제공입니다.</li>
    <li>원자료·주문 연결은 90일, 식별자를 제거한 일별 합계는 13개월 보존합니다. 보존 합계는 최종 관측 시점 이후의 환불을 반영하지 않습니다. 수집 전·중단·관측 공백·보존 만료는 0으로 표시하지 않습니다.</li>
   </ul></details>
   <details className={DETAILS}><summary className={DETAILS_SUMMARY}>날짜별 관측 상태</summary><ul className={DETAILS_LIST}>{report.trend.map(row=><li key={row.date}>{row.date}: {row.states.map(state=>TRAFFIC_STATE_LABELS[state]||state).join(', ')}{row.archived?' · 보존 합계':''}</li>)}</ul></details>
  </>}
 </div>;
}
