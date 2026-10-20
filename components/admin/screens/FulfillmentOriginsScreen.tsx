import Link from 'next/link';
import { AdminPageHeader, AdminSectionCard } from '../console/AdminKit';
import { ShipmentExportColumnsEditor } from './ShipmentExportColumnsEditor';
import { FulfillmentOriginForm } from './FulfillmentOriginForm';
import type { FulfillmentOrigin, GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import { CARRIER_SETTINGS_PATH, STORE_SETTINGS_PATH, storeSettingsHistoryRows, type EditableCarrier, type StoreSettingsAudit } from '@/lib/admin/store-settings';
import { formatOrderDateTime } from '@/lib/orders';
import { DeliveryPoliciesPanel } from '@/components/admin/DeliveryPoliciesPanel';
import { ShippingCollectContractPanel } from '@/components/admin/ShippingCollectContractPanel';

export function FulfillmentOriginsScreen({ origins, carriers, history, canEdit, accountId = '' }: { origins: FulfillmentOrigin[]; carriers: EditableCarrier[]; history: StoreSettingsAudit[]; canEdit: boolean; accountId?: string }) {
  return <section className="wc-admin-kit wc-admin-kit__screen">
    <AdminPageHeader title="출고지·배송 정책" description="출고지별 기본 배송비와 운영 조건을 관리합니다. 상품별 배송비·수량 조건과 지역 추가 배송비는 주문서에서 함께 확인합니다." />
    <nav className="wc-admin-kit__actions" aria-label="설정 항목"><Link href={STORE_SETTINGS_PATH}>사업자·결제 표시 설정</Link><Link href={CARRIER_SETTINGS_PATH}>택배사</Link><Link href="/admin/settings/shipping-regions">지역 추가 배송비</Link></nav>
    {origins.map((origin) => <AdminSectionCard key={origin.id} title={`${origin.name} · ${origin.active ? '사용 중' : '비활성'}`}>
      <FulfillmentOriginForm origin={origin} carriers={carriers} canEdit={canEdit} />
      <ShipmentExportColumnsEditor origin={origin} canEdit={canEdit} />
      <DeliveryPoliciesPanel originId={origin.id} canEdit={canEdit} />
      {canEdit && accountId && <ShippingCollectContractPanel originId={origin.id} accountId={accountId} canEdit />}
    </AdminSectionCard>)}
    {canEdit ? <AdminSectionCard title="출고지 추가"><FulfillmentOriginForm carriers={carriers} canEdit /></AdminSectionCard> : null}
    <AdminSectionCard title="최근 변경 이력">
      {history.length ? <ol>{history.map((entry) => <li key={entry.id}>{formatOrderDateTime(entry.createdAt)} · {entry.actorName}
        <details><summary>출고지 변경 내용</summary><table><caption className="sr-only">변경 전후</caption><thead><tr><th>항목</th><th>이전</th><th>변경 후</th></tr></thead>
          <tbody>{storeSettingsHistoryRows(entry).map((row) => <tr key={row.key}><th>{row.label}</th><td>{row.before || '빈 값'}</td><td>{row.after || '빈 값'}</td></tr>)}</tbody></table></details>
      </li>)}</ol> : <p>변경 이력이 없습니다.</p>}
    </AdminSectionCard>
  </section>;
}

export function GoodsOriginSummaryScreen({ origins }: { origins: GoodsFulfillmentOrigin[] }) {
  return <section className="wc-admin-kit wc-admin-kit__screen">
    <AdminPageHeader title="출고지·배송 정책" description="상품에 적용할 출고지와 고객 배송 정보를 확인합니다." />
    {origins.map(origin => <AdminSectionCard key={origin.id} title={`${origin.name} · ${origin.active ? '사용 중' : '비활성'}`}>
      <dl><dt>기본 배송비</dt><dd>{origin.baseFee.toLocaleString('ko-KR')}원</dd>
        <dt>무료배송 기준</dt><dd>{origin.freeThreshold === null ? '미설정' : `${origin.freeThreshold.toLocaleString('ko-KR')}원 이상`}</dd>
        <dt>기본 택배사</dt><dd>{origin.defaultCarrier ?? '미설정'}</dd><dt>반품 주소</dt><dd>{origin.returnAddress || '미설정'}</dd></dl>
    </AdminSectionCard>)}
  </section>;
}
