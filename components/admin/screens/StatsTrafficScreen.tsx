import Link from 'next/link';
import { ConsoleGrid, type ConsoleGridColumn } from '@/components/admin/console';
import { StatsTrafficChart } from '@/components/admin/charts/StatsTrafficChart';
import { TRAFFIC_DIMENSIONS, TRAFFIC_STATE_LABELS, trafficDifference, trafficHref, trafficLabel, trafficNumber, type TrafficCoverage, type TrafficFilters, type TrafficMetric, type TrafficReport } from '@/lib/admin/store-analytics';
const CARDS:{key:TrafficMetric;label:string;suffix?:string}[]=[{key:'sessions',label:'방문 세션'},{key:'productViews',label:'상품 상세 열람'},{key:'orders',label:'결제 주문'},{key:'conversionRate',label:'결제 전환율',suffix:'%'},{key:'grossAmount',label:'실제 결제금액',suffix:'원'},{key:'netAmount',label:'환불 차감금액',suffix:'원'}];
const COLUMNS:ConsoleGridColumn[]=[{key:'label',label:'분석 항목',width:'240px'},{key:'sessions',label:'방문 세션',align:'end',width:'110px'},{key:'views',label:'전체 열람',align:'end',width:'100px'},{key:'product',label:'상품 상세',align:'end',width:'100px'},{key:'landings',label:'링크 유입',align:'end',width:'100px'},{key:'orders',label:'결제 주문',align:'end',width:'120px'},{key:'rate',label:'전환율',align:'end',width:'100px'},{key:'change',label:'방문 증감',align:'end',width:'110px'},{key:'gross',label:'실제 결제금액',align:'end',width:'130px'},{key:'refund',label:'완료 환불금액',align:'end',width:'130px'},{key:'net',label:'환불 차감금액',align:'end',width:'140px'},{key:'observation',label:'관측',width:'170px'}];
function coverageText(value:TrafficCoverage){return `정상 관측 ${value.observed_days}일 · 일부/진행 중 ${value.partial_days}일 · 미측정 ${value.missing_days}일${value.archived_days?` · 보존 합계 ${value.archived_days}일`:''}`;}
function dateTime(value:string|null){return value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'없음';}
export function StatsTrafficScreen({report,filters,marketing=false}:{report:TrafficReport|null;filters:TrafficFilters;marketing?:boolean}){
 const base=marketing?'/admin/stats/marketing':'/admin/stats/traffic';const financial=!filters.key||filters.dimension==='channel'||filters.dimension==='link';
 const dimensionFinancial=filters.dimension==='channel'||filters.dimension==='link';
 const title=marketing?'마케팅 링크 성과':'방문·유입 분석';
 return <section className="admin-console wc-admin-kit wc-admin-traffic">
  <div className="wc-admin-traffic-heading"><div><h2>{title}</h2><p>선택 동의한 공개 화면 방문과 실제 결제 전환을 확인합니다.</p></div>{marketing?<Link href="/admin/marketing/links">마케팅 링크 관리</Link>:<Link href="/admin/stats/marketing">마케팅 링크 성과</Link>}</div>
  <nav className="wc-admin-traffic-periods" aria-label="빠른 조회 기간">{[1,7,30].map(days=><Link key={days} href={`${base}?days=${days}&dimension=${filters.dimension}&compare=${filters.compare}&grain=${filters.grain}`}>{days===1?'오늘':`최근 ${days}일`}</Link>)}</nav>
  <form action={base} className="wc-admin-traffic-filters">
   <label>시작일 <input type="date" name="from" defaultValue={filters.from} required/></label><span>~</span><label>종료일 <input type="date" name="to" defaultValue={filters.to} required/></label>
   <label>비교 <select name="compare" defaultValue={filters.compare}><option value="previous">직전 같은 기간</option><option value="year">전년 같은 기간</option><option value="none">비교 안 함</option></select></label>
   <label>추이 단위 <select name="grain" defaultValue={filters.grain}><option value="day">일별</option><option value="week">주별</option><option value="month">월별</option></select></label>
   <input type="hidden" name="dimension" value={filters.dimension}/>{filters.key?<input type="hidden" name="key" value={filters.key}/>:null}
   <button type="submit">조회</button>
  </form>
  {filters.error?<p role="alert" className="admin-note">{filters.error}</p>:null}
  {!report?null:<>
   <div className="wc-admin-traffic-status" role="status"><strong>{report.collection.enabled?'수집 사용 중':'수집 비활성'}</strong><span>{coverageText(report.coverage)}</span><span>수집 시작 {dateTime(report.collection.startedAt)}</span>
    {report.collection.lastHeartbeatAt&&Date.parse(report.observedAt)-Date.parse(report.collection.lastHeartbeatAt)>180000?<span className="wc-admin-traffic-warning">최근 수집 점검 기록이 3분 이상 지났습니다.</span>:null}
    {report.collection.retentionBacklog>0?<span className="wc-admin-traffic-warning">보존 정리 대기 방문 {report.collection.retentionBacklog.toLocaleString('ko-KR')}건</span>:null}
   </div>
   {report.selectedKey?<p className="wc-admin-traffic-selection">선택 항목: <strong>{trafficLabel(report.dimension,report.selectedKey,report.selectedLabel||report.selectedKey)}</strong> <Link href={trafficHref(base,filters,{key:'',page:1})}>전체 보기</Link></p>:null}
   <div className="wc-admin-traffic-metrics">{CARDS.map(card=><div key={card.key}><span>{card.label}</span><strong>{!financial&&['grossAmount','netAmount'].includes(card.key)?'배분 안 함':trafficNumber(report.summary[card.key],card.suffix)}</strong>
    {report.comparison?<small>{trafficDifference(report.summary[card.key],report.comparison[card.key],card.key==='conversionRate')} {card.suffix==='원'&&report.summary[card.key]!==null&&report.comparison[card.key]!==null?'원':''} · 비교 {trafficNumber(report.comparison[card.key],card.suffix)}</small>:null}</div>)}</div>
   {report.comparisonCoverage?<p className="admin-note">비교 기간 {report.comparisonFrom} ~ {report.comparisonTo}: {coverageText(report.comparisonCoverage)}</p>:null}
   <StatsTrafficChart rows={report.trend} comparison={report.comparisonTrend}/>
   {!marketing?<nav className="wc-admin-traffic-dimensions" aria-label="분석 기준">{Object.entries(TRAFFIC_DIMENSIONS).filter(([key])=>key!=='link').map(([key,label])=><Link key={key} aria-current={filters.dimension===key?'page':undefined} href={trafficHref(base,filters,{dimension:key as TrafficFilters['dimension'],key:'',query:'',page:1})}>{label}</Link>)}</nav>:null}
   <div className="wc-admin-traffic-table-tools"><h3>{TRAFFIC_DIMENSIONS[filters.dimension]}별 결과 <small>{report.total.toLocaleString('ko-KR')}개</small></h3>
    <form action={base}><input type="hidden" name="from" value={filters.from}/><input type="hidden" name="to" value={filters.to}/><input type="hidden" name="dimension" value={filters.dimension}/><input type="hidden" name="compare" value={filters.compare}/><input type="hidden" name="grain" value={filters.grain}/>{filters.key?<input type="hidden" name="key" value={filters.key}/>:null}<input name="q" defaultValue={filters.query} maxLength={100} placeholder="항목명·번호 검색" aria-label="통계 항목 검색"/><button type="submit">검색</button></form>
    <a href={trafficHref('/api/admin/store-analytics/export',filters,{page:1})}>엑셀 다운로드</a>
   </div>
   <ConsoleGrid caption={`${title} 분석 항목`} preferencesKey={`traffic-${filters.dimension}`} columns={COLUMNS} emptyLabel={report.summary.sessions===null?'수집 전이거나 관측 자료가 없어 수치를 표시할 수 없습니다.':'조건에 맞는 관측 항목이 없습니다.'}
    rows={report.rows.map(row=>({id:row.key,cells:[<Link key="label" href={trafficHref(base,filters,{key:row.key,page:1})}>{trafficLabel(filters.dimension,row.key,row.label)}</Link>,trafficNumber(row.metrics.sessions),trafficNumber(row.metrics.pageViews),trafficNumber(row.metrics.productViews),trafficNumber(row.metrics.linkLandings),trafficNumber(row.metrics.orders),trafficNumber(row.metrics.conversionRate,'%'),row.comparison?trafficDifference(row.metrics.sessions,row.comparison.sessions):'비교 없음',dimensionFinancial?trafficNumber(row.metrics.grossAmount,'원'):'배분 안 함',dimensionFinancial?trafficNumber(row.metrics.refundAmount,'원'):'배분 안 함',dimensionFinancial?trafficNumber(row.metrics.netAmount,'원'):'배분 안 함',row.archived?`보존 합계 · ${dateTime(row.observedUntil)}`:row.metrics.sessions===null?'미측정':'관측 자료']}))}/>
   <nav className="wc-admin-traffic-pagination" aria-label="분석 결과 페이지">{filters.page>1?<Link href={trafficHref(base,filters,{page:filters.page-1})}>이전</Link>:null}<span>{filters.page} / {Math.max(1,Math.ceil(report.total/20))}</span>{filters.page*20<report.total?<Link href={trafficHref(base,filters,{page:filters.page+1})}>다음</Link>:null}</nav>
   <details className="wc-admin-traffic-definitions"><summary>지표 정의와 집계 범위</summary><ul>
    <li>방문 세션은 같은 브라우저의 짧은 방문 구간입니다. 30분 비활동·최대 24시간·한국 날짜 변경 시 분리하며 고유 고객수와 다릅니다.</li>
    <li>링크 유입은 발급된 링크의 목적지 화면을 연 횟수입니다. 새로고침도 열람이며 HTTP 리다이렉트·프리패치는 세지 않습니다.</li>
    <li>주문 생성 때 마지막으로 관측한 외부·링크 경로를 고정하고, 해당 주문이 7일 내 카드 승인 또는 무통장 입금 확인으로 확정되면 방문일에 귀속합니다. 전액 적립금 등 결제금액 0원 주문과 티켓은 제외합니다.</li>
    <li>실제 결제금액에는 할인·적립금·배송비가 반영됩니다. 총액은 이후 환불에도 유지하고 완료 환불금액을 별도로 차감합니다. 상품·IP·카테고리별 주문은 방문한 상품을 실제 구매한 경우이며 금액을 임의 배분하지 않습니다.</li>
    <li>하나의 방문이 여러 항목에 포함될 수 있어 항목별 세션·전환을 더한 값은 전체와 다릅니다. 광고비 원장이 없어 광고비와 ROAS는 미제공입니다.</li>
    <li>원자료·주문 연결은 90일, 식별자를 제거한 일별 합계는 13개월 보존합니다. 보존 합계는 최종 관측 시점 이후의 환불을 반영하지 않습니다. 수집 전·중단·관측 공백·보존 만료는 0으로 표시하지 않습니다.</li>
   </ul></details>
   <details className="wc-admin-traffic-definitions"><summary>날짜별 관측 상태</summary><ul>{report.trend.map(row=><li key={row.date}>{row.date}: {row.states.map(state=>TRAFFIC_STATE_LABELS[state]||state).join(', ')}{row.archived?' · 보존 합계':''}</li>)}</ul></details>
  </>}
 </section>;
}
