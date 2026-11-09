'use client';

import { startTransition, useEffect, useRef, useState } from 'react';
import { listGoodsSizeTemplatesAction, saveGoodsSizeTemplateAction, type GoodsSizeResult } from '@/app/admin/goods-size-chart-actions';
import { GOODS_SIZE_LIMITS, emptyGoodsSizeChart, parseGoodsSizeChart, parseGoodsSizeName, type GoodsSizeChart, type GoodsSizeTemplate, type GoodsSizeTemplatePage } from '@/lib/goods-size-chart';
import { parseGoodsSizeTemplateDraft, type GoodsSizeTemplateRequest } from '@/lib/admin/goods-size-chart-draft';
import { kstDateTimeText } from '@/lib/admin/list-export';
import { GoodSizeChart } from '@/components/shop/GoodSizeChart';
import { Plus } from 'lucide-react';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { AdminNotice, AdminPageHeader } from '../console/AdminKit';
import { AdminSelect } from '../console/AdminSelect';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { TableBody, TableCell, TableHead, TableRow } from '../kit/ui/table';
import { CONSOLE_FILTER_CARD_CLASS, CONSOLE_FILTER_FIELDS_CLASS, CONSOLE_FILTER_LABEL_CLASS, ConsoleFilterActions } from '../console/ConsoleFilterPanel';
import { CONSOLE_TABLE_FRAME_CLASS, ConsoleListCard, ConsoleTableEmptyRow, ConsoleTableHeader } from '../console/ConsoleListCard';
import { ConsolePagination } from '../console/ConsolePagination';
import { GoodsSizeChartFields } from '../GoodsSizeChartFields';
import { useGoodsSizeRecovery } from '../useGoodsSizeRecovery';

