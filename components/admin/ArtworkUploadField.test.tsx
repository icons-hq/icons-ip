import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ArtworkUploadField,
  clearArtworkDisplayState,
  commitSelectedArtworkPreview,
  createArtworkDisplayState,
  restoreCommittedArtworkPreview,
  showSelectedArtworkPreview,
} from './ArtworkUploadField';

vi.mock('../../lib/admin/artwork-upload.client', () => ({
  uploadAdminArtwork: vi.fn(),
}));

describe('ArtworkUploadField', () => {
  it('preserves the current path and renders the current public preview for replacement', () => {
    const html = renderToStaticMarkup(
      <ArtworkUploadField
        currentPath="public-media/catalog/ip/11111111-1111-4111-8111-111111111111.webp"
        currentUrl="https://cdn.example/catalog/ip/current.webp"
        helpText="IP 키아트는 가로형 이미지를 사용해주세요."
        kind="ip"
      />,
    );

    expect(html).toContain('data-artwork-kind="ip"');
    expect(html).toContain('name="imagePath"');
    expect(html).toContain('value="public-media/catalog/ip/11111111-1111-4111-8111-111111111111.webp"');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain('src="https://cdn.example/catalog/ip/current.webp"');
    expect(html).toContain('alt="현재 아트워크 미리보기"');
    expect(html).toContain('이미지 교체');
    expect(html).toContain('IP 키아트는 가로형 이미지를 사용해주세요.');
    expect(html).toContain('JPEG, PNG, WebP · 최대 5MB · 가로·세로 최대 8192px · 총 4,000만 픽셀 이하 · 애니메이션 제외');
    expect(html).toContain('aria-describedby="ip-artwork-help ip-artwork-guidance"');
    expect(html).toContain('id="ip-artwork-help"');
    expect(html).toContain('id="ip-artwork-guidance"');
    expect(html).toContain('선택 취소');
    expect(html).toContain('flex-wrap:wrap');
    expect(html).toContain('admin-artwork-layout');
    expect(html).toContain('admin-artwork-preview');
    expect(html).toContain('admin-artwork-controls');
    expect(html).toContain('admin-artwork-actions');
  });

  it('renders an empty upload state without inventing an image path', () => {
    const html = renderToStaticMarkup(
      <ArtworkUploadField currentPath={null} currentUrl={null} kind="event" />,
    );

    expect(html).toContain('data-artwork-kind="event"');
    expect(html).toContain('name="imagePath"');
    expect(html).toContain('value=""');
    expect(html).not.toContain('<img');
    expect(html).toContain('이미지 업로드');
  });

  it('uses a 16:9 preview for home curation artwork', () => {
    const html = renderToStaticMarkup(
      <ArtworkUploadField currentPath={null} currentUrl={null} kind="curation" />,
    );

    expect(html).toContain('data-artwork-kind="curation"');
    expect(html).toContain('aspect-ratio:16 / 9');
  });

  it('lets an opted-in optional artwork clear the exact imagePath form payload', () => {
    const currentPath = 'public-media/catalog/curation/123e4567-e89b-42d3-a456-426614174000.webp';
    const html = renderToStaticMarkup(
      <ArtworkUploadField
        allowRemove
        currentPath={currentPath}
        currentUrl="https://cdn.example/catalog/curation/current.webp"
        kind="curation"
      />,
    );
    const removed = clearArtworkDisplayState(createArtworkDisplayState(
      currentPath,
      'https://cdn.example/catalog/curation/current.webp',
    ));
    const submitted = new FormData();
    submitted.set('imagePath', removed.imagePath);

    expect(html).toContain('>이미지 제거</button>');
    expect(removed).toEqual({
      committedAlt: '현재 아트워크 미리보기',
      committedUrl: null,
      imagePath: '',
      previewAlt: '현재 아트워크 미리보기',
      previewUrl: null,
    });
    expect(Object.fromEntries(submitted)).toEqual({ imagePath: '' });
  });

  it('does not offer removal to existing artwork consumers unless they opt in', () => {
    const html = renderToStaticMarkup(
      <ArtworkUploadField
        currentPath="public-media/catalog/ip/123e4567-e89b-42d3-a456-426614174000.webp"
        currentUrl="https://cdn.example/catalog/ip/current.webp"
        kind="ip"
      />,
    );

    expect(html).not.toContain('>이미지 제거</button>');
  });

  it('restores the latest committed upload instead of the original after a replacement fails', () => {
    const initial = createArtworkDisplayState(
      'public-media/catalog/ip/123e4567-e89b-42d3-a456-426614174000.png',
      'https://cdn.example/original.png',
    );
    const selectedFirst = showSelectedArtworkPreview(initial, 'blob:first');
    const committedFirst = commitSelectedArtworkPreview(
      selectedFirst,
      'public-media/catalog/ip/223e4567-e89b-42d3-a456-426614174000.png',
    );
    const selectedSecond = showSelectedArtworkPreview(committedFirst, 'blob:second');

    expect(restoreCommittedArtworkPreview(selectedSecond)).toEqual({
      committedAlt: '업로드된 아트워크 미리보기',
      committedUrl: 'blob:first',
      imagePath: 'public-media/catalog/ip/223e4567-e89b-42d3-a456-426614174000.png',
      previewAlt: '업로드된 아트워크 미리보기',
      previewUrl: 'blob:first',
    });
  });

  it('marks the file input as requiring upload before the outer form may save', () => {
    const html = renderToStaticMarkup(
      <ArtworkUploadField currentPath={null} currentUrl={null} kind="card" />,
    );

    expect(html).toContain('data-upload-validity-message="이미지를 먼저 업로드해주세요."');
    const fileInput = html.match(/<input[^>]*class="admin-artwork-input"[^>]*>/)?.[0];
    expect(fileInput).toBeDefined();
    expect(fileInput).not.toContain('disabled');
  });
});
