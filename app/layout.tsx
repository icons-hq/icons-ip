import type { Metadata } from 'next';
import { Space_Grotesk, Space_Mono } from 'next/font/google';
import './globals.css';
import './styles/editorial-foundation.css';
import './styles/editorial-shell.css';
import './styles/editorial-home.css';
import './styles/editorial-public.css';
import './styles/editorial-account-commerce.css';
import './styles/editorial-admin.css';
import { AuthPresenceProvider } from '@/components/shell/AuthPresenceProvider';
import { CartProvider } from '@/components/shell/CartProvider';
import { Nav } from '@/components/shell/Nav';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { CardRewardAvailabilityProvider } from '@/components/shell/CardRewardAvailability';

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
        <CartProvider>
          <CardRewardAvailabilityProvider>
            <AuthPresenceProvider>
              <Nav />
              <div id="root">{children}</div>
              <SiteFooter />
            </AuthPresenceProvider>
          </CardRewardAvailabilityProvider>
        </CartProvider>
      </body>
    </html>
  );
}
