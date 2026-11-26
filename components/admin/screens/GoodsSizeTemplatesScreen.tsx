'use client';

import { startTransition, useEffect, useRef, useState } from 'react';
import { listGoodsSizeTemplatesAction, saveGoodsSizeTemplateAction, type GoodsSizeResult } from '@/app/admin/goods-size-chart-actions';
import { GOODS_SIZE_LIMITS, emptyGoodsSizeChart, parseGoodsSizeChart, parseGoodsSizeName, type GoodsSizeChart, type GoodsSizeTemplate, type GoodsSizeTemplatePage } from '@/lib/goods-size-chart';
import { adminConfirm } from '@/lib/admin/confirm';
import { parseGoodsSizeTemplateDraft, type GoodsSizeTemplateRequest } from '@/lib/admin/goods-size-chart-draft';
import { goodsSizeChartError } from '@/lib/admin/goods-size-chart-messages';
import {
  CHANGED_BY_OTHER, SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE, TEMPLATE_CLOSE_DIRTY_CONFIRM, TEMPLATE_DISCARD_INPUT_CONFIRM, TEMPLATE_DISCARD_INPUT_LABEL,
  TEMPLATE_LATEST_UNREAD_MESSAGE, TEMPLATE_SAVE_OVER_LATEST_LABEL, TEMPLATE_SAVE_OVER_LATEST_NOTE, findSavedTemplate, reopenClosedDialog, templateArchiveConfirm, templateCloseUnknownConfirm, templateKeptInBrowserNotice,
  templateSavedKind, templateSavedNotice, type TemplateSavedKind,
} from '@/lib/admin/goods-template-save';
import { kstDateTimeText } from '@/lib/admin/list-export';
import { GoodSizeChart } from '@/components/shop/GoodSizeChart';
import { Plus } from 'lucide-react';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { AdminNotice, AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminSelect } from '../console/AdminSelect';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { TableBody, TableCell, TableHead, TableRow } from '../kit/ui/table';
import { CONSOLE_FILTER_CARD_CLASS, CONSOLE_FILTER_FIELDS_CLASS, CONSOLE_FILTER_LABEL_CLASS, ConsoleFilterActions } from '../console/ConsoleFilterPanel';
import { CONSOLE_TABLE_FRAME_CLASS, ConsoleListCard, ConsoleTableEmptyRow, ConsoleTableHeader } from '../console/ConsoleListCard';
import { ConsolePagination } from '../console/ConsolePagination';
import { GoodsSizeChartFields } from '../GoodsSizeChartFields';
import { useGoodsSizeRecovery } from '../useGoodsSizeRecovery';

/* 템플릿 관리 화면(/admin/catalog/size-templates): 표 + [수정] 창. A/S·이벤트 템플릿 관리와 같은 모양이다. 상품에서 템플릿을 고르는 창은 공용 선택창(GoodsSizeTemplatePicker)이다. */
const LIST_FAILED = '목록을 불러오지 못했습니다. [검색]을 다시 눌러 주세요.';
const listAll = (archived: boolean, page: number) => listGoodsSizeTemplatesAction('', archived, page);
type Draft = { name: string; chart: GoodsSizeChart };

/*
 * 편집 창. [저장]은 적은 표를, [보관]·[복원]은 보관 상태만 바꾼다(고친 내용이 있으면 사라진다고 먼저 묻는다).
 * 다른 사람이 먼저 바꿨으면 입력을 그대로 둔 채 두 길을 고른다: 내 입력으로 덮어쓰기 / 내 입력 버리기.
 * 적은 표는 이 브라우저에 최대 7일 보관돼, 저장하지 않고 닫아도 다시 열어 복구할 수 있다.
 * 저장·보관·복원에 성공하면 무엇을 했는지 `onSaved`로 알려 목록 위에 결과 한 줄을 보이게 한다. 입력을 버리거나 고친 것 없이 닫을 때는 알리지 않는다.
 * 고친 표를 저장하지 않고 닫으면 `onClose(true)`로 알린다 — 묻지 않고 닫히므로 목록 위에 '브라우저에 남아 있다'는 한 줄을 보이게 한다.
 */
