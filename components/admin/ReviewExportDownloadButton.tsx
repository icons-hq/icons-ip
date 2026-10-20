'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isUuid } from '@/lib/uuid';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { REVIEW_EXPORT_LIMIT } from '@/lib/admin/review-export';
import { EncryptedWorkbookDownloadButton, type EncryptedWorkbookRequestScope } from './EncryptedWorkbookDownloadButton';

/** Each submitted filter/account scope discards late network and blob results. */
export function ReviewExportDownloadButton({ accountId, href, total }: { accountId: string; href: string; total: number }) {
  const scope = useMemo(() => createGoodsDescriptionToolScope(accountId), [accountId]);
  const auth = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot), hintId = useId();
  useLayoutEffect(() => {
    scope.setEnabled(true); scope.activate();
    return () => scope.dispose();
  }, [scope]);
  useLayoutEffect(() => { scope.invalidate(); }, [scope, href]);
  useEffect(() => {
    const lost = () => scope.authenticate(null, null);
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, lost);
    let unsubscribe: (() => void) | undefined;
    try {
      const subscription = createClient().auth.onAuthStateChange((_event, session) => {
        const sessionId = session ? inquiryDraftSessionId(session.access_token) : null;
        scope.authenticate(session?.user.id ?? null, isUuid(sessionId) ? sessionId : null);
      }).data.subscription;
      unsubscribe = () => subscription.unsubscribe();
    } catch { lost(); }
    return () => { unsubscribe?.(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, lost); };
  }, [scope]);
  const requestScope = useMemo<EncryptedWorkbookRequestScope>(() => ({ capture() {
    const ticket = scope.capture();
    return ticket ? () => scope.canApply(ticket) : null;
  } }), [scope]);
  return <div>
    <EncryptedWorkbookDownloadButton key={`${accountId}:${href}:${auth.epoch}`} href={href} label="엑셀 다운로드"
      describedBy={hintId} disabled={!auth.ready || auth.blocked} requestScope={requestScope} />
    <p className="muted" id={hintId}>적용된 검색 조건 전체 {total.toLocaleString('ko-KR')}건 · 최대 {REVIEW_EXPORT_LIMIT.toLocaleString('ko-KR')}건. 현재 페이지나 선택한 행에 한정하지 않습니다.</p>
    {auth.blocked ? <p role="alert">로그인 계정 또는 세션이 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.</p> : null}
  </div>;
}
