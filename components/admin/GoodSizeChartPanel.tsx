'use client';
import Link from 'next/link';
import { startTransition, useEffect, useRef, useState } from 'react';
import { loadGoodsSizeChartAction, saveGoodsSizeChartAction, type GoodsSizeResult } from '@/app/admin/goods-size-chart-actions';
import { GOODS_SIZE_TEMPLATES_PATH, emptyGoodsSizeChartValues, parseGoodsSizeChart, parseGoodsSizeChartValues, type GoodsSizeChartSnapshot, type GoodsSizeChartValues } from '@/lib/goods-size-chart';
import { goodsSizeChartError } from '@/lib/admin/goods-size-chart-messages';
import { adminConfirm } from '@/lib/admin/confirm';
import { parseGoodsSizeDraft, type GoodsSizeSaveRequest } from '@/lib/admin/goods-size-chart-draft';
import { SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { GoodSizeChart } from '@/components/shop/GoodSizeChart';
import { GoodsSizeChartFields } from './GoodsSizeChartFields';
import { GoodsSizeTemplatePicker } from './GoodsSizeTemplatePicker';
import { useGoodsSizeRecovery } from './useGoodsSizeRecovery';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { GOOD_NOTE_CLASS } from './GoodEditorParts';

/* 템플릿 룩(ADR-0028). 미리보기는 표가 다 채워지면 펼쳐 보이고, 네이티브 펼침 표식으로 접을 수 있다. */
const DETAILS_CLASS = 'min-w-0 rounded-lg border';
const SUMMARY_CLASS = 'cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium outline-none select-none marker:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50';

export function GoodSizeChartPanel({ goodId, accountId }: { goodId: string; accountId: string }) {
  const [snapshot, setSnapshot] = useState<GoodsSizeChartSnapshot | null>(null);
  const [values, setValues] = useState<GoodsSizeChartValues>(emptyGoodsSizeChartValues);
  const [baseRevision, setBaseRevision] = useState(0), [latest, setLatest] = useState<GoodsSizeChartSnapshot | null>(null);
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(false), [templates, setTemplates] = useState(false);
  const busy = useRef(false), mounted = useRef(true), readSequence = useRef(0), request = useRef<GoodsSizeSaveRequest | null>(null);
  const local = useGoodsSizeRecovery({ accountId, recordId: goodId, formId: 'goods-size-chart', parse: parseGoodsSizeDraft });
  const recoveryBlocked = Boolean(local.recovery?.request);
  /* 표 전체를 한 칸으로 보관해 새 입력을 이전 기록에 합칠 수 없다. 복구나 버리기를 고르기 전에는 표를 고치거나 저장해 이전 기록을 덮지 않는다. */
  const recoveryPending = Boolean(local.recovery);

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
    if (recoveryPending) return;
    setValues(next); local.capture({ baseRevision, values: next, request: null });
  }
  async function save(restoredRequest?: GoodsSizeSaveRequest) {
    if (busy.current || (!snapshot && !restoredRequest && !request.current) || (recoveryPending && !restoredRequest && !request.current) || (conflict && !restoredRequest && !request.current)) return;
    const parsed = restoredRequest?.values ?? request.current?.values ?? parseGoodsSizeChartValues(values);
    if (!parsed) { setError(true); setMessage(goodsSizeChartError()); return; }
    const replaying = Boolean(restoredRequest || request.current);
    const fixed = restoredRequest ?? request.current ?? { values: parsed, revision: baseRevision, operationId: crypto.randomUUID() };
    request.current = fixed; ++readSequence.current; busy.current = true; setPending(true); setMessage('');
    local.capture({ baseRevision: fixed.revision, values: fixed.values, request: fixed }, true);
    let result: GoodsSizeResult<GoodsSizeChartSnapshot>;
    try { result = await saveGoodsSizeChartAction(goodId, fixed.values, fixed.revision, fixed.operationId); }
    catch { result = { ok: false, uncertain: true, error: SAVE_UNKNOWN_MESSAGE }; }
    let current: GoodsSizeChartSnapshot | null = null;
    if (result.ok && replaying) {
      try { const read = await loadGoodsSizeChartAction(goodId); if (read.ok) current = read.value; } catch { /* The receipt still confirms this operation. */ }
    }
    busy.current = false; if (!mounted.current) return; setPending(false);
    if (result.ok) {
      setSnapshot(result.value); setValues(result.value.values); setBaseRevision(result.value.revision); setLatest(null); setConflict(false); setUncertain(false); setError(false);
      request.current = null; local.discard(); setMessage(result.value.values.enabled ? '사이즈 안내를 저장했습니다.' : '고객 화면에는 표시하지 않습니다. 작성한 표는 그대로 보관했습니다.');
      if (replaying && !current) setMessage('앞서 누른 저장이 반영된 것을 확인했습니다. [최신 저장본 확인]을 눌러 지금 저장된 표를 봐 주세요.');
      if (current && current.revision !== result.value.revision) {
        setLatest(current); setConflict(true); local.capture({ baseRevision: result.value.revision, values: result.value.values, request: null }, true);
        setMessage('앞서 누른 저장이 반영된 것을 확인했습니다. 그 뒤에 표가 또 바뀌었으니 아래 최신 저장본도 확인해 주세요.');
      }
    } else {
      setError(true); setMessage(result.uncertain ? SAVE_UNKNOWN_MESSAGE : result.error); setUncertain(Boolean(result.uncertain)); setConflict(Boolean(result.conflict));
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
      setMessage('저장하지 않은 표를 복구했습니다. 내용을 확인하고 저장해 주세요.'); setError(false);
    }
  }
  /** [최신 저장본으로 바꾸기]는 작성한 표를 버린다. 작성한 표가 최신 저장본과 다르면 사라진다고 먼저 묻는다(화면 규칙 7). */
  async function replaceWithLatest() {
    if (!latest || recoveryPending) return;
    if (JSON.stringify(values) !== JSON.stringify(latest.values)
      && !await adminConfirm({ title: '작성한 표를 버리고 최신 저장본으로 바꿀까요?', message: '지금 작성한 표가 사라집니다.', confirmLabel: '최신 저장본으로 바꾸기' })) return;
    acceptLatest(false);
  }
  function acceptLatest(keepInput: boolean) {
    if (!latest || recoveryPending) return;
    setSnapshot(latest); setBaseRevision(latest.revision); setConflict(false);
    if (keepInput) local.capture({ baseRevision: latest.revision, values, request: null }, true);
    else { setValues(latest.values); local.discard(); }
    setLatest(null); setError(false); setMessage(keepInput ? '작성한 표를 유지하고 최신 저장본을 기준으로 바꿨습니다. 저장하면 이 표가 반영됩니다.' : '최신 저장본으로 바꿨습니다.');
  }
  const locked = !snapshot || pending || uncertain || conflict || recoveryPending, preview = parseGoodsSizeChart(values.chart);
  /* 공개 표시 선택은 상품마다 하나다(편집기 운영 섹션 하나에만 그린다). */
  const displayId = `good-size-display-${goodId}`;
  return <div className="flex min-w-0 flex-col gap-4 text-sm" data-goods-size-chart="">
    {local.unavailable ? <p className="text-muted-foreground" role="status">이 브라우저에서는 입력을 자동 보관할 수 없습니다.</p> : null}
    {local.invalidRecovery ? <p className="flex flex-wrap items-center gap-2 text-destructive" role="alert">브라우저에 보관해 둔 표를 읽지 못했습니다. <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" onClick={local.discard}>복구 기록 버리기</button></p> : null}
    {local.recovery ? <div className={`${GOOD_NOTE_CLASS} flex flex-wrap items-center gap-2`} data-goods-size-recovery=""><p className="min-w-0 flex-1 basis-60">{recoveryBlocked ? '앞서 누른 저장이 됐는지 아직 모릅니다. 먼저 확인해 주세요.' : '저장하지 않은 표가 이 브라우저에 남아 있습니다(최대 7일 보관). 복구하거나 버린 뒤 표를 고칠 수 있습니다.'}</p><button className={buttonVariants({ size: 'sm' })} data-slot="button" type="button" disabled={pending || (!snapshot && !recoveryBlocked)} onClick={restore}>{recoveryBlocked ? SAVE_CHECK_LABEL : '표 복구'}</button>{!recoveryBlocked ? <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" disabled={pending} onClick={local.discard}>복구 기록 버리기</button> : null}</div> : null}
    <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); startTransition(() => save()); }}>
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={locked}>
        <legend className="sr-only">상품 사이즈 안내 편집</legend>
        <div className="flex min-w-0 flex-col gap-2"><Label htmlFor={displayId}>고객 화면 표시</Label><NativeSelect className="w-full sm:w-72" id={displayId} value={values.enabled ? 'enabled' : 'disabled'} onChange={event => change({ ...values, enabled: event.target.value === 'enabled' })}><option value="disabled">표시 안 함 · 표는 그대로 보관</option><option value="enabled">표시</option></NativeSelect></div>
        <GoodsSizeChartFields chart={values.chart} onChange={chart => change({ ...values, chart })} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><button aria-haspopup="dialog" className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" onClick={() => setTemplates(true)}>사이즈 템플릿 고르기</button><Link className="text-sm underline underline-offset-4" href={GOODS_SIZE_TEMPLATES_PATH} target="_blank" rel="noreferrer">사이즈 템플릿 관리 ↗</Link></div>
      </fieldset>
      {message ? <p className={error ? 'text-sm text-destructive' : 'text-sm text-[var(--wc-success)]'} role={error ? 'alert' : 'status'}>{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        {uncertain ? <button className={buttonVariants()} data-slot="button" type="button" disabled={pending} onClick={() => startTransition(() => save())}>{SAVE_CHECK_LABEL}</button> : <button className={buttonVariants()} data-slot="button" type="submit" disabled={locked}>사이즈 안내 저장</button>}
        <button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" disabled={pending || uncertain || recoveryBlocked} onClick={() => startTransition(() => refresh())}>최신 저장본 확인</button>
      </div>
    </form>
    {latest ? <section className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/40 p-4" aria-label="최신 사이즈 저장본" data-goods-size-latest=""><h3 className="text-sm font-medium">최신 저장본 · {latest.values.enabled ? '표시' : '표시 안 함'}</h3><GoodSizeChart chart={parseGoodsSizeChart(latest.values.chart)} /><div className="flex flex-wrap gap-2"><button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" disabled={pending || recoveryPending} onClick={() => acceptLatest(true)}>최신 저장본 기준으로 작성한 표 유지</button><button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" disabled={pending || recoveryPending} onClick={() => { void replaceWithLatest(); }}>최신 저장본으로 바꾸기</button></div></section> : null}
    {preview ? <details className={DETAILS_CLASS} data-goods-size-preview="" open><summary className={SUMMARY_CLASS}>저장 전 사이즈 안내 미리보기</summary><div className="flex min-w-0 flex-col gap-3 border-t p-3">{!values.enabled ? <p className="text-muted-foreground">고객 화면 표시를 ‘표시 안 함’으로 두었습니다. 저장해도 보이지 않습니다.</p> : null}<GoodSizeChart chart={preview} /></div></details> : null}
    {/* 적어 둔 표가 있으면 선택창이 바꾸기 전에 묻는다. 고른 표는 [사이즈 안내 저장]을 눌러야 상품에 저장된다. */}
    {templates ? <GoodsSizeTemplatePicker current={values.chart} onClose={() => setTemplates(false)} onSelect={template => { change({ enabled: values.enabled, chart: structuredClone(template.chart) }); setMessage(`‘${template.name}’ 템플릿을 가져왔습니다. 고객 화면 표시를 확인하고 [사이즈 안내 저장]을 눌러 주세요.`); setError(false); }} /> : null}
  </div>;
}
