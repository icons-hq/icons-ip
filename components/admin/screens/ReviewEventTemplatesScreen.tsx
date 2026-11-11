'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { deleteReviewEventTemplateAction, listReviewEventTemplatesAction, saveReviewEventTemplateAction, type ReviewEventTemplateResult } from '@/app/admin/review-event-actions';
import { REVIEW_EVENT_TEMPLATE_PAGE_SIZE, REVIEW_EVENT_TEMPLATES_ADMIN_PATH, REVIEW_EVENTS_ADMIN_PATH, reviewEventTemplateFieldErrors, reviewEventTemplateUsable, trimReviewEventTemplateText,
  type ReviewEventTemplate, type ReviewEventTemplatePage, type ReviewEventTemplateValues } from '@/lib/review-events';
import { kstDateTimeText } from '@/lib/admin/list-export';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { AdminNotice, AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { CONSOLE_FILTER_CARD_CLASS, CONSOLE_FILTER_FIELDS_CLASS, CONSOLE_FILTER_LABEL_CLASS, ConsoleFilterActions } from '../console/ConsoleFilterPanel';
import { CONSOLE_TABLE_FRAME_CLASS, ConsoleListCard, ConsoleTableEmptyRow, ConsoleTableHeader } from '../console/ConsoleListCard';
import { ConsolePagination } from '../console/ConsolePagination';
import { Button, buttonVariants } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { TableBody, TableCell, TableHead, TableRow } from '../kit/ui/table';

/*
 * SHEET-017(MD-0013): 리뷰이벤트 문구 템플릿. 이벤트명·내용만 저장해 두고 등록 화면에서 불러온다.
 * 불러온 문구는 이벤트에 복사된다 — 템플릿을 고치거나 지워도 이미 저장한 이벤트는 바뀌지 않는다.
 * 적립금 정책과 무관하게 저장된다(정책이 막는 것은 이벤트 저장뿐이다).
 * 골격은 템플릿 화면군과 같다: 머리(설명·등록) → 조회 카드 → 목록 카드(표·페이지 이동). 선택 팝업은 머리 없이 쓴다.
 */

type TemplateRequest = { kind: 'save'; id: string; revision: number; operationId: string; values: ReviewEventTemplateValues }
  | { kind: 'delete'; id: string; revision: number; operationId: string };
const DELETE_CONFIRM = '이 템플릿을 삭제할까요? 이미 불러와 저장한 이벤트 문구는 바뀌지 않습니다.';
const COUNTER_CLASS = 'text-xs font-normal text-muted-foreground tabular-nums';

/** 템플릿 등록·수정 팝업. 새 템플릿은 initial(등록 화면의 현재 문구)로 시작할 수 있다. */
export function ReviewEventTemplateEditor({ template, initial, onClose, onSaved, onDeleted, onReload }: {
  template: ReviewEventTemplate | null;
  initial?: ReviewEventTemplateValues;
  onClose: () => void;
  onSaved: (template: ReviewEventTemplate) => void;
  onDeleted?: (id: string) => void;
  /** 다른 운영자가 먼저 바꿨을 때 입력을 닫고 최신 목록을 다시 읽는다. 없으면 닫기만 한다. */
  onReload?: () => void;
}) {
  const [values, setValues] = useState<ReviewEventTemplateValues>(() => template ? { title: template.title, description: template.description } : initial ?? { title: '', description: '' });
  const [attempted, setAttempted] = useState(false), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false), [message, setMessage] = useState('');
  const busy = useRef(false), request = useRef<TemplateRequest | null>(null), newId = useRef<string | null>(null);
  const errors = attempted ? reviewEventTemplateFieldErrors(trimReviewEventTemplateText(values)) : {};
  const locked = pending || uncertain;
  async function run(next: TemplateRequest) {
    if (busy.current) return;
    busy.current = true; request.current = next; setPending(true); setMessage('');
    let result: ReviewEventTemplateResult<ReviewEventTemplate | { id: string }>;
    try {
      result = next.kind === 'save' ? await saveReviewEventTemplateAction(next.id, next.revision, next.operationId, next.values)
        : await deleteReviewEventTemplateAction(next.id, next.revision, next.operationId);
    } catch { result = { ok: false, uncertain: true, error: `${next.kind === 'save' ? '저장' : '삭제'} 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.` }; }
    busy.current = false; setPending(false);
    if (!result.ok) { setMessage(result.error); setUncertain(Boolean(result.uncertain)); setConflict(Boolean(result.conflict)); if (!result.uncertain) request.current = null; return; }
    request.current = null; setUncertain(false);
    if (next.kind === 'save') onSaved(result.value as ReviewEventTemplate); else onDeleted?.(next.id);
  }
  function save() {
    if (locked || conflict) return;
    const trimmed = trimReviewEventTemplateText(values);
    setAttempted(true); setValues(trimmed);
    if (Object.keys(reviewEventTemplateFieldErrors(trimmed)).length) { setMessage('표시된 항목을 확인해주세요.'); return; }
    newId.current ??= crypto.randomUUID();
    void run({ kind: 'save', id: template?.id ?? newId.current, revision: template?.revision ?? 0, operationId: crypto.randomUUID(), values: trimmed });
  }
  function remove() {
    if (!template || locked || conflict || !window.confirm(DELETE_CONFIRM)) return;
    void run({ kind: 'delete', id: template.id, revision: template.revision, operationId: crypto.randomUUID() });
  }
  const invalid = (name: 'title' | 'description') => errors[name] ? { 'aria-invalid': true as const, 'aria-describedby': `review-event-template-${name}-error` } : {};
  const fieldError = (name: 'title' | 'description') => errors[name] ? <small className="text-xs font-normal text-destructive" id={`review-event-template-${name}-error`}>{errors[name]}</small> : null;
  return <CustomerServiceDialog title={template ? '문구 템플릿 수정' : '문구 템플릿 등록'} busy={locked} onClose={onClose}>
    <form className="flex min-w-0 flex-col gap-4" onSubmit={(event: FormEvent) => { event.preventDefault(); save(); }}>
      <fieldset className="flex min-w-0 flex-col gap-4 disabled:opacity-60" disabled={locked}>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">이벤트명 <span className={COUNTER_CLASS}>{[...values.title].length}/15</span>
          <Input data-dialog-autofocus="" value={values.title} onChange={event => setValues(current => ({ ...current, title: event.target.value }))} placeholder="최대 15자" {...invalid('title')} />{fieldError('title')}</label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">내용 <span className={COUNTER_CLASS}>{[...values.description].length}/30</span>
          <Input value={values.description} onChange={event => setValues(current => ({ ...current, description: event.target.value }))} placeholder="최대 30자" {...invalid('description')} />{fieldError('description')}</label>
      </fieldset>
      <p className="text-sm text-muted-foreground">불러온 문구는 이벤트에 복사됩니다. 템플릿을 고치거나 지워도 이미 저장한 이벤트는 바뀌지 않습니다. 적립금 정책이 꺼져 있어도 템플릿은 저장됩니다.</p>
      {message ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" type="button" disabled={locked} onClick={onClose}>닫기</Button>
        {conflict ? <Button variant="outline" type="button" onClick={onReload ?? onClose}>입력 닫고 최신 목록 조회</Button> : null}
        {template ? <Button variant="outline" type="button" disabled={locked || conflict} onClick={remove}>삭제</Button> : null}
        {uncertain ? <Button type="button" disabled={pending} onClick={() => { if (request.current) void run(request.current); }}>같은 요청 결과 확인</Button>
          : <Button type="submit" disabled={pending || conflict}>저장</Button>}
      </div>
    </form>
  </CustomerServiceDialog>;
}

export function ReviewEventTemplatesScreen({ onSelect }: { onSelect?: (template: ReviewEventTemplate) => void }) {
  const [data, setData] = useState<ReviewEventTemplatePage | null>(null), [query, setQuery] = useState(''), [search, setSearch] = useState('');
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [notice, setNotice] = useState(''), [editor, setEditor] = useState<{ template: ReviewEventTemplate | null } | null>(null);
  const busy = useRef(false), mounted = useRef(true), readSequence = useRef(0);
  useEffect(() => {
    mounted.current = true; let active = true; const sequence = ++readSequence.current;
    void listReviewEventTemplatesAction('', 1).then(result => {
      if (!active || sequence !== readSequence.current) return; if (result.ok) setData(result.value); else setMessage(result.error);
    }).catch(() => { if (active && sequence === readSequence.current) setMessage('템플릿을 불러오지 못했습니다. 다시 조회해주세요.'); });
    return () => { active = false; mounted.current = false; };
  }, []);
  async function load(nextPage = 1, nextQuery = search) {
    if (busy.current) return;
    const sequence = ++readSequence.current;
    busy.current = true; setPending(true); setMessage('');
    try {
      let result = await listReviewEventTemplatesAction(nextQuery, nextPage);
      /* 다른 운영자가 지워 마지막 페이지가 사라졌으면 남은 마지막 페이지를 다시 읽는다. */
      const lastPage = result.ok ? Math.max(1, Math.ceil(result.value.total / REVIEW_EVENT_TEMPLATE_PAGE_SIZE)) : 1;
      if (result.ok && nextPage > lastPage) result = await listReviewEventTemplatesAction(nextQuery, lastPage);
      if (!mounted.current || sequence !== readSequence.current) return;
      if (result.ok) { setData(result.value); setSearch(nextQuery); }
      else setMessage(result.error);
    } catch { if (mounted.current && sequence === readSequence.current) setMessage('템플릿을 불러오지 못했습니다. 다시 조회해주세요.'); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  function closeEditor(nextNotice = '') { setEditor(null); setNotice(nextNotice); void load(data?.page ?? 1); }
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="review-event-templates">
    {!onSelect ? <AdminPageHeader title="리뷰이벤트 문구 템플릿" description="이벤트명·내용 문구를 저장해 두고 리뷰이벤트 등록 화면에서 불러옵니다. 불러온 문구는 이벤트에 복사되어, 템플릿을 고치거나 지워도 저장된 이벤트는 바뀌지 않습니다."
      actions={<><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={REVIEW_EVENTS_ADMIN_PATH}>리뷰이벤트 목록</Link>
        <Button type="button" disabled={!data} onClick={() => { setNotice(''); setEditor({ template: null }); }}><Plus aria-hidden="true" />템플릿 등록</Button></>} /> : null}
    <p className="text-sm text-muted-foreground">{onSelect
      ? '고르면 작성 중인 이벤트명·내용을 템플릿 문구로 바꿉니다. 대상·기간·선정 혜택은 그대로입니다.'
      : '적립금 정책이 꺼져 있어도 템플릿은 저장할 수 있습니다. 이벤트 저장은 정책을 켠 뒤에 됩니다.'}</p>
    <form className={CONSOLE_FILTER_CARD_CLASS} onSubmit={event => { event.preventDefault(); void load(1, query); }}>
      <div className={CONSOLE_FILTER_FIELDS_CLASS}>
        <label className={`${CONSOLE_FILTER_LABEL_CLASS} min-w-[min(100%,15rem)] flex-1`}>이벤트명·내용 검색<Input value={query} onChange={event => setQuery(event.target.value)} maxLength={100} type="search" /></label>
      </div>
      <ConsoleFilterActions>
        <Button variant="ghost" type="button" disabled={pending} onClick={() => { setQuery(''); void load(1, ''); }}>초기화</Button>
        <Button type="submit" disabled={pending} variant="soft">검색</Button>
      </ConsoleFilterActions>
    </form>
    {message ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
    {notice ? <p className="text-sm text-success" role="status">{notice}</p> : null}
    {data?.skipped ? <AdminNotice tone="warning">형식을 읽지 못한 템플릿 {data.skipped}개는 목록에서 뺐습니다. 다시 조회해도 남으면 개발팀에 알려 주세요.</AdminNotice> : null}
    {data?.rows.some(row => !reviewEventTemplateUsable(row)) ? <p className="text-sm text-muted-foreground">&lsquo;불러올 수 없음&rsquo; 템플릿은 이벤트명·내용 규칙(길이·앞뒤 공백·줄바꿈)에 맞지 않습니다. {onSelect ? '문구 템플릿 관리에서 고친 뒤 불러오세요.' : '수정해 저장하면 앞뒤 공백을 잘라 다시 쓸 수 있습니다.'}</p> : null}
    {data ? <ConsoleListCard headingLevel={onSelect ? 3 : 2} title="조회 결과" total={data.total}>
      <div className={CONSOLE_TABLE_FRAME_CLASS} role="region" aria-label="문구 템플릿 목록 가로 스크롤" tabIndex={0}><table className="w-full min-w-[560px] caption-bottom text-sm" data-slot="table"><caption className="sr-only">리뷰이벤트 문구 템플릿 목록</caption>
        <ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead>이벤트명</TableHead><TableHead>내용</TableHead><TableHead>수정일</TableHead><TableHead className="w-32">{onSelect ? '선택' : '관리'}</TableHead></TableRow></ConsoleTableHeader>
        <TableBody>
          {data.rows.map(row => { const usable = reviewEventTemplateUsable(row); return <TableRow key={row.id}><TableCell className="font-medium whitespace-normal text-foreground wrap-anywhere">{row.title}{usable ? null : <> <AdminStatusBadge tone="warning">불러올 수 없음</AdminStatusBadge></>}</TableCell><TableCell className="whitespace-normal wrap-anywhere">{row.description}</TableCell>
            <TableCell className="tabular-nums">{kstDateTimeText(row.updatedAt).replaceAll('-', '.')}</TableCell>
            <TableCell>{onSelect ? <Button size="xs" variant="outline" type="button" disabled={!usable} onClick={() => onSelect(row)}>선택</Button>
              : <Button size="xs" variant="outline" type="button" onClick={() => { setNotice(''); setEditor({ template: row }); }}>수정·삭제</Button>}</TableCell></TableRow>; })}
          {!data.rows.length ? <ConsoleTableEmptyRow colSpan={4}>{search ? '검색어와 맞는 템플릿이 없습니다.' : '등록된 문구 템플릿이 없습니다.'}</ConsoleTableEmptyRow> : null}
        </TableBody></table></div>
      <ConsolePagination label="문구 템플릿 페이지" page={data.page} pageSize={REVIEW_EVENT_TEMPLATE_PAGE_SIZE} total={data.total} disabled={pending} onPageChange={page => void load(page)} />
    </ConsoleListCard> : <p className="text-sm text-muted-foreground" role="status">{message ? '조회 후에 템플릿을 볼 수 있습니다.' : '템플릿을 불러오는 중…'}</p>}
    {onSelect ? <p className="text-sm text-muted-foreground">템플릿 등록·수정·삭제는 <Link className="font-medium text-foreground underline underline-offset-4" href={REVIEW_EVENT_TEMPLATES_ADMIN_PATH} target="_blank" rel="noopener noreferrer">문구 템플릿 관리 ↗</Link>에서 합니다.</p> : null}
    {editor ? <ReviewEventTemplateEditor template={editor.template} onClose={() => setEditor(null)} onReload={() => closeEditor()}
      onSaved={() => closeEditor('템플릿을 저장했습니다.')} onDeleted={() => closeEditor('템플릿을 삭제했습니다.')} /> : null}
  </section>;
}

/** 등록 화면의 "템플릿 불러오기" 팝업. 목록에서 고른 템플릿을 넘긴다(바꾸기 확인은 부르는 쪽이 한다). */
export function ReviewEventTemplatePicker({ onClose, onSelect }: { onClose: () => void; onSelect: (template: ReviewEventTemplate) => void }) {
  return <CustomerServiceDialog title="리뷰이벤트 문구 템플릿" onClose={onClose} wide><ReviewEventTemplatesScreen onSelect={onSelect} /></CustomerServiceDialog>;
}
