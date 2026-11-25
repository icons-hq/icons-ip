'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { listGoodsEventTemplatesAction, saveGoodsEventTemplateAction, type GoodsBenefitsResult } from '@/app/admin/goods-benefit-actions';
import type { GoodsEventTemplate, GoodsEventTemplatePage } from '@/lib/goods-benefits';
import { adminConfirm } from '@/lib/admin/confirm';
import {
  SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE, TEMPLATE_CLOSE_DIRTY_CONFIRM, TEMPLATE_DISCARD_INPUT_CONFIRM, TEMPLATE_DISCARD_INPUT_LABEL,
  TEMPLATE_LATEST_UNREAD_MESSAGE, TEMPLATE_SAVE_OVER_LATEST_LABEL, findSavedTemplate, reopenClosedDialog, templateArchiveConfirm, templateCloseUnknownConfirm,
} from '@/lib/admin/goods-template-save';
import { kstDateTimeText } from '@/lib/admin/list-export';
import { Plus } from 'lucide-react';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { AdminNotice, AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminSelect } from '../console/AdminSelect';
import { CONSOLE_FILTER_CARD_CLASS, CONSOLE_FILTER_FIELDS_CLASS, CONSOLE_FILTER_LABEL_CLASS, ConsoleFilterActions } from '../console/ConsoleFilterPanel';
import { CONSOLE_TABLE_FRAME_CLASS, ConsoleListCard, ConsoleTableEmptyRow, ConsoleTableHeader } from '../console/ConsoleListCard';
import { ConsolePagination } from '../console/ConsolePagination';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { TableBody, TableCell, TableHead, TableRow } from '../kit/ui/table';

/* 템플릿 관리 화면(/admin/catalog/event-templates): 표 + [수정] 창. 사이즈·A/S 템플릿 관리와 같은 모양이다. 상품에서 템플릿을 고르는 창은 공용 선택창(GoodsEventTemplatePicker)이다. */
const LIST_FAILED = '목록을 불러오지 못했습니다. [검색]을 다시 눌러 주세요.';

type SaveRequest = { id: string; text: string; archived: boolean; revision: number; operationId: string };
const listAll = (archived: boolean, page: number) => listGoodsEventTemplatesAction('', archived, page);
/** 저장하기 전에 무엇이 안 되는지 말한다. 문제가 없으면 null. */
const textProblem = (text: string) => !text.trim() ? '이벤트 문구를 적어 주세요.' : Array.from(text.trim()).length > 40 ? '이벤트 문구는 40자까지 적을 수 있습니다.' : null;

/*
 * 편집 창. [저장]은 적은 문구를, [보관]·[복원]은 보관 상태만 바꾼다(고친 문구가 있으면 사라진다고 먼저 묻는다).
 * 다른 사람이 먼저 바꿨으면 입력을 그대로 둔 채 두 길을 고른다: 최신 내용 위에 내 입력으로 저장 / 내 입력 버리기.
 * 저장됐는지 모를 때는 같은 내용을 다시 보내 확인하고, 그래도 안 되면 [닫기]로 나가 목록에서 확인한다.
 */
