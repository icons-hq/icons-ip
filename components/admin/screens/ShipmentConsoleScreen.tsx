import Link from 'next/link';
import {ConsoleCountChips,ConsoleFilterPanel,ConsolePagination,type ConsoleGridColumn} from '@/components/admin/console';
import {AdminPageHeader,AdminStatusBadge} from '@/components/admin/console/AdminKit';
import {SHIPMENT_CONSOLE_TABS,shipmentConsoleHref,type ShipmentConsoleData} from '@/lib/admin/shipment-dispatch';
import {formatOrderDateTime,orderReferenceLabel} from '@/lib/orders';
import {orderShipment} from '@/lib/orders/shipment';
import {shipmentStatusLabel} from '@/lib/orders/shipments';
import {ShipmentConsoleGrid} from './ShipmentConsoleGrid';
import {DispatchTrackingImportPanel} from './DispatchTrackingImportPanel';
import {DispatchDelayNoteForm} from './DispatchDelayNoteForm';
export function ShipmentConsoleScreen({data,registeredCount}:{data:ShipmentConsoleData;registeredCount?:number|null}){
 const {surface,filters,rows,origins,carriers}=data;const isDispatch=surface==='dispatch';
 const columns:ConsoleGridColumn[]=[{key:'reference',label:'배송건번호 / 주문번호',width:'165px'},{key:'origin',label:'출고지',width:'100px'},
  {key:'recipient',label:'수취인',width:'110px'},{key:'items',label:'상품 · 옵션'},{key:'time',label:isDispatch?'주문 / 발주확인':'발송 / 배송완료',width:'165px'},
  {key:'tracking',label:isDispatch?'출고지시':'운송장',width:'180px'},...(filters.tab==='delayed'?[{key:'delay',label:'지연 메모',width:'260px'}]:[])];
 const gridRows=rows.map(row=>{
  const tracking=orderShipment(carriers,row.carrier,row.trackingNumber);
  return {id:row.id,selectLabel:`배송 건 ${row.id.slice(-8).toUpperCase()} 선택`,cells:[
   <div key="id"><Link href={`/admin/sales/orders/${row.orderId}`} className="mono">{row.id.slice(-8).toUpperCase()}</Link><br/><small>주문 {orderReferenceLabel(row.orderId)}</small></div>,
   <span key="origin">{row.originName}</span>,<span key="recipient">{row.recipientName||row.buyerName}</span>,
   <ul key="items" style={{margin:0,paddingLeft:16}}>{row.items.map(item=><li key={item.id}>{item.name}{item.variantName?` · ${item.variantName}`:''} × {item.qty}</li>)}</ul>,
   <div key="time">{formatOrderDateTime(isDispatch?row.createdAt:row.shippedAt??row.createdAt)}<br/><small>{(isDispatch?row.confirmedAt:row.deliveredAt)?formatOrderDateTime((isDispatch?row.confirmedAt:row.deliveredAt)!):'미기록'}</small></div>,
   isDispatch?<AdminStatusBadge key="export" tone={row.exportedAt?'success':'neutral'}>{row.exportedAt?'출고지시 전달':'내보내기 전'}</AdminStatusBadge>:
    <div key="tracking"><span>{shipmentStatusLabel(row.status)}</span><br/>{tracking?<a href={tracking.trackingUrl} target="_blank" rel="noreferrer noopener">{tracking.carrierLabel} {tracking.trackingNumber}</a>:'운송장 확인 필요'}</div>,
   ...(filters.tab==='delayed'?[<DispatchDelayNoteForm key="delay" orderId={row.orderId} reference={orderReferenceLabel(row.orderId)} note={row.delayReason?{reason:row.delayReason,expectedShipDate:row.expectedShipDate,updatedAt:row.updatedAt}:null}/>]:[]),
  ]};
 });
 return <section className="wc-admin-kit">
  <AdminPageHeader title={isDispatch?'발주·발송':'배송현황'} description={isDispatch?'출고지별 배송 건을 확인하고, 출고지시를 내려받은 뒤 운송장을 일괄 등록합니다.':'운송장을 확인한 뒤 실제 도착한 배송 건만 배송완료로 처리합니다.'}/>
  {!isDispatch&&registeredCount?<p role="status" className="wc-admin-kit__card">운송장 {registeredCount.toLocaleString('ko-KR')}건을 등록했습니다. 배송 메일은 대기열에서 처리됩니다.</p>:null}
  <ConsoleFilterPanel action={`/admin/sales/${surface}`} hiddenFields={{tab:filters.tab}} dateRange={{from:filters.from,to:filters.to,label:'주문일'}}
   statusFilter={{name:'originId',label:'출고지',value:filters.originId??'',options:[{value:'',label:'전체 출고지'},...origins.map(origin=>({value:origin.id,label:origin.name}))]}}
   search={{value:filters.query,placeholder:'배송건번호 · 주문번호 · 구매자'}} />
  <ConsoleCountChips label="배송 처리 단계" chips={SHIPMENT_CONSOLE_TABS[surface].map(tab=>({active:tab.id===filters.tab,label:tab.label,count:data.counts[tab.id],href:shipmentConsoleHref(surface,filters,{tab:tab.id,page:1})}))}/>
  {isDispatch&&filters.tab!=='new'?<DispatchTrackingImportPanel carriers={carriers} shippingHref={shipmentConsoleHref('shipping',filters,{tab:'transit',page:1})}/>:null}
  <ShipmentConsoleGrid rows={rows} columns={columns} gridRows={gridRows} tab={filters.tab}
   currentHref={shipmentConsoleHref(surface,filters)} readyHref={shipmentConsoleHref('dispatch',filters,{tab:'ready',page:1})}/>
  <ConsolePagination label="배송 건 페이지" page={filters.page} pageSize={data.pageSize} total={data.total} hrefForPage={page=>shipmentConsoleHref(surface,filters,{page})}/>
 </section>;
}
