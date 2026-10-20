'use client';
import Link from 'next/link';
import { startTransition, useEffect, useRef, useState } from 'react';
import { loadGoodsSizeChartAction, saveGoodsSizeChartAction, type GoodsSizeResult } from '@/app/admin/goods-size-chart-actions';
import { GOODS_SIZE_TEMPLATES_PATH, emptyGoodsSizeChartValues, goodsSizeChartError, parseGoodsSizeChart, parseGoodsSizeChartValues, type GoodsSizeChartSnapshot, type GoodsSizeChartValues } from '@/lib/goods-size-chart';
import { parseGoodsSizeDraft, type GoodsSizeSaveRequest } from '@/lib/admin/goods-size-chart-draft';
import { GoodSizeChart } from '@/components/shop/GoodSizeChart';
import { GoodsSizeChartFields } from './GoodsSizeChartFields';
import { GoodsSizeTemplatePicker } from './screens/GoodsSizeTemplatesScreen';
import { useGoodsSizeRecovery } from './useGoodsSizeRecovery';

export function GoodSizeChartPanel({ goodId, accountId }: { goodId: string; accountId: string }) {
  const [snapshot, setSnapshot] = useState<GoodsSizeChartSnapshot | null>(null);
  const [values, setValues] = useState<GoodsSizeChartValues>(emptyGoodsSizeChartValues);
  const [baseRevision, setBaseRevision] = useState(0), [latest, setLatest] = useState<GoodsSizeChartSnapshot | null>(null);
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(false), [templates, setTemplates] = useState(false);
  const busy = useRef(false), mounted = useRef(true), readSequence = useRef(0), request = useRef<GoodsSizeSaveRequest | null>(null);
  const local = useGoodsSizeRecovery({ accountId, recordId: goodId, formId: 'goods-size-chart', parse: parseGoodsSizeDraft });
  const recoveryBlocked = Boolean(local.recovery?.request);

  useEffect(() => {
    mounted.current = true; let active = true; const sequence = ++readSequence.current;
    void loadGoodsSizeChartAction(goodId).then(result => {
      if (!active || sequence !== readSequence.current) return;
      if (result.ok) { setSnapshot(result.value); setValues(result.value.values); setBaseRevision(result.value.revision); }
      else { setError(true); setMessage(result.error); }
    }).catch(() => { if (active && sequence === readSequence.current) { setError(true); setMessage('사이즈 안내를 불러오지 못했습니다. 다시 조회해주세요.'); } });
    return () => { active = false; mounted.current = false; };
  }, [goodId]);

  function change(next: GoodsSizeChartValues) {
    setValues(next); local.capture({ baseRevision, values: next, request: null });
  }
  async function save(restoredRequest?: GoodsSizeSaveRequest) {
    if (busy.current || (!snapshot && !restoredRequest && !request.current) || (recoveryBlocked && !restoredRequest && !request.current) || (conflict && !restoredRequest && !request.current)) return;
    const parsed = restoredRequest?.values ?? request.current?.values ?? parseGoodsSizeChartValues(values);
    if (!parsed) { setError(true); setMessage(goodsSizeChartError()); return; }
    const replaying = Boolean(restoredRequest || request.current);
    const fixed = restoredRequest ?? request.current ?? { values: parsed, revision: baseRevision, operationId: crypto.randomUUID() };
    request.current = fixed; ++readSequence.current; busy.current = true; setPending(true); setMessage('');
    local.capture({ baseRevision: fixed.revision, values: fixed.values, request: fixed }, true);
    let result: GoodsSizeResult<GoodsSizeChartSnapshot>;
    try { result = await saveGoodsSizeChartAction(goodId, fixed.values, fixed.revision, fixed.operationId); }
    catch { result = { ok: false, uncertain: true, error: '저장 결과를 확인하지 못했습니다. 같은 요청 결과를 확인해주세요.' }; }
    let current: GoodsSizeChartSnapshot | null = null;
    if (result.ok && replaying) {
      try { const read = await loadGoodsSizeChartAction(goodId); if (read.ok) current = read.value; } catch { /* The receipt still confirms this operation. */ }
    }
    busy.current = false; if (!mounted.current) return; setPending(false);
    if (result.ok) {
      setSnapshot(result.value); setValues(result.value.values); setBaseRevision(result.value.revision); setLatest(null); setConflict(false); setUncertain(false); setError(false);
      request.current = null; local.discard(); setMessage(result.value.values.enabled ? '사이즈 안내를 저장했습니다.' : '사이즈 안내는 설정안함입니다. 작성한 표는 보존했습니다.');
      if (replaying && !current) setMessage('이전 저장 요청의 완료를 확인했습니다. 최신 저장본은 다시 조회해주세요.');
      if (current && current.revision !== result.value.revision) {
        setLatest(current); setConflict(true); local.capture({ baseRevision: result.value.revision, values: result.value.values, request: null }, true);
        setMessage('이전 저장 요청의 완료를 확인했습니다. 이후 변경된 최신 저장본도 확인해주세요.');
      }
    } else {
      setError(true); setMessage(result.error); setUncertain(Boolean(result.uncertain)); setConflict(Boolean(result.conflict));
      if (!result.uncertain) { request.current = null; local.capture({ baseRevision: fixed.revision, values: fixed.values, request: null }, true); }
    }
  }
  async function refresh() {
    if (busy.current || uncertain || recoveryBlocked) return;
    const sequence = ++readSequence.current; busy.current = true; setPending(true);
    try {
      const result = await loadGoodsSizeChartAction(goodId);
      if (!mounted.current || sequence !== readSequence.current) return;
      if (result.ok) {
        setError(false);
        if (!snapshot) { setSnapshot(result.value); setValues(result.value.values); setBaseRevision(result.value.revision); }
        else { setLatest(result.value); setConflict(result.value.revision !== baseRevision); }
        setMessage('최신 저장본을 확인했습니다. 작성한 표는 유지합니다.');
      } else { setError(true); setMessage(result.error); }
    } catch { if (mounted.current && sequence === readSequence.current) { setError(true); setMessage('저장본을 조회하지 못했습니다. 작성한 표는 유지합니다.'); } }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  function restore() {
    const recovered = local.restore(); if (!recovered) return;
    ++readSequence.current; setValues(recovered.values); setBaseRevision(recovered.baseRevision);
    if (recovered.request) { request.current = recovered.request; setUncertain(true); startTransition(() => save(recovered.request!)); }
    else {
      setConflict(Boolean(snapshot && snapshot.revision !== recovered.baseRevision)); setLatest(snapshot && snapshot.revision !== recovered.baseRevision ? snapshot : null);
      setMessage('브라우저에 보관된 표를 복구했습니다. 내용을 확인하고 저장해주세요.'); setError(false);
    }
  }
  function acceptLatest(keepInput: boolean) {
    if (!latest) return;
    setSnapshot(latest); setBaseRevision(latest.revision); setConflict(false);
    if (keepInput) local.capture({ baseRevision: latest.revision, values, request: null }, true);
    else { setValues(latest.values); local.discard(); }
    setLatest(null); setError(false); setMessage(keepInput ? '최신 버전을 기준으로 작성한 표를 유지합니다. 저장하면 이 표가 반영됩니다.' : '최신 저장본으로 바꿨습니다.');
  }
  const locked = !snapshot || pending || uncertain || conflict || recoveryBlocked, preview = parseGoodsSizeChart(values.chart);
  return <div className="admin-goods-size-chart">
    <p>상품의 측정 치수를 별도로 저장합니다. 사이즈명은 구매 옵션과 자동으로 연결되지 않습니다. 템플릿은 자주 쓰는 표를 복사하는 기능입니다.</p>
    {local.unavailable ? <p role="status">이 브라우저에서는 입력을 자동 보관할 수 없습니다.</p> : null}
    {local.invalidRecovery ? <p role="alert">이전에 보관한 표를 읽을 수 없습니다. <button className="btn" type="button" onClick={local.discard}>읽을 수 없는 복구 기록 버리기</button></p> : null}
    {local.recovery ? <div className="admin-goods-size-chart__recovery"><p>{recoveryBlocked ? '이전 저장 요청의 결과 확인이 필요합니다.' : '이 브라우저에 최대 7일 보관된 미저장 표가 있습니다.'}</p><button className="btn" type="button" disabled={pending || (!snapshot && !recoveryBlocked)} onClick={restore}>{recoveryBlocked ? '이전 저장 요청 결과 확인' : '표 복구'}</button>{!recoveryBlocked ? <button className="btn" type="button" disabled={pending} onClick={local.discard}>복구 기록 버리기</button> : null}</div> : null}
    <form onSubmit={event => { event.preventDefault(); startTransition(() => save()); }}>
      <fieldset disabled={locked}>
        <legend className="wc-sr-only">상품 사이즈 안내 편집</legend>
        <label>공개 표시<select value={values.enabled ? 'enabled' : 'disabled'} onChange={event => change({ ...values, enabled: event.target.value === 'enabled' })}><option value="disabled">설정안함</option><option value="enabled">설정함</option></select></label>
        <p className="admin-goods-size-chart__hint">설정안함은 표를 보존하고 고객에게 표시하지 않습니다. 기존 표를 비우는 기능은 아닙니다.</p>
        <GoodsSizeChartFields chart={values.chart} onChange={chart => change({ ...values, chart })} />
        <div className="admin-goods-size-chart__actions"><button className="btn" type="button" onClick={() => setTemplates(true)}>사이즈 템플릿 불러오기</button><Link href={GOODS_SIZE_TEMPLATES_PATH} target="_blank" rel="noreferrer">사이즈 템플릿 관리 ↗</Link></div>
      </fieldset>
      {message ? <p role={error ? 'alert' : 'status'}>{message}</p> : null}
      <div className="admin-goods-size-chart__actions">
        {uncertain ? <button className="btn btn-primary" type="button" disabled={pending} onClick={() => startTransition(() => save())}>같은 요청 결과 확인</button> : <button className="btn btn-primary" disabled={locked}>사이즈 안내 저장</button>}
        <button className="btn" type="button" disabled={pending || uncertain || recoveryBlocked} onClick={() => startTransition(() => refresh())}>최신 저장본 확인</button>
      </div>
    </form>
    {latest ? <section className="admin-goods-size-chart__comparison" aria-label="최신 사이즈 저장본"><h3>최신 저장본 · {latest.values.enabled ? '설정함' : '설정안함'}</h3><GoodSizeChart chart={parseGoodsSizeChart(latest.values.chart)} /><div className="admin-goods-size-chart__actions"><button className="btn" type="button" disabled={pending} onClick={() => acceptLatest(true)}>최신 버전 기준으로 작성한 표 유지</button><button className="btn" type="button" disabled={pending} onClick={() => acceptLatest(false)}>최신 저장본으로 바꾸기</button></div></section> : null}
    {preview ? <details className="admin-goods-size-chart__preview"><summary>저장 전 사이즈 안내 미리보기</summary>{!values.enabled ? <p>현재 설정안함입니다. 저장해도 고객에게 표시하지 않습니다.</p> : null}<GoodSizeChart chart={preview} /></details> : null}
    {templates ? <GoodsSizeTemplatePicker onClose={() => setTemplates(false)} onSelect={template => { change({ enabled: values.enabled, chart: structuredClone(template.chart) }); setTemplates(false); setMessage('템플릿을 불러왔습니다. 공개 표시를 확인하고 사이즈 안내를 저장해주세요.'); setError(false); }} /> : null}
  </div>;
}
