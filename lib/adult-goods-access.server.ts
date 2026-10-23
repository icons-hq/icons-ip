import 'server-only';

import { cache } from 'react';

import { getCurrentAuthState } from '@/lib/auth/server';
import { loadMyAdultVerification } from '@/lib/identity/adult-verification-status.server';
import { adultVerificationEnabledFor } from '@/lib/identity/kcp-cert-config';
import type { AdultGoodsAccess } from './adult-goods';

/**
 * 이 요청의 19금 굿즈 노출 모드. 성인 인증 gate(공개 스위치·canary)가 이 방문자에게
 * 닫혀 있으면 hidden, 열려 있으면 유효한 성인 인증 여부로 full·masked를 가른다. 인증
 * 상태 조회가 실패하면 masked로 접는다 — 확인하지 못한 방문자에게 성인 상품을 보이지 않는다.
 */
export const getAdultGoodsAccess = cache(async (): Promise<AdultGoodsAccess> => {
  let userId: string | null = null;
  try {
    const auth = await getCurrentAuthState();
    userId = auth.user?.id ?? null;
  } catch {
    return 'hidden';
  }
  if (!adultVerificationEnabledFor(userId)) return 'hidden';
  if (!userId) return 'masked';
  const status = await loadMyAdultVerification();
  return status.status === 'verified' ? 'full' : 'masked';
});
