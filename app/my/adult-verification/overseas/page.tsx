import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OverseasAdultRequest } from '@/components/identity/OverseasAdultRequest';
import { MypageShell } from '@/components/wc/MypageShell';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { adultVerificationReturnPath } from '@/lib/identity/adult-verification.server';
import { ADULT_VERIFICATION_PATH } from '@/lib/identity/adult-verification-routes';
import { OVERSEAS_REVIEW_PATH, type OverseasRequest } from '@/lib/identity/overseas-adult';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: '해외 신분증 성인 인증 | Overseas ID verification',
  robots: { index: false, follow: false },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const next = adultVerificationReturnPath(
    typeof params.next === 'string' ? params.next : '/my/adult-verification',
  );
  const href = OVERSEAS_REVIEW_PATH + '?next=' + encodeURIComponent(next);
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect('/login?next=' + encodeURIComponent(href));
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(href));
  const result = await (await createClient()).rpc('my_overseas_adult_request');
  const request = (result.data?.request ?? null) as OverseasRequest | null;
  const approved = Boolean(request?.validUntil);
  return (
    <MypageShell active={ADULT_VERIFICATION_PATH}>
      <h1 className="wc-mypage__heading">
        해외 신분증 성인 인증 <small lang="en">Overseas ID verification</small>
      </h1>
      {result.error ? (
        <p role="alert">
          신청 상태를 불러오지 못했어요. 새로고침해 주세요. / Please refresh to check your request.
        </p>
      ) : (
        <OverseasAdultRequest
          open={result.data?.open === true}
          request={request}
          approved={approved}
          next={next}
        />
      )}
    </MypageShell>
  );
}
