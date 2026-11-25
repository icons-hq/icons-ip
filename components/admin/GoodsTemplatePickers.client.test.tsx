import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';

const actions = vi.hoisted(() => ({ sizes: vi.fn(), afterSales: vi.fn(), events: vi.fn() }));
vi.mock('@/app/admin/goods-size-chart-actions', () => ({ listGoodsSizeTemplatesAction: actions.sizes }));
vi.mock('@/app/admin/goods-after-sales-actions', () => ({ listGoodsAfterSalesTemplatesAction: actions.afterSales }));
vi.mock('@/app/admin/goods-benefit-actions', () => ({ listGoodsEventTemplatesAction: actions.events }));

import { AdminPickerDialog, type AdminPickerPanelProps } from './console/AdminPickerDialog';
import { GoodsAfterSalesTemplatePicker, afterSalesHasInput, afterSalesTemplateRowView, loadAfterSalesTemplates } from './GoodsAfterSalesTemplatePicker';
import { GoodsEventTemplatePicker, eventTemplateRowView, loadEventTemplates } from './GoodsEventTemplatePicker';
import { GoodsSizeTemplatePicker, loadSizeTemplates, sizeChartHasInput, sizeTemplateRowView } from './GoodsSizeTemplatePicker';
import { emptyGoodsSizeChart, type GoodsSizeChart, type GoodsSizeTemplate } from '@/lib/goods-size-chart';
import type { GoodsAfterSalesTemplate } from '@/lib/goods-after-sales';
import type { GoodsEventTemplate } from '@/lib/goods-benefits';

/* 상품등록·상품 패널·그룹 공통정보가 함께 쓰는 템플릿 선택창 3종(화면 규칙 1·2·7). 선택창은 훅이 없는 함수라 그 자리에서 불러 공용 선택창에 넘긴 값을 본다. */
type Dialog<T> = ReactElement<AdminPickerPanelProps<T> & { title: string }>;
const chart: GoodsSizeChart = { unit: 'cm', sizes: ['S', 'M'], measurements: [{ name: '가슴', values: ['50', '53'] }, { name: '총장', values: ['66', '68'] }], note: '' };
const size: GoodsSizeTemplate = { id: 's1', name: '반팔 티셔츠', chart, revision: 1, archived: false, createdAt: '2026-10-13T14:00:00Z', updatedAt: '2026-10-13T14:00:00Z' };
const afterSales: GoodsAfterSalesTemplate = { id: 'a1', phone: '1588-0000', guide: '접수: 고객센터로 전화해 주세요.\n처리 기간: 7일', sellerSpecialNotes: '', revision: 1, archived: false, createdAt: '2026-10-13T16:00:00Z' };
const event: GoodsEventTemplate = { id: 'e1', eventText: '연말 한정 증정', revision: 1, archived: false, createdAt: '2026-10-13T14:00:00Z' };
const page = <T,>(rows: T[], total = rows.length, at = 1) => ({ ok: true, value: { rows, total, page: at, pageSize: 20 } });
const request = (query = '', at = 1) => ({ query, field: '', filter: '', page: at });
const onSelect = vi.fn(), onClose = vi.fn();
let confirm: ReturnType<typeof stubAdminConfirm>;
beforeEach(() => { vi.clearAllMocks(); confirm = stubAdminConfirm(true); });
afterEach(() => { confirm.restore(); });

