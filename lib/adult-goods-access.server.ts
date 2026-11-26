import 'server-only';

import { cache } from 'react';

import { getCurrentAuthState } from '@/lib/auth/server';
import { loadMyAdultVerification } from '@/lib/identity/adult-verification-status.server';
import { adultVerificationEnabledFor } from '@/lib/identity/kcp-cert-config';
import { createClient } from '@/lib/supabase/server';
import { parseAdultGoodsVisibility, type AdultGoodsAccess } from './adult-goods';

/** 요청 안에서만 공유한다. 관리자가 바꾼 공개 상태는 다음 조회부터 적용된다. */
export const getAdultGoodsVisibility = cache(async () => {
  try {
    const { data, error } = await (await createClient()).rpc('get_adult_goods_visibility');
    return error ? null : parseAdultGoodsVisibility(data);
  } catch {
    return null;
  }
});

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
  const domesticOpen = adultVerificationEnabledFor(userId);
  if (!domesticOpen && !userId) return 'hidden';
  const [visibility, verification] = await Promise.all([
    getAdultGoodsVisibility(),
    userId ? loadMyAdultVerification() : null,
  ]);
  if (!visibility?.enabled) return 'hidden';
  if (verification?.status === 'verified' && verification.method === 'overseas_manual') return 'full';
  if (!domesticOpen) return 'hidden';
  return verification?.status === 'verified' ? 'full' : 'masked';
});
