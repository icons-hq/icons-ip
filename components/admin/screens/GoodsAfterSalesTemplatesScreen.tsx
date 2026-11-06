'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import { listGoodsAfterSalesTemplatesAction, saveGoodsAfterSalesTemplateAction, type GoodsAfterSalesResult } from '@/app/admin/goods-after-sales-actions';
import type { GoodsAfterSalesValues, GoodsAfterSalesTemplate, GoodsAfterSalesTemplatePage } from '@/lib/goods-after-sales';
import { kstDateTimeText } from '@/lib/admin/list-export';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { GOOD_INPUT_CLASS, GOOD_TABLE_FRAME_CLASS } from '../GoodEditorParts';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { GoodsAfterSalesFields } from '../GoodsAfterSalesFields';

/* 템플릿 룩(ADR-0028). 독립 화면(/admin/catalog/after-sales-templates)이자 상품 A/S 패널의 선택 팝업이다. */
const EXCERPT_CLASS = 'block max-h-28 max-w-[17.5rem] overflow-auto whitespace-pre-wrap wrap-anywhere';
/* 보관 상태 선택은 화면에 하나뿐이다(선택 팝업에는 그리지 않는다). */
const ARCHIVED_SELECT_ID = 'goods-after-sales-template-archived';

function AfterSalesTemplateEditor({ template, onClose, onSaved }: { template: GoodsAfterSalesTemplate | null; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<GoodsAfterSalesValues>({ phone: template?.phone ?? '', guide: template?.guide ?? '', sellerSpecialNotes: template?.sellerSpecialNotes ?? '' }), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false), [message, setMessage] = useState('');
  const busy = useRef(false), request = useRef<{ id: string; values: GoodsAfterSalesValues; archived: boolean; revision: number; operationId: string } | null>(null);
  async function save(archived = false) {
    if (busy.current || conflict) return;
    busy.current = true; setPending(true); setMessage('');
    request.current ??= { id: template?.id ?? crypto.randomUUID(), values, archived, revision: template?.revision ?? 0, operationId: crypto.randomUUID() };
    const fixed = request.current;
    let result: GoodsAfterSalesResult<GoodsAfterSalesTemplate>;
    try { result = await saveGoodsAfterSalesTemplateAction(fixed.id, fixed.values, fixed.archived, fixed.revision, fixed.operationId); }
    catch { result = { ok: false, uncertain: true, error: '저장 결과를 확인하지 못했습니다. 같은 요청 결과를 확인해주세요.' }; }
    busy.current = false; setPending(false);
    if (!result.ok) { setMessage(result.error); setUncertain(Boolean(result.uncertain)); setConflict(Boolean(result.conflict)); if (!result.uncertain) request.current = null; return; }
    request.current = null; onSaved();
  }
  return <CustomerServiceDialog title={template ? 'A/S 템플릿 수정' : 'A/S 템플릿 등록'} busy={pending || uncertain} onClose={onClose}>
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); void save(template?.archived ?? false); }} className="flex min-w-0 flex-col gap-4 text-sm" data-goods-after-sales-template-form="">
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={pending || uncertain || conflict}><GoodsAfterSalesFields values={values} onChange={setValues} /></fieldset>
      <p className="text-muted-foreground">불러온 전화번호·안내·특이사항은 상품에 복사됩니다. 템플릿 수정·보관으로 이미 저장된 상품 안내가 바뀌지 않습니다.</p>
      {message ? <p className="text-destructive" role="alert">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        {uncertain ? <button type="button" className={buttonVariants()} data-slot="button" disabled={pending} onClick={() => void save()}>같은 요청 결과 확인</button> : <button className={buttonVariants()} data-slot="button" disabled={pending || conflict}>저장</button>}
        {template ? <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={pending || uncertain || conflict} onClick={() => void save(!template.archived)}>{template.archived ? '복구' : '보관'}</button> : null}
        {conflict ? <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" onClick={onSaved}>입력 닫고 최신 목록 조회</button> : null}
        <button type="button" className={buttonVariants({ variant: 'ghost' })} data-slot="button" disabled={pending || uncertain} onClick={onClose}>닫기</button>
      </div>
    </form>
  </CustomerServiceDialog>;
}

export function GoodsAfterSalesTemplatesScreen({ onSelect }: { onSelect?: (template: GoodsAfterSalesTemplate) => void }) {
  const [data, setData] = useState<GoodsAfterSalesTemplatePage | null>(null), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [archived, setArchived] = useState(false);
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [editor, setEditor] = useState<{ template: GoodsAfterSalesTemplate | null } | null>(null);
  const busy = useRef(false), mounted = useRef(true), readSequence = useRef(0);
  useEffect(() => {
    mounted.current = true; let active = true; const sequence = ++readSequence.current;
    void listGoodsAfterSalesTemplatesAction('', false, 1).then(result => {
      if (!active || sequence !== readSequence.current) return; if (result.ok) setData(result.value); else setMessage(result.error);
    }).catch(() => { if (active && sequence === readSequence.current) setMessage('템플릿을 불러오지 못했습니다. 다시 조회해주세요.'); });
    return () => { active = false; mounted.current = false; };
  }, []);
  async function load(nextPage = 1, nextQuery = search, nextArchived = archived) {
    if (busy.current) return;
    const sequence = ++readSequence.current;
    busy.current = true; setPending(true); setMessage('');
    try {
      let result = await listGoodsAfterSalesTemplatesAction(nextQuery, nextArchived, nextPage);
      if (result.ok && nextPage > Math.max(1, Math.ceil(result.value.total / 20))) result = await listGoodsAfterSalesTemplatesAction(nextQuery, nextArchived, Math.max(1, Math.ceil(result.value.total / 20)));
      if (!mounted.current || sequence !== readSequence.current) return;
      if (result.ok) { setData(result.value); setSearch(nextQuery); setArchived(nextArchived); }
      else setMessage(result.error);
    } catch { if (mounted.current && sequence === readSequence.current) setMessage('템플릿을 불러오지 못했습니다. 다시 조회해주세요.'); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  return <section className="flex min-w-0 flex-col gap-4 text-sm" data-goods-after-sales-templates="">
    <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 text-card-foreground" onSubmit={event => { event.preventDefault(); void load(1, query, archived); }}>
      <label className="flex min-w-0 flex-1 basis-60 flex-col gap-2"><span className="font-medium">A/S 안내 검색</span><input className={GOOD_INPUT_CLASS} data-slot="input" value={query} onChange={event => setQuery(event.target.value)} maxLength={100} type="search" /></label>
      {!onSelect ? <div className="flex min-w-0 flex-col gap-2"><Label htmlFor={ARCHIVED_SELECT_ID}>보관 상태</Label><NativeSelect className="w-full sm:w-32" id={ARCHIVED_SELECT_ID} value={archived ? 'archived' : 'active'} onChange={event => void load(1, search, event.target.value === 'archived')} disabled={pending}><option value="active">사용 중</option><option value="archived">보관됨</option></NativeSelect></div> : null}
      <button className={buttonVariants()} data-slot="button" disabled={pending}><Search aria-hidden="true" />검색</button>
    </form>
    {message ? <p className="text-destructive" role="alert">{message}</p> : null}
    {data ? <>
      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="font-medium tabular-nums">조회 결과 {data.total.toLocaleString('ko-KR')}건</strong>{!onSelect ? <button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" onClick={() => setEditor({ template: null })}><Plus aria-hidden="true" />A/S 템플릿 등록</button> : null}</div>
      <div className={GOOD_TABLE_FRAME_CLASS} role="region" aria-label="A/S 템플릿 목록 가로 스크롤" tabIndex={0}><Table className="min-w-[35rem]"><TableCaption className="sr-only">A/S 템플릿 목록</TableCaption><TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead className="px-3">A/S 전화번호</TableHead><TableHead className="px-3">A/S 안내</TableHead><TableHead className="px-3">판매자 특이사항</TableHead><TableHead className="px-3">등록일</TableHead><TableHead className="px-3">{onSelect ? '선택' : '관리'}</TableHead></TableRow></TableHeader><TableBody>
        {data.rows.map(row => <TableRow key={row.id}><TableCell className="px-3 align-top tabular-nums">{row.phone}</TableCell><TableCell className="px-3 align-top whitespace-normal"><span className={EXCERPT_CLASS}>{row.guide}</span></TableCell><TableCell className="px-3 align-top whitespace-normal"><span className={EXCERPT_CLASS}>{row.sellerSpecialNotes || '—'}</span></TableCell><TableCell className="px-3 align-top text-muted-foreground tabular-nums">{kstDateTimeText(row.createdAt)}</TableCell><TableCell className="px-3 align-top"><button type="button" className={buttonVariants({ variant: 'outline', size: 'xs' })} data-slot="button" onClick={() => onSelect ? onSelect(row) : setEditor({ template: row })}>{onSelect ? '선택' : '수정'}</button></TableCell></TableRow>)}
        {!data.rows.length ? <TableRow className="hover:bg-transparent"><TableCell className="px-3 py-10 text-center text-muted-foreground" colSpan={5}>등록된 A/S 템플릿이 없습니다.</TableCell></TableRow> : null}
      </TableBody></Table></div>
      <nav aria-label="A/S 템플릿 페이지" className="flex flex-wrap items-center justify-center gap-3"><button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" disabled={pending || data.page <= 1} onClick={() => void load(data.page - 1)}>이전</button><span className="text-sm text-muted-foreground tabular-nums">{data.page} / {Math.max(1, Math.ceil(data.total / 20))} 페이지</span><button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" disabled={pending || data.page * 20 >= data.total} onClick={() => void load(data.page + 1)}>다음</button></nav>
    </> : <p className="py-10 text-center text-muted-foreground" role="status">{message ? '조회 후에 템플릿을 관리할 수 있습니다.' : '템플릿을 불러오는 중…'}</p>}
    {editor ? <AfterSalesTemplateEditor template={editor.template} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void load(data?.page ?? 1); }} /> : null}
  </section>;
}
export function GoodsAfterSalesTemplatePicker({ onClose, onSelect }: { onClose: () => void; onSelect: (template: GoodsAfterSalesTemplate) => void }) {
  return <CustomerServiceDialog title="A/S 템플릿" onClose={onClose} wide><GoodsAfterSalesTemplatesScreen onSelect={onSelect} /></CustomerServiceDialog>;
}
