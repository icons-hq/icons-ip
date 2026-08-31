import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MyQuestions } from '@/components/screens/MyQuestions';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadMyQuestions } from '@/lib/product-questions.server';

export const metadata: Metadata = {
  title: '내 상품 Q&A — ICONS',
  description: '굿즈 상세에 남긴 질문과 운영자 답변을 확인하세요.',
  robots: { index: false, follow: false },
};

const QUESTIONS_PATH = '/my/questions';

/* 질문 읽기는 공개지만 "내 Q&A"는 내가 쓴 글의 목록이다 — 진입 자체에 로그인이
   필요하다. 온보딩까지 요구하는 것은 /my/reviews 와 같은 관례다. */
export default async function Page() {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(QUESTIONS_PATH)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(QUESTIONS_PATH));

  const questions = await loadMyQuestions();

  return <MyQuestions questions={questions} />;
}
