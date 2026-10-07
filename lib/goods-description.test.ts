import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GOODS_HTML_EXTERNAL_IMAGE_MAX,
  GOODS_HTML_WARNINGS,
  sanitizeGoodsDescription,
} from './goods-description';

const STORAGE_PATH = 'public-media/catalog/good/22222222-2222-4222-8222-222222222222.webp';

afterEach(() => vi.unstubAllEnvs());

describe('sanitizeGoodsDescription · 호스팅 이미지', () => {
  it('https 호스팅 이미지는 저장·공개 렌더에서 같은 주소로 남고 소유 검증 목록에 들어가지 않는다', () => {
    const source = '<div style="text-align:center"><img src="https://img.example.com/detail/01.jpg" alt="상세 1"><img src="https://img.example.com/detail/02.jpg"></div>';
    const saved = sanitizeGoodsDescription(source);
    const rendered = sanitizeGoodsDescription(saved.html, { imagePaths: [], renderImages: true });

    expect(saved.html).toBe('<div><img src="https://img.example.com/detail/01.jpg" alt="상세 1" loading="lazy" decoding="async" referrerpolicy="no-referrer" /><img src="https://img.example.com/detail/02.jpg" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></div>');
    expect(saved.imagePaths).toEqual([]);
    expect(rendered.html).toBe(saved.html);
    expect(saved.warnings).not.toContain(GOODS_HTML_WARNINGS.unverifiedImage);
  });

  it('http 이미지는 https로 바꾸고 경고를 남긴다', () => {
    const result = sanitizeGoodsDescription('<img src="http://img.example.com/a.png">');

    expect(result.html).toContain('src="https://img.example.com/a.png"');
    expect(result.html).not.toContain('http://');
    expect(result.warnings).toContain(GOODS_HTML_WARNINGS.insecureImage);
  });

  it.each([
    ['인증 정보', 'https://user:pass@img.example.com/a.png'],
    ['프로토콜 상대 경로', '//img.example.com/a.png'],
    ['사이트 상대 경로', '/generated/goods/g1.png'],
    ['공백', 'https://img.example.com/a b.png'],
    ['제어문자', 'https://img.example.com/a\u0007.png'],
    ['역슬래시', 'https:\\\\img.example.com\\a.png'],
    ['data', 'data:image/png;base64,AAAA'],
    ['javascript', 'javascript:alert(1)'],
    ['ftp', 'ftp://img.example.com/a.png'],
  ])('%s 이미지는 지금처럼 제거한다', (_label, src) => {
    const result = sanitizeGoodsDescription(`<p>본문</p><img src="${src.replaceAll('"', '&quot;')}">`);

    expect(result.html).toBe('<p>본문</p>');
    expect(result.warnings).toContain(GOODS_HTML_WARNINGS.unverifiedImage);
  });

  it(`호스팅 이미지는 ${GOODS_HTML_EXTERNAL_IMAGE_MAX}장까지만 남기고 경고한다`, () => {
    const source = Array.from({ length: GOODS_HTML_EXTERNAL_IMAGE_MAX + 2 }, (_, index) => `<img src="https://img.example.com/${index}.jpg">`).join('');
    const result = sanitizeGoodsDescription(source);

    expect(result.html.match(/<img /g)).toHaveLength(GOODS_HTML_EXTERNAL_IMAGE_MAX);
    expect(result.html).toContain(`/${GOODS_HTML_EXTERNAL_IMAGE_MAX - 1}.jpg`);
    expect(result.html).not.toContain(`/${GOODS_HTML_EXTERNAL_IMAGE_MAX}.jpg`);
    expect(result.warnings).toContain(GOODS_HTML_WARNINGS.externalImageLimit);
  });

  it('호스팅 이미지 원문의 크기·이벤트·referrer 속성은 버리고 화면 렌더 속성으로 바꾼다', () => {
    const result = sanitizeGoodsDescription('<img src="https://img.example.com/a.png" width="860" onerror="alert(1)" referrerpolicy="unsafe-url" srcset="https://evil.test/x 2x">');

    expect(result.html).toBe('<img src="https://img.example.com/a.png" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />');
  });
});

describe('sanitizeGoodsDescription · 저장소 이미지 규칙 유지', () => {
  it('저장소 경로는 imagePaths로 모으고 DB가 허용한 경로만 공개 URL로 펼친다', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://media.example.test');
    const source = `<img src="${STORAGE_PATH}" alt="구성"><img src="https://img.example.com/a.png">`;
    const saved = sanitizeGoodsDescription(source);

    expect(saved.imagePaths).toEqual([STORAGE_PATH]);
    expect(saved.html).toContain(`src="${STORAGE_PATH}"`);
    expect(sanitizeGoodsDescription(saved.html, { imagePaths: [STORAGE_PATH], renderImages: true }).html)
      .toContain('src="https://media.example.test/storage/v1/object/public/public-media/catalog/good/22222222-2222-4222-8222-222222222222.webp"');

    const unowned = sanitizeGoodsDescription(saved.html, { imagePaths: [], renderImages: true }).html;
    expect(unowned).not.toContain('media.example.test');
    expect(unowned).toContain('src="https://img.example.com/a.png"');
  });

  it('레이아웃 래퍼는 속성 없이 블록 구조만 남기고 경고하지 않는다', () => {
    const result = sanitizeGoodsDescription('<center>가운데</center><div>첫 줄</div><span>둘째</span>');

    expect(result.html).toBe('<div>가운데</div><div>첫 줄</div><span>둘째</span>');
    expect(result.warnings).toEqual([]);
  });
});
