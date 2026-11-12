import { commerceReferenceLabel } from '@/lib/commerce-number';
import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import {FULFILLMENT_METHODS,FULFILLMENT_METHOD_LABELS} from '@/lib/goods-fulfillment';
import Link from 'next/link';
import {ConsolePagination,type ConsoleGridColumn} from '@/components/admin/console';
import {AdminNotice,AdminStatusBadge} from '@/components/admin/console/AdminKit';
import {AdminCountCard} from '@/components/admin/console/AdminCountCard';
import {buttonVariants} from '@/components/admin/kit/ui/button';
import {statusTone} from '@/lib/admin/status-tone';
import {SHIPMENT_CONSOLE_TABS,SHIPMENT_SEARCH_FIELDS,isParcelShipment,shipmentConsoleHref,shipmentConsoleNonParcelBatch,shipmentConsoleRowSelectable,shipmentConsoleSelectable,type ShipmentConsoleData} from '@/lib/admin/shipment-dispatch';
import {ShipmentConsoleRowTracking} from './ShipmentConsoleRowTracking';
import {ShipmentConsoleMethodButton} from './ShipmentConsoleMethodButton';
import {OrderPreviewLink,OrderPreviewNewTabLink} from './OrderPreview';
import {adminOrderPreviewHref} from '@/lib/admin/order-preview';
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
import {SALES_DATE_FIELDS,SALES_SORT_OPTIONS,SHIPMENT_PAGE_SIZES} from '@/lib/admin/sales-list';
import {DispatchDeliveryRecordButton} from '@/components/admin/DispatchDeliveryRecordPanel';
import {SalesFilterField,SalesFilterPanel,SalesGuide,SalesResultsHeader,SalesSelect,SalesStatusSummary,kstDayDiff} from '@/components/admin/sales/SalesConsole';
import {SHIPMENT_DELAY_NOTICE_OPTIONS,shipmentDelayNoticeLabel} from '@/lib/admin/shipment-delay-notice';
import {ORDER_DELAY_STATUS_LABELS} from '@/lib/admin/order-delay-notices';
import {ChevronDown,PackageCheck,TimerOff,Truck} from 'lucide-react';
import type {ReactNode} from 'react';
/* 발주확인·발송관리와 배송현황 — 템플릿 룩(ADR-0028). 조회 조건·처리 단계·열 구성·처리 순서는 그대로이고 셀 보조 줄은 유틸리티다. */
const CELL_STACK='flex flex-col items-start gap-0.5';
const CELL_NOTE='text-xs text-muted-foreground';
const CELL_LINK='underline underline-offset-4';
/* 이름·출고지는 한 줄로 자르고 전체 값은 title에 둔다 — 긴 닉네임 하나로 줄 높이가 튀지 않게 한다. 자동 폭 표라 칸마다 최대 폭을 함께 준다. */
const CELL_ONE_LINE='block truncate';
/* 이 날수를 넘겨 배송 중인 건은 표에서 눈에 띄게 적는다. 상태를 바꾸는 판정이 아니라 눈으로 찾기 위한 표시다. */
const LONG_TRANSIT_DAYS=5;
/* 신규주문이 이 날수 넘게 남아 있으면 글자만 진하게 적는다. 색은 위 카드의 발송 지연과 같은 판정인 줄에만 쓴다 — 전 행이 노란색이면 어느 줄이 지연인지 알 수 없다. */
const LONG_WAIT_DAYS=3;
const DAY_MS=86_400_000;
/** 그 시각부터 한국 달력으로 며칠 지났는가. */
const daysSince=(iso:string,now:Date)=>Math.max(0,kstDayDiff(Date.parse(iso),now.getTime()));
/**
 * 위 '발송 지연' 카드와 같은 판정(admin_search_shipments_notice_console의 is_delayed)을 표시용으로 다시 계산해 며칠째인지 돌려준다. 지연이 아니면 null이다.
 * 예약 판매 건은 약속한 발송일을 넘긴 만큼 세고, 일반 건은 발주확인한 날부터 센다.
 */