function SizeTemplateEditor({ accountId, template, onClose, onSaved }: { accountId: string; template: GoodsSizeTemplate | null; onClose: (keptInBrowser?: boolean) => void; onSaved: (kind?: TemplateSavedKind) => void }) {
  const [id] = useState(() => template?.id ?? crypto.randomUUID());
  const [name, setName] = useState(template?.name ?? ''), [chart, setChart] = useState<GoodsSizeChart>(() => template?.chart ?? emptyGoodsSizeChart());
  const [baseRevision, setBaseRevision] = useState(template?.revision ?? 0), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false), [message, setMessage] = useState(''), [messageError, setMessageError] = useState(false);
  /* base: 지금 입력이 딛고 선 저장 내용. latest: 다른 사람이 먼저 바꿨을 때 찾아 둔 지금 저장 내용. sameName: 같은 이름의 다른 템플릿이 있다고 확인된 이름. */
  const [base, setBase] = useState(template), [latest, setLatest] = useState<GoodsSizeTemplate | null>(null), [sameName, setSameName] = useState('');
  const busy = useRef(false), mounted = useRef(true), request = useRef<GoodsSizeTemplateRequest | null>(null), root = useRef<HTMLDivElement>(null);
  const local = useGoodsSizeRecovery({ accountId, formId: 'goods-size-template', recordId: template?.id ?? 'new', parse: parseGoodsSizeTemplateDraft });
  const recoveryBlocked = Boolean(local.recovery?.request);
  /* 템플릿 전체를 한 칸으로 보관해 새 입력을 이전 기록에 합칠 수 없다. 복구나 버리기를 고르기 전에는 고치거나 저장해 이전 기록을 덮지 않는다. */
  const recoveryPending = Boolean(local.recovery);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = name !== (base?.name ?? '') || JSON.stringify(chart) !== JSON.stringify(base?.chart ?? emptyGoodsSizeChart());

  function change(nextName: string, nextChart: GoodsSizeChart) {
    if (recoveryPending) return;
    setName(nextName); setChart(nextChart); local.capture({ baseRevision, name: nextName, chart: nextChart, request: null });
  }
  /** 지금 적은 이름과 표를 저장할 수 있는 모양으로 읽는다. 안 되면 무엇을 고칠지 알리고 null. */
  function readInput() {
    const normalizedName = parseGoodsSizeName(name, GOODS_SIZE_LIMITS.templateName), parsed = parseGoodsSizeChart(chart);
    if (normalizedName && parsed) return { name: normalizedName, chart: parsed };
    setMessageError(true); setMessage(normalizedName ? goodsSizeChartError() : '템플릿 이름을 1~50자로 적어 주세요.');
    return null;
  }
  /**
   * 저장을 보낸다. `keep`은 저장하지 못했을 때 브라우저에 다시 보관할 입력이다.
   * `kind`는 성공했을 때 목록에 알릴 일이다. 주지 않으면(저장됐는지 다시 확인할 때) 보낸 보관 상태가 목록에서 보던 것과 달라졌는지로 가린다.
   */
  async function send(fixed: GoodsSizeTemplateRequest, keep: Draft, kind: TemplateSavedKind = templateSavedKind(template?.archived ?? false, fixed.archived)) {
    if (busy.current) return;
    request.current = fixed; busy.current = true; setPending(true); setMessage('');
    local.capture({ baseRevision: fixed.revision, name: fixed.name, chart: fixed.chart, request: fixed }, true);
    let result: GoodsSizeResult<GoodsSizeTemplate>;
    try { result = await saveGoodsSizeTemplateAction(fixed.id, fixed.name, fixed.chart, fixed.archived, fixed.revision, fixed.operationId); }
    catch { result = { ok: false, uncertain: true, error: SAVE_UNKNOWN_MESSAGE }; }
    if (result.ok) { busy.current = false; if (!mounted.current) return; setPending(false); request.current = null; local.discard(); onSaved(kind); return; }
    /* 다른 사람이 먼저 바꿨으면 지금 저장된 템플릿을 찾아 함께 보인다. 못 찾아도 입력은 그대로 둔다. */
    const found = result.conflict ? await findSavedTemplate(fixed.id, listAll) : null;
    busy.current = false; if (!mounted.current) return; setPending(false);
    setMessageError(true);
    if (result.uncertain) { setUncertain(true); setMessage(SAVE_UNKNOWN_MESSAGE); return; }
    request.current = null; setUncertain(false); setMessage(result.error);
    local.capture({ baseRevision: fixed.revision, name: keep.name, chart: keep.chart, request: null }, true);
    if (result.conflict) { setConflict(true); setLatest(found && found !== 'failed' ? found : null); }
  }
  function saveInput() {
    if (busy.current || recoveryPending || uncertain || conflict) return;
    const input = readInput(); if (!input) return;
    void send({ id, ...input, archived: base?.archived ?? false, revision: baseRevision, operationId: crypto.randomUUID() }, { name, chart }, 'saved');
  }
  async function toggleArchive() {
    if (!base || busy.current || recoveryPending || uncertain || conflict) return;
    if (dirty && !await adminConfirm(templateArchiveConfirm(!base.archived))) return;
    void send({ id, name: base.name, chart: base.chart, archived: !base.archived, revision: baseRevision, operationId: crypto.randomUUID() }, { name, chart });
  }
  async function saveOverLatest() {
    if (busy.current || recoveryPending) return;
    const input = readInput(); if (!input) return;
    let target = latest;
    if (!target) {
      busy.current = true; setPending(true);
      const found = await findSavedTemplate(id, listAll);
      busy.current = false; if (!mounted.current) return; setPending(false);
      if (!found || found === 'failed') { setMessageError(true); setMessage(TEMPLATE_LATEST_UNREAD_MESSAGE); return; }
      target = found;
    }
    setBase(target); setBaseRevision(target.revision); setLatest(null); setConflict(false);
    void send({ id, ...input, archived: target.archived, revision: target.revision, operationId: crypto.randomUUID() }, { name, chart }, 'saved');
  }
  async function discardInput() {
    if (busy.current) return;
    if (!await adminConfirm(TEMPLATE_DISCARD_INPUT_CONFIRM)) return;
    local.discard(); onSaved();
  }
  async function close() {
    if (busy.current) return;
    if (uncertain) { if (await adminConfirm(templateCloseUnknownConfirm(true, template ? undefined : '사이즈 템플릿 등록'))) onSaved(); else reopenClosedDialog(root.current); return; }
    /* 적은 표는 브라우저에 보관돼 다시 열면 복구할 수 있다. 보관하지 못하는 브라우저에서만 사라진다고 묻는다. */
    if (dirty && local.unavailable && !await adminConfirm(TEMPLATE_CLOSE_DIRTY_CONFIRM)) { reopenClosedDialog(root.current); return; }
    if (conflict) onSaved(); else onClose(dirty && !local.unavailable);
  }
  function restore() {
    const restored = local.restore(); if (!restored) return;
    if (template && restored.request && restored.request.id !== template.id) { setMessageError(true); setMessage('다른 템플릿을 저장하던 기록이라 여기서는 복구할 수 없습니다.'); return; }
    setName(restored.name); setChart(restored.chart); setBaseRevision(restored.baseRevision);
    if (restored.request) { const fixed = restored.request; request.current = fixed; setUncertain(true); startTransition(() => send(fixed, { name: restored.name, chart: restored.chart })); return; }
    /* 보관해 둔 뒤로 다른 사람이 템플릿을 바꿨으면 복구한 표를 그대로 둔 채 두 길을 고르게 한다. */
    const changed = (template?.revision ?? 0) !== restored.baseRevision;
    setConflict(changed); setLatest(changed ? template : null); setMessageError(changed);
    setMessage(changed ? `${CHANGED_BY_OTHER} 복구한 표는 그대로 있습니다.` : '저장하지 않은 표를 복구했습니다. 내용을 확인하고 저장해 주세요.');
  }
  /** 같은 이름의 다른 템플릿이 있는지 본다. 알리기만 하고 저장은 막지 않는다(선택창에서는 사이즈·측정 항목으로 구분된다). */
  async function checkSameName() {
    const wanted = parseGoodsSizeName(name, GOODS_SIZE_LIMITS.templateName);
    if (!wanted) { setSameName(''); return; }
    try {
      const result = await listGoodsSizeTemplatesAction(wanted, false, 1);
      if (mounted.current && result?.ok) setSameName(result.value.rows.some(row => row.id !== id && row.name === wanted) ? wanted : '');
    } catch { /* 알림일 뿐이라 조회하지 못하면 그대로 둔다. */ }
  }
  const locked = pending || uncertain || recoveryPending, preview = parseGoodsSizeChart(chart);
  return <CustomerServiceDialog title={template ? '사이즈 템플릿 수정' : '사이즈 템플릿 등록'} busy={pending} onClose={() => { void close(); }} wide>
    <div className="flex min-w-0 flex-col gap-4" data-size-templates="editor" ref={root}>
      {local.unavailable ? <p className="text-sm text-muted-foreground" role="status">이 브라우저에서는 입력을 자동 보관할 수 없습니다. 닫기 전에 저장해 주세요.</p> : null}
      {local.invalidRecovery ? <p className="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">브라우저에 보관해 둔 표를 읽지 못했습니다. <Button size="sm" variant="outline" type="button" onClick={local.discard}>복구 기록 버리기</Button></p> : null}
      {local.recovery ? <AdminNotice tone="warning"><p>{recoveryBlocked ? '앞서 누른 저장이 됐는지 아직 모릅니다. 먼저 확인해 주세요.' : '저장하지 않은 템플릿이 이 브라우저에 남아 있습니다(최대 7일 보관). 복구하거나 버린 뒤 템플릿을 고칠 수 있습니다.'}</p><div className="mt-2 flex flex-wrap items-center gap-2"><Button size="sm" type="button" disabled={pending} onClick={restore}>{recoveryBlocked ? SAVE_CHECK_LABEL : '템플릿 복구'}</Button>{!recoveryBlocked ? <Button size="sm" variant="outline" type="button" onClick={local.discard}>복구 기록 버리기</Button> : null}</div></AdminNotice> : null}
      <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); saveInput(); }}>
        <fieldset className="flex min-w-0 flex-col gap-3" disabled={locked}><legend className="sr-only">템플릿 이름과 사이즈표</legend>
          <label className="flex flex-col gap-2 text-sm font-medium">템플릿 이름<Input className="sm:max-w-md" value={name} onChange={event => change(event.target.value, chart)} onBlur={() => { void checkSameName(); }} /><small className="text-xs font-normal text-muted-foreground">{Array.from(name).length} / 50자 · 고객에게는 보이지 않는 이름입니다.</small>{sameName && sameName === parseGoodsSizeName(name, GOODS_SIZE_LIMITS.templateName) ? <small className="text-xs font-normal text-warning" data-size-template-same-name="">같은 이름의 템플릿이 이미 있습니다. 고를 때 헷갈리지 않게 이름을 다르게 적어 주세요.</small> : null}</label>
          <GoodsSizeChartFields chart={chart} onChange={next => change(name, next)} />
        </fieldset>
        {conflict ? <AdminNotice tone="warning" role="alert">
          <p>{message}</p>
          {latest ? <div className="mt-2 flex min-w-0 flex-col gap-2" data-goods-template-latest=""><strong className="font-medium">지금 저장된 템플릿 · {latest.name}{latest.archived ? ' · 보관됨' : ''}</strong><GoodSizeChart chart={latest.chart} /></div> : null}
          <p className="mt-2 text-xs" data-goods-template-overwrite-note="">{TEMPLATE_SAVE_OVER_LATEST_NOTE}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" type="button" disabled={pending || recoveryPending} onClick={() => { void saveOverLatest(); }}>{TEMPLATE_SAVE_OVER_LATEST_LABEL}</Button>
            <Button size="sm" variant="outline" type="button" disabled={pending} onClick={() => { void discardInput(); }}>{TEMPLATE_DISCARD_INPUT_LABEL}</Button>
          </div>
        </AdminNotice> : message ? <p className={`text-sm${messageError ? ' text-destructive' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 print:hidden">
          <Button variant="ghost" type="button" disabled={pending} onClick={() => { void close(); }}>닫기</Button>
          {base && !conflict ? <Button variant="outline" type="button" disabled={locked} onClick={() => { void toggleArchive(); }}>{base.archived ? '복원' : '보관'}</Button> : null}
          {uncertain ? <Button type="button" disabled={pending} onClick={() => { const fixed = request.current; if (fixed) startTransition(() => send(fixed, { name, chart })); }}>{SAVE_CHECK_LABEL}</Button>
            : conflict ? null : <Button type="submit" disabled={locked}>저장</Button>}
        </div>
      </form>
      {preview ? <details className="rounded-lg border p-3 text-sm" open><summary className="cursor-pointer font-medium">템플릿 미리보기</summary><div className="mt-3"><GoodSizeChart chart={preview} /></div></details> : null}
    </div>
  </CustomerServiceDialog>;
}

export function GoodsSizeTemplatesScreen({ accountId }: { accountId: string }) {
  const [data, setData] = useState<GoodsSizeTemplatePage | null>(null), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [archived, setArchived] = useState(false);
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [editor, setEditor] = useState<{ template: GoodsSizeTemplate | null } | null>(null);
  /* 저장·보관·복원 뒤의 결과 한 줄. 다음 조회(검색·보관 상태·페이지 이동)에서 지운다. */
  const [notice, setNotice] = useState('');
  const busy = useRef(false), mounted = useRef(true), readSequence = useRef(0);
  useEffect(() => {
    mounted.current = true; let active = true; const sequence = ++readSequence.current;
    void listGoodsSizeTemplatesAction('', false, 1).then(result => {
      if (!active || sequence !== readSequence.current) return;
      if (result.ok) setData(result.value); else setMessage(result.error);
    }).catch(() => { if (active && sequence === readSequence.current) setMessage(LIST_FAILED); });
    return () => { active = false; mounted.current = false; };
  }, []);
  async function load(nextPage = 1, nextQuery = search, nextArchived = archived, nextNotice = '') {
    if (busy.current) return;
    const sequence = ++readSequence.current; busy.current = true; setPending(true); setMessage(''); setNotice(nextNotice);
    try {
      let result = await listGoodsSizeTemplatesAction(nextQuery, nextArchived, nextPage);
      if (result.ok && nextPage > Math.max(1, Math.ceil(result.value.total / 20))) result = await listGoodsSizeTemplatesAction(nextQuery, nextArchived, Math.max(1, Math.ceil(result.value.total / 20)));
      if (!mounted.current || sequence !== readSequence.current) return;
      if (result.ok) { setData(result.value); setSearch(nextQuery); setArchived(nextArchived); } else setMessage(result.error);
    } catch { if (mounted.current && sequence === readSequence.current) setMessage(LIST_FAILED); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  /* 템플릿 화면군 공통 골격: 머리(설명·등록) → 조회 카드([초기화][검색]) → 목록 카드(표·페이지 이동) → [수정] 창. */
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="size-templates">
    <AdminPageHeader title="사이즈 템플릿 관리" description="템플릿을 고치거나 보관해도 이미 가져간 상품은 바뀌지 않습니다."
      actions={<Button className="print:hidden" type="button" disabled={!data} onClick={() => setEditor({ template: null })}><Plus aria-hidden="true" />사이즈 템플릿 등록</Button>} />
    <form className={`${CONSOLE_FILTER_CARD_CLASS} print:hidden`} onSubmit={event => { event.preventDefault(); startTransition(() => load(1, query, archived)); }}>
      <div className={CONSOLE_FILTER_FIELDS_CLASS}>
        <label className={`${CONSOLE_FILTER_LABEL_CLASS} min-w-[min(100%,15rem)] flex-1`}>템플릿 이름 검색<Input type="search" value={query} onChange={event => setQuery(event.target.value)} maxLength={100} /></label>
        <label className={CONSOLE_FILTER_LABEL_CLASS}>보관 상태<AdminSelect disabled={pending} value={archived ? 'archived' : 'active'} onChange={event => startTransition(() => load(1, search, event.target.value === 'archived'))} wrapperClassName="w-40"><option value="active">사용 중</option><option value="archived">보관됨</option></AdminSelect></label>
      </div>
      <ConsoleFilterActions>
        <Button variant="ghost" type="button" disabled={pending} onClick={() => { setQuery(''); startTransition(() => load(1, '', false)); }}>초기화</Button>
        <Button type="submit" disabled={pending} variant="soft">검색</Button>
      </ConsoleFilterActions>
    </form>
    {message ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
    {notice ? <p className="text-sm" data-goods-template-notice="" role="status">{notice}</p> : null}
    {data ? <ConsoleListCard headingLevel={3} title="조회 결과" total={data.total}>
      <div className={`${CONSOLE_TABLE_FRAME_CLASS} print:overflow-visible`} role="region" aria-label="사이즈 템플릿 목록 가로 스크롤" tabIndex={0}><table className="w-full min-w-[520px] caption-bottom text-sm" data-slot="table"><caption className="sr-only">사이즈 템플릿 목록</caption><ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead scope="col">템플릿 이름</TableHead><TableHead scope="col">사이즈</TableHead><TableHead scope="col">측정 항목</TableHead><TableHead scope="col">단위</TableHead><TableHead scope="col">수정일</TableHead><TableHead scope="col">상태</TableHead><TableHead scope="col" className="w-24">관리</TableHead></TableRow></ConsoleTableHeader><TableBody>
        {data.rows.map(row => <TableRow key={row.id}><TableHead scope="row" className="h-auto bg-transparent py-2 align-top text-sm font-medium whitespace-normal wrap-anywhere text-foreground">{row.name}</TableHead><TableCell className="align-top whitespace-normal wrap-anywhere">{row.chart.sizes.join(', ')}</TableCell><TableCell className="align-top whitespace-normal wrap-anywhere">{row.chart.measurements.map(item => item.name).join(', ')}</TableCell><TableCell className="align-top">{row.chart.unit}</TableCell><TableCell className="align-top tabular-nums">{kstDateTimeText(row.updatedAt).replaceAll('-', '.')}</TableCell><TableCell className="align-top"><AdminStatusBadge tone={statusTone('setting', row.archived ? 'archived' : 'active')}>{row.archived ? '보관됨' : '사용 중'}</AdminStatusBadge></TableCell><TableCell className="align-top"><Button size="xs" variant="outline" type="button" onClick={() => setEditor({ template: row })}>수정</Button></TableCell></TableRow>)}
        {!data.rows.length ? <ConsoleTableEmptyRow colSpan={7}>{search ? '조건에 맞는 템플릿이 없습니다.' : archived ? '보관한 템플릿이 없습니다.' : '등록된 사이즈 템플릿이 없습니다.'}</ConsoleTableEmptyRow> : null}
      </TableBody></table></div>
      <ConsolePagination className="print:hidden" label="사이즈 템플릿 페이지" page={data.page} pageSize={20} total={data.total} disabled={pending} onPageChange={page => startTransition(() => load(page))} />
    </ConsoleListCard> : message ? null : <p className="text-sm text-muted-foreground" role="status">템플릿을 불러오는 중…</p>}
    {editor ? <SizeTemplateEditor key={editor.template?.id ?? 'new'} accountId={accountId} template={editor.template} onClose={kept => { if (kept) setNotice(templateKeptInBrowserNotice('사이즈 템플릿 등록', editor.template?.name)); setEditor(null); }} onSaved={kind => { const done = kind ? templateSavedNotice(kind) : ''; setEditor(null); setNotice(done); startTransition(() => load(data?.page ?? 1, search, archived, done)); }} /> : null}
  </section>;
}
