'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { listGoodsAfterSalesTemplatesAction, saveGoodsAfterSalesTemplateAction, type GoodsAfterSalesResult } from '@/app/admin/goods-after-sales-actions';
import type { GoodsAfterSalesValues, GoodsAfterSalesTemplate, GoodsAfterSalesTemplatePage } from '@/lib/goods-after-sales';
import { kstDateTimeText } from '@/lib/admin/list-export';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { GoodsAfterSalesFields } from '../GoodsAfterSalesFields';

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
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); void save(template?.archived ?? false); }} className="admin-goods-after-sales__template-form">
      <fieldset disabled={pending || uncertain || conflict}><GoodsAfterSalesFields values={values} onChange={setValues} /></fieldset>
      <p>불러온 전화번호·안내·특이사항은 상품에 복사됩니다. 템플릿 수정·보관으로 이미 저장된 상품 안내가 바뀌지 않습니다.</p>
      {message ? <p role="alert">{message}</p> : null}
      <div className="admin-goods-after-sales__actions">
        {uncertain ? <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void save()}>같은 요청 결과 확인</button> : <button className="btn btn-primary" disabled={pending || conflict}>저장</button>}
        {template ? <button type="button" className="btn" disabled={pending || uncertain || conflict} onClick={() => void save(!template.archived)}>{template.archived ? '복구' : '보관'}</button> : null}
        {conflict ? <button type="button" className="btn" onClick={onSaved}>입력 닫고 최신 목록 조회</button> : null}
        <button type="button" className="btn" disabled={pending || uncertain} onClick={onClose}>닫기</button>
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
  return <section className="wc-admin-kit admin-console admin-goods-after-sales admin-goods-after-sales__templates">
    <form className="admin-goods-after-sales__search" onSubmit={event => { event.preventDefault(); void load(1, query, archived); }}>
      <label>A/S 안내 검색<input value={query} onChange={event => setQuery(event.target.value)} maxLength={100} type="search" /></label>
      {!onSelect ? <label>보관 상태<select value={archived ? 'archived' : 'active'} onChange={event => void load(1, search, event.target.value === 'archived')} disabled={pending}><option value="active">사용 중</option><option value="archived">보관됨</option></select></label> : null}
      <button className="btn btn-primary" disabled={pending}>검색</button>
    </form>
    {message ? <p role="alert">{message}</p> : null}
    {data ? <>
      <div className="admin-goods-after-sales__result"><strong>조회 결과 {data.total.toLocaleString('ko-KR')}건</strong>{!onSelect ? <button className="btn" type="button" onClick={() => setEditor({ template: null })}>A/S 템플릿 등록</button> : null}</div>
      <div className="admin-goods-after-sales__table" role="region" aria-label="A/S 템플릿 목록 가로 스크롤" tabIndex={0}><table><caption className="wc-sr-only">A/S 템플릿 목록</caption><thead><tr><th>A/S 전화번호</th><th>A/S 안내</th><th>판매자 특이사항</th><th>등록일</th><th>{onSelect ? '선택' : '관리'}</th></tr></thead><tbody>
        {data.rows.map(row => <tr key={row.id}><td>{row.phone}</td><td><span className="admin-goods-after-sales__excerpt">{row.guide}</span></td><td><span className="admin-goods-after-sales__excerpt">{row.sellerSpecialNotes || '—'}</span></td><td>{kstDateTimeText(row.createdAt)}</td><td><button type="button" className="btn" onClick={() => onSelect ? onSelect(row) : setEditor({ template: row })}>{onSelect ? '선택' : '수정'}</button></td></tr>)}
        {!data.rows.length ? <tr><td colSpan={5}>등록된 A/S 템플릿이 없습니다.</td></tr> : null}
      </tbody></table></div>
      <nav aria-label="A/S 템플릿 페이지" className="admin-goods-after-sales__actions"><button className="btn" type="button" disabled={pending || data.page <= 1} onClick={() => void load(data.page - 1)}>이전</button><span>{data.page} / {Math.max(1, Math.ceil(data.total / 20))} 페이지</span><button className="btn" type="button" disabled={pending || data.page * 20 >= data.total} onClick={() => void load(data.page + 1)}>다음</button></nav>
    </> : <p role="status">{message ? '조회 후에 템플릿을 관리할 수 있습니다.' : '템플릿을 불러오는 중…'}</p>}
    {editor ? <AfterSalesTemplateEditor template={editor.template} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void load(data?.page ?? 1); }} /> : null}
  </section>;
}
export function GoodsAfterSalesTemplatePicker({ onClose, onSelect }: { onClose: () => void; onSelect: (template: GoodsAfterSalesTemplate) => void }) {
  return <CustomerServiceDialog title="A/S 템플릿" onClose={onClose} wide><GoodsAfterSalesTemplatesScreen onSelect={onSelect} /></CustomerServiceDialog>;
}
