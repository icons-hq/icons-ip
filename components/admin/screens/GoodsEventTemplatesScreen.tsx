'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { listGoodsEventTemplatesAction, saveGoodsEventTemplateAction, type GoodsBenefitsResult } from '@/app/admin/goods-benefit-actions';
import type { GoodsEventTemplate, GoodsEventTemplatePage } from '@/lib/goods-benefits';
import { kstDateTimeText } from '@/lib/admin/list-export';
import { Plus } from 'lucide-react';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminSelect } from '../console/AdminSelect';
import { CONSOLE_FILTER_CARD_CLASS, CONSOLE_FILTER_FIELDS_CLASS, CONSOLE_FILTER_LABEL_CLASS, ConsoleFilterActions } from '../console/ConsoleFilterPanel';
import { CONSOLE_TABLE_FRAME_CLASS, ConsoleListCard, ConsoleTableEmptyRow, ConsoleTableHeader } from '../console/ConsoleListCard';
import { ConsolePagination } from '../console/ConsolePagination';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { TableBody, TableCell, TableHead, TableRow } from '../kit/ui/table';

function EventTemplateEditor({ template, onClose, onSaved }: { template: GoodsEventTemplate | null; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(template?.eventText ?? ''), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false), [message, setMessage] = useState('');
  const busy = useRef(false), request = useRef<{ id: string; text: string; archived: boolean; revision: number; operationId: string } | null>(null);
  async function save(archived = false) {
    if (busy.current || conflict) return;
    busy.current = true; setPending(true); setMessage('');
    request.current ??= { id: template?.id ?? crypto.randomUUID(), text, archived, revision: template?.revision ?? 0, operationId: crypto.randomUUID() };
    const fixed = request.current;
    let result: GoodsBenefitsResult<GoodsEventTemplate>;
    try { result = await saveGoodsEventTemplateAction(fixed.id, fixed.text, fixed.archived, fixed.revision, fixed.operationId); }
    catch { result = { ok: false, uncertain: true, error: '저장 결과를 확인하지 못했습니다. 같은 요청 결과를 확인해주세요.' }; }
    busy.current = false; setPending(false);
    if (!result.ok) { setMessage(result.error); setUncertain(Boolean(result.uncertain)); setConflict(Boolean(result.conflict)); if (!result.uncertain) request.current = null; return; }
    request.current = null; onSaved();
  }
  return <CustomerServiceDialog title={template ? '이벤트 템플릿 수정' : '이벤트 템플릿 등록'} busy={pending || uncertain} onClose={onClose}>
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); void save(template?.archived ?? false); }} className="flex min-w-0 flex-col gap-4">
      <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={pending || uncertain}><label className="flex flex-col gap-2 text-sm font-medium">이벤트 문구<Input value={text} onChange={event => setText(event.target.value)} maxLength={40} required /></label><span className="text-xs text-muted-foreground tabular-nums">{Array.from(text).length}/40</span></fieldset>
      <p className="text-sm text-muted-foreground">불러온 문구는 상품에 복사됩니다. 템플릿 수정·보관으로 이미 저장된 상품 문구가 바뀌지 않습니다.</p>
      {message ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" type="button" disabled={pending || uncertain} onClick={onClose}>닫기</Button>
        {conflict ? <Button variant="outline" type="button" onClick={onSaved}>입력 닫고 최신 목록 조회</Button> : null}
        {template ? <Button variant="outline" type="button" disabled={pending || uncertain || conflict} onClick={() => void save(!template.archived)}>{template.archived ? '복구' : '보관'}</Button> : null}
        {uncertain ? <Button type="button" disabled={pending} onClick={() => void save()}>같은 요청 결과 확인</Button> : <Button type="submit" disabled={pending || conflict}>저장</Button>}
      </div>
    </form>
  </CustomerServiceDialog>;
}

