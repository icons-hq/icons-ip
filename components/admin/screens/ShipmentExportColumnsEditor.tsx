'use client';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {ArrowDown,ArrowUp,ChevronDown} from 'lucide-react';
import {saveShipmentExportColumnsAction} from '@/app/admin/shipment-actions';
import {DEFAULT_SHIPMENT_EXPORT_COLUMNS,OPTIONAL_SHIPMENT_EXPORT_COLUMNS,parseShipmentExportColumns} from '@/lib/admin/shipment-workbook';
import type {FulfillmentOrigin} from '@/lib/admin/fulfillment-origins';
import {GIMPO_EXPORT_HEADERS,SEOWON_EXPORT_HEADERS} from '@/lib/admin/warehouse-templates';
import {Button} from '@/components/admin/kit/ui/button';
import {Input} from '@/components/admin/kit/ui/input';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/admin/kit/ui/table';
const availableColumns=[...DEFAULT_SHIPMENT_EXPORT_COLUMNS,...OPTIONAL_SHIPMENT_EXPORT_COLUMNS];
/* 출고지시 양식 설정(템플릿 룩, ADR-0028). 접는 설명과 kit 표·입력·버튼이다. */
const DETAILS='group mt-6 rounded-lg border px-4 py-3 text-sm leading-relaxed';
const SUMMARY='flex cursor-pointer list-none items-center justify-between gap-2 font-medium [&::-webkit-details-marker]:hidden';
function Chevron(){return <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"/>;}
export function ShipmentExportColumnsEditor({origin,canEdit}:{origin:FulfillmentOrigin;canEdit:boolean}){
 const [columns,setColumns]=useState(()=>parseShipmentExportColumns(origin.exportColumns)??DEFAULT_SHIPMENT_EXPORT_COLUMNS.map(column=>({...column})));
 const [stamp,setStamp]=useState(origin.updatedAt);const [pending,startTransition]=useTransition();const [feedback,setFeedback]=useState<{error?:string;message?:string}>({});const router=useRouter();
 function move(index:number,direction:number){const next=[...columns];[next[index],next[index+direction]]=[next[index+direction],next[index]];setColumns(next);}
 if(origin.exportTemplate!=='standard'){
  const gimpo=origin.exportTemplate==='wms_csv',headers=gimpo?GIMPO_EXPORT_HEADERS:SEOWON_EXPORT_HEADERS;
  return <details className={DETAILS}><summary className={SUMMARY}>{gimpo?'김포 WMS 21열':'서원 우체국 송장양식'} 출고지시 양식<Chevron/></summary>
   <p className="mt-3 text-muted-foreground">발주·발송 관리에서 기존 창고 양식을 선택하면 제공된 물류 양식의 헤더와 순서로 내려받습니다. 기본 스마트스토어 74열 양식에는 이 설정이 적용되지 않습니다.</p>
   <p className="mt-2 text-muted-foreground">{gimpo?'사방넷 주문번호·옵션별칭·공급단가·EA(상품)·두 번째 연락처는 빈칸입니다. 옵션에 ERP 품명이 있으면 상품명(확정)·옵션(확정)과 앞의 두 조합 열(상품명(확정)+옵션+수량)에 ERP 품명을 쓰고, 없으면 주문 당시 상품명·옵션명을 씁니다. 옵션(수집)은 늘 주문 당시 옵션명입니다. 주문금액/수량은 주문 당시 할인 전 단가이며, 배송비는 배송 건의 첫 상품 행에만 표시합니다. 빈칸의 사용 기준은 물류 담당자와 확인해주세요.'
    :'제공 원본과 같은 송장양식 시트 하나로, 앞 7열의 헤더·순서·색·너비가 원본 그대로입니다. 원본처럼 품목 하나가 한 행이고 수량은 숫자, 품목명은 "상품명_옵션명"(옵션이 없으면 "상품명_"), 전화번호는 010-1234-5678 형식입니다. 같은 받는 분의 행은 서원 프로그램이 합배송합니다. 기타연락처·운임Type은 서원 회신대로 비워 둡니다. 원본에 없는 받는분성명·배송메시지·배송건번호·옵션명·바코드·ERP 품명은 오른쪽에 덧붙입니다. 바코드·ERP 품명은 주문 당시 값이고, 주문 당시 값이 비어 있으면 지금 등록된 값입니다. 송장번호 회신은 이 파일 오른쪽에 송장번호 열을 채워 운송장 일괄 등록에 그대로 올립니다.'}</p>
   <ol className="mt-3 grid list-decimal gap-x-6 gap-y-1 pl-5 sm:grid-cols-2 lg:grid-cols-3">{headers.map(header=><li key={header}>{header}</li>)}</ol>
  </details>;
 }
 return <details className={DETAILS}><summary className={SUMMARY}>출고지시 컬럼과 헤더 설정<Chevron/></summary>
  <p className="mt-3 text-muted-foreground">기존 창고 양식의 표준 12개 항목을 유지하면서 헤더와 순서를 바꿉니다. 기본 스마트스토어 74열 양식에는 적용되지 않습니다. 옵션코드는 주문 당시 저장된 물류 품번입니다. 바코드·ERP 코드·ERP 품명은 주문 당시 값이고, 주문 당시 값이 비어 있으면 지금 등록된 값을 씁니다. 여러 출고지를 선택하면 출고지별 파일을 ZIP으로 받습니다.</p>
  <form className="mt-3 flex flex-col gap-3" onSubmit={event=>{event.preventDefault();startTransition(async()=>{try{const result=await saveShipmentExportColumnsAction(origin.id,columns,stamp);setFeedback(result);if(result.updatedAt){setStamp(result.updatedAt);router.refresh();}}catch{setFeedback({error:'양식을 저장하지 못했습니다. 입력한 값은 유지됩니다.'});}});}}>
   <fieldset disabled={pending||!canEdit} className="m-0 flex min-w-0 flex-col items-start gap-3 border-0 p-0">
    <div className="flex flex-wrap gap-x-5 gap-y-2">{OPTIONAL_SHIPMENT_EXPORT_COLUMNS.map(optional=><label key={optional.key} className="flex items-center gap-2">
     <input type="checkbox" checked={columns.some(column=>column.key===optional.key)} onChange={event=>{
      const included=event.target.checked;
      setColumns(current=>included?[...current,{...optional}]:current.filter(column=>column.key!==optional.key));
     }}/>{optional.header} 포함
    </label>)}</div>
    <div className="w-full rounded-lg border">
    <Table><caption className="sr-only">{origin.name} 출고지시 양식</caption><TableHeader><TableRow className="bg-muted/50"><TableHead>표준 항목</TableHead><TableHead>내보낼 헤더</TableHead><TableHead>순서</TableHead></TableRow></TableHeader>
     <TableBody>{columns.map((column,index)=><TableRow key={column.key}><TableHead className="font-normal" scope="row">{availableColumns.find(value=>value.key===column.key)?.header}</TableHead>
      <TableCell><Input className="h-7 min-w-40" aria-label={`${column.header} 내보낼 헤더`} value={column.header} maxLength={80} required onChange={event=>setColumns(columns.map((value,i)=>i===index?{...value,header:event.target.value}:value))}/></TableCell>
      <TableCell><span className="inline-flex gap-1"><Button type="button" size="icon-sm" variant="outline" aria-label={`${column.header} 위로`} disabled={index===0} onClick={()=>move(index,-1)}><ArrowUp/></Button><Button type="button" size="icon-sm" variant="outline" aria-label={`${column.header} 아래로`} disabled={index===columns.length-1} onClick={()=>move(index,1)}><ArrowDown/></Button></span></TableCell>
     </TableRow>)}</TableBody></Table>
    </div>
    {canEdit?<Button type="submit">{pending?'저장 중…':'출고지시 양식 저장'}</Button>:null}
   </fieldset>
   {feedback.error?<p className="text-destructive" role="alert">{feedback.error}</p>:null}{feedback.message?<p className="text-[var(--wc-success)]" role="status">{feedback.message}</p>:null}
  </form>
 </details>;
}
