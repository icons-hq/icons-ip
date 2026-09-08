import Link from 'next/link';
import { AdminPageHeader,AdminSectionCard } from '@/components/admin/console/AdminKit';
import { StoreSettingsForm,ShippingCarrierForm } from './StoreSettingsForm';
import { CARRIER_SETTINGS_PATH,STORE_SETTINGS_PATH,storeSettingsHistoryRows,type EditableCarrier,type StoreSettingsAudit,type StoreSettingsSection,type StoreSettingsSnapshot } from '@/lib/admin/store-settings';
import { formatOrderDateTime } from '@/lib/orders';

export function StoreSettingsScreen({settings,carriers,history,canEdit,section,carrierMode=false}:{settings:StoreSettingsSnapshot;carriers:EditableCarrier[];history:StoreSettingsAudit[];canEdit:boolean;section:StoreSettingsSection;carrierMode?:boolean}) {
  return <section className="wc-admin-kit admin-store-settings">
    <AdminPageHeader title={carrierMode?'택배사 관리':'사업자·결제 표시 설정'} description="직원은 조회하고 관리자는 저장할 수 있습니다. 저장한 내용은 다음 조회부터 반영됩니다."/>
    <nav aria-label="설정 항목" className="wc-admin-kit__actions">
      <Link href={`${STORE_SETTINGS_PATH}?section=business`} aria-current={!carrierMode&&section==='business'?'page':undefined}>사업자·CS 연락처</Link>
      <Link href={`${STORE_SETTINGS_PATH}?section=bank_transfer`} aria-current={!carrierMode&&section==='bank_transfer'?'page':undefined}>무통장 계좌</Link>
      <Link href={CARRIER_SETTINGS_PATH} aria-current={carrierMode?'page':undefined}>택배사</Link>
    </nav>
    {carrierMode?<>
      {carriers.map(carrier=><AdminSectionCard key={carrier.code} title={`${carrier.label} · ${carrier.active?'사용 중':'비활성'}`}><ShippingCarrierForm carrier={carrier} canEdit={canEdit}/></AdminSectionCard>)}
      {canEdit?<AdminSectionCard title="택배사 추가"><ShippingCarrierForm canEdit/></AdminSectionCard>:null}
    </>:<AdminSectionCard title={section==='business'?'사업자·CS 연락처':'무통장 계좌 표시값'}><StoreSettingsForm key={section} section={section} settings={settings} canEdit={canEdit}/></AdminSectionCard>}
    <AdminSectionCard title="최근 변경 이력">
      {history.length?<ol className="admin-store-settings__history">{history.map(entry=><li key={entry.id}>
        <time dateTime={entry.createdAt}>{formatOrderDateTime(entry.createdAt)}</time> · {entry.actorName} · {entry.target.startsWith('shipping_carriers:')?'택배사 변경':entry.target==='store_settings:business'?'사업자·CS 변경':entry.target==='store_settings:bank_transfer'?'무통장 계좌 변경':'배송·출고지 변경'}
        <details><summary>변경 내용</summary><table><caption className="sr-only">설정 변경 전후</caption><thead><tr><th>항목</th><th>이전</th><th>변경 후</th></tr></thead><tbody>{storeSettingsHistoryRows(entry).map(row=><tr key={row.key}><th>{row.label}</th><td>{row.before||"빈 값"}</td><td>{row.after||"빈 값"}</td></tr>)}</tbody></table></details>
      </li>)}</ol>:<p>변경 이력이 없습니다.</p>}
    </AdminSectionCard>
  </section>;
}
