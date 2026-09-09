'use client';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {saveShipmentExportColumnsAction} from '@/app/admin/shipment-actions';
import {DEFAULT_SHIPMENT_EXPORT_COLUMNS,OPTIONAL_SHIPMENT_EXPORT_COLUMNS,parseShipmentExportColumns} from '@/lib/admin/shipment-workbook';
import type {FulfillmentOrigin} from '@/lib/admin/fulfillment-origins';
import {GIMPO_EXPORT_HEADERS,SEOWON_EXPORT_HEADERS} from '@/lib/admin/warehouse-templates';
const availableColumns=[...DEFAULT_SHIPMENT_EXPORT_COLUMNS,...OPTIONAL_SHIPMENT_EXPORT_COLUMNS];
export function ShipmentExportColumnsEditor({origin,canEdit}:{origin:FulfillmentOrigin;canEdit:boolean}){
 const [columns,setColumns]=useState(()=>parseShipmentExportColumns(origin.exportColumns)??DEFAULT_SHIPMENT_EXPORT_COLUMNS.map(column=>({...column})));
 const [stamp,setStamp]=useState(origin.updatedAt);const [pending,startTransition]=useTransition();const [feedback,setFeedback]=useState<{error?:string;message?:string}>({});const router=useRouter();
 function move(index:number,direction:number){const next=[...columns];[next[index],next[index+direction]]=[next[index+direction],next[index]];setColumns(next);}
 if(origin.exportTemplate!=='standard'){
  const gimpo=origin.exportTemplate==='wms_csv',headers=gimpo?GIMPO_EXPORT_HEADERS:SEOWON_EXPORT_HEADERS;
  return <details style={{marginTop:24}}><summary>{gimpo?'김포 WMS 21열':'서원 우체국 7열'} 출고지시 양식</summary>
   <p>제공된 물류 양식의 헤더와 순서로 내려받습니다. 일반 양식의 컬럼 설정은 표준 양식을 선택할 때 적용됩니다.</p>
   <p>{gimpo?'사방넷 주문번호·옵션별칭·공급단가·EA(상품)·두 번째 연락처는 빈칸입니다. 주문금액/수량은 주문 당시 할인 전 단가이며, 배송비는 배송 건의 첫 상품 행에만 표시합니다.':'기타연락처·운임Type·수량은 빈칸입니다. 배송 건마다 한 행을 만들고 상품별 수량은 품목명에 적습니다.'} 빈칸의 사용 기준은 물류 담당자와 확인해주세요.</p>
   <ol>{headers.map(header=><li key={header}>{header}</li>)}</ol>
  </details>;
 }
 return <details style={{marginTop:24}}><summary>출고지시 컬럼과 헤더 설정</summary>
  <p>표준 12개 항목을 유지하면서 창고 양식에 맞게 헤더와 순서를 바꿉니다. 옵션코드는 주문 당시 저장된 물류 품번입니다. CSV는 출고지를 하나 선택해서 내보내주세요.</p>
  <form onSubmit={event=>{event.preventDefault();startTransition(async()=>{try{const result=await saveShipmentExportColumnsAction(origin.id,columns,stamp);setFeedback(result);if(result.updatedAt){setStamp(result.updatedAt);router.refresh();}}catch{setFeedback({error:'양식을 저장하지 못했습니다. 입력한 값은 유지됩니다.'});}});}}>
   <fieldset disabled={pending||!canEdit} style={{border:0,padding:0}}>
    {OPTIONAL_SHIPMENT_EXPORT_COLUMNS.map(optional=><label key={optional.key} style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
     <input type="checkbox" checked={columns.some(column=>column.key===optional.key)} onChange={event=>{
      const included=event.target.checked;
      setColumns(current=>included?[...current,{...optional}]:current.filter(column=>column.key!==optional.key));
     }}/>{optional.header} 포함
    </label>)}
    <table><caption className="sr-only">{origin.name} 출고지시 양식</caption><thead><tr><th>표준 항목</th><th>내보낼 헤더</th><th>순서</th></tr></thead>
     <tbody>{columns.map((column,index)=><tr key={column.key}><th>{availableColumns.find(value=>value.key===column.key)?.header}</th>
      <td><input aria-label={`${column.header} 내보낼 헤더`} value={column.header} maxLength={80} required onChange={event=>setColumns(columns.map((value,i)=>i===index?{...value,header:event.target.value}:value))}/></td>
      <td><button type="button" aria-label={`${column.header} 위로`} disabled={index===0} onClick={()=>move(index,-1)}>↑</button><button type="button" aria-label={`${column.header} 아래로`} disabled={index===columns.length-1} onClick={()=>move(index,1)}>↓</button></td>
     </tr>)}</tbody></table>
    {canEdit?<button className="wc-admin-kit__button" type="submit">{pending?'저장 중…':'출고지시 양식 저장'}</button>:null}
   </fieldset>
   {feedback.error?<p role="alert">{feedback.error}</p>:null}{feedback.message?<p role="status">{feedback.message}</p>:null}
  </form>
 </details>;
}
