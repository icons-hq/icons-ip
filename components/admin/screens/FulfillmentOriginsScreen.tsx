import Link from 'next/link';
import { AdminNotice, AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '../console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { ShipmentExportColumnsEditor } from './ShipmentExportColumnsEditor';
import { FulfillmentOriginForm } from './FulfillmentOriginForm';
import type { FulfillmentOrigin, GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import { CARRIER_SETTINGS_PATH, STORE_SETTINGS_PATH, storeSettingsHistoryRows, type EditableCarrier, type StoreSettingsAudit } from '@/lib/admin/store-settings';
import { formatOrderDateTime } from '@/lib/orders';
import { DeliveryPoliciesPanel } from '@/components/admin/DeliveryPoliciesPanel';
import { ShippingCollectContractPanel } from '@/components/admin/ShippingCollectContractPanel';
import { NEW_FULFILLMENT_ORIGIN_TAB, fulfillmentOriginTabHref, selectedFulfillmentOriginTab } from '@/lib/admin/fulfillment-origin-tabs';
export { selectedFulfillmentOriginTab };

/* 출고지 탭(셸의 콘솔 전환과 같은 링크 탭, ADR-0028). */
const ORIGIN_TABS = 'inline-flex w-fit max-w-full flex-wrap items-center rounded-lg bg-muted p-0.5';
const ORIGIN_TAB = 'inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-primary-soft-foreground aria-[current=page]:shadow-sm';
const RELATED_LINK = buttonVariants({ variant: 'outline', size: 'sm' });

/** 출고지 카드 머리의 사용 상태. */
function OriginStatus({ active }: { active: boolean }) {
  return <AdminStatusBadge tone={statusTone('setting', active ? 'active' : 'inactive')}>{active ? '사용 중' : '비활성'}</AdminStatusBadge>;
}

/**
 * 배송정보 관리. 출고지마다 링크형 탭(R22, `?origin=<코드>`)으로 한 번에 한 출고지만 보인다 — 새로고침·주소 공유에도 유지되고
 * Tab 키로 탭을 오간다. 출고지 추가는 편집 권한이 있을 때만 마지막 탭이다. 최근 변경 이력은 탭 아래 공통이다.
 */
export function FulfillmentOriginsScreen({ origins, carriers, history, canEdit, accountId = '', selected }: { origins: FulfillmentOrigin[]; carriers: EditableCarrier[]; history: StoreSettingsAudit[]; canEdit: boolean; accountId?: string; selected?: string | null }) {
  const tab = selected === undefined ? selectedFulfillmentOriginTab(origins, undefined, canEdit) : selected;
  const origin = origins.find(item => item.code === tab);
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="fulfillment-origins">
    <AdminPageHeader title="출고지·배송 정책" description="출고지별 기본 배송비와 운영 조건을 관리합니다. 상품별 배송비·수량 조건과 지역 추가 배송비는 주문서에서 함께 확인합니다." />
    <nav aria-label="설정 항목" className="flex flex-wrap gap-2"><Link className={RELATED_LINK} data-slot="button" href={STORE_SETTINGS_PATH}>사업자·결제 표시 설정</Link><Link className={RELATED_LINK} data-slot="button" href={CARRIER_SETTINGS_PATH}>택배사</Link><Link className={RELATED_LINK} data-slot="button" href="/admin/settings/shipping-regions">지역 추가 배송비</Link></nav>
    {origins.length || canEdit ? <nav aria-label="출고지" className={ORIGIN_TABS}>
      {origins.map(item => <Link key={item.id} aria-current={tab === item.code ? 'page' : undefined} className={ORIGIN_TAB} href={fulfillmentOriginTabHref(item.code)}>{item.name}{item.active ? '' : ' · 비활성'}</Link>)}
      {canEdit ? <Link aria-current={tab === NEW_FULFILLMENT_ORIGIN_TAB ? 'page' : undefined} className={ORIGIN_TAB} href={fulfillmentOriginTabHref(NEW_FULFILLMENT_ORIGIN_TAB)}>출고지 추가</Link> : null}
    </nav> : null}
    {origin ? <AdminSectionCard key={origin.id} summary={<OriginStatus active={origin.active} />} title={origin.name}>
      <FulfillmentOriginForm origin={origin} carriers={carriers} canEdit={canEdit} />
      <ShipmentExportColumnsEditor origin={origin} canEdit={canEdit} />
      <DeliveryPoliciesPanel originId={origin.id} canEdit={canEdit} />
      {canEdit && accountId && <ShippingCollectContractPanel originId={origin.id} accountId={accountId} canEdit />}
    </AdminSectionCard> : null}
    {canEdit && tab === NEW_FULFILLMENT_ORIGIN_TAB ? <AdminSectionCard title="새 출고지" summary="저장하면 새 출고지 탭으로 이동합니다."><FulfillmentOriginForm carriers={carriers} canEdit /></AdminSectionCard> : null}
    <AdminSectionCard title="최근 변경 이력">
      {history.length ? <ol className="flex flex-col divide-y">{history.map((entry) => <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0" key={entry.id}><p className="tabular-nums">{formatOrderDateTime(entry.createdAt)} · {entry.actorName}</p>
        <details className="rounded-lg border"><summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground hover:text-foreground">출고지 변경 내용</summary><div className="border-t"><Table className="table-fixed"><caption className="sr-only">변경 전후</caption><TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-1/4 text-xs text-muted-foreground">항목</TableHead><TableHead className="text-xs text-muted-foreground">이전</TableHead><TableHead className="text-xs text-muted-foreground">변경 후</TableHead></TableRow></TableHeader>
          <TableBody>{storeSettingsHistoryRows(entry).map((row) => <TableRow className="hover:bg-transparent" key={row.key}><TableHead className="h-auto py-2 align-top font-medium whitespace-normal" scope="row">{row.label}</TableHead><TableCell className="align-top whitespace-normal [overflow-wrap:anywhere]">{row.before || '빈 값'}</TableCell><TableCell className="align-top whitespace-normal [overflow-wrap:anywhere]">{row.after || '빈 값'}</TableCell></TableRow>)}</TableBody></Table></div></details>
      </li>)}</ol> : <p className="text-muted-foreground">변경 이력이 없습니다.</p>}
    </AdminSectionCard>
  </div>;
}

export function GoodsOriginSummaryScreen({ origins }: { origins: GoodsFulfillmentOrigin[] }) {
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-origins">
    <AdminPageHeader title="출고지·배송 정책" description="상품에 적용할 출고지와 고객 배송 정보를 확인합니다." />
    {origins.map(origin => <AdminSectionCard key={origin.id} summary={<OriginStatus active={origin.active} />} title={origin.name}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2"><div className="flex flex-col gap-0.5"><dt className="text-xs text-muted-foreground">기본 배송비</dt><dd className="tabular-nums">{origin.baseFee.toLocaleString('ko-KR')}원</dd></div>
        <div className="flex flex-col gap-0.5"><dt className="text-xs text-muted-foreground">무료배송 기준</dt><dd className="tabular-nums">{origin.freeThreshold === null ? '미설정' : `${origin.freeThreshold.toLocaleString('ko-KR')}원 이상`}</dd></div>
        <div className="flex flex-col gap-0.5"><dt className="text-xs text-muted-foreground">기본 택배사</dt><dd>{origin.defaultCarrier ?? '미설정'}</dd></div><div className="flex flex-col gap-0.5"><dt className="text-xs text-muted-foreground">반품 주소</dt><dd className="[overflow-wrap:anywhere]">{origin.returnAddress || '미설정'}</dd></div></dl>
      {origin.returnAddress ? null : <AdminNotice tone="warning">반품 주소가 없으면 이 출고지 상품의 반품을 진행할 수 없습니다.</AdminNotice>}
    </AdminSectionCard>)}
  </div>;
}
