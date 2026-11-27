import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { DEMOGRAPHIC_GENDERS, type DemographicGender } from '@/lib/customer-demographics';

const COOKIE = 'xs_onboarding_gender';
const MAX_AGE_SECONDS = 60 * 60;

function signature(userId: string, gender: DemographicGender, expires: string, secret: string) {
  return createHmac('sha256', secret).update(['onboarding-gender-v1', userId, gender, expires].join('\0')).digest();
}

/** 가입 도중 새로고침해도 같은 계정에서만 선택을 복원한다. 쿠키에는 만료 시각과 서명만 둔다. */
export async function rememberOnboardingGender(userId: string, gender: DemographicGender | null, secret: string) {
  const store = await cookies();
  if (!gender && !store.has(COOKIE)) return;
  const expires = String(Date.now() + MAX_AGE_SECONDS * 1000);
  const token = gender ? `${expires}.${signature(userId, gender, expires, secret).toString('hex')}` : '';
  store.set(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/onboarding',
    maxAge: gender ? MAX_AGE_SECONDS : 0,
  });
}

export async function readOnboardingGenderDraft(userId: string, secret: string): Promise<DemographicGender | null> {
  const value = (await cookies()).get(COOKIE)?.value ?? '';
  const match = /^(\d{13})\.([0-9a-f]{64})$/.exec(value);
  if (!match || Number(match[1]) <= Date.now()) return null;
  const token = Buffer.from(match[2], 'hex');
  return DEMOGRAPHIC_GENDERS.find(gender => timingSafeEqual(token, signature(userId, gender, match[1], secret))) ?? null;
}
