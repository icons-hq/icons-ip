import Link from 'next/link';
import { AdminPageHeader,AdminSectionCard,AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { ChevronDown, Plus } from 'lucide-react';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { StoreSettingsForm,ShippingCarrierForm,InquiryAutoRepliesForm } from './StoreSettingsForm';
import { CARRIER_SETTINGS_PATH,STORE_SETTINGS_PATH,storeSettingsHistoryRows,type EditableCarrier,type StoreSettingsAudit,type StoreSettingsSection,type StoreSettingsSnapshot } from '@/lib/admin/store-settings';
import { formatOrderDateTime } from '@/lib/orders';
import { StoreBrandingForm } from './StoreBrandingForm';
import { StoreNavigationForm } from './StoreNavigationForm';
import { StoreSettingsRelatedLinks } from './StoreSettingsRelatedLinks';

/* 설정 항목 전환(셸의 콘솔 전환과 같은 링크 탭, ADR-0028). */
const SETTINGS_TAB = 'inline-flex h-7 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-primary-soft-foreground aria-[current=page]:shadow-sm';
const SETTINGS_TABS = 'inline-flex w-fit max-w-full flex-wrap items-center rounded-lg bg-muted p-0.5';

/** 택배사 카드 머리의 사용 상태. */
function carrierStatus(active: boolean) {
  return <AdminStatusBadge tone={statusTone('setting', active ? 'active' : 'inactive')}>{active ? '사용 중' : '비활성'}</AdminStatusBadge>;
}

/* 택배사 목록의 칸 나누기. 머리 줄과 각 줄이 같은 틀을 쓴다. */
const CARRIER_ROW = 'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 md:grid-cols-[minmax(7rem,11rem)_5.5rem_7rem_minmax(0,1fr)_4.25rem]';

/**
 * 택배사를 표처럼 한 줄씩 본다. 줄을 펼치면 그 택배사의 입력 폼이 열린다 — 같은 입력 카드가 세로로 반복되지 않고,
 * 코드·조회 주소 같은 값을 건드리려면 일부러 펼쳐야 한다.
 */
function CarrierList({carriers,canEdit}:{carriers:EditableCarrier[];canEdit:boolean}) {
  return <AdminSectionCard title="택배사 목록" requirement={`${carriers.length}곳`}>
    <div className="min-w-0 overflow-hidden rounded-lg border" data-carrier-list="">
      <div aria-hidden="true" className={`${CARRIER_ROW} h-9 border-b bg-muted text-xs font-semibold text-secondary-foreground`}><span>택배사</span><span>사용 여부</span><span className="hidden md:block">코드</span><span className="hidden md:block">배송조회 URL</span><span className="text-right">관리</span></div>
      {carriers.map(carrier=><details className="group border-b last:border-b-0" key={carrier.code}>
        <summary className={`${CARRIER_ROW} min-h-11 cursor-pointer list-none py-2 hover:bg-primary-soft/40 [&::-webkit-details-marker]:hidden`}>
          <strong className="min-w-0 font-semibold break-words">{carrier.label}</strong>
          {carrierStatus(carrier.active)}
          <code className="hidden min-w-0 font-mono text-xs break-all text-muted-foreground md:block">{carrier.code}</code>
          <span className="hidden min-w-0 text-xs break-all text-muted-foreground md:block">{carrier.trackingUrlTemplate}</span>
          {/* 줄 전체가 펼치는 자리다(버튼을 겹치지 않는다) — 다른 목록의 수정 버튼과 같은 모양만 입힌다. */}
          <span className={`${buttonVariants({size:'xs',variant:'outline'})} justify-self-end`} data-slot="button">{canEdit?'수정':'보기'}<ChevronDown aria-hidden="true" className="transition-transform group-open:rotate-180"/></span>
        </summary>
        <div className="border-t bg-muted/30 p-4"><ShippingCarrierForm carrier={carrier} canEdit={canEdit}/></div>
      </details>)}
    </div>
    {canEdit?<details className="group rounded-lg border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm font-medium hover:bg-muted [&::-webkit-details-marker]:hidden"><Plus aria-hidden="true" className="size-4"/>택배사 추가<ChevronDown aria-hidden="true" className="ml-auto size-3.5 text-muted-foreground transition-transform group-open:rotate-180"/></summary>
      <div className="border-t p-4"><ShippingCarrierForm canEdit/></div>
    </details>:null}
  </AdminSectionCard>;
}

function historyLabel(target: string) {
  return target.startsWith('shipping_carriers:')?'택배사 변경':target==='store_settings:business'?'사업자·CS 변경':target==='store_settings:bank_transfer'?'무통장 계좌 변경':target==='store_settings:inquiry_auto_replies'?'문의 자동 안내 변경':target==='store_settings:branding'?'스토어 브랜드·SNS 변경':target==='store_settings:navigation'?'공개 메뉴 변경':'배송·출고지 변경';
}

export function StoreSettingsScreen({settings,carriers,history,canEdit,section,carrierMode=false,brandingOperationId='',navigationOperationId='',sections=['business','bank_transfer','inquiry_auto_replies','branding','navigation'],canViewCarriers=true}:{settings:StoreSettingsSnapshot;carriers:EditableCarrier[];history:StoreSettingsAudit[];canEdit:boolean;section:StoreSettingsSection;carrierMode?:boolean;brandingOperationId?:string;navigationOperationId?:string;sections?:StoreSettingsSection[];canViewCarriers?:boolean}) {
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="store-settings">
    <AdminPageHeader title={carrierMode?'택배사 관리':'판매자 정보 관리'} description="권한이 있는 설정을 조회하고 변경합니다. 저장한 내용은 다음 조회부터 반영됩니다."/>
    <nav aria-label="설정 항목" className={SETTINGS_TABS}>
      {sections.includes('business') ? <Link className={SETTINGS_TAB} href={`${STORE_SETTINGS_PATH}?section=business`} aria-current={!carrierMode&&section==='business'?'page':undefined}>사업자·CS 연락처</Link> : null}
      {sections.includes('bank_transfer') ? <Link className={SETTINGS_TAB} href={`${STORE_SETTINGS_PATH}?section=bank_transfer`} aria-current={!carrierMode&&section==='bank_transfer'?'page':undefined}>무통장 계좌</Link> : null}
      {sections.includes('inquiry_auto_replies') ? <Link className={SETTINGS_TAB} href={`${STORE_SETTINGS_PATH}?section=inquiry_auto_replies`} aria-current={!carrierMode&&section==='inquiry_auto_replies'?'page':undefined}>문의 자동 안내</Link> : null}
      {sections.includes('branding') ? <Link className={SETTINGS_TAB} href={`${STORE_SETTINGS_PATH}?section=branding`} aria-current={!carrierMode&&section==='branding'?'page':undefined}>스토어 브랜드·SNS</Link> : null}
      {sections.includes('navigation') ? <Link className={SETTINGS_TAB} href={`${STORE_SETTINGS_PATH}?section=navigation`} aria-current={!carrierMode&&section==='navigation'?'page':undefined}>메뉴 관리</Link> : null}
      {canViewCarriers && carrierMode ? <Link className={SETTINGS_TAB} href={CARRIER_SETTINGS_PATH} aria-current="page">택배사</Link> : null}
    </nav>
    {/* 택배사는 배송관리 메뉴의 화면이다 — 이 화면의 탭처럼 보이지 않게 나가는 링크로 둔다. */}
    {canViewCarriers && !carrierMode ? <StoreSettingsRelatedLinks label="다른 설정" links={[{ href: CARRIER_SETTINGS_PATH, label: '택배사 관리' }]}/> : null}
    {carrierMode?<CarrierList carriers={carriers} canEdit={canEdit}/>:section==='branding'?<AdminSectionCard title="스토어 브랜드·SNS"><StoreBrandingForm settings={settings} canEdit={canEdit} operationId={brandingOperationId}/></AdminSectionCard>:section==='navigation'?<AdminSectionCard title="메뉴 관리"><StoreNavigationForm settings={settings} canEdit={canEdit} operationId={navigationOperationId}/></AdminSectionCard>:section==='inquiry_auto_replies'?<AdminSectionCard title="문의 자동 안내"><InquiryAutoRepliesForm settings={settings} canEdit={canEdit}/></AdminSectionCard>:<AdminSectionCard title={section==='business'?'사업자·CS 연락처':'무통장 계좌 표시값'}><StoreSettingsForm key={section} section={section} settings={settings} canEdit={canEdit}/></AdminSectionCard>}
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
    <CarrierList carriers={carriers} canEdit={canEdit} />
    {history.length ? <AdminSectionCard title="최근 변경 이력"><ol className="flex flex-col divide-y" data-settings-history="">{history.map(entry => <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0" key={entry.id}>
      <p><time className="tabular-nums" dateTime={entry.createdAt}>{formatOrderDateTime(entry.createdAt)}</time> · {entry.actorName}</p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground [overflow-wrap:anywhere]">{storeSettingsHistoryRows(entry).map(row => <li key={row.key}>{row.label}: {row.before || '빈 값'} → {row.after || '빈 값'}</li>)}</ul>
    </li>)}</ol></AdminSectionCard> : null}
  </div>;
}
