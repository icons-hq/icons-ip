'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { listGoodsAfterSalesTemplatesAction, saveGoodsAfterSalesTemplateAction, type GoodsAfterSalesResult } from '@/app/admin/goods-after-sales-actions';
import type { GoodsAfterSalesValues, GoodsAfterSalesTemplate, GoodsAfterSalesTemplatePage } from '@/lib/goods-after-sales';
import { adminConfirm } from '@/lib/admin/confirm';
import { goodsAfterSalesProblem } from '@/lib/admin/goods-after-sales-messages';
import {
  SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE, TEMPLATE_CLOSE_DIRTY_CONFIRM, TEMPLATE_DISCARD_INPUT_CONFIRM, TEMPLATE_DISCARD_INPUT_LABEL,
  TEMPLATE_LATEST_UNREAD_MESSAGE, TEMPLATE_SAVE_OVER_LATEST_LABEL, TEMPLATE_SAVE_OVER_LATEST_NOTE, findSavedTemplate, reopenClosedDialog, templateArchiveConfirm, templateCloseUnknownConfirm,
  templateSavedKind, templateSavedNotice, type TemplateSavedKind,
} from '@/lib/admin/goods-template-save';
import { kstDateTimeText } from '@/lib/admin/list-export';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableRow } from '@/components/admin/kit/ui/table';
import { AdminNotice, AdminPageHeader, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { CONSOLE_FILTER_CARD_CLASS, CONSOLE_FILTER_FIELDS_CLASS, CONSOLE_FILTER_LABEL_CLASS, ConsoleFilterActions } from '@/components/admin/console/ConsoleFilterPanel';
import { CONSOLE_TABLE_FRAME_CLASS, ConsoleListCard, ConsoleTableEmptyRow, ConsoleTableHeader } from '@/components/admin/console/ConsoleListCard';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { GOOD_INPUT_CLASS } from '../GoodEditorParts';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { GoodsAfterSalesFields } from '../GoodsAfterSalesFields';

/* 템플릿 룩(ADR-0028). 템플릿 관리 화면(/admin/catalog/after-sales-templates): 표 + [수정] 창. 사이즈·이벤트 템플릿 관리와 같은 모양이다. 상품에서 템플릿을 고르는 창은 공용 선택창(GoodsAfterSalesTemplatePicker)이다. */
const EXCERPT_CLASS = 'block max-h-28 max-w-[17.5rem] overflow-auto whitespace-pre-wrap wrap-anywhere';
const ARCHIVED_SELECT_ID = 'goods-after-sales-template-archived';
const LIST_FAILED = '목록을 불러오지 못했습니다. [검색]을 다시 눌러 주세요.';

type SaveRequest = { id: string; values: GoodsAfterSalesValues; archived: boolean; revision: number; operationId: string };
const valuesOf = (template: GoodsAfterSalesTemplate | null): GoodsAfterSalesValues => ({ phone: template?.phone ?? '', guide: template?.guide ?? '', sellerSpecialNotes: template?.sellerSpecialNotes ?? '' });
const sameValues = (left: GoodsAfterSalesValues, right: GoodsAfterSalesValues) => left.phone === right.phone && left.guide === right.guide && left.sellerSpecialNotes === right.sellerSpecialNotes;
const listAll = (archived: boolean, page: number) => listGoodsAfterSalesTemplatesAction('', archived, page);

/*
 * 편집 창. [저장]은 적은 내용을, [보관]·[복원]은 보관 상태만 바꾼다(고친 내용이 있으면 사라진다고 먼저 묻는다).
 * 다른 사람이 먼저 바꿨으면 입력을 그대로 둔 채 두 길을 고른다: 내 입력으로 덮어쓰기 / 내 입력 버리기.
 * 저장됐는지 모를 때는 같은 내용을 다시 보내 확인하고, 그래도 안 되면 [닫기]로 나가 목록에서 확인한다.
 * 저장·보관·복원에 성공하면 무엇을 했는지 `onSaved`로 알려 목록 위에 결과 한 줄을 보이게 한다. 입력을 버리거나 그냥 닫을 때는 알리지 않는다.
 */
function AfterSalesTemplateEditor({ template, onClose, onSaved }: { template: GoodsAfterSalesTemplate | null; onClose: () => void; onSaved: (kind?: TemplateSavedKind) => void }) {
  const [id] = useState(() => template?.id ?? crypto.randomUUID());
  const [values, setValues] = useState<GoodsAfterSalesValues>(() => valuesOf(template));
  /* base: 지금 입력이 딛고 선 저장 내용. latest: 다른 사람이 먼저 바꿨을 때 찾아 둔 지금 저장 내용. */
  const [base, setBase] = useState(template), [latest, setLatest] = useState<GoodsAfterSalesTemplate | null>(null);
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false), [message, setMessage] = useState('');
  const busy = useRef(false), request = useRef<SaveRequest | null>(null), form = useRef<HTMLFormElement>(null);
  const dirty = !sameValues(values, valuesOf(base));

  /** `kind`는 성공했을 때 목록에 알릴 일이다. 주지 않으면([보관]·[복원]과 저장됐는지 다시 확인할 때) 보낸 보관 상태가 목록에서 보던 것과 달라졌는지로 가린다. */
  async function send(fixed: SaveRequest, kind: TemplateSavedKind = templateSavedKind(template?.archived ?? false, fixed.archived)) {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage(''); request.current = fixed;
    let result: GoodsAfterSalesResult<GoodsAfterSalesTemplate>;
    try { result = await saveGoodsAfterSalesTemplateAction(fixed.id, fixed.values, fixed.archived, fixed.revision, fixed.operationId); }
    catch { result = { ok: false, uncertain: true, error: SAVE_UNKNOWN_MESSAGE }; }
    if (result.ok) { busy.current = false; request.current = null; setPending(false); onSaved(kind); return; }
    /* 다른 사람이 먼저 바꿨으면 지금 저장된 내용을 찾아 함께 보인다. 못 찾아도 입력은 그대로 둔다. */
    const found = result.conflict ? await findSavedTemplate(id, listAll) : null;
    busy.current = false; setPending(false);
    if (result.uncertain) { setUncertain(true); setMessage(SAVE_UNKNOWN_MESSAGE); return; }
    request.current = null; setUncertain(false); setMessage(result.error);
    if (result.conflict) { setConflict(true); setLatest(found && found !== 'failed' ? found : null); }
  }
  function saveInput() {
    if (busy.current || uncertain || conflict) return;
    const problem = goodsAfterSalesProblem(values);
    if (problem) { setMessage(problem); return; }
    void send({ id, values, archived: base?.archived ?? false, revision: base?.revision ?? 0, operationId: crypto.randomUUID() }, 'saved');
  }
  async function toggleArchive() {
    if (!base || busy.current || uncertain || conflict) return;
    if (dirty && !await adminConfirm(templateArchiveConfirm(!base.archived))) return;
    void send({ id, values: valuesOf(base), archived: !base.archived, revision: base.revision, operationId: crypto.randomUUID() });
  }
  async function saveOverLatest() {
    if (busy.current) return;
    const problem = goodsAfterSalesProblem(values);
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
    void send({ id, values, archived: target.archived, revision: target.revision, operationId: crypto.randomUUID() }, 'saved');
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

  return <CustomerServiceDialog title={template ? 'A/S 템플릿 수정' : 'A/S 템플릿 등록'} busy={pending} onClose={() => { void close(); }}>
    <form ref={form} onSubmit={(event: FormEvent) => { event.preventDefault(); saveInput(); }} className="flex min-w-0 flex-col gap-4 text-sm" data-goods-after-sales-template-form="">
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={pending || uncertain}><GoodsAfterSalesFields values={values} onChange={setValues} forTemplate /></fieldset>
      {conflict ? <AdminNotice tone="warning" role="alert">
        <p>{message}</p>
        {latest ? <div className="mt-2 flex min-w-0 flex-col gap-1" data-goods-template-latest=""><strong className="font-medium">지금 저장된 내용{latest.archived ? ' · 보관됨' : ''}</strong><span className="tabular-nums">{latest.phone}</span><span className={EXCERPT_CLASS}>{latest.guide}</span>{latest.sellerSpecialNotes ? <span className={EXCERPT_CLASS}>{latest.sellerSpecialNotes}</span> : null}</div> : null}
        <p className="mt-2 text-xs" data-goods-template-overwrite-note="">{TEMPLATE_SAVE_OVER_LATEST_NOTE}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={buttonVariants({ size: 'sm' })} data-slot="button" disabled={pending} onClick={() => { void saveOverLatest(); }}>{TEMPLATE_SAVE_OVER_LATEST_LABEL}</button>
          <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" disabled={pending} onClick={() => { void discardInput(); }}>{TEMPLATE_DISCARD_INPUT_LABEL}</button>
        </div>
      </AdminNotice> : message ? <p className="text-destructive" role="alert">{message}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={buttonVariants({ variant: 'ghost' })} data-slot="button" disabled={pending} onClick={() => { void close(); }}>닫기</button>
        {base && !conflict ? <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={pending || uncertain} onClick={() => { void toggleArchive(); }}>{base.archived ? '복원' : '보관'}</button> : null}
        {uncertain ? <button type="button" className={buttonVariants()} data-slot="button" disabled={pending} onClick={() => { if (request.current) void send(request.current); }}>{SAVE_CHECK_LABEL}</button>
          : conflict ? null : <button type="submit" className={buttonVariants()} data-slot="button" disabled={pending}>저장</button>}
      </div>
    </form>
  </CustomerServiceDialog>;
}

export function GoodsAfterSalesTemplatesScreen() {
  const [data, setData] = useState<GoodsAfterSalesTemplatePage | null>(null), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [archived, setArchived] = useState(false);
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [editor, setEditor] = useState<{ template: GoodsAfterSalesTemplate | null } | null>(null);
  /* 저장·보관·복원 뒤의 결과 한 줄. 다음 조회(검색·보관 상태·페이지 이동)에서 지운다. */
  const [notice, setNotice] = useState('');
  const busy = useRef(false), mounted = useRef(true), readSequence = useRef(0);
  useEffect(() => {
    mounted.current = true; let active = true; const sequence = ++readSequence.current;
    void listGoodsAfterSalesTemplatesAction('', false, 1).then(result => {
      if (!active || sequence !== readSequence.current) return; if (result.ok) setData(result.value); else setMessage(result.error);
    }).catch(() => { if (active && sequence === readSequence.current) setMessage(LIST_FAILED); });
    return () => { active = false; mounted.current = false; };
  }, []);
  async function load(nextPage = 1, nextQuery = search, nextArchived = archived, nextNotice = '') {
    if (busy.current) return;
    const sequence = ++readSequence.current;
    busy.current = true; setPending(true); setMessage(''); setNotice(nextNotice);
    try {
      let result = await listGoodsAfterSalesTemplatesAction(nextQuery, nextArchived, nextPage);
      if (result.ok && nextPage > Math.max(1, Math.ceil(result.value.total / 20))) result = await listGoodsAfterSalesTemplatesAction(nextQuery, nextArchived, Math.max(1, Math.ceil(result.value.total / 20)));
      if (!mounted.current || sequence !== readSequence.current) return;
      if (result.ok) { setData(result.value); setSearch(nextQuery); setArchived(nextArchived); }
      else setMessage(result.error);
    } catch { if (mounted.current && sequence === readSequence.current) setMessage(LIST_FAILED); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  /* 템플릿 화면군 공통 골격: 머리(설명·등록) → 조회 카드([초기화][검색]) → 목록 카드(표·페이지 이동) → [수정] 창. */
  return <section className="flex min-w-0 flex-col gap-4 text-sm" data-goods-after-sales-templates="">
    <AdminPageHeader title="A/S 템플릿 관리" description="템플릿을 고치거나 보관해도 이미 가져간 상품은 바뀌지 않습니다."
      actions={<button className={buttonVariants()} data-slot="button" type="button" disabled={!data} onClick={() => setEditor({ template: null })}><Plus aria-hidden="true" />A/S 템플릿 등록</button>} />
    <form className={CONSOLE_FILTER_CARD_CLASS} onSubmit={event => { event.preventDefault(); void load(1, query, archived); }}>
      <div className={CONSOLE_FILTER_FIELDS_CLASS}>
        <label className={`${CONSOLE_FILTER_LABEL_CLASS} flex-1 basis-60`}>전화번호·안내·특이사항 검색<input className={GOOD_INPUT_CLASS} data-slot="input" value={query} onChange={event => setQuery(event.target.value)} maxLength={100} type="search" /></label>
        <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor={ARCHIVED_SELECT_ID}>보관 상태</Label><NativeSelect className="w-full sm:w-32" id={ARCHIVED_SELECT_ID} value={archived ? 'archived' : 'active'} onChange={event => void load(1, search, event.target.value === 'archived')} disabled={pending}><option value="active">사용 중</option><option value="archived">보관됨</option></NativeSelect></div>
      </div>
      <ConsoleFilterActions>
        <button className={buttonVariants({ variant: 'ghost' })} data-slot="button" type="button" disabled={pending} onClick={() => { setQuery(''); void load(1, '', false); }}>초기화</button>
        <button className={buttonVariants({ variant: 'soft' })} data-slot="button" type="submit" disabled={pending}>검색</button>
      </ConsoleFilterActions>
    </form>
    {message ? <p className="text-destructive" role="alert">{message}</p> : null}
    {notice ? <p data-goods-template-notice="" role="status">{notice}</p> : null}
    {data ? <ConsoleListCard headingLevel={3} title="조회 결과" total={data.total}>
      <div className={`${CONSOLE_TABLE_FRAME_CLASS} [&>[data-slot=table-container]]:overflow-visible`} role="region" aria-label="A/S 템플릿 목록 가로 스크롤" tabIndex={0}><Table className="min-w-[35rem]"><TableCaption className="sr-only">A/S 템플릿 목록</TableCaption><ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead className="px-3">A/S 전화번호</TableHead><TableHead className="px-3">A/S 안내</TableHead><TableHead className="px-3">판매자 특이사항</TableHead><TableHead className="px-3">등록일</TableHead><TableHead className="px-3">상태</TableHead><TableHead className="px-3">관리</TableHead></TableRow></ConsoleTableHeader><TableBody>
        {data.rows.map(row => <TableRow key={row.id}><TableCell className="px-3 align-top tabular-nums">{row.phone}</TableCell><TableCell className="px-3 align-top whitespace-normal"><span className={EXCERPT_CLASS}>{row.guide}</span></TableCell><TableCell className="px-3 align-top whitespace-normal"><span className={EXCERPT_CLASS}>{row.sellerSpecialNotes || '—'}</span></TableCell><TableCell className="px-3 align-top text-muted-foreground tabular-nums">{kstDateTimeText(row.createdAt).replaceAll('-', '.')}</TableCell><TableCell className="px-3 align-top"><AdminStatusBadge tone={statusTone('setting', row.archived ? 'archived' : 'active')}>{row.archived ? '보관됨' : '사용 중'}</AdminStatusBadge></TableCell><TableCell className="px-3 align-top"><button type="button" className={buttonVariants({ variant: 'outline', size: 'xs' })} data-slot="button" onClick={() => setEditor({ template: row })}>수정</button></TableCell></TableRow>)}
        {!data.rows.length ? <ConsoleTableEmptyRow colSpan={6}>{search ? '조건에 맞는 템플릿이 없습니다.' : archived ? '보관한 템플릿이 없습니다.' : '등록된 A/S 템플릿이 없습니다.'}</ConsoleTableEmptyRow> : null}
      </TableBody></Table></div>
      <ConsolePagination label="A/S 템플릿 페이지" page={data.page} pageSize={20} total={data.total} disabled={pending} onPageChange={page => void load(page)} />
    </ConsoleListCard> : message ? null : <p className="text-muted-foreground" role="status">템플릿을 불러오는 중…</p>}
    {editor ? <AfterSalesTemplateEditor key={editor.template?.id ?? 'new'} template={editor.template} onClose={() => setEditor(null)} onSaved={kind => { const done = kind ? templateSavedNotice(kind) : ''; setEditor(null); setNotice(done); void load(data?.page ?? 1, search, archived, done); }} /> : null}
  </section>;
}
