import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import {FULFILLMENT_METHODS,FULFILLMENT_METHOD_LABELS} from '@/lib/goods-fulfillment';
import Link from 'next/link';
import {ConsolePagination,type ConsoleGridColumn} from '@/components/admin/console';
import {AdminStatusBadge} from '@/components/admin/console/AdminKit';
import {SHIPMENT_CONSOLE_TABS,SHIPMENT_SEARCH_FIELDS,isParcelShipment,shipmentConsoleHref,shipmentConsoleSelectable,type ShipmentConsoleData} from '@/lib/admin/shipment-dispatch';
import {adminOrderDetailHrefFromBack} from '@/lib/admin/orders';
import {formatOrderDateTime,orderReferenceLabel} from '@/lib/orders';
import {orderShipment} from '@/lib/orders/shipment';
import {shipmentStatusLabel} from '@/lib/orders/shipments';
import {DELIVERY_METHOD_LABELS,deliveryStatusLabel} from '@/lib/shipment-delivery';
import {ShipmentConsoleGrid} from './ShipmentConsoleGrid';
import {DispatchTrackingImportPanel} from './DispatchTrackingImportPanel';
import {DispatchDelayNoteForm} from './DispatchDelayNoteForm';
import {AdminListExportButton} from '@/components/admin/AdminListExportButton';
import {adminListExportHref} from '@/lib/admin/list-export';
import {SALES_DATE_FIELDS,SHIPMENT_PAGE_SIZES} from '@/lib/admin/sales-list';
import {SalesFilterField,SalesFilterPanel,SalesGuide,SalesResultsHeader,SalesSelect,SalesStatusSummary} from '@/components/admin/sales/SalesConsole';
import {SHIPMENT_DELAY_NOTICE_OPTIONS,shipmentDelayNoticeLabel} from '@/lib/admin/shipment-delay-notice';
import {ORDER_DELAY_STATUS_LABELS} from '@/lib/admin/order-delay-notices';
export function ShipmentConsoleScreen({data,registeredCount,actorId}:{data:ShipmentConsoleData;registeredCount?:number|null;actorId?:string}){
 const {surface,filters,rows,origins,carriers}=data;const isDispatch=surface==='dispatch';
 const hasParcelRows=!rows.length||rows.some(isParcelShipment);
 const currentHref=shipmentConsoleHref(surface,filters);
 const columns:ConsoleGridColumn[]=[{key:'reference',label:'배송건번호 / 주문번호',width:'165px'},{key:'origin',label:'출고지',width:'100px'},
  {key:'method',label:'배송 방식',width:'110px'},
  {key:'buyer',label:'구매자명',width:'130px'},
  {key:'recipient',label:'수취인',width:'110px'},{key:'items',label:'상품 · 옵션'},{key:'time',label:isDispatch?'주문 / 발주확인':'발송 / 배송완료',width:'165px'},
  {key:'tracking',label:isDispatch?'발송·인계':'배송·수령 확인',width:'180px'},...(isDispatch?[{key:'notice',label:'지연 안내 결과',width:'210px'}]:[]),...(filters.tab==='delayed'?[{key:'delay',label:'지연 메모',width:'260px'}]:[])];
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
   >{row.id.slice(-8).toUpperCase()}</Link><br/><small>주문 {orderReferenceLabel(row.orderId)}</small>{row.pack?<p><AdminStatusBadge tone="neutral">합포장 {row.pack.id.slice(-8).toUpperCase()} · {row.pack.count}건</AdminStatusBadge></p>:null}</div>,
   <span key="origin">{row.originName}</span>,<span key="method">{methodLabel}</span>,<span key="buyer">{row.buyerName}</span>,<span key="recipient">{row.recipientName||'미기록'}</span>,
   <ul key="items">{row.items.map(item=><li key={item.id}>{item.name}{item.variantName?` · ${item.variantName}`:''} × {item.qty}<GoodsCustomInputsSummary selection={item.customInputs} /></li>)}</ul>,
   <div key="time">{formatOrderDateTime(isDispatch?row.createdAt:row.shippedAt??row.createdAt)}<br/><small>{(isDispatch?row.confirmedAt:row.deliveredAt)?formatOrderDateTime((isDispatch?row.confirmedAt:row.deliveredAt)!):'미기록'}</small></div>,
   !parcel?<div key="method-action"><span>{row.delivery?deliveryStatusLabel(row.delivery.method,row.status):'배송 방식 확인 필요'}</span><br/>
    <Link href={detailHref} target="_blank" rel="noopener noreferrer">{row.delivery?.method==='digital'?'디지털 파일 제공 이력':`${methodLabel} 인계·수령 확인`}</Link></div>:
    isDispatch?<div key="export"><AdminStatusBadge tone={row.exportedAt?'success':'neutral'}>{row.exportedAt?'출고지시 전달':'내보내기 전'}</AdminStatusBadge>
      {row.preorderReady===false?<p className="muted">예약 재고 할당 필요</p>:null}{row.production&&row.production.count>0?<p><Link href={detailHref}>주문제작 {row.production.completed}/{row.production.count}건 완료{row.production.ready?'':' · 제작 완료 전 발송 불가'}</Link></p>:null}</div>:
    <div key="tracking"><span>{shipmentStatusLabel(row.status)}</span><br/>{tracking?<a href={tracking.trackingUrl} target="_blank" rel="noreferrer noopener">{tracking.carrierLabel} {tracking.trackingNumber}</a>:'운송장 확인 필요'}</div>,
   ...(isDispatch?[<div key="notice"><strong>{shipmentDelayNoticeLabel(row.delayNotice?.status)}</strong>
    {row.delayNotice?.requestedAt?<><br/><small>앱 {ORDER_DELAY_STATUS_LABELS[row.delayNotice.inAppStatus??'prepared']} · 이메일 {ORDER_DELAY_STATUS_LABELS[row.delayNotice.emailStatus??'unknown']}</small><br/><small>{formatOrderDateTime(row.delayNotice.requestedAt)}</small></>:null}</div>]:[]),
   ...(filters.tab==='delayed'?[<DispatchDelayNoteForm key="delay" orderId={row.orderId} reference={orderReferenceLabel(row.orderId)} note={row.delayReason?{reason:row.delayReason,expectedShipDate:row.expectedShipDate,updatedAt:row.updatedAt}:null}/>]:[]),
  ]};
 });
 return <section className="admin-sales-console wc-admin-kit">
  <SalesGuide title={isDispatch?'신규주문 확인부터 출고지별 발송까지 처리할 수 있습니다.':'발송한 배송 건과 실제 배송완료 상태를 확인할 수 있습니다.'}>
   <p>{isDispatch&&hasParcelRows?'순서: 대상 선택 → 출고지시 내보내기 → 창고 회신 → 운송장 등록. 출고지별 배송 건을 확인하며, 퀵·직접배송·화물배송·방문수령·배송없음은 주문 상세에서 실제 인계와 수령을 확인합니다.':isDispatch?'택배 외 배송 방식은 주문 상세에서 확인합니다. 디지털 파일은 구매자의 다운로드 제공 이력으로 처리 상태를 확인합니다.':'택배의 실제 도착을 확인해 배송완료로 처리합니다. 택배 외 실물 상품은 주문 상세에서 수령 확인값과 인계 근거를 기록합니다. 디지털 파일은 다운로드 제공 이력으로 확인합니다.'}</p>
   {isDispatch?<p>지연 안내 결과는 배송 건별 최근 발송 요청의 앱 알림과 이메일 기록입니다. 미리보기만 저장한 안내는 제외합니다. 발송 처리는 앱 알림 기록과 이메일 공급자 접수·발송 상태이며 고객의 수신·열람을 뜻하지 않습니다. 채널별 실패와 결과 불명은 안내 이력에서 확인합니다.</p>:null}
  </SalesGuide>
  <SalesStatusSummary label="배송 처리 단계" items={SHIPMENT_CONSOLE_TABS[surface].map(tab=>({active:tab.id===filters.tab,label:tab.label,count:data.counts[tab.id],urgent:tab.id==='delayed'&&data.counts.delayed>0,href:shipmentConsoleHref(surface,filters,{tab:tab.id,page:1})}))}/>
  {!isDispatch&&registeredCount?<p role="status" className="wc-admin-kit__card">운송장 {registeredCount.toLocaleString('ko-KR')}건을 등록했습니다. 배송 메일은 대기열에서 처리됩니다.</p>:null}
  <SalesFilterPanel currentHref={currentHref} id={`sales-${surface}`}
   hiddenFieldExclusions={['delayNotice']}
   date={{from:filters.from,to:filters.to,field:filters.dateField??'ordered',options:SALES_DATE_FIELDS.filter(option=>option.value!=='settled')}}
   search={{value:filters.query,field:filters.field??'all',options:SHIPMENT_SEARCH_FIELDS,placeholder:'배송건번호 · 주문번호 · 구매자'}}
   resetHref={`/admin/sales/${surface}?tab=${filters.tab}`}>
   <SalesFilterField label="처리상태" htmlFor="sales-shipment-tab">
    <SalesSelect id="sales-shipment-tab" name="tab" value={filters.tab} options={SHIPMENT_CONSOLE_TABS[surface].map(tab=>({value:tab.id,label:tab.label}))}/>
   </SalesFilterField>
   <SalesFilterField label="배송방법" htmlFor="sales-shipment-method"><SalesSelect id="sales-shipment-method" name="method" value={filters.method??''}
    options={[{value:'',label:'전체'},...FULFILLMENT_METHODS.map(method=>({value:method,label:FULFILLMENT_METHOD_LABELS[method]}))]}/></SalesFilterField>
   <SalesFilterField label="출고지" htmlFor="sales-shipment-origin"><SalesSelect id="sales-shipment-origin" name="originId" value={filters.originId??''}
    options={[{value:'',label:'전체 출고지'},...origins.map(origin=>({value:origin.id,label:origin.name}))]}/></SalesFilterField>
   <SalesFilterField label="결제수단" htmlFor="sales-shipment-payment"><SalesSelect id="sales-shipment-payment" name="paymentMethod" value={filters.paymentMethod??''}
    options={[{value:'',label:'전체'},{value:'card',label:'카드'},{value:'bank_transfer',label:'무통장 입금'}]}/></SalesFilterField>
   {isDispatch?<SalesFilterField label="발송지연 안내여부" htmlFor="sales-shipment-delay-notice"><SalesSelect id="sales-shipment-delay-notice" name="delayNotice" value={filters.delayNotice??''} options={SHIPMENT_DELAY_NOTICE_OPTIONS}/></SalesFilterField>:null}
  </SalesFilterPanel>
  <div className="admin-sales-results">
  <SalesResultsHeader currentHref={currentHref} total={data.total} pageSize={data.pageSize} pageSizes={SHIPMENT_PAGE_SIZES} sort={filters.sort??'oldest'} unit="개 배송 건">
   <AdminListExportButton href={adminListExportHref(surface,currentHref)} total={data.total}/>
  </SalesResultsHeader>
  {isDispatch&&filters.tab!=='new'&&(!rows.length||rows.some(isParcelShipment))?<details className="admin-shipment-import-disclosure">
   <summary>운송장 가져오기 · 창고 회신 등록</summary>
   <DispatchTrackingImportPanel carriers={carriers} originId={filters.originId} shippingHref={shipmentConsoleHref('shipping',filters,{tab:'transit',page:1})}/>
  </details>:null}
  <ShipmentConsoleGrid actorId={actorId} rows={rows} columns={columns} gridRows={gridRows} tab={filters.tab}
   currentHref={shipmentConsoleHref(surface,filters)} readyHref={shipmentConsoleHref('dispatch',filters,{tab:'ready',page:1})}/>
  <ConsolePagination label="배송 건 페이지" page={filters.page} pageSize={data.pageSize} total={data.total} hrefForPage={page=>shipmentConsoleHref(surface,filters,{page})}/>
  </div>
 </section>;
}
