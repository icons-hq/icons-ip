import { afterEach, describe, expect, it, vi } from 'vitest';
import { SITE_FOOTER_HREF, SITE_FOOTER_ID, jumpToSiteFooter } from './site-footer-jump';

describe('jumpToSiteFooter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('푸터가 있으면 기본 이동을 막고 푸터를 화면 위로 내려 포커스한다', () => {
    const footer = { scrollIntoView: vi.fn(), focus: vi.fn() };
    vi.stubGlobal('document', { getElementById: vi.fn((id: string) => (id === SITE_FOOTER_ID ? footer : null)) });
    const event = { preventDefault: vi.fn() };

    jumpToSiteFooter(event);

    expect(SITE_FOOTER_HREF).toBe('#site-footer');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(footer.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(footer.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('푸터가 없으면 기본 해시 이동에 맡긴다', () => {
    vi.stubGlobal('document', { getElementById: vi.fn(() => null) });
    const event = { preventDefault: vi.fn() };

    jumpToSiteFooter(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
