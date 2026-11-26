import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { GoodsBenefitValues } from '@/lib/goods-benefits';

vi.mock('@/app/admin/goods-benefit-actions', () => ({ saveGoodsBenefitsAction: vi.fn(), loadGoodsBenefitsAction: vi.fn(), listGoodsEventTemplatesAction: vi.fn(), saveGoodsEventTemplateAction: vi.fn() }));
vi.mock('@/lib/media', () => ({ publicMediaUrl: (path: string) => `https://cdn.example/${path}` }));
import { GoodsBenefitFields } from './GoodsBenefitsPanel';

/* 입력 부품은 훅이 없는 함수라 그 자리에서 불러 같은 입력을 찾는다. */
type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const textOf = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? textOf(value.props.children as ReactNode) : String(value)).join('');
const render = (values: GoodsBenefitValues) => nodes(GoodsBenefitFields({ values, onChange: () => {}, onPickPhoto: () => {}, onOpenTemplates: () => {} }));
const photoNote = (values: GoodsBenefitValues) => render(values).find(node => node.type === 'p')!;

describe('사은품·이벤트 입력', () => {
  it('긴 안내 문단 두 개 대신 칸 이름·예시 글·한 줄 안내로 말한다', () => {
    const tree = render({ eventText: '', giftText: '', giftImagePaths: [] });
    const labels = tree.filter(node => node.type === 'label').map(node => textOf(node.props.children as ReactNode));
    expect(labels[0]).toContain('사은품 설명');
    expect(labels[1]).toContain('이벤트 문구');
    expect(labels[1]).toContain('상품 검색에는 쓰이지 않습니다.');
    expect(tree.filter(node => node.type === 'input').map(node => node.props.placeholder)).toEqual(['예: 아크릴 키링 1개', '예: 연말 한정 증정']);
    expect(tree.filter(node => node.type === 'p').map(node => textOf(node))).toEqual(['사진은 최대 3장, 500×500 크기를 권장합니다.']);
  });

  it('템플릿을 여는 버튼은 누르면 일어나는 일을 말한다(이벤트 템플릿 고르기)', () => {
    const onOpenTemplates = vi.fn();
    const tree = nodes(GoodsBenefitFields({ values: { eventText: '', giftText: '', giftImagePaths: [] }, onChange: () => {}, onPickPhoto: () => {}, onOpenTemplates }));
    const labels = tree.filter(node => node.type === 'button').map(node => textOf(node.props.children as ReactNode));
    expect(labels).toContain('이벤트 템플릿 고르기'); expect(labels).not.toContain('이벤트 템플릿');
    (tree.find(node => node.type === 'button' && textOf(node.props.children as ReactNode) === '이벤트 템플릿 고르기')!.props.onClick as () => void)();
    expect(onOpenTemplates).toHaveBeenCalledOnce();
  });

  it('사진을 올렸는데 사은품 설명이 비어 있을 때만 설명도 적으라고 그 자리에서 알린다', () => {
    const none = photoNote({ eventText: '', giftText: '', giftImagePaths: [] });
    expect(textOf(none)).toBe('사진은 최대 3장, 500×500 크기를 권장합니다.');
    expect(none.props['data-good-benefit-photo-note']).toBeUndefined();
    const missing = photoNote({ eventText: '', giftText: '  ', giftImagePaths: ['public-media/catalog/good/a.webp'] });
    expect(textOf(missing)).toBe('사진을 올렸으니 사은품 설명도 적어 주세요.');
    expect(missing.props['data-good-benefit-photo-note']).toBe('needs-text');
    expect(textOf(photoNote({ eventText: '', giftText: '키링', giftImagePaths: ['public-media/catalog/good/a.webp'] }))).toBe('사진은 최대 3장, 500×500 크기를 권장합니다.');
  });
});
