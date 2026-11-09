import Link from 'next/link';
import type { ReactNode } from 'react';
import { Download, Search } from 'lucide-react';
import { AdminNotice, AdminPageHeader, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { CONSOLE_FILTER_CARD_CLASS, ConsoleGrid, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { StatsTrafficChart } from '@/components/admin/charts/StatsTrafficChart';
import { STATS_NOTE, STATS_SEGMENTED, STATS_SEGMENT_LINK, StatsChangeBadge, StatsChangeText, StatsSummaryGrid, StatsSummaryTile, statsChangeDirection, statsDateLabel } from '@/components/admin/StatsSummary';
import { kstDay } from '@/lib/admin/kst';
import { adminStatsChange } from '@/lib/admin/stats';
import { krw } from '@/lib/format';
import { NOTICE_PLACEMENT_LABELS, noticeTrafficTitle, TRAFFIC_DIMENSIONS, TRAFFIC_STATE_LABELS, trafficDifference, trafficHref, trafficLabel, trafficNumber, type NoticeTrafficReport, type TrafficCoverage, type TrafficFilters, type TrafficMetric, type TrafficReport } from '@/lib/admin/store-analytics';
/* 두 화면은 같은 조회를 쓰지만 묻는 게 다르다 — 방문·유입은 어디서 얼마나 왔는지, 마케팅 링크는 링크가 얼마를 벌었는지다. 그래서 카드와 표의 앞 열이 다르다. */
const TRAFFIC_LEAD:{key:TrafficMetric;label:string;suffix?:string}={key:'productViews',label:'상품 상세 열람'};
const LINK_LEAD:{key:TrafficMetric;label:string;suffix?:string}={key:'linkLandings',label:'링크 유입'};
const CONVERSION_CARDS:{key:TrafficMetric;label:string;suffix?:string}[]=[{key:'orders',label:'결제 주문'},{key:'conversionRate',label:'결제 전환율',suffix:'%'},{key:'grossAmount',label:'실제 결제금액',suffix:'원'},{key:'netAmount',label:'환불 차감 후 금액',suffix:'원'}];
const SESSIONS_CARD:{key:TrafficMetric;label:string;suffix?:string}={key:'sessions',label:'방문 세션'};
const CARDS=[SESSIONS_CARD,TRAFFIC_LEAD,...CONVERSION_CARDS];
const MARKETING_CARDS=[LINK_LEAD,SESSIONS_CARD,...CONVERSION_CARDS];
/* 1440 화면의 표 폭(약 1100px) 안에 주요 열이 다 들어가는 너비다. 덜 보는 열은 기본으로 접고 조회항목 설정에서 켠다. */
const COLUMNS:ConsoleGridColumn[]=[{key:'label',label:'분석 항목',width:'210px'},{key:'sessions',label:'방문 세션',align:'end',width:'80px'},{key:'views',label:'전체 열람',align:'end',width:'80px',defaultVisible:false},{key:'product',label:'상품 상세',align:'end',width:'80px'},{key:'landings',label:'링크 유입',align:'end',width:'80px'},{key:'orders',label:'결제 주문',align:'end',width:'80px'},{key:'rate',label:'전환율',align:'end',width:'68px'},{key:'change',label:'방문 증감',align:'end',width:'92px'},{key:'gross',label:'실제 결제금액',align:'end',width:'116px'},{key:'refund',label:'완료 환불금액',align:'end',width:'116px'},{key:'net',label:'환불 차감 후 금액',align:'end',width:'124px'},{key:'observation',label:'집계 상태',width:'170px',defaultVisible:false}];
const NOTICE_COLUMNS:ConsoleGridColumn[]=[{key:'title',label:'공지',width:'280px'},{key:'placement',label:'종류',width:'130px'},{key:'impressions',label:'노출',align:'end',width:'100px'},{key:'impressionSessions',label:'노출 세션',align:'end',width:'110px'},{key:'clicks',label:'클릭',align:'end',width:'100px'},{key:'clickSessions',label:'클릭 세션',align:'end',width:'110px'},{key:'clickRate',label:'클릭률',align:'end',width:'100px'}];
/* 링크 성과의 표는 결제까지 첫 화면에 들어오게 돈 열을 앞으로 당긴다. */
const MARKETING_COLUMN_ORDER=['label','landings','sessions','orders','rate','gross','refund','net','change','product','views','observation'];
const MARKETING_COLUMNS=MARKETING_COLUMN_ORDER.map(key=>({...COLUMNS.find(column=>column.key===key)!,...(key==='product'?{defaultVisible:false}:null)}));
const OUTLINE_SM=buttonVariants({variant:'outline',size:'sm'});
const DETAILS='group rounded-lg border bg-muted/40 px-4 py-3 text-sm';
const DETAILS_SUMMARY='cursor-pointer font-medium';
const DETAILS_LIST='mt-2 flex list-disc flex-col gap-1.5 pl-5 text-muted-foreground';
function coverageText(value:TrafficCoverage){return `확정 집계 ${value.observed_days}일 · 집계 중 ${value.partial_days}일 · 데이터 없음 ${value.missing_days}일${value.archived_days?` · 합계만 보존 ${value.archived_days}일`:''}`;}
function dateTime(value:string|null){return value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):'없음';}
/* 상단 공지(텍스트 공지 바·띠배너) 노출·클릭. undefined = 이 화면에서 다루지 않음(마케팅 링크 성과), null = 읽기 실패. */
/* 데이터분석 목록 카드(StatsSection·ConsoleListCard와 같은 흰 카드). */
const LIST_CARD='flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground';
/* 금액은 판매분석 카드와 같은 ₩ 표기다. 미측정은 trafficNumber가 말한다. */
function trafficMoney(value:number|null|undefined){return value==null?trafficNumber(value):krw(value);}
/* 칸마다 단위가 다르면(-70·-918,815원) 크기를 견줄 수 없다 — 전환율은 %p, 나머지는 변화율로 맞춘다. 실제 차이는 title에 둔다. */
function tileChange(key:TrafficMetric,current:number|null|undefined,previous:number|null|undefined){if(key==='conversionRate'||current==null||previous==null)return trafficDifference(current??null,previous??null,key==='conversionRate');return adminStatsChange(current,previous);}
function NoticeTrafficSection({report}:{report:NoticeTrafficReport|null}){
 const heading=<h3 className="flex flex-wrap items-baseline gap-2 text-base font-medium" id="traffic-notices-title">상단 공지 노출·클릭 {report?<small className="text-xs font-normal text-muted-foreground tabular-nums">{report.rows.length.toLocaleString('ko-KR')}개</small>:null}</h3>;
 return <section aria-labelledby="traffic-notices-title" className={LIST_CARD} data-console-list="">
  {report===null?<>{heading}<AdminNotice role="alert" tone="danger">공지 노출·클릭 집계를 불러오지 못했습니다. 새로고침해주세요.</AdminNotice></>
   :<ConsoleGrid caption="상단 공지 노출·클릭" preferencesKey="traffic-notices" columns={NOTICE_COLUMNS} emptyLabel="이 기간에 집계된 공지 노출이 없습니다."
    rows={report.rows.map(row=>({id:`${row.curationId}:${row.placement}`,cells:[noticeTrafficTitle(row),NOTICE_PLACEMENT_LABELS[row.placement]??row.placement,trafficNumber(row.impressions),trafficNumber(row.impressionSessions),trafficNumber(row.clicks),trafficNumber(row.clickSessions),row.clickRate===null?'계산 불가':trafficNumber(row.clickRate,'%')]}))}>{heading}</ConsoleGrid>}
  <p className={STATS_NOTE}>방문 통계에 동의한 공개 화면 방문에서 공지가 절반 이상 보인 횟수와 버튼·배너를 누른 횟수입니다. 한 화면에서는 공지마다 한 번만 세고, 클릭은 같은 방문에서 노출된 뒤에만 셉니다. 클릭률은 노출 대비 클릭입니다.</p>
 </section>;
}
export function StatsTrafficScreen({report,filters,marketing=false,noticeReport,now=new Date()}:{report:TrafficReport|null;filters:TrafficFilters;marketing?:boolean;noticeReport?:NoticeTrafficReport|null;now?:Date}){
 const base=marketing?'/admin/stats/marketing':'/admin/stats/traffic';const financial=!filters.key||filters.dimension==='channel'||filters.dimension==='link';
 const dimensionFinancial=filters.dimension==='channel'||filters.dimension==='link';
 const title=marketing?'마케팅 링크 성과':'방문·유입 분석';
 const idPrefix=marketing?'marketing-traffic':'traffic';
 const heartbeatStale=Boolean(report?.collection.lastHeartbeatAt&&Date.parse(report.observedAt)-Date.parse(report.collection.lastHeartbeatAt)>180000);
 /* 조회 기간이 오늘로 끝나고 일수가 맞으면 그 프리셋이 눌린 상태다(날짜를 직접 고쳐 같은 기간이 되어도 같다). */
 const presetDays=filters.to===kstDay(now)?Math.round((Date.parse(filters.to)-Date.parse(filters.from))/86400000)+1:null;
 const columns=marketing?MARKETING_COLUMNS:COLUMNS;
 const cards=marketing?MARKETING_CARDS:CARDS;
 return <div className="flex min-w-0 flex-col gap-4" data-stats-screen={marketing?'marketing':'traffic'}>
  <AdminPageHeader title={title} description={marketing?'발급한 마케팅 링크별 유입과 실제 결제 전환을 확인합니다.':'선택 동의한 공개 화면 방문이 어디서 들어왔는지와 실제 결제 전환을 확인합니다.'}
   actions={marketing?<Link className={OUTLINE_SM} data-slot="button" href="/admin/marketing/links">마케팅 링크 관리</Link>:<Link className={OUTLINE_SM} data-slot="button" href="/admin/stats/marketing">마케팅 링크 성과</Link>}/>
  {/* 빠른 기간·날짜·비교·조회를 한 줄에 둔다 — 조회 칸이 낮을수록 표가 첫 화면에 들어온다. */}
  <form action={base} className={CONSOLE_FILTER_CARD_CLASS}>
   <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
   <nav aria-label="빠른 조회 기간" className={STATS_SEGMENTED}>{[1,7,30].map(days=><Link aria-current={presetDays===days?'true':undefined} className={STATS_SEGMENT_LINK} key={days} href={`${base}?days=${days}&dimension=${filters.dimension}&compare=${filters.compare}&grain=${filters.grain}`}>{days===1?'오늘':`최근 ${days}일`}</Link>)}</nav>
   <div className="flex flex-wrap items-end gap-1.5">
    <div className="flex flex-col gap-1.5"><label className="text-sm leading-none font-medium" htmlFor={`${idPrefix}-from`}>시작일</label><Input className="w-40" defaultValue={filters.from} id={`${idPrefix}-from`} name="from" required type="date"/></div>
    <span aria-hidden="true" className="pb-1.5 text-muted-foreground">~</span>
    <div className="flex flex-col gap-1.5"><label className="text-sm leading-none font-medium" htmlFor={`${idPrefix}-to`}>종료일</label><Input className="w-40" defaultValue={filters.to} id={`${idPrefix}-to`} name="to" required type="date"/></div>
   </div>
   <div className="flex flex-col gap-1.5"><label className="text-sm leading-none font-medium" htmlFor={`${idPrefix}-compare`}>비교</label><NativeSelect defaultValue={filters.compare} id={`${idPrefix}-compare`} name="compare"><option value="previous">직전 같은 기간</option><option value="year">전년 같은 기간</option><option value="none">비교 안 함</option></NativeSelect></div>
   <div className="flex flex-col gap-1.5"><label className="text-sm leading-none font-medium" htmlFor={`${idPrefix}-grain`}>추이 단위</label><NativeSelect defaultValue={filters.grain} id={`${idPrefix}-grain`} name="grain"><option value="day">일별</option><option value="week">주별</option><option value="month">월별</option></NativeSelect></div>
   <div className="ml-auto flex items-center gap-2"><Link className={buttonVariants({variant:'ghost'})} data-slot="button" href={base}>초기화</Link><button className={buttonVariants({variant:'soft'})} data-slot="button" type="submit">조회</button></div>
   </div>
   <input type="hidden" name="dimension" value={filters.dimension}/>{filters.key?<input type="hidden" name="key" value={filters.key}/>:null}
  </form>
  {filters.error?<AdminNotice role="alert" tone="danger">{filters.error}</AdminNotice>:null}
  {!report?null:<>
   {/* 첫 화면에는 수집 여부와 데이터 없는 날 경고만 둔다. 일자별 내역은 아래 '날짜별 집계 상태'에 모았다. */}
   <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-relaxed text-muted-foreground" role="status"><AdminStatusBadge tone={report.collection.enabled?'success':'warning'}>{report.collection.enabled?'수집 사용 중':'수집 비활성'}</AdminStatusBadge>{report.coverage.missing_days>0?<AdminStatusBadge tone="warning">데이터 없음 {report.coverage.missing_days.toLocaleString('ko-KR')}일 포함</AdminStatusBadge>:null}<span>수집 시작 {dateTime(report.collection.startedAt)}</span>{report.comparisonFrom?<span>비교 기간 {statsDateLabel(report.comparisonFrom)} ~ {report.comparisonTo?statsDateLabel(report.comparisonTo):''}</span>:null}{report.selectedKey?null:<span>{marketing?'아래 카드는 스토어 전체 합계이고, 링크별 값은 표에서 봅니다':'아래 카드는 스토어 전체 합계입니다'}</span>}
   </div>
   {heartbeatStale||report.collection.retentionBacklog>0?<AdminNotice role="status" title="수집 상태 확인" tone="warning">{heartbeatStale?<p>최근 수집 점검 기록이 3분 이상 지났습니다.</p>:null}{report.collection.retentionBacklog>0?<p>보존 정리 대기 방문 {report.collection.retentionBacklog.toLocaleString('ko-KR')}건</p>:null}</AdminNotice>:null}
   {report.selectedKey?<p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">선택 항목: <strong className="font-medium">{trafficLabel(report.dimension,report.selectedKey,report.selectedLabel||report.selectedKey)}</strong> <Link className="ml-1 underline underline-offset-4" href={trafficHref(base,filters,{key:'',page:1})}>전체 보기</Link></p>:null}
   <StatsSummaryGrid>{cards.map(card=><StatsSummaryTile key={card.key} label={card.label} value={!financial&&['grossAmount','netAmount'].includes(card.key)?'배분 안 함':card.suffix==='원'?trafficMoney(report.summary[card.key]):trafficNumber(report.summary[card.key],card.suffix)}>
    {report.comparison?<span className="flex flex-wrap items-center gap-x-2 gap-y-1"><StatsChangeBadge direction={statsChangeDirection(report.summary[card.key],report.comparison[card.key])} title={`차이 ${trafficDifference(report.summary[card.key],report.comparison[card.key],card.key==='conversionRate')}${card.suffix==='원'&&report.summary[card.key]!==null&&report.comparison[card.key]!==null?'원':''}`}>{tileChange(card.key,report.summary[card.key],report.comparison[card.key])}</StatsChangeBadge><small className="text-xs text-muted-foreground tabular-nums">비교 {card.suffix==='원'?trafficMoney(report.comparison[card.key]):trafficNumber(report.comparison[card.key],card.suffix)}</small></span>:null}</StatsSummaryTile>)}</StatsSummaryGrid>
   {!marketing?<nav aria-label="분석 기준" className={STATS_SEGMENTED}>{Object.entries(TRAFFIC_DIMENSIONS).filter(([key])=>key!=='link').map(([key,label])=><Link aria-current={filters.dimension===key?'page':undefined} className={STATS_SEGMENT_LINK} key={key} href={trafficHref(base,filters,{dimension:key as TrafficFilters['dimension'],key:'',query:'',page:1})}>{label}</Link>)}</nav>:null}
   <section aria-labelledby={`${idPrefix}-results-title`} className={LIST_CARD} data-console-list="">
    <ConsoleGrid caption={`${title} 분석 항목`} preferencesKey={`traffic-${filters.dimension}`} columns={columns} emptyLabel={report.summary.sessions===null?'수집 전이거나 관측 자료가 없어 수치를 표시할 수 없습니다.':'조건에 맞는 관측 항목이 없습니다.'}
     rows={report.rows.map(row=>{const label=trafficLabel(filters.dimension,row.key,row.label);const cells:Record<string,ReactNode>={label:<Link className="block max-w-[186px] truncate font-medium underline-offset-4 hover:underline" key="label" href={trafficHref(base,filters,{key:row.key,page:1})} title={label}>{label}</Link>,sessions:trafficNumber(row.metrics.sessions),views:trafficNumber(row.metrics.pageViews),product:trafficNumber(row.metrics.productViews),landings:trafficNumber(row.metrics.linkLandings),orders:trafficNumber(row.metrics.orders),rate:trafficNumber(row.metrics.conversionRate,'%'),change:row.comparison?<StatsChangeText direction={statsChangeDirection(row.metrics.sessions,row.comparison.sessions)} key="change">{trafficDifference(row.metrics.sessions,row.comparison.sessions)}</StatsChangeText>:'비교 없음',gross:dimensionFinancial?trafficMoney(row.metrics.grossAmount):'배분 안 함',refund:dimensionFinancial?trafficMoney(row.metrics.refundAmount):'배분 안 함',net:dimensionFinancial?trafficMoney(row.metrics.netAmount):'배분 안 함',observation:row.archived?`합계만 보존 · ${dateTime(row.observedUntil)}`:row.metrics.sessions===null?'데이터 없음':'확정 집계'};return {id:row.key,cells:columns.map(column=>cells[column.key])};})}>
     {/* 조회는 위 칸(기간), 여기 검색은 이 표 안에서 항목 찾기다. 머리와 조회항목 설정을 한 줄에 둔다. */}
     <div className="flex flex-wrap items-center gap-2">
      <h3 className="mr-auto flex flex-wrap items-baseline gap-2 text-base font-medium" id={`${idPrefix}-results-title`}>{TRAFFIC_DIMENSIONS[filters.dimension]}별 결과 <small className="text-xs font-normal text-muted-foreground tabular-nums">{report.total.toLocaleString('ko-KR')}개</small></h3>
      <form action={base} className="flex w-full min-w-0 gap-1.5 sm:w-auto"><input type="hidden" name="from" value={filters.from}/><input type="hidden" name="to" value={filters.to}/><input type="hidden" name="dimension" value={filters.dimension}/><input type="hidden" name="compare" value={filters.compare}/><input type="hidden" name="grain" value={filters.grain}/>{filters.key?<input type="hidden" name="key" value={filters.key}/>:null}<Input aria-label="이 표에서 항목 찾기" className="min-w-0 flex-1 sm:w-52 sm:flex-none" defaultValue={filters.query} maxLength={100} name="q" placeholder="이 표에서 항목명·번호 찾기"/><button className={buttonVariants({variant:'outline'})} data-slot="button" type="submit"><Search aria-hidden="true"/>검색</button></form>
      <a className={OUTLINE_SM} data-slot="button" href={trafficHref('/api/admin/store-analytics/export',filters,{page:1})}><Download aria-hidden="true"/>엑셀 다운로드</a>
     </div>
    </ConsoleGrid>
    <ConsolePagination label="분석 결과 페이지" page={filters.page} pageSize={20} total={report.total} unit="개" hrefForPage={page=>trafficHref(base,filters,{page})}/>
   </section>
   <StatsTrafficChart rows={report.trend} comparison={report.comparisonTrend}/>
   {!marketing&&noticeReport!==undefined?<NoticeTrafficSection report={noticeReport}/>:null}
   <details className={DETAILS}><summary className={DETAILS_SUMMARY}>지표 정의와 집계 범위</summary><ul className={DETAILS_LIST}>
    <li>방문 세션은 같은 브라우저의 짧은 방문 구간입니다. 30분 비활동·최대 24시간·한국 날짜 변경 시 분리하며 고유 고객수와 다릅니다.</li>
    <li>링크 유입은 발급된 링크의 목적지 화면을 연 횟수입니다. 새로고침도 열람이며 HTTP 리다이렉트·프리패치는 세지 않습니다.</li>
    <li>주문 생성 때 마지막으로 관측한 외부·링크 경로를 고정하고, 해당 주문이 7일 내 카드 승인 또는 무통장 입금 확인으로 확정되면 방문일에 귀속합니다. 전액 적립금 등 결제금액 0원 주문과 티켓은 제외합니다.</li>
    <li>실제 결제금액에는 할인·적립금·배송비가 반영됩니다. 총액은 이후 환불에도 유지하고 완료 환불금액을 별도로 차감합니다. 상품·IP·카테고리별 주문은 방문한 상품을 실제 구매한 경우이며 금액을 임의 배분하지 않습니다.</li>
    <li>하나의 방문이 여러 항목에 포함될 수 있어 항목별 세션·전환을 더한 값은 전체와 다릅니다. 광고비 원장이 없어 광고비와 ROAS는 미제공입니다.</li>
    <li>원자료·주문 연결은 90일, 식별자를 제거한 일별 합계는 13개월 보존합니다. 보존 합계는 최종 관측 시점 이후의 환불을 반영하지 않습니다. 수집 전·중단·관측 공백·보존 만료는 0으로 표시하지 않습니다.</li>
   </ul></details>
   <details className={DETAILS}><summary className={DETAILS_SUMMARY}>날짜별 집계 상태</summary><ul className={DETAILS_LIST}><li>조회 기간: {coverageText(report.coverage)}</li>{report.comparisonCoverage?<li>비교 기간: {coverageText(report.comparisonCoverage)}</li>:null}{report.trend.map(row=><li key={row.date}>{statsDateLabel(row.date)}: {row.states.map(state=>TRAFFIC_STATE_LABELS[state]||state).join(', ')}{row.archived?' · 합계만 보존':''}</li>)}</ul></details>
  </>}
 </div>;
}
