import Link from 'next/link';
import {ConsoleCountChips,ConsoleFilterPanel,ConsolePagination,type ConsoleGridColumn} from '@/components/admin/console';
import {AdminPageHeader,AdminStatusBadge} from '@/components/admin/console/AdminKit';
import {SHIPMENT_CONSOLE_TABS,isParcelShipment,shipmentConsoleHref,shipmentConsoleSelectable,type ShipmentConsoleData} from '@/lib/admin/shipment-dispatch';
import {adminOrderDetailHrefFromBack} from '@/lib/admin/orders';
import {formatOrderDateTime,orderReferenceLabel} from '@/lib/orders';
import {orderShipment} from '@/lib/orders/shipment';
import {shipmentStatusLabel} from '@/lib/orders/shipments';
import {DELIVERY_METHOD_LABELS,deliveryStatusLabel} from '@/lib/shipment-delivery';
import {ShipmentConsoleGrid} from './ShipmentConsoleGrid';
import {DispatchTrackingImportPanel} from './DispatchTrackingImportPanel';
import {DispatchDelayNoteForm} from './DispatchDelayNoteForm';
export function ShipmentConsoleScreen({data,registeredCount}:{data:ShipmentConsoleData;registeredCount?:number|null}){
 const {surface,filters,rows,origins,carriers}=data;const isDispatch=surface==='dispatch';
 const columns:ConsoleGridColumn[]=[{key:'reference',label:'배송건번호 / 주문번호',width:'165px'},{key:'origin',label:'출고지',width:'100px'},
  {key:'method',label:'배송 방식',width:'110px'},
  {key:'recipient',label:'수취인',width:'110px'},{key:'items',label:'상품 · 옵션'},{key:'time',label:isDispatch?'주문 / 발주확인':'발송 / 배송완료',width:'165px'},
  {key:'tracking',label:isDispatch?'발송·인계':'배송·수령 확인',width:'180px'},...(filters.tab==='delayed'?[{key:'delay',label:'지연 메모',width:'260px'}]:[])];
 const gridRows=rows.map(row=>{
  const parcel=isParcelShipment(row);const tracking=parcel?orderShipment(carriers,row.carrier,row.trackingNumber):null;
  const methodLabel=row.delivery?DELIVERY_METHOD_LABELS[row.delivery.method]:parcel?'택배':'확인 필요';
  const detailHref=adminOrderDetailHrefFromBack(row.orderId,shipmentConsoleHref(surface,filters));
  return {id:row.id,selectable:filters.tab==='delayed'||shipmentConsoleSelectable(row,filters.tab),selectLabel:`배송 건 ${row.id.slice(-8).toUpperCase()} 선택`,cells:[
   <div key="id"><Link
    aria-label={`주문 ${orderReferenceLabel(row.orderId)} 상세 열기 (새 탭)`}
    className="mono"
    href={adminOrderDetailHrefFromBack(row.orderId,shipmentConsoleHref(surface,filters))}
    rel="noopener noreferrer"
    target="_blank"
   >{row.id.slice(-8).toUpperCase()}</Link><br/><small>주문 {orderReferenceLabel(row.orderId)}</small></div>,
   <span key="origin">{row.originName}</span>,<span key="method">{methodLabel}</span>,<span key="recipient">{row.recipientName||row.buyerName}</span>,
   <ul key="items" style={{margin:0,paddingLeft:16}}>{row.items.map(item=><li key={item.id}>{item.name}{item.variantName?` · ${item.variantName}`:''} × {item.qty}</li>)}</ul>,
   <div key="time">{formatOrderDateTime(isDispatch?row.createdAt:row.shippedAt??row.createdAt)}<br/><small>{(isDispatch?row.confirmedAt:row.deliveredAt)?formatOrderDateTime((isDispatch?row.confirmedAt:row.deliveredAt)!):'미기록'}</small></div>,
   !parcel?<div key="method-action"><span>{row.delivery?deliveryStatusLabel(row.delivery.method,row.status):'배송 방식 확인 필요'}</span><br/>
    <Link href={detailHref} target="_blank" rel="noopener noreferrer">{methodLabel} 인계·수령 확인</Link></div>:
    isDispatch?<div key="export"><AdminStatusBadge tone={row.exportedAt?'success':'neutral'}>{row.exportedAt?'출고지시 전달':'내보내기 전'}</AdminStatusBadge>
      {row.preorderReady===false?<p className="muted">예약 재고 할당 필요</p>:null}</div>:
    <div key="tracking"><span>{shipmentStatusLabel(row.status)}</span><br/>{tracking?<a href={tracking.trackingUrl} target="_blank" rel="noreferrer noopener">{tracking.carrierLabel} {tracking.trackingNumber}</a>:'운송장 확인 필요'}</div>,
   ...(filters.tab==='delayed'?[<DispatchDelayNoteForm key="delay" orderId={row.orderId} reference={orderReferenceLabel(row.orderId)} note={row.delayReason?{reason:row.delayReason,expectedShipDate:row.expectedShipDate,updatedAt:row.updatedAt}:null}/>]:[]),
  ]};
 });
 return <section className="wc-admin-kit">
  <AdminPageHeader title={isDispatch?'발주·발송':'배송현황'} description={isDispatch?'출고지별 배송 건을 확인합니다. 택배는 출고지시·운송장으로 처리하고, 퀵·방문수령은 주문 상세에서 실제 인계와 수령을 확인합니다.':'택배의 실제 도착을 확인해 배송완료로 처리합니다. 퀵·방문수령은 주문 상세에서 일회 수령 확인값과 인계 근거를 기록합니다.'}/>
  {!isDispatch&&registeredCount?<p role="status" className="wc-admin-kit__card">운송장 {registeredCount.toLocaleString('ko-KR')}건을 등록했습니다. 배송 메일은 대기열에서 처리됩니다.</p>:null}
  <ConsoleFilterPanel action={`/admin/sales/${surface}`} hiddenFields={{tab:filters.tab}} dateRange={{from:filters.from,to:filters.to,label:'주문일'}}
   statusFilter={{name:'originId',label:'출고지',value:filters.originId??'',options:[{value:'',label:'전체 출고지'},...origins.map(origin=>({value:origin.id,label:origin.name}))]}}
   search={{value:filters.query,placeholder:'배송건번호 · 주문번호 · 구매자'}} />
  <ConsoleCountChips label="배송 처리 단계" chips={SHIPMENT_CONSOLE_TABS[surface].map(tab=>({active:tab.id===filters.tab,label:tab.label,count:data.counts[tab.id],href:shipmentConsoleHref(surface,filters,{tab:tab.id,page:1})}))}/>
  {isDispatch&&filters.tab!=='new'&&(!rows.length||rows.some(isParcelShipment))?<DispatchTrackingImportPanel carriers={carriers} originId={filters.originId} shippingHref={shipmentConsoleHref('shipping',filters,{tab:'transit',page:1})}/>:null}
  <ShipmentConsoleGrid rows={rows} columns={columns} gridRows={gridRows} tab={filters.tab}
   currentHref={shipmentConsoleHref(surface,filters)} readyHref={shipmentConsoleHref('dispatch',filters,{tab:'ready',page:1})}/>
  <ConsolePagination label="배송 건 페이지" page={filters.page} pageSize={data.pageSize} total={data.total} hrefForPage={page=>shipmentConsoleHref(surface,filters,{page})}/>
 </section>;
}
