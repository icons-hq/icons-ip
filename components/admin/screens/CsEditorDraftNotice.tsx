import type { CsEditorDraftSnapshot, CsTemplateDraft } from '@/lib/admin/cs-editor-drafts';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Alert, AlertDescription } from '@/components/admin/kit/ui/alert';
import { Button } from '@/components/admin/kit/ui/button';

export function CsTemplateDraftList({ drafts, disabled, onSelect }: {
  drafts: Record<string, CsTemplateDraft>; disabled: boolean; onSelect: (id: string) => void;
}) {
  const rows = Object.values(drafts);
  if (!rows.length) return null;
  return <nav aria-label="보관 중인 템플릿 편집 내용" className="flex flex-wrap items-center gap-2 text-sm">
    <span className="text-muted-foreground">저장하지 않은 편집 {rows.length}개</span>
    {rows.map((row, index) => <Button disabled={disabled} key={row.id} onClick={() => onSelect(row.id)} size="xs" type="button" variant="outline">{row.title || `새 템플릿 ${index + 1}`}</Button>)}
  </nav>;
}

export function CsEditorDraftNotice({ draft, pending, onRestore, onDiscard, discardLabel = '작성하던 내용 버리기 · 저장된 내용 보기', discardDisabled = false, unresolved = false }: {
  draft: CsEditorDraftSnapshot<unknown>; pending: boolean; onRestore: () => void; onDiscard: () => void; discardLabel?: string; discardDisabled?: boolean; unresolved?: boolean;
}) {
  if (draft.blocked) return <Alert variant="destructive"><AlertDescription>로그인이 바뀌어(다른 계정 로그인·로그아웃·다시 로그인) 작성하던 내용을 지웠습니다. 화면을 새로고침해 주세요.</AlertDescription></Alert>;
  return <div className="flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground" data-cs-draft="">
    <p>{unresolved ? '저장됐는지 확인하지 못한 내용은 결과를 확인할 때까지 이 탭의 현재 로그인에서 보관합니다.' : '작성 문구는 이 탭의 현재 로그인에서 최대 24시간 복구할 수 있습니다.'} 로그아웃·계정 변경 후에는 복구되지 않습니다.</p>
    {draft.unavailable ? <p className="text-sm text-warning" role="status">이 브라우저에는 작성하던 내용을 보관할 수 없습니다. 다른 화면으로 이동하기 전에 내용을 복사해 두세요.</p> : null}
    {draft.recovery !== null ? <AdminNotice tone="warning">
      <div className="flex flex-wrap items-center gap-2">
        <span role="status">{unresolved ? '저장됐는지 확인하지 못한 내용이 있습니다. [작성하던 내용 복구]를 누른 뒤 [같은 요청으로 결과 확인]을 눌러주세요. 다시 눌러도 두 번 저장되지 않습니다.' : '저장하지 않은 편집 내용이 있습니다. [작성하던 내용 복구] 또는 [작성하던 내용 버리기]를 고른 뒤 편집해주세요.'}</span>
        <Button disabled={pending} onClick={onRestore} size="xs" type="button" variant="outline">작성하던 내용 복구</Button>
        <Button disabled={pending || discardDisabled} onClick={onDiscard} size="xs" type="button" variant="ghost">작성하던 내용 버리기</Button>
      </div>
    </AdminNotice> : draft.value !== null ? <div className="flex flex-wrap items-center gap-2">
      {draft.saved ? <span role="status">이 탭에 작성 중인 내용 보관됨</span> : null}
      <Button disabled={pending || discardDisabled} onClick={onDiscard} size="xs" type="button" variant="ghost">{discardLabel}</Button>
    </div> : null}
  </div>;
}
