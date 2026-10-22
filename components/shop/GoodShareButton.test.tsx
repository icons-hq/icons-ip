import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GoodShareButton, GoodShareDialog, pdpShareUrl } from './GoodShareButton';

describe('pdpShareUrl', () => {
  it('리뷰·Q&A 페이지 같은 화면 상태와 해시를 떼고 고른 옵션만 남긴다', () => {
    expect(pdpShareUrl('https://iconsip.com/shop/g13?reviewPage=2&reviewSort=rating_desc#reviews'))
      .toBe('https://iconsip.com/shop/g13');
    expect(pdpShareUrl('https://iconsip.com/shop/g13?qnaPage=3&variant=00000000-0000-4000-8000-000000000101'))
      .toBe('https://iconsip.com/shop/g13?variant=00000000-0000-4000-8000-000000000101');
  });
});

describe('GoodShareDialog', () => {
  it('링크 복사를 기본으로 두고 복사 결과를 live region 으로 알린다', () => {
    const html = renderToStaticMarkup(<GoodShareDialog canNativeShare={false} goodName="아크릴 블록" onClose={vi.fn()} url="https://iconsip.com/shop/g13" />);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const labelledBy = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(html).toContain(`id="${labelledBy}">공유하기</h2>`);
    expect(html).toMatch(/<input[^>]*readOnly=""[^>]*type="url" value="https:\/\/iconsip\.com\/shop\/g13"\/>/);
    expect(html).toContain('<span class="wc-sr-only">아크릴 블록 링크</span>');
    expect(html).toContain('>링크 복사</button>');
    expect(html).toContain('aria-live="polite" class="wc-share-dialog__status" role="status"');
    expect(html).toContain('>닫기</button>');
    /* 기기 공유를 지원하지 않으면 그 버튼을 두지 않는다. SNS SDK 버튼은 어디에도 없다. */
    expect(html).not.toContain('다른 앱으로 공유');
    expect(html).not.toMatch(/카카오|kakao|facebook|LINE/i);
  });

  it('기기가 공유 시트를 지원하면 다른 앱으로 공유를 함께 둔다', () => {
    const html = renderToStaticMarkup(<GoodShareDialog canNativeShare goodName="아크릴 블록" onClose={vi.fn()} url="https://iconsip.com/shop/g13" />);
    expect(html).toContain('>다른 앱으로 공유</button>');
  });
});

describe('GoodShareButton', () => {
  it('36 원형 공유 버튼은 다이얼로그를 여는 버튼으로 읽힌다', () => {
    const html = renderToStaticMarkup(<GoodShareButton goodName="아크릴 블록" />);
    expect(html).toMatch(/^<button aria-expanded="false" aria-haspopup="dialog" aria-label="공유하기" class="wc-pdp-share" type="button"><svg aria-hidden="true"/);
  });
});
