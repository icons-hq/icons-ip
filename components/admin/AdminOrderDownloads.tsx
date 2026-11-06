import type { AdminOrderDownloads as Document } from '@/lib/admin/order-downloads';
import { AdminSectionCard } from './console/AdminKit';
import { formatOrderDateTime } from '@/lib/orders';

/* 파일별 제공 기록(템플릿 룩, ADR-0028). 주문 상세의 사실 목록과 같은 두 칸 배치다. */
const ROW = 'grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]';
const TERM = 'text-muted-foreground';
const VALUE = 'min-w-0 wrap-anywhere';

export function AdminOrderDownloads({ document }: { document: Document | null }) {
 if (document === null) return <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm" role="status">디지털 파일 제공 기록을 읽지 못했습니다. 새로고침해주세요.</p>;
 if (!document.items.length) return null;
 return <AdminSectionCard title="디지털 파일 제공 기록">
  <p className="text-muted-foreground">구매 당시 파일별 제공 시작 기록입니다. 전송 완료나 고객의 열람을 의미하지 않습니다.</p>
  {document.items.map(item => <section className="flex flex-col gap-3 border-t pt-4 first-of-type:border-t-0 first-of-type:pt-0" key={item.itemId}>
   <h3 className="text-sm font-medium text-foreground">{item.name}</h3>
   {item.files.map(file => <dl className="grid gap-3" key={file.id}>
    <div className={ROW}><dt className={TERM}>파일명</dt><dd className={VALUE}>{file.name}</dd></div>
    <div className={ROW}><dt className={TERM}>파일 크기</dt><dd className={`${VALUE} tabular-nums`}>{file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(2)} MB`}</dd></div>
    <div className={ROW}><dt className={TERM}>제공 시작</dt><dd className={`${VALUE} tabular-nums`}>{file.providedCount ? `${file.providedCount.toLocaleString('ko-KR')}회` : '제공 기록 없음'}</dd></div>
    {file.firstProvidedAt && <div className={ROW}><dt className={TERM}>최초 제공</dt><dd className={VALUE}><time dateTime={file.firstProvidedAt}>{formatOrderDateTime(file.firstProvidedAt)}</time></dd></div>}
    {file.lastProvidedAt && <div className={ROW}><dt className={TERM}>최근 제공</dt><dd className={VALUE}><time dateTime={file.lastProvidedAt}>{formatOrderDateTime(file.lastProvidedAt)}</time></dd></div>}
   </dl>)}
  </section>)}
 </AdminSectionCard>;
}
