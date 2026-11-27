import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 템플릿을 저장한 직후 목록 위에 한 줄로 남는 결과. 훅은 순서대로 모의하고(함수형 갱신 포함) 화면을 함수로 불러 요소 트리를 읽는다.
 * 템플릿은 무엇을 저장하든(이름·사용 여부만 고쳐도) 번호가 올라 '다시 적용하지 않은 상품'으로 세어진다 — 상품 설정이 달라졌다고 말하지 않는다.
 */
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? (value as (current: unknown) => unknown)(hooks.values[index]) : value; }];
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./useShippingSettingsOperation', async () => ({ ...await vi.importActual<typeof import('./useShippingSettingsOperation')>('./useShippingSettingsOperation'),
  useShippingSettingsSession: () => ({ identity: { expectedActorId: '00000000-0000-4000-8000-000000000004', expectedSessionId: '00000000-0000-4000-8000-000000000005' }, scope: {}, blocked: false }),
  useShippingSettingsPending: () => [] }));
vi.mock('@/app/admin/shipping-settings-template-actions', () => ({ saveShippingSettingsTemplateAction: vi.fn(), readShippingSettingsTemplateAction: vi.fn(),
  findShippingSettingsOutdatedGoodsAction: vi.fn(), previewShippingSettingsTemplateAction: vi.fn(), applyShippingSettingsTemplateAction: vi.fn(), readShippingSettingsOperationAction: vi.fn(), sealShippingSettingsOperationAction: vi.fn() }));
vi.mock('@/app/admin/goods-option-import-actions', () => ({ searchGoodsOptionImportAction: vi.fn() }));
vi.mock('@/app/admin/shipping-charge-group-actions', () => ({ getShippingChargeGroupAction: vi.fn(), listShippingChargeGroupsAction: vi.fn() }));
import { ShippingSettingsTemplatesScreen } from './ShippingSettingsTemplatesScreen';
import { ShippingSettingsTemplateForm } from './ShippingSettingsTemplateForm';
import { Button } from '../kit/ui/button';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import { shippingFixtures, shippingIds } from '@/test/fixtures/shipping-settings';

type Element = ReactElement<Record<string, unknown>>;
/* 화면 머리의 [템플릿 등록]은 `actions` 속성에 들어 있어 그것도 걷는다. */
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap((value) =>
  isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode), ...nodes(value.props.actions as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map((value) =>
  isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');

const origin: GoodsFulfillmentOrigin = { id: shippingIds.origin, name: '김포 출고지', defaultCarrier: 'hanjin', baseFee: 3000, freeThreshold: 50000, returnAddress: '', active: true };
const { template } = shippingFixtures();
const data = (outdated: number) => ({ filters: { query: '', state: 'all' as const, page: 1 }, total: 1, usage: { [template.id]: { applied: 12, outdated } }, rows: [{ ...template, revision: 7 }] });
const render = (outdated = 3) => { hooks.index = 0; return nodes(ShippingSettingsTemplatesScreen({ accountId: shippingIds.actor, origins: [origin], regions: [], data: data(outdated) })); };
const button = (label: string, outdated = 3) => render(outdated).find((node) => node.type === Button && text(node.props.children as ReactNode).includes(label));

/** [템플릿 등록]으로 편집 창을 열었다가 저장을 마친 것으로 만든다. */
function saveTemplate() {
  (button('템플릿 등록')!.props.onClick as () => void)();
  const form = render().find((node) => node.type === ShippingSettingsTemplateForm)!;
  (form.props.onSaved as (saved: unknown) => void)({ ...template, revision: 7 });
}

beforeEach(() => { hooks.values = []; hooks.index = 0; mocks.refresh.mockClear(); });

describe('템플릿을 저장한 직후의 결과 줄', () => {
  it('저장한 뒤 다시 적용하지 않은 상품 수를 말하되, 상품 설정이 달라졌다고 단정하지 않는다', () => {
    saveTemplate();
    const shown = text(render());
    expect(shown).toContain('이 템플릿을 저장한 뒤 다시 적용하지 않은 상품이 3개 있습니다. 설정을 고쳤다면 상품에도 다시 적용해 주세요.');
    expect(shown).not.toContain('고치기 전 내용');
    expect(button('3개 상품에 다시 적용')).toBeDefined();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('다시 적용하지 않은 상품이 없으면 그 줄이 없다', () => {
    saveTemplate();
    const shown = text(render(0));
    expect(shown).not.toContain('다시 적용하지 않은 상품이');
    expect(button('상품에 다시 적용', 0)).toBeUndefined();
  });
  it('한 번에 적용하는 상품 수는 100개까지다', () => {
    saveTemplate();
    expect(button('100개 상품에 다시 적용', 250)).toBeDefined();
    expect(text(render(250))).toContain('다시 적용하지 않은 상품이 250개 있습니다.');
  });
});
