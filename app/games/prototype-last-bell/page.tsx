import type { Metadata } from 'next';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { LastBellClient } from '@/components/prototype/last-bell/LastBellClient';
import { isLastBellPrototypeEnabled } from '@/lib/prototypes/last-bell/gate.server';

export const metadata: Metadata = {
  title: '지금 우리 학교는: 마지막 종 — Chapter 1',
  description: '효산고에서 마지막 종이 울리기 전 탈출하는 1인칭 공포 게임 프로토타입.',
  robots: { index: false, follow: false },
};

export default async function LastBellPrototypePage() {
  await connection();
  if (!isLastBellPrototypeEnabled()) notFound();
  return <LastBellClient />;
}