function EventTemplateEditor({ template, onClose, onSaved }: { template: GoodsEventTemplate | null; onClose: () => void; onSaved: () => void }) {
  const [id] = useState(() => template?.id ?? crypto.randomUUID());
  const [text, setText] = useState(template?.eventText ?? '');
  /* base: 지금 입력이 딛고 선 저장 내용. latest: 다른 사람이 먼저 바꿨을 때 찾아 둔 지금 저장 내용. */
  const [base, setBase] = useState(template), [latest, setLatest] = useState<GoodsEventTemplate | null>(null);
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false), [message, setMessage] = useState('');
  const busy = useRef(false), request = useRef<SaveRequest | null>(null), form = useRef<HTMLFormElement>(null);
  const dirty = text !== (base?.eventText ?? '');

  async function send(fixed: SaveRequest) {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage(''); request.current = fixed;
    let result: GoodsBenefitsResult<GoodsEventTemplate>;
    try { result = await saveGoodsEventTemplateAction(fixed.id, fixed.text, fixed.archived, fixed.revision, fixed.operationId); }
    catch { result = { ok: false, uncertain: true, error: SAVE_UNKNOWN_MESSAGE }; }
    if (result.ok) { busy.current = false; request.current = null; setPending(false); onSaved(); return; }
    /* 다른 사람이 먼저 바꿨으면 지금 저장된 문구를 찾아 함께 보인다. 못 찾아도 입력은 그대로 둔다. */
    const found = result.conflict ? await findSavedTemplate(id, listAll) : null;
    busy.current = false; setPending(false);
    if (result.uncertain) { setUncertain(true); setMessage(SAVE_UNKNOWN_MESSAGE); return; }
    request.current = null; setUncertain(false); setMessage(result.error);
    if (result.conflict) { setConflict(true); setLatest(found && found !== 'failed' ? found : null); }
  }
  function saveInput() {
    if (busy.current || uncertain || conflict) return;
    const problem = textProblem(text);
    if (problem) { setMessage(problem); return; }
    void send({ id, text, archived: base?.archived ?? false, revision: base?.revision ?? 0, operationId: crypto.randomUUID() });
  }
  async function toggleArchive() {
    if (!base || busy.current || uncertain || conflict) return;
    if (dirty && !await adminConfirm(templateArchiveConfirm(!base.archived))) return;
    void send({ id, text: base.eventText, archived: !base.archived, revision: base.revision, operationId: crypto.randomUUID() });
  }
  async function saveOverLatest() {
    if (busy.current) return;
    const problem = textProblem(text);
    if (problem) { setMessage(problem); return; }
    let target = latest;
    if (!target) {
      busy.current = true; setPending(true);
      const found = await findSavedTemplate(id, listAll);
      busy.current = false; setPending(false);
      if (!found || found === 'failed') { setMessage(TEMPLATE_LATEST_UNREAD_MESSAGE); return; }
      target = found;
    }
    setBase(target); setLatest(null); setConflict(false);
    void send({ id, text, archived: target.archived, revision: target.revision, operationId: crypto.randomUUID() });
  }
  async function discardInput() {
    if (busy.current) return;
    if (await adminConfirm(TEMPLATE_DISCARD_INPUT_CONFIRM)) onSaved();
  }
  async function close() {
    if (busy.current) return;
    if (uncertain) { if (await adminConfirm(templateCloseUnknownConfirm(false))) onSaved(); else reopenClosedDialog(form.current); return; }
    if (dirty && !await adminConfirm(TEMPLATE_CLOSE_DIRTY_CONFIRM)) { reopenClosedDialog(form.current); return; }
    if (conflict) onSaved(); else onClose();
  }

  return <CustomerServiceDialog title={template ? '이벤트 템플릿 수정' : '이벤트 템플릿 등록'} busy={pending} onClose={() => { void close(); }}>
    <form ref={form} onSubmit={(event: FormEvent) => { event.preventDefault(); saveInput(); }} className="flex min-w-0 flex-col gap-4" data-goods-event-template-form="">
      <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={pending || uncertain}><label className="flex flex-col gap-2 text-sm font-medium">이벤트 문구<Input value={text} onChange={event => setText(event.target.value)} maxLength={40} required /></label><span className="text-xs text-muted-foreground tabular-nums">{Array.from(text).length}/40</span></fieldset>
      {conflict ? <AdminNotice tone="warning" role="alert">
        <p>{message}</p>
        {latest ? <p className="mt-2" data-goods-template-latest=""><strong className="font-medium">지금 저장된 문구{latest.archived ? ' · 보관됨' : ''}</strong> {latest.eventText}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" type="button" disabled={pending} onClick={() => { void saveOverLatest(); }}>{TEMPLATE_SAVE_OVER_LATEST_LABEL}</Button>
          <Button size="sm" variant="outline" type="button" disabled={pending} onClick={() => { void discardInput(); }}>{TEMPLATE_DISCARD_INPUT_LABEL}</Button>
        </div>
      </AdminNotice> : message ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" type="button" disabled={pending} onClick={() => { void close(); }}>닫기</Button>
        {base && !conflict ? <Button variant="outline" type="button" disabled={pending || uncertain} onClick={() => { void toggleArchive(); }}>{base.archived ? '복원' : '보관'}</Button> : null}
        {uncertain ? <Button type="button" disabled={pending} onClick={() => { if (request.current) void send(request.current); }}>{SAVE_CHECK_LABEL}</Button>
          : conflict ? null : <Button type="submit" disabled={pending}>저장</Button>}
      </div>
    </form>
  </CustomerServiceDialog>;
}

export function GoodsEventTemplatesScreen() {
  const [data, setData] = useState<GoodsEventTemplatePage | null>(null), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [archived, setArchived] = useState(false);
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [editor, setEditor] = useState<{ template: GoodsEventTemplate | null } | null>(null);
  const busy = useRef(false), mounted = useRef(true), readSequence = useRef(0);
  useEffect(() => {
    mounted.current = true; let active = true; const sequence = ++readSequence.current;
    void listGoodsEventTemplatesAction('', false, 1).then(result => {
      if (!active || sequence !== readSequence.current) return; if (result.ok) setData(result.value); else setMessage(result.error);
    }).catch(() => { if (active && sequence === readSequence.current) setMessage(LIST_FAILED); });
    return () => { active = false; mounted.current = false; };
  }, []);
  async function load(nextPage = 1, nextQuery = search, nextArchived = archived) {
    if (busy.current) return;
    const sequence = ++readSequence.current;
    busy.current = true; setPending(true); setMessage('');
    try {
      let result = await listGoodsEventTemplatesAction(nextQuery, nextArchived, nextPage);
      if (result.ok && nextPage > Math.max(1, Math.ceil(result.value.total / 20))) result = await listGoodsEventTemplatesAction(nextQuery, nextArchived, Math.max(1, Math.ceil(result.value.total / 20)));
      if (!mounted.current || sequence !== readSequence.current) return;
      if (result.ok) { setData(result.value); setSearch(nextQuery); setArchived(nextArchived); }
      else setMessage(result.error);
    } catch { if (mounted.current && sequence === readSequence.current) setMessage(LIST_FAILED); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  /* 템플릿 화면군 공통 골격: 머리(설명·등록) → 조회 카드([초기화][검색]) → 목록 카드(표·페이지 이동) → [수정] 창. */
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="event-templates">
    <AdminPageHeader title="이벤트 템플릿 관리" description="템플릿을 고치거나 보관해도 이미 가져간 상품은 바뀌지 않습니다."
      actions={<Button type="button" disabled={!data} onClick={() => setEditor({ template: null })}><Plus aria-hidden="true" />이벤트 템플릿 등록</Button>} />
    <form className={CONSOLE_FILTER_CARD_CLASS} onSubmit={event => { event.preventDefault(); void load(1, query, archived); }}>
      <div className={CONSOLE_FILTER_FIELDS_CLASS}>
        <label className={`${CONSOLE_FILTER_LABEL_CLASS} min-w-[min(100%,15rem)] flex-1`}>이벤트 문구 검색<Input value={query} onChange={event => setQuery(event.target.value)} maxLength={100} type="search" /></label>
        <label className={CONSOLE_FILTER_LABEL_CLASS}>보관 상태<AdminSelect value={archived ? 'archived' : 'active'} onChange={event => void load(1, search, event.target.value === 'archived')} disabled={pending} wrapperClassName="w-40"><option value="active">사용 중</option><option value="archived">보관됨</option></AdminSelect></label>
      </div>
      <ConsoleFilterActions>
        <Button variant="ghost" type="button" disabled={pending} onClick={() => { setQuery(''); void load(1, '', false); }}>초기화</Button>
        <Button type="submit" disabled={pending} variant="soft">검색</Button>
      </ConsoleFilterActions>
    </form>
    {message ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
    {data ? <ConsoleListCard headingLevel={3} title="조회 결과" total={data.total}>
      <div className={CONSOLE_TABLE_FRAME_CLASS} role="region" aria-label="이벤트 템플릿 목록 가로 스크롤" tabIndex={0}><table className="w-full min-w-[480px] caption-bottom text-sm" data-slot="table"><caption className="sr-only">이벤트 템플릿 목록</caption><ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead>이벤트 문구</TableHead><TableHead>등록일</TableHead><TableHead>상태</TableHead><TableHead className="w-24">관리</TableHead></TableRow></ConsoleTableHeader><TableBody>
        {data.rows.map(row => <TableRow key={row.id}><TableCell className="whitespace-normal">{row.eventText}</TableCell><TableCell className="tabular-nums">{kstDateTimeText(row.createdAt).replaceAll('-', '.')}</TableCell><TableCell><AdminStatusBadge tone={statusTone('setting', row.archived ? 'archived' : 'active')}>{row.archived ? '보관됨' : '사용 중'}</AdminStatusBadge></TableCell><TableCell><Button size="xs" variant="outline" type="button" onClick={() => setEditor({ template: row })}>수정</Button></TableCell></TableRow>)}
        {!data.rows.length ? <ConsoleTableEmptyRow colSpan={4}>{search ? '조건에 맞는 템플릿이 없습니다.' : archived ? '보관한 템플릿이 없습니다.' : '등록된 이벤트 템플릿이 없습니다.'}</ConsoleTableEmptyRow> : null}
      </TableBody></table></div>
      <ConsolePagination label="이벤트 템플릿 페이지" page={data.page} pageSize={20} total={data.total} disabled={pending} onPageChange={page => void load(page)} />
    </ConsoleListCard> : message ? null : <p className="text-sm text-muted-foreground" role="status">템플릿을 불러오는 중…</p>}
    {editor ? <EventTemplateEditor key={editor.template?.id ?? 'new'} template={editor.template} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void load(data?.page ?? 1); }} /> : null}
  </section>;
}
