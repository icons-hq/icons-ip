import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoodsRelation, GoodsRelationDraft, GoodsRelationGood, GoodsRelationKind, GoodsRelationValues } from '@/lib/admin/goods-relations';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, pending: false }));
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next; }];
  },
  useEffect: () => {},
  useTransition: () => [hooks.pending, (action: () => Promise<void>) => { hooks.pending = true; void action().finally(() => { hooks.pending = false; }); }],
}));
vi.mock('@/app/admin/goods-relation-actions', () => ({ saveGoodsRelationAction: mocks.save, findGoodsForRelationAction: vi.fn() }));
vi.mock('../GoodsRelationVisualEditor', () => ({ GoodsRelationVisualEditor: () => null }));
import { GoodsRelationEditor } from './GoodsRelationEditor';
import { GoodsRelationProductPicker } from './GoodsRelationProductPicker';
import { GOODS_RELATION_KINDS, relationDefaultTitle } from '@/lib/admin/goods-relations';
import { relationVisualDraft } from '@/lib/good-relation-visual';

type Element = ReactElement<Record<string, unknown>>;
type Request = { id: string; revision: number; operationId: string; values: GoodsRelationValues };
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => !isValidElement<Record<string, unknown>>(value) ? [] : [value, ...nodes(value.props.children as ReactNode)]);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const good = (id: string, isPublic = true, compositionLabel: string | null = null): GoodsRelationGood => ({ id, name: `상품 ${id.toUpperCase()}`, code: `SKU-${id}`, imagePath: null, public: isPublic, compositionLabel });
function initial(kind: GoodsRelationKind = 'other_composition'): GoodsRelationDraft {
  return { id: '99000000-0000-4000-8000-000000000301', revision: 2, kind, title: relationDefaultTitle(kind), representativeGoodId: 'a',
    enabled: true, startsAt: '', endsAt: '', visual: kind === 'codi' ? relationVisualDraft() : null,
    goods: [good('a', false, '기본 구성'), good('b', true, '300mL'), good('c', true, '2개 세트')] };
}
let draft = initial();
function render() { hooks.index = 0; return nodes(GoodsRelationEditor({ initial: draft, backHref: '/admin/catalog/related-goods' })); }
function field(name: string) { const result = render().find(node => node.type === 'input' && node.props['aria-label'] === name); expect(result, name).toBeDefined(); return result!; }
function change(name: string, value: string) { (field(name).props.onChange as (event: unknown) => void)({ target: { value } }); }
function click(label: string) {
  const button = render().find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label));
  expect(button, label).toBeDefined(); expect(button!.props.disabled).not.toBe(true); (button!.props.onClick as () => void)();
}
function changeKind(kind: GoodsRelationKind) {
  const label = GOODS_RELATION_KINDS.find(item => item.value === kind)!.label;
  const parent = render().find(node => node.type === 'label' && text(node) === label)!;
  const input = nodes(parent).find(node => node.type === 'input')!;
  (input.props.onChange as () => void)();
}
function applySelection(goods: GoodsRelationGood[]) {
  click('상품찾기');
  const picker = render().find(node => node.type === GoodsRelationProductPicker)!;
  expect(picker.props.limit).toBe(10);
  (picker.props.onApply as (goods: GoodsRelationGood[]) => void)(goods);
}
function submit(period: Record<string, string> = { startsAt: '', endsAt: '' }) {
  const form = render().find(node => node.type === 'form')!;
  (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {}, currentTarget: period });
}
async function flush() { for (let index = 0; index < 5; index += 1) await Promise.resolve(); }
function preview() { return render().find(node => node.props.className === 'admin-relation-preview__surface')!; }
function saved(request: Request): GoodsRelation {
  return { id: request.id, revision: request.revision + 1, kind: request.values.kind, title: request.values.title, representativeGoodId: request.values.representativeGoodId,
    enabled: request.values.enabled, startsAt: null, endsAt: null, visual: request.values.visual, state: 'active', createdAt: null, updatedAt: null,
    goods: request.values.goodIds.map(id => ({ ...draft.goods.find(item => item.id === id)!, compositionLabel: request.values.compositionLabels?.find(item => item.goodId === id)?.label ?? null })) };
}

