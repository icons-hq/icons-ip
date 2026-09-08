'use client';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {saveShipmentExportColumnsAction} from '@/app/admin/shipment-actions';
import {DEFAULT_SHIPMENT_EXPORT_COLUMNS,parseShipmentExportColumns} from '@/lib/admin/shipment-workbook';
import type {FulfillmentOrigin} from '@/lib/admin/fulfillment-origins';
export function ShipmentExportColumnsEditor({origin,canEdit}:{origin:FulfillmentOrigin;canEdit:boolean}){
 const [columns,setColumns]=useState(()=>parseShipmentExportColumns(origin.exportColumns)??DEFAULT_SHIPMENT_EXPORT_COLUMNS.map(column=>({...column})));
 const [stamp,setStamp]=useState(origin.updatedAt);const [pending,startTransition]=useTransition();const [feedback,setFeedback]=useState<{error?:string;message?:string}>({});const router=useRouter();
 function move(index:number,direction:number){const next=[...columns];[next[index],next[index+direction]]=[next[index+direction],next[index]];setColumns(next);}
 return <details style={{marginTop:24}}><summary>출고지시 컬럼과 헤더 설정</summary>
  <p>표준 항목을 유지하면서 창고 양식에 맞게 헤더와 순서를 바꿉니다. CSV는 출고지를 하나 선택해서 내보내주세요.</p>
  <form onSubmit={event=>{event.preventDefault();startTransition(async()=>{try{const result=await saveShipmentExportColumnsAction(origin.id,columns,stamp);setFeedback(result);if(result.updatedAt){setStamp(result.updatedAt);router.refresh();}}catch{setFeedback({error:'양식을 저장하지 못했습니다. 입력한 값은 유지됩니다.'});}});}}>
   <fieldset disabled={pending||!canEdit} style={{border:0,padding:0}}>
    <table><caption className="sr-only">{origin.name} 출고지시 양식</caption><thead><tr><th>표준 항목</th><th>내보낼 헤더</th><th>순서</th></tr></thead>
     <tbody>{columns.map((column,index)=><tr key={column.key}><th>{DEFAULT_SHIPMENT_EXPORT_COLUMNS.find(value=>value.key===column.key)?.header}</th>
      <td><input aria-label={`${column.header} 내보낼 헤더`} value={column.header} maxLength={80} required onChange={event=>setColumns(columns.map((value,i)=>i===index?{...value,header:event.target.value}:value))}/></td>
      <td><button type="button" aria-label={`${column.header} 위로`} disabled={index===0} onClick={()=>move(index,-1)}>↑</button><button type="button" aria-label={`${column.header} 아래로`} disabled={index===columns.length-1} onClick={()=>move(index,1)}>↓</button></td>
     </tr>)}</tbody></table>
    {canEdit?<button className="wc-admin-kit__button" type="submit">{pending?'저장 중…':'출고지시 양식 저장'}</button>:null}
   </fieldset>
   {feedback.error?<p role="alert">{feedback.error}</p>:null}{feedback.message?<p role="status">{feedback.message}</p>:null}
  </form>
 </details>;
}
