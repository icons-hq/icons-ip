import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { isLastBellPrototypeEnabled } from '@/lib/prototypes/last-bell/gate.server';

export const metadata: Metadata = {
  title: '지금, 우리 학교로 — 효산고 온라인 팝업',
  description: 'ALL OF US ARE DEAD: LAST BELL의 로컬 프로토타입 온라인 팝업.',
  robots: { index: false, follow: false },
};

export default async function LastBellPopupLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  if (!isLastBellPrototypeEnabled()) notFound();
  return children;
}
