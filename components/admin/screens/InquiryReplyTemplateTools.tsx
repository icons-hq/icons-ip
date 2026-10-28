'use client';

import { useState } from 'react';
import { useCsEditorDraft } from '@/components/admin/useCsEditorDraft';
import { CS_TEMPLATE_DRAFT_LIMIT, EMPTY_CS_TEMPLATE_WORKSPACE, parseInquiryTemplateWorkspace, type CsTemplateWorkspace } from '@/lib/admin/cs-editor-drafts';
import { listInquiryReplyTemplatesAction, mutateInquiryReplyTemplateAction, readInquiryReplyTemplateAction, readInquiryTemplateOperationAction } from '@/app/admin/inquiry-reply-template-actions';
import { INQUIRY_TEMPLATE_CATEGORIES, INQUIRY_TEMPLATE_PAGE_SIZE, INQUIRY_TEMPLATE_TITLE_LIMIT, INQUIRY_TEMPLATE_BODY_LIMIT,
  REPLY_TEMPLATE_REPLACE_CONFIRM, REPLY_TEMPLATE_REPLACE_HINT, applyInquiryReplyTemplate, type InquiryTemplateDraft, type InquiryTemplateList, type InquiryTemplateMutation,
  type InquiryTemplateReceipt, type InquiryReplyTemplate } from '@/lib/admin/inquiry-reply-templates';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { CsEditorDraftNotice, CsTemplateDraftList } from './CsEditorDraftNotice';

