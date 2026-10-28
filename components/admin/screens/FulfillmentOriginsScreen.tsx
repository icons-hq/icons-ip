import Link from 'next/link';
import { AdminPageHeader, AdminSectionCard } from '../console/AdminKit';
import { ShipmentExportColumnsEditor } from './ShipmentExportColumnsEditor';
import { FulfillmentOriginForm } from './FulfillmentOriginForm';
import type { FulfillmentOrigin, GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import { CARRIER_SETTINGS_PATH, STORE_SETTINGS_PATH, storeSettingsHistoryRows, type EditableCarrier, type StoreSettingsAudit } from '@/lib/admin/store-settings';
import { formatOrderDateTime } from '@/lib/orders';
import { DeliveryPoliciesPanel } from '@/components/admin/DeliveryPoliciesPanel';
import { ShippingCollectContractPanel } from '@/components/admin/ShippingCollectContractPanel';
import { NEW_FULFILLMENT_ORIGIN_TAB, fulfillmentOriginTabHref, selectedFulfillmentOriginTab } from '@/lib/admin/fulfillment-origin-tabs';
export { selectedFulfillmentOriginTab };

/**
 * 배송정보 관리. 출고지마다 링크형 탭(R22, `?origin=<코드>`)으로 한 번에 한 출고지만 보인다 — 새로고침·주소 공유에도 유지되고
 * Tab 키로 탭을 오간다. 출고지 추가는 편집 권한이 있을 때만 마지막 탭이다. 최근 변경 이력은 탭 아래 공통이다.
 */
export function FulfillmentOriginsScreen({ origins, carriers, history, canEdit, accountId = '', selected }: { origins: FulfillmentOrigin[]; carriers: EditableCarrier[]; history: StoreSettingsAudit[]; canEdit: boolean; accountId?: string; selected?: string | null }) {
  const tab = selected === undefined ? selectedFulfillmentOriginTab(origins, undefined, canEdit) : selected;
  const origin = origins.find(item => item.code === tab);
  return <section className="wc-admin-kit wc-admin-kit__screen">
    <AdminPageHeader title="출고지·배송 정책" description="출고지별 기본 배송비와 운영 조건을 관리합니다. 상품별 배송비·수량 조건과 지역 추가 배송비는 주문서에서 함께 확인합니다." />
    <nav className="wc-admin-kit__actions" aria-label="설정 항목"><Link href={STORE_SETTINGS_PATH}>사업자·결제 표시 설정</Link><Link href={CARRIER_SETTINGS_PATH}>택배사</Link><Link href="/admin/settings/shipping-regions">지역 추가 배송비</Link></nav>
    {origins.length || canEdit ? <nav className="admin-console-tabs" aria-label="출고지">
      {origins.map(item => <Link key={item.id} href={fulfillmentOriginTabHref(item.code)} aria-current={tab === item.code ? 'page' : undefined}>{item.name}{item.active ? '' : ' · 비활성'}</Link>)}
      {canEdit ? <Link href={fulfillmentOriginTabHref(NEW_FULFILLMENT_ORIGIN_TAB)} aria-current={tab === NEW_FULFILLMENT_ORIGIN_TAB ? 'page' : undefined}>출고지 추가</Link> : null}
    </nav> : null}
    {origin ? <AdminSectionCard key={origin.id} title={`${origin.name} · ${origin.active ? '사용 중' : '비활성'}`}>
      <FulfillmentOriginForm origin={origin} carriers={carriers} canEdit={canEdit} />
      <ShipmentExportColumnsEditor origin={origin} canEdit={canEdit} />
      <DeliveryPoliciesPanel originId={origin.id} canEdit={canEdit} />
      {canEdit && accountId && <ShippingCollectContractPanel originId={origin.id} accountId={accountId} canEdit />}
    </AdminSectionCard> : null}
    {canEdit && tab === NEW_FULFILLMENT_ORIGIN_TAB ? <AdminSectionCard title="새 출고지"><p>저장하면 새 출고지 탭으로 이동합니다.</p><FulfillmentOriginForm carriers={carriers} canEdit /></AdminSectionCard> : null}
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
