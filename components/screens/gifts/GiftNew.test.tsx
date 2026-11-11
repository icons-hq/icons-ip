import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/lib/cart';
import type { Good } from '@/lib/data';
import { GiftNew } from './GiftNew';

const cart = vi.hoisted(() => ({ items: [] as CartItem[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/gifts/actions', () => ({ createGiftAction: vi.fn() }));
vi.mock('@/components/shell/CartProvider', () => ({ useCart: () => ({ ready: true, items: cart.items }) }));
vi.mock('@/components/wc/MypageShell', () => ({ MypageShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/components/gifts/useGiftRequest', () => ({
  useGiftRequest: () => ({ blocked: false, locked: false, pending: false, failure: null, retry: vi.fn(), run: vi.fn() }),
  useGiftUnsaved: () => undefined,
}));

const SELECT_KEY = '93942000-0000-4000-8000-000000000101', RANDOM_KEY = '93942000-0000-4000-8000-000000000201';
const base = { ip: 'hong-sil-quest', type: '아크릴', price: 12000, badge: null, stock: 'ok', stockQty: 20, img: 'none' } as const;
const goods: Good[] = [
  { ...base, id: 'select-good', name: '아크릴 블록', optionSaleMode: 'select',
    options: [{ id: SELECT_KEY, name: '빨강', code: 'R', price: 12000, stockQty: 20, isDefault: true, attributes: {} }] },
  /* 카탈로그는 랜덤 판매 굿즈의 옵션을 기본 옵션 키 하나('랜덤')로 접는다. */
  { ...base, id: 'random-good', name: '랜덤 포토카드', optionSaleMode: 'random',
    options: [{ id: RANDOM_KEY, name: '랜덤', code: '', price: 12000, stockQty: 9, isDefault: true, attributes: {} }] },
];

describe('GiftNew — 랜덤 판매 굿즈(m27 CUST-1)', () => {
  it('랜덤 판매 굿즈 줄은 고를 수 없고 이유를 보인다', () => {
    cart.items = [{ goodId: 'select-good', variantId: SELECT_KEY, qty: 1 }, { goodId: 'random-good', variantId: RANDOM_KEY, qty: 2 }];
    const html = renderToStaticMarkup(<GiftNew actorId="93942000-0000-4000-8000-000000000001" goods={goods} available />);
    const rows = [...html.matchAll(/<li>(.*?)<\/li>/g)].map(match => match[1]);
    const selectRow = rows.find(row => row.includes('아크릴 블록'))!, randomRow = rows.find(row => row.includes('랜덤 포토카드'))!;
    expect(selectRow).not.toMatch(/<input[^>]*disabled/);
    expect(selectRow).not.toContain('선물할 수 없어요');
    expect(randomRow).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    expect(randomRow).toContain('랜덤 판매 굿즈는 선물할 수 없어요.');
    /* 이유는 체크박스의 설명으로 이어진다. */
    const describedBy = /<input[^>]*aria-describedby="([^"]+)"/.exec(randomRow)?.[1];
    expect(describedBy).toBeTruthy();
    expect(randomRow).toContain(`id="${describedBy}"`);
  });
});
