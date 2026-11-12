import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/admin/shopping-story-actions', () => ({ saveShoppingStoryAction: vi.fn(), searchShoppingStoryGoodsAction: vi.fn() }));
vi.mock('../ShoppingStoryBodyEditor', () => ({ ShoppingStoryBodyEditor: () => null }));

import { ShoppingStoryEditorScreen } from './ShoppingStoryEditorScreen';
import type { AdminShoppingStory, ShoppingStoryGoodOption } from '@/lib/admin/shopping-stories';

const good = (id: string, extra: Partial<ShoppingStoryGoodOption> = {}): ShoppingStoryGoodOption => ({
  id, name: `QA ${id}`, code: id.toUpperCase(), price: 10000, priceMax: 10000, compareAtPrice: null, showDiscountRate: false, imageBackground: '#eee',
  badge: null, soldOut: false, imageUrl: null, archived: false, published: true, ...extra,
});
const story: AdminShoppingStory = {
  id: '6f1c2a9e-3d4b-4c5d-8e6f-7a8b9c0d1e2f', reference: 3, title: 'QA 스토리', startsAt: null, endsAt: null, state: 'active', revision: 2,
  createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z', sectionCount: 1, goodCount: 5, bodyHtml: '<p>QA 스토리 본문입니다.</p>', imagePaths: [],
  sections: [{ id: '11111111-1111-4111-8111-111111111111', title: 'QA 추천', imageShape: 'square', goodIds: ['qa-pr1', 'qa-pr9', 'qa-old', 'qa-sold', 'qa-legacy'] }],
  goods: [good('qa-pr1', { visibility: 'public' }), good('qa-pr9', { name: 'QA 초안 상품', published: false, visibility: 'draft' }), good('qa-old', { archived: true, published: false, visibility: 'archived' }),
    good('qa-sold', { soldOut: true, visibility: 'public' }), good('qa-legacy', { published: false })],
};

describe('쇼핑스토리 관련상품(QA1 MD)', () => {
  it('초안·보관 상품을 목록에 이유 배지로 표시하고, 품절은 지금처럼 꼬리표로 남긴다', () => {
    const html = renderToStaticMarkup(<ShoppingStoryEditorScreen accountId="11111111-1111-4111-8111-111111111111" draftId={story.id} initial={story} />);
    const row = (code: string) => html.match(new RegExp(`<li[^>]*>(?:(?!</li>).)*${code} · (?:(?!</li>).)*</li>`))?.[0] ?? '';
    expect(row('QA-PR1')).not.toContain('data-good-visibility');
    expect(row('QA-PR9')).toMatch(/data-good-visibility="draft"[^>]*>.*초안<\/span>공개 전까지 고객 화면에 보이지 않습니다\./);
    expect(row('QA-OLD')).toMatch(/보관됨<\/span>보관된 상품이라 고객 화면에 보이지 않습니다\./);
    expect(row('QA-SOLD')).toContain('10,000원 · 품절');
    /* 이유를 싣지 않은 옛 응답은 이유를 지어내지 않는다. */
    expect(row('QA-LEGACY')).toMatch(/고객 화면 미노출<\/span>고객 화면에 보이지 않습니다\./);
    expect(html).not.toContain('비공개');
  });
  it('저장 결과 자리는 하단 저장 막대 안이다 — 결과가 없으면 비어 있다', () => {
    const html = renderToStaticMarkup(<ShoppingStoryEditorScreen accountId="11111111-1111-4111-8111-111111111111" draftId={story.id} initial={story} />);
    const bar = html.match(/<div[^>]*data-admin-savebar=""[^>]*>[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(bar).toContain('>저장</button>');
    expect(html).not.toContain('data-story-save-message');
  });
});
