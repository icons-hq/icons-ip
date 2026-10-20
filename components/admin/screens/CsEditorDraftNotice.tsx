import type { CsEditorDraftSnapshot, CsTemplateDraft } from '@/lib/admin/cs-editor-drafts';

export function CsTemplateDraftList({ drafts, disabled, onSelect }: {
  drafts: Record<string, CsTemplateDraft>; disabled: boolean; onSelect: (id: string) => void;
}) {
  const rows = Object.values(drafts);
  if (!rows.length) return null;
  return <nav aria-label="보관 중인 템플릿 편집 초안" className="admin-cs-template__actions">
    <span>편집 초안 {rows.length}개</span>
    {rows.map((row, index) => <button type="button" className="btn btn-sm btn-ghost" disabled={disabled} key={row.id}
      onClick={() => onSelect(row.id)}>{row.title || `새 템플릿 ${index + 1}`}</button>)}
  </nav>;
}

export function CsEditorDraftNotice({ draft, pending, onRestore, onDiscard, discardLabel = '초안 버리기 · 저장본 보기', discardDisabled = false, unresolved = false }: {
  draft: CsEditorDraftSnapshot<unknown>; pending: boolean; onRestore: () => void; onDiscard: () => void; discardLabel?: string; discardDisabled?: boolean; unresolved?: boolean;
}) {
  if (draft.blocked) return <p role="alert">로그인 계정 또는 세션이 바뀌어 초안을 지웠습니다. 화면을 새로고침해 주세요.</p>;
  return <div className="admin-inquiry-draft">
    <p className="muted">{unresolved ? '저장 결과가 확인되지 않은 요청은 이 탭의 현재 로그인에서 결과 확인까지 보관합니다.' : '작성 문구는 이 탭의 현재 로그인에서 최대 24시간 복구할 수 있습니다.'} 로그아웃·계정 변경 후에는 복구되지 않습니다.</p>
    {draft.unavailable ? <p role="status">이 브라우저에서 초안을 보관할 수 없습니다. 이동하기 전에 내용을 복사해 주세요.</p> : null}
    {draft.recovery !== null ? <div className="admin-cs-reply__actions">
      <span role="status">{unresolved ? '확인되지 않은 저장 요청이 있습니다. 복구한 뒤 같은 요청으로 결과를 확인해주세요.' : '저장하지 않은 편집 초안이 있습니다. 복구하거나 버린 뒤 편집해주세요.'}</span>
      <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={onRestore}>초안 복구</button>
      <button type="button" className="btn btn-sm btn-ghost" disabled={pending || discardDisabled} onClick={onDiscard}>초안 버리기</button>
    </div> : draft.value !== null ? <div className="admin-cs-reply__actions">
      {draft.saved ? <span role="status">이 탭에 초안 보관됨</span> : null}
      <button type="button" className="btn btn-sm btn-ghost" disabled={pending || discardDisabled} onClick={onDiscard}>{discardLabel}</button>
    </div> : null}
  </div>;
}
