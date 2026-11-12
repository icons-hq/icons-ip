import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GoodsImageGrid } from './GoodsImageGrid';

vi.mock('@/lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: vi.fn() }));

const path = (name: string) => `public-media/catalog/good/${name}.webp`;

function render(paths: string[], errors: Record<string, string> = {}, publication?: 'draft' | 'published' | 'archived') {
  return renderToStaticMarkup(<GoodsImageGrid
    errors={errors}
    initialPaths={paths.map((name) => name && path(name))}
    initialUrls={paths.map((name) => name && `https://cdn.example/${name}.webp`)}
    onPreviewChange={() => undefined}
    publication={publication}
  />);
}

describe('상품 이미지 썸네일 그리드', () => {
  it('대표 이미지와 추가 이미지를 1:1 타일 하나의 목록으로 그리고 자리별 hidden input을 순서대로 둔다', () => {
    const html = render(['main', 'a', '', 'b', '']);

    expect(html).toContain('상품 이미지 · 대표 이미지 1장 + 추가 이미지 최대 9장');
    expect(html).toContain('1000×1000(1:1) 이미지를 권장합니다. 올린 원본 비율 그대로, 잘리지 않고 표시됩니다.');
    expect(html).toContain('id="goods-image-upload-guidance"');
    expect(html).not.toMatch(/슬롯|갤러리/);
    expect([...html.matchAll(/<input readOnly="" type="hidden" name="([a-zA-Z0-9]+)" value="([^"]*)"\/>/g)].map(([, name, value]) => [name, value]))
      .toEqual([['imagePath', path('main')], ['galleryPath0', path('a')], ['galleryPath1', path('b')],
        ...Array.from({ length: 7 }, (_, index) => [`galleryPath${index + 2}`, ''])]);
    /* 타일마다 업로드 경계(data-artwork-upload-field)다 — 오류 이동이 그 안의 hidden input으로 자리 이름을 찾는다. */
    expect(html.match(/<li class="[^"]*" data-artwork-upload-field=""/g)).toHaveLength(4);
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
    expect(html).toContain('추가 이미지 2/9');
    expect(html.match(/data-draggable="true"/g)).toHaveLength(2);
    /* 끌기 손잡이는 추가 이미지에만 있고, 스크린리더·키보드에서도 닿는 버튼이다(aria-hidden 아님). */
    expect(html.match(/data-image-handle=""/g)).toHaveLength(2);
    expect(html).toContain('aria-label="추가 이미지 2 순서 바꾸기 손잡이 (끌거나 ←·→ 키)"');
    expect(html).not.toContain('aria-label="대표 이미지 순서 바꾸기');
    expect(html).toMatch(/<button aria-keyshortcuts="ArrowLeft ArrowRight" aria-label="추가 이미지 1 순서 바꾸기 손잡이[^"]*" class="[^"]*" data-image-handle="" type="button"><svg aria-hidden="true"/);
  });

  /* 1007-055(11/11 결정): 초안 상품은 저장된 대표 이미지도 ×로 지운다. 공개 중이면 대표 이미지가 공개 조건이라 교체만 한다. */
  it('초안 상품은 저장된 대표 이미지에도 ×가 있고, 공개 중인 상품은 교체만 한다고 알린다', () => {
    const draft = render(['main', 'a', '', '', ''], {}, 'draft');
    expect(draft).toMatch(/<button aria-label="대표 이미지 삭제"[^>]*data-image-remove=""/);
    expect(draft).toContain('aria-label="추가 이미지 1 삭제"');
    expect(draft).toContain('data-good-main-image-note="draft">공개 필수<');
    expect(draft).not.toContain('공개 중 교체만');
    const published = render(['main', 'a', '', '', ''], {}, 'published');
    expect(published).not.toContain('aria-label="대표 이미지 삭제"');
    expect(published).toContain('공개 필수 · 공개 중 교체만');
    /* 값을 주지 않으면 저장된 대표 이미지를 지우지 않는 쪽(공개 중)으로 본다. */
    expect(render(['main', 'a', '', '', ''])).not.toContain('aria-label="대표 이미지 삭제"');
    /* 대표 이미지가 없으면 지울 것이 없다. */
    expect(render(['', 'a', '', '', ''], {}, 'draft')).not.toContain('aria-label="대표 이미지 삭제"');
  });

  /* T15a 리뷰: 보관 상품의 대표 이미지에 '공개 중 교체만'이 붙었다. 라벨은 게시 상태를 따로 보고 보관 상품은 복원 뒤 고친다고 말한다. */
  it('보관 상품의 대표 이미지는 공개 중 문구 대신 보관 상태 문구를 보이고 ×도 없다', () => {
    const archived = render(['main', 'a', '', '', ''], {}, 'archived');
    expect(archived).toContain('data-good-main-image-note="archived">보관 상품 · 복원 뒤 수정<');
    expect(archived).not.toContain('공개 중 교체만');
    expect(archived).not.toContain('aria-label="대표 이미지 삭제"');
    expect(archived).toContain('보관 상품은 복원한 뒤 이미지를 고쳐 저장합니다.');
  });

  /* ADM-004(복잡도 표 160행): 조작 안내는 접어 두고, 비율·파일 규격 안내는 입력 설명으로 계속 보인다. */
  it('이미지 조작 안내는 접힌 도움말이고 비율·규격 안내는 펼쳐 둔다', () => {
    const html = render(['main', 'a', '', '', '']);
    const guide = html.match(/<details[^>]*data-good-image-guide=""[^>]*>/)?.[0] ?? '';
    expect(guide).not.toBe('');
    expect(guide).not.toContain('open=""');
    expect(html.indexOf('data-good-image-guide')).toBeGreaterThan(html.indexOf('id="goods-image-upload-guidance"'));
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
    const html = render(['main', 'a', 'b', '', '']);
    const frames = html.match(/<label[^>]*data-draggable="true"[^>]*>/g) ?? [];
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(frame).toMatch(/\btouch-pan-y\b/);
      expect(frame).toMatch(/\btouch-pinch-zoom\b/);
      expect(frame).not.toMatch(/\btouch-none\b/);
    }
    /* touch-action:none(touch-none)은 끌기 손잡이 두 개에만 있다 — 대표 이미지·추가 타일·목록에는 없다. */
    const blocking = html.match(/<[a-z]+\b[^>]*\btouch-none\b[^>]*>/g) ?? [];
    expect(blocking).toHaveLength(2);
    for (const element of blocking) expect(element).toContain('data-image-handle=""');
  });

  it('빈 상품은 대표 이미지 추가와 이미지 추가 타일만 보여준다', () => {
    const html = render(['', '', '', '', '']);

    expect(html).toContain('aria-label="대표 이미지 추가"');
    expect(html).toContain('data-upload-state="empty"');
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html.match(/multiple=""/g)).toHaveLength(2);
  });

  it('추가 이미지 9장이 가득 차면 10개 타일을 모두 보여 주고 이미지 추가 타일은 숨긴다', () => {
    const gallery = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const html = render(['main', ...gallery]);

    expect(html.match(/<li /g)).toHaveLength(10);
    expect(render(['main', 'a', 'b', 'c', 'd'])).toContain('추가 이미지 4/9');
    expect(html).toContain('aria-label="추가 이미지 9 교체"');
    expect(html).toMatch(/aria-label="추가 이미지 9를 뒤로" disabled=""/);
    expect(html).not.toContain('이미지 추가 (추가 이미지');
    expect([...html.matchAll(/<input readOnly="" type="hidden" name="(galleryPath\d)" value="([^"]*)"\/>/g)].map(([, name, value]) => [name, value]))
      .toEqual(gallery.map((name, index) => [`galleryPath${index}`, path(name)]));
  });

  it('폼 오류 키(imagePath, galleryPath{i})를 해당 타일의 오류 문구와 파일 입력 설명에 연결한다', () => {
    const html = render(['', 'a', 'b', '', ''], { imagePath: '대표 이미지를 업로드한 뒤 공개해주세요.', galleryPath1: '같은 이미지를 갤러리에 두 번 넣을 수 없습니다.' });

    expect(html).toContain('id="imagePath-error" role="alert"');
    expect(html).toContain('대표 이미지를 업로드한 뒤 공개해주세요.');
    expect(html).toMatch(/aria-describedby="goods-image-upload-guidance imagePath-error" aria-invalid="true" aria-label="대표 이미지 추가"/);
    expect(html).toMatch(/aria-describedby="goods-image-upload-guidance galleryPath1-error" aria-invalid="true" aria-label="추가 이미지 2 교체"/);
    expect(html).toContain('data-invalid="true"');
  });
});
