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
  pageTypes: ['home', 'product', 'content', 'other'], endsAt: null, ...patch,
});
const strip = (id: string, patch: Partial<ShellNoticeStrip> = {}): ShellNoticeStrip => ({
  id, title: `띠배너 ${id}`, imageUrl: `https://cdn.example/${id}.webp`, mobileImageUrl: null, href: '/events',
  pageTypes: ['home', 'product', 'content', 'other'], endsAt: null, ...patch,
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

/* 스트립 후보 링크 안의 img 태그. */
function stripImg(html: string, id: string) {
  const start = html.indexOf(`data-notice-strip="${id}"`);
  expect(start, id).toBeGreaterThan(-1);
  return tagFor(html.slice(start, html.indexOf('</a>', start)), '<img');
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

  /* l8a-qa-1: 이미지가 lazy면 첫 레이아웃 뒤에야 요청돼, 첫 페인트 뒤 띠배너가 끼어들며 본문을 민다. 보일 후보는 첫 페인트
     직전(스타일시트 뒤)에야 정해지므로 숨은 후보도 미루지 않는다 — 어느 후보가 뽑혀도 HTML 파싱 중 바로 요청된다. */
  it('스트립은 링크 배너이고 첫 후보만 보이며, 이미지는 숨은 후보까지 모두 바로 받는다(lazy 없음)', () => {
    const html = render({ bars: [], strips: [strip('s1', { mobileImageUrl: 'https://cdn.example/s1-m.webp' }), strip('s2'), strip('s3')] });
    expect(tagFor(html, 'data-notice-strip="s1"')).not.toContain('hidden');
    expect(tagFor(html, 'data-notice-strip="s2"')).toContain('hidden=""');
    expect(html).toContain('class="wc-notice"');
    expect(html).toContain('<source media="(max-width: 749px)" srcSet="https://cdn.example/s1-m.webp"/>');
    expect(html).toContain('alt="띠배너 s1"');
    for (const id of ['s1', 's2', 's3']) expect(stripImg(html, id)).not.toContain('loading=');
    expect(stripImg(render({ bars: [], strips: [strip('only')] }), 'only')).not.toContain('loading=');
  });

  /* 셸 QA(2026-10-27) — 이미지가 600ms 늦으면 모바일 띠가 0 에서 52 로 펼쳐지며 #root 를 밀었다(CLS 0.05). 서버가 읽은 고유 크기로
     자리를 먼저 잡는다 — 모바일 소스는 자기 크기를, img 는 PC 크기를 단다. */
  it('이미지 고유 크기를 width·height 로 달아 띠 자리를 첫 페인트 전에 잡는다', () => {
    const html = render({ bars: [], strips: [strip('s1', {
      mobileImageUrl: 'https://cdn.example/s1-m.webp', imageSize: { width: 1440, height: 36 }, mobileImageSize: { width: 375, height: 52 },
    })] });
    expect(html).toContain('<source height="52" media="(max-width: 749px)" srcSet="https://cdn.example/s1-m.webp" width="375"/>');
    expect(stripImg(html, 's1')).toBe('<img alt="띠배너 s1" height="36" src="https://cdn.example/s1.webp" width="1440"/>');
    /* 모바일 소스 크기를 모르면 img 크기도 달지 않는다 — 브라우저가 PC 비율로 모바일 이미지 자리를 잘못 잡는다. */
    const unknownMobile = render({ bars: [], strips: [strip('s2', { mobileImageUrl: 'https://cdn.example/s2-m.webp', imageSize: { width: 1440, height: 36 }, mobileImageSize: null })] });
    expect(stripImg(unknownMobile, 's2')).toBe('<img alt="띠배너 s2" src="https://cdn.example/s2.webp"/>');
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

  /* 종료 시각은 첫 페인트 전 스크립트와 하이드레이션·타이머가 지킨다(l8a-ui-4). 서버 렌더는 시각을 모르므로(캐시·정적 HTML)
     시각으로 거르지 않고, 스크립트가 읽을 종료 시각을 속성으로 싣는다. */
  it('종료 시각이 있는 공지는 data-notice-ends를 싣고, 서버 렌더는 시각으로 거르지 않는다', () => {
    const past = Date.UTC(2020, 0, 1);
    const html = render({ bars: [bar('b1', { endsAt: past }), bar('b2')], strips: [strip('s1', { endsAt: past }), strip('s2')] });
    expect(tagFor(html, 'data-notice-bar="b1:abc123abc123"')).toContain(`data-notice-ends="${past}"`);
    expect(tagFor(html, 'data-notice-bar="b1:abc123abc123"')).not.toContain('hidden');
    expect(tagFor(html, 'data-notice-bar="b2:abc123abc123"')).not.toContain('data-notice-ends');
    expect(tagFor(html, 'data-notice-strip="s1"')).toContain(`data-notice-ends="${past}"`);
    expect(tagFor(html, 'data-notice-strip="s1"')).not.toContain('hidden');
    expect(tagFor(html, 'data-notice-strip="s2"')).not.toContain('data-notice-ends');
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
