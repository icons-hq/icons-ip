import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { GoodsRelation, GoodsRelationGood, GoodsRelationGoodVisibility, GoodsRelationList } from '@/lib/admin/goods-relations';
import { ConsoleFilterPanel, ConsoleGrid, type ConsoleGridProps } from '../console';
import { AdminPageHeader } from '../console/AdminKit';
import { GoodsRelationsScreen } from './GoodsRelationsScreen';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => !isValidElement<Record<string, unknown>>(value) ? [] : [value, ...nodes(value.props.children as ReactNode)]);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const good = (id: string, visibility: GoodsRelationGoodVisibility = 'public'): GoodsRelationGood =>
  ({ id, name: `상품 ${id}`, code: `SKU-${id}`, imagePath: null, public: visibility === 'public' || visibility === 'restricted', visibility });
const relation = (index: number, patch: Partial<GoodsRelation>): GoodsRelation => ({
  id: `99040000-0000-4000-8000-${String(index).padStart(12, '0')}`, kind: 'similar', title: `연관 ${index}`, representativeGoodId: 'a', enabled: true,
  startsAt: null, endsAt: null, revision: 1, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z', state: 'active', goods: [good('a'), good('b')], visual: null, ...patch,
});
const data: GoodsRelationList = { total: 4, filters: { query: '', kind: 'all', state: 'all', page: 1, pageSize: 20 }, rows: [
  relation(1, {}),
  relation(2, { state: 'stopped', enabled: false }),
  relation(3, { goods: [good('a'), good('b'), good('c', 'restricted')] }),
  relation(4, { goods: [good('a', 'draft'), good('b'), good('c')] }),
] };
function screen(adultGoodsHidden = false) {
  const tree = nodes(GoodsRelationsScreen({ data, adultGoodsHidden }));
  const grid = tree.find(node => node.type === ConsoleGrid)!.props as unknown as ConsoleGridProps;
  const customer = grid.columns.findIndex(column => column.key === 'customer');
  return { tree, grid, customer: grid.rows.map(row => text(row.cells[customer])) };
}

describe('연관상품 목록', () => {
  it("'고객 화면' 칸이 줄마다 보이는지와 안 보이는 까닭을 말한다(R8)", () => {
    const { grid, customer } = screen();
    expect(grid.columns.map(column => column.label)).toEqual(['노출 제목', '유형', '대표 상품', '전시상태', '고객 화면', '담은 상품', '전시 기간', '수정일']);
    expect(customer).toEqual(['보임상품 2개 상세', '안 보임전시중지', '보임상품 3개 상세 · 1개는 성인 인증 고객에게만', '안 보임대표 상품이 초안']);
  });

  it('성인 상품을 모든 고객에게 숨겨 둔 동안에는 판매 제한 상품을 세지 않는다(R1)', () => {
    expect(screen(true).customer[2]).toBe('보임상품 2개 상세');
  });

  it('조건 설명 대신 한 줄 소개만 두고 검색 칸은 내부 번호를 말하지 않는다(R5·R7·R8)', () => {
    const { tree, grid } = screen();
    const header = tree.find(node => node.type === AdminPageHeader)!.props;
    expect(header.description).toBe('상품 상세에서 다른 상품을 소개합니다. 장바구니에 함께 담는 추가구성상품과는 다릅니다.');
    expect((tree.find(node => node.type === ConsoleFilterPanel)!.props.search as { label: string }).label).toBe('노출 제목·상품명·상품 자동코드');
    expect(grid.caption).toBe('연관상품 목록');
    expect(text(tree)).not.toMatch(/편성|노출 기간/);
  });
});
