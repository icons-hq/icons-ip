import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AouadExperience } from '@/components/online-popup/aouad/AouadExperience';
import { canViewAouadPopup } from '@/lib/aouad-popup.server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '지금 우리 학교는 — 온라인 팝업 프레젠테이션 | ICONS',
  description: '효산고의 세계를 탐험하는 지금 우리 학교는 온라인 팝업 프레젠테이션.',
  robots: { index: false, follow: false },
};

export default async function Page() {
  if (!(await canViewAouadPopup())) notFound();
  return <AouadExperience />;
}
