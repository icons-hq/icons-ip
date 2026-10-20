'use client';
import Link from 'next/link';
import { useRef,useState,useTransition } from 'react';
import { searchMarketingSegmentsAction } from '@/app/admin/marketing-message-actions';
import { CUSTOMER_SEGMENTS_PATH,SEGMENT_TARGET_LABELS,type CustomerSegment,type SegmentList } from '@/lib/admin/customer-segments';
export function SegmentPicker({selected,disabled,onSelect,showMarketingConsent=true}:{selected:CustomerSegment|null;disabled:boolean;showMarketingConsent?:boolean;onSelect:(value:CustomerSegment)=>void}){
 const [query,setQuery]=useState(''),[data,setData]=useState<SegmentList|null>(null),[error,setError]=useState(''),[pending,start]=useTransition(),sequence=useRef(0);
 function search(page:number){const index=++sequence.current;start(async()=>{const result=await searchMarketingSegmentsAction(query,page);if(index!==sequence.current)return;if(!result.data){setError(result.error);return;}setError('');setData(result.data);});}
 return <div className="wc-admin-marketing__picker"><div className="wc-admin-marketing__picker-search"><label>세그먼트 이름·ID<input disabled={disabled} value={query} maxLength={100} onChange={e=>{setQuery(e.target.value);sequence.current++;}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();search(1);}}} /></label><button type="button" className="wc-admin-kit__button" disabled={disabled||pending} onClick={()=>search(1)}>세그먼트 조회</button></div>
  {error&&<p role="alert">{error}</p>}{data&&<div className="wc-admin-marketing__choices"><p>총 {data.total}개</p>{data.rows.map(row=><button type="button" key={row.id} disabled={disabled||!row.available} aria-pressed={selected?.id===row.id} onClick={()=>onSelect(row)}><strong>{row.name}</strong><span>{SEGMENT_TARGET_LABELS[row.target]} · CSG-{row.reference}</span><small>{row.estimate?`최근 ${showMarketingConsent?'동의':'일치'} 고객 ${(showMarketingConsent?row.estimate.consentedCount:row.estimate.matchedCount).toLocaleString('ko-KR')}명`:'고객수 확인 전'}</small></button>)}<div><button type="button" disabled={pending||data.filters.page<=1} onClick={()=>search(data.filters.page-1)}>이전</button><span>{data.filters.page} / {Math.max(1,Math.ceil(data.total/20))}</span><button type="button" disabled={pending||data.filters.page*20>=data.total} onClick={()=>search(data.filters.page+1)}>다음</button></div></div>}
  {!data&&<p>저장한 조건을 조회해 선택해주세요. <Link href={`${CUSTOMER_SEGMENTS_PATH}/new`}>새 세그먼트 만들기</Link></p>}
 </div>;
}
