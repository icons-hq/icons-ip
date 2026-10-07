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

  /* 리뷰 재현: url.href로 다시 쓰면 한글 1자가 9자(%EC%83%81)가 되어 정리된 코드만 30,000자를 넘을 수 있었다. */
  it('호스팅 주소는 적은 문자열 그대로 저장해 한글 파일명이 퍼센트 인코딩으로 길어지지 않는다', () => {
    const result = sanitizeGoodsDescription('<img src="https://img.example.com/상세/상세01.jpg?v=2&w=860">');

    expect(result.html).toBe('<img src="https://img.example.com/상세/상세01.jpg?v=2&amp;w=860" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />');
    expect(result.html).not.toContain('%EC');
    expect(sanitizeGoodsDescription(result.html, { imagePaths: [], renderImages: true }).html).toBe(result.html);
  });

  it('경로의 퍼센트 인코딩·점 경로를 정규화하지 않아 다른 리소스를 가리키지 않는다', () => {
    const result = sanitizeGoodsDescription('<img src="https://img.example.com/a/%2e%2e/b.jpg"><img src="https://img.example.com/a/../c.jpg">');

    expect(result.html).toContain('src="https://img.example.com/a/%2e%2e/b.jpg"');
    expect(result.html).toContain('src="https://img.example.com/a/../c.jpg"');
  });

  it('http는 스킴만 https로 바꾸고, 기본 포트 80 표기만 빼고 나머지 주소는 그대로 둔다', () => {
    const result = sanitizeGoodsDescription('<img src="HTTP://img.example.com:80/상세.png"><img src="http://img.example.com:8080/b.png">');

    expect(result.html).toContain('src="https://img.example.com/상세.png"');
    expect(result.html).toContain('src="https://img.example.com:8080/b.png"');
    expect(result.warnings).toContain(GOODS_HTML_WARNINGS.insecureImage);
  });

  it.each([
    ['인증 정보', 'https://user:pass@img.example.com/a.png'],
    ['프로토콜 상대 경로', '//img.example.com/a.png'],
    ['사이트 상대 경로', '/generated/goods/g1.png'],
    ['역슬래시', 'https:\\\\img.example.com\\a.png'],
    ['슬래시가 빠진 주소', 'https:img.example.com/a.png'],
    ['data', 'data:image/png;base64,AAAA'],
    ['javascript', 'javascript:alert(1)'],
    ['ftp', 'ftp://img.example.com/a.png'],
  ])('%s 이미지는 지금처럼 제거한다', (_label, src) => {
    const result = sanitizeGoodsDescription(`<p>본문</p><img src="${src.replaceAll('"', '&quot;')}">`);

    expect(result.html).toBe('<p>본문</p>');
    expect(result.warnings).toContain(GOODS_HTML_WARNINGS.unverifiedImage);
  });

  /* 리뷰 재현: 이미 https로 시작하는 주소가 공백 때문에 빠지면 일반 경고로는 MD가 이유를 알 수 없었다. */
  it.each([
    ['파일명 공백', 'https://img.example.com/상세 01.jpg'],
    ['앞뒤 공백', ' https://img.example.com/a.jpg '],
    ['줄바꿈', 'https://img.example.com/\na.jpg'],
    ['제어문자', 'https://img.example.com/a\u0007.png'],
  ])('%s — 호스팅 주소는 지금처럼 제거하되 공백 때문이라고 따로 알린다', (_label, src) => {
    const result = sanitizeGoodsDescription(`<p>본문</p><img src="${src}">`);

    expect(result.html).toBe('<p>본문</p>');
    expect(result.warnings).toEqual([GOODS_HTML_WARNINGS.imageUrlWhitespace]);
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

  /* 리뷰 재현: CSS `img + br`은 사이의 글자를 건너뛰어 "제품명: 쿠션<br>소재: 면"의 줄바꿈까지 숨겼다. */
  it('공개 렌더는 이미지 바로 뒤의 <br>만 지우고, 글자 뒤 줄바꿈과 저장 원문은 그대로 둔다', () => {
    const source = '<div><img src="https://img.example.com/1.jpg"><br>\n<img src="https://img.example.com/2.jpg"><br><br></div><p><img src="https://img.example.com/3.jpg">제품명: 쿠션<br>소재: 면</p><p><a href="https://shop.example.com"><img src="https://img.example.com/4.jpg"></a><br>안내</p>';
    const saved = sanitizeGoodsDescription(source);
    const rendered = sanitizeGoodsDescription(saved.html, { imagePaths: [], renderImages: true }).html;
    const image = (n: number) => `<img src="https://img.example.com/${n}.jpg" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;

    expect(saved.html.match(/<br \/>/g)).toHaveLength(5);
    expect(rendered).toBe(`<div>${image(1)}\n${image(2)}<br /></div><p>${image(3)}제품명: 쿠션<br />소재: 면</p><p><a href="https://shop.example.com" rel="noopener noreferrer">${image(4)}</a>안내</p>`);
  });

  it('레이아웃 래퍼는 속성 없이 블록 구조만 남기고 경고하지 않는다', () => {
    const result = sanitizeGoodsDescription('<center>가운데</center><div>첫 줄</div><span>둘째</span>');

    expect(result.html).toBe('<div>가운데</div><div>첫 줄</div><span>둘째</span>');
    expect(result.warnings).toEqual([]);
  });
});