function SizeTemplateEditor({ accountId, template, onClose, onSaved }: { accountId: string; template: GoodsSizeTemplate | null; onClose: () => void; onSaved: () => void }) {
  const [id] = useState(() => template?.id ?? crypto.randomUUID());
  const [name, setName] = useState(template?.name ?? ''), [chart, setChart] = useState<GoodsSizeChart>(() => template?.chart ?? emptyGoodsSizeChart());
  const [baseRevision, setBaseRevision] = useState(template?.revision ?? 0), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false), [message, setMessage] = useState(''), [messageError, setMessageError] = useState(false);
  const busy = useRef(false), mounted = useRef(true), request = useRef<GoodsSizeTemplateRequest | null>(null);
  const local = useGoodsSizeRecovery({ accountId, formId: 'goods-size-template', recordId: template?.id ?? 'new', parse: parseGoodsSizeTemplateDraft });
  const recoveryBlocked = Boolean(local.recovery?.request);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function change(nextName: string, nextChart: GoodsSizeChart) {
    setName(nextName); setChart(nextChart); local.capture({ baseRevision, name: nextName, chart: nextChart, request: null });
  }
  async function save(archived = template?.archived ?? false, restoredRequest?: GoodsSizeTemplateRequest) {
    if (busy.current || (recoveryBlocked && !restoredRequest && !request.current) || (conflict && !restoredRequest && !request.current)) return;
    const parsed = restoredRequest?.chart ?? request.current?.chart ?? parseGoodsSizeChart(chart);
    const normalizedName = restoredRequest?.name ?? request.current?.name ?? parseGoodsSizeName(name, GOODS_SIZE_LIMITS.templateName);
    if (!parsed || !normalizedName) { setMessageError(true); setMessage('템플릿 이름(50자 이내)과 모든 치수를 확인해주세요.'); return; }
    const fixed = restoredRequest ?? request.current ?? { id, name: normalizedName, chart: parsed, archived, revision: baseRevision, operationId: crypto.randomUUID() };
    request.current = fixed; busy.current = true; setPending(true); setMessage('');
    local.capture({ baseRevision: fixed.revision, name: fixed.name, chart: fixed.chart, request: fixed }, true);
    let result: GoodsSizeResult<GoodsSizeTemplate>;
    try { result = await saveGoodsSizeTemplateAction(fixed.id, fixed.name, fixed.chart, fixed.archived, fixed.revision, fixed.operationId); }
    catch { result = { ok: false, uncertain: true, error: '저장 결과를 확인하지 못했습니다. 같은 요청 결과를 확인해주세요.' }; }
    busy.current = false; if (!mounted.current) return; setPending(false);
    if (!result.ok) {
      setMessageError(true); setMessage(result.error); setUncertain(Boolean(result.uncertain)); setConflict(Boolean(result.conflict));
      if (!result.uncertain) { request.current = null; local.capture({ baseRevision: fixed.revision, name: fixed.name, chart: fixed.chart, request: null }, true); }
      return;
    }
    request.current = null; local.discard(); onSaved();
  }
  function restore() {
    const restored = local.restore(); if (!restored) return;
    if (template && restored.request && restored.request.id !== template.id) { setMessageError(true); setMessage('다른 템플릿의 저장 요청은 복구할 수 없습니다.'); return; }
    setName(restored.name); setChart(restored.chart); setBaseRevision(restored.baseRevision);
    if (restored.request) { request.current = restored.request; setUncertain(true); startTransition(() => save(restored.request!.archived, restored.request!)); }
    else {
      setConflict((template?.revision ?? 0) !== restored.baseRevision);
      setMessageError(false);
      setMessage('미저장 표를 복구했습니다. 현재 템플릿과 내용을 확인하고 저장해주세요.');
    }
  }
  const locked = pending || uncertain || conflict || recoveryBlocked, preview = parseGoodsSizeChart(chart);
  return <CustomerServiceDialog title={template ? '사이즈 템플릿 수정' : '사이즈 템플릿 등록'} busy={pending || uncertain || recoveryBlocked} onClose={onClose} wide>
    <div className="flex min-w-0 flex-col gap-4" data-size-templates="editor">
      <p className="text-sm text-muted-foreground">내부 이름으로 표를 찾아 상품에 복사합니다. 이미 적용한 상품은 템플릿을 수정·보관해도 바뀌지 않습니다.</p>
      {local.unavailable ? <p className="text-sm text-muted-foreground" role="status">이 브라우저에서는 입력을 자동 보관할 수 없습니다.</p> : null}
      {local.invalidRecovery ? <p className="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">이전에 보관한 표를 읽을 수 없습니다. <Button size="sm" variant="outline" type="button" onClick={local.discard}>읽을 수 없는 복구 기록 버리기</Button></p> : null}
      {local.recovery ? <AdminNotice tone="warning"><p>{recoveryBlocked ? '이전 저장 요청의 결과를 먼저 확인해주세요.' : '이 브라우저에 최대 7일 보관된 미저장 템플릿이 있습니다.'}</p><div className="mt-2 flex flex-wrap items-center gap-2"><Button size="sm" type="button" disabled={pending} onClick={restore}>{recoveryBlocked ? '이전 저장 요청 결과 확인' : '템플릿 복구'}</Button>{!recoveryBlocked ? <Button size="sm" variant="outline" type="button" onClick={local.discard}>복구 기록 버리기</Button> : null}</div></AdminNotice> : null}
      <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); startTransition(() => save()); }}>
        <fieldset className="flex min-w-0 flex-col gap-3" disabled={locked}><legend className="sr-only">사이즈 템플릿 편집</legend>
          <label className="flex flex-col gap-2 text-sm font-medium">템플릿 이름<Input className="sm:max-w-md" value={name} onChange={event => change(event.target.value, chart)} /><small className="text-xs font-normal text-muted-foreground">{Array.from(name).length} / 50자 · 고객에게 표시하지 않습니다.</small></label>
          <GoodsSizeChartFields chart={chart} onChange={next => change(name, next)} />
        </fieldset>
        {message ? <p className={`text-sm${messageError ? ' text-destructive' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p> : null}
        {conflict && template && template.revision !== baseRevision ? <section className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/40 p-3"><h3 className="text-sm font-medium">현재 템플릿 · {template.name}</h3><GoodSizeChart chart={template.chart} /><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" type="button" onClick={() => { setBaseRevision(template.revision); setConflict(false); local.capture({ baseRevision: template.revision, name, chart, request: null }, true); setMessage('현재 템플릿을 기준으로 작성한 표를 유지합니다. 저장하면 이 표가 반영됩니다.'); }}>현재 템플릿 기준으로 표 유지</Button><Button size="sm" variant="outline" type="button" onClick={() => { setName(template.name); setChart(template.chart); setBaseRevision(template.revision); setConflict(false); local.discard(); setMessage('현재 템플릿으로 바꿨습니다.'); }}>현재 템플릿으로 바꾸기</Button></div></section> : null}
        <div className="flex flex-wrap justify-end gap-2 print:hidden">
          <Button variant="outline" type="button" disabled={pending || uncertain || recoveryBlocked} onClick={onClose}>닫기</Button>
          {conflict ? <Button variant="outline" type="button" disabled={pending} onClick={onSaved}>입력 보관하고 최신 목록 조회</Button> : null}
          {template ? <Button variant="outline" type="button" disabled={locked} onClick={() => startTransition(() => save(!template.archived))}>{template.archived ? '저장 후 복원' : '저장 후 보관'}</Button> : null}
          {uncertain ? <Button type="button" disabled={pending} onClick={() => startTransition(() => save())}>같은 요청 결과 확인</Button> : <Button type="submit" disabled={locked}>템플릿 저장</Button>}
        </div>
      </form>
      {preview ? <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">템플릿 미리보기</summary><div className="mt-3"><GoodSizeChart chart={preview} /></div></details> : null}
    </div>
  </CustomerServiceDialog>;
}

export function GoodsSizeTemplatesScreen({ accountId, onSelect }: { accountId?: string; onSelect?: (template: GoodsSizeTemplate) => void }) {
  const [data, setData] = useState<GoodsSizeTemplatePage | null>(null), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [archived, setArchived] = useState(false);
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [editor, setEditor] = useState<{ template: GoodsSizeTemplate | null } | null>(null);
  const busy = useRef(false), mounted = useRef(true), readSequence = useRef(0);
  useEffect(() => {
    mounted.current = true; let active = true; const sequence = ++readSequence.current;
    void listGoodsSizeTemplatesAction('', false, 1).then(result => {
      if (!active || sequence !== readSequence.current) return;
      if (result.ok) setData(result.value); else setMessage(result.error);
    }).catch(() => { if (active && sequence === readSequence.current) setMessage('사이즈 템플릿을 불러오지 못했습니다. 다시 조회해주세요.'); });
    return () => { active = false; mounted.current = false; };
  }, []);
  async function load(nextPage = 1, nextQuery = search, nextArchived = archived) {
    if (busy.current) return;
    const sequence = ++readSequence.current; busy.current = true; setPending(true); setMessage('');
    try {
      let result = await listGoodsSizeTemplatesAction(nextQuery, nextArchived, nextPage);
      if (result.ok && nextPage > Math.max(1, Math.ceil(result.value.total / 20))) result = await listGoodsSizeTemplatesAction(nextQuery, nextArchived, Math.max(1, Math.ceil(result.value.total / 20)));
      if (!mounted.current || sequence !== readSequence.current) return;
      if (result.ok) { setData(result.value); setSearch(nextQuery); setArchived(nextArchived); } else setMessage(result.error);
    } catch { if (mounted.current && sequence === readSequence.current) setMessage('사이즈 템플릿을 불러오지 못했습니다. 다시 조회해주세요.'); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="size-templates">
    {/* 템플릿 화면군 공통 골격: 머리(설명·등록) → 조회 카드([초기화][검색]) → 목록 카드(표·페이지 이동). 선택 팝업은 머리 없이 쓴다. */}
    {!onSelect ? <AdminPageHeader title="사이즈 템플릿 관리" description="자주 쓰는 사이즈표를 저장해 상품에서 불러옵니다. 상품에 적용한 값은 독립적으로 보존됩니다."
      actions={accountId ? <Button className="print:hidden" type="button" disabled={!data} onClick={() => setEditor({ template: null })}><Plus aria-hidden="true" />사이즈 템플릿 등록</Button> : undefined} /> : null}
    <form className={`${CONSOLE_FILTER_CARD_CLASS} print:hidden`} onSubmit={event => { event.preventDefault(); startTransition(() => load(1, query, archived)); }}>
      <div className={CONSOLE_FILTER_FIELDS_CLASS}>
        <label className={`${CONSOLE_FILTER_LABEL_CLASS} min-w-[min(100%,15rem)] flex-1`}>템플릿 이름 검색<Input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {!onSelect ? <label className={CONSOLE_FILTER_LABEL_CLASS}>보관 상태<AdminSelect disabled={pending} value={archived ? 'archived' : 'active'} onChange={event => startTransition(() => load(1, search, event.target.value === 'archived'))} wrapperClassName="w-40"><option value="active">사용 중</option><option value="archived">보관됨</option></AdminSelect></label> : null}
      </div>
      <ConsoleFilterActions>
        <Button variant="outline" type="button" disabled={pending} onClick={() => { setQuery(''); startTransition(() => load(1, '', false)); }}>초기화</Button>
        <Button type="submit" disabled={pending} variant="soft">검색</Button>
      </ConsoleFilterActions>
    </form>
    {message ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
    {data ? <ConsoleListCard headingLevel={3} title="조회 결과" total={data.total}>
      <div className={`${CONSOLE_TABLE_FRAME_CLASS} print:overflow-visible`} role="region" aria-label="사이즈 템플릿 목록 가로 스크롤" tabIndex={0}><table className="w-full min-w-[520px] caption-bottom text-sm" data-slot="table"><caption className="sr-only">사이즈 템플릿 목록</caption><ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead scope="col">템플릿 이름</TableHead><TableHead scope="col">사이즈</TableHead><TableHead scope="col">측정 항목</TableHead><TableHead scope="col">단위</TableHead><TableHead scope="col">수정일</TableHead><TableHead scope="col" className="w-24">{onSelect ? '선택' : '관리'}</TableHead></TableRow></ConsoleTableHeader><TableBody>
        {data.rows.map(row => <TableRow key={row.id}><TableHead scope="row" className="h-auto py-2 align-top font-medium whitespace-normal wrap-anywhere">{row.name}</TableHead><TableCell className="align-top whitespace-normal wrap-anywhere">{row.chart.sizes.join(', ')}</TableCell><TableCell className="align-top whitespace-normal wrap-anywhere">{row.chart.measurements.map(item => item.name).join(', ')}</TableCell><TableCell className="align-top">{row.chart.unit}</TableCell><TableCell className="align-top tabular-nums">{kstDateTimeText(row.updatedAt)}</TableCell><TableCell className="align-top"><Button size="xs" variant="outline" type="button" onClick={() => onSelect ? onSelect(row) : setEditor({ template: row })}>{onSelect ? '선택' : '수정'}</Button></TableCell></TableRow>)}
        {!data.rows.length ? <ConsoleTableEmptyRow colSpan={6}>등록된 사이즈 템플릿이 없습니다.</ConsoleTableEmptyRow> : null}
      </TableBody></table></div>
      <ConsolePagination className="print:hidden" label="사이즈 템플릿 페이지" page={data.page} pageSize={20} total={data.total} disabled={pending} onPageChange={page => startTransition(() => load(page))} />
    </ConsoleListCard> : <p className="text-sm text-muted-foreground" role="status">{message ? '조회 후 템플릿을 관리할 수 있습니다.' : '사이즈 템플릿을 불러오는 중…'}</p>}
    {editor && accountId ? <SizeTemplateEditor accountId={accountId} template={editor.template} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); startTransition(() => load(data?.page ?? 1)); }} /> : null}
  </section>;
}

export function GoodsSizeTemplatePicker({ onClose, onSelect }: { onClose: () => void; onSelect: (template: GoodsSizeTemplate) => void }) {
  return <CustomerServiceDialog title="사이즈 템플릿 불러오기" onClose={onClose} wide><GoodsSizeTemplatesScreen onSelect={onSelect} /></CustomerServiceDialog>;
}
