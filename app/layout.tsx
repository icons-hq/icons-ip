import type { Metadata } from 'next';
import { Space_Grotesk, Space_Mono } from 'next/font/google';
import './globals.css';
import { Atmos } from '@/components/shell/Atmos';
import { CartProvider } from '@/components/shell/CartProvider';
import { Nav } from '@/components/shell/Nav';
import { MobNav } from '@/components/shell/MobNav';
import { SiteFooter } from '@/components/shell/SiteFooter';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-space-mono',
});

export const metadata: Metadata = {
  title: 'ICONS — 서브컬처 팬덤 플랫폼',
  description:
    '공식 라이선스 굿즈 · 팝업 & 티케팅 · 팬 커뮤니티 · 수집형 카드까지. 모든 서브컬처가 모이는 디지털 팬덤 허브.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" data-scroll-behavior="smooth" className={`${spaceGrotesk.variable} ${spaceMono.variable}`}>
      <body>
        <Atmos />
        <CartProvider>
          <Nav />
          <div id="root">{children}</div>
          <SiteFooter />
          <MobNav />
        </CartProvider>
      </body>
    </html>
  );
}
