import type { Metadata } from 'next';
import { AdminPaymentTestGood } from '@/components/screens/AdminPaymentTestGood';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Page({ searchParams }: PageProps<'/shop/admin-payment-test'>) {
  const params = await searchParams;
  return <AdminPaymentTestGood retry={params.retry === '1'} />;
}
