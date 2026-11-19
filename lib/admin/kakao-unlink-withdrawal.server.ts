import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseKakaoUnlinkQueue, type KakaoUnlinkQueueEntry } from './kakao-unlink-withdrawal';

/**
 * 카카오 연결 해제 탈퇴 검토 대기 목록. DB가 회원 관리 권한(platform.manage)을 다시 판정하고 가린 이메일만 돌려준다.
 * 읽지 못하면 null — 화면은 목록 대신 다시 불러오라고 안내한다(빈 목록과 구분한다).
 */
export async function loadKakaoUnlinkWithdrawalQueue(): Promise<KakaoUnlinkQueueEntry[] | null> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_kakao_unlink_withdrawal_queue');
  return error ? null : parseKakaoUnlinkQueue(data);
}
