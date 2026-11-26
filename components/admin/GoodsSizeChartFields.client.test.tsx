import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';

vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useId: () => ':size-fields:' }));
import { GoodsSizeChartFields } from './GoodsSizeChartFields';
import type { GoodsSizeChart } from '@/lib/goods-size-chart';

/* 입력 부품은 useId만 쓰는 함수라 그 자리에서 불러 같은 버튼을 찾는다. */
type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const onChange = vi.fn();
const click = (chart: GoodsSizeChart, label: string) => (nodes(GoodsSizeChartFields({ chart, onChange })).find(node => node.type === 'button' && node.props['aria-label'] === label)!.props.onClick as () => void)();
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const chart: GoodsSizeChart = { unit: 'cm', sizes: ['S', 'M'], measurements: [{ name: '가슴', values: ['50', '53'] }, { name: '총장', values: ['', '68'] }], note: '' };
let confirm: ReturnType<typeof stubAdminConfirm>;
beforeEach(() => { onChange.mockReset(); confirm = stubAdminConfirm(true); });
afterEach(() => { confirm.restore(); });

/* 화면 규칙 7: 적어 둔 치수가 사라지는 삭제는 몇 개가 사라지는지 먼저 말한다. 치수가 없으면 묻지 않는다. */
describe('사이즈표의 사이즈·측정 항목 삭제', () => {
  it('사이즈를 지울 때 그 열에 적어 둔 치수 개수를 말하고 확인받는다', async () => {
    click(chart, '사이즈 2 삭제'); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('‘M’ 사이즈의 치수 2개가 사라집니다.');
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...chart, sizes: ['S'], measurements: [{ name: '가슴', values: ['50'] }, { name: '총장', values: [''] }] });
  });

  it('측정 항목을 지울 때 그 줄에 적어 둔 치수 개수를 말하고, 취소하면 지우지 않는다', async () => {
    confirm.restore(); confirm = stubAdminConfirm(false);
    click(chart, '측정 항목 2 삭제'); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('‘총장’ 항목의 치수 1개가 사라집니다.');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('치수를 적지 않은 열·줄은 묻지 않고 지운다', async () => {
    const blank: GoodsSizeChart = { ...chart, measurements: [{ name: '가슴', values: ['50', ' '] }, { name: '', values: ['', ''] }] };
    click(blank, '사이즈 2 삭제'); click(blank, '측정 항목 2 삭제'); await settle();
    expect(confirm).not.toHaveBeenCalled(); expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({ ...blank, measurements: [{ name: '가슴', values: ['50', ' '] }] });
  });

  it('이름을 아직 적지 않은 사이즈는 순서로 부른다', async () => {
    click({ ...chart, sizes: ['S', ''] }, '사이즈 2 삭제'); await settle();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('‘사이즈 2’ 사이즈의 치수 2개가 사라집니다.');
  });
});
