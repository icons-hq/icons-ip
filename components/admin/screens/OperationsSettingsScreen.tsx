import Link from 'next/link';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { OperationsContactForm } from './OperationsContactForm';
import { OPERATIONS_CONTACT_FIELDS, operationsContactValues, type OperationsContact, type OperationsContactHistory } from '@/lib/admin/operations-contacts';
import { formatOrderDateTime } from '@/lib/orders';

const INPUT_LINKS = [
  { label: '사업자·CS 연락처', description: '회사 정보와 고객에게 공개할 연락처', href: '/admin/settings/store?section=business' },
  { label: '무통장 입금 계좌', description: '은행·계좌번호·예금주', href: '/admin/settings/store?section=bank_transfer' },
  { label: '출고지·배송비·반품 주소', description: '출고지별 기본료·무료배송 기준·반품지', href: '/admin/settings/origins' },
  { label: '지역 추가 배송비', description: '제주·도서산간 지역표와 계약 추가료', href: '/admin/settings/shipping-regions' },
  { label: '택배사', description: '계약 택배사와 배송조회 주소', href: '/admin/settings/carriers' },
  { label: '배송·반품 안내', description: '상품에 적용할 배송정보 템플릿', href: '/admin/settings/shipping-notices' },
  { label: '상품·ERP·매입단가·KC', description: '상품을 선택해 옵션 정보와 증빙을 입력', href: '/admin/catalog/goods' },
  { label: '카테고리·ERP 분류', description: '고객 카테고리와 ERP 분류 매핑', href: '/admin/catalog/categories' },
  { label: '쿠폰', description: '지급·사용 조건과 적용 상품', href: '/admin/sales/coupons' },
  { label: '적립금 정책', description: '적립·사용 기준과 정책 승인 근거', href: '/admin/settings/store-credits', adminOnly: true },
];

function changedFieldLabels(fields: string[]): string {
  return fields.filter(field => Object.hasOwn(OPERATIONS_CONTACT_FIELDS, field))
    .map(field => OPERATIONS_CONTACT_FIELDS[field as keyof typeof OPERATIONS_CONTACT_FIELDS].label).join(', ');
}

export function OperationsSettingsScreen({ contacts, history, canEdit }: { contacts: OperationsContact[]; history: OperationsContactHistory[]; canEdit: boolean }) {
  return <section className="wc-admin-kit admin-operations">
    <AdminPageHeader title="운영 준비" description="운영에 필요한 설정을 입력하고, 담당자와 자료 위치를 함께 관리합니다."
      actions={<Link href="/admin/guide/store-settings">입력 가이드</Link>}/>
    <AdminSectionCard title="운영 정보 입력">
      <p className="wc-admin-kit__description">항목을 선택하면 해당 입력 화면으로 이동합니다. 실제 계약과 자료를 확인한 뒤 저장해주세요.</p>
      <ul className="admin-operations__links">{INPUT_LINKS.filter(item => !item.adminOnly || canEdit).map(item => <li key={item.href}>
        <Link href={item.href}><strong>{item.label}</strong><span>{item.description}</span><span className="admin-operations__link-action" aria-hidden="true">입력 화면 →</span></Link>
      </li>)}</ul>
    </AdminSectionCard>
    <div className="admin-operations__intro">
      <h3>담당자와 자료 위치</h3>
      <p>관리자와 직원만 볼 수 있습니다. {canEdit ? '변경할 항목을 입력하고 해당 담당자 정보의 저장 버튼을 눌러주세요.' : '직원은 조회만 가능합니다. 변경은 관리자에게 요청해주세요.'}</p>
      <p>자료 위치는 문서 주소나 폴더 경로로 기록합니다. 입력 여부는 담당자 정보 기준이며, 실제 인수 완료 여부는 인수 기록에서 확인합니다.</p>
    </div>
    {contacts.map(contact => {
      const filled = Object.values(operationsContactValues(contact)).filter(value => value.trim()).length;
      const title = contact.scope === 'operations' ? '운영 총괄' : `${contact.originName} 출고지`;
      return <AdminSectionCard key={`${contact.scope}:${contact.originId ?? 'general'}`} title={title}>
        <div className="admin-operations__meta">
          <AdminStatusBadge>{filled ? `정보 입력 ${filled}/4` : '담당자 정보 미입력'}</AdminStatusBadge>
          {contact.scope === 'origin' ? <AdminStatusBadge tone={contact.originActive ? 'neutral' : 'warning'}>{contact.originActive ? '출고지 사용 중' : '출고지 비활성'}</AdminStatusBadge> : null}
          {contact.updatedAt ? <span>최근 저장 <time dateTime={contact.updatedAt}>{formatOrderDateTime(contact.updatedAt)}</time> · {contact.updatedByName ?? '삭제된 운영자'}</span> : null}
        </div>
        <OperationsContactForm contact={contact} canEdit={canEdit}/>
      </AdminSectionCard>;
    })}
    {!contacts.some(contact => contact.scope === 'origin') ? <p>출고지가 없습니다. <Link href="/admin/settings/origins">출고지 설정</Link>을 확인해주세요.</p> : null}
    <AdminSectionCard title="담당자 정보 변경 이력">
      {history.length ? <ol className="admin-operations__history">{history.map(entry => <li key={entry.id}>
        <div><time dateTime={entry.createdAt}>{formatOrderDateTime(entry.createdAt)}</time> · {entry.actorName}</div>
        <p>{entry.scope === 'operations' ? '운영 총괄' : `${entry.originName ?? '출고지'} 담당자`} · {changedFieldLabels(entry.changedFields)}</p>
      </li>)}</ol> : <p>저장된 변경 이력이 없습니다.</p>}
    </AdminSectionCard>
  </section>;
}
