import type { Metadata } from 'next';
import { headers } from 'next/headers';
import '@/app/styles/wc-overseas-verification.css';
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
  const [result, requestHeaders] = await Promise.all([
    (await createClient()).rpc('my_overseas_adult_request'), headers(),
  ]);
  const request = (result.data?.request ?? null) as OverseasRequest | null;
  const language = requestHeaders.get('accept-language')?.split(',')[0]?.toLowerCase();
  return (
    <MypageShell active={ADULT_VERIFICATION_PATH}>
      <OverseasAdultRequest
        intakeStatus={result.error ? 'error' : result.data?.domesticVerified ? 'domestic' : result.data?.intakeStatus ?? 'review_paused'}
        request={request}
        birthDate={auth.profile?.birth_date ?? ''}
        initialLanguage={language && !language.startsWith('ko') ? 'en' : 'ko'}
        next={next}
      />
    </MypageShell>
  );
}
