'use client';
import Link from 'next/link';
import { ConsoleGrid, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { EncryptedWorkbookDownloadButton } from '@/components/admin/EncryptedWorkbookDownloadButton';
import { SalesFilterField, SalesFilterPanel, SalesGuide, SalesSelect } from '@/components/admin/sales/SalesConsole';
import { ADMIN_GIFT_STATES, ADMIN_GIFT_STATE_LABELS, adminGiftsHref, adminGiftsQuery, type AdminGiftData } from '@/lib/admin/gifts';
import { formatOrderDateTime } from '@/lib/orders';

const columns: ConsoleGridColumn[] = [
  { key: 'id', label: '선물번호', width: '190px', required: true }, { key: 'state', label: '상태', width: '160px' },
  { key: 'sender', label: '보낸 사람', width: '120px' }, { key: 'recipient', label: '받는 사람', width: '120px' },
  { key: 'goods', label: '상품·옵션', width: '300px' }, { key: 'quantity', label: '총 수량', width: '90px', align: 'end' },
  { key: 'created', label: '선물 생성일', width: '170px' }, { key: 'expires', label: '수락·주문 기한', width: '170px' },
  { key: 'accepted', label: '수락일', width: '170px' }, { key: 'order', label: '연결 주문', width: '190px' },
];
export function AdminGiftsScreen({ data }: { data: AdminGiftData }) {
  const filters = data.filters, query = adminGiftsQuery(filters, false), currentHref = adminGiftsHref(filters);
  return <section aria-label="선물 수락 대기" className="admin-console admin-sales-console wc-admin-kit">
    <SalesGuide title="받는 사람이 수락한 뒤 보낸 사람이 결제합니다."><p>수락 전에는 주문·결제가 생성되지 않습니다. 수락 완료 후에도 보낸 사람이 주문과 결제를 마쳐야 배송을 준비할 수 있습니다.</p>
      <p>선물번호는 주문번호와 다릅니다. 결제금액·배송지·배송 상태는 생성된 주문의 상세에서 확인하세요.</p></SalesGuide>
    <SalesFilterPanel currentHref={currentHref} id="sales-gifts" search={{ value: filters.query, placeholder: '선물·주문번호 / 보낸 사람·받는 사람·상품' }}>
      <SalesFilterField label="선물 상태" htmlFor="sales-gifts-state"><SalesSelect id="sales-gifts-state" name="state" value={filters.state ?? 'all'}
        options={[{ value: 'all', label: '전체' }, ...ADMIN_GIFT_STATES.map(state => ({ value: state, label: ADMIN_GIFT_STATE_LABELS[state] }))]} /></SalesFilterField>
    </SalesFilterPanel>
    <div className="admin-sales-results"><div className="admin-sales-results-heading"><h2>목록 <span>(총 <strong>{data.total.toLocaleString('ko-KR')}</strong>건)</span></h2>
      <form method="get" action="/admin/sales/gifts" className="admin-sales-list-options" key={currentHref}>
        {[...query].map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <SalesSelect name="pageSize" value={String(filters.pageSize)} options={[50, 100, 200].map(size => ({ value: String(size), label: `${size}개씩 보기` }))} label="목록 수" />
        <button type="submit">적용</button></form>
      <EncryptedWorkbookDownloadButton href={`/api/admin/gifts/export${query.size ? `?${query}` : ''}`} label="암호화 엑셀 다운로드" disabled={data.total > 10000} />
    </div>
    <ConsoleGrid caption="선물 수락 목록" preferencesKey="sales-gifts" columns={columns} emptyLabel="검색 조건에 맞는 선물이 없습니다."
      rows={data.rows.map(row => ({ id: row.id, cells: [<span key="id" className="mono">{row.id}</span>, ADMIN_GIFT_STATE_LABELS[row.state],
        row.senderName, row.recipientName ?? '수락 전', row.goodsLabel, row.quantity, formatOrderDateTime(row.createdAt), formatOrderDateTime(row.expiresAt),
        row.acceptedAt ? formatOrderDateTime(row.acceptedAt) : '—', row.orderId ? <Link key="order" className="mono" href={`/admin/sales/orders/${row.orderId}`}>{row.orderId}</Link> : '주문 전'] }))} />
    <ConsolePagination label="선물 목록 페이지" page={data.page} pageSize={data.pageSize} total={data.total} hrefForPage={page => adminGiftsHref(filters, page)} />
    <p className="admin-sales-note">현재 검색 조건의 전체 선물을 받습니다. 최대 10,000건이며 내려받은 기록이 남습니다.</p></div>
  </section>;
}
