import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GoodsGalleryFields } from './GoodsGalleryFields';

describe('굿즈 갤러리 업로드 표면', () => {
  it('shows slot role and order while giving the shared file guidance once', () => {
    const html = renderToStaticMarkup(<GoodsGalleryFields
      galleryPaths={[
        'public-media/catalog/good/11111111-1111-4111-8111-111111111111.webp',
        '',
        '',
        '',
      ]}
      galleryUrls={['https://cdn.example/gallery-1.webp', '', '', '']}
      onPreviewChange={() => undefined}
      state={{}}
    />);

    expect(html).toContain('갤러리 (최대 4장)');
    expect(html).toContain('공통 파일 규격: JPEG, PNG, WebP');
    expect(html.match(/공통 파일 규격: JPEG, PNG, WebP/g)?.length).toBe(1);
    expect(html.match(/aria-describedby="goods-gallery-upload-guidance"/g)?.length).toBe(4);
    expect(html).toContain('슬롯 1 · 갤러리 1');
    expect(html).toContain('상세페이지 노출 순서 4');
    expect(html).toContain('현재 연결됨');
    expect(html).toContain('비어 있음');
    expect(html).toContain('name="galleryPath0"');
    expect(html).toContain('value="public-media/catalog/good/11111111-1111-4111-8111-111111111111.webp"');
    expect(html).toContain('상품 저장 후 공개 반영은 별도');
  });
});
