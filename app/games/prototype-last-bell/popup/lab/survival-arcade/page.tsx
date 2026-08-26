import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { SurvivalArcadePrototype } from '@/components/campaigns/aouad/lab/SurvivalArcadePrototype';
import { isLastBellPrototypeEnabled } from '@/lib/prototypes/last-bell/gate.server';

export const metadata: Metadata = {
  title: '3분 생존 · 효산고 G2 비교',
  robots: { index: false, follow: false },
};

export default async function SurvivalArcadeLabPage() {
  await connection();
  if (!isLastBellPrototypeEnabled()) notFound();
  return <SurvivalArcadePrototype />;
}
