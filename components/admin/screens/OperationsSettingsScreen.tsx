import Link from 'next/link';
import { ArrowRight, BookOpen } from 'lucide-react';
import { ShippingRegionExpiryNotice } from '../ShippingRegionExpiryNotice';
import type { ShippingRegionExpiryState } from '@/lib/admin/shipping-regions';
import { AdminNotice, AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { OperationsContactForm } from './OperationsContactForm';
import { OPERATIONS_CONTACT_FIELDS, operationsContactValues, type OperationsContact, type OperationsContactHistory } from '@/lib/admin/operations-contacts';
import { formatOrderDateTime } from '@/lib/orders';
import type { OperationsCardKey, OperationsReadiness } from './OperationsSettingsReadiness';

const INPUT_LINKS: { label: string; description: string; href: string; adminOnly?: boolean; readiness?: OperationsCardKey }[] = [
  { label: '사업자·CS 연락처', description: '회사 정보와 고객에게 공개할 연락처', href: '/admin/settings/store?section=business', readiness: 'business' },
  { label: '무통장 입금 계좌', description: '은행·계좌번호·예금주', href: '/admin/settings/store?section=bank_transfer', readiness: 'bankTransfer' },
  { label: '출고지·배송비·반품 주소', description: '출고지별 기본료·무료배송 기준·반품지', href: '/admin/settings/origins', readiness: 'origins' },
  { label: '지역 추가 배송비', description: '제주·도서산간 지역표와 계약 추가료', href: '/admin/settings/shipping-regions', readiness: 'regions' },
  { label: '택배사', description: '계약 택배사와 배송조회 주소', href: '/admin/settings/carriers', readiness: 'carriers' },
  { label: '배송·반품 안내', description: '상품에 적용할 배송 안내 템플릿', href: '/admin/settings/shipping-notices', readiness: 'notices' },
  { label: '상품·ERP·공급가(매입단가)·KC', description: '상품을 선택해 옵션 정보와 증빙을 입력', href: '/admin/catalog/goods' },
  { label: '카테고리·ERP 분류', description: '고객 카테고리와 ERP 분류 매핑', href: '/admin/catalog/categories' },
  { label: '쿠폰', description: '지급·사용 조건과 적용 상품', href: '/admin/sales/coupons' },
  { label: '적립금 정책', description: '적립·사용 기준과 정책 승인 근거', href: '/admin/settings/store-credits', adminOnly: true, readiness: 'storeCredits' },
];

const contactTitle = (contact: OperationsContact) => contact.scope === 'operations' ? '운영 총괄' : `${contact.originName} 출고지`;
const contactAnchor = (contact: OperationsContact) => `contact-${contact.originId ?? 'operations'}`;
const filledCount = (contact: OperationsContact) => Object.values(operationsContactValues(contact)).filter(value => value.trim()).length;

function changedFieldLabels(fields: string[]): string {
  return fields.filter(field => Object.hasOwn(OPERATIONS_CONTACT_FIELDS, field))
    .map(field => OPERATIONS_CONTACT_FIELDS[field as keyof typeof OPERATIONS_CONTACT_FIELDS].label).join(', ');
}

export function OperationsSettingsScreen({ contacts, history, canEdit, shippingRegionExpiry, readiness = {} }: { contacts: OperationsContact[]; history: OperationsContactHistory[]; canEdit: boolean; shippingRegionExpiry?: ShippingRegionExpiryState; readiness?: OperationsReadiness }) {
  const links = INPUT_LINKS.filter(item => !item.adminOnly || canEdit);
  const known = links.flatMap(item => item.readiness && readiness[item.readiness] ? [readiness[item.readiness]!] : []);
  const missingContacts = contacts.filter(contact => !filledCount(contact));
  /* 분모 없이 카드 배지와 같은 말로 센다 — '7/7'은 칸이 10개인데 다 끝난 것처럼 읽힌다. */
  const doneCount = known.filter(item => item.done).length;
  const readinessSummary = [`입력 완료 ${doneCount}개`, known.length > doneCount ? `입력 필요 ${known.length - doneCount}개` : '', links.length > known.length ? `화면에서 확인 ${links.length - known.length}개` : ''].filter(Boolean).join(' · ');
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="operations">
    <AdminPageHeader title="운영 준비" description="운영에 필요한 설정을 입력하고, 담당자와 자료 위치를 함께 관리합니다."
      actions={<Link className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" href="/admin/guide/store-settings"><BookOpen aria-hidden="true" />입력 가이드</Link>}/>
    <ShippingRegionExpiryNotice state={shippingRegionExpiry} />
    {/* 이 화면에서 유일하게 사람이 채워야 하는 일감이라 입력 카드보다 위에 둔다. */}
    {missingContacts.length ? <AdminNotice title={`담당자 정보 미입력 ${missingContacts.length}곳`} tone="warning">
      <span className="flex flex-wrap gap-x-3 gap-y-1">{missingContacts.map(contact => <a className="font-medium underline underline-offset-4" href={`#${contactAnchor(contact)}`} key={contactAnchor(contact)}>{contactTitle(contact)}</a>)}</span>
    </AdminNotice> : null}
    <AdminSectionCard status={known.length ? readinessSummary : undefined} title="운영 정보 입력" summary="항목을 선택하면 해당 입력 화면으로 이동합니다. 실제 계약과 자료를 확인한 뒤 저장해주세요.">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{links.map(item => {
        const state = item.readiness ? readiness[item.readiness] : undefined;
        return <li className="min-w-0" key={item.href}>
          <Link className="group/input flex h-full min-w-0 flex-col gap-1 rounded-lg border bg-background p-3 transition-colors hover:bg-muted" href={item.href}>
            <span className="flex min-w-0 items-start justify-between gap-2">
              <strong className="text-sm font-semibold">{item.label}</strong>
              {state ? <AdminStatusBadge className="shrink-0" tone={state.done ? 'success' : 'warning'}>{state.done ? '입력 완료' : '입력 필요'}</AdminStatusBadge> : <AdminStatusBadge className="shrink-0" tone="neutral">화면에서 확인</AdminStatusBadge>}
            </span>
            <span className="text-sm text-muted-foreground">{item.description}</span>
            <span className="mt-auto flex min-w-0 items-center justify-between gap-2 pt-1 text-xs">
              <span aria-hidden="true" className={`inline-flex items-center gap-1 font-medium group-hover/input:text-foreground ${state && !state.done ? 'text-primary' : 'text-muted-foreground'}`}>입력 화면 <ArrowRight className="size-3.5" /></span>
              {state ? <span className="truncate text-muted-foreground">{state.detail}</span> : null}
            </span>
          </Link>
        </li>;
      })}</ul>
    </AdminSectionCard>
    <div className="flex flex-col gap-1">
      <h3 className="text-base font-medium">담당자와 자료 위치</h3>
      <p className="text-sm text-muted-foreground">관리자와 직원만 볼 수 있습니다. {canEdit ? '변경할 항목을 입력하고 해당 담당자 정보의 저장 버튼을 눌러주세요.' : '직원은 조회만 가능합니다. 변경은 관리자에게 요청해주세요.'}</p>
      <p className="text-sm text-muted-foreground">자료 위치는 문서 주소나 폴더 경로로 기록합니다. 입력 여부는 담당자 정보 기준이며, 실제 인수 완료 여부는 인수 기록에서 확인합니다.</p>
    </div>
    {contacts.map(contact => {
      const filled = filledCount(contact);
      return <AdminSectionCard id={contactAnchor(contact)} key={`${contact.scope}:${contact.originId ?? 'general'}`} title={contactTitle(contact)}>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <AdminStatusBadge tone={filled === 4 ? 'success' : filled ? 'neutral' : 'warning'}>{filled ? `정보 입력 ${filled}/4` : '담당자 정보 미입력'}</AdminStatusBadge>
          {contact.scope === 'origin' ? <AdminStatusBadge tone={contact.originActive ? 'success' : 'warning'}>{contact.originActive ? '출고지 사용 중' : '출고지 비활성'}</AdminStatusBadge> : null}
          {contact.updatedAt ? <span>최근 저장 <time className="tabular-nums" dateTime={contact.updatedAt}>{formatOrderDateTime(contact.updatedAt)}</time> · {contact.updatedByName ?? '삭제된 운영자'}</span> : null}
        </div>
        <OperationsContactForm contact={contact} canEdit={canEdit}/>
      </AdminSectionCard>;
    })}
    {!contacts.some(contact => contact.scope === 'origin') ? <AdminNotice tone="warning">출고지가 없습니다. <Link className="font-medium underline underline-offset-4" href="/admin/settings/origins">출고지 설정</Link>을 확인해주세요.</AdminNotice> : null}
    <AdminSectionCard title="담당자 정보 변경 이력">
      {history.length ? <ol className="flex flex-col divide-y">{history.map(entry => <li className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0" key={entry.id}>
        <div className="text-xs text-muted-foreground"><time className="tabular-nums" dateTime={entry.createdAt}>{formatOrderDateTime(entry.createdAt)}</time> · {entry.actorName}</div>
        <p>{entry.scope === 'operations' ? '운영 총괄' : `${entry.originName ?? '출고지'} 담당자`} · {changedFieldLabels(entry.changedFields)}</p>
      </li>)}</ol> : <p className="text-muted-foreground">저장된 변경 이력이 없습니다.</p>}
    </AdminSectionCard>
  </div>;
}
