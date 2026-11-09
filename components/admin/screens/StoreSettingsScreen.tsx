import Link from 'next/link';
import { AdminPageHeader,AdminSectionCard,AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { StoreSettingsForm,ShippingCarrierForm,InquiryAutoRepliesForm } from './StoreSettingsForm';
import { CARRIER_SETTINGS_PATH,STORE_SETTINGS_PATH,storeSettingsHistoryRows,type EditableCarrier,type StoreSettingsAudit,type StoreSettingsSection,type StoreSettingsSnapshot } from '@/lib/admin/store-settings';
import { formatOrderDateTime } from '@/lib/orders';
import { StoreBrandingForm } from './StoreBrandingForm';
import { StoreNavigationForm } from './StoreNavigationForm';

/* 설정 항목 전환(셸의 콘솔 전환과 같은 링크 탭, ADR-0028). */
const SETTINGS_TAB = 'inline-flex h-7 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-primary-soft-foreground aria-[current=page]:shadow-sm';
const SETTINGS_TABS = 'inline-flex w-fit max-w-full flex-wrap items-center rounded-lg bg-muted p-0.5';

/** 택배사 카드 머리의 사용 상태. */
function carrierStatus(active: boolean) {
  return <AdminStatusBadge tone={statusTone('setting', active ? 'active' : 'inactive')}>{active ? '사용 중' : '비활성'}</AdminStatusBadge>;
}

function historyLabel(target: string) {
  return target.startsWith('shipping_carriers:')?'택배사 변경':target==='store_settings:business'?'사업자·CS 변경':target==='store_settings:bank_transfer'?'무통장 계좌 변경':target==='store_settings:inquiry_auto_replies'?'문의 자동 안내 변경':target==='store_settings:branding'?'스토어 브랜드·SNS 변경':target==='store_settings:navigation'?'공개 메뉴 변경':'배송·출고지 변경';
}

export function StoreSettingsScreen({settings,carriers,history,canEdit,section,carrierMode=false,brandingOperationId='',navigationOperationId='',sections=['business','bank_transfer','inquiry_auto_replies','branding','navigation'],canViewCarriers=true}:{settings:StoreSettingsSnapshot;carriers:EditableCarrier[];history:StoreSettingsAudit[];canEdit:boolean;section:StoreSettingsSection;carrierMode?:boolean;brandingOperationId?:string;navigationOperationId?:string;sections?:StoreSettingsSection[];canViewCarriers?:boolean}) {
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="store-settings">
    <AdminPageHeader title={carrierMode?'택배사 관리':'운영 설정'} description="권한이 있는 설정을 조회하고 변경합니다. 저장한 내용은 다음 조회부터 반영됩니다."/>
    <nav aria-label="설정 항목" className={SETTINGS_TABS}>
      {sections.includes('business') ? <Link className={SETTINGS_TAB} href={`${STORE_SETTINGS_PATH}?section=business`} aria-current={!carrierMode&&section==='business'?'page':undefined}>사업자·CS 연락처</Link> : null}
      {sections.includes('bank_transfer') ? <Link className={SETTINGS_TAB} href={`${STORE_SETTINGS_PATH}?section=bank_transfer`} aria-current={!carrierMode&&section==='bank_transfer'?'page':undefined}>무통장 계좌</Link> : null}
      {sections.includes('inquiry_auto_replies') ? <Link className={SETTINGS_TAB} href={`${STORE_SETTINGS_PATH}?section=inquiry_auto_replies`} aria-current={!carrierMode&&section==='inquiry_auto_replies'?'page':undefined}>문의 자동 안내</Link> : null}
      {sections.includes('branding') ? <Link className={SETTINGS_TAB} href={`${STORE_SETTINGS_PATH}?section=branding`} aria-current={!carrierMode&&section==='branding'?'page':undefined}>스토어 브랜드·SNS</Link> : null}
      {sections.includes('navigation') ? <Link className={SETTINGS_TAB} href={`${STORE_SETTINGS_PATH}?section=navigation`} aria-current={!carrierMode&&section==='navigation'?'page':undefined}>메뉴 관리</Link> : null}
      {canViewCarriers ? <Link className={SETTINGS_TAB} href={CARRIER_SETTINGS_PATH} aria-current={carrierMode?'page':undefined}>택배사</Link> : null}
    </nav>
    {carrierMode?<>
      {carriers.map(carrier=><AdminSectionCard key={carrier.code} summary={carrierStatus(carrier.active)} title={carrier.label}><ShippingCarrierForm carrier={carrier} canEdit={canEdit}/></AdminSectionCard>)}
      {canEdit?<AdminSectionCard title="택배사 추가"><ShippingCarrierForm canEdit/></AdminSectionCard>:null}
    </>:section==='branding'?<AdminSectionCard title="스토어 브랜드·SNS"><StoreBrandingForm settings={settings} canEdit={canEdit} operationId={brandingOperationId}/></AdminSectionCard>:section==='navigation'?<AdminSectionCard title="메뉴 관리"><StoreNavigationForm settings={settings} canEdit={canEdit} operationId={navigationOperationId}/></AdminSectionCard>:section==='inquiry_auto_replies'?<AdminSectionCard title="문의 자동 안내"><InquiryAutoRepliesForm settings={settings} canEdit={canEdit}/></AdminSectionCard>:<AdminSectionCard title={section==='business'?'사업자·CS 연락처':'무통장 계좌 표시값'}><StoreSettingsForm key={section} section={section} settings={settings} canEdit={canEdit}/></AdminSectionCard>}
    <AdminSectionCard title="최근 변경 이력">
      {history.length?<ol className="flex flex-col divide-y" data-settings-history="">{history.map(entry=><li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0" key={entry.id}>
        <p><time className="tabular-nums" dateTime={entry.createdAt}>{formatOrderDateTime(entry.createdAt)}</time> · {entry.actorName} · <span className="font-medium">{historyLabel(entry.target)}</span></p>
        <details className="group rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground hover:text-foreground">변경 내용</summary>
          <div className="border-t">
            <Table className="table-fixed">
              <caption className="sr-only">설정 변경 전후</caption>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-1/4 text-xs text-muted-foreground">항목</TableHead><TableHead className="text-xs text-muted-foreground">이전</TableHead><TableHead className="text-xs text-muted-foreground">변경 후</TableHead></TableRow></TableHeader>
              <TableBody>{storeSettingsHistoryRows(entry).map(row=><TableRow className="hover:bg-transparent" key={row.key}><TableHead className="h-auto py-2 align-top font-medium whitespace-normal" scope="row">{row.label}</TableHead><TableCell className="align-top whitespace-normal [overflow-wrap:anywhere]">{row.before||"빈 값"}</TableCell><TableCell className="align-top whitespace-normal [overflow-wrap:anywhere]">{row.after||"빈 값"}</TableCell></TableRow>)}</TableBody>
            </Table>
          </div>
        </details>
      </li>)}</ol>:<p className="text-muted-foreground">변경 이력이 없습니다.</p>}
    </AdminSectionCard>
  </div>;
}

/** Carrier management does not need business, bank or storefront settings. */
export function ShippingCarriersScreen({ carriers, history, canEdit }: { carriers: EditableCarrier[]; history: StoreSettingsAudit[]; canEdit: boolean }) {
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="shipping-carriers">
    <AdminPageHeader title="택배사 관리" description="상품과 배송조회에 사용할 택배사를 확인합니다." />
    {carriers.map(carrier => <AdminSectionCard key={carrier.code} summary={carrierStatus(carrier.active)} title={carrier.label}>
      <ShippingCarrierForm carrier={carrier} canEdit={canEdit} />
    </AdminSectionCard>)}
    {canEdit ? <AdminSectionCard title="택배사 추가"><ShippingCarrierForm canEdit /></AdminSectionCard> : null}
    {history.length ? <AdminSectionCard title="최근 변경 이력"><ol className="flex flex-col divide-y" data-settings-history="">{history.map(entry => <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0" key={entry.id}>
      <p><time className="tabular-nums" dateTime={entry.createdAt}>{formatOrderDateTime(entry.createdAt)}</time> · {entry.actorName}</p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground [overflow-wrap:anywhere]">{storeSettingsHistoryRows(entry).map(row => <li key={row.key}>{row.label}: {row.before || '빈 값'} → {row.after || '빈 값'}</li>)}</ul>
    </li>)}</ol></AdminSectionCard> : null}
  </div>;
}
