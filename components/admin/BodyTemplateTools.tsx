'use client';
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { archiveBodyTemplateAction, listBodyTemplatesAction, readBodyTemplateAction, saveBodyTemplateAction } from '@/app/admin/body-template-actions';
import { BODY_TEMPLATE_LIMIT, bodyTemplateLength, createBodyTemplateRequestLane, normalizeBodyTemplateBody, type BodyTemplate, type BodyTemplateArchiveRequest,
  type BodyTemplateEditorTarget, type BodyTemplateList, type BodyTemplateResult, type BodyTemplateSaveRequest, type BodyTemplateSurface } from '@/lib/admin/body-templates';
import { createGoodsDescriptionToolScope, type GoodsDescriptionToolTicket } from '@/lib/admin/goods-description-tools';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';

type Scope = ReturnType<typeof createGoodsDescriptionToolScope>;
type Draft = { id: string; revision: number; name: string; bodyHtml: string; archived: boolean };
type Mutation = { kind: 'save'; request: BodyTemplateSaveRequest } | { kind: 'archive'; request: BodyTemplateArchiveRequest };
type Workspace = { scope: Scope; ticket: GoodsDescriptionToolTicket; target: BodyTemplateEditorTarget; open: boolean;
  list: BodyTemplateList | null; archived: boolean; draft: Draft | null; baseline: Draft | null; latest: BodyTemplate | null;
  busy: boolean; retry: Mutation | null; message: string; error: string; replace: boolean; nextId: string | 'new' | null };
type Undo = { scope: Scope; before: string; after: string };
const asDraft = (row: BodyTemplate): Draft => ({ id: row.id, revision: row.revision, name: row.name, bodyHtml: row.bodyHtml, archived: row.archivedAt !== null });
const sameDraft = (a: Draft | null, b: Draft | null) => a?.id === b?.id && a?.revision === b?.revision && a?.name === b?.name && a?.bodyHtml === b?.bodyHtml && a?.archived === b?.archived;

