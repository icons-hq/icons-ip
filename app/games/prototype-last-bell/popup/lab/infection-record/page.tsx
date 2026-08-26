import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { InfectionRecordPrototype } from '@/components/campaigns/aouad/lab/InfectionRecordPrototype';
import { isLastBellPrototypeEnabled } from '@/lib/prototypes/last-bell/gate.server';

export const metadata: Metadata = {
  title: '감염 기록 · 효산고 G2 비교',
  robots: { index: false, follow: false },
};

export default async function InfectionRecordLabPage() {
  await connection();
  if (!isLastBellPrototypeEnabled()) notFound();
  return <InfectionRecordPrototype />;
}
