import type { Metadata } from 'next';
import { Space_Grotesk, Space_Mono } from 'next/font/google';
import './globals.css';
import './styles/editorial-foundation.css';
import './styles/editorial-shell.css';
import './styles/editorial-public.css';
import './styles/editorial-account-commerce.css';
import './styles/editorial-admin.css';
import './styles/admin-console.css';
import './styles/wc-foundation.css';
import './styles/wc-chrome.css';
import './styles/wc-home.css';
import './styles/wc-catalog.css';
import './styles/wc-discovery.css';
import './styles/wc-account-commerce.css';
import './styles/about-legacy.css';
import { AuthPresenceProvider } from '@/components/shell/AuthPresenceProvider';
import { CartProvider } from '@/components/shell/CartProvider';
import { Nav } from '@/components/shell/Nav';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { CardRewardAvailabilityProvider } from '@/components/shell/CardRewardAvailability';
import { getActiveNoticeStrip } from '@/lib/notice-strip.server';

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /* 공지 스트립은 셸의 일부라 루트에서 한 번만 읽는다. 쿠키를 만지지 않는 캐시 읽기라
     legal 라우트의 SSG가 dynamic으로 무너지지 않는다(lib/notice-strip.server.ts 주석 참고). */
  const noticeStrip = await getActiveNoticeStrip();

  return (
    <html lang="ko" data-scroll-behavior="smooth" className={`${spaceGrotesk.variable} ${spaceMono.variable}`}>
      <body>
        <CartProvider>
          <CardRewardAvailabilityProvider>
            <AuthPresenceProvider>
              <Nav noticeStrip={noticeStrip} />
              {/* tabIndex: 셸 스킵 링크(#root)가 키보드 포커스를 본문으로 실제 이동시키기 위한 타깃. */}
              <div id="root" tabIndex={-1}>{children}</div>
              <SiteFooter />
            </AuthPresenceProvider>
          </CardRewardAvailabilityProvider>
        </CartProvider>
      </body>
    </html>
  );
}
