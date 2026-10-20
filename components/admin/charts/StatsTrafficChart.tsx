'use client';
import { useState } from 'react';
import { TRAFFIC_STATE_LABELS, trafficNumber, type TrafficMetric, type TrafficTrend } from '@/lib/admin/store-analytics';
const OPTIONS: {key:TrafficMetric;label:string}[]=[{key:'sessions',label:'방문 세션'},{key:'productViews',label:'상품 상세 열람'},{key:'orders',label:'결제 주문'},{key:'conversionRate',label:'전환율'}];
function paths(rows:TrafficTrend[],key:TrafficMetric,max:number,length:number){const paths:string[]=[];let current='';rows.forEach((row,index)=>{const value=row.metrics[key];if(value===null){if(current)paths.push(current);current='';return;}current+=`${current?' L':'M'}${40+index*860/Math.max(length-1,1)},${170-value*145/max}`;});if(current)paths.push(current);return paths;}
export function StatsTrafficChart({rows,comparison}:{rows:TrafficTrend[];comparison:TrafficTrend[]}){
 const [metric,setMetric]=useState<TrafficMetric>('sessions');const [selected,setSelected]=useState<number|null>(null);
 const maximum=Math.max(1,...rows.map(row=>row.metrics[metric]??0),...comparison.map(row=>row.metrics[metric]??0));const count=Math.max(rows.length,comparison.length);
 const selection=selected===null?null:rows[selected];const label=OPTIONS.find(option=>option.key===metric)?.label;
 return <div className="wc-admin-traffic-chart">
  <div className="wc-admin-traffic-chart-controls" aria-label="추이 지표">{OPTIONS.map(option=><button type="button" key={option.key} aria-pressed={metric===option.key} onClick={()=>setMetric(option.key)}>{option.label}</button>)}</div>
  <svg viewBox="0 0 940 210" role="img" aria-label={`${label} 추이. 실선은 조회 기간, 점선은 비교 기간. 미측정은 선을 잇지 않습니다.`}>
   {rows.every(row=>row.metrics[metric]===null)&&comparison.every(row=>row.metrics[metric]===null)?<text x="470" y="96" textAnchor="middle" fontSize="14" fill="var(--wc-ink-tertiary)">관측 자료가 없습니다</text>:null}
   <line x1="40" x2="910" y1="170" y2="170" stroke="var(--wc-hairline)"/><line x1="40" x2="910" y1="25" y2="25" stroke="var(--wc-hairline)"/>
   <text x="8" y="30" fontSize="11" fill="var(--wc-ink-tertiary)">{maximum.toLocaleString('ko-KR')}</text><text x="22" y="174" fontSize="11" fill="var(--wc-ink-tertiary)">0</text>
   {paths(comparison,metric,maximum,count).map((path,index)=><path key={`c${index}`} d={path} fill="none" stroke="var(--wc-line-divider)" strokeWidth="2" strokeDasharray="5 5"/>)}
   {paths(rows,metric,maximum,count).map((path,index)=><path key={`r${index}`} d={path} fill="none" stroke="var(--wc-success)" strokeWidth="3"/>)}
   {rows.map((row,index)=>row.metrics[metric]===null?null:<circle key={row.date} cx={40+index*860/Math.max(count-1,1)} cy={170-(row.metrics[metric]??0)*145/maximum} r={4} fill="var(--wc-success)"><title>{row.date}: {trafficNumber(row.metrics[metric],metric==='conversionRate'?'%':'')}</title></circle>)}
   <text x="40" y="198" fontSize="12" fill="var(--wc-ink-tertiary)">{rows[0]?.date}</text><text x="900" y="198" fontSize="12" fill="var(--wc-ink-tertiary)" textAnchor="end">{rows.at(-1)?.date}</text>
  </svg>
  <div className="wc-admin-traffic-chart-legend"><span>● 조회 기간</span>{comparison.length>0?<span>┄ 비교 기간</span>:null}<span>빈 구간은 미측정</span></div>
  <label>날짜별 수치 <select value={selected??''} onChange={event=>setSelected(event.target.value===''?null:Number(event.target.value))}><option value="">날짜 선택</option>{rows.map((row,index)=><option key={row.date} value={index}>{row.date}</option>)}</select></label>
  {selection?<p role="status">{selection.date} · {label} {trafficNumber(selection.metrics[metric],metric==='conversionRate'?'%':'')} · {selection.states.map(state=>TRAFFIC_STATE_LABELS[state]||state).join(', ')}{selection.archived?' · 보존 합계':''}</p>:null}
 </div>;
}
