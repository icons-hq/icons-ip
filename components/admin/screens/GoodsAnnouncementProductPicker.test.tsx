import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GOODS_ANNOUNCEMENT_GOOD_LIMIT, type GoodsAnnouncementGood } from '@/lib/admin/goods-announcements';
import type { AdminPickerPanelProps } from '../console/AdminPickerDialog';

const mocks = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock('@/app/admin/goods-announcement-actions', () => ({ findGoodsForAnnouncementAction: mocks.find }));
import { AdminPickerDialog } from '../console/AdminPickerDialog';
import { GoodsAnnouncementProductPicker, goodsAnnouncementPickerLoader } from './GoodsAnnouncementProductPicker';

const good = (index: number): GoodsAnnouncementGood => ({ id: `good-${index}`, name: `상품 ${index}`, code: `GC-${String(index).padStart(4, '0')}`, archived: false });
type PickerProps = AdminPickerPanelProps<GoodsAnnouncementGood> & { title: string };
/** 선택창에 넘긴 값. 공용 선택창 자체의 동작은 그쪽 시험이 맡는다. */
function pickerProps(value: GoodsAnnouncementGood[], handlers: Partial<Pick<PickerProps, 'onSelect' | 'onDeselect' | 'onClose'>> = {}) {
  const element = GoodsAnnouncementProductPicker({ value, onSelect: vi.fn(), onDeselect: vi.fn(), onClose: vi.fn(), ...handlers }) as ReactElement<PickerProps>;
  expect(isValidElement(element) && element.type === AdminPickerDialog).toBe(true);
  return element.props;
}
beforeEach(() => { vi.clearAllMocks(); });

describe('상품공지사항의 상품 고르기', () => {
  /* 공지 화면은 공지 권한으로 열린다. 상품 조회 권한을 보는 공용 상품 조회가 아니라 공지 전용 조회를 선택창에 잇는다. */
  it('공용 선택창의 조회를 공지 전용 상품 조회로 잇고 오류는 창 안에 보이게 넘긴다', async () => {
    const page = { rows: [good(1)], total: 21, page: 2, pageSize: 20 };
    mocks.find.mockResolvedValueOnce({ data: page }).mockResolvedValueOnce({ error: '관리자 권한이 필요합니다.' });
    expect(await goodsAnnouncementPickerLoader({ query: ' 키링 ', field: '', filter: '', page: 2 })).toEqual(page);
    expect(mocks.find).toHaveBeenCalledWith(' 키링 ', 2);
    expect(await goodsAnnouncementPickerLoader({ query: '', field: '', filter: '', page: 1 })).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(pickerProps([]).load).toBe(goodsAnnouncementPickerLoader);
  });

  it('여러 개를 고르는 공용 선택창이고 줄에는 이름과 상품 자동코드만 보인다', () => {
    const select = vi.fn(), deselect = vi.fn();
    const props = pickerProps([good(1)], { onSelect: select, onDeselect: deselect });
    expect(props).toMatchObject({ title: '상품 고르기', multiple: true, selectedKeys: ['good-1'], excludedNote: '보관한 상품은 목록에서 뺐습니다.' });
    expect(props.rowKey(good(2))).toBe('good-2');
    expect(props.rowView(good(2))).toEqual({ title: '상품 2', meta: 'GC-0002' });
    props.onSelect(good(2)); props.onDeselect!(good(1));
    expect(select).toHaveBeenCalledWith(good(2)); expect(deselect).toHaveBeenCalledWith(good(1));
    expect(props.rowBlocked).toBeUndefined();
  });

  it('최대 개수를 채우면 아직 고르지 않은 줄만 막고 이유를 보인다', () => {
    const full = Array.from({ length: GOODS_ANNOUNCEMENT_GOOD_LIMIT }, (_, index) => good(index));
    const props = pickerProps(full);
    expect(props.rowBlocked!(good(GOODS_ANNOUNCEMENT_GOOD_LIMIT + 1))).toBe(`최대 ${GOODS_ANNOUNCEMENT_GOOD_LIMIT}개까지`);
    expect(props.rowBlocked!(good(0))).toBeNull();
  });
});
