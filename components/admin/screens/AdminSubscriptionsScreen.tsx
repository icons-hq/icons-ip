'use client';
import Link from 'next/link';
import { ConsoleGrid, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { EncryptedWorkbookDownloadButton } from '@/components/admin/EncryptedWorkbookDownloadButton';
import { SalesFilterField, SalesFilterPanel, SalesGuide, SalesResultsTitle, SalesSelect, ShortId } from '@/components/admin/sales/SalesConsole';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { AdminCountCard } from '@/components/admin/console/AdminCountCard';
import { statusTone } from '@/lib/admin/status-tone';
import { adminSubscriptionsHref, subscriptionScheduleLabel, type AdminSubscriptionData } from '@/lib/admin/subscriptions';
import { SUBSCRIPTION_PLAN_STATES, SUBSCRIPTION_PLAN_LABELS } from '@/lib/subscriptions/model';
import { formatKrwExact } from '@/components/admin/format';
import { formatOrderDateTime } from '@/lib/orders';
/* 1440 화면(표 폭 약 1,100px)에 다음 회차 금액까지 잘림 없이 들어오게 나눈다. 상품은 폭을 비워 남는 자리를 받고, 누계·변경일은 조회항목 설정에서 켠다. */
const columns: ConsoleGridColumn[] = [
  { key: 'id', label: '정기구매 번호', width: '106px', required: true }, { key: 'state', label: '상태', width: '148px' },
  { key: 'buyer', label: '구매자', width: '96px' }, { key: 'goods', label: '상품' }, { key: 'schedule', label: '주기', width: '64px' },
  { key: 'next', label: '다음 결제일', width: '146px' }, { key: 'online', label: '이후 회차 온라인 금액', width: '150px', align: 'end' },
  { key: 'collect', label: '별도 착불 배송비', width: '120px', align: 'end' }, { key: 'paid', label: '결제완료 회차', width: '104px', align: 'end', defaultVisible: false },
  { key: 'paidTotal', label: '결제완료 누계', width: '110px', align: 'end', defaultVisible: false }, { key: 'updated', label: '최근 변경', width: '146px', defaultVisible: false },
];
export function AdminSubscriptionsScreen({ data }: { data: AdminSubscriptionData }) {
  const filters = data.filters, query = new URLSearchParams(); if (filters.state) query.set('state', filters.state); if (filters.query) query.set('query', filters.query);
  /* 운영자가 먼저 볼 건수. 상태별 집계는 없어 이 조건으로 거른 때는 총건수, 아니면 읽어 온 줄로 세고 다음 쪽이 있으면 이 페이지 기준이라고 밝힌다. */
  const focused = filters.state === 'needs_confirmation', pending = focused ? data.total : data.rows.filter(row => row.state === 'needs_confirmation').length;
  const partial = !focused && data.total > data.rows.length;
  return <section aria-label="정기구매 관리" className="flex min-w-0 flex-col gap-4 text-sm" data-admin-subscriptions="">
    <SalesGuide title="정기구매와 회차별 주문을 함께 확인하세요."><p>다음 회차의 온라인 결제금액과 수령 시 별도 착불 배송비를 나누어 표시합니다. 결제완료 누계는 취소된 주문을 제외한 온라인 결제금액이며 정산 완료액과 다릅니다.</p>
      <p>고객의 주기·배송지·카드 변경과 재동의는 고객 화면에서 진행합니다. 결과가 불명확한 결제는 상세 화면에서 조회할 수 있습니다.</p></SalesGuide>
    <SalesFilterPanel currentHref={adminSubscriptionsHref(filters)} id="sales-subscriptions" search={{ value: filters.query, placeholder: '신청번호 · 구매자 · 상품' }}>
      <SalesFilterField label="신청 상태" htmlFor="sales-subscriptions-state"><SalesSelect id="sales-subscriptions-state" name="state" value={filters.state ?? ''}
        options={[{ value: '', label: '전체' }, ...SUBSCRIPTION_PLAN_STATES.map(state => ({ value: state, label: SUBSCRIPTION_PLAN_LABELS[state] }))]} /></SalesFilterField>
    </SalesFilterPanel>
    {pending || focused ? <div className="grid gap-2 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]"><AdminCountCard active={focused} count={pending} current="page" href={adminSubscriptionsHref({ ...filters, state: focused ? null : 'needs_confirmation' }, 1)} label={`변경 내용 확인 필요${partial ? ' (이 페이지)' : ''}`} tone="warning" /></div> : null}
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" data-sales-results="">
    {/* 목록 머리를 표 도구줄에 올려 조회항목 설정이 혼자 한 줄을 차지하지 않게 한다. */}
    <ConsoleGrid caption="정기구매 신청 목록" preferencesKey="sales-subscriptions" columns={columns} emptyLabel="검색 조건에 맞는 정기구매가 없습니다."
      rows={data.rows.map(row => ({ id: row.id, cells: [<Link key="id" className="font-medium tabular-nums underline-offset-4 hover:underline" href={`/admin/sales/subscriptions/${row.id}`}><ShortId value={row.id} /></Link>,
        <span className="flex flex-col items-start gap-0.5" key="state"><AdminStatusBadge tone={statusTone('subscription', row.state)}>{SUBSCRIPTION_PLAN_LABELS[row.state]}</AdminStatusBadge>{row.state === 'needs_confirmation' ? <Link className="text-xs underline-offset-4 hover:underline" href={`/admin/sales/subscriptions/${row.id}`}>상세에서 확인</Link> : null}</span>, <span className="block max-w-18 truncate" key="buyer" title={row.buyerName}>{row.buyerName}</span>, <span className="block min-w-48" key="goods">{row.goodsLabel}</span>, subscriptionScheduleLabel(row.schedule), row.nextRunAt ? formatOrderDateTime(row.nextRunAt) : '—',
        formatKrwExact(row.renewalOnlineTotal), formatKrwExact(row.renewalCollectTotal), row.paidCycleCount, formatKrwExact(row.paidOnlineTotal), formatOrderDateTime(row.updatedAt)] }))}>
      <div className="flex flex-wrap items-center gap-2" data-sales-results-heading=""><SalesResultsTitle total={data.total} />
        <EncryptedWorkbookDownloadButton href={`/api/admin/subscriptions/export${query.size ? `?${query}` : ''}`} label="엑셀 다운로드" disabled={data.total > 10000} />
      </div>
    </ConsoleGrid>
    <ConsolePagination label="정기구매 목록 페이지" page={data.page} pageSize={data.pageSize} total={data.total} hrefForPage={page => adminSubscriptionsHref(filters, page)} />
    <p className="text-muted-foreground">현재 검색 조건의 전체 신청을 받습니다. 최대 10,000건이며 내려받은 기록이 남습니다.</p></div>
  </section>;
}
