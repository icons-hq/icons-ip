import type { AdminOrderDownloads as Document } from '@/lib/admin/order-downloads';
import { AdminSectionCard } from './console/AdminKit';
import { formatOrderDateTime } from '@/lib/orders';
export function AdminOrderDownloads({ document }: { document: Document | null }) {
 if (document === null) return <p role="status">디지털 파일 제공 기록을 읽지 못했습니다. 새로고침해주세요.</p>;
 if (!document.items.length) return null;
 return <AdminSectionCard title="디지털 파일 제공 기록">
  <p>구매 당시 파일별 제공 시작 기록입니다. 전송 완료나 고객의 열람을 의미하지 않습니다.</p>
  {document.items.map(item => <section className="admin-order-detail__shipment" key={item.itemId}>
   <h3>{item.name}</h3>
   {item.files.map(file => <dl className="admin-order-detail__facts" key={file.id}>
    <div><dt>파일명</dt><dd>{file.name}</dd></div>
    <div><dt>파일 크기</dt><dd>{file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(2)} MB`}</dd></div>
    <div><dt>제공 시작</dt><dd>{file.providedCount ? `${file.providedCount.toLocaleString('ko-KR')}회` : '제공 기록 없음'}</dd></div>
    {file.firstProvidedAt && <div><dt>최초 제공</dt><dd><time dateTime={file.firstProvidedAt}>{formatOrderDateTime(file.firstProvidedAt)}</time></dd></div>}
    {file.lastProvidedAt && <div><dt>최근 제공</dt><dd><time dateTime={file.lastProvidedAt}>{formatOrderDateTime(file.lastProvidedAt)}</time></dd></div>}
   </dl>)}
  </section>)}
 </AdminSectionCard>;
}
