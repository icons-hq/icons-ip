'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { executeStoreCreditBatchAction, findStoreCreditCustomersAction, importStoreCreditTargetsAction, previewStoreCreditBatchAction, readStoreCreditBatchAction } from '@/app/admin/store-credit-console-actions';
import { parseStoreCreditTargets, storeCreditBatchError, type StoreCreditBatch, type StoreCreditCustomer } from '@/lib/admin/store-credit-console';
import { formatOrderDateTime } from '@/lib/orders';
import { ChevronDown, Download, Plus, Search } from 'lucide-react';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { ACTIONS, CHECK_LABEL, CHECK_LABEL_TOP, FIELD_HINT, INFO_PANEL, NOTE, TABLE_SCROLL } from '@/components/admin/settings-kit';
import { AdminNotice } from '@/components/admin/console/AdminKit';
/* 지급 등록 줄: 스마트스토어식 행 라벨 + 입력. */
const FORM_ROW = 'grid min-w-0 gap-2 border-b pb-3 last:border-b-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start';
const ROW_LABEL = 'pt-1.5 text-sm font-medium';
const TOTAL = 'flex min-w-0 flex-col gap-0.5 rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground [&>strong]:text-base [&>strong]:font-semibold [&>strong]:text-foreground [&>strong]:tabular-nums';
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const statusLabel = { invalid: '대상 확인 필요', prepared: '지급 전 확인', completed: '지급 완료', failed: '전체 지급 실패' };
export function StoreCreditBatchResult({ batch }: { batch: StoreCreditBatch }) {
  return <section aria-label="지급 검증 결과" className={INFO_PANEL} data-credit-preview="">
    <h3 className="text-base font-medium">{statusLabel[batch.status]}</h3>
    {batch.status !== 'invalid' ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]"><span className={TOTAL}>대상<strong>{batch.count.toLocaleString('ko-KR')}명</strong></span><span className={TOTAL}>1인 지급액<strong>{won(batch.amount)}</strong></span><span className={TOTAL}>{batch.status === 'completed' ? '총 발급액' : '총 발급 예정액'}<strong>{won(batch.gross)}</strong></span><span className={TOTAL}>회수 적립금 상계{batch.status === 'completed' ? '' : ' 예정'}<strong>{won(batch.offset)}</strong></span><span className={TOTAL}>사용 가능 잔액 증가{batch.status === 'completed' ? '' : ' 예정'}<strong>{won(batch.net)}</strong></span></div> : <p className="text-muted-foreground">입력 대상 {batch.count}명. 모든 대상의 검증을 통과하면 총 발급액과 상계 후 증가액을 확인할 수 있습니다.</p>}
    <p className="text-muted-foreground">사유: {batch.reason} · 만료: {formatOrderDateTime(batch.expiresAt)}</p>
    {batch.status === 'prepared' ? <p className="text-muted-foreground">15분 안에 지급할 수 있습니다. 정책이나 잔액이 달라지면 전체 지급을 중단하고 다시 확인합니다.</p> : null}
    {batch.status === 'invalid' ? <AdminNotice role="alert" tone="danger">지급 불가 {batch.invalidCount}명. 대상을 수정한 뒤 다시 검증해주세요. 아직 지급되지 않았습니다.</AdminNotice> : null}
    {batch.status === 'failed' ? <AdminNotice role="alert" tone="danger">{storeCreditBatchError(batch.error)} 성공 0명 · 실패 {batch.failedCount}명. 이 작업의 금융 변경은 모두 취소됐습니다. 새 검증으로 다시 준비해주세요.</AdminNotice> : null}
    {batch.status === 'completed' ? <AdminNotice role="status" tone="success">성공 {batch.completedCount}명 · 실패 0명. 저장된 지급 결과를 다시 확인했습니다.</AdminNotice> : null}
    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">작업 ID: {batch.id}</p>
    <details className="rounded-lg border bg-background"><summary className="cursor-pointer px-3 py-2 font-medium">대상별 검증 내역 {batch.rows.length}명</summary><div className={`${TABLE_SCROLL} m-3 mt-0`}><Table className="min-w-[40rem]"><TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead>고객</TableHead><TableHead>고객 ID</TableHead><TableHead className="text-right">확인 당시 사용 가능</TableHead><TableHead className="text-right">상계액</TableHead><TableHead>검증</TableHead></TableRow></TableHeader><TableBody>{batch.rows.map((row,index) => <TableRow key={`${row.target}-${index}`}><TableCell className="whitespace-normal [overflow-wrap:anywhere]">{row.nickname || row.target}</TableCell><TableCell className="text-xs text-muted-foreground">{row.userId || '—'}</TableCell><TableCell className="text-right tabular-nums">{row.error ? '—' : won(row.balance.available)}</TableCell><TableCell className="text-right tabular-nums">{row.error ? '—' : won(row.offset)}</TableCell><TableCell className="whitespace-normal">{row.error ? storeCreditBatchError(row.error) : batch.status === 'completed' ? '지급 완료' : batch.status === 'failed' ? '미지급' : '지급 가능'}</TableCell></TableRow>)}</TableBody></Table></div></details>
  </section>;
}
export function StoreCreditBatchForm({ enabled, validityDays }: { enabled: boolean; validityDays: number | null }) {
  const [pending,start] = useTransition(); const [targets,setTargets] = useState(''); const [query,setQuery] = useState('');
  const [customers,setCustomers] = useState<StoreCreditCustomer[]>([]); const [amount,setAmount] = useState('');
  const [purpose,setPurpose] = useState('promotion'); const [reason,setReason] = useState(''); const [expiresAt,setExpiresAt] = useState('');
  const [batch,setBatch] = useState<StoreCreditBatch | null>(null); const [confirmed,setConfirmed] = useState(false);
  const [error,setError] = useState(''); const [notice,setNotice] = useState(''); const [uncertain,setUncertain] = useState(false);
  function invalidate() { setBatch(null); setConfirmed(false); setError(''); setNotice(''); }
  function addTargets(values: string[]) {
    try { const parsed = parseStoreCreditTargets([targets,...values].join('\n')); setTargets(parsed.targets.join('\n')); invalidate(); setNotice(`${parsed.targets.length}명 선택${parsed.duplicates ? ` · 중복 ${parsed.duplicates}건 제외` : ''}`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '대상을 확인해주세요.'); }
  }
  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); form.set('id',crypto.randomUUID());
    start(async () => { setError(''); const result = await previewStoreCreditBatchAction(form); if (result.error) setError(result.error); else if (result.batch) { setBatch(result.batch); setConfirmed(false); } });
  }
  function execute() {
    if (!batch || !confirmed) return;
    const form = new FormData(); form.set('id',batch.id); form.set('confirmed','yes');
    setUncertain(true);
    start(async () => { setError(''); const result = await executeStoreCreditBatchAction(form); if (result.error) setError(result.error); else if (result.batch) { setBatch(result.batch); setUncertain(!['completed','failed'].includes(result.batch.status)); } });
  }
  function read() {
    if (!batch) return;
    start(async () => { const result = await readStoreCreditBatchAction(batch.id); if (result.error) setError(result.error); else if (result.batch) { setBatch(result.batch); setError(''); if (['completed','failed'].includes(result.batch.status)) setUncertain(false); } });
  }
  const done = batch?.status === 'completed' || batch?.status === 'failed';
  return <details className="group/register min-w-0 rounded-xl border bg-card text-sm text-card-foreground" data-credit-register=""><summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 font-medium [&::-webkit-details-marker]:hidden"><span className={buttonVariants({ variant: 'soft' })} data-slot="button"><Plus aria-hidden="true" />적립금 지급 등록</span><ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open/register:rotate-180" /></summary>
    <div className="flex min-w-0 flex-col gap-4 border-t p-4">
    {!enabled ? <AdminNotice tone="warning">적립금 정책이 비활성 상태입니다. 정책 설정을 완료한 뒤 지급할 수 있습니다.</AdminNotice> : null}
    <form method="post" onSubmit={preview}>
      <fieldset disabled={pending || uncertain || done || !enabled} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <legend className="mb-1 text-sm font-medium">지급 내용</legend>
        <div className={FORM_ROW}><span className={ROW_LABEL}>지급 목적</span><div className="flex flex-wrap gap-x-4 gap-y-2 pt-1.5">{[{ value: 'promotion', label: '구매 프로모션' },{ value: 'general', label: '일반 운영 지급' }].map(item => <label className={CHECK_LABEL} key={item.value}><input type="radio" name="purpose" value={item.value} checked={purpose === item.value} onChange={() => { setPurpose(item.value); invalidate(); }} />{item.label}</label>)}</div></div>
        <label className={FORM_ROW}><span className={ROW_LABEL}>지급 사유</span><Input name="reason" maxLength={1000} required value={reason} onChange={event => { setReason(event.target.value); invalidate(); }} placeholder="고객 적립금 내역에 표시되는 지급 사유" /></label>
        <div className={FORM_ROW}><label className={ROW_LABEL} htmlFor="credit-batch-amount">1인 지급액</label><div className="flex flex-wrap items-center gap-2"><Input className="w-40" id="credit-batch-amount" name="amount" type="number" min={1} max={999999999999} step={1} required value={amount} onChange={event => { setAmount(event.target.value); invalidate(); }} /> <span className="text-muted-foreground">원</span> <span className="flex flex-wrap gap-1.5">{[1000,3000,5000,10000].map(value => <Button key={value} onClick={() => { setAmount(String(value)); invalidate(); }} size="xs" type="button" variant="outline">{won(value)}</Button>)}</span></div></div>
        <div className={FORM_ROW}><label className={ROW_LABEL} htmlFor="credit-batch-expires">만료 일시 (KST)</label><div className="flex flex-col gap-1"><Input className="w-56 max-w-full" id="credit-batch-expires" name="expiresAt" type="datetime-local" required value={expiresAt} onChange={event => { setExpiresAt(event.target.value); invalidate(); }} /><small className={FIELD_HINT}>현재 정책 유효기간: {validityDays === null ? '미설정' : `${validityDays.toLocaleString('ko-KR')}일 이내`}</small></div></div>
        <div className={FORM_ROW}><span className={ROW_LABEL}>지급 대상</span><div className="flex min-w-0 flex-col gap-2">
          <details className="rounded-lg border bg-muted/40 px-3 py-2"><summary className="cursor-pointer font-medium">고객 검색하여 추가</summary>
            <div className="mt-2 flex flex-wrap gap-2"><Input aria-label="지급 고객 검색어" className="min-w-0 flex-1" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="고객명 · 고객 ID · 정확한 이메일" /><Button onClick={() => start(async () => { const result = await findStoreCreditCustomersAction(query); if (result.error) setError(result.error); else if (result.customers) { setCustomers(result.customers); setError(''); setNotice(`${result.customers.length}명 조회 · 최대 50명`); } })} type="button" variant="outline"><Search aria-hidden="true" />고객 조회</Button></div>
            <ul className="mt-2 flex flex-col divide-y">{customers.map(customer => <li className="flex items-center justify-between gap-3 py-2" key={customer.id}><span className="min-w-0"><strong className="font-medium">{customer.nickname || '이름 없음'}</strong> <span className="text-muted-foreground">{customer.maskedEmail}</span><small className={`block ${FIELD_HINT} [overflow-wrap:anywhere]`}>{customer.id}</small></span><Button disabled={!customer.eligible || targets.split('\n').includes(customer.id)} onClick={() => addTargets([customer.id])} size="xs" type="button" variant="outline">{customer.eligible ? '추가' : '지급 불가'}</Button></li>)}</ul>
          </details>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium [&_textarea]:font-normal">고객 ID 또는 정확한 이메일<Textarea className="field-sizing-fixed" name="targets" required maxLength={205000} rows={6} value={targets} onChange={event => { setTargets(event.target.value); invalidate(); }} placeholder="한 줄에 한 명씩 · 최대 1,000명" /></label>
          <div className="flex flex-wrap items-center gap-2"><label className={`${buttonVariants({ variant: 'outline', size: 'sm' })} cursor-pointer focus-within:ring-3 focus-within:ring-ring/50`} data-slot="button">XLSX·CSV 가져오기<input className="sr-only" type="file" accept=".xlsx,.csv" onChange={event => { const file = event.target.files?.[0]; if (!file) return; const form = new FormData(); form.set('file',file); start(async () => { const result = await importStoreCreditTargetsAction(form); if (result.error) setError(result.error); else if (result.targets) addTargets(result.targets); }); event.target.value = ''; }} /></label><a className={buttonVariants({ variant: 'ghost', size: 'sm' })} data-slot="button" download="적립금-대상-양식.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent('\uFEFF고객 ID 또는 이메일\r\n')}`}><Download aria-hidden="true" />CSV 양식</a><Button onClick={() => { setTargets(''); invalidate(); }} size="sm" type="button" variant="ghost">대상 비우기</Button></div>
          <small className={FIELD_HINT}>첫 열에 고객 ID 또는 이메일만 입력하세요. XLSX는 시트 1개, 최대 1,000행·500KB입니다. 중복 문자열은 제외하고 동일 고객의 ID·이메일 중복은 검증에서 안내합니다.</small>
        </div></div>
        <div className="flex justify-end border-t pt-3"><Button type="submit" variant={batch?.status === 'prepared' ? 'soft' : 'default'}>대상·총액 검증</Button></div>
      </fieldset>
    </form>
    {notice ? <AdminNotice role="status" tone="neutral">{notice}</AdminNotice> : null}{error ? <AdminNotice role="alert" tone="danger">{error}</AdminNotice> : null}
    {batch ? <StoreCreditBatchResult batch={batch} /> : null}
    {batch?.status === 'prepared' ? <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/40 p-3 text-sm"><label className={CHECK_LABEL_TOP}><input className="mt-0.5" type="checkbox" checked={confirmed} disabled={pending || uncertain} onChange={event => setConfirmed(event.target.checked)} />{batch.count}명에게 총 {won(batch.gross)}을 발급하며 상계 후 {won(batch.net)}이 사용 가능 잔액에 더해짐을 확인했습니다.</label><div className={ACTIONS}><Button disabled={pending || !confirmed} onClick={execute} type="button">{uncertain ? '같은 작업으로 재시도' : '적립금 지급'}</Button><Button disabled={pending} onClick={read} type="button" variant="outline">저장된 결과 조회</Button></div></div> : null}
    {uncertain ? <AdminNotice role="status" tone="warning">결과 확인 중에는 입력을 변경하거나 새 지급을 만들 수 없습니다. 작업 ID {batch?.id}의 결과를 조회하세요.</AdminNotice> : null}
    {done ? <Button className="w-fit" onClick={() => { invalidate(); setTargets(''); }} type="button" variant="outline"><Plus aria-hidden="true" />새 지급 준비</Button> : null}
    {pending ? <p className={NOTE} role="status">처리 중…</p> : null}
    </div>
  </details>;
}
export function StoreCreditBatchInspect({ id }: { id: string }) {
  const [batch,setBatch] = useState<StoreCreditBatch | null>(null); const [error,setError] = useState(''); const [pending,start] = useTransition(); const [confirmed,setConfirmed] = useState(false);
  return <details className="min-w-0 text-sm" data-credit-inspect=""><summary className="cursor-pointer font-medium underline-offset-4 hover:underline" onClick={() => { if (!batch) start(async () => { const result = await readStoreCreditBatchAction(id); if (result.error) setError(result.error); else if (result.batch) setBatch(result.batch); }); }}>상세 / 결과 조회</summary>
    <div className="mt-2 flex min-w-0 flex-col gap-2 whitespace-normal">{error ? <AdminNotice role="alert" tone="danger">{error}</AdminNotice> : null}{batch ? <StoreCreditBatchResult batch={batch} /> : null}
    {batch?.status === 'prepared' && batch.canExecute ? <><label className={CHECK_LABEL_TOP}><input className="mt-0.5" type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} />대상 {batch.count}명 · 총 {won(batch.gross)} 지급을 확인했습니다.</label><Button className="w-fit" disabled={pending || !confirmed} size="sm" type="button" onClick={() => start(async () => { const form = new FormData(); form.set('id',id); form.set('confirmed','yes'); const result = await executeStoreCreditBatchAction(form); if (result.error) setError(result.error); else if (result.batch) { setBatch(result.batch); setError(''); } })}>이 작업으로 지급 / 재시도</Button></> : null}
    {batch?.status === 'prepared' && !batch.canExecute ? <p className={NOTE}>이 작업을 검증한 관리자만 지급을 실행할 수 있습니다.</p> : null}
    <Button className="w-fit" disabled={pending} size="sm" type="button" variant="outline" onClick={() => start(async () => { const result = await readStoreCreditBatchAction(id); if (result.error) setError(result.error); else if (result.batch) { setBatch(result.batch); setError(''); } })}>결과 다시 조회</Button></div>
  </details>;
}
