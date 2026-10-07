import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GoodsImageGrid } from './GoodsImageGrid';

vi.mock('@/lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: vi.fn() }));

const path = (name: string) => `public-media/catalog/good/${name}.webp`;

function render(paths: string[], errors: Record<string, string> = {}) {
  return renderToStaticMarkup(<GoodsImageGrid
    errors={errors}
    initialPaths={paths.map((name) => name && path(name))}
    initialUrls={paths.map((name) => name && `https://cdn.example/${name}.webp`)}
    onPreviewChange={() => undefined}
  />);
}

describe('상품 이미지 썸네일 그리드', () => {
  it('대표 이미지와 추가 이미지를 1:1 타일 하나의 목록으로 그리고 자리별 hidden input을 순서대로 둔다', () => {
    const html = render(['main', 'a', '', 'b', '']);

    expect(html).toContain('상품 이미지 · 대표 이미지 1장 + 추가 이미지 최대 4장');
    expect(html).toContain('1000×1000(1:1) 이미지를 권장합니다. 올린 원본 비율 그대로, 잘리지 않고 표시됩니다.');
    expect(html).toContain('id="goods-image-upload-guidance"');
    expect(html).not.toMatch(/슬롯|갤러리/);
    expect([...html.matchAll(/<input readOnly="" type="hidden" name="([a-zA-Z0-9]+)" value="([^"]*)"\/>/g)].map(([, name, value]) => [name, value]))
      .toEqual([['imagePath', path('main')], ['galleryPath0', path('a')], ['galleryPath1', path('b')], ['galleryPath2', ''], ['galleryPath3', '']]);
    expect(html.match(/<li class="wc-admin-image-tile wc-admin-artwork-upload-field"/g)).toHaveLength(4);
    expect(html).toContain('src="https://cdn.example/b.webp"');
  });

  it('타일마다 교체·삭제·순서·대표 지정 이름을 주고, 대표 이미지는 교체만 한다', () => {
    const html = render(['main', 'a', 'b', '', '']);

    expect(html).toContain('aria-label="대표 이미지 교체"');
    expect(html).not.toContain('aria-label="대표 이미지 삭제"');
    expect(html).toContain('공개 필수');
    expect(html).toContain('aria-label="추가 이미지 2 교체"');
    expect(html).toContain('aria-label="추가 이미지 2 삭제"');
    expect(html).toMatch(/aria-label="추가 이미지 1을 앞으로" disabled=""/);
    expect(html).not.toMatch(/aria-label="추가 이미지 2를 앞으로" disabled=""/);
    expect(html).toMatch(/aria-label="추가 이미지 2를 뒤로" disabled=""/);
    expect(html).toContain('aria-label="추가 이미지 1을 대표로 지정"');
    expect(html).toContain('aria-label="이미지 추가 (추가 이미지, 여러 장 선택 가능)"');
    expect(html).toContain('추가 이미지 2/4');
    expect(html.match(/data-draggable="true"/g)).toHaveLength(2);
    /* 끌기 손잡이는 추가 이미지에만 있고, 스크린리더·키보드에서도 닿는 버튼이다(aria-hidden 아님). */
    expect(html.match(/class="wc-admin-image-tile__handle"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="추가 이미지 2 순서 바꾸기 손잡이 (끌거나 ←·→ 키)"');
    expect(html).not.toContain('aria-label="대표 이미지 순서 바꾸기');
    expect(html).toMatch(/<button aria-keyshortcuts="ArrowLeft ArrowRight" aria-label="추가 이미지 1 순서 바꾸기 손잡이[^"]*" class="wc-admin-image-tile__handle" type="button"><svg aria-hidden="true"/);
  });

  /* 리뷰 재현: 추가 이미지는 끌기 때문에 무엇이 상세의 어디에 나오는지 안내한다 — 상세페이지 HTML 본문과 헷갈리지 않게. */
  it('추가 이미지 순서가 상세 상단 이미지에 쓰인다고 안내하고 상세페이지 본문과 섞어 말하지 않는다', () => {
    const html = render(['main', 'a', '', '', '']);

    expect(html).toContain('이 순서대로 상품 상세 상단 이미지에서 대표 이미지 다음에 표시됩니다.');
    expect(html).toContain('왼쪽 위 손잡이(⋮⋮)를 끌거나 ←·→ 키로');
    expect(html).not.toContain('상세페이지에 표시');
  });

  /* openRisks 재현: 타일 본문이 touch-action:none이면 모바일 어드민에서 타일 위 세로 스크롤이 막혔다. */
  it('타일 본문은 세로 스크롤을 허용하고, 터치 끌기를 막는 touch-action:none은 손잡이에만 둔다', () => {
    const css = readFileSync(new URL('../../app/styles/wc-admin-surfaces.css', import.meta.url), 'utf8');
    const rules = [...css.matchAll(/([^{}\n]+)\{([^}]*)\}/g)].filter(([, selector]) => selector.includes('wc-admin-image-tile'));

    expect(rules.find(([, selector]) => selector.includes('__frame[data-draggable]'))?.[2]).toMatch(/touch-action:\s*pan-y\b/);
    expect(rules.filter(([, , body]) => /touch-action:\s*none/.test(body)).map(([, selector]) => selector.trim()))
      .toEqual(['.wc-admin .wc-admin-image-tile__handle']);
  });

  it('빈 상품은 대표 이미지 추가와 이미지 추가 타일만 보여준다', () => {
    const html = render(['', '', '', '', '']);

    expect(html).toContain('aria-label="대표 이미지 추가"');
    expect(html).toContain('data-upload-state="empty"');
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html.match(/multiple=""/g)).toHaveLength(2);
  });

  it('추가 이미지가 가득 차면 이미지 추가 타일을 숨긴다', () => {
    const html = render(['main', 'a', 'b', 'c', 'd']);

    expect(html).not.toContain('이미지 추가 (추가 이미지');
    expect(html.match(/<li /g)).toHaveLength(5);
  });

  it('폼 오류 키(imagePath, galleryPath{i})를 해당 타일의 오류 문구와 파일 입력 설명에 연결한다', () => {
    const html = render(['', 'a', 'b', '', ''], { imagePath: '대표 이미지를 업로드한 뒤 공개해주세요.', galleryPath1: '같은 이미지를 갤러리에 두 번 넣을 수 없습니다.' });

    expect(html).toContain('<span id="imagePath-error" role="alert"');
    expect(html).toContain('대표 이미지를 업로드한 뒤 공개해주세요.');
    expect(html).toMatch(/aria-describedby="goods-image-upload-guidance imagePath-error" aria-invalid="true" aria-label="대표 이미지 추가"/);
    expect(html).toMatch(/aria-describedby="goods-image-upload-guidance galleryPath1-error" aria-invalid="true" aria-label="추가 이미지 2 교체"/);
    expect(html).toContain('data-invalid="true"');
  });
});
