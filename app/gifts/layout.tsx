import type { Metadata } from 'next';
import '@/app/styles/wc-gifts.css';
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default function GiftLayout({ children }: { children: React.ReactNode }) { return children; }
