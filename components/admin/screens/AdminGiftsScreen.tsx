'use client';
import Link from 'next/link';
import { ConsoleGrid, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { EncryptedWorkbookDownloadButton } from '@/components/admin/EncryptedWorkbookDownloadButton';
import { SalesFilterField, SalesFilterPanel, SalesGuide, SalesResultsTitle, SalesSelect, ShortId } from '@/components/admin/sales/SalesConsole';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { statusTone } from '@/lib/admin/status-tone';
import { ADMIN_GIFT_STATES, ADMIN_GIFT_STATE_LABELS, adminGiftsHref, adminGiftsQuery, type AdminGiftData } from '@/lib/admin/gifts';
import { formatOrderDateTime } from '@/lib/orders';

/* 1440 화면(표 폭 약 1,100px)에 기한·연결 주문까지 들어오게 나눈다. 상품·옵션은 폭을 비워 남는 자리를 받고, 대부분 비어 있는 수락일은 맨 뒤로 보낸다. */
const columns: ConsoleGridColumn[] = [
  { key: 'id', label: '선물번호', width: '104px', required: true }, { key: 'state', label: '상태', width: '100px' },
  { key: 'sender', label: '보낸 사람', width: '100px' }, { key: 'recipient', label: '받는 사람', width: '100px' },
  { key: 'goods', label: '상품·옵션' }, { key: 'quantity', label: '총 수량', width: '64px', align: 'end' },
  { key: 'created', label: '선물 생성일', width: '146px' }, { key: 'expires', label: '수락·주문 기한', width: '146px' },
  { key: 'order', label: '연결 주문', width: '100px' }, { key: 'accepted', label: '수락일', width: '146px' },
];
export function AdminGiftsScreen({ data }: { data: AdminGiftData }) {
  const filters = data.filters, query = adminGiftsQuery(filters, false), currentHref = adminGiftsHref(filters);
  return <section aria-label="선물 수락 대기" className="flex min-w-0 flex-col gap-4 text-sm" data-admin-gifts="">
    <SalesGuide title="받는 사람이 수락한 뒤 보낸 사람이 결제합니다."><p>수락 전에는 주문·결제가 생성되지 않습니다. 수락 완료 후에도 보낸 사람이 주문과 결제를 마쳐야 배송을 준비할 수 있습니다.</p>
      <p>선물번호는 주문번호와 다릅니다. 결제금액·배송지·배송 상태는 생성된 주문의 상세에서 확인하세요.</p></SalesGuide>
    <SalesFilterPanel currentHref={currentHref} id="sales-gifts" search={{ value: filters.query, placeholder: '선물·주문번호 / 보낸 사람·받는 사람·상품' }}>
      <SalesFilterField label="선물 상태" htmlFor="sales-gifts-state"><SalesSelect id="sales-gifts-state" name="state" value={filters.state ?? 'all'}
        options={[{ value: 'all', label: '전체' }, ...ADMIN_GIFT_STATES.map(state => ({ value: state, label: ADMIN_GIFT_STATE_LABELS[state] }))]} /></SalesFilterField>
    </SalesFilterPanel>
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" data-sales-results=""><div className="flex flex-wrap items-center gap-2" data-sales-results-heading=""><SalesResultsTitle total={data.total} />
      <form method="get" action="/admin/sales/gifts" className="flex flex-wrap items-center gap-1.5 print:hidden" key={currentHref}>
        {[...query].map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <SalesSelect name="pageSize" value={String(filters.pageSize)} options={[50, 100, 200].map(size => ({ value: String(size), label: `${size}개씩 보기` }))} label="목록 수" size="sm" />
        <Button size="sm" type="submit" variant="soft">적용</Button></form>
      <EncryptedWorkbookDownloadButton href={`/api/admin/gifts/export${query.size ? `?${query}` : ''}`} label="암호화 엑셀 다운로드" disabled={data.total > 10000} />
    </div>
    <ConsoleGrid caption="선물 수락 목록" preferencesKey="sales-gifts" columns={columns} emptyLabel="검색 조건에 맞는 선물이 없습니다."
      rows={data.rows.map(row => ({ id: row.id, cells: [<ShortId className="text-muted-foreground" key="id" value={row.id} />, <AdminStatusBadge key="state" tone={statusTone('gift', row.state)}>{ADMIN_GIFT_STATE_LABELS[row.state]}</AdminStatusBadge>,
        row.senderName, row.recipientName ?? '수락 전', <span className="block min-w-48" key="goods">{row.goodsLabel}</span>, row.quantity, formatOrderDateTime(row.createdAt), formatOrderDateTime(row.expiresAt),
        row.orderId ? <Link key="order" className="underline-offset-4 hover:underline" href={`/admin/sales/orders/${row.orderId}`}><ShortId value={row.orderId} /></Link> : '주문 전',
        row.acceptedAt ? formatOrderDateTime(row.acceptedAt) : '—'] }))} />
    <ConsolePagination label="선물 목록 페이지" page={data.page} pageSize={data.pageSize} total={data.total} hrefForPage={page => adminGiftsHref(filters, page)} />
    <p className="text-muted-foreground">현재 검색 조건의 전체 선물을 받습니다. 최대 10,000건이며 내려받은 기록이 남습니다.</p></div>
  </section>;
}
