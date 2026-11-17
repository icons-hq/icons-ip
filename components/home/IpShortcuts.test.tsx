import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HomeEditorPick } from '@/lib/home-catalog';
import { IpShortcuts } from './IpShortcuts';

const pick = (id: string, overrides: Partial<HomeEditorPick> = {}): HomeEditorPick => ({
  id,
  title: `문구 ${id}`,
  badge: `IP ${id}`,
  description: `설명 ${id}`,
  imageBg: 'url("https://cdn.example/pick.webp") center / cover no-repeat',
  href: `/ip/${id}`,
  ...overrides,
});

describe('IpShortcuts', () => {
  it('draws nothing without picks', () => {
    expect(renderToStaticMarkup(<IpShortcuts picks={[]} />)).toBe('');
  });

  it('names the section with a hidden heading and draws one link per pick', () => {
    const html = renderToStaticMarkup(<IpShortcuts picks={[pick('a'), pick('b'), pick('c'), pick('d')]} />);

    expect(html).toContain('aria-labelledby="home-ip-shortcuts-heading"');
    expect(html).toContain('<h2 class="wc-sr-only" id="home-ip-shortcuts-heading">IP 바로가기</h2>');
    expect((html.match(/class="wc-ip-shortcuts__item"/g) ?? []).length).toBe(4);
    expect(html).toContain('<ul class="wc-ip-shortcuts">');
    expect(html).toContain('class="wc-container wc-container--wide"');
  });

  /* 배지 = 작은 회색 줄(IP 이름), 제목 = 아래 줄 문구. 설명은 새 화면에 그리지 않는다. */
  it('shows the badge as the IP-name line above the title and never draws the description', () => {
    const html = renderToStaticMarkup(<IpShortcuts picks={[pick('a')]} />);

    expect(html.indexOf('wc-ip-shortcuts__ip')).toBeLessThan(html.indexOf('wc-ip-shortcuts__title'));
    expect(html).toContain('<span class="wc-ip-shortcuts__ip">IP a</span>');
    expect(html).toContain('<span class="wc-ip-shortcuts__title">문구 a</span>');
    expect(html).not.toContain('설명 a');
  });

  it('drops the IP-name line when the pick has no badge', () => {
    const html = renderToStaticMarkup(<IpShortcuts picks={[pick('a', { badge: null })]} />);

    expect(html).not.toContain('wc-ip-shortcuts__ip');
    expect(html).toContain('<span class="wc-ip-shortcuts__title">문구 a</span>');
  });

  /* 항목 전체가 링크 하나이고 이름은 링크 안 글(IP 이름 + 문구)이다 — 썸네일은 장식이라 읽지 않는다. */
  it('makes the whole item one link named by its text, with the thumbnail hidden from assistive tech', () => {
    const html = renderToStaticMarkup(<IpShortcuts picks={[pick('a')]} />);
    const link = html.match(/<a\b[^>]*wc-ip-shortcuts__item[^>]*>[\s\S]*?<\/a>/)?.[0] ?? '';

    expect(link).toContain('href="/ip/a"');
    expect(link).toContain('aria-hidden="true" class="wc-ip-shortcuts__thumb"');
    expect(link).toContain('background:url(&quot;https://cdn.example/pick.webp&quot;) center / cover no-repeat');
    /* 이름 계산에서 IP 이름과 문구가 붙어 읽히지 않게 사이에 공백이 있다. */
    expect(link).toContain('IP a</span> <span class="wc-ip-shortcuts__title">');
    expect(link).not.toContain('<img');
  });
});
