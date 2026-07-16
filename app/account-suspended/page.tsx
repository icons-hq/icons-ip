import type { Metadata } from 'next';
import { AccountSuspended } from '@/components/screens/AccountSuspended';

export const metadata: Metadata = {
  title: '계정 이용 제한 — ICONS',
  description: 'ICONS 계정 이용 제한 안내입니다.',
};

export default function Page() {
  return <AccountSuspended />;
}
