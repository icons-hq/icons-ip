import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoodsRelation, GoodsRelationDraft, GoodsRelationGood, GoodsRelationGoodVisibility, GoodsRelationKind, GoodsRelationValues } from '@/lib/admin/goods-relations';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, pending: false }));
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next; }];
  },
  useRef: (current: unknown) => ({ current }),
  useEffect: () => {},
  useTransition: () => [hooks.pending, (action: () => Promise<void>) => { hooks.pending = true; void action().finally(() => { hooks.pending = false; }); }],
}));
vi.mock('@/app/admin/goods-relation-actions', () => ({ saveGoodsRelationAction: mocks.save, findGoodsForRelationAction: vi.fn() }));
vi.mock('../GoodsRelationVisualEditor', () => ({ GoodsRelationVisualEditor: () => null }));
import { GoodsRelationEditor } from './GoodsRelationEditor';
import { GoodsRelationProductPicker } from './GoodsRelationProductPicker';
import Link from 'next/link';
import { GoodReadback } from '../GoodEditorParts';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { AdminSelect } from '../console/AdminSelect';
import { AdminStatusBadge } from '../console/AdminKit';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { GOODS_RELATION_KINDS, relationDefaultTitle } from '@/lib/admin/goods-relations';
import { relationVisualDraft } from '@/lib/good-relation-visual';

type Element = ReactElement<Record<string, unknown>>;
type Request = { id: string; revision: number; operationId: string; values: GoodsRelationValues };
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => !isValidElement<Record<string, unknown>>(value) ? [] : [value, ...nodes(value.props.children as ReactNode)]);
/* kit 버튼·입력·선택도 네이티브와 같은 조작 부품으로 찾는다(ADR-0028). */
const isButton = (node: Element) => node.type === 'button' || node.type === Button;
const isInput = (node: Element) => node.type === 'input' || node.type === Input;
const isSelect = (node: Element) => node.type === 'select' || node.type === AdminSelect;
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const good = (id: string, isPublic = true, compositionLabel: string | null = null, visibility: GoodsRelationGoodVisibility = isPublic ? 'public' : 'draft'): GoodsRelationGood =>
  ({ id, name: `상품 ${id.toUpperCase()}`, code: `SKU-${id}`, imagePath: null, public: isPublic, visibility, compositionLabel });
const IMAGE = 'public-media/catalog/curation/99000000-0000-4000-8000-000000000301.webp';
function initial(kind: GoodsRelationKind = 'other_composition'): GoodsRelationDraft {
  return { id: '99000000-0000-4000-8000-000000000301', revision: 2, kind, title: relationDefaultTitle(kind), representativeGoodId: 'a',
    enabled: true, startsAt: '', endsAt: '', visual: kind === 'codi' ? relationVisualDraft() : null,
    goods: [good('a', false, '기본 구성'), good('b', true, '300mL'), good('c', true, '2개 세트')] };
}
let draft = initial();
let adultGoodsHidden = false;
let confirm: ReturnType<typeof stubAdminConfirm> | null = null;
function render() { hooks.index = 0; return nodes(GoodsRelationEditor({ initial: draft, backHref: '/admin/catalog/related-goods', adultGoodsHidden })); }
function field(name: string) { const result = render().find(node => isInput(node) && node.props['aria-label'] === name); expect(result, name).toBeDefined(); return result!; }
function change(name: string, value: string) { (field(name).props.onChange as (event: unknown) => void)({ target: { value } }); }
function click(label: string) {
  const button = render().find(node => isButton(node) && (node.props['aria-label'] === label || text(node) === label));
  expect(button, label).toBeDefined(); expect(button!.props.disabled).not.toBe(true); (button!.props.onClick as () => void)();
}
function changeKind(kind: GoodsRelationKind) {
  const label = GOODS_RELATION_KINDS.find(item => item.value === kind)!.label;
  const parent = render().find(node => node.type === 'label' && text(node) === label)!;
  const input = nodes(parent).find(node => node.type === 'input')!;
  (input.props.onChange as () => void)();
}
/** 상품 고르기 창. 고르면 바로 담기므로 창이 받은 onAdd·onRemove를 그대로 부른다. */
function picker() {
  click('상품 고르기');
  const node = render().find(item => item.type === GoodsRelationProductPicker);
  expect(node, '상품 고르기 창').toBeDefined();
  return node!.props as unknown as { value: GoodsRelationGood[]; limit: number; onAdd: (good: GoodsRelationGood) => void; onRemove: (good: GoodsRelationGood) => void };
}
function choose(label: string) {
  const parent = render().find(node => node.type === 'label' && text(node) === label);
  expect(parent, label).toBeDefined();
  (nodes(parent!).find(node => node.type === 'input')!.props.onChange as () => void)();
}
function radio(name: string, label: string) {
  const parent = render().find(node => node.type === 'label' && text(node) === label)!;
  return nodes(parent).find(node => node.type === 'input' && node.props.name === name)!;
}
/** 저장 막대의 결과 한 줄. */
function readback() { return text(render().find(node => node.props['data-relation'] === 'readback')!.props.children as ReactNode); }
function title() { return render().find(node => node.props.id === 'relation-title')?.props.value; }
function confirmWith(answer: boolean) { confirm?.restore(); confirm = stubAdminConfirm(answer); return confirm; }
function submit(period: Record<string, string> = { startsAt: '', endsAt: '' }) {
  const form = render().find(node => node.type === 'form')!;
  (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {}, currentTarget: period });
}
async function flush() { for (let index = 0; index < 5; index += 1) await Promise.resolve(); }
function preview() { return render().find(node => node.props['data-relation-preview'] === 'surface')!; }
function saved(request: Request): GoodsRelation {
  return { id: request.id, revision: request.revision + 1, kind: request.values.kind, title: request.values.title, representativeGoodId: request.values.representativeGoodId,
    enabled: request.values.enabled, startsAt: null, endsAt: null, visual: request.values.visual, state: 'active', createdAt: null, updatedAt: null,
    goods: request.values.goodIds.map(id => ({ ...draft.goods.find(item => item.id === id)!, compositionLabel: request.values.compositionLabels?.find(item => item.goodId === id)?.label ?? null })) };
}

