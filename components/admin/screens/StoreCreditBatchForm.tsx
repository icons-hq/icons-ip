'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { executeStoreCreditBatchAction, findStoreCreditCustomersAction, importStoreCreditTargetsAction, previewStoreCreditBatchAction, readStoreCreditBatchAction } from '@/app/admin/store-credit-console-actions';
import { parseStoreCreditTargets, storeCreditBatchError, type StoreCreditBatch, type StoreCreditCustomer } from '@/lib/admin/store-credit-console';
import { formatOrderDateTime } from '@/lib/orders';
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const statusLabel = { invalid: '대상 확인 필요', prepared: '지급 전 확인', completed: '지급 완료', failed: '전체 지급 실패' };
export function StoreCreditBatchResult({ batch }: { batch: StoreCreditBatch }) {
  return <section className="admin-credit-preview" aria-label="지급 검증 결과">
    <h3>{statusLabel[batch.status]}</h3>
    {batch.status !== 'invalid' ? <div className="admin-credit-totals"><span>대상<strong>{batch.count.toLocaleString('ko-KR')}명</strong></span><span>1인 지급액<strong>{won(batch.amount)}</strong></span><span>{batch.status === 'completed' ? '총 발급액' : '총 발급 예정액'}<strong>{won(batch.gross)}</strong></span><span>회수 적립금 상계{batch.status === 'completed' ? '' : ' 예정'}<strong>{won(batch.offset)}</strong></span><span>사용 가능 잔액 증가{batch.status === 'completed' ? '' : ' 예정'}<strong>{won(batch.net)}</strong></span></div> : <p>입력 대상 {batch.count}명. 모든 대상의 검증을 통과하면 총 발급액과 상계 후 증가액을 확인할 수 있습니다.</p>}
    <p>사유: {batch.reason} · 만료: {formatOrderDateTime(batch.expiresAt)}</p>
    {batch.status === 'prepared' ? <p>15분 안에 지급할 수 있습니다. 정책이나 잔액이 달라지면 전체 지급을 중단하고 다시 확인합니다.</p> : null}
    {batch.status === 'invalid' ? <p role="alert">지급 불가 {batch.invalidCount}명. 대상을 수정한 뒤 다시 검증해주세요. 아직 지급되지 않았습니다.</p> : null}
    {batch.status === 'failed' ? <p role="alert">{storeCreditBatchError(batch.error)} 성공 0명 · 실패 {batch.failedCount}명. 이 작업의 금융 변경은 모두 취소됐습니다. 새 검증으로 다시 준비해주세요.</p> : null}
    {batch.status === 'completed' ? <p role="status">성공 {batch.completedCount}명 · 실패 0명. 저장된 지급 결과를 다시 확인했습니다.</p> : null}
    <p className="mono">작업 ID: {batch.id}</p>
    <details><summary>대상별 검증 내역 {batch.rows.length}명</summary><div className="admin-credit-table-scroll"><table><thead><tr><th>고객</th><th>고객 ID</th><th>확인 당시 사용 가능</th><th>상계액</th><th>검증</th></tr></thead><tbody>{batch.rows.map((row,index) => <tr key={`${row.target}-${index}`}><td>{row.nickname || row.target}</td><td className="mono">{row.userId || '—'}</td><td>{row.error ? '—' : won(row.balance.available)}</td><td>{row.error ? '—' : won(row.offset)}</td><td>{row.error ? storeCreditBatchError(row.error) : batch.status === 'completed' ? '지급 완료' : batch.status === 'failed' ? '미지급' : '지급 가능'}</td></tr>)}</tbody></table></div></details>
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
  return <details className="admin-credit-register"><summary>적립금 지급 등록</summary>
    {!enabled ? <p>적립금 정책이 비활성 상태입니다. 정책 설정을 완료한 뒤 지급할 수 있습니다.</p> : null}
    <form method="post" onSubmit={preview}>
      <fieldset disabled={pending || uncertain || done || !enabled}>
        <legend>지급 내용</legend>
        <div className="admin-credit-form-row"><span>지급 목적</span><div>{[{ value: 'promotion', label: '구매 프로모션' },{ value: 'general', label: '일반 운영 지급' }].map(item => <label key={item.value}><input type="radio" name="purpose" value={item.value} checked={purpose === item.value} onChange={() => { setPurpose(item.value); invalidate(); }} />{item.label}</label>)}</div></div>
        <label className="admin-credit-form-row"><span>지급 사유</span><input name="reason" maxLength={1000} required value={reason} onChange={event => { setReason(event.target.value); invalidate(); }} placeholder="고객 적립금 내역에 표시되는 지급 사유" /></label>
        <div className="admin-credit-form-row"><label htmlFor="credit-batch-amount">1인 지급액</label><div><input id="credit-batch-amount" name="amount" type="number" min={1} max={999999999999} step={1} required value={amount} onChange={event => { setAmount(event.target.value); invalidate(); }} /> 원 <span className="admin-credit-presets">{[1000,3000,5000,10000].map(value => <button key={value} type="button" onClick={() => { setAmount(String(value)); invalidate(); }}>{won(value)}</button>)}</span></div></div>
        <div className="admin-credit-form-row"><label htmlFor="credit-batch-expires">만료 일시 (KST)</label><div><input id="credit-batch-expires" name="expiresAt" type="datetime-local" required value={expiresAt} onChange={event => { setExpiresAt(event.target.value); invalidate(); }} /><small>현재 정책 유효기간: {validityDays === null ? '미설정' : `${validityDays.toLocaleString('ko-KR')}일 이내`}</small></div></div>
        <div className="admin-credit-form-row"><span>지급 대상</span><div>
          <details className="admin-credit-customer-search"><summary>고객 검색하여 추가</summary>
            <div className="admin-credit-inline"><input aria-label="지급 고객 검색어" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="고객명 · 고객 ID · 정확한 이메일" /><button type="button" onClick={() => start(async () => { const result = await findStoreCreditCustomersAction(query); if (result.error) setError(result.error); else if (result.customers) { setCustomers(result.customers); setError(''); setNotice(`${result.customers.length}명 조회 · 최대 50명`); } })}>고객 조회</button></div>
            <ul className="admin-credit-customers">{customers.map(customer => <li key={customer.id}><span><strong>{customer.nickname || '이름 없음'}</strong> {customer.maskedEmail}<small className="mono">{customer.id}</small></span><button type="button" disabled={!customer.eligible || targets.split('\n').includes(customer.id)} onClick={() => addTargets([customer.id])}>{customer.eligible ? '추가' : '지급 불가'}</button></li>)}</ul>
          </details>
          <label>고객 ID 또는 정확한 이메일<textarea name="targets" required maxLength={205000} rows={6} value={targets} onChange={event => { setTargets(event.target.value); invalidate(); }} placeholder="한 줄에 한 명씩 · 최대 1,000명" /></label>
          <div className="admin-credit-inline"><label className="admin-credit-file">XLSX·CSV 가져오기<input type="file" accept=".xlsx,.csv" onChange={event => { const file = event.target.files?.[0]; if (!file) return; const form = new FormData(); form.set('file',file); start(async () => { const result = await importStoreCreditTargetsAction(form); if (result.error) setError(result.error); else if (result.targets) addTargets(result.targets); }); event.target.value = ''; }} /></label><a download="적립금-대상-양식.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent('\uFEFF고객 ID 또는 이메일\r\n')}`}>CSV 양식</a><button type="button" onClick={() => { setTargets(''); invalidate(); }}>대상 비우기</button></div>
          <small>첫 열에 고객 ID 또는 이메일만 입력하세요. XLSX는 시트 1개, 최대 1,000행·500KB입니다. 중복 문자열은 제외하고 동일 고객의 ID·이메일 중복은 검증에서 안내합니다.</small>
        </div></div>
        <div className="admin-credit-form-actions"><button type="submit">대상·총액 검증</button></div>
      </fieldset>
    </form>
    {notice ? <p role="status">{notice}</p> : null}{error ? <p role="alert" className="admin-error">{error}</p> : null}
    {batch ? <StoreCreditBatchResult batch={batch} /> : null}
    {batch?.status === 'prepared' ? <div className="admin-credit-confirm"><label><input type="checkbox" checked={confirmed} disabled={pending || uncertain} onChange={event => setConfirmed(event.target.checked)} />{batch.count}명에게 총 {won(batch.gross)}을 발급하며 상계 후 {won(batch.net)}이 사용 가능 잔액에 더해짐을 확인했습니다.</label><button type="button" disabled={pending || !confirmed} onClick={execute}>{uncertain ? '같은 작업으로 재시도' : '적립금 지급'}</button><button type="button" disabled={pending} onClick={read}>저장된 결과 조회</button></div> : null}
    {uncertain ? <p role="status">결과 확인 중에는 입력을 변경하거나 새 지급을 만들 수 없습니다. 작업 ID {batch?.id}의 결과를 조회하세요.</p> : null}
    {done ? <button type="button" onClick={() => { invalidate(); setTargets(''); }}>새 지급 준비</button> : null}
    {pending ? <p role="status">처리 중…</p> : null}
  </details>;
}
export function StoreCreditBatchInspect({ id }: { id: string }) {
  const [batch,setBatch] = useState<StoreCreditBatch | null>(null); const [error,setError] = useState(''); const [pending,start] = useTransition(); const [confirmed,setConfirmed] = useState(false);
  return <details className="admin-credit-inspect"><summary onClick={() => { if (!batch) start(async () => { const result = await readStoreCreditBatchAction(id); if (result.error) setError(result.error); else if (result.batch) setBatch(result.batch); }); }}>상세 / 결과 조회</summary>
    {error ? <p role="alert">{error}</p> : null}{batch ? <StoreCreditBatchResult batch={batch} /> : null}
    {batch?.status === 'prepared' && batch.canExecute ? <><label><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} />대상 {batch.count}명 · 총 {won(batch.gross)} 지급을 확인했습니다.</label><button type="button" disabled={pending || !confirmed} onClick={() => start(async () => { const form = new FormData(); form.set('id',id); form.set('confirmed','yes'); const result = await executeStoreCreditBatchAction(form); if (result.error) setError(result.error); else if (result.batch) { setBatch(result.batch); setError(''); } })}>이 작업으로 지급 / 재시도</button></> : null}
    {batch?.status === 'prepared' && !batch.canExecute ? <p>이 작업을 검증한 관리자만 지급을 실행할 수 있습니다.</p> : null}
    <button type="button" disabled={pending} onClick={() => start(async () => { const result = await readStoreCreditBatchAction(id); if (result.error) setError(result.error); else if (result.batch) { setBatch(result.batch); setError(''); } })}>결과 다시 조회</button>
  </details>;
}
