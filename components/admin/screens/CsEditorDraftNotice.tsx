import type { CsEditorDraftSnapshot, CsTemplateDraft } from '@/lib/admin/cs-editor-drafts';
import { Alert, AlertDescription } from '@/components/admin/kit/ui/alert';
import { Button } from '@/components/admin/kit/ui/button';

export function CsTemplateDraftList({ drafts, disabled, onSelect }: {
  drafts: Record<string, CsTemplateDraft>; disabled: boolean; onSelect: (id: string) => void;
}) {
  const rows = Object.values(drafts);
  if (!rows.length) return null;
  return <nav aria-label="보관 중인 템플릿 편집 초안" className="flex flex-wrap items-center gap-2 text-sm">
    <span className="text-muted-foreground">편집 초안 {rows.length}개</span>
    {rows.map((row, index) => <Button disabled={disabled} key={row.id} onClick={() => onSelect(row.id)} size="xs" type="button" variant="outline">{row.title || `새 템플릿 ${index + 1}`}</Button>)}
  </nav>;
}

export function CsEditorDraftNotice({ draft, pending, onRestore, onDiscard, discardLabel = '초안 버리기 · 저장본 보기', discardDisabled = false, unresolved = false }: {
  draft: CsEditorDraftSnapshot<unknown>; pending: boolean; onRestore: () => void; onDiscard: () => void; discardLabel?: string; discardDisabled?: boolean; unresolved?: boolean;
}) {
  if (draft.blocked) return <Alert variant="destructive"><AlertDescription>로그인 계정 또는 세션이 바뀌어 초안을 지웠습니다. 화면을 새로고침해 주세요.</AlertDescription></Alert>;
  return <div className="flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground" data-cs-draft="">
    <p>{unresolved ? '저장 결과가 확인되지 않은 요청은 이 탭의 현재 로그인에서 결과 확인까지 보관합니다.' : '작성 문구는 이 탭의 현재 로그인에서 최대 24시간 복구할 수 있습니다.'} 로그아웃·계정 변경 후에는 복구되지 않습니다.</p>
    {draft.unavailable ? <p className="text-sm text-[var(--wc-warning)]" role="status">이 브라우저에서 초안을 보관할 수 없습니다. 이동하기 전에 내용을 복사해 주세요.</p> : null}
    {draft.recovery !== null ? <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-foreground">
      <span className="mr-auto" role="status">{unresolved ? '확인되지 않은 저장 요청이 있습니다. 복구한 뒤 같은 요청으로 결과를 확인해주세요.' : '저장하지 않은 편집 초안이 있습니다. 복구하거나 버린 뒤 편집해주세요.'}</span>
      <Button disabled={pending} onClick={onRestore} size="xs" type="button" variant="outline">초안 복구</Button>
      <Button disabled={pending || discardDisabled} onClick={onDiscard} size="xs" type="button" variant="ghost">초안 버리기</Button>
    </div> : draft.value !== null ? <div className="flex flex-wrap items-center gap-2">
      {draft.saved ? <span role="status">이 탭에 초안 보관됨</span> : null}
      <Button disabled={pending || discardDisabled} onClick={onDiscard} size="xs" type="button" variant="ghost">{discardLabel}</Button>
    </div> : null}
  </div>;
}
