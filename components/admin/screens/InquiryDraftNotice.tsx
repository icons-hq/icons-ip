import type { useInquiryDraft } from '@/components/admin/useInquiryDraft';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Alert, AlertDescription } from '@/components/admin/kit/ui/alert';
import { Button } from '@/components/admin/kit/ui/button';

export function InquiryDraftNotice({ draft, pending, loadingLabel = '답변 입력을 불러오는 중입니다.' }: {
  draft: ReturnType<typeof useInquiryDraft>;
  pending: boolean;
  /** 초안 보관소가 준비되기 전(입력·버튼 잠김) 이유. 잠금만 있고 이유가 없으면 '무반응'으로 보인다(R4). */
  loadingLabel?: string;
}) {
  if (draft.blocked) return <Alert variant="destructive"><AlertDescription>로그인 계정 또는 세션이 바뀌어 초안을 지웠습니다. 화면을 새로고침해 주세요.</AlertDescription></Alert>;
  return <div className="flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground" data-cs-draft="">
    {!draft.ready ? <p className="text-sm text-foreground" role="status">{loadingLabel}</p> : null}
    <p>작성 문구는 이 탭의 현재 로그인에서 최대 24시간 복구할 수 있습니다. 로그아웃·계정 변경 후에는 복구되지 않습니다. 첨부파일은 다시 선택해 주세요.</p>
    {draft.unavailable ? <p className="text-sm text-warning" role="status">이 브라우저에서 초안을 보관할 수 없습니다. 이동하기 전에 내용을 복사해 주세요.</p> : null}
    {draft.recovery !== null ? <AdminNotice tone="warning">
      <div className="flex flex-wrap items-center gap-2">
        <span role="status">이 문의에서 저장하지 않은 문구가 있습니다.</span>
        <Button disabled={pending} onClick={draft.restore} size="xs" type="button" variant="outline">초안 복구</Button>
        <Button disabled={pending} onClick={draft.discard} size="xs" type="button" variant="ghost">초안 버리기</Button>
      </div>
    </AdminNotice> : draft.body ? <div className="flex flex-wrap items-center gap-2">
      {draft.saved ? <span role="status">이 탭에 초안 보관됨</span> : null}
      <Button disabled={pending} onClick={draft.discard} size="xs" type="button" variant="ghost">작성 문구 지우기</Button>
    </div> : null}
  </div>;
}