function dispatchDelayDays(row:ShipmentConsoleData['rows'][number],now:Date):number|null{
 if(row.status!=='ready'||!row.confirmedAt)return null;
 if(row.originalExpectedShipDate){
  if(!row.expectedShipDate)return null;
  const overdue=kstDayDiff(Date.parse(`${row.expectedShipDate}T00:00:00+09:00`),now.getTime());
  return overdue>0?overdue:null;
 }
 return Date.parse(row.confirmedAt)<now.getTime()-3*DAY_MS?daysSince(row.confirmedAt,now):null;
}
export function ShipmentConsoleScreen({data,registeredCount,actorId,summaryAside,now=new Date(),canManageSales=true,canReadOrders=true}:{data:ShipmentConsoleData;registeredCount?:number|null;actorId?:string;
 /** 단계 이름 줄 오른쪽에 둘 상태 표시(자동 발주확인 켜짐·꺼짐). */
 summaryAside?:ReactNode;
 /** 판매 관리 권한. 없으면(물류 출고 권한) 발주확인·합포장 관리·고객 지연 안내(결과 열·이력 포함)·지연 메모 열·목록 엑셀을 숨긴다. 출고·운송장·발송·배송완료는 그대로다. */
 canManageSales?:boolean;
 /**
  * 주문 조회 권한(sales.read). 없으면 출고 전용 운영자(1014-084 "수령인 정보만")다 — 구매자 열·구매자 검색·결제수단 거르기·결제일 기준·금액순 정렬과
  * 주문 상세로 가는 링크·목록 위 상세 팝업(S36-075)을 두지 않고, 택배 외 배송은 이 화면의 팝업에서 인계·수령을 기록한다. DB도 같은 값을 비워 보낸다.
  */
 canReadOrders?:boolean;
 /** 배송 경과일 기준 시각. 테스트 주입용. */
 now?:Date}){
 const {surface,filters,rows,origins,carriers}=data;const isDispatch=surface==='dispatch';
 const hasParcelRows=!rows.length||rows.some(isParcelShipment);
 const currentHref=shipmentConsoleHref(surface,filters);
 /* 1440 화면(표 폭 약 1,100px)에 주요 열이 들어오게 나눈다. 상품·옵션은 폭을 비워 남는 자리를 모두 받고, 거의 '택배'인 배송 방식은 뒤로 보낸다.
    지연 안내 결과는 지연 탭이나 그 조건으로 찾을 때만 기본으로 보인다(조회항목 설정에서 언제든 켤 수 있다). */
 const showDelayNotice=isDispatch&&(filters.tab==='delayed'||Boolean(filters.delayNotice));
 /* 고객 지연 안내 결과·지연 메모는 판매 관리(고객 응대) 일이다. */
 const delayNoticeColumn=isDispatch&&canManageSales,delayNoteColumn=filters.tab==='delayed'&&canManageSales;
 /* S36-072: 발송 대기·지연 탭은 행마다 택배사·운송장 칸을 두어 그 자리에서 발송처리한다. 배송 방법은 발주·발송 화면 전체에서 행 버튼으로 바꾼다. */
 const rowTracking=isDispatch&&(filters.tab==='ready'||filters.tab==='delayed');
 const activeCarriers=carriers.filter(carrier=>carrier.active).map(({code,label})=>({code,label}));
 const columns:ConsoleGridColumn[]=[{key:'reference',label:'배송건번호 / 주문번호',width:'176px'},{key:'items',label:'상품 · 옵션'},
  {key:'origin',label:'출고지',width:'72px'},
  ...(canReadOrders?[{key:'buyer',label:'구매자명',width:'88px'}]:[]),
  {key:'recipient',label:'수취인',width:'96px'},{key:'time',label:isDispatch?'주문 / 발주확인':'발송 / 배송완료',width:'156px'},
  {key:'tracking',label:isDispatch?'발송·인계':'배송·수령 확인',width:isDispatch?'132px':'206px'},...(rowTracking?[{key:'dispatch',label:'택배사 · 운송장',width:'176px'}]:[]),
  ...(delayNoticeColumn?[{key:'notice',label:'지연 안내 결과',width:'128px',required:showDelayNotice,defaultVisible:showDelayNotice}]:[]),...(delayNoteColumn?[{key:'delay',label:'지연 메모',width:'260px'}]:[]),
  {key:'method',label:'배송 방식',width:isDispatch?'96px':'84px',...(isDispatch?{}:{defaultVisible:false})}];
 /* S36-X04: 택배가 섞인 발송 대기 목록에서는 출고지시 전체 선택을 지키려고 택배 외 행에 체크칸을 두지 않는다. 작업 막대에서 방법별 필터로 모아 고르게 안내한다. */
 const nonParcelReady=isDispatch&&filters.tab==='ready'&&!shipmentConsoleNonParcelBatch('ready',filters.method)
  ?rows.filter(row=>row.status==='ready'&&row.delivery&&['quick','pickup','direct','freight'].includes(row.delivery.method)):[];
 const nonParcelMethods=[...new Set(nonParcelReady.map(row=>row.delivery!.method))];
 const workbarNote=nonParcelReady.length?<span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-non-parcel-hint="">
  택배 외 배송 건 {nonParcelReady.length}건은 여기서 고를 수 없습니다. 배송방법 필터로 모아 [택배 외 발송처리]로 처리합니다:
  {nonParcelMethods.map(method=><Link className={CELL_LINK} href={shipmentConsoleHref('dispatch',filters,{method,page:1})} key={method}>{DELIVERY_METHOD_LABELS[method]} {nonParcelReady.filter(row=>row.delivery!.method===method).length}건만 보기</Link>)}
 </span>:null;
 const gridRows=rows.map(row=>{
  const parcel=isParcelShipment(row);const tracking=parcel?orderShipment(carriers,row.carrier,row.trackingNumber):null;
  const methodLabel=row.delivery?DELIVERY_METHOD_LABELS[row.delivery.method]:parcel?'택배':'확인 필요';
  const detailHref=adminOrderDetailHrefFromBack(row.orderId,shipmentConsoleHref(surface,filters));
  const transitDays=!isDispatch&&row.status==='shipping'&&row.shippedAt?daysSince(row.shippedAt,now):0;
  /* 며칠 묵은 주문이 표에서 바로 보이게 한다. 신규주문은 주문한 날부터 센다. */
  const waitingDays=isDispatch&&row.status==='ready'?daysSince(row.confirmedAt??row.createdAt,now):0;
  const delayDays=isDispatch?dispatchDelayDays(row,now):null;
  const reference=commerceReferenceLabel(row.id, row.shipmentNumber);
  /* 운송장 칸은 지금 발송할 수 있는 택배 건(예약 재고 할당·제작 완료)에만 둔다. 막힌 이유는 옆 발송·인계 칸이 보인다. */
  const trackingCell=!rowTracking?null:row.status==='ready'&&parcel&&shipmentConsoleSelectable(row,'ready')
   ?<ShipmentConsoleRowTracking key="dispatch" carriers={activeCarriers} defaultCarrier={origins.find(origin=>origin.id===row.originId)?.defaultCarrier??null} reference={reference} shipmentId={row.id}/>
   :<span key="dispatch" className={CELL_NOTE}>{parcel?'예약 재고 할당·제작 완료 뒤 입력합니다.':'택배 외 배송 — 배송 방법·주문 상세에서 처리합니다.'}</span>;
  /* 출고지시 전달 전 준비 건만 방법을 바꿀 수 있다(배송없음·디지털은 구매 때 정한 방식). 정확한 판정은 팝업이 서버에서 읽는다. */
  const methodChangeable=isDispatch&&row.status==='ready'&&!row.exportedAt&&!row.trackingNumber&&row.delivery?.method!=='none'&&row.delivery?.method!=='digital';
  return {id:row.id,selectable:shipmentConsoleRowSelectable(row,filters.tab,filters.method),selectLabel:`배송 건 ${reference} 선택`,cells:[
   /* S36-075: 배송건번호·주문번호를 누르면 같은 목록 위에 주문 상세 팝업을 연다(닫으면 목록·선택·스크롤 그대로). 새 탭 열기는 옆 아이콘(보조)이다. */
   <div key="id" className={CELL_STACK}>{canReadOrders?<OrderPreviewLink
    href={adminOrderPreviewHref(currentHref,row.orderId)}
    label={`배송 건 ${reference}의 주문 상세 팝업 열기`}
   >{reference}</OrderPreviewLink>:<span className="font-medium tabular-nums">{reference}</span>}<span className="flex items-center gap-1">{canReadOrders?<OrderPreviewLink
    className={`${CELL_NOTE} tabular-nums whitespace-nowrap underline-offset-4 hover:underline`}
    href={adminOrderPreviewHref(currentHref,row.orderId)}
    label={`주문 ${orderReferenceLabel(row.orderId, row.orderNumber)} 상세 팝업 열기`}
   >주문 {orderReferenceLabel(row.orderId, row.orderNumber)}</OrderPreviewLink>:<small className={`${CELL_NOTE} tabular-nums whitespace-nowrap`}>주문 {orderReferenceLabel(row.orderId, row.orderNumber)}</small>}
    {canReadOrders?<OrderPreviewNewTabLink href={detailHref} label={`주문 ${orderReferenceLabel(row.orderId, row.orderNumber)} 상세 열기 (새 탭)`}/>:null}</span>{row.pack?<AdminStatusBadge tone="neutral">합포장 {row.pack.id.slice(-8).toUpperCase()} · {row.pack.count}건</AdminStatusBadge>:null}</div>,
   /* 출고 전 대조에 쓰는 칸이라 품목·옵션·수량을 줄이지 않는다(10/14 회의 요청). 긴 이름은 잘지 않고 줄을 바꾸며, 수량은 첫 줄 오른쪽에 둔다. */
   <ul key="items" className="flex min-w-44 flex-col gap-1">{row.items.map(item=><li key={item.id}><span className="flex min-w-0 items-baseline gap-1"><span className="min-w-0 flex-1 wrap-anywhere">{item.name}{item.variantName?` · ${item.variantName}`:''}</span><span className="shrink-0 whitespace-nowrap">× {item.qty}</span></span><GoodsCustomInputsSummary selection={item.customInputs} /></li>)}</ul>,
   <span key="origin" className={`${CELL_ONE_LINE} max-w-12`} title={row.originName}>{row.originName}</span>,...(canReadOrders?[<span key="buyer" className={`${CELL_ONE_LINE} max-w-16`} title={row.buyerName}>{row.buyerName}</span>]:[]),<span key="recipient" className={`${CELL_ONE_LINE} max-w-18`} title={row.recipientName||undefined}>{row.recipientName||'미기록'}</span>,
   <div key="time" className={`${CELL_STACK} tabular-nums whitespace-nowrap`}>{formatOrderDateTime(isDispatch?row.createdAt:row.shippedAt??row.createdAt)}{isDispatch&&!row.confirmedAt?<AdminStatusBadge tone="warning">발주확인 전</AdminStatusBadge>:<small className={CELL_NOTE}>{(isDispatch?row.confirmedAt:row.deliveredAt)?formatOrderDateTime((isDispatch?row.confirmedAt:row.deliveredAt)!):'배송완료 전'}</small>}</div>,
   !parcel?<div key="method-action" className={CELL_STACK}>{row.delivery?<AdminStatusBadge tone={statusTone('shipment',row.status)}>{deliveryStatusLabel(row.delivery.method,row.status)}</AdminStatusBadge>:<AdminStatusBadge tone="warning">배송 방식 확인 필요</AdminStatusBadge>}
    {/* 주문 조회 권한이 있으면 주문 상세에서 처리한다. 출고 전용 운영자(1014-084)는 택배 외 실물 배송의 인계·수령을 이 화면의 팝업에서 기록하고,
        구매자 내려받기로 끝나는 디지털 파일이나 방식을 아직 알 수 없는 건은 주문 상세를 열 권한이 없으니 글자로만 둔다. */}
    {canReadOrders?<Link className={CELL_LINK} href={detailHref} target="_blank" rel="noopener noreferrer">{row.delivery?.method==='digital'?'디지털 파일 제공 이력':`${methodLabel} 인계·수령 확인`}</Link>
     :row.delivery&&row.delivery.method!=='digital'?<DispatchDeliveryRecordButton shipmentId={row.id} shipmentNumber={row.shipmentNumber} label={`${methodLabel} 인계·수령 확인`}/>
     :<span className={CELL_NOTE}>{row.delivery?.method==='digital'?'디지털 파일 제공 이력':`${methodLabel} 인계·수령 확인`}은 주문 상세에서 합니다.</span>}</div>:
    isDispatch?<div key="export" className={CELL_STACK}>{delayDays!==null?<AdminStatusBadge tone="danger">발송 지연 · {delayDays}일째</AdminStatusBadge>:null}
      {filters.tab==='new'?<span className={waitingDays>=LONG_WAIT_DAYS?'text-xs font-semibold text-warning tabular-nums':CELL_NOTE}>{waitingDays?`${waitingDays}일째 대기`:'오늘 주문'}</span>:<AdminStatusBadge tone={row.exportedAt?'success':'neutral'}>{row.exportedAt?'출고지시 전달':'내보내기 전'}</AdminStatusBadge>}
      {row.preorderReady===false?<AdminStatusBadge tone="warning">예약 재고 할당 필요</AdminStatusBadge>:null}{row.production&&row.production.count>0?<p>{canReadOrders?<Link className={CELL_LINK} href={detailHref}>주문제작 {row.production.completed}/{row.production.count}건 완료{row.production.ready?'':' · 제작 완료 전 발송 불가'}</Link>:<span>주문제작 {row.production.completed}/{row.production.count}건 완료{row.production.ready?'':' · 제작 완료 전 발송 불가'}</span>}</p>:null}</div>:
    <div key="tracking" className={CELL_STACK}>{transitDays>=LONG_TRANSIT_DAYS?<AdminStatusBadge tone="warning">{transitDays}일째 배송 중</AdminStatusBadge>:<AdminStatusBadge tone={statusTone('shipment',row.status)}>{shipmentStatusLabel(row.status)}</AdminStatusBadge>}{tracking?<a className={`${CELL_LINK} tabular-nums whitespace-nowrap`} href={tracking.trackingUrl} target="_blank" rel="noreferrer noopener">{tracking.carrierLabel} {tracking.trackingNumber}</a>:<AdminStatusBadge tone="warning">운송장 확인 필요</AdminStatusBadge>}</div>,
   ...(trackingCell?[trackingCell]:[]),
   ...(delayNoticeColumn?[<div key="notice" className={CELL_STACK}><AdminStatusBadge tone={row.delayNotice?statusTone('delayNotice',row.delayNotice.status):'warning'}>{shipmentDelayNoticeLabel(row.delayNotice?.status)}</AdminStatusBadge>
    {row.delayNotice?.requestedAt?<><small className={CELL_NOTE}>앱 {ORDER_DELAY_STATUS_LABELS[row.delayNotice.inAppStatus??'prepared']} · 이메일 {ORDER_DELAY_STATUS_LABELS[row.delayNotice.emailStatus??'unknown']}</small><small className={`${CELL_NOTE} tabular-nums`}>{formatOrderDateTime(row.delayNotice.requestedAt)}</small></>:null}</div>]:[]),
   ...(delayNoteColumn?[<DispatchDelayNoteForm key="delay" orderId={row.orderId} reference={orderReferenceLabel(row.orderId, row.orderNumber)} note={row.delayReason?{reason:row.delayReason,expectedShipDate:row.expectedShipDate,updatedAt:row.updatedAt}:null}/>]:[]),
   methodChangeable?<div key="method" className={CELL_STACK}><span>{methodLabel}</span><ShipmentConsoleMethodButton reference={reference} shipmentId={row.id}/></div>:<span key="method">{methodLabel}</span>,
  ]};
 });
 /* 운송장 회신은 발송 대기·지연·배송중 탭의 매일 일이다. 그 탭에서는 목록 머리의 버튼으로 두어 표를 밀지 않고, 신규주문·배송완료 탭에서는 표 아래로 비킨다. 표가 100행까지 길어져 어느 탭이든 표 위·아래 한쪽에만 고정하지 않는다.
    위치는 CSS order로만 바꾼다. React 트리의 자리가 탭마다 달라지면 패널이 다시 마운트돼 붙여넣은 내용·고른 파일·실패 보고가 사라진다. */
 const importFirst=filters.tab==='ready'||filters.tab==='delayed'||filters.tab==='transit';
 const importPanel=<DispatchTrackingImportPanel carriers={carriers} originId={filters.originId} shippingHref={shipmentConsoleHref('shipping',filters,{tab:'transit',page:1})}/>;
 const trackingImport=<div className={importFirst?'min-w-0 has-[details[open]]:basis-full':'order-last min-w-0 basis-full'} data-shipment-import-slot=""><details className={importFirst?'group':'group rounded-lg border'} data-shipment-import="">
   <summary className={importFirst?`${buttonVariants({variant:'outline'})} cursor-pointer list-none [&::-webkit-details-marker]:hidden`:'flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 font-medium [&::-webkit-details-marker]:hidden'} data-slot={importFirst?'button':undefined}>운송장 가져오기 · 창고 회신 등록<ChevronDown aria-hidden="true" className={importFirst?'transition-transform group-open:rotate-180':'size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180'}/></summary>
   <div className={importFirst?'mt-2 rounded-lg border':undefined}>{importPanel}</div>
  </details></div>;
 /* 오래 배송 중인 건수는 지금 읽어 온 줄로 센다(기본 정렬이 오래된 순이라 위 페이지에 모인다). 새 집계를 만들지 않으므로 다음 쪽이 있으면 이 페이지 기준이라고 밝힌다. */
 const longTransit=!isDispatch&&filters.tab==='transit'?rows.filter(row=>row.status==='shipping'&&row.shippedAt&&daysSince(row.shippedAt,now)>=LONG_TRANSIT_DAYS).length:null;
 return <section className="flex min-w-0 flex-col gap-4 text-sm" data-shipment-console={surface}>
  <SalesGuide title={isDispatch?'신규주문 확인부터 출고지별 발송까지 처리할 수 있습니다.':'발송한 배송 건과 실제 배송완료 상태를 확인할 수 있습니다.'}>
   <p>{isDispatch&&hasParcelRows?'순서: 대상 선택 → 출고지시 내보내기 → 창고 회신 → 운송장 등록(회신 파일 또는 발송 대기 행의 택배사·운송장 칸). 배송 방법은 행의 [배송 방법]에서 그 출고지에 켜진 방법으로 바꾸고, 고객이 고른 방법과 다르면 사유를 남깁니다. 퀵·직접배송·화물배송은 [택배 외 발송처리]로 고른 건의 실제 인계를 한 번에 기록하고, 수령 완료와 방문수령·배송없음은 주문 상세에서 확인합니다.':isDispatch?'택배 외 배송 건은 행의 [배송 방법]에서 인계를 기록하거나, 배송방법 필터로 한 방법만 모은 뒤 [택배 외 발송처리]로 한 번에 기록합니다. 수령 완료는 주문 상세에서 확인하고, 디지털 파일은 구매자의 다운로드 제공 이력으로 처리 상태를 확인합니다.':'택배의 실제 도착을 확인해 배송완료로 처리합니다. 택배 외 실물 상품은 주문 상세에서 수령 확인값과 인계 근거를 기록합니다. 디지털 파일은 다운로드 제공 이력으로 확인합니다.'}</p>
   {delayNoticeColumn?<p>지연 안내 결과는 배송 건별 최근 발송 요청의 앱 알림과 이메일 기록입니다. 미리보기만 저장한 안내는 제외합니다. 발송 처리는 앱 알림 기록과 이메일 공급자 접수·발송 상태이며 고객의 수신·열람을 뜻하지 않습니다. 채널별 실패와 결과 불명은 안내 이력에서 확인합니다.</p>:null}
  </SalesGuide>
  <SalesStatusSummary aside={summaryAside} label="배송 처리 단계 · 배송 건 기준" items={SHIPMENT_CONSOLE_TABS[surface].map(tab=>({active:tab.id===filters.tab,label:tab.label,count:data.counts[tab.id],urgent:tab.id==='delayed'&&data.counts.delayed>0,tone:tab.id==='new'?'warning' as const:undefined,icon:tab.id==='transit'?Truck:tab.id==='delivered'?PackageCheck:undefined,href:shipmentConsoleHref(surface,filters,{tab:tab.id,page:1})}))}
   extra={longTransit===null?undefined:<AdminCountCard count={longTransit} icon={TimerOff} label={`${LONG_TRANSIT_DAYS}일 이상 배송`} tone="warning" unit={data.total>rows.length?'건 (이 페이지)':'건'}/>}/>
  {!isDispatch&&registeredCount?<AdminNotice role="status" tone="success">운송장 {registeredCount.toLocaleString('ko-KR')}건을 등록했습니다. 배송 메일은 대기열에서 처리됩니다.</AdminNotice>:null}
  <SalesFilterPanel currentHref={currentHref} id={`sales-${surface}`}
   hiddenFieldExclusions={['delayNotice']}
   date={{from:filters.from,to:filters.to,field:filters.dateField??'ordered',options:SALES_DATE_FIELDS.filter(option=>option.value!=='settled'&&(canReadOrders||option.value!=='paid'))}}
   search={{value:filters.query,field:filters.field??'all',options:canReadOrders?SHIPMENT_SEARCH_FIELDS:SHIPMENT_SEARCH_FIELDS.filter(option=>option.value!=='buyer'),placeholder:canReadOrders?'배송건번호 · 주문번호 · 구매자':'배송건번호 · 주문번호 · 수취인'}}
   resetHref={`/admin/sales/${surface}?tab=${filters.tab}`}
   moreActive={Boolean(filters.method||filters.originId||(canReadOrders&&filters.paymentMethod)||filters.delayNotice)}
   more={<>
   <SalesFilterField label="처리상태" htmlFor="sales-shipment-tab">
    <SalesSelect id="sales-shipment-tab" name="tab" value={filters.tab} options={SHIPMENT_CONSOLE_TABS[surface].map(tab=>({value:tab.id,label:tab.label}))}/>
   </SalesFilterField>
   <SalesFilterField label="배송방법" htmlFor="sales-shipment-method"><SalesSelect id="sales-shipment-method" name="method" value={filters.method??''}
    options={[{value:'',label:'전체'},...FULFILLMENT_METHODS.map(method=>({value:method,label:FULFILLMENT_METHOD_LABELS[method]}))]}/></SalesFilterField>
   <SalesFilterField label="출고지" htmlFor="sales-shipment-origin"><SalesSelect id="sales-shipment-origin" name="originId" value={filters.originId??''}
    options={[{value:'',label:'전체 출고지'},...origins.map(origin=>({value:origin.id,label:origin.name}))]}/></SalesFilterField>
   {canReadOrders?<SalesFilterField label="결제수단" htmlFor="sales-shipment-payment"><SalesSelect id="sales-shipment-payment" name="paymentMethod" value={filters.paymentMethod??''}
    options={[{value:'',label:'전체'},{value:'card',label:'카드'},{value:'bank_transfer',label:'무통장 입금'}]}/></SalesFilterField>:null}
   {delayNoticeColumn?<SalesFilterField label="발송지연 안내여부" htmlFor="sales-shipment-delay-notice"><SalesSelect id="sales-shipment-delay-notice" name="delayNotice" value={filters.delayNotice??''} options={SHIPMENT_DELAY_NOTICE_OPTIONS}/></SalesFilterField>:null}
   </>}/>
  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-3 rounded-xl border bg-card p-4 text-card-foreground" data-sales-results="">
  <div className="min-w-0 flex-1 basis-96">
  <SalesResultsHeader currentHref={currentHref} total={data.total} pageSize={data.pageSize} pageSizes={SHIPMENT_PAGE_SIZES} sort={filters.sort??'oldest'} unit="개 배송 건"
   sortOptions={canReadOrders?SALES_SORT_OPTIONS:SALES_SORT_OPTIONS.filter(option=>option.value!=='amount_high'&&option.value!=='amount_low')}>
   {canManageSales?<AdminListExportButton href={adminListExportHref(surface,currentHref)} total={data.total}/>:null}
  </SalesResultsHeader>
  </div>
  {trackingImport}
  <div className="flex min-w-0 basis-full flex-col gap-3">
  <ShipmentConsoleGrid actorId={actorId} rows={rows} columns={columns} gridRows={gridRows} tab={filters.tab} origins={isDispatch?origins:[]} originId={filters.originId}
   currentHref={shipmentConsoleHref(surface,filters)} readyHref={shipmentConsoleHref('dispatch',filters,{tab:'ready',page:1})} methodFilter={filters.method??null} dispatchActions={isDispatch} canManageSales={canManageSales} workbarNote={workbarNote}/>
  <ConsolePagination label="배송 건 페이지" page={filters.page} pageSize={data.pageSize} total={data.total} hrefForPage={page=>shipmentConsoleHref(surface,filters,{page})}/>
  </div>
  </div>
 </section>;
}
