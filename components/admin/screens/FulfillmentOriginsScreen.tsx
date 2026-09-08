import Link from 'next/link';
import { AdminPageHeader, AdminSectionCard } from '../console/AdminKit';
import { ShipmentExportColumnsEditor } from './ShipmentExportColumnsEditor';
import { FulfillmentOriginForm } from './FulfillmentOriginForm';
import type { FulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import { CARRIER_SETTINGS_PATH, STORE_SETTINGS_PATH, storeSettingsHistoryRows, type EditableCarrier, type StoreSettingsAudit } from '@/lib/admin/store-settings';
import { formatOrderDateTime } from '@/lib/orders';

export function FulfillmentOriginsScreen({ origins, carriers, history, canEdit }: { origins: FulfillmentOrigin[]; carriers: EditableCarrier[]; history: StoreSettingsAudit[]; canEdit: boolean }) {
  return <section className="wc-admin-kit">
    <AdminPageHeader title="출고지·배송 정책" description="출고지별로 배송비를 계산합니다. 무료배송 상품은 기준 금액에서 빼고, 개별 배송비는 상품당 한 번 더합니다." />
    <nav className="wc-admin-kit__actions" aria-label="설정 항목"><Link href={STORE_SETTINGS_PATH}>사업자·결제 표시 설정</Link><Link href={CARRIER_SETTINGS_PATH}>택배사</Link></nav>
    {origins.map((origin) => <AdminSectionCard key={origin.id} title={`${origin.name} · ${origin.active ? '사용 중' : '비활성'}`}>
      <FulfillmentOriginForm origin={origin} carriers={carriers} canEdit={canEdit} />
      <ShipmentExportColumnsEditor origin={origin} canEdit={canEdit} />
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