export function GoodsEventTemplatesScreen({ onSelect }: { onSelect?: (template: GoodsEventTemplate) => void }) {
  const [data, setData] = useState<GoodsEventTemplatePage | null>(null), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [archived, setArchived] = useState(false);
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [editor, setEditor] = useState<{ template: GoodsEventTemplate | null } | null>(null);
  const busy = useRef(false), mounted = useRef(true), readSequence = useRef(0);
  useEffect(() => {
    mounted.current = true; let active = true; const sequence = ++readSequence.current;
    void listGoodsEventTemplatesAction('', false, 1).then(result => {
      if (!active || sequence !== readSequence.current) return; if (result.ok) setData(result.value); else setMessage(result.error);
    }).catch(() => { if (active && sequence === readSequence.current) setMessage('템플릿을 불러오지 못했습니다. 다시 조회해주세요.'); });
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
    } catch { if (mounted.current && sequence === readSequence.current) setMessage('템플릿을 불러오지 못했습니다. 다시 조회해주세요.'); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  /* 템플릿 화면군 공통 골격: 머리(설명·등록) → 조회 카드([초기화][검색]) → 목록 카드(표·페이지 이동). 선택 팝업은 머리 없이 쓴다. */
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="event-templates">
    {!onSelect ? <AdminPageHeader title="이벤트 템플릿 관리" description="불러온 문구는 상품에 복사됩니다. 템플릿 수정·보관으로 이미 저장된 상품 문구가 바뀌지 않습니다."
      actions={<Button type="button" disabled={!data} onClick={() => setEditor({ template: null })}><Plus aria-hidden="true" />이벤트 템플릿 등록</Button>} /> : null}
    <form className={CONSOLE_FILTER_CARD_CLASS} onSubmit={event => { event.preventDefault(); void load(1, query, archived); }}>
      <div className={CONSOLE_FILTER_FIELDS_CLASS}>
        <label className={`${CONSOLE_FILTER_LABEL_CLASS} min-w-[min(100%,15rem)] flex-1`}>이벤트 문구 검색<Input value={query} onChange={event => setQuery(event.target.value)} maxLength={100} type="search" /></label>
        {!onSelect ? <label className={CONSOLE_FILTER_LABEL_CLASS}>보관 상태<AdminSelect value={archived ? 'archived' : 'active'} onChange={event => void load(1, search, event.target.value === 'archived')} disabled={pending} wrapperClassName="w-40"><option value="active">사용 중</option><option value="archived">보관됨</option></AdminSelect></label> : null}
      </div>
      <ConsoleFilterActions>
        <Button variant="ghost" type="button" disabled={pending} onClick={() => { setQuery(''); void load(1, '', false); }}>초기화</Button>
        <Button type="submit" disabled={pending} variant="soft">검색</Button>
      </ConsoleFilterActions>
    </form>
    {message ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
    {data ? <ConsoleListCard headingLevel={3} title="조회 결과" total={data.total}>
      <div className={CONSOLE_TABLE_FRAME_CLASS} role="region" aria-label="이벤트 템플릿 목록 가로 스크롤" tabIndex={0}><table className="w-full min-w-[480px] caption-bottom text-sm" data-slot="table"><caption className="sr-only">이벤트 템플릿 목록</caption><ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead>이벤트 문구</TableHead><TableHead>등록일</TableHead>{!onSelect ? <TableHead>상태</TableHead> : null}<TableHead className="w-24">{onSelect ? '선택' : '관리'}</TableHead></TableRow></ConsoleTableHeader><TableBody>
        {data.rows.map(row => <TableRow key={row.id}><TableCell className="whitespace-normal">{row.eventText}</TableCell><TableCell className="tabular-nums">{kstDateTimeText(row.createdAt)}</TableCell>{!onSelect ? <TableCell><AdminStatusBadge tone={statusTone('setting', row.archived ? 'archived' : 'active')}>{row.archived ? '보관됨' : '사용 중'}</AdminStatusBadge></TableCell> : null}<TableCell><Button size="xs" variant="outline" type="button" onClick={() => onSelect ? onSelect(row) : setEditor({ template: row })}>{onSelect ? '선택' : '수정'}</Button></TableCell></TableRow>)}
        {!data.rows.length ? <ConsoleTableEmptyRow colSpan={onSelect ? 3 : 4}>등록된 이벤트 템플릿이 없습니다.</ConsoleTableEmptyRow> : null}
      </TableBody></table></div>
      <ConsolePagination label="이벤트 템플릿 페이지" page={data.page} pageSize={20} total={data.total} disabled={pending} onPageChange={page => void load(page)} />
    </ConsoleListCard> : <p className="text-sm text-muted-foreground" role="status">{message ? '조회 후에 템플릿을 관리할 수 있습니다.' : '템플릿을 불러오는 중…'}</p>}
    {editor ? <EventTemplateEditor template={editor.template} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void load(data?.page ?? 1); }} /> : null}
  </section>;
}
export function GoodsEventTemplatePicker({ onClose, onSelect }: { onClose: () => void; onSelect: (template: GoodsEventTemplate) => void }) {
  return <CustomerServiceDialog title="이벤트 템플릿" onClose={onClose} wide><GoodsEventTemplatesScreen onSelect={onSelect} /></CustomerServiceDialog>;
}
