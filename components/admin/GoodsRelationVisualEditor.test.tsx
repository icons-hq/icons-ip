import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoodsRelationGood } from '@/lib/admin/goods-relations';
import type { GoodsRelationVisual } from '@/lib/good-relation-visual';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next; }];
  },
}));
vi.mock('@/lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: mocks.upload }));
vi.mock('@/components/shop/RelationImageMap', () => ({ RelationImageMap: () => null }));
import { GoodsRelationVisualEditor } from './GoodsRelationVisualEditor';
import { Input } from './kit/ui/input';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => !isValidElement<Record<string, unknown>>(value) ? [] : [value, ...nodes(value.props.children as ReactNode)]);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const IMAGE = 'public-media/catalog/curation/99000000-0000-4000-8000-000000000301.webp';
const NEXT = 'public-media/catalog/curation/99000000-0000-4000-8000-000000000302.webp';
const goods: GoodsRelationGood[] = ['a', 'b'].map(id => ({ id, name: `상품 ${id}`, code: `SKU-${id}`, imagePath: null, public: true, visibility: 'public' }));
const tagged: GoodsRelationVisual = { imagePath: IMAGE, alt: '설명', description: '', hotspots: [{ goodId: 'a', x: 100, y: 100 }, { goodId: 'b', x: 200, y: 200 }] };
let onChange = vi.fn(), onBusyChange = vi.fn();
let confirm: ReturnType<typeof stubAdminConfirm> | null = null;
function render(value: GoodsRelationVisual, kind: 'codi' | 'together' = 'codi') {
  hooks.index = 0;
  return nodes(GoodsRelationVisualEditor({ value, goods, kind, disabled: false, onChange, onBusyChange }));
}
async function pick(value: GoodsRelationVisual) {
  const input = render(value).find(node => node.type === Input && node.props.type === 'file')!;
  await (input.props.onChange as (event: unknown) => Promise<void>)({ target: { files: [{ type: 'image/webp', size: 1000 }], value: 'C:\\\\fakepath\\\\next.webp' } });
}

beforeEach(() => { hooks.values = []; hooks.index = 0; onChange = vi.fn(); onBusyChange = vi.fn(); vi.clearAllMocks(); mocks.upload.mockResolvedValue({ ok: true, imagePath: NEXT }); });
afterEach(() => { confirm?.restore(); confirm = null; vi.unstubAllEnvs(); });

describe('연관상품 이미지 편집', () => {
  it('태그를 붙인 이미지를 바꾸기 전에 사라지는 태그 수를 묻고, 취소하면 올리지 않는다(R4)', async () => {
    confirm = stubAdminConfirm(false);
    await pick(tagged);
    expect(confirm).toHaveBeenCalledExactlyOnceWith('태그 2개가 사라집니다. 새 이미지에 태그를 다시 붙여야 합니다.');
    expect(mocks.upload).not.toHaveBeenCalled(); expect(onChange).not.toHaveBeenCalled(); expect(onBusyChange).not.toHaveBeenCalled();
    confirm.restore(); confirm = stubAdminConfirm(true);
    await pick(tagged);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...tagged, imagePath: NEXT, hotspots: [] });
  });

  it('태그가 없으면 묻지 않고 올린다', async () => {
    confirm = stubAdminConfirm(false);
    await pick({ ...tagged, hotspots: [] });
    expect(confirm).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...tagged, imagePath: NEXT, hotspots: [] });
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  });

  it('필수 칸을 이름에 적고 조작법은 접어 둔다(R8·R9)', () => {
    // 태그 영역은 이미지 주소를 만들 수 있을 때만 그린다.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://relation-visual.example.test');
    const codi = text(render(tagged));
    expect(codi).toContain('코디 이미지 (필수)'); expect(codi).toContain('이미지 설명 (필수)'); expect(codi).toContain('소개 글');
    expect(text(render(tagged, 'together'))).toContain('이미지 (필수)');
    const details = render(tagged).find(node => node.type === 'details');
    expect(details, '접어 둔 조작법').toBeDefined();
    expect(text(nodes(details).find(node => node.type === 'summary'))).toBe('태그 붙이는 방법');
    expect(codi).toContain('태그 지우기');
    expect(codi).not.toMatch(/편성|좌표|대체 설명|업로드/);
  });
});
