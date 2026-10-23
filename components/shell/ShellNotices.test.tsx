import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import { SHELL_NOTICE_ROOT_ID, SHELL_NOTICE_SCRIPT, type ShellNoticeBar, type ShellNotices as ShellNoticeData, type ShellNoticeStrip } from '@/lib/shell-notices';
import { ShellNotices } from './ShellNotices';

vi.mock('@/components/ui/Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));

/* renderToStaticMarkup은 서버 렌더와 같다 — effect·sessionStorage·시드 없이 결정적인 첫 HTML을 본다.
   닫힘·무작위 선택은 그 뒤 인라인 스크립트와 하이드레이션 몫이다(lib/shell-notices.test.ts가 둘을 대조한다). */

const bar = (id: string, patch: Partial<ShellNoticeBar> = {}): ShellNoticeBar => ({
  id, key: `${id}:abc123abc123`, message: `공지 문구 ${id}`, cta: { label: '자세히 보기', href: '/legal/terms' },
  pageTypes: ['home', 'product', 'content', 'other'], ...patch,
});
const strip = (id: string, patch: Partial<ShellNoticeStrip> = {}): ShellNoticeStrip => ({
  id, title: `띠배너 ${id}`, imageUrl: `https://cdn.example/${id}.webp`, mobileImageUrl: null, href: '/events',
  pageTypes: ['home', 'product', 'content', 'other'], ...patch,
});

function render(notices: ShellNoticeData, pathname = '/', cardRewardsEnabled = true) {
  return renderToStaticMarkup(<ShellNotices cardRewardsEnabled={cardRewardsEnabled} notices={notices} pathname={pathname} />);
}

/* 스크립트 본문에도 선택자 문자열이 들어 있다 — 공지 마크업만 볼 때는 스크립트를 걷어 낸다. */
function markup(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/g, '');
}

function tagFor(html: string, marker: string) {
  const index = html.indexOf(marker);
  expect(index, marker).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<', index);
  return html.slice(start, html.indexOf('>', index) + 1);
}

describe('셸 공지 서버 렌더', () => {
  it('공지가 하나도 없으면 아무것도 그리지 않는다(빈 띠·스크립트 없음)', () => {
    expect(render({ bars: [], strips: [] })).toBe('');
  });

  it('공지 바는 문구·버튼·닫기를 갖고, 이 화면의 후보 중 첫 번째만 보인다', () => {
    const html = render({ bars: [bar('b1'), bar('b2')], strips: [] });
    expect(html).toContain(`id="${SHELL_NOTICE_ROOT_ID}"`);
    expect(tagFor(html, 'data-notice-bar="b1:abc123abc123"')).not.toContain('hidden');
    expect(tagFor(html, 'data-notice-bar="b2:abc123abc123"')).toContain('hidden=""');
    expect(html).toContain('aria-label="스토어 공지"');
    expect(html).toContain('공지 문구 b1');
    expect(html).toContain('<a class="wc-notice-bar__cta" href="/legal/terms">자세히 보기</a>');
    expect(html).toContain('aria-label="공지 닫기"');
    expect(html).toContain('data-icon="close"');
    expect(html).toContain('data-notice-id="b1"');
  });

  it('버튼 없는 공지 바는 문구와 닫기만 그린다', () => {
    const html = render({ bars: [bar('copy', { cta: null })], strips: [] });
    expect(html).toContain('공지 문구 copy');
    expect(html).not.toContain('wc-notice-bar__cta');
    expect(html).toContain('wc-notice-bar__close');
  });

  it('스트립은 링크 배너이고 첫 후보만 보이며, 후보가 여럿이면 숨은 후보의 이미지는 늦게 받는다', () => {
    const html = render({ bars: [], strips: [strip('s1', { mobileImageUrl: 'https://cdn.example/s1-m.webp' }), strip('s2')] });
    expect(tagFor(html, 'data-notice-strip="s1"')).not.toContain('hidden');
    expect(tagFor(html, 'data-notice-strip="s2"')).toContain('hidden=""');
    expect(html).toContain('class="wc-notice"');
    expect(html).toContain('<source media="(max-width: 749px)" srcSet="https://cdn.example/s1-m.webp"/>');
    expect(html).toContain('alt="띠배너 s1"');
    expect(html.match(/loading="lazy"/g)).toHaveLength(2);
    expect(render({ bars: [], strips: [strip('only')] })).not.toContain('loading="lazy"');
  });

  it('텍스트 공지 바가 이미지 스트립 위에 있고, 바로 뒤에 첫 페인트 전 스크립트가 온다', () => {
    const html = render({ bars: [bar('b1')], strips: [strip('s1')] });
    expect(html.indexOf('wc-notice-bar')).toBeLessThan(html.indexOf('class="wc-notice"'));
    const script = html.indexOf('<script');
    expect(script).toBeGreaterThan(html.indexOf('class="wc-notice"'));
    expect(tagFor(html, '<script')).toContain('type="text/javascript"');
    expect(html).toContain(SHELL_NOTICE_SCRIPT);
  });

  it('대상 화면 유형이 아니면 그리지 않는다 — 상품 목록 미대상 스트립은 /shop에 없다', () => {
    const notices = { bars: [bar('b1', { pageTypes: ['home'] })], strips: [strip('s1'), strip('legacy', { pageTypes: null })] };
    const shop = markup(render(notices, '/shop'));
    expect(shop).not.toContain('data-notice-bar');
    expect(shop).not.toContain('data-notice-strip="s1"');
    expect(shop).toContain('data-notice-strip="legacy"');
    expect(render(notices, '/shop/g11')).toContain('data-notice-strip="s1"');
  });

  it('보일 공지가 없는 화면에도 스크립트는 남긴다 — 하드 로드 시드를 다음 화면 이동이 쓴다', () => {
    const html = render({ bars: [bar('b1', { pageTypes: ['home'] })], strips: [] }, '/cart');
    expect(markup(html)).toBe('');
    expect(html).toContain('<script');
  });

  it('게이트가 꺼진 배포에서 카드팩 목적지 공지는 숨고, 커뮤니티 목적지는 공개 스위치를 따른다', () => {
    const packs = { bars: [bar('packs', { cta: { label: '열기', href: '/packs' } })], strips: [strip('games', { href: '/games/roulette' })] };
    expect(markup(render(packs, '/', false))).toBe('');
    expect(markup(render(packs, '/', true))).toContain('data-notice-bar');
    const community = { bars: [], strips: [strip('community', { href: '/community' })] };
    expect(markup(render(community)).includes('data-notice-strip')).toBe(COMMUNITY_ENABLED);
  });
});
