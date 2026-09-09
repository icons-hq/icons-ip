import type { Metadata } from 'next';
import { Space_Grotesk, Space_Mono } from 'next/font/google';
import './globals.css';
import './styles/wc-foundation.css';
import './styles/wc-admin-surfaces.css';
import './styles/wc-admin.css';
import './styles/admin-faq.css';
import './styles/admin-goods-notice-presets.css';
import './styles/admin-order-detail.css';
import './styles/admin-customer-detail.css';
import './styles/admin-store-settings.css';
import './styles/wc-chrome.css';
import './styles/wc-home.css';
import './styles/wc-catalog.css';
import './styles/wc-discovery.css';
import './styles/wc-account-commerce.css';
import './styles/wc-campaign.css';
import './styles/wc-help.css';
import './styles/wc-inquiry-widget.css';
/* 보존 표면은 각 앵커 안에 자체 기본 규칙과 토큰을 가진다. */
import './styles/about-legacy.css';
import './styles/offline-popups-legacy.css';
import './styles/legal-doc.css';
import { AuthPresenceProvider } from '@/components/shell/AuthPresenceProvider';
import { CartProvider } from '@/components/shell/CartProvider';
import { Nav } from '@/components/shell/Nav';
import { getBusinessInfo } from '@/lib/legal/business-info.server';
import { InquiryWidget } from '@/components/screens/InquiryWidget';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { CardRewardAvailabilityProvider } from '@/components/shell/CardRewardAvailability';
import { StaffPreviewAvailabilityProvider } from '@/components/shell/StaffPreviewAvailability';
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
  const [noticeStrip,businessInfo] = await Promise.all([getActiveNoticeStrip(),getBusinessInfo()]);

  return (
    <html lang="ko" data-scroll-behavior="smooth" className={`${spaceGrotesk.variable} ${spaceMono.variable}`}>
      <body>
        <CartProvider>
          <CardRewardAvailabilityProvider>
            <AuthPresenceProvider>
              {/* 스태프 전용 진입점(세컨더리 마켓 시연·커뮤니티 프리뷰)은 presence 위에서 is_staff 를 읽으므로 AuthPresence 안쪽이다. */}
              <StaffPreviewAvailabilityProvider>
                <Nav noticeStrip={noticeStrip} />
                {/* tabIndex: 셸 스킵 링크(#root)가 키보드 포커스를 본문으로 실제 이동시키기 위한 타깃. */}
                <div id="root" tabIndex={-1}>{children}<InquiryWidget /></div>
                <SiteFooter businessInfo={businessInfo} />
              </StaffPreviewAvailabilityProvider>
            </AuthPresenceProvider>
          </CardRewardAvailabilityProvider>
        </CartProvider>
      </body>
    </html>
  );
}
