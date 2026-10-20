import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GoodRelatedProducts } from './GoodRelatedProducts';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
describe('연관상품 공개 목록', () => {
  it('지정 제목·가격·상세 링크를 보여주며 구매 입력을 만들지 않는다', () => {
    const html = renderToStaticMarkup(<GoodRelatedProducts data={{ nextChangeAt: null, groups: [{ id: 'group-a', kind: 'similar', title: '유사한 굿즈', goods: [{ id: 'good-b', name: '연관 굿즈', ip: 'ip', type: '문구', price: 3000, priceMax: 5000, badge: null, img: '', stock: 'ok', stockQty: 5 }] }] }} />);
    expect(html).toContain('유사한 굿즈'); expect(html).toContain('href="/shop/good-b"'); expect(html).toContain('₩3,000 ~ ₩5,000');
    expect(html).not.toContain('<form'); expect(html).not.toContain('장바구니');
  });
  it('비어 있으면 영역을 숨기고 읽기 실패는 별도로 알린다', () => {
    expect(renderToStaticMarkup(<GoodRelatedProducts data={{ groups: [], nextChangeAt: null }} />)).toBe('');
    expect(renderToStaticMarkup(<GoodRelatedProducts data={{ groups: [], nextChangeAt: null, unavailable: true }} />)).toContain('불러오지 못했습니다');
  });
});
