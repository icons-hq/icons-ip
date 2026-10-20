import type { useInquiryDraft } from '@/components/admin/useInquiryDraft';

export function InquiryDraftNotice({ draft, pending }: { draft: ReturnType<typeof useInquiryDraft>; pending: boolean }) {
  if (draft.blocked) return <p role="alert">로그인 계정 또는 세션이 바뀌어 초안을 지웠습니다. 화면을 새로고침해 주세요.</p>;
  return <div className="admin-inquiry-draft">
    <p className="muted">작성 문구는 이 탭의 현재 로그인에서 최대 24시간 복구할 수 있습니다. 로그아웃·계정 변경 후에는 복구되지 않습니다. 첨부파일은 다시 선택해 주세요.</p>
    {draft.unavailable ? <p role="status">이 브라우저에서 초안을 보관할 수 없습니다. 이동하기 전에 내용을 복사해 주세요.</p> : null}
    {draft.recovery !== null ? <div className="admin-cs-reply__actions">
      <span role="status">이 문의에서 저장하지 않은 문구가 있습니다.</span>
      <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={draft.restore}>초안 복구</button>
      <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={draft.discard}>초안 버리기</button>
    </div> : draft.body ? <div className="admin-cs-reply__actions">
      {draft.saved ? <span role="status">이 탭에 초안 보관됨</span> : null}
      <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={draft.discard}>작성 문구 지우기</button>
    </div> : null}
  </div>;
}
