import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ComparisonLabHub } from '@/components/campaigns/aouad/lab/ComparisonLabHub';
import { isLastBellPrototypeEnabled } from '@/lib/prototypes/last-bell/gate.server';

export const metadata: Metadata = {
  title: '효산고 G2 비교 평가실',
  robots: { index: false, follow: false },
};

export default async function AouadComparisonLabPage() {
  await connection();
  if (!isLastBellPrototypeEnabled()) notFound();
  return <ComparisonLabHub />;
}