describe('조회', () => {
  it.each([
    ['사이즈', loadSizeTemplates, actions.sizes, size],
    ['A/S', loadAfterSalesTemplates, actions.afterSales, afterSales],
    ['이벤트', loadEventTemplates, actions.events, event],
  ] as const)('%s: 사용 중인 템플릿만 20개씩 읽고(보관한 템플릿은 조회에서 뺀다) 검색어의 앞뒤 공백을 뗀다', async (_name, load, action, row) => {
    action.mockResolvedValue(page([row], 41, 2));
    expect(await (load as (value: ReturnType<typeof request>) => Promise<unknown>)(request('  티셔츠 ', 2))).toEqual({ rows: [row], total: 41, page: 2, pageSize: 20 });
    expect(action).toHaveBeenCalledExactlyOnceWith('티셔츠', false, 2);
  });

  it('그사이 템플릿이 줄어 고른 쪽이 비었으면 마지막 쪽을 다시 읽고, 읽지 못하면 그 이유를 돌려준다', async () => {
    actions.sizes.mockResolvedValueOnce(page([], 20, 3)).mockResolvedValueOnce(page([size], 20, 1));
    expect(await loadSizeTemplates(request('', 3))).toEqual({ rows: [size], total: 20, page: 1, pageSize: 20 });
    expect(actions.sizes.mock.calls).toEqual([['', false, 3], ['', false, 1]]);
    actions.events.mockResolvedValue({ ok: false, error: '상품 관리 권한이 필요합니다.' });
    expect(await loadEventTemplates(request())).toEqual({ error: '상품 관리 권한이 필요합니다.' });
  });
});

describe('줄 모양', () => {
  it('사이즈는 이름 아래에 사이즈·측정 항목·단위를 보여 이름이 같은 템플릿도 구분된다', () => {
    expect(sizeTemplateRowView(size)).toEqual({ title: '반팔 티셔츠', meta: 'S, M · 가슴, 총장 · cm' });
  });
  it('A/S는 이름이 없어 안내 첫 줄과 전화번호·등록일(KST)로 알아본다', () => {
    expect(afterSalesTemplateRowView(afterSales)).toEqual({ title: '접수: 고객센터로 전화해 주세요.', meta: '1588-0000 · 2026.10.14 등록' });
    expect(afterSalesTemplateRowView({ ...afterSales, guide: '가'.repeat(40) }).title).toBe(`${'가'.repeat(30)}…`);
  });
  it('이벤트는 문구만 보인다', () => { expect(eventTemplateRowView(event)).toEqual({ title: '연말 한정 증정' }); });
});

describe('공용 선택창에 넘기는 값', () => {
  it('세 선택창 모두 같은 이름·같은 줄 버튼을 쓰고, 보관한 템플릿을 뺐다고 알린다', () => {
    const dialogs = [GoodsSizeTemplatePicker({ onClose, onSelect }), GoodsAfterSalesTemplatePicker({ onClose, onSelect }), GoodsEventTemplatePicker({ onClose, onSelect })] as Dialog<unknown>[];
    expect(dialogs.every(dialog => dialog.type === AdminPickerDialog)).toBe(true);
    expect(dialogs.map(dialog => dialog.props.title)).toEqual(['사이즈 템플릿 고르기', 'A/S 템플릿 고르기', '이벤트 템플릿 고르기']);
    for (const dialog of dialogs) {
      expect(dialog.props.selectLabel).toBeUndefined();
      expect(dialog.props.excludedNote).toBe('보관한 템플릿은 목록에서 뺐습니다.');
      expect(dialog.props.onClose).toBe(onClose);
      expect(String(dialog.props.description)).toMatch(/^고르면 .+ 바뀝니다\.$/);
    }
    expect((dialogs[0] as Dialog<GoodsSizeTemplate>).props.load).toBe(loadSizeTemplates);
    expect((dialogs[1] as Dialog<GoodsAfterSalesTemplate>).props.searchPlaceholder).toBe('전화번호·안내·특이사항으로 찾기');
  });
});

