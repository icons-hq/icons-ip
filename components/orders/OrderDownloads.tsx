'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrderDownloads as OrderDownloadsDocument } from '@/lib/order-downloads';
import type { DigitalFile } from '@/lib/goods-fulfillment';
import { formatOrderDateTime } from '@/lib/orders';
import Link from 'next/link';
function DownloadButton({ itemId, file, available }: { itemId: string; file: DigitalFile; available: boolean }) {
 const [pending, setPending] = useState(false), [error, setError] = useState('');
 const busy = useRef(false), operation = useRef<string | null>(null), router = useRouter();
 async function download() {
  if (busy.current || !available) return; busy.current = true; setPending(true); setError(''); operation.current ??= crypto.randomUUID();
  let url: string | null = null;
  try {
   const response = await fetch('/api/orders/digital-download', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, assetId: file.id, operationId: operation.current }) });
   if (!response.ok) { setError('파일을 받지 못했습니다. 현재 주문 상태를 확인하거나 같은 요청으로 다시 시도해주세요.'); return; }
   const blob = await response.blob(); if (blob.size !== file.size) { setError('파일 전송이 완료되지 않았습니다. 다시 시도해주세요.'); return; }
   url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove();
   operation.current = null; router.refresh();
  } catch { setError('파일 전송을 확인하지 못했습니다. 같은 요청으로 다시 시도해주세요.'); }
  finally { if (url) { const old = url; setTimeout(() => URL.revokeObjectURL(old), 60_000); } busy.current = false; setPending(false); }
 }
 return <div className="col" style={{ gap: 6 }}><button type="button" className="btn btn-ghost" disabled={!available || pending} onClick={download}>
  {pending ? '파일 받는 중…' : `${file.name} 다운로드`} ({file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(2)} MB`})</button>{error && <p role="alert">{error}</p>}</div>;
}
export function OrderDownloads({ document }: { document: OrderDownloadsDocument | null }) {
 if (document === null) return <p role="status">디지털 파일 정보를 읽지 못했습니다. 새로고침해주세요.</p>;
 if (!document.items.length) return null;
 return <section className="card col" style={{ padding: 20, gap: 14 }} aria-label="구매한 디지털 파일"><h2 style={{ margin: 0 }}>구매한 디지털 파일</h2>
  <p style={{ margin: 0 }}>결제한 계정에서 구매 당시 파일을 다시 받을 수 있습니다. 취소·환불 검토 중에는 다운로드가 중지되고, 환불 후에는 이용할 수 없습니다.</p>
  <p className="muted" style={{ margin: 0 }}>다운로드를 시작하면 파일 제공 이력이 남습니다. 제공 후 취소 요청은 담당자가 확인합니다.</p>
  <p style={{ margin: 0 }}>디지털 파일은 구매 당시 파일을 재다운로드할 수 있으며, 다른 파일로 교환하지 않습니다. 파일 오류나 이용 문제는 <Link href={`/my/inquiries/new?orderId=${encodeURIComponent(document.orderId)}`}>주문 관련 1:1 문의</Link>로 알려주세요. 취소·환불은 제공 이력과 사유를 확인한 뒤 심사합니다.</p>
  {document.items.map(item => <div className="col" style={{ gap: 8 }} key={item.itemId}><h3 style={{ margin: 0 }}>{item.name}</h3>
   {item.firstProvidedAt && <small>최초 제공 시작: {formatOrderDateTime(item.firstProvidedAt)}</small>}
   {!item.available && <p role="status">현재 결제·취소·환불 상태에서는 파일을 받을 수 없습니다.</p>}
   {item.files.map(file => <DownloadButton key={file.id} itemId={item.itemId} file={file} available={item.available} />)}
  </div>)}
 </section>;
}
