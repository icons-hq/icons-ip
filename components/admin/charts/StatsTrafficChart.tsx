'use client';
import { useId, useState } from 'react';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { TRAFFIC_STATE_LABELS, trafficNumber, type TrafficMetric, type TrafficTrend } from '@/lib/admin/store-analytics';
import { STATS_SEGMENTED, STATS_SEGMENT_BUTTON, statsDateLabel } from '../StatsSummary';
import { CHART_COMPARISON as COMPARISON, CHART_CURRENT as CURRENT } from './chart-theme';
const OPTIONS:{key:TrafficMetric;label:string}[]=[{key:'sessions',label:'방문 세션'},{key:'productViews',label:'상품 상세 열람'},{key:'orders',label:'결제 주문'},{key:'conversionRate',label:'전환율'}];
/* 차트 토큰(ADR-0029): 조회 기간은 주 색 실선, 비교 기간은 회색 점선, 축·격자는 border·muted-foreground. */
const GRID='var(--border)';const MUTED='var(--muted-foreground)';
function paths(rows:TrafficTrend[],key:TrafficMetric,max:number,length:number){const paths:string[]=[];let current='';rows.forEach((row,index)=>{const value=row.metrics[key];if(value===null){if(current)paths.push(current);current='';return;}current+=`${current?' L':'M'}${40+index*860/Math.max(length-1,1)},${170-value*145/max}`;});if(current)paths.push(current);return paths;}
export function StatsTrafficChart({rows,comparison}:{rows:TrafficTrend[];comparison:TrafficTrend[]}){
 const [metric,setMetric]=useState<TrafficMetric>('sessions');const [selected,setSelected]=useState<number|null>(null);
 const selectId=useId();
 const maximum=Math.max(1,...rows.map(row=>row.metrics[metric]??0),...comparison.map(row=>row.metrics[metric]??0));const count=Math.max(rows.length,comparison.length);
 const selection=selected===null?null:rows[selected];const label=OPTIONS.find(option=>option.key===metric)?.label;
 const empty=rows.every(row=>row.metrics[metric]===null)&&comparison.every(row=>row.metrics[metric]===null);
 return <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" data-stats-trend="traffic">
  <div aria-label="추이 지표" className={STATS_SEGMENTED} role="group">{OPTIONS.map(option=><button aria-pressed={metric===option.key} className={STATS_SEGMENT_BUTTON} key={option.key} onClick={()=>setMetric(option.key)} type="button">{option.label}</button>)}</div>
  {/* 좁은 화면에서는 차트를 줄이지 않고 가로로 넘겨 본다 — 축 글자가 읽히는 크기를 지킨다. 관측 자료가 없으면 차트 대신 문구를 보이는 폭에 둔다. */}
  {empty?<p className="flex h-48 items-center justify-center rounded-md bg-muted/40 text-sm text-muted-foreground">관측 자료가 없습니다</p>:<div aria-label="추이 차트 가로 스크롤" className="min-w-0 overflow-x-auto rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50" role="region" tabIndex={0}>
  <svg aria-label={`${label} 추이. 실선은 조회 기간, 점선은 비교 기간. 미측정은 선을 잇지 않습니다.`} className="block max-h-72 w-full min-w-[720px]" role="img" viewBox="0 0 940 210">
   <line x1="40" x2="910" y1="170" y2="170" stroke={GRID}/><line x1="40" x2="910" y1="25" y2="25" stroke={GRID}/>
   <text x="8" y="30" fontSize="12" fill={MUTED}>{maximum.toLocaleString('ko-KR')}</text><text x="22" y="174" fontSize="12" fill={MUTED}>0</text>
   {paths(comparison,metric,maximum,count).map((path,index)=><path key={`c${index}`} d={path} fill="none" stroke={COMPARISON} strokeWidth="2" strokeDasharray="5 5"/>)}
   {paths(rows,metric,maximum,count).map((path,index)=><path key={`r${index}`} d={path} fill="none" stroke={CURRENT} strokeWidth="3"/>)}
   {rows.map((row,index)=>row.metrics[metric]===null?null:<circle key={row.date} cx={40+index*860/Math.max(count-1,1)} cy={170-(row.metrics[metric]??0)*145/maximum} r={4} fill={CURRENT}><title>{statsDateLabel(row.date)}: {trafficNumber(row.metrics[metric],metric==='conversionRate'?'%':'')}</title></circle>)}
   <text x="40" y="198" fontSize="13" fill={MUTED}>{rows[0]?statsDateLabel(rows[0].date):null}</text><text x="900" y="198" fontSize="13" fill={MUTED} textAnchor="end">{rows.length?statsDateLabel(rows[rows.length-1].date):null}</text>
  </svg>
  </div>}
  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span><span aria-hidden="true" style={{color:CURRENT}}>●</span> 조회 기간</span>{comparison.length>0?<span><span aria-hidden="true" style={{color:COMPARISON}}>┄</span> 비교 기간</span>:null}<span>빈 구간은 미측정</span></div>
  <div className="flex flex-wrap items-center gap-2"><label className="text-sm text-muted-foreground" htmlFor={selectId}>날짜별 수치</label><NativeSelect className="w-44" id={selectId} value={selected??''} onChange={event=>setSelected(event.target.value===''?null:Number(event.target.value))}><option value="">날짜 선택</option>{rows.map((row,index)=><option key={row.date} value={index}>{statsDateLabel(row.date)}</option>)}</NativeSelect></div>
  {selection?<p className="text-sm" role="status">{statsDateLabel(selection.date)} · {label} {trafficNumber(selection.metrics[metric],metric==='conversionRate'?'%':'')} · {selection.states.map(state=>TRAFFIC_STATE_LABELS[state]||state).join(', ')}{selection.archived?' · 보존 합계':''}</p>:null}
 </div>;
}
