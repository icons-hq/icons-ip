import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], refs: [] as { current: unknown }[], stateIndex: 0, refIndex: 0, effects: [] as (() => void)[] }));
const actions = vi.hoisted(() => ({ detail: vi.fn(), experience: vi.fn(), media: vi.fn(), mediaSettings: vi.fn(), store: vi.fn(), colors: vi.fn(), loadColors: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.state)) hooks.state[i] = initial; return [hooks.state[i], (next: unknown) => { hooks.state[i] = typeof next === 'function' ? (next as (old: unknown) => unknown)(hooks.state[i]) : next; }]; },
  useRef: (initial: unknown) => { const i = hooks.refIndex++; hooks.refs[i] ??= { current: initial }; return hooks.refs[i]; },
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
}));
vi.mock('@/app/admin/product-detail-presentation-actions', () => ({ saveDetailPresentationAction: actions.detail }));
vi.mock('@/app/admin/product-detail-experience-actions', () => ({ saveDetailExperienceAction: actions.experience }));
vi.mock('@/app/admin/goods-media-actions', () => ({ saveGoodMediaAction: actions.media, saveGoodsMediaSettingsAction: actions.mediaSettings, cancelGoodsMediaAction: vi.fn(), verifyGoodsMediaAction: vi.fn(), prepareGoodsMediaAction: vi.fn() }));
vi.mock('@/app/admin/store-presentation-actions', () => ({ saveStorePresentationAction: actions.store, saveGoodsListingColorsAction: actions.colors, loadGoodsListingColorsAction: actions.loadColors }));
import { DetailPresentationScreen } from './screens/DetailPresentationScreen';
import { StorePresentationScreen } from './screens/StorePresentationScreen';
import { GoodsListingColorsPanel } from './GoodsListingColorsPanel';
import { DEFAULT_DETAIL_PRESENTATION } from '@/lib/product-detail-presentation';
import { DEFAULT_STORE_PRESENTATION } from '@/lib/store-presentation';
import { DetailExperienceScreen } from './screens/DetailExperienceScreen';
import { DEFAULT_DETAIL_EXPERIENCES } from '@/lib/product-detail-experiences';
import { GoodsMediaScreen } from './screens/GoodsMediaScreen';
import { DetailMediaScreen } from './screens/DetailMediaScreen';
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  return [node as ReactElement<Record<string, unknown>>, ...elements((node.props as { children?: ReactNode }).children)];
}
function innerForm(screen: ReactNode, name: string) {
  const child = elements(screen).find(element => typeof element.type === 'function' && element.type.name === name)!;
  return () => (child.type as (props: Record<string, unknown>) => ReactNode)(child.props);
}
function render(factory: () => ReactNode) { hooks.stateIndex = 0; hooks.refIndex = 0; return elements(factory()); }
async function flush() { await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => { hooks.state = []; hooks.refs = []; hooks.effects = []; hooks.stateIndex = 0; hooks.refIndex = 0; vi.clearAllMocks(); });
describe('presentation UI transport failure', () => {
  it.each(['detail', 'detailOther', 'store', 'experience', 'media', 'mediaSettings'] as const)('keeps %s request immutable and enables exact retry after Server Action transport rejects', async kind => {
    const factory = kind === 'media' ? () => GoodsMediaScreen({ initial: { goodId: 'g1', goodName: '검증 상품', revision: 0, video: null, shortclip: null } })
      : kind === 'mediaSettings' ? () => DetailMediaScreen({ initial: { revision: 0, values: { priority: 'image', shortclips: false } } })
      : kind === 'detail' || kind === 'detailOther'
      ? innerForm(DetailPresentationScreen({ snapshot: { values: structuredClone(DEFAULT_DETAIL_PRESENTATION), revisions: { banner: 0, modules: 0, otherComposition: 0 } }, section: kind === 'detailOther' ? 'otherComposition' : 'modules', goods: [], categories: [] }), 'DetailForm')
      : kind === 'experience' ? innerForm(DetailExperienceScreen({ snapshot: { values: structuredClone(DEFAULT_DETAIL_EXPERIENCES), revisions: { messages: 0, discovery: 0 } }, section: 'discovery' }), 'ExperienceForm')
      : innerForm(StorePresentationScreen({ snapshot: { values: structuredClone(DEFAULT_STORE_PRESENTATION), revisions: { common: 0, listing: 0 } }, section: 'listing' }), 'PresentationForm');
    const action = actions[kind === 'detailOther' ? 'detail' : kind]; action.mockRejectedValueOnce(new Error('transport offline')).mockResolvedValueOnce({ error: 'result still unknown', uncertain: true });
    const submit = async () => { const form = render(factory).find(element => element.type === 'form')!; (form.props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault() {} }); await flush(); };
    await submit();
    const firstArgs = action.mock.calls[0];
    const tree = render(factory);
    expect(tree.find(element => element.type === 'fieldset')?.props.disabled).toBe(true);
    expect(tree.find(element => element.type === 'button' && element.props.type === 'submit')?.props.disabled).toBe(false);
    expect(tree.some(element => element.props.role === 'alert')).toBe(true);
    await submit(); expect(action.mock.calls[1]).toEqual(firstArgs);
  });
  it('keeps colors retryable when the request fails before the server action starts', async () => {
    actions.loadColors.mockResolvedValue({ colors: [{ label: '검정', hex: '#000000' }], revision: 4 });
    actions.colors.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ error: 'unknown', uncertain: true });
    const factory = () => GoodsListingColorsPanel({ goodId: 'g1' });
    render(factory); hooks.effects[0](); await flush();
    const save = async () => { const button = render(factory).filter(element => element.type === 'button').at(-1)!; (button.props.onClick as () => void)(); await flush(); };
    await save(); const firstArgs = actions.colors.mock.calls[0];
    expect(render(factory).find(element => element.type === 'fieldset')?.props.disabled).toBe(true);
    expect(render(factory).filter(element => element.type === 'button').at(-1)?.props.disabled).toBe(false);
    await save(); expect(actions.colors.mock.calls[1]).toEqual(firstArgs);
  });
});
