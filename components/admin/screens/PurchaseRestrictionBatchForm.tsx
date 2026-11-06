'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { executePurchaseRestrictionBatchAction, previewPurchaseRestrictionBatchAction, readPurchaseRestrictionBatchAction } from '@/app/admin/purchase-restriction-batch-actions';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { PURCHASE_RESTRICTION_REASONS, type PurchaseRestrictionReason } from '@/lib/admin/purchase-restrictions';
import { PURCHASE_RESTRICTION_BATCH_INPUT_MAX, purchaseRestrictionBatchHref, purchaseRestrictionBatchStatus, type PurchaseRestrictionBatch, type PurchaseRestrictionBatchMode } from '@/lib/admin/purchase-restriction-batches';
import { formatOrderDateTime } from '@/lib/orders';
import { Button } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { Textarea } from '@/components/admin/kit/ui/textarea';

/* 복수 구매제한 등록(템플릿 룩, ADR-0028). 대상 확인→명시 확인→등록→결과 재조회 동선은 그대로다. */
const FIELD = 'flex min-w-0 flex-col gap-1.5 [&>span]:font-medium';
const CELL = 'align-top whitespace-normal [&>*]:block [&_small]:text-xs [&_small]:text-muted-foreground';

export function PurchaseRestrictionBatchForm({ initialBatch = null, currentHref }: { initialBatch?: PurchaseRestrictionBatch | null; currentHref: string }) {
  const router = useRouter(); const [batch, setBatch] = useState(initialBatch);
  const [mode, setMode] = useState<PurchaseRestrictionBatchMode>(initialBatch?.mode ?? 'customer');
  const [targets, setTargets] = useState(initialBatch?.rows.map(row => row.input).join('\n') ?? '');
  const [reasonCode, setReasonCode] = useState<PurchaseRestrictionReason>(initialBatch?.reasonCode ?? 'repeated_purchase');
  const [reasonDetail, setReasonDetail] = useState(initialBatch?.reasonDetail ?? ''); const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false); const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}); const [readMessage, setReadMessage] = useState('');
  const locked = pending || uncertain || batch?.status === 'completed';
  function invalidate() { setBatch(null); setConfirmed(false); setError(''); setFieldErrors({}); setReadMessage(''); }
  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || uncertain) return;
    const form = new FormData(event.currentTarget); form.set('batchId', crypto.randomUUID()); setPending(true); setError(''); setFieldErrors({}); setReadMessage('');
    try { const result = await previewPurchaseRestrictionBatchAction(form);
      if ('batch' in result) { setBatch(result.batch); setConfirmed(false); } else { setError(result.error); setFieldErrors(result.errors ?? {}); }
    } catch { setError('대상 확인을 완료하지 못했습니다. 다시 확인해주세요.'); } finally { setPending(false); }
  }
  async function execute() {
    if (!batch || pending || uncertain || !confirmed) return; setPending(true); setError(''); setReadMessage('');
    try { const result = await executePurchaseRestrictionBatchAction(batch.id, confirmed);
      if ('batch' in result) { setBatch(result.batch); setUncertain(false); router.refresh(); }
      else { setError(result.error); setUncertain(Boolean(result.uncertain)); }
    } catch { setError('등록 결과가 불확실합니다. 등록 결과 재조회를 눌러주세요.'); setUncertain(true); } finally { setPending(false); }
  }
  async function readResult() {
    if (!batch || pending) return; setPending(true); setError(''); setReadMessage('');
    try { const result = await readPurchaseRestrictionBatchAction(batch.id);
      if ('batch' in result) { setBatch(result.batch); setUncertain(false); setReadMessage(result.batch.status === 'prepared' ? '아직 등록이 완료되지 않았습니다. 같은 요청으로 등록을 다시 시도할 수 있습니다.' : '저장된 등록 결과와 현재 제한 상태를 다시 확인했습니다.'); if (result.batch.status === 'completed') router.refresh(); }
      else { setError(result.error); if (result.uncertain) setUncertain(true); }
    } catch { setError('등록 결과를 조회하지 못했습니다. 같은 요청으로 다시 확인해주세요.'); setUncertain(true); } finally { setPending(false); }
  }
  function startAnother(failedOnly = false) {
    const retry = failedOnly ? batch?.rows.filter(row => row.outcome === 'failed').map(row => row.input).join('\n') ?? '' : '';
    invalidate(); setTargets(retry); setUncertain(false);
  }
  const fieldError = (name: string) => fieldErrors[name] ? <span role="alert" className="text-xs font-normal text-destructive" id={`restriction-batch-${name}-error`}>{fieldErrors[name]}</span> : null;
  return <details className="group rounded-xl border bg-card px-4 py-3 text-sm leading-relaxed text-card-foreground" open={initialBatch ? true : undefined}>
    <summary className="cursor-pointer font-medium">판매방해 고객 복수등록</summary>
    <p className="mt-3 text-muted-foreground">회원 ID·정확한 이메일 또는 전체 주문번호를 줄바꿈이나 쉼표로 구분해 최대 100개까지 확인합니다. 같은 고객은 한 번만 등록하며, 주문번호로 조회하면 해당 주문을 등록 근거로 남깁니다.</p>
    <form onSubmit={preview} className="mt-3.5 flex flex-col gap-3.5">
      <fieldset disabled={locked} className="m-0 grid min-w-0 gap-x-5 gap-y-3.5 border-0 p-0 md:grid-cols-2">
        <div className={FIELD}><Label htmlFor="restriction-batch-mode">입력 방식</Label><NativeSelect className="w-full" id="restriction-batch-mode" name="mode" value={mode} onChange={event => { invalidate(); setMode(event.target.value as PurchaseRestrictionBatchMode); }}><option value="customer">회원 ID 또는 정확한 이메일</option><option value="order">전체 주문번호</option></NativeSelect></div>
        <label htmlFor="restriction-batch-targets" className={`${FIELD} md:col-start-2 md:row-span-2 md:row-start-1`}><span>등록 대상</span><Textarea id="restriction-batch-targets" name="targets" value={targets} onChange={event => { invalidate(); setTargets(event.target.value); }} rows={6} maxLength={PURCHASE_RESTRICTION_BATCH_INPUT_MAX} required placeholder={mode === 'customer' ? 'customer@example.com\n회원 ID' : '전체 주문번호를 한 줄에 하나씩 입력'} aria-invalid={Boolean(fieldErrors.targets)} aria-describedby={fieldErrors.targets ? 'restriction-batch-targets-error' : undefined} />{fieldError('targets')}</label>
        <div className={`${FIELD} md:col-start-1 md:row-start-2`}><Label htmlFor="restriction-batch-reasonCode">공통 등록 사유</Label><NativeSelect className="w-full" id="restriction-batch-reasonCode" name="reasonCode" value={reasonCode} onChange={event => { invalidate(); setReasonCode(event.target.value as PurchaseRestrictionReason); }}>{PURCHASE_RESTRICTION_REASONS.map(reason => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</NativeSelect>{fieldError('reasonCode')}</div>
        <label htmlFor="restriction-batch-reasonDetail" className={`${FIELD} md:col-span-2`}><span>공통 상세 사유</span><Textarea id="restriction-batch-reasonDetail" name="reasonDetail" value={reasonDetail} onChange={event => { invalidate(); setReasonDetail(event.target.value); }} maxLength={200} rows={3} required placeholder="모든 대상에 적용되는 구체적인 근거를 입력하세요. (200자 이내)" aria-invalid={Boolean(fieldErrors.reasonDetail)} aria-describedby={fieldErrors.reasonDetail ? 'restriction-batch-reasonDetail-error' : undefined} />{fieldError('reasonDetail')}</label>
      </fieldset>
      {!batch || batch.status !== 'completed' ? <Button className="self-start" type="submit" disabled={pending || uncertain}>{pending ? '처리 중…' : '등록 대상 확인'}</Button> : null}
    </form>
    {batch ? <section className="mt-5 flex min-w-0 flex-col gap-3 border-t pt-4" aria-label="복수등록 확인 결과">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base font-medium text-foreground">{batch.status === 'completed' ? '등록 결과' : '등록 대상 미리보기'}</h3><Link className="text-sm underline underline-offset-4" href={purchaseRestrictionBatchHref(currentHref, batch.id)}>이 요청 다시 열기</Link></div>
      {batch.status === 'completed' ? <p role="status">등록 {batch.registeredCount}명 · 제외 {batch.skippedCount}건 · 미등록 {batch.failedCount}건. 아래 현재 상태는 이후 해제 여부도 반영합니다.</p>
        : <p>입력 {batch.rows.length}건 중 등록 가능 {batch.readyCount}명, 제외 {batch.rows.length - batch.readyCount}건 · 유효시간 {formatOrderDateTime(batch.expiresAt)}까지</p>}
      <div className="max-h-[28rem] min-w-0 overflow-auto rounded-lg border"><Table className="min-w-[42.5rem]"><caption className="sr-only">복수 구매제한 대상별 확인 및 처리 결과</caption><TableHeader><TableRow className="bg-muted/50"><TableHead>행</TableHead><TableHead>입력값 / 고객</TableHead><TableHead>사전확인</TableHead><TableHead>근거 주문</TableHead><TableHead>등록 결과 / 현재 상태</TableHead></TableRow></TableHeader><TableBody>{batch.rows.map(row => <TableRow key={row.rowNumber}><TableCell className="align-top tabular-nums">{row.rowNumber}</TableCell><TableCell className={CELL}><span className="tabular-nums">{row.input}</span>{row.userId ? <><Link className="underline-offset-4 hover:underline" href={`/admin/customers/${row.userId}`}>{row.nickname || '이름 없음'}</Link><small>{row.maskedEmail ?? '이메일 없음'}</small></> : null}</TableCell><TableCell className={CELL}>{purchaseRestrictionBatchStatus(row.status)}{row.duplicateOf ? <small>{row.duplicateOf}행과 같은 대상</small> : null}</TableCell><TableCell className={CELL}>{row.evidenceOrderId ? <Link className="tabular-nums underline-offset-4 hover:underline" href={`/admin/sales/orders/${row.evidenceOrderId}`}>{row.evidenceOrderId}</Link> : '—'}</TableCell><TableCell className={CELL}>{row.outcome ? <><strong className="font-medium">{row.outcome === 'registered' ? '등록' : row.outcome === 'skipped' ? '제외' : '미등록'}</strong>{row.error ? <small>{purchaseRestrictionBatchStatus(row.error)}</small> : null}</> : '등록 전'}{row.currentState ? <small>{row.currentState === 'active' ? '현재 구매제한 중' : row.currentState === 'released' ? `해제됨 · ${row.releasedAt ? formatOrderDateTime(row.releasedAt) : '시각 확인 필요'}` : '원장 재확인 필요'}</small> : null}</TableCell></TableRow>)}</TableBody></Table></div>
      {batch.status === 'expired' ? <p className="text-destructive" role="alert">대상 확인 유효시간이 지났습니다. 등록 대상 확인부터 다시 진행해주세요.</p> : null}
      {batch.status === 'prepared' ? <>
        <p className="text-muted-foreground">제외된 행은 등록하지 않습니다. 실행 사이에 상태가 바뀐 고객은 제외 또는 미등록으로 표시하고, 나머지 대상의 결과를 각각 남깁니다.</p>
        {!batch.canExecute ? <p className="rounded-lg border bg-muted/40 px-3 py-2.5">대상을 확인한 운영자만 이 요청을 등록할 수 있습니다.</p> : null}
        <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={pending || uncertain || !batch.canExecute || batch.readyCount === 0} /><span>{adminGoodsCopy('등록 가능한 고객에게 공통 사유가 적용되며, 신규 굿즈 주문만 제한하고 기존 주문은 정상 처리해야 함을 확인했습니다.')}</span></label>
      </> : null}
      <div className="flex flex-wrap items-center gap-2">
        {batch.status === 'prepared' ? <Button type="button" disabled={pending || uncertain || !confirmed || !batch.canExecute || batch.readyCount === 0} onClick={() => { void execute(); }}>등록 가능 {batch.readyCount}명 구매제한 등록</Button> : null}
        <Button type="button" variant="outline" disabled={pending} onClick={() => { void readResult(); }}>등록 결과 재조회</Button>
        {batch.status === 'completed' ? <><Button type="button" variant="outline" disabled={pending} onClick={() => startAnother()}>새 대상 등록</Button>{batch.failedCount > 0 ? <Button type="button" variant="outline" disabled={pending} onClick={() => startAnother(true)}>미등록 대상 다시 확인</Button> : null}</> : null}
      </div>
    </section> : null}
    {error ? <p className="mt-3 text-destructive" role="alert">{error}</p> : null}{fieldError('form')}{readMessage ? <p className="mt-3" role="status">{readMessage}</p> : null}
  </details>;
}