/* 화면 규칙 7: 고르면 적어 둔 값이 통째로 바뀐다. 적어 둔 값이 있을 때만 묻고, 취소하면 선택창을 그대로 둔다(false). */
describe('적어 둔 값을 바꾸기 전 확인', () => {
  const sizeDialog = (current?: GoodsSizeChart) => GoodsSizeTemplatePicker({ onClose, onSelect, current }) as Dialog<GoodsSizeTemplate>;
  const afterSalesDialog = (current?: { phone: string; guide: string; sellerSpecialNotes: string }) => GoodsAfterSalesTemplatePicker({ onClose, onSelect, current }) as Dialog<GoodsAfterSalesTemplate>;
  const eventDialog = (current?: string) => GoodsEventTemplatePicker({ onClose, onSelect, current }) as Dialog<GoodsEventTemplate>;

  it('사이즈표: 적어 둔 표가 있으면 어느 템플릿으로 바뀌는지 말하고, 빈 표·단위만 고른 표는 묻지 않는다', async () => {
    expect(await sizeDialog(chart).props.onSelect(size)).toBe(true);
    expect(confirm).toHaveBeenCalledExactlyOnceWith('지금 적어 둔 사이즈표가 ‘반팔 티셔츠’ 템플릿 내용으로 바뀝니다.');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(size);
    confirm.mockClear(); onSelect.mockClear();
    await sizeDialog({ ...emptyGoodsSizeChart(), unit: 'mm' }).props.onSelect(size); await sizeDialog().props.onSelect(size);
    expect(confirm).not.toHaveBeenCalled(); expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('취소하면 값을 바꾸지 않고 선택창을 그대로 둔다', async () => {
    confirm.restore(); confirm = stubAdminConfirm(false);
    expect(await sizeDialog(chart).props.onSelect(size)).toBe(false);
    expect(await afterSalesDialog({ phone: '', guide: '적어 둔 안내', sellerSpecialNotes: '' }).props.onSelect(afterSales)).toBe(false);
    expect(await eventDialog('적어 둔 문구').props.onSelect(event)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(3); expect(onSelect).not.toHaveBeenCalled();
  });

  it('A/S 안내: 세 칸 가운데 하나라도 적혀 있으면 묻는다', async () => {
    await afterSalesDialog({ phone: '02-123', guide: '', sellerSpecialNotes: '' }).props.onSelect(afterSales);
    expect(confirm).toHaveBeenCalledExactlyOnceWith('지금 적어 둔 A/S 전화번호·A/S 안내·판매자 특이사항이 ‘접수: 고객센터로 전화해 주세요.’ 템플릿 내용으로 바뀝니다.');
    confirm.mockClear();
    await afterSalesDialog({ phone: ' ', guide: '', sellerSpecialNotes: '' }).props.onSelect(afterSales);
    expect(confirm).not.toHaveBeenCalled(); expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('이벤트 문구: 다른 문구가 적혀 있을 때만 묻는다', async () => {
    await eventDialog('').props.onSelect(event); await eventDialog(' 연말 한정 증정 ').props.onSelect(event);
    expect(confirm).not.toHaveBeenCalled();
    await eventDialog('신년 증정').props.onSelect(event);
    expect(confirm).toHaveBeenCalledExactlyOnceWith('지금 적어 둔 이벤트 문구가 ‘연말 한정 증정’ 템플릿 내용으로 바뀝니다.');
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it('적어 둔 값이 있는지 판정', () => {
    expect(sizeChartHasInput(emptyGoodsSizeChart())).toBe(false);
    expect(sizeChartHasInput({ unit: 'cm', sizes: [''], measurements: [{ name: '', values: [''] }], note: ' ' })).toBe(false);
    expect(sizeChartHasInput({ unit: 'cm', sizes: [''], measurements: [{ name: '', values: ['42'] }], note: '' })).toBe(true);
    expect(sizeChartHasInput({ ...emptyGoodsSizeChart(), note: '단면 기준' })).toBe(true);
    expect(afterSalesHasInput({ phone: '', guide: '\n', sellerSpecialNotes: '' })).toBe(false);
    expect(afterSalesHasInput({ phone: '', guide: '', sellerSpecialNotes: '특이사항' })).toBe(true);
  });
});
