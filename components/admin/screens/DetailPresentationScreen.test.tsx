import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

vi.mock('@/app/admin/product-detail-presentation-actions', () => ({ saveDetailPresentationAction: vi.fn() }));
import { DEFAULT_DETAIL_PRESENTATION } from '@/lib/product-detail-presentation';
import { DetailPresentationScreen } from './DetailPresentationScreen';

/* 화면에서 제일 튀던 파란 안내 상자는 내용이 '각각 저장합니다'뿐이었다 — 저장 버튼 옆 글자로 내리고, 켜짐 여부를 상태 배지로 올린다. */
it('탭과 카드에 고객 화면 노출 상태를 배지로 보이고 저장 안내는 상자로 띄우지 않는다', () => {
  const values = structuredClone(DEFAULT_DETAIL_PRESENTATION);
  values.banner.enabled = true;
  const html = renderToStaticMarkup(<DetailPresentationScreen categories={[]} goods={[]} section="banner" snapshot={{ values, revisions: { banner: 0, modules: 0, otherComposition: 0 } }} />);
  expect(html).toMatch(/data-tone="success"[^>]*>켜짐<\/span>/);
  expect(html).toMatch(/data-tone="success"[^>]*>고객 화면에 노출 중<\/span>/);
  expect(html).toContain('이 탭의 설정만 저장합니다');
  expect(html).not.toContain('data-admin-notice');
});
