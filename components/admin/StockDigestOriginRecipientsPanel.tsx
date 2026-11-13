'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { readStockDigestOriginAction, saveStockDigestOriginAction, type StockDigestOriginResult } from '@/app/admin/stock-safety-digest-actions';
import { AdminField } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { STOCK_RECONCILE_PATH } from '@/lib/admin/stock-reconcile';
import { STOCK_DIGEST_ORIGIN_RECIPIENT_LIMIT, parseRecipientList, type StockDigestOrigin } from '@/lib/admin/stock-safety-digest';

const HINT = 'text-sm text-muted-foreground';
const UNKNOWN = '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.';

/**
 * 배송정보 관리 출고지 탭의 '안전재고 요약 메일 담당자' 칸(QNA-014). 탭이 열리면 그 출고지의 주소를 읽어 온다.
 * 이 출고지 상품 중 안전재고 기준 이하 옵션만 담은 메일이 하루 한 번 간다. 켜고 끄는 곳은 재고 대조 화면이다.
 */
export function StockDigestOriginRecipientsPanel({ originId }: { originId: string }) {
  const [origin, setOrigin] = useState<StockDigestOrigin | null>(null);
  const [loadError, setLoadError] = useState('');
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(false);
  const request = useRef<{ originId: string; recipients: string; expectedRevision: number; operationId: string } | null>(null);

  useEffect(() => {
    let live = true;
    void readStockDigestOriginAction(originId).then((result) => {
      if (!live) return;
      if (!result.ok) { setLoadError(result.error); return; }
      setOrigin(result.origin); setValue(result.origin.recipients.join('\n')); setLoadError('');
    }, () => { if (live) setLoadError('출고지 담당자 주소를 불러오지 못했습니다. 새로고침해주세요.'); });
    return () => { live = false; };
  }, [originId]);

  const parsed = parseRecipientList(value, STOCK_DIGEST_ORIGIN_RECIPIENT_LIMIT);
  const changed = Boolean(origin) && (!parsed.ok || parsed.recipients.join('\n') !== origin!.recipients.join('\n'));

  async function save() {
    if (pending || !origin) return;
    if (!parsed.ok) { setMessage(parsed.error); setError(true); return; }
    request.current ??= { originId, recipients: parsed.recipients.join('\n'), expectedRevision: origin.revision, operationId: crypto.randomUUID() };
    setPending(true); setMessage('');
    let result: StockDigestOriginResult;
    try { result = await saveStockDigestOriginAction(request.current); } catch { result = { ok: false, error: UNKNOWN }; }
    setPending(false);
    if (!result.ok) {
      setMessage(result.error); setError(true); setUncertain(result.error === UNKNOWN);
      if (result.error !== UNKNOWN) request.current = null;
      return;
    }
    setOrigin(result.origin); setValue(result.origin.recipients.join('\n')); setUncertain(false); setError(false); request.current = null;
    setMessage(result.origin.recipients.length ? '저장했습니다.' : '저장했습니다. 이 출고지로는 요약 메일을 보내지 않습니다.');
  }

  const inputId = `stock-digest-origin-${originId}`;
  return <section aria-label="안전재고 요약 메일 담당자" className="flex min-w-0 flex-col gap-3 border-t pt-4" data-stock-digest="origin">
    <h3 className="text-base leading-snug font-medium">안전재고 요약 메일 담당자</h3>
    <p className={HINT}>이 출고지에서 보내는 상품 중 재고수량이 안전재고 기준 이하인 옵션만 담아 하루 한 번 보냅니다(서원처럼 창고 담당자가 다른 곳).
      보내는 시각과 사용 여부는 <Link className="underline underline-offset-4" href={STOCK_RECONCILE_PATH}>재고 대조</Link> 화면에서 정합니다.</p>
    {loadError ? <p className="text-sm text-destructive" role="alert">{loadError}</p> : !origin ? <p className={HINT} role="status">불러오는 중입니다.</p>
      : <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={pending || uncertain}>
          <legend className="sr-only">안전재고 요약 메일 담당자</legend>
          <AdminField label={`받는 주소 (최대 ${STOCK_DIGEST_ORIGIN_RECIPIENT_LIMIT}개)`} inputId={inputId} hint="한 줄에 하나 또는 쉼표로 나눠 넣습니다. 비우면 이 출고지로는 보내지 않습니다."
            error={parsed.ok ? undefined : parsed.error}>
            <Textarea className="min-h-20 max-w-[35rem] font-mono text-[13px]" id={inputId} rows={2} value={value} aria-describedby={`${inputId}-hint`}
              aria-invalid={!parsed.ok || undefined} placeholder="warehouse@example.com" onChange={(event) => setValue(event.target.value)} />
          </AdminField>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" disabled={pending || (!changed && !uncertain)}>{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '담당자 주소 저장'}</Button>
          {message ? <p className={`text-sm ${error ? 'text-destructive' : 'text-success'}`} role={error ? 'alert' : 'status'}>{message}</p> : null}
        </div>
      </form>}
  </section>;
}
