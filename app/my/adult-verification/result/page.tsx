import type { Metadata } from 'next';

import { AdultVerificationResult } from '@/components/screens/AdultVerificationResult';
import { adultVerificationReturnPath } from '@/lib/identity/adult-verification.server';
import {
  ADULT_VERIFICATION_PATH,
  ADULT_VERIFICATION_RESULT_STATUSES,
  type AdultVerificationResultStatus,
} from '@/lib/identity/adult-verification-routes';
import { loadMyAdultVerification } from '@/lib/identity/adult-verification-status.server';

export const metadata: Metadata = {
  title: '성인 인증 결과 — ICONS',
  robots: { index: false, follow: false },
};

/* 로그인을 강제하지 않는다 — "로그인이 필요해요" 결과 자체가 이 화면에 온다. 쿼리는 표시용이고
   이동 경로는 같은 사이트 화면 경로로 다시 좁힌다. "완료"만은 주소를 믿지 않고 서버의 성인 인증
   상태로 다시 확인한다 — 확인되지 않으면 확인 중 안내로 바꾼다. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  let status: AdultVerificationResultStatus = typeof params.status === 'string'
    && (ADULT_VERIFICATION_RESULT_STATUSES as readonly string[]).includes(params.status)
    ? params.status as AdultVerificationResultStatus
    : 'invalid';
  if (status === 'verified' && (await loadMyAdultVerification()).status !== 'verified') status = 'pending';
  const mode = params.mode === 'popup' ? 'popup' : 'page';
  const next = adultVerificationReturnPath(typeof params.next === 'string' ? params.next : ADULT_VERIFICATION_PATH);

  return <AdultVerificationResult mode={mode} next={next} status={status} />;
}
