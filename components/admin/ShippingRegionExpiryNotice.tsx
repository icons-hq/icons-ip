import Link from 'next/link';
import { SHIPPING_REGIONS_PATH, type ShippingRegionExpiryState } from '@/lib/admin/shipping-regions';
import { formatOrderDateTime } from '@/lib/orders';
import { AdminSectionCard, AdminStatusBadge, AdminNotice } from './console/AdminKit';

/**
 * 지역별 추가배송비의 적용 기간이 끝났거나 7일 안에 끝나는 출고지를 알린다(상품 목록·운영 준비). 낱말은 지역별 추가배송비 화면과 같다 —
 * '기간 끝남', 설정 이름과 끝나는 날만 보이고 내부 버전 번호는 보이지 않는다.
 */
export function ShippingRegionExpiryNotice({ state }: { state?: ShippingRegionExpiryState }) {
  if (!state || (!state.unavailable && !state.warnings.length)) return null;
  return <AdminSectionCard title="지역별 추가배송비 확인">
    {state.unavailable ? <AdminNotice role="alert" tone="danger">지역별 추가배송비를 불러오지 못했습니다. 적용 기간이 끝났는지 알 수 없으니 지역별 추가배송비 화면에서 직접 확인해주세요.</AdminNotice> : <ul className="flex flex-col gap-2">
      {state.warnings.map((warning) => <li className="flex flex-wrap items-center gap-x-2 gap-y-1" key={warning.id}>
        <AdminStatusBadge tone={warning.status === 'expired' ? 'danger' : 'warning'}>{warning.status === 'expired' ? '기간 끝남' : '7일 안에 끝남'}</AdminStatusBadge>{' '}
        <span>{warning.originName} · {warning.carrierLabel} · {warning.name} · 종료 <time className="tabular-nums" dateTime={warning.endsAt}>{formatOrderDateTime(warning.endsAt)}</time></span>
      </li>)}
    </ul>}
    <p className="text-muted-foreground">적용 기간이 끝나고 이어서 적용할 설정이 없으면 그 출고지는 새 주문을 받지 못합니다. 끝나기 전에 다음 설정을 만들어 적용해주세요. <Link className="font-medium text-foreground underline underline-offset-4" href={SHIPPING_REGIONS_PATH}>지역별 추가배송비</Link></p>
  </AdminSectionCard>;
}