export function InquiryReplyTemplateTools({ body, onInsert, disabled = false, accountId = '', label = '답변 템플릿 불러오기' }: { body: string; onInsert: (value: string) => void; disabled?: boolean; accountId?: string; label?: string }) {
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [query, setQuery] = useState(''), [category, setCategory] = useState(''), [archived, setArchived] = useState(false);
  const [data, setData] = useState<InquiryTemplateList>({ rows: [], total: 0, page: 1 });
  const [cleanDrafts, setCleanDrafts] = useState<Record<string, InquiryTemplateDraft>>({}), [selected, setSelected] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null), [latest, setLatest] = useState<InquiryReplyTemplate | null>(null);
  const [attempt, setAttempt] = useState<InquiryTemplateMutation | null>(null), [error, setError] = useState(''), [message, setMessage] = useState('');
  const recovery = useCsEditorDraft({ accountId, scope: 'inquiry-templates', recordId: 'shared', enabled: open, parse: parseInquiryTemplateWorkspace });
  const workspace = recovery.value ?? EMPTY_CS_TEMPLATE_WORKSPACE;
  const locked = pending || uncertain || !recovery.ready || recovery.blocked || recovery.recovery !== null;
  const draft = selected ? workspace.drafts[selected] ?? cleanDrafts[selected] : null;
  function keep(value: CsTemplateWorkspace) { return recovery.change(Object.keys(value.drafts).length || value.pending ? value : null); }
  function without(id: string) {
    const drafts = { ...workspace.drafts }; delete drafts[id];
    return { drafts, selected: workspace.selected === id ? null : workspace.selected, pending: null };
  }
  function restore() {
    const value = recovery.restore(); if (!value) return;
    setSelected(value.selected); setLatest(null); setError('');
    setNewId(value.selected && value.drafts[value.selected]?.revision === 0 ? value.selected : null);
    const operation = value.pending?.kind === 'inquiry' ? value.pending.operation : null;
    setAttempt(operation); setUncertain(Boolean(operation));
    setMessage(operation ? '이전 저장 요청을 복구했습니다. 같은 요청의 결과를 먼저 확인해주세요.' : '편집 초안을 복구했습니다. 저장하면 기존 버전을 다시 검사합니다.');
  }
  function discard() { recovery.discard(); setSelected(null); setNewId(null); setAttempt(null); setLatest(null); setError(''); setMessage(''); }
  async function load(page = 1) {
    const result = await listInquiryReplyTemplatesAction({ query, category, archived, page });
    if ('error' in result) { setError(result.error); return; }
    setData(result.data);
  }
  async function run(work: () => Promise<void>) {
    if (pending) return;
    setPending(true); setError(''); setMessage('');
    try { await work(); } catch { setError('목록을 확인하지 못했습니다. 작성 중인 내용은 유지됩니다.'); }
    finally { setPending(false); }
  }
  function edit(row: InquiryReplyTemplate) {
    setCleanDrafts(previous => ({ ...previous, [row.id]: row }));
    setSelected(row.id); setLatest(null); setError(''); setMessage(''); setAttempt(null);
  }
  function createDraft() {
    const id = newId ?? crypto.randomUUID(); setNewId(id);
    if (!workspace.drafts[id] && Object.keys(workspace.drafts).length >= CS_TEMPLATE_DRAFT_LIMIT) { setError(`편집 초안은 최대 ${CS_TEMPLATE_DRAFT_LIMIT}개입니다. 기존 초안을 저장하거나 정리해주세요.`); return; }
    if (!keep({ ...workspace, drafts: { ...workspace.drafts, [id]: workspace.drafts[id] ?? { id, revision: 0, category: 'other', title: '', body } }, selected: id })) return;
    setSelected(id); setLatest(null); setError(''); setMessage(''); setAttempt(null);
  }
  function updateDraft(patch: Partial<InquiryTemplateDraft>) {
    if (!draft || locked) return;
    if (!workspace.drafts[draft.id] && Object.keys(workspace.drafts).length >= CS_TEMPLATE_DRAFT_LIMIT) { setError(`편집 초안은 최대 ${CS_TEMPLATE_DRAFT_LIMIT}개입니다. 기존 초안을 저장하거나 정리해주세요.`); return; }
    keep({ ...workspace, drafts: { ...workspace.drafts, [draft.id]: { ...draft, ...patch } }, selected: draft.id }); setAttempt(null); setError(''); setMessage('');
  }
  async function acceptReceipt(receipt: InquiryTemplateReceipt) {
    if (!keep(receipt.action === 'save' ? without(receipt.templateId) : { ...workspace, pending: null })) return;
    setUncertain(false); setAttempt(null); setLatest(null);
    if (receipt.action === 'save') {
      setCleanDrafts(previous => ({ ...previous, [receipt.templateId]: receipt.template }));
      setSelected(receipt.templateId); if (newId === receipt.templateId) setNewId(null);
    }
    try { await load(data.page); } catch { setError('변경은 저장됐지만 목록을 다시 불러오지 못했습니다. 검색을 눌러 최신 목록을 확인해주세요.'); }
    setMessage(receipt.action === 'archive' ? '템플릿을 삭제했습니다. 삭제한 템플릿에서 복구할 수 있습니다.'
      : receipt.action === 'restore' ? '템플릿을 복구했습니다. 편집 중이던 문구는 그대로 보존됩니다.' : '답변 템플릿을 저장했습니다. 고객에게 답변을 발송하지 않았습니다.');
  }
  async function mutate(intent: Omit<InquiryTemplateMutation, 'operationId'>) {
    if (locked) return;
    const sameAttempt = attempt && JSON.stringify({ ...attempt, operationId: '' }) === JSON.stringify({ ...intent, operationId: '' });
    const operation = { ...intent, operationId: sameAttempt ? attempt.operationId : crypto.randomUUID() };
    if (!keep({ ...workspace, pending: { kind: 'inquiry', operation } })) { setError('템플릿 입력을 확인해주세요. 초안은 유지됩니다.'); return; }
    setAttempt(operation);
    await run(async () => {
      try {
        const result = await mutateInquiryReplyTemplateAction(operation);
        if ('error' in result) { if (!result.uncertain) keep({ ...workspace, pending: null }); setError(result.error); setUncertain(Boolean(result.uncertain)); return; }
        await acceptReceipt(result.receipt);
      } catch { setUncertain(true); setError('저장 결과가 불확실합니다. 같은 요청의 결과를 먼저 확인해주세요.'); }
    });
  }
  async function readback() {
    if (!attempt) return;
    await run(async () => {
      const result = await readInquiryTemplateOperationAction(attempt.operationId);
      if ('error' in result) { setError(result.error); return; }
      if (!result.receipt) { keep({ ...workspace, pending: null }); setUncertain(false); setMessage('이 요청으로 저장된 변경이 없습니다. 같은 요청으로 다시 시도할 수 있습니다.'); return; }
      if (result.receipt.templateId !== attempt.templateId || result.receipt.action !== attempt.action) { setError('저장 결과가 현재 편집 대상과 다릅니다. 요청 정보를 확인해주세요.'); return; }
      await acceptReceipt(result.receipt);
    });
  }
  function insert(row: InquiryReplyTemplate) {
    const result = applyInquiryReplyTemplate(body, row.body);
    if (!result.ok) { setError(result.error); return; }
    if (result.replaces && !window.confirm(REPLY_TEMPLATE_REPLACE_CONFIRM)) return;
    onInsert(result.body); setOpen(false);
  }
  return <>
    <button className="btn btn-sm btn-ghost" disabled={disabled} type="button" onClick={() => { setOpen(true); void run(() => load()); }}>{label}</button>
    {open ? <CustomerServiceDialog title="고객문의 답변 템플릿" busy={locked} onClose={() => { if (!locked) setOpen(false); }} wide>
      <p className="muted">운영자가 공유하는 고객문의용 문구입니다. {REPLY_TEMPLATE_REPLACE_HINT} 템플릿 관리만으로 메일·알림을 보내지 않습니다.</p>
      <CsEditorDraftNotice draft={recovery} pending={pending} onRestore={restore} onDiscard={discard} discardLabel="보관 초안 모두 버리기"
        discardDisabled={uncertain || Boolean(recovery.recovery?.pending)} />
      <CsTemplateDraftList drafts={workspace.drafts} disabled={locked} onSelect={id => { setSelected(id); setLatest(null); setAttempt(null); setError(''); setMessage(''); }} />
      <form className="admin-cs-template__search" onSubmit={event => { event.preventDefault(); void run(() => load()); }}>
        <label>유형<select disabled={locked} value={category} onChange={event => setCategory(event.target.value)}><option value="">전체</option>{INQUIRY_TEMPLATE_CATEGORIES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>제목<input disabled={locked} value={query} maxLength={100} onChange={event => setQuery(event.target.value)} /></label>
        <label className="admin-cs-template__archive"><input type="checkbox" disabled={locked} checked={archived} onChange={event => setArchived(event.target.checked)} />삭제한 템플릿</label>
        <button className="btn btn-sm" disabled={locked} type="submit">검색</button>
        <button className="btn btn-sm btn-ghost" disabled={locked} type="button" onClick={createDraft}>템플릿 등록</button>
      </form>
      <p aria-live="polite">총 {data.total.toLocaleString('ko-KR')}개{pending ? ' · 처리 중' : ''}</p>
      {error ? <p className="admin-form-error" role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {uncertain ? <div className="admin-cs-template__actions"><p>입력과 요청 번호를 보존했습니다. 확인 전에는 새 저장 요청을 만들지 않습니다.</p><button className="btn btn-sm" disabled={pending} type="button" onClick={() => { void readback(); }}>같은 요청의 저장 결과 확인</button></div> : null}
      <div className="admin-cs-template__list">{data.rows.length ? data.rows.map(row => <article key={row.id}>
        <header><span>{INQUIRY_TEMPLATE_CATEGORIES.find(option => option.value === row.category)?.label}</span><strong>{row.title}</strong><small>버전 {row.revision}</small></header><p>{row.body}</p>
        <div className="admin-cs-template__actions">
          {!row.archivedAt ? <><button className="btn btn-sm" disabled={locked} type="button" onClick={() => insert(row)}>불러오기</button><button className="btn btn-sm btn-ghost" disabled={locked} type="button" onClick={() => edit(row)}>수정</button></> : null}
          <button className="btn btn-sm btn-ghost" disabled={locked} type="button" onClick={() => { void mutate({ templateId: row.id, revision: row.revision, action: row.archivedAt ? 'restore' : 'archive', values: {} }); }}>{row.archivedAt ? '복구' : '삭제'}</button>
        </div>
      </article>) : <p className="muted">조건에 맞는 템플릿이 없습니다.</p>}</div>
      <nav className="admin-cs-record-nav" aria-label="고객문의 템플릿 목록 페이지">
        <button className="btn btn-sm btn-ghost" disabled={locked || data.page <= 1} type="button" onClick={() => { void run(() => load(data.page - 1)); }}>이전</button>
        <span>{data.page} / {Math.max(1, Math.ceil(data.total / INQUIRY_TEMPLATE_PAGE_SIZE))}</span>
        <button className="btn btn-sm btn-ghost" disabled={locked || data.page * INQUIRY_TEMPLATE_PAGE_SIZE >= data.total} type="button" onClick={() => { void run(() => load(data.page + 1)); }}>다음</button>
      </nav>
      {draft ? <form className="admin-cs-template__editor" onSubmit={event => { event.preventDefault(); void mutate({ templateId: draft.id, revision: draft.revision, action: 'save', values: { category: draft.category, title: draft.title, body: draft.body } }); }}>
        <h3>{draft.revision ? '템플릿 수정' : '템플릿 등록'}</h3>
        <label>편집 유형<select disabled={locked} value={draft.category} onChange={event => updateDraft({ category: event.target.value as InquiryTemplateDraft['category'] })}>{INQUIRY_TEMPLATE_CATEGORIES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>템플릿 제목<input required disabled={locked} maxLength={INQUIRY_TEMPLATE_TITLE_LIMIT} value={draft.title} onChange={event => updateDraft({ title: event.target.value })} /></label><small>{draft.title.length} / 40자</small>
        <label>템플릿 내용<textarea required disabled={locked} rows={6} maxLength={INQUIRY_TEMPLATE_BODY_LIMIT} value={draft.body} onChange={event => updateDraft({ body: event.target.value })} /></label><small>{draft.body.length} / 2,000자</small>
        <div className="admin-cs-template__actions"><button className="btn btn-sm" disabled={locked} type="submit">템플릿 저장</button><button className="btn btn-sm btn-ghost" disabled={locked} type="button" onClick={() => setSelected(null)}>편집 닫기 · 문구 보존</button>
          {draft.revision ? <button className="btn btn-sm btn-ghost" disabled={locked} type="button" onClick={() => { void run(async () => { const result = await readInquiryReplyTemplateAction(draft.id); if ('error' in result) setError(result.error); else if (!result.template) setError('최신 저장본이 없습니다. 편집 문구는 유지됩니다.'); else setLatest(result.template); }); }}>최신 저장본 비교</button> : null}
        </div>
        {latest && latest.id === draft.id ? <section className="card col" style={{ padding: 12, gap: 8 }}>
          <strong>최신 저장본 · 버전 {latest.revision}{latest.archivedAt ? ' · 삭제됨' : ''}</strong><span>{latest.title}</span><p style={{ whiteSpace: 'pre-wrap' }}>{latest.body}</p>
          <p className="faint">현재 편집 문구는 위 입력창에 유지됩니다. 아래 버튼을 누를 때만 최신 저장본으로 바꿉니다.</p>
          <button className="btn btn-sm btn-ghost" disabled={locked || Boolean(latest.archivedAt)} type="button" onClick={() => { if (!keep(without(latest.id))) return; setCleanDrafts(previous => ({ ...previous, [latest.id]: latest })); setAttempt(null); setLatest(null); }}>편집 문구를 최신 저장본으로 바꾸기</button>
        </section> : null}
      </form> : null}
    </CustomerServiceDialog> : null}
  </>;
}
