'use client';
import { useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { issueMarketingLinksAction } from '@/app/admin/marketing-link-actions';
import { marketingLinkPath, type MarketingLinkRow, type MarketingLinkSource } from '@/lib/admin/marketing-links';
import { Copy, ExternalLink } from 'lucide-react';
import { CustomerServiceDialog } from '@/components/admin/screens/CustomerServiceDialog';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';

const subscribeOrigin = () => () => {};
const readOrigin = () => window.location.origin;
const emptyOrigin = () => '';
export function MarketingLinkCopy({ rows, hideAvailability = false }: { rows: MarketingLinkRow[]; hideAvailability?: boolean }) {
  const [message, setMessage] = useState('');
  const origin = useSyncExternalStore(subscribeOrigin, readOrigin, emptyOrigin);
  async function copy(selected: MarketingLinkRow[]) {
    try { await navigator.clipboard.writeText(selected.map(row => `${window.location.origin}${marketingLinkPath(row.token)}`).join('\n')); setMessage(`${selected.length}개 링크를 복사했습니다.`); }
    catch { setMessage('자동 복사를 사용할 수 없습니다. 아래 주소를 선택해 복사해주세요.'); }
  }
  return <div className="grid min-w-0 gap-3">
    {rows.length > 1 ? <Button className="justify-self-start" type="button" variant="outline" onClick={() => void copy(rows)}><Copy aria-hidden="true" />전체 링크 복사 ({rows.length}개)</Button> : null}
    {rows.map(row => <div className="grid min-w-0 gap-2.5" key={row.id}><div className="flex min-w-0 flex-wrap items-center gap-2.5"><strong className="font-medium [overflow-wrap:anywhere]">{row.title}</strong>{hideAvailability ? null : <span className={`text-xs ${row.available ? 'text-success' : 'text-muted-foreground'}`}>{row.available ? '이동 가능' : '현재 비공개 · 이동 불가'}</span>}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-2"><Input aria-label={`${row.title} 마케팅 링크`} className="min-w-40 flex-1 basis-full sm:basis-0" readOnly value={`${origin}${marketingLinkPath(row.token)}`} onFocus={event => event.currentTarget.select()} /><Button type="button" variant="soft" onClick={() => void copy([row])}><Copy aria-hidden="true" />이 링크 복사</Button><a className={buttonVariants({ variant: 'ghost' })} data-slot="button" href={marketingLinkPath(row.token)} target="_blank" rel="noreferrer">확인 <ExternalLink aria-hidden="true" /></a></div></div>)}
    {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
  </div>;
}
export function MarketingLinkIssuer({ source, targetIds, label = '마케팅 링크 생성/복사', disabled = false, refreshOnIssue = false, size = 'default' }: {
  source: MarketingLinkSource; targetIds: string[]; label?: string; disabled?: boolean; refreshOnIssue?: boolean;
  /** 함께 놓이는 버튼 줄의 크기(일괄 변경 막대는 sm). */
  size?: 'default' | 'sm';
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
    <Button disabled={pending || disabled || (!retry && (targetIds.length < 1 || targetIds.length > 100))} size={size} type="button" variant="outline" onClick={() => void issue()}>{retry ? '링크 생성 결과 다시 확인' : label}</Button>
    {open ? <CustomerServiceDialog title="마케팅 링크" busy={pending} onClose={() => { setOpen(false); setRows([]); }}>
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground">같은 대상의 링크는 계속 유지됩니다. 원본을 비공개로 바꾸면 이동할 수 없으며 다시 공개하면 기존 링크를 사용할 수 있습니다.</p>
        {pending ? <p className="text-muted-foreground" role="status">링크를 확인하고 있습니다.</p> : null}
        {error ? <p className="text-destructive" role="alert">{error}</p> : null}
        {retry ? <Button className="self-start" disabled={pending} type="button" variant="outline" onClick={() => void issue()}>같은 요청으로 다시 확인</Button> : null}
        {rows.length ? <MarketingLinkCopy rows={rows} /> : null}
      </div>
    </CustomerServiceDialog> : null}
  </>;
}
