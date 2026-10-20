'use client';

import { useState, useTransition } from 'react';
import { archiveCsReplyTemplateAction, listCsReplyTemplatesAction, readCsReplyTemplateAction, saveCsReplyTemplateAction } from '@/app/admin/cs-reply-actions';
import { useCsEditorDraft } from '@/components/admin/useCsEditorDraft';
import { CS_TEMPLATE_DRAFT_LIMIT, EMPTY_CS_TEMPLATE_WORKSPACE, parseQuestionTemplateWorkspace, parseReviewTemplateWorkspace,
  type CsTemplateDraft, type CsTemplateWorkspace } from '@/lib/admin/cs-editor-drafts';
import { CS_REPLY_SURFACE_LABELS, CS_REPLY_TEMPLATE_CATEGORIES, CS_REPLY_TEMPLATE_PAGE_SIZE, csReplyBodyLimit, insertCsReplyTemplate,
  type CsReplySurface, type CsReplyTemplate, type CsReplyTemplateCategory, type CsReplyTemplateList } from '@/lib/admin/cs-reply-tools';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { CsEditorDraftNotice, CsTemplateDraftList } from './CsEditorDraftNotice';

export function CsReplyTemplateTools({ surface, body, onInsert, disabled = false, accountId = '' }: {
  surface: CsReplySurface; body: string; onInsert: (body: string) => void; disabled?: boolean; accountId?: string;
}) {
  const [open, setOpen] = useState(false), [pending, startTransition] = useTransition();
  const [data, setData] = useState<CsReplyTemplateList>({ rows: [], total: 0, page: 1 });
  const [query, setQuery] = useState(''), [category, setCategory] = useState(''), [archived, setArchived] = useState(false);
  const [cleanDrafts, setCleanDrafts] = useState<Record<string, CsTemplateDraft>>({}), [selected, setSelected] = useState<string | null>(null);
  const [latest, setLatest] = useState<CsReplyTemplate | null>(null), [error, setError] = useState(''), [message, setMessage] = useState('');
  const recovery = useCsEditorDraft({ accountId, scope: `${surface}-templates`, recordId: 'shared', enabled: open,
    parse: surface === 'review' ? parseReviewTemplateWorkspace : parseQuestionTemplateWorkspace });
  const workspace = recovery.value ?? EMPTY_CS_TEMPLATE_WORKSPACE;
  const draft = selected ? workspace.drafts[selected] ?? cleanDrafts[selected] : null;
  const uncertain = workspace.pending?.kind === 'public';
  const locked = pending || uncertain || !recovery.ready || recovery.blocked || recovery.recovery !== null;
  const limit = csReplyBodyLimit(surface);

  function keep(value: CsTemplateWorkspace) {
    return recovery.change(Object.keys(value.drafts).length || value.pending ? value : null);
  }
  function without(id: string) {
    const drafts = { ...workspace.drafts }; delete drafts[id];
    return { drafts, selected: workspace.selected === id ? null : workspace.selected, pending: null };
  }
  async function load(page = 1) {
    const result = await listCsReplyTemplatesAction({ surface, query, category, archived, page });
    if (result.ok) setData(result.data); else setError(result.error);
  }
  function run(work: () => Promise<void>) {
    startTransition(async () => { setError(''); setMessage(''); try { await work(); } catch { setError('처리 결과를 확인하지 못했습니다. 작성 중인 문구는 유지됩니다.'); } });
  }
  function edit(template: CsReplyTemplate) {
    setCleanDrafts(previous => ({ ...previous, [template.id]: template })); setSelected(template.id); setLatest(null); setError(''); setMessage('');
  }
  function changeDraft(value: CsTemplateDraft) {
    if (locked) return;
    if (!workspace.drafts[value.id] && Object.keys(workspace.drafts).length >= CS_TEMPLATE_DRAFT_LIMIT) {
      setError(`편집 초안은 최대 ${CS_TEMPLATE_DRAFT_LIMIT}개입니다. 기존 초안을 저장하거나 정리해주세요.`); return;
    }
    if (keep({ ...workspace, drafts: { ...workspace.drafts, [value.id]: value }, selected: value.id })) {
      setSelected(value.id); setLatest(null); setError(''); setMessage('');
    }
  }
  function newDraft() { changeDraft({ id: crypto.randomUUID(), title: '', body, category: 'other', revision: 0 }); }
  function restore() {
    const value = recovery.restore(); if (!value) return;
    setSelected(value.selected); setLatest(null); setError(''); setMessage(value.pending ? '이전 저장 결과를 먼저 확인해주세요. 자동으로 다시 저장하지 않습니다.' : '편집 초안을 복구했습니다. 저장하면 기존 버전을 다시 검사합니다.');
  }
  function discard() { recovery.discard(); setSelected(null); setLatest(null); setError(''); setMessage(''); }
  function insert(template: CsReplyTemplate) {
    const result = insertCsReplyTemplate(body, template.body, limit);
    if (!result.ok) { setError(result.error); return; }
    onInsert(result.body); setOpen(false);
  }
  async function accept(template: CsReplyTemplate, readback = false) {
    if (!keep(without(template.id))) return;
    setCleanDrafts(previous => ({ ...previous, [template.id]: template })); setSelected(template.id); setLatest(null);
    try { await load(data.page); } catch { setError('저장본은 확인했지만 목록을 다시 불러오지 못했습니다. 검색을 눌러 최신 목록을 확인해주세요.'); }
    setMessage(readback ? '현재 저장본이 작성 문구와 일치합니다. 해당 초안을 정리했습니다.' : '답변 템플릿을 저장했습니다. 해당 초안을 정리했습니다.');
  }
  async function save() {
    if (!draft || locked) return;
    const request = { kind: 'public' as const, surface, draft };
    if (!keep({ ...workspace, pending: request })) return;
    run(async () => {
      try {
        const result = await saveCsReplyTemplateAction({ ...draft, surface });
        if (!result.ok) {
          if (!result.uncertain) keep({ ...workspace, pending: null });
          setError(result.error); return;
        }
        await accept(result.template);
      } catch { setError('저장 결과가 불확실합니다. 입력과 대상 버전을 보존했으니 최신 저장본을 확인해주세요.'); }
    });
  }
  function readLatest() {
    const request = workspace.pending?.kind === 'public' ? workspace.pending.draft : null;
    const target = request ?? draft; if (!target) return;
    run(async () => {
      const result = await readCsReplyTemplateAction({ id: target.id, surface });
      if (!result.ok) { setError(result.error); return; }
      const current = result.template;
      if (request && current && !current.archivedAt && current.category === request.category
        && current.title === request.title.trim() && current.body === request.body.trim() && current.revision >= request.revision) {
        await accept(current, true); return;
      }
      if (request) keep({ ...workspace, pending: null });
      setLatest(current);
      setMessage(current ? '최신 저장본을 확인했습니다. 작성 문구와 이전 버전은 유지됩니다. 버전이 다르면 그대로 덮어쓸 수 없습니다.'
        : '현재 조회되는 저장본이 없습니다. 작성 문구와 대상 번호를 유지했으며 다시 저장할 때 같은 버전을 검사합니다.');
    });
  }

  return <>
    <button className="btn btn-sm btn-ghost" disabled={disabled} type="button" onClick={() => { setOpen(true); run(() => load()); }}>답변 템플릿 불러오기</button>
    {open ? <CustomerServiceDialog title={`${CS_REPLY_SURFACE_LABELS[surface]} 답변 템플릿`} busy={pending || uncertain} onClose={() => setOpen(false)} wide>
      <p className="muted">상품 상세에 공개할 답변을 준비합니다. 템플릿을 불러오면 작성 중인 내용 뒤에 추가합니다.</p>
      <CsEditorDraftNotice draft={recovery} pending={pending} onRestore={restore} onDiscard={discard} discardLabel="보관 초안 모두 버리기"
        discardDisabled={uncertain || Boolean(recovery.recovery?.pending)} />
      <CsTemplateDraftList drafts={workspace.drafts} disabled={locked} onSelect={id => { setSelected(id); setLatest(null); setError(''); setMessage(''); }} />
      <form className="admin-cs-template__search" onSubmit={event => { event.preventDefault(); run(() => load()); }}>
        <label>유형<select disabled={locked} value={category} onChange={event => setCategory(event.target.value)}><option value="">전체</option>{CS_REPLY_TEMPLATE_CATEGORIES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>제목<input disabled={locked} value={query} onChange={event => setQuery(event.target.value)} maxLength={100} /></label>
        <label className="admin-cs-template__archive"><input disabled={locked} type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} /> 삭제한 템플릿</label>
        <button type="submit" className="btn btn-sm" disabled={locked}>검색</button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={locked} onClick={newDraft}>템플릿 등록</button>
      </form>
      <p aria-live="polite">총 {data.total.toLocaleString('ko-KR')}개{pending ? ' · 처리 중' : ''}</p>
      {error ? <p className="admin-form-error" role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
      {uncertain ? <button type="button" className="btn btn-sm" disabled={pending || recovery.blocked} onClick={readLatest}>이전 저장 결과 · 최신 저장본 확인</button> : null}
      <div className="admin-cs-template__list">{data.rows.length ? data.rows.map(template => <article key={template.id}>
        <header><span>{CS_REPLY_TEMPLATE_CATEGORIES.find(option => option.value === template.category)?.label}</span><strong>{template.title}</strong><small>버전 {template.revision}</small></header>
        <p>{template.body}</p>
        <div className="admin-cs-template__actions">
          {!template.archivedAt ? <><button type="button" className="btn btn-sm" disabled={locked} onClick={() => insert(template)}>불러오기</button><button type="button" className="btn btn-sm btn-ghost" disabled={locked} onClick={() => edit(template)}>수정</button></> : null}
          <button type="button" className="btn btn-sm btn-ghost" disabled={locked} onClick={() => run(async () => {
            const result = await archiveCsReplyTemplateAction({ id: template.id, revision: template.revision, archived: !template.archivedAt });
            if (!result.ok) { setError(result.error); return; }
            await load(data.page); setMessage(template.archivedAt ? '템플릿을 복구했습니다. 편집 초안은 유지됩니다.' : '템플릿을 삭제했습니다. 편집 초안은 유지되며 삭제된 템플릿은 복구 후 수정할 수 있습니다.');
          })}>{template.archivedAt ? '복구' : '삭제'}</button>
        </div>
      </article>) : <p className="muted">조건에 맞는 템플릿이 없습니다.</p>}</div>
      <nav className="admin-cs-record-nav" aria-label="답변 템플릿 목록 페이지">
        <button type="button" className="btn btn-sm btn-ghost" disabled={locked || data.page <= 1} onClick={() => run(() => load(data.page - 1))}>이전</button>
        <span>{data.page} / {Math.max(1, Math.ceil(data.total / CS_REPLY_TEMPLATE_PAGE_SIZE))}</span>
        <button type="button" className="btn btn-sm btn-ghost" disabled={locked || data.page * CS_REPLY_TEMPLATE_PAGE_SIZE >= data.total} onClick={() => run(() => load(data.page + 1))}>다음</button>
      </nav>
      {draft ? <form className="admin-cs-template__editor" onSubmit={event => { event.preventDefault(); void save(); }}>
        <h3>{draft.revision ? '템플릿 수정' : '템플릿 등록'}</h3>
        <label>편집 유형<select disabled={locked} value={draft.category} onChange={event => changeDraft({ ...draft, category: event.target.value as CsReplyTemplateCategory })}>{CS_REPLY_TEMPLATE_CATEGORIES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>템플릿 제목<input required disabled={locked} maxLength={70} value={draft.title} onChange={event => changeDraft({ ...draft, title: [...event.target.value].slice(0, 35).join('') })} /></label>
        <small>{[...draft.title].length} / 35자</small>
        <label>템플릿 내용<textarea required disabled={locked} rows={6} maxLength={limit * 2} value={draft.body} onChange={event => changeDraft({ ...draft, body: [...event.target.value].slice(0, limit).join('') })} /></label>
        <small>{[...draft.body].length} / {limit.toLocaleString('ko-KR')}자</small>
        <div className="admin-cs-template__actions"><button type="submit" className="btn btn-sm" disabled={locked}>템플릿 저장</button><button type="button" className="btn btn-sm btn-ghost" disabled={locked} onClick={() => setSelected(null)}>편집 닫기 · 문구 보존</button>
          {draft.revision ? <button type="button" className="btn btn-sm btn-ghost" disabled={locked} onClick={readLatest}>최신 저장본 비교</button> : null}
        </div>
        {latest && latest.id === draft.id ? <section className="admin-cs-record__content" aria-label="최신 템플릿 저장본">
          <h3>최신 저장본 · 버전 {latest.revision}{latest.archivedAt ? ' · 삭제됨' : ''}</h3><strong>{latest.title}</strong><p>{latest.body}</p>
          <p className="muted">작성 문구를 유지했습니다. 아래 버튼을 누를 때만 최신 저장본으로 바꿉니다.</p>
          <button type="button" className="btn btn-sm btn-ghost" disabled={locked || Boolean(latest.archivedAt)} onClick={() => {
            if (!keep(without(latest.id))) return; setCleanDrafts(previous => ({ ...previous, [latest.id]: latest })); setLatest(null);
          }}>편집 문구를 최신 저장본으로 바꾸기</button>
        </section> : null}
      </form> : null}
    </CustomerServiceDialog> : null}
  </>;
}
