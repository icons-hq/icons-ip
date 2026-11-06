'use client';
import Link from 'next/link';
import { useRef,useState,useTransition } from 'react';
import { searchMarketingSegmentsAction } from '@/app/admin/marketing-message-actions';
import { CUSTOMER_SEGMENTS_PATH,SEGMENT_TARGET_LABELS,type CustomerSegment,type SegmentList } from '@/lib/admin/customer-segments';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
/* 저장한 세그먼트 고르기(템플릿 룩, ADR-0028). 고른 세그먼트는 aria-pressed로 표시한다. */
const CHOICE='h-auto flex-col items-start justify-start gap-1 p-3 text-left font-normal whitespace-normal aria-pressed:border-primary aria-pressed:bg-muted';
export function SegmentPicker({selected,disabled,onSelect,showMarketingConsent=true}:{selected:CustomerSegment|null;disabled:boolean;showMarketingConsent?:boolean;onSelect:(value:CustomerSegment)=>void}){
 const [query,setQuery]=useState(''),[data,setData]=useState<SegmentList|null>(null),[error,setError]=useState(''),[pending,start]=useTransition(),sequence=useRef(0);
 function search(page:number){const index=++sequence.current;start(async()=>{const result=await searchMarketingSegmentsAction(query,page);if(index!==sequence.current)return;if(!result.data){setError(result.error);return;}setError('');setData(result.data);});}
 return <div className="flex min-w-0 flex-col gap-3 text-sm"><div className="flex flex-wrap items-end gap-2.5"><label className="flex min-w-0 flex-1 basis-60 flex-col gap-1.5 font-medium">세그먼트 이름·ID<Input disabled={disabled} value={query} maxLength={100} onChange={e=>{setQuery(e.target.value);sequence.current++;}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();search(1);}}} /></label><Button type="button" variant="outline" disabled={disabled||pending} onClick={()=>search(1)}>세그먼트 조회</Button></div>
  {error&&<p className="text-destructive" role="alert">{error}</p>}{data&&<div className="grid max-h-[370px] gap-1.5 overflow-y-auto rounded-lg border p-3"><p className="text-muted-foreground">총 {data.total}개</p>{data.rows.map(row=><Button className={CHOICE} type="button" variant="outline" key={row.id} disabled={disabled||!row.available} aria-pressed={selected?.id===row.id} onClick={()=>onSelect(row)}><strong className="font-medium">{row.name}</strong><span className="text-xs text-muted-foreground">{SEGMENT_TARGET_LABELS[row.target]} · CSG-{row.reference}</span><small className="text-xs text-muted-foreground">{row.estimate?`최근 ${showMarketingConsent?'동의':'일치'} 고객 ${(showMarketingConsent?row.estimate.consentedCount:row.estimate.matchedCount).toLocaleString('ko-KR')}명`:'고객수 확인 전'}</small></Button>)}<div className="flex items-center justify-between pt-2"><Button type="button" size="sm" variant="outline" disabled={pending||data.filters.page<=1} onClick={()=>search(data.filters.page-1)}>이전</Button><span className="tabular-nums">{data.filters.page} / {Math.max(1,Math.ceil(data.total/20))}</span><Button type="button" size="sm" variant="outline" disabled={pending||data.filters.page*20>=data.total} onClick={()=>search(data.filters.page+1)}>다음</Button></div></div>}
  {!data&&<p className="text-muted-foreground">저장한 조건을 조회해 선택해주세요. <Link className="text-foreground underline underline-offset-4" href={`${CUSTOMER_SEGMENTS_PATH}/new`}>새 세그먼트 만들기</Link></p>}
 </div>;
}
