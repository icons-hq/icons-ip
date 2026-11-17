import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { imageBg } from '@/lib/media';
import { PromoCard } from './PromoCard';

describe('PromoCard', () => {
  it('카드 전체가 링크 하나이고 제목은 h3 이다', () => {
    const html = renderToStaticMarkup(<PromoCard href="/events/summer" imageBg={null} title="여름 코인 이벤트" />);

    expect(html).toBe(
      '<a class="wc-promo-card" href="/events/summer"><div aria-hidden="true" class="wc-promo-card__art"></div><div class="wc-promo-card__body"><h3 class="wc-promo-card__title">여름 코인 이벤트</h3></div></a>',
    );
  });

  /* 홈 ICONS PICK 은 기획전 배너 URL 을 imageBg(url)로 넘긴다 — CSS 배경 문자열이 그대로 style 에 간다. */
  it('imageBg 의 CSS 배경 문자열을 아트 레이어에 그대로 싣고, null 이면 배경을 싣지 않는다(회색 면)', () => {
    const withImage = renderToStaticMarkup(<PromoCard href="/x" imageBg={imageBg('https://cdn.test/a.png')} title="가" />);
    const gradient = renderToStaticMarkup(<PromoCard href="/x" imageBg="linear-gradient(#111, #222)" title="가" />);
    const empty = renderToStaticMarkup(<PromoCard href="/x" imageBg={null} title="가" />);

    expect(withImage).toContain('style="background:url(&quot;https://cdn.test/a.png&quot;) center / cover no-repeat"');
    expect(gradient).toContain('style="background:linear-gradient(#111, #222)"');
    expect(empty).not.toContain('style=');
  });

  it('배경 이미지는 장식이라 접근성 트리에서 뺀다', () => {
    const html = renderToStaticMarkup(<PromoCard href="/x" imageBg={imageBg('https://cdn.test/a.png')} title="가" />);

    expect(html).toContain('<div aria-hidden="true" class="wc-promo-card__art"');
  });

  it('배지와 메타 줄은 있을 때만 그린다', () => {
    const bare = renderToStaticMarkup(<PromoCard href="/x" imageBg={null} title="가" />);
    const full = renderToStaticMarkup(
      <PromoCard badge="오픈 예정" href="/x" imageBg={null} meta="오프라인 · 서울 · 11.01 - 11.30" title="가" />,
    );

    expect(bare).not.toContain('wc-promo-card__badge');
    expect(bare).not.toContain('wc-promo-card__meta');
    expect(full).toContain('<span class="wc-promo-card__badge">오픈 예정</span>');
    expect(full).toContain('<p class="wc-promo-card__meta">오프라인 · 서울 · 11.01 - 11.30</p>');
  });

  /* 묶음 안(홈 ICONS PICK)에서 모서리를 조정하려고 루트에 클래스를 더 달 수 있다. */
  it('className 은 루트 클래스 뒤에 더한다', () => {
    const html = renderToStaticMarkup(<PromoCard className="wc-x-pick__card" href="/x" imageBg={null} title="가" />);

    expect(html).toContain('<a class="wc-promo-card wc-x-pick__card" href="/x">');
  });

  /* 배경이 CSS 라 loading 속성이 없다 — priority 는 이미지를 우선 내려받도록 미리 불러 둔다. */
  it('priority 이면 배경 이미지를 높은 우선순위로 preload 한다', () => {
    const html = renderToStaticMarkup(<PromoCard href="/x" imageBg={imageBg('https://cdn.test/a.png')} priority title="가" />);

    expect(html).toContain('<link rel="preload" href="https://cdn.test/a.png" as="image" fetchPriority="high"/>');
  });

  it('priority 가 아니거나 이미지가 없으면 preload 하지 않는다', () => {
    expect(renderToStaticMarkup(<PromoCard href="/x" imageBg={imageBg('https://cdn.test/a.png')} title="가" />)).not.toContain('preload');
    expect(renderToStaticMarkup(<PromoCard href="/x" imageBg={null} priority title="가" />)).not.toContain('preload');
    expect(renderToStaticMarkup(<PromoCard href="/x" imageBg="linear-gradient(#111, #222)" priority title="가" />)).not.toContain('preload');
  });
});
