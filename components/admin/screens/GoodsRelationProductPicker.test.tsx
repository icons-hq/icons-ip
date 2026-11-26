import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoodsRelationGood, GoodsRelationGoodVisibility } from '@/lib/admin/goods-relations';
import type { AdminPickerPanelProps } from '../console/AdminPickerDialog';

const mocks = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock('@/app/admin/goods-relation-actions', () => ({ findGoodsForRelationAction: mocks.find, saveGoodsRelationAction: vi.fn() }));
import { AdminPickerDialog } from '../console/AdminPickerDialog';
import { GoodsRelationProductPicker, relationGoodRowView, relationGoodsLoader } from './GoodsRelationProductPicker';

const good = (id: string, visibility: GoodsRelationGoodVisibility = 'public'): GoodsRelationGood =>
  ({ id, name: `상품 ${id}`, code: `SKU-${id}`, imagePath: null, public: visibility === 'public' || visibility === 'restricted', visibility });
function panel(props: Partial<Parameters<typeof GoodsRelationProductPicker>[0]> = {}) {
  const element = GoodsRelationProductPicker({ value: [good('a'), good('b')], limit: 3, onAdd: vi.fn(), onRemove: vi.fn(), onClose: vi.fn(), ...props }) as ReactElement<AdminPickerPanelProps<GoodsRelationGood> & { title: string }>;
  expect(element.type).toBe(AdminPickerDialog);
  return element.props;
}
beforeEach(() => { vi.clearAllMocks(); });

describe('연관상품 상품 고르기(R2)', () => {
  it('공용 선택창을 여러 개 고르기로 쓰고 담은 상품을 선택됨으로 보인다', () => {
    const onAdd = vi.fn(), onRemove = vi.fn();
    const props = panel({ onAdd, onRemove });
    expect(props).toMatchObject({ title: '상품 고르기', multiple: true, showImages: true, selectedKeys: ['a', 'b'], excludedNote: '보관한 상품은 목록에서 뺐습니다.' });
    expect(props.description).toBe('2개 담았습니다. 3개까지 담을 수 있습니다.');
    props.onSelect(good('c')); props.onDeselect?.(good('a'));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith(good('c')); expect(onRemove).toHaveBeenCalledExactlyOnceWith(good('a'));
  });

  it('한도까지 담으면 나머지 줄은 고를 수 없고 담은 줄은 뺄 수 있다', () => {
    expect(panel().rowBlocked?.(good('c'))).toBeNull();
    const full = panel({ value: [good('a'), good('b'), good('c')] });
    expect(full.rowBlocked?.(good('d'))).toBe('3개를 모두 담았습니다');
    expect(full.rowBlocked?.(good('a'))).toBeNull();
  });

  it('줄마다 편집 화면과 같은 게시 상태를 보이고 내부 값은 보이지 않는다', () => {
    expect(relationGoodRowView(good('internal-id', 'draft'))).toEqual({ title: '상품 internal-id', meta: 'SKU-internal-id · 초안', imageUrl: null });
    expect(relationGoodRowView(good('a', 'restricted')).meta).toBe('SKU-a · 공개 · 성인 인증 고객에게만');
    expect(relationGoodRowView(good('a', 'restricted'), true).meta).toBe('SKU-a · 공개 · 성인 상품 · 모든 고객에게 숨김');
    expect(panel({ adultGoodsHidden: true }).rowView(good('a', 'restricted')).meta).toContain('모든 고객에게 숨김');
  });

  it('검색어 한 칸으로 찾고, 상품 페이지 주소를 붙여 넣으면 주소 끝 값으로 찾는다', async () => {
    const page = { rows: [good('a')], total: 1, page: 2, pageSize: 20 as const };
    mocks.find.mockResolvedValue({ data: page });
    expect(await relationGoodsLoader({ query: '머그', field: '', filter: '', page: 2 })).toBe(page);
    expect(mocks.find).toHaveBeenLastCalledWith('머그', 2);
    await relationGoodsLoader({ query: ' https://xsquare.kr/shop/hsq-0059 ', field: '', filter: '', page: 1 });
    expect(mocks.find).toHaveBeenLastCalledWith('hsq-0059', 1);
    // 다른 사이트 주소는 주소로 읽지 않고 적은 그대로 찾는다(결과가 없으면 선택창이 빈 목록을 보인다).
    await relationGoodsLoader({ query: 'https://example.com/shop/hsq-0059', field: '', filter: '', page: 1 });
    expect(mocks.find).toHaveBeenLastCalledWith('https://example.com/shop/hsq-0059', 1);
    mocks.find.mockResolvedValue({ error: '상품 목록을 불러오지 못했습니다. 잠시 뒤 다시 검색해 주세요.' });
    expect(await relationGoodsLoader({ query: '', field: '', filter: '', page: 1 })).toEqual({ error: '상품 목록을 불러오지 못했습니다. 잠시 뒤 다시 검색해 주세요.' });
  });
});
