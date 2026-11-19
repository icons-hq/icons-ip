import { KakaoUnlinkWithdrawalQueueScreen } from '@/components/admin/screens/KakaoUnlinkWithdrawalQueueScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { KAKAO_UNLINK_QUEUE_PATH } from '@/lib/admin/kakao-unlink-withdrawal';
import { loadKakaoUnlinkWithdrawalQueue } from '@/lib/admin/kakao-unlink-withdrawal.server';
import { notePiiAccess } from '@/lib/admin/pii-access-log.server';

/*
 * 카카오 연결 해제 탈퇴 검토 대기(runbook kakao-account-unlink.md §5). 회원 관리 화면 아래 경로라 같은 메뉴·권한(platform.manage)을 따르고,
 * DB도 같은 권한을 다시 판정한다. 닉네임·가린 이메일을 보여 주는 회원 목록이라 회원 검색처럼 접속기록을 남긴다(실패해도 화면은 연다).
 */
export default async function AdminKakaoUnlinkWithdrawalQueuePage() {
  const auth = await requireAdminScreenAccess(KAKAO_UNLINK_QUEUE_PATH);
  const entries = await loadKakaoUnlinkWithdrawalQueue();
  if (entries?.length) {
    await notePiiAccess({ actorId: auth.user.id, action: 'view', surface: 'member.kakao_unlink_queue', path: KAKAO_UNLINK_QUEUE_PATH,
      subjectKind: 'member', subjectIds: entries.map((entry) => entry.userId), subjectCount: entries.length });
  }
  return <KakaoUnlinkWithdrawalQueueScreen entries={entries} />;
}