beforeEach(() => {
  hooks.values = []; hooks.index = 0; hooks.pending = false; draft = initial(); vi.resetAllMocks();
  vi.stubGlobal('FormData', class {
    constructor(private values: Record<string, string>) {}
    get(name: string) { return this.values[name] ?? null; }
  });
  mocks.save.mockResolvedValue({ error: '검증 실패' });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('다른 구성 편집 입력과 저장', () => {
  it('목록형 2~10개와 선택적 구성 표시값을 제공하고 Unicode 40자까지 입력한다', async () => {
    expect(text(render())).toContain('대표 포함 3개 / 2~10개');
    expect(render().some(node => node.props.name === 'relationPresentation')).toBe(false);
    change('상품 B 구성 표시값', '🌷'.repeat(41));
    expect(field('상품 B 구성 표시값').props.value).toBe('🌷'.repeat(40));
    change('상품 A 구성 표시값', '   ');
    change('상품 C 구성 표시값', '  라벤더  ');
    submit(); await flush();
    expect(mocks.save.mock.calls[0][0].values).toEqual({ kind: 'other_composition', title: '다른 구성도 살펴보세요', representativeGoodId: 'a', enabled: true,
      startsAt: null, endsAt: null, goodIds: ['a', 'b', 'c'], visual: null, compositionLabels: [{ goodId: 'b', label: '🌷'.repeat(40) }, { goodId: 'c', label: '라벤더' }] });
  });

  it.each(['together', 'similar', 'codi'] as const)('기존 %s 요청 JSON에는 구성 표시값 필드를 추가하지 않는다', async kind => {
    draft = initial(kind);
    submit({ startsAt: '2026-10-15T12:00', endsAt: '2026-10-16T12:00' }); await flush();
    expect(mocks.save.mock.calls[0][0].values).toEqual({ kind, title: relationDefaultTitle(kind), representativeGoodId: 'a', enabled: true,
      startsAt: '2026-10-15T12:00', endsAt: '2026-10-16T12:00', goodIds: ['a', 'b', 'c'], visual: draft.visual });
    expect(render().some(node => String(node.props['aria-label']).includes('구성 표시값'))).toBe(false);
  });

  it('유형을 바꾸면 구성 표시값을 지우고 다른 구성으로 돌아올 때 이미지도 제거한다', async () => {
    changeKind('codi');
    expect(render().find(node => node.props.id === 'relation-title')?.props.value).toBe(relationDefaultTitle('codi'));
    changeKind('other_composition');
    expect(render().find(node => node.props.id === 'relation-title')?.props.value).toBe('다른 구성도 살펴보세요');
    expect(field('상품 B 구성 표시값').props.value).toBe('');
    submit(); await flush();
    expect(mocks.save.mock.calls[0][0].values).toMatchObject({ kind: 'other_composition', visual: null, compositionLabels: [] });
  });

  it('상품찾기의 기존 상품 재선택은 입력값을 보존하고 해제한 상품을 다시 추가하면 비운다', async () => {
    change('상품 B 구성 표시값', '수정한 구성');
    const selected = draft.goods.map(({ id, name, code, imagePath, public: visible }) => ({ id, name, code, imagePath, public: visible }));
    applySelection([...selected, good('d')]);
    expect(field('상품 B 구성 표시값').props.value).toBe('수정한 구성');
    expect(field('상품 D 구성 표시값').props.value).toBe('');
    click('상품 B 해제');
    applySelection([...selected, good('d')]);
    expect(field('상품 B 구성 표시값').props.value).toBe('');
    submit(); await flush();
    expect(mocks.save.mock.calls[0][0].values.compositionLabels).not.toContainEqual({ goodId: 'b', label: '수정한 구성' });
  });

  it('구성 순서를 바꿔도 표시값은 상품에 남고 대표를 해제하면 해당 값만 빠진다', async () => {
    click('상품 C 위로'); click('상품 A 해제');
    submit(); await flush();
    expect(mocks.save.mock.calls[0][0].values).toMatchObject({ representativeGoodId: 'c', goodIds: ['c', 'b'],
      compositionLabels: [{ goodId: 'c', label: '2개 세트' }, { goodId: 'b', label: '300mL' }] });
  });
});

describe('다른 구성 공개 조건 미리보기', () => {
  it('비공개 대표 A와 공개 B/C에서 B와 C 상세를 대칭으로 확인한다', () => {
    click('노출 미리보기');
    const current = render().find(node => node.type === 'select')!;
    expect(current.props.value).toBe('b');
    expect(nodes(current).filter(node => node.type === 'option').map(node => node.props.value)).toEqual(['b', 'c']);
    expect(nodes(preview()).filter(node => node.type === 'li').map(text)).toEqual(['상품 C2개 세트']);
    expect(text(preview())).not.toContain('대표 상품을 포함해 공개 가능한');
    (current.props.onChange as (event: unknown) => void)({ target: { value: 'c' } });
    expect(nodes(preview()).filter(node => node.type === 'li').map(text)).toEqual(['상품 B300mL']);
    expect(text(preview())).toContain('상품 C 상세에 표시');
  });

  it('현재 상세 외에 공개 후보가 없으면 제목과 목록을 숨긴다', () => {
    draft.goods[2].public = false;
    click('노출 미리보기');
    expect(text(preview())).toContain('현재 상세에서 보여줄 다른 공개 상품이 없어 편성이 숨겨집니다.');
    expect(nodes(preview()).some(node => node.type === 'h3' || node.type === 'ul')).toBe(false);
  });

  it.each(['together', 'similar', 'codi'] as const)('기존 %s는 대표 공개 게이트와 안내를 보존한다', kind => {
    draft = initial(kind); click('노출 미리보기');
    expect(text(preview())).toContain('대표 상품을 포함해 공개 가능한 상품이 2개 이상이어야 표시됩니다.');
    expect(text(preview())).toContain('대표 상품 상세의 현재 입력 미리보기입니다.');
    expect(nodes(preview()).some(node => node.type === 'ul')).toBe(false);
    expect(render().some(node => node.type === 'select')).toBe(false);
  });
});

describe('다른 구성 저장 결과 복구', () => {
  it.each(['transport', 'retry-result'] as const)('%s 미확인 결과는 입력과 operation을 고정하고 readback 성공 시 해제한다', async reason => {
    if (reason === 'transport') mocks.save.mockRejectedValueOnce(new Error('offline'));
    else mocks.save.mockResolvedValueOnce({ error: '결과 미확인', retrySameOperation: true });
    mocks.save.mockImplementationOnce(async (request: Request) => ({ saved: saved(request) }));
    change('상품 B 구성 표시값', '  저장할 구성  ');
    submit(); await flush();
    const request = mocks.save.mock.calls[0][0] as Request;
    expect(render().find(node => node.type === 'fieldset')?.props.disabled).toBe(true);
    expect(render().find(node => node.type === 'button' && node.props.type === 'submit')?.props.disabled).toBe(false);
    expect(text(render())).toContain('같은 요청으로 결과 확인');
    submit({ startsAt: '2099-01-01T00:00', endsAt: '2099-01-02T00:00' }); await flush();
    expect(mocks.save.mock.calls[1][0]).toBe(request);
    expect(mocks.save.mock.calls[1][0].values.compositionLabels).toContainEqual({ goodId: 'b', label: '저장할 구성' });
    expect(field('상품 B 구성 표시값').props.value).toBe('저장할 구성');
    expect(render().find(node => node.type === 'fieldset')?.props.disabled).toBe(false);
    expect(text(render())).toContain('저장 버전 3');
    expect(text(render())).toContain('저장된 편성을 다시 확인했습니다.');
    expect(text(render())).not.toContain('저장하지 않은 변경사항');
  });
});
