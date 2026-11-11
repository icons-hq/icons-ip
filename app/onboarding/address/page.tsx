import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OnboardingAddress } from '@/components/screens/OnboardingAddress';
import { addressBookOnboardingPath, addressBookOpenFor } from '@/lib/address-book';
import { loadMyAddressBook } from '@/lib/address-book.server';
import { isOnboarded, onboardingPath, safeNextPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { MANAGER_INVITATION_PATH } from '@/lib/routes';

export const metadata: Metadata = {
  title: '배송지 등록 — ICONS',
  description: '주문서에서 바로 불러올 배송지를 등록하세요. 지금 건너뛰어도 됩니다.',
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/* 운영 화면으로 가는 길(어드민·운영자 초대)에는 배송지 안내를 끼우지 않는다. */
function skipsAddressStep(next: string) {
  return next === '/admin' || next.startsWith('/admin/') || next.startsWith('/admin?') || next.startsWith(MANAGER_INVITATION_PATH);
}

/*
 * 온보딩 직후 배송지 등록 안내(LFS 패리티 2차 L7 · 10/14 S3 — 가입하면 배송지 추가로 이어지게, 건너뛸 수 있음).
 * 가입·주문을 막지 않는다: 이미 주소록이 있거나, 주소록을 읽지 못하거나, 운영 화면으로 가는 길이거나, 주소록이 아직
 * 열리지 않았으면(처리방침 개정 시행일 전) 바로 next 로 보낸다. '나중에 할게요'는 next 로 가는 링크다. 온보딩 판정(lib/auth/onboarding)은 바꾸지 않는다.
 */
export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const next = safeNextPath(firstParam(params.next));
  const auth = await getCurrentAuthState();

  if (!auth.user) redirect(`/login?next=${encodeURIComponent(addressBookOnboardingPath(next))}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));
  if (skipsAddressStep(next)) redirect(next);
  /* 처리방침 주소록 개정 시행일 전에는 안내를 건너뛴다(staff/admin 미리보기 제외) — 아직 고지하지 않은 수집을 권하지 않는다. */
  if (!addressBookOpenFor(auth)) redirect(next);

  const book = await loadMyAddressBook(auth.user.id);
  if (!book || book.length > 0) redirect(next);

  return <OnboardingAddress next={next} />;
}