beforeEach(() => {
  hooks.values = []; hooks.index = 0; hooks.pending = false; draft = initial(); adultGoodsHidden = false; vi.resetAllMocks();
  vi.stubGlobal('FormData', class {
    constructor(private values: Record<string, string>) {}
    get(name: string) { return this.values[name] ?? null; }
  });
  mocks.save.mockResolvedValue({ error: '검증 실패' });
});
afterEach(() => { vi.unstubAllGlobals(); confirm?.restore(); confirm = null; });

describe('다른 구성 편집 입력과 저장', () => {
  it('목록형 2~10개와 선택적 구성 표시값을 제공하고 Unicode 40자까지 입력한다', async () => {
    expect(text(render())).toContain('3개 담음 (2개부터 10개까지)');
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
    const asked = confirmWith(true);
    changeKind('codi'); await flush();
    expect(asked).toHaveBeenCalledExactlyOnceWith('구성 표시값 3개가 사라집니다.');
    expect(title()).toBe(relationDefaultTitle('codi'));
    // 코디에서 돌아올 때는 올린 이미지도, 적어 둔 구성 표시값도 없어 묻지 않는다.
    changeKind('other_composition');
    expect(asked).toHaveBeenCalledTimes(1);
    expect(title()).toBe('다른 구성도 살펴보세요');
    expect(field('상품 B 구성 표시값').props.value).toBe('');
    submit(); await flush();
    expect(mocks.save.mock.calls[0][0].values).toMatchObject({ kind: 'other_composition', visual: null, compositionLabels: [] });
  });

  it('상품 고르기로 담으면 바로 표에 들어가고, 뺐다가 다시 담은 상품의 구성 표시값은 비어 있다', async () => {
    const asked = confirmWith(true);
    change('상품 B 구성 표시값', '수정한 구성');
    expect(picker().limit).toBe(10);
    picker().onAdd(good('d'));
    picker().onAdd(good('d'));
    expect(picker().value.map(item => item.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(field('상품 B 구성 표시값').props.value).toBe('수정한 구성');
    expect(field('상품 D 구성 표시값').props.value).toBe('');
    picker().onRemove(good('b')); await flush();
    expect(asked).toHaveBeenCalledExactlyOnceWith('상품 B: 구성 표시값 1개가 사라집니다.');
    picker().onAdd(good('b', true, '검색 결과에 실려 온 값'));
    expect(field('상품 B 구성 표시값').props.value).toBe('');
    submit(); await flush();
    expect(mocks.save.mock.calls[0][0].values.goodIds).toEqual(['a', 'c', 'd', 'b']);
    expect(mocks.save.mock.calls[0][0].values.compositionLabels).not.toContainEqual({ goodId: 'b', label: '수정한 구성' });
  });

  it('구성 순서를 바꿔도 표시값은 상품에 남고 대표를 빼면 그 상품의 값만 빠진다', async () => {
    confirmWith(true);
    click('상품 C 위로'); click('상품 A 빼기'); await flush();
    submit(); await flush();
    expect(mocks.save.mock.calls[0][0].values).toMatchObject({ representativeGoodId: 'c', goodIds: ['c', 'b'],
      compositionLabels: [{ goodId: 'c', label: '2개 세트' }, { goodId: 'b', label: '300mL' }] });
  });
});

describe('한도가 줄어드는 변경은 고를 때 막는다(R3)', () => {
  it('담은 상품이 한도를 넘는 유형은 고를 수 없고 몇 개를 빼야 하는지 적는다', () => {
    draft = { ...initial('similar'), representativeGoodId: 'g0', goods: Array.from({ length: 8 }, (_, index) => good(`g${index}`)) };
    expect(GOODS_RELATION_KINDS.map(kind => Boolean(radio('relationKind', kind.label).props.disabled))).toEqual([true, false, true, false]);
    expect(text(render())).toContain('코디 상품은 5개까지 담습니다. 지금 8개라 3개를 뺀 뒤 바꿀 수 있습니다.');
    expect(text(render())).toContain('함께 사면 좋은 상품은 6개까지 담습니다. 지금 8개라 2개를 뺀 뒤 바꿀 수 있습니다.');
    changeKind('codi');
    expect(radio('relationKind', '유사한 상품').props.checked).toBe(true);
    expect(title()).toBe(relationDefaultTitle('similar'));
  });

  it('목록형에 6개를 담았으면 이미지형(5개까지)으로 바꿀 수 없다', () => {
    draft = { ...initial('together'), representativeGoodId: 'g0', goods: Array.from({ length: 6 }, (_, index) => good(`g${index}`)) };
    expect(radio('relationPresentation', '이미지형').props.disabled).toBe(true);
    expect(text(render())).toContain('이미지형은 5개까지 담습니다. 지금 6개라 1개를 뺀 뒤 바꿀 수 있습니다.');
    choose('이미지형');
    expect(radio('relationPresentation', '목록형').props.checked).toBe(true);
    click('상품 G5 빼기');
    expect(radio('relationPresentation', '이미지형').props.disabled).toBe(false);
    choose('이미지형');
    expect(radio('relationPresentation', '이미지형').props.checked).toBe(true);
    expect(text(render())).toContain('5개 담음 (2개부터 5개까지)');
  });
});

describe('사라지는 입력이 있으면 먼저 묻는다(R4)', () => {
  const visual = { imagePath: IMAGE, alt: '함께 놓은 모습', description: '', hotspots: [{ goodId: 'b', x: 100, y: 100 }, { goodId: 'c', x: 200, y: 200 }] };

  it('유형을 바꿔 이미지와 태그가 사라질 때 무엇이 사라지는지 적고, 취소하면 그대로 둔다', async () => {
    draft = { ...initial('together'), visual };
    const refused = confirmWith(false);
    changeKind('similar'); await flush();
    expect(refused).toHaveBeenCalledExactlyOnceWith('이미지 1장, 태그 2개, 이미지 설명과 소개 글이 사라집니다.');
    expect(radio('relationKind', '함께 사면 좋은 상품').props.checked).toBe(true);
    // 코디는 이미지를 그대로 쓰므로 묻지 않고 바꾼다.
    changeKind('codi');
    expect(refused).toHaveBeenCalledTimes(1);
    expect(radio('relationKind', '코디 상품').props.checked).toBe(true);
    const accepted = confirmWith(true);
    changeKind('similar'); await flush();
    expect(accepted).toHaveBeenCalledTimes(1);
    submit(); await flush();
    expect(mocks.save.mock.calls[0][0].values).toMatchObject({ kind: 'similar', visual: null });
  });

  it('목록형으로 바꾸거나 태그가 붙은 상품을 뺄 때도 묻고, 사라질 것이 없으면 묻지 않는다', async () => {
    draft = { ...initial('together'), visual };
    const asked = confirmWith(true);
    click('상품 A 빼기');
    expect(asked).not.toHaveBeenCalled();
    click('상품 B 빼기'); await flush();
    expect(asked).toHaveBeenLastCalledWith('상품 B: 태그 1개가 사라집니다.');
    choose('목록형'); await flush();
    expect(asked).toHaveBeenLastCalledWith('이미지 1장, 태그 1개, 이미지 설명과 소개 글이 사라집니다.');
    expect(radio('relationPresentation', '목록형').props.checked).toBe(true);
    // 비어 있는 이미지형에서 목록형으로 돌아갈 때는 묻지 않는다.
    picker().onAdd(good('d'));
    choose('이미지형'); choose('목록형');
    expect(asked).toHaveBeenCalledTimes(2);
  });
});

describe('저장하면 고객에게 보이는지 한 줄로 알린다(R1·R8·R11)', () => {
  it('새 연관상품은 전시중지가 기본값이라 저장해도 보이지 않는다고 알린다', () => {
    draft = { id: '99000000-0000-4000-8000-000000000302', revision: 0, kind: 'together', title: relationDefaultTitle('together'), representativeGoodId: '', enabled: false, startsAt: '', endsAt: '', goods: [] };
    expect(readback()).toBe('상품을 2개 이상 담아야 저장할 수 있습니다.');
    expect(text(render())).toContain('[상품 고르기]로 함께 보여 줄 상품을 2개 이상 담아 주세요.');
    picker().onAdd(good('a')); picker().onAdd(good('b'));
    expect(readback()).toBe('전시중지라 저장해도 고객에게 보이지 않습니다.');
    choose('전시');
    expect(readback()).toBe('저장하면 대표 상품 상세에 보입니다.');
    choose('이미지형');
    expect(readback()).toBe('저장하면 상품 2개 상세에 보입니다.');
  });

  it('저장된 그대로면 지금 상태를, 고친 내용이 있으면 저장한 뒤를 말한다', async () => {
    expect(readback()).toBe("지금 상품 2개 상세에 보입니다. 상품 상세 구성의 '다른 구성 추천 표시'가 켜져 있어야 합니다.");
    expect(text(render())).not.toContain('저장하지 않은 변경이 있습니다.');
    confirmWith(true); click('상품 C 빼기'); await flush();
    expect(readback()).toBe('공개 상품이 1개뿐이라 저장해도 고객에게 보이지 않습니다.');
    expect(text(render())).toContain('저장하지 않은 변경이 있습니다.');
  });

  it('판매 제한 상품은 공개로 보이고 성인 인증 고객에게만 보인다고 따로 적는다', () => {
    draft = { ...initial('similar'), goods: [good('a'), good('b'), good('c', true, null, 'restricted')] };
    expect(render().filter(node => node.type === AdminStatusBadge).map(text)).toEqual(['공개', '공개', '공개']);
    expect(text(render())).toContain('성인 인증 고객에게만');
    expect(text(render())).not.toContain('비노출');
    expect(readback()).toBe('지금 상품 3개 상세에 보입니다. 성인 상품 1개는 성인 인증 고객에게만 보입니다.');
    click('고객 화면 미리보기');
    expect(nodes(preview()).filter(node => node.type === 'li').map(text)).toEqual(['상품 B', '상품 C성인 인증 고객에게만']);
  });

  it('성인 상품을 모든 고객에게 숨겨 둔 동안에는 그 사실을 적고 보이는 상품에서 뺀다', () => {
    adultGoodsHidden = true;
    draft = { ...initial('similar'), goods: [good('a'), good('b'), good('c', true, null, 'restricted')] };
    expect(text(render())).toContain('성인 상품 · 모든 고객에게 숨김');
    expect(readback()).toBe('지금 상품 2개 상세에 보입니다.');
    click('고객 화면 미리보기');
    expect(nodes(preview()).filter(node => node.type === 'li').map(text)).toEqual(['상품 B']);
  });

  it('초안·보관 상품은 담은 채로 상태를 보이고 내부 값은 보이지 않는다', () => {
    draft = { ...initial('similar'), goods: [good('a'), good('internal-good-id', false), good('c', false, null, 'archived'), good('d', false, null, 'ip_draft')] };
    expect(render().filter(node => node.type === AdminStatusBadge).map(text)).toEqual(['공개', '초안', '보관', 'IP 초안']);
    expect(text(render())).toContain('SKU-internal-good-id');
    expect(text(render()).replaceAll('SKU-internal-good-id', '')).not.toContain('internal-good-id');
    expect(text(render())).not.toMatch(/번째 저장|편성|상품찾기|노출 기간/);
  });
});

describe('전시 기간 입력(R6)', () => {
  it('칸 이름은 시작·종료 (KST)이고 입력한 기간을 한 줄로 되읽는다', () => {
    expect(text(render())).toContain('시작 (KST)'); expect(text(render())).toContain('종료 (KST)');
    const period = () => render().filter(node => node.type === GoodReadback).map(node => text(node.props.children as ReactNode));
    expect(period()).toEqual(['기간 없이 계속 전시합니다.']);
    (render().find(node => node.props.name === 'endsAt')!.props.onChange as (event: unknown) => void)({ target: { value: '2099-12-07T23:59' } });
    expect(period()).toEqual(['2099년 12월 7일 23:59까지 전시합니다.']);
    (render().find(node => node.props.name === 'startsAt')!.props.onChange as (event: unknown) => void)({ target: { value: '2099-12-08T00:00' } });
    expect(period()).toEqual([]);
    expect(text(render())).toContain('종료가 시작보다 늦어야 저장할 수 있습니다.');
  });
});

describe('다른 구성 공개 조건 미리보기', () => {
  it('비공개 대표 A와 공개 B/C에서 B와 C 상세를 대칭으로 확인한다', () => {
    click('고객 화면 미리보기');
    const current = render().find(isSelect)!;
    expect(current.props.value).toBe('b');
    expect(nodes(current).filter(node => node.type === 'option').map(node => node.props.value)).toEqual(['b', 'c']);
    expect(nodes(preview()).filter(node => node.type === 'li').map(text)).toEqual(['상품 C2개 세트']);
    (current.props.onChange as (event: unknown) => void)({ target: { value: 'c' } });
    expect(nodes(preview()).filter(node => node.type === 'li').map(text)).toEqual(['상품 B300mL']);
    expect(text(preview())).toContain('상품 C 상세에 보이는 모습');
  });

  it('현재 상세 외에 공개 후보가 없으면 제목과 목록을 숨기고 까닭을 적는다', () => {
    draft.goods[2].public = false; draft.goods[2].visibility = 'draft';
    click('고객 화면 미리보기');
    expect(text(preview())).toContain('공개 상품이 1개뿐이라 고객에게 보이지 않습니다.');
    expect(nodes(preview()).some(node => node.type === 'h3' || node.type === 'ul')).toBe(false);
  });

  it.each(['together', 'similar', 'codi'] as const)('기존 %s는 대표 상품이 공개가 아니면 미리보기 대신 까닭을 적는다', kind => {
    draft = initial(kind); click('고객 화면 미리보기');
    expect(text(preview())).toContain('대표 상품이 초안이라 고객에게 보이지 않습니다.');
    expect(nodes(preview()).some(node => node.type === 'ul')).toBe(false);
    expect(render().some(isSelect)).toBe(false);
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
    expect(render().find(node => isButton(node) && node.props.type === 'submit')?.props.disabled).toBe(false);
    expect(text(render().find(node => isButton(node) && node.props.type === 'submit')!)).toBe('저장됐는지 확인');
    if (reason === 'transport') expect(text(render())).toContain('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');
    submit({ startsAt: '2099-01-01T00:00', endsAt: '2099-01-02T00:00' }); await flush();
    expect(mocks.save.mock.calls[1][0]).toBe(request);
    expect(mocks.save.mock.calls[1][0].values.compositionLabels).toContainEqual({ goodId: 'b', label: '저장할 구성' });
    expect(field('상품 B 구성 표시값').props.value).toBe('저장할 구성');
    expect(render().find(node => node.type === 'fieldset')?.props.disabled).toBe(false);
    expect(text(render())).toContain('연관상품을 저장했습니다.');
    expect(text(render())).not.toContain('저장하지 않은 변경이 있습니다.');
  });

  it('다른 사람이 먼저 바꿨는지는 문구가 아니라 conflict 값으로 알고 [최신 내용 다시 열기]를 보인다(R10)', async () => {
    const latest = () => render().find(node => node.type === Link && text(node) === '최신 내용 다시 열기');
    submit(); await flush();
    expect(text(render())).toContain('검증 실패');
    expect(latest()).toBeUndefined();
    mocks.save.mockResolvedValueOnce({ error: '문구가 바뀌어도 링크는 나온다', conflict: true });
    submit(); await flush();
    expect(latest()?.props.href).toBe(`/admin/catalog/related-goods?edit=${draft.id}&reload=2`);
    expect(render().find(node => node.type === 'fieldset')?.props.disabled).toBe(false);
    mocks.save.mockResolvedValueOnce({ error: '다시 읽지 못함', savedId: draft.id });
    submit(); await flush();
    expect(latest()).toBeDefined();
  });
});
