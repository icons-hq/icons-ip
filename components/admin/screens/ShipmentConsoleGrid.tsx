'use client';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {bulkConfirmAdminOrdersAction} from '@/app/admin/order-actions';
import {completeShipmentsAction,exportPendingOriginShipmentsAction,exportShipmentsAction} from '@/app/admin/shipment-actions';
import {ConsoleGrid,type ConsoleGridColumn,type ConsoleGridRow} from '@/components/admin/console';
import {isParcelShipment,shipmentConsoleSelectable,type ShipmentConsoleOrigin,type ShipmentConsoleRow,type ShipmentConsoleTab} from '@/lib/admin/shipment-dispatch';
import {OrderDelayNoticePanel} from './OrderDelayNoticePanel';
type ExportFile={base64:string;mime:string;name:string};
function download(file:ExportFile){
 const bytes=Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:file.mime}));
 const anchor=document.createElement('a');anchor.href=url;anchor.download=file.name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function ShipmentConsoleGrid({rows,columns,gridRows,tab,currentHref,readyHref,origins=[],originId=null}:{rows:ShipmentConsoleRow[];columns:ConsoleGridColumn[];gridRows:ConsoleGridRow[];tab:ShipmentConsoleTab;currentHref:string;readyHref:string;origins?:ShipmentConsoleOrigin[];originId?:string|null}){
 const [selected,setSelected]=useState<string[]>([]);const [pending,startTransition]=useTransition();const router=useRouter();
 const [confirmedSelection,setConfirmedSelection]=useState<{href:string;ids:string[]}|null>(null);
 const [message,setMessage]=useState('');const [error,setError]=useState('');const [format,setFormat]=useState<'xlsx'|'csv'>('xlsx');
 const [failures,setFailures]=useState<{id:string;reason:string}[]>([]);
 const [noticeSelection,setNoticeSelection]=useState<string[]|null>(null);
 // Revalidation can move just-confirmed shipments behind an existing ready backlog.
 // Keep that successful batch for the immediate export without putting UUIDs in the URL.
 const retainedIds=confirmedSelection?.href===currentHref?confirmedSelection.ids:null;
 const visibleIds=new Set(rows.map(row=>row.id));
 const selectableIds=new Set(rows.filter(row=>tab==='delayed'||shipmentConsoleSelectable(row,tab)).map(row=>row.id));
 const ids=retainedIds?retainedIds.filter(id=>!visibleIds.has(id)||selectableIds.has(id)):selected.filter(id=>selectableIds.has(id));
 const retainedOffPage=retainedIds?.filter(id=>!visibleIds.has(id)).length??0;
 const orderIds=[...new Set(rows.filter(row=>ids.includes(row.id)).map(row=>row.orderId))];
 const hasBatchActions=tab==='new'||tab==='delayed'||rows.some(isParcelShipment)||Boolean(retainedIds?.length);
 const exportEligible=ids.length>0&&ids.every(id=>{const row=rows.find(item=>item.id===id);return row?shipmentConsoleSelectable(row,tab):Boolean(retainedIds?.includes(id));});
 // 출고지 단위 내려받기는 목록 페이지(100건)와 무관하게 아직 전달하지 않은 건 전부를 한 파일로 받는다.
 const exportOrigins=tab==='ready'||tab==='delayed'?origins.filter(origin=>origin.active!==false&&(!originId||origin.id===originId)):[];
 function select(next:string[]){setConfirmedSelection(null);setSelected(next.filter(id=>selectableIds.has(id)));}
 function exportOrigin(origin:ShipmentConsoleOrigin){
  if(pending)return;
  setMessage('');setError('');setFailures([]);
  startTransition(async()=>{
   try{
    const result=await exportPendingOriginShipmentsAction(origin.id,format);
    if(result.error)setError(result.error);else if(result.file){download(result.file);setMessage(result.message??'');}
    router.refresh();
   }catch{setError('처리 중 연결이 끊겼습니다. 최신 상태를 확인한 뒤 다시 시도해주세요.');}
  });
 }
 function run(kind:'confirm'|'export'|'complete'){
  if(!ids.length||pending)return;
  if(kind==='export'&&!exportEligible)return;
  // 창고는 같은 출고지시를 두 번 받으면 걸러내지 못한다(서원 회신 C6). 다시 보낼 때는 확인을 받는다.
  const resent=kind==='export'?rows.filter(row=>ids.includes(row.id)&&row.exportedAt).length:0;
  if(resent&&!window.confirm(`이미 출고지시를 전달한 배송 건 ${resent}건이 포함돼 있습니다. 창고는 같은 건을 두 번 받으면 걸러내지 못해 중복 출고될 수 있습니다. 그래도 다시 내려받을까요?`))return;
  if(kind==='complete'&&!window.confirm('선택한 배송 건이 실제 도착했는지 확인했나요? 배송완료 시각부터 해당 배송 건의 철회 기간이 시작됩니다.'))return;
  setMessage('');setError('');setFailures([]);
  startTransition(async()=>{
   try{
    if(kind==='confirm'){
     const form=new FormData();orderIds.forEach(id=>form.append('orderIds',id));const result=await bulkConfirmAdminOrdersAction({},form);
     if(result.errors?.form)setError(result.errors.form);
     else{
      setMessage(result.message??'발주확인했습니다.');
      const confirmedOrders=new Set(result.confirmedOrderIds??[]);
      const confirmedIds=rows.filter(row=>ids.includes(row.id)&&confirmedOrders.has(row.orderId)&&isParcelShipment(row)&&row.preorderReady!==false).map(row=>row.id);
      if(confirmedOrders.size){
       setSelected([]);setConfirmedSelection(confirmedIds.length?{href:readyHref,ids:confirmedIds}:null);
       router.push(readyHref);return;
      }
     }
    }else if(kind==='complete'){
     const result=await completeShipmentsAction(ids);if(result.error)setError(result.error);else{setMessage(result.message??'');setFailures(result.failed??[]);}
    }else{
     const result=await exportShipmentsAction(ids,format);
     if(result.error)setError(result.error);
     else if(result.file){download(result.file);setMessage(result.message??`${ids.length}건의 출고지시를 내려받았습니다.`);}
    }
    router.refresh();
   }catch{setError('처리 중 연결이 끊겼습니다. 최신 상태를 확인한 뒤 다시 시도해주세요.');}
  });
 }
 return <div className="wc-admin-kit">
  <ConsoleGrid caption="출고지별 배송 건 목록" columns={columns} rows={gridRows} emptyLabel="조건에 맞는 배송 건이 없습니다."
   selectable={tab!=='delivered'&&hasBatchActions} selectedIds={ids} onSelectionChange={select}>
   {tab!=='delivered'&&hasBatchActions?<div className="wc-admin-kit__actions" style={{padding:12}}>
    <span>{ids.length}개 배송 건 선택</span>
    {retainedOffPage>0?<span>방금 발주확인한 다른 페이지의 {retainedOffPage}건 포함 <button type="button" className="wc-admin-kit__button" onClick={()=>select([])}>선택 해제</button></span>:null}
    {tab==='new'?<button className="wc-admin-kit__button" disabled={pending||!ids.length} onClick={()=>run('confirm')}>선택 주문 {orderIds.length}건 발주확인</button>:tab==='transit'?
     <button className="wc-admin-kit__button" disabled={pending||!ids.length} onClick={()=>run('complete')}>선택 배송완료</button>:
     <><label>파일 형식 <select value={format} onChange={event=>setFormat(event.target.value as 'xlsx'|'csv')}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option></select></label>
     <button className="wc-admin-kit__button" disabled={pending||!exportEligible} onClick={()=>run('export')}>출고지시 내보내기</button></>}
    {tab==='delayed'?<button className="wc-admin-kit__button" disabled={pending||!ids.length} onClick={()=>setNoticeSelection([...ids])}>선택 주문 {orderIds.length}건 고객 지연 안내</button>:null}
    {pending?<span role="status">처리 중…</span>:null}
   </div>:null}
   {exportOrigins.length?<div className="wc-admin-kit__actions" role="group" aria-label="출고지별 새 출고지시 내려받기" style={{padding:'0 12px 12px'}}>
    <span>선택 없이 출고지별로 아직 전달하지 않은 발송 대기 건을 그 창고 양식 파일 하나로 받습니다(품목 1,000줄까지, 남으면 다시 눌러 이어 받기).</span>
    {exportOrigins.map(origin=><button key={origin.id} type="button" className="wc-admin-kit__button" disabled={pending} onClick={()=>exportOrigin(origin)}>{origin.name} 새 출고지시 전체 내려받기</button>)}
   </div>:null}
  </ConsoleGrid>
  {tab==='delayed'?<button className="wc-admin-kit__button" type="button" onClick={()=>setNoticeSelection([])}>고객 지연 안내 이력·결과</button>:null}
  {noticeSelection!==null?<OrderDelayNoticePanel key={noticeSelection.join(',')} shipmentIds={noticeSelection} onClose={()=>setNoticeSelection(null)}/>:null}
  {message?<p role="status">{message}</p>:null}{error?<p role="alert" className="wc-admin-kit__error">{error}</p>:null}
  {failures.length?<ul>{failures.map(row=><li key={row.id}>{row.id}: {row.reason}</li>)}</ul>:null}
 </div>;
}
