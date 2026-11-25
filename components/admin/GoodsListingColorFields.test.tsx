import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { STORE_PRESENTATION_PATH } from '@/lib/store-presentation';
import { GoodsListingColorFields } from './GoodsListingColorsPanel';

vi.mock('@/app/admin/store-presentation-actions', () => ({ loadGoodsListingColorsAction: vi.fn(), saveGoodsListingColorsAction: vi.fn() }));

const render = (colors: { label: string; hex: string }[]) => renderToStaticMarkup(<GoodsListingColorFields colors={colors} onChange={() => {}} />);

describe('목록 색상칩 입력', () => {
  it('이름을 적은 색은 상품 카드의 색 점 모양으로 바로 보인다', () => {
    const html = render([{ label: '블랙', hex: '#111111' }, { label: '아이보리', hex: '#f5f0e6' }, { label: '', hex: '#ff0000' }]);
    const preview = html.slice(html.indexOf('data-good-listing-color-preview'));
    expect(preview).toContain('aria-label="상품 색상"');
    /* 실제 ProductCard 색 점(14px 원)과 같은 모양이고, 이름이 없는 줄은 저장되지 않으므로 점으로 그리지 않는다. */
    expect(preview.match(/size-3\.5 rounded-full/g)).toHaveLength(2);
    expect(preview).toContain('style="background-color:#111111"');
    expect(preview).toContain('style="background-color:#f5f0e6"');
    expect(preview).not.toContain('#ff0000');
    expect(preview).toContain('title="블랙"');
  });

  it('색이 하나도 없으면 미리보기를 그리지 않는다', () => {
    expect(render([])).not.toContain('data-good-listing-color-preview');
    expect(render([{ label: ' ', hex: '#000000' }])).not.toContain('data-good-listing-color-preview');
  });

  it('칸 이름은 "색 이름"과 "색"이고 이름 칸에 예시 글이 있다', () => {
    const html = render([{ label: '블랙', hex: '#000000' }]);
    expect(html).toMatch(/<label[^>]*>색 이름<span class="sr-only"> 1<\/span>/);
    expect(html).toMatch(/<label[^>]*>색<span class="sr-only"> 1<\/span>/);
    expect(html).toContain('placeholder="예: 블랙"');
    expect(html).not.toContain('색상값');
    expect(html).toContain('색상 추가 (1/20)');
  });

  it('고객 화면의 상품 목록에는 전시 설정에서 컬러칩 표시를 켜야 보인다는 사실을 한 줄과 이동 링크로 말한다', () => {
    for (const html of [render([]), render([{ label: '블랙', hex: '#000000' }])]) {
      expect(html).toContain('고객 화면의 상품 목록에는 전시 설정에서 ‘컬러칩 표시’를 켜야 보입니다.');
      expect(html).toMatch(new RegExp(`<a[^>]*href="${STORE_PRESENTATION_PATH}"[^>]*target="_blank"[^>]*>전시 설정 열기 ↗</a>`));
    }
  });
});
