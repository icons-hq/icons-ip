import Link from 'next/link';
import { SHIPPING_REGIONS_PATH, type ShippingRegionExpiryState } from '@/lib/admin/shipping-regions';
import { formatOrderDateTime } from '@/lib/orders';
import { AdminSectionCard, AdminStatusBadge } from './console/AdminKit';

export function ShippingRegionExpiryNotice({ state }: { state?: ShippingRegionExpiryState }) {
  if (!state || (!state.unavailable && !state.warnings.length)) return null;
  return <AdminSectionCard title="지역 배송 정책 확인">
    {state.unavailable ? <p role="alert">지역 배송 정책을 불러오지 못했습니다. 만료 여부를 확인할 수 없으므로 설정을 다시 확인해주세요.</p> : <ul>
      {state.warnings.map((warning) => <li key={warning.id}>
        <AdminStatusBadge tone={warning.status === 'expired' ? 'danger' : 'warning'}>{warning.status === 'expired' ? '정책 만료' : '7일 이내 만료'}</AdminStatusBadge>{' '}
        {warning.originName} · {warning.carrierLabel} · {warning.name} · 버전 {warning.version} · 종료 <time dateTime={warning.endsAt}>{formatOrderDateTime(warning.endsAt)}</time>
      </li>)}
    </ul>}
    <p>지역 정책이 만료되면 해당 출고지의 새 주문이 차단될 수 있습니다. 실제 계약과 다음 정책의 적용 기간을 확인해주세요. <Link href={SHIPPING_REGIONS_PATH}>지역 배송 정책 관리</Link></p>
  </AdminSectionCard>;
}