export function BodyTemplateTools({ accountId, surface, disabled, captureEditor, insertLabel = '선택 위치에 넣기' }: {
  accountId: string; surface: BodyTemplateSurface; disabled: boolean;
  captureEditor: () => BodyTemplateEditorTarget | null; insertLabel?: string;
}) {
  const scope = useMemo(() => createGoodsDescriptionToolScope(accountId), [accountId]);
  const requests = useMemo(() => createBodyTemplateRequestLane(scope), [scope]);
  const snapshot = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot);
  const [workspace, setWorkspace] = useState<Workspace | null>(null), [undo, setUndo] = useState<Undo | null>(null), [outsideMessage, setOutsideMessage] = useState('');
  const unsaved = workspace?.scope === scope && (!sameDraft(workspace.draft, workspace.baseline) || Boolean(workspace.retry));
  useEffect(() => {
    if (!unsaved) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [unsaved]);
  useLayoutEffect(() => { scope.setEnabled(!disabled); }, [scope, disabled]);
  useEffect(() => {
    scope.activate(); const signOut = () => scope.authenticate(null, null);
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut);
    const subscription = getSupabaseConfig().isConfigured ? createClient().auth.onAuthStateChange((_event, session) => {
      scope.authenticate(session?.user.id ?? null, session ? inquiryDraftSessionId(session.access_token) : null);
    }).data.subscription : null;
    return () => { scope.dispose(); subscription?.unsubscribe(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut); };
  }, [scope]);
  const blocked = disabled || !snapshot.ready || snapshot.blocked;
  const active = workspace?.scope === scope && workspace.open && scope.canApply(workspace.ticket) && !blocked ? workspace : null;
  const draft = active?.draft;
  const preview = useMemo(() => draft ? normalizeBodyTemplateBody(surface, draft.bodyHtml) : null, [surface, draft]);
  const context = { surface, expectedActorId: accountId };
  function update(ticket: GoodsDescriptionToolTicket, change: (value: Workspace) => Workspace) {
    if (!scope.canApply(ticket)) return;
    setWorkspace(value => value?.scope === scope && value.ticket === ticket ? change(value) : value);
  }
  function beginRequest() { return requests.begin(); }
  function finishRequest(sequence: number) { requests.finish(sequence); }
  function updateRequest(ticket: GoodsDescriptionToolTicket, sequence: number, change: (value: Workspace) => Workspace) {
    update(ticket, value => requests.current(sequence) ? change(value) : value);
  }
  async function loadList(ticket: GoodsDescriptionToolTicket, archived: boolean, sequence: number) {
    const result = await listBodyTemplatesAction({ ...context, archived }).catch(() => ({ ok: false as const, error: '목록을 불러오지 못했습니다. 다시 시도해주세요.' }));
    updateRequest(ticket, sequence, value => result.ok ? { ...value, list: result.value, archived, busy: false }
      : { ...value, busy: false, error: value.message ? `${value.message} 목록은 다시 불러와주세요.` : result.error });
    finishRequest(sequence);
  }
  function refreshList(archived: boolean) {
    if (!active || active.busy || active.retry || requests.busy()) return;
    const sequence = beginRequest(); if (!sequence) return;
    update(active.ticket, value => ({ ...value, busy: true })); void loadList(active.ticket, archived, sequence);
  }
  function open() {
    if (requests.busy()) return;
    const ticket = scope.capture(), target = captureEditor();
    if (!ticket || !target) { setOutsideMessage('현재 본문이나 로그인 상태를 확인한 뒤 다시 열어주세요.'); return; }
    const previous = workspace?.scope === scope ? workspace : null;
    setWorkspace({ scope, ticket, target, open: true, list: previous?.list ?? null, archived: previous?.archived ?? false,
      draft: previous?.draft ?? null, baseline: previous?.baseline ?? null, latest: previous?.latest ?? null,
      retry: previous?.retry ?? null, busy: true, error: '', message: previous?.retry ? '이전 요청의 결과를 같은 요청으로 확인해주세요.' : '', replace: false, nextId: null });
    setOutsideMessage(''); const sequence = beginRequest(); if (sequence) void loadList(ticket, previous?.archived ?? false, sequence);
  }
  function close() {
    if (!active || active.busy || requests.busy()) return;
    setWorkspace(value => value?.scope === scope ? { ...value, open: false, replace: false, nextId: null } : value);
    scope.invalidate();
  }
  async function select(id: string | 'new', discard = false) {
    if (!active || active.busy || active.retry || requests.busy()) return;
    if (!discard && active.draft && !sameDraft(active.draft, active.baseline)) { update(active.ticket, value => ({ ...value, nextId: id })); return; }
    const ticket = active.ticket;
    if (id === 'new') {
      const clean = normalizeBodyTemplateBody(surface, active.target.bodyHtml);
      if (!clean.ok) { update(ticket, value => ({ ...value, error: clean.error, nextId: null })); return; }
      const next: Draft = { id: crypto.randomUUID(), revision: 0, name: '', bodyHtml: clean.value.html, archived: false };
      update(ticket, value => ({ ...value, draft: next, baseline: next, latest: null, nextId: null, error: '', message: clean.value.warnings.join(' ') })); return;
    }
    const sequence = beginRequest(); if (!sequence) return;
    update(ticket, value => ({ ...value, busy: true, nextId: null, error: '' }));
    const result = await readBodyTemplateAction({ ...context, id }).catch(() => ({ ok: false as const, error: '템플릿을 불러오지 못했습니다. 기존 편집은 유지됩니다.' }));
    updateRequest(ticket, sequence, value => result.ok ? { ...value, busy: false, draft: asDraft(result.value), baseline: asDraft(result.value), latest: null, message: result.value.warnings.join(' ') }
      : { ...value, busy: false, error: result.error });
    finishRequest(sequence);
  }
  async function mutate(operation?: Mutation) {
    if (!active || active.busy || requests.busy()) return;
    const ticket = active.ticket;
    const request = operation ?? active.retry;
    if (!request) return;
    const sequence = beginRequest(); if (!sequence) return;
    update(ticket, value => ({ ...value, retry: request, busy: true, error: '', message: '' }));
    const result: BodyTemplateResult<BodyTemplate> = await (request.kind === 'save' ? saveBodyTemplateAction(request.request) : archiveBodyTemplateAction(request.request))
      .catch(() => ({ ok: false as const, error: '요청 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }));
    if (!result.ok) {
      updateRequest(ticket, sequence, value => ({ ...value, busy: false, retry: result.uncertain ? request : null, error: result.error,
        message: result.committed ? '요청 처리는 확인됐습니다. 최신 저장본을 읽어 비교해주세요.' : '' })); finishRequest(sequence); return;
    }
    const next = asDraft(result.value);
    updateRequest(ticket, sequence, value => ({ ...value, busy: true, retry: null, draft: next, baseline: next, latest: null,
      message: `${request.kind === 'save' ? '템플릿 저장 내용을 확인했습니다.' : next.archived ? '템플릿을 보관했습니다. 보관함에서 복구할 수 있습니다.' : '템플릿을 복구했습니다.'} ${result.value.warnings.join(' ')}`.trim() }));
    await loadList(ticket, active.archived, sequence);
  }
  async function readLatest() {
    if (!active || !active.draft || active.busy || active.retry) return;
    const ticket = active.ticket, id = active.draft.id;
    const sequence = beginRequest(); if (!sequence) return;
    update(ticket, value => ({ ...value, busy: true, error: '' }));
    const result = await readBodyTemplateAction({ ...context, id }).catch(() => ({ ok: false as const, error: '최신 저장본을 읽지 못했습니다.' }));
    updateRequest(ticket, sequence, value => result.ok ? { ...value, busy: false, latest: result.value } : { ...value, busy: false, error: result.error });
    finishRequest(sequence);
  }
  function apply(mode: 'insert' | 'replace', confirmed = false) {
    if (!active || !preview?.ok || active.busy || active.retry || requests.busy()) return;
    if (mode === 'replace' && !confirmed) { update(active.ticket, value => ({ ...value, replace: true })); return; }
    // Normalize again at the destination, including when an edited template has
    // not been saved. The editor callback independently rejects a stale target.
    const clean = normalizeBodyTemplateBody(surface, active.draft?.bodyHtml);
    if (!clean.ok) { update(active.ticket, value => ({ ...value, error: clean.error })); return; }
    const result = active.target.apply(clean.value.html, mode);
    if (!result.ok) { update(active.ticket, value => ({ ...value, error: result.error, replace: false })); return; }
    setUndo({ scope, before: active.target.bodyHtml, after: result.bodyHtml });
    setOutsideMessage(`본문에 적용했습니다. 문서를 저장하면 반영됩니다.${clean.value.warnings.length ? ` ${clean.value.warnings.join(' ')}` : ''}`);
    setWorkspace(value => value?.scope === scope ? { ...value, open: false, replace: false } : value); scope.invalidate();
  }
  function restore() {
    if (blocked || !undo || undo.scope !== scope) return;
    const target = captureEditor();
    if (!target || target.bodyHtml !== undo.after) { setOutsideMessage('적용 후 본문이 변경되어 자동 복구하지 않았습니다. 현재 내용을 확인해주세요.'); return; }
    const result = target.apply(undo.before, 'replace');
    if (!result.ok) { setOutsideMessage(result.error); return; }
    setUndo(null); setOutsideMessage('템플릿 적용 직전 본문으로 복구했습니다. 문서를 저장하면 반영됩니다.');
  }
  const editingBlocked = Boolean(active?.busy || active?.retry);
  return <>
    <div className="admin-body-template-tools">
      <button type="button" disabled={blocked} onClick={open}>개인 본문 템플릿</button>
      {undo?.scope === scope ? <button type="button" disabled={blocked} onClick={restore}>직전 템플릿 적용 되돌리기</button> : null}
      {outsideMessage ? <p role="status">{outsideMessage}</p> : null}
    </div>
    {active ? createPortal(<div className="wc-root wc-admin admin-body-template-portal" onInput={event => event.stopPropagation()} onChange={event => event.stopPropagation()}>
      <CustomerServiceDialog title="개인 본문 템플릿" onClose={close} busy={active.busy} wide>
        <div className="admin-body-template">
          <p>본인만 사용하는 글·서식 템플릿입니다. 이미지·문서 제목·관련상품·전시기간은 저장하지 않습니다. 다른 편집기에 적용하면 해당 화면의 링크 규칙에 맞춰 정리합니다.</p>
          <div className="admin-body-template__controls">
            <label>보기<select value={active.archived ? 'archived' : 'active'} disabled={editingBlocked} onChange={event => refreshList(event.target.value === 'archived')}><option value="active">사용 중</option><option value="archived">보관함</option></select></label>
            <button type="button" disabled={editingBlocked} onClick={() => refreshList(active.archived)}>목록 다시 읽기</button>
            <button type="button" disabled={editingBlocked || (active.list?.total ?? 0) >= BODY_TEMPLATE_LIMIT} onClick={() => void select('new')}>현재 본문으로 새 템플릿</button>
            <span>{active.list ? `${active.list.total} / 50개 · 보관 ${active.list.archivedCount}개 포함` : '목록 확인 중'}</span>
          </div>
          <p className="admin-body-template__hint">보관한 항목을 포함해 50개까지입니다. 한도에 도달하면 기존 템플릿의 이름과 본문을 수정해 재사용할 수 있습니다.</p>
          <div className="admin-body-template__workspace">
            <ul className="admin-body-template__list">{active.list?.rows.length ? active.list.rows.map(row => <li key={row.id}><button type="button" disabled={editingBlocked} aria-pressed={draft?.id === row.id} onClick={() => void select(row.id)}><strong>{row.name}</strong><small>{row.characterCount.toLocaleString('ko-KR')}자 · 버전 {row.revision}</small></button></li>) : <li>{active.busy ? '불러오는 중…' : active.archived ? '보관한 템플릿이 없습니다.' : '저장한 개인 템플릿이 없습니다.'}</li>}</ul>
            {draft ? <div className="admin-body-template__editor">
              <label>템플릿 이름<input maxLength={100} value={draft.name} disabled={editingBlocked} onChange={event => update(active.ticket, value => ({ ...value, draft: value.draft ? { ...value.draft, name: event.target.value } : null }))} /></label>
              <label>템플릿 본문 HTML<textarea rows={8} value={draft.bodyHtml} disabled={editingBlocked} onChange={event => update(active.ticket, value => ({ ...value, draft: value.draft ? { ...value.draft, bodyHtml: event.target.value } : null }))} /></label>
              <p className="admin-body-template__hint">{bodyTemplateLength(draft.bodyHtml).toLocaleString('ko-KR')} / 30,000자 · {draft.revision ? `버전 ${draft.revision}${draft.archived ? ' · 보관됨' : ''}` : '새 템플릿'}</p>
              {preview?.ok ? <><div className={`admin-body-template__preview ${surface === 'goods' ? 'wc-goods-description' : 'wc-shopping-story__body'}`} aria-label="템플릿 미리보기" dangerouslySetInnerHTML={{ __html: preview.value.html }} />{preview.value.warnings.length ? <p role="status">{preview.value.warnings.join(' ')}</p> : null}</> : <p role="alert">{preview?.error}</p>}
              <div className="admin-body-template__controls">
                <button type="button" disabled={editingBlocked || !preview?.ok || !draft.name.trim()} onClick={() => void mutate({ kind: 'save', request: { ...context, id: draft.id, expectedRevision: draft.revision, operationId: crypto.randomUUID(), name: draft.name, bodyHtml: draft.bodyHtml } })}>{draft.revision ? '템플릿 저장' : '템플릿 등록'}</button>
                {draft.revision ? <><button type="button" disabled={editingBlocked} onClick={() => void readLatest()}>최신 저장본 확인</button><button type="button" disabled={editingBlocked || !sameDraft(draft, active.baseline)} onClick={() => void mutate({ kind: 'archive', request: { ...context, id: draft.id, expectedRevision: draft.revision, operationId: crypto.randomUUID(), archived: !draft.archived } })}>{draft.archived ? '보관함에서 복구' : '템플릿 보관'}</button></> : null}
              </div>
              <div className="admin-body-template__apply"><button type="button" disabled={editingBlocked || !preview?.ok || draft.archived} onClick={() => apply('insert')}>{insertLabel}</button><button type="button" disabled={editingBlocked || !preview?.ok || draft.archived} onClick={() => apply('replace')}>본문 전체 바꾸기</button></div>
            </div> : <p>저장한 템플릿을 선택하거나 현재 본문으로 새 템플릿을 만드세요.</p>}
          </div>
          {active.nextId ? <div className="admin-body-template__notice"><p>현재 템플릿의 미저장 편집을 버리고 다른 항목을 열까요? 문서 본문은 바뀌지 않습니다.</p><button type="button" disabled={editingBlocked} onClick={() => void select(active.nextId!, true)}>편집 버리고 열기</button><button type="button" disabled={editingBlocked} onClick={() => update(active.ticket, value => ({ ...value, nextId: null }))}>편집 계속하기</button></div> : null}
          {active.replace ? <div className="admin-body-template__notice"><p>현재 문서 본문 전체를 이 템플릿의 글과 서식으로 바꿉니다. 현재 본문의 이미지도 빠지며 직전 적용 되돌리기로 복구할 수 있습니다.</p><button type="button" disabled={editingBlocked} onClick={() => apply('replace', true)}>확인하고 본문 전체 바꾸기</button><button type="button" disabled={editingBlocked} onClick={() => update(active.ticket, value => ({ ...value, replace: false }))}>취소</button></div> : null}
          {active.latest ? <div className="admin-body-template__notice"><h3>최신 저장본 · {active.latest.name} · 버전 {active.latest.revision}</h3><pre>{active.latest.bodyHtml}</pre><button type="button" disabled={editingBlocked} onClick={() => update(active.ticket, value => value.latest ? { ...value, draft: asDraft(value.latest), baseline: asDraft(value.latest), latest: null, error: '' } : value)}>편집 내용을 최신 저장본으로 바꾸기</button><button type="button" disabled={editingBlocked} onClick={() => update(active.ticket, value => value.draft && value.latest ? { ...value, draft: { ...value.draft, revision: value.latest.revision, archived: value.latest.archivedAt !== null }, baseline: asDraft(value.latest), latest: null, error: '' } : value)}>최신 버전 기준으로 현재 편집 유지</button></div> : null}
          {active.error ? <p role="alert">{active.error}</p> : null}{active.message ? <p role="status">{active.message}</p> : null}
          {active.retry ? <button type="button" disabled={active.busy} onClick={() => void mutate()}>같은 요청으로 결과 확인</button> : null}
        </div>
      </CustomerServiceDialog>
    </div>, document.body) : null}
  </>;
}
