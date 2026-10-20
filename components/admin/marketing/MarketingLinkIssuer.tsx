'use client';
import { useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { issueMarketingLinksAction } from '@/app/admin/marketing-link-actions';
import { marketingLinkPath, type MarketingLinkRow, type MarketingLinkSource } from '@/lib/admin/marketing-links';
import { CustomerServiceDialog } from '@/components/admin/screens/CustomerServiceDialog';

const subscribeOrigin = () => () => {};
const readOrigin = () => window.location.origin;
const emptyOrigin = () => '';
export function MarketingLinkCopy({ rows }: { rows: MarketingLinkRow[] }) {
  const [message, setMessage] = useState('');
  const origin = useSyncExternalStore(subscribeOrigin, readOrigin, emptyOrigin);
  async function copy(selected: MarketingLinkRow[]) {
    try { await navigator.clipboard.writeText(selected.map(row => `${window.location.origin}${marketingLinkPath(row.token)}`).join('\n')); setMessage(`${selected.length}개 링크를 복사했습니다.`); }
    catch { setMessage('자동 복사를 사용할 수 없습니다. 아래 주소를 선택해 복사해주세요.'); }
  }
  return <div className="admin-marketing-links__copies">
    {rows.length > 1 ? <button type="button" className="wc-admin-kit__button" onClick={() => void copy(rows)}>전체 링크 복사 ({rows.length}개)</button> : null}
    {rows.map(row => <div className="admin-marketing-links__copy" key={row.id}><div><strong>{row.title}</strong><span className={row.available ? 'admin-marketing-links__available' : ''}>{row.available ? '이동 가능' : '현재 비공개 · 이동 불가'}</span></div>
      <div><input aria-label={`${row.title} 마케팅 링크`} readOnly value={`${origin}${marketingLinkPath(row.token)}`} onFocus={event => event.currentTarget.select()} /><button className="wc-admin-kit__button" type="button" onClick={() => void copy([row])}>복사</button><a href={marketingLinkPath(row.token)} target="_blank" rel="noreferrer">확인 ↗</a></div></div>)}
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
export function MarketingLinkIssuer({ source, targetIds, label = '마케팅 링크 생성/복사', disabled = false, refreshOnIssue = false }: {
  source: MarketingLinkSource; targetIds: string[]; label?: string; disabled?: boolean; refreshOnIssue?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false), [open, setOpen] = useState(false), [error, setError] = useState('');
  const [rows, setRows] = useState<MarketingLinkRow[]>([]);
  const [retry, setRetry] = useState<{ source: MarketingLinkSource; targetIds: string[]; operationId: string } | null>(null);
  async function issue() {
    if (pending) return;
    const request = retry ?? { source, targetIds: [...targetIds], operationId: crypto.randomUUID() };
    setPending(true); setError(''); setOpen(true);
    try {
      const result = await issueMarketingLinksAction(request.source, request.targetIds, request.operationId);
      if (result.error) { setError(result.error); setRetry(result.uncertain ? request : null); }
      else if (result.rows) { setRows(result.rows); setRetry(null); if (refreshOnIssue) router.refresh(); }
    } catch { setError('링크 생성 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.'); setRetry(request); }
    finally { setPending(false); }
  }
  return <>
    <button className="wc-admin-kit__button" disabled={pending || disabled || (!retry && (targetIds.length < 1 || targetIds.length > 100))} type="button" onClick={() => void issue()}>{retry ? '링크 생성 결과 다시 확인' : label}</button>
    {open ? <CustomerServiceDialog title="마케팅 링크" busy={pending} onClose={() => { setOpen(false); setRows([]); }}>
      <p>같은 대상의 링크는 계속 유지됩니다. 원본을 비공개로 바꾸면 이동할 수 없으며 다시 공개하면 기존 링크를 사용할 수 있습니다.</p>
      {pending ? <p role="status">링크를 확인하고 있습니다.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {retry ? <button className="wc-admin-kit__button" disabled={pending} type="button" onClick={() => void issue()}>같은 요청으로 다시 확인</button> : null}
      {rows.length ? <MarketingLinkCopy rows={rows} /> : null}
    </CustomerServiceDialog> : null}
  </>;
}
