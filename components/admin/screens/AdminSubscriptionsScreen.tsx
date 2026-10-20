'use client';
import Link from 'next/link';
import { ConsoleGrid, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { EncryptedWorkbookDownloadButton } from '@/components/admin/EncryptedWorkbookDownloadButton';
import { SalesFilterField, SalesFilterPanel, SalesGuide, SalesSelect } from '@/components/admin/sales/SalesConsole';
import { adminSubscriptionsHref, subscriptionScheduleLabel, type AdminSubscriptionData } from '@/lib/admin/subscriptions';
import { SUBSCRIPTION_PLAN_STATES, SUBSCRIPTION_PLAN_LABELS } from '@/lib/subscriptions/model';
import { formatKrwExact } from '@/components/admin/format';
import { formatOrderDateTime } from '@/lib/orders';
const columns: ConsoleGridColumn[] = [
  { key: 'id', label: '정기구매 번호', width: '190px', required: true }, { key: 'state', label: '상태', width: '130px' },
  { key: 'buyer', label: '구매자', width: '120px' }, { key: 'goods', label: '상품', width: '240px' }, { key: 'schedule', label: '주기', width: '120px' },
  { key: 'next', label: '다음 결제일', width: '170px' }, { key: 'online', label: '이후 회차 온라인 금액', width: '170px', align: 'end' },
  { key: 'collect', label: '별도 착불 배송비', width: '150px', align: 'end' }, { key: 'paid', label: '결제완료 회차', width: '130px', align: 'end' },
  { key: 'paidTotal', label: '결제완료 누계', width: '150px', align: 'end' }, { key: 'updated', label: '최근 변경', width: '170px' },
];
export function AdminSubscriptionsScreen({ data }: { data: AdminSubscriptionData }) {
  const filters = data.filters, query = new URLSearchParams(); if (filters.state) query.set('state', filters.state); if (filters.query) query.set('query', filters.query);
  return <section aria-label="정기구매 관리" className="admin-console admin-sales-console wc-admin-kit">
    <SalesGuide title="정기구매와 회차별 주문을 함께 확인하세요."><p>다음 회차의 온라인 결제금액과 수령 시 별도 착불 배송비를 나누어 표시합니다. 결제완료 누계는 취소된 주문을 제외한 온라인 결제금액이며 정산 완료액과 다릅니다.</p>
      <p>고객의 주기·배송지·카드 변경과 재동의는 고객 화면에서 진행합니다. 결과가 불명확한 결제는 상세 화면에서 조회할 수 있습니다.</p></SalesGuide>
    <SalesFilterPanel currentHref={adminSubscriptionsHref(filters)} id="sales-subscriptions" search={{ value: filters.query, placeholder: '신청번호 · 구매자 · 상품' }}>
      <SalesFilterField label="신청 상태" htmlFor="sales-subscriptions-state"><SalesSelect id="sales-subscriptions-state" name="state" value={filters.state ?? ''}
        options={[{ value: '', label: '전체' }, ...SUBSCRIPTION_PLAN_STATES.map(state => ({ value: state, label: SUBSCRIPTION_PLAN_LABELS[state] }))]} /></SalesFilterField>
    </SalesFilterPanel>
    <div className="admin-sales-results"><div className="admin-sales-results-heading"><h2>목록 <span>(총 <strong>{data.total.toLocaleString('ko-KR')}</strong>건)</span></h2>
      <EncryptedWorkbookDownloadButton href={`/api/admin/subscriptions/export${query.size ? `?${query}` : ''}`} label="암호화 엑셀 다운로드" disabled={data.total > 10000} />
    </div>
    <ConsoleGrid caption="정기구매 신청 목록" preferencesKey="sales-subscriptions" columns={columns} emptyLabel="검색 조건에 맞는 정기구매가 없습니다."
      rows={data.rows.map(row => ({ id: row.id, cells: [<Link key="id" className="mono" href={`/admin/sales/subscriptions/${row.id}`}>{row.id}</Link>,
        SUBSCRIPTION_PLAN_LABELS[row.state], row.buyerName, row.goodsLabel, subscriptionScheduleLabel(row.schedule), row.nextRunAt ? formatOrderDateTime(row.nextRunAt) : '—',
        formatKrwExact(row.renewalOnlineTotal), formatKrwExact(row.renewalCollectTotal), row.paidCycleCount, formatKrwExact(row.paidOnlineTotal), formatOrderDateTime(row.updatedAt)] }))} />
    <ConsolePagination label="정기구매 목록 페이지" page={data.page} pageSize={data.pageSize} total={data.total} hrefForPage={page => adminSubscriptionsHref(filters, page)} />
    <p className="admin-sales-note">현재 검색 조건의 전체 신청을 받습니다. 최대 10,000건이며 내려받은 기록이 남습니다.</p></div>
  </section>;
}
