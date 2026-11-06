import { getCurrentAuthState } from '@/lib/auth/server';
import { loadMyAdultVerification } from '@/lib/identity/adult-verification-status.server';
import { adultVerificationEnabledFor } from '@/lib/identity/kcp-cert-config';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * 마이페이지 메뉴의 "성인 인증" 노출 여부. 인증을 시작할 수 있는 회원(공개 스위치·canary)
 * 이거나, 이미 인증 기록이 있어 상태를 확인해야 하는 회원에게만 보인다. 상태 값 자체는
 * 돌려주지 않는다 — 메뉴 하나를 그릴지에만 답한다.
 */
export async function GET() {
  const auth = await getCurrentAuthState();
  if (!auth.user) return Response.json({ visible: false }, { headers: NO_STORE });
  if (adultVerificationEnabledFor(auth.user.id)) return Response.json({ visible: true }, { headers: NO_STORE });
  const status = await loadMyAdultVerification();
  return Response.json({ visible: status.status !== 'none' }, { headers: NO_STORE });
}
