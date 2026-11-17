import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ShellNoticeBar } from '@/lib/shell-notices';
import { ShellNotices } from '@/components/shell/ShellNotices';
import { CurationPreviewNoticeBar } from './CurationPreview';

/* 미리보기는 공개 화면과 같은 컴포넌트를 불러 쓰는 곳이라 렌더에 닿지 않는 모듈은 대역으로 둔다(홈·위시 서버 액션). */
vi.mock('@/components/screens/Home', () => ({ Home: () => null }));
vi.mock('@/components/shop/CollectionBanners', () => ({ CollectionBanners: () => null }));
vi.mock('@/components/ui/Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));

const bar: ShellNoticeBar = {
  id: 'b1', key: 'b1:abc123abc123', message: '이용약관 개정 안내', cta: { label: '자세히 보기', href: '/legal/terms' },
  pageTypes: ['home'], endsAt: null,
};

/* review-b m6 — 어드민 전시 미리보기의 텍스트 공지 바가 공개 화면과 같은 빨간 롤링 띠 마크업·클래스다. 옛 회색 정적 마크업이면 검수할 수 없다. */
describe('CurationPreviewNoticeBar', () => {
  const preview = renderToStaticMarkup(<CurationPreviewNoticeBar bar={bar} />);

  it('공개 롤링 띠와 같은 클래스·본문 마크업을 쓰고 옛 회색 정적 마크업을 쓰지 않는다', () => {
    expect(preview).toContain('<aside aria-label="스토어 공지" class="wc-notice-bar wc-x-rolling">');
    expect(preview).toContain('<a class="wc-x-rolling__link" href="/legal/terms"><span class="wc-sr-only">이용약관 개정 안내 자세히 보기</span>');
    expect(preview.match(/class="wc-x-rolling__copy"/g)).toHaveLength(8);
    expect(preview).not.toContain('wc-notice-bar__message');
    expect(preview).not.toContain('wc-notice-bar__cta');
    expect(preview).not.toContain('<button');
  });

  it('버튼 없는 공지는 링크 없이 흐르는 문구만 그린다', () => {
    const html = renderToStaticMarkup(<CurationPreviewNoticeBar bar={{ ...bar, cta: null }} />);
    expect(html).toContain('<span class="wc-x-rolling__static"><span class="wc-sr-only">이용약관 개정 안내</span>');
    expect(html).not.toContain('<a ');
  });

  it('공개 셸이 그리는 같은 공지의 본문 마크업과 글자 하나까지 같다', () => {
    const body = (html: string) => html.slice(html.indexOf('<p class="wc-x-rolling__body">'), html.indexOf('</p>') + 4);
    const shell = renderToStaticMarkup(<ShellNotices cardRewardsEnabled notices={{ bars: [bar], strips: [] }} pathname="/" />);
    expect(body(preview)).toBe(body(shell));
  });
});
