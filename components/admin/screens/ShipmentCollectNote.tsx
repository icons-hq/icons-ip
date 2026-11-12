import { krw } from '@/lib/format';
import { SHIPMENT_COLLECTOR_LABELS, type ShipmentCollectSummary } from '@/lib/admin/shipment-collect';

/**
 * 발송·배송현황 행의 착불 표시(읽기 전용). 창고·택배사가 수령인에게 받을 착불 배송비를 보이고, 펼치면 출고지시 파일의 배송 운영 안내와
 * 같은 착불 수납 주체·수납 방법·고객 안내·착불 환급 문의를 보인다. 출고 전용 운영자에게도 보인다(2026-11-12 "착불 금액은 보이게").
 * 수납·환급 기록과 합포장 관리는 주문 상세·합포장 관리(판매 관리 권한)에서 한다.
 */
export function ShipmentCollectNote({ collect }: { collect: ShipmentCollectSummary }) {
  return <details className="text-xs" data-shipment-collect="">
    <summary className="cursor-pointer tabular-nums">착불 배송비 {krw(collect.collectFee)}</summary>
    {collect.collector
      ? <dl className="mt-1 grid gap-0.5 text-muted-foreground">{SHIPMENT_COLLECTOR_LABELS.map(([key, label]) => <div className="wrap-anywhere" key={key}><dt className="inline font-medium text-foreground">{label}</dt> <dd className="inline">{collect.collector![key]}</dd></div>)}</dl>
      : <p className="mt-1 text-muted-foreground">이 주문에는 착불 수납 정보 기록이 없습니다.</p>}
  </details>;
}
