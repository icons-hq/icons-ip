import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>(), jobs: [] as (() => void)[] }));
const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial; return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const index = hooks.index++, previous = hooks.effects.get(index); if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) { hooks.effects.set(index, { deps, cleanup: previous?.cleanup }); hooks.jobs.push(() => { previous?.cleanup?.(); hooks.effects.get(index)!.cleanup = effect() || undefined; }); } },
}));
vi.mock('@/app/admin/category-display-actions', () => ({ reloadCategoryDisplayAction: vi.fn(), saveCategoryDisplayAction: vi.fn(), previewCategoryDisplayAction: vi.fn(), searchCategoryDisplayGoodsAction: vi.fn(), updateCategoryDisplayTreeAction: vi.fn(), reloadCategoryDisplayTreeAction: vi.fn() }));
vi.mock('@/app/admin/good-reference-actions', () => ({ readGoodsDisplayVisibilityAction: mocks.resolve, resolveGoodReferencesAction: vi.fn(), readGoodReferenceFileAction: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }));

import { CategoryDisplayScreen } from './CategoryDisplayScreen';
import { defaultCategoryDisplayValues, type CategoryDisplaySnapshot } from '@/lib/category-display';

const id = '94933000-0000-4000-8000-000000000001', actorId = '94933000-0000-4000-8000-000000000090';
const category = { id, name: 'QA 카테고리', parentId: null, depth: 1, sortOrder: 0, publicEnabled: true };
const initial: CategoryDisplaySnapshot = { category, revision: 3, checkedAt: '2026-11-12T00:00:00Z',
  values: { ...defaultCategoryDisplayValues(id), enabled: true, mode: 'manual', goodIds: ['qa-pr1', 'qa-pr9', 'qa-ip', 'qa-gone'] } };
type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
/* 공개 표시 부품(DisplayGoodVisibilityNote·Badge)은 children 없이 그리므로 펼쳐서 읽는다. */
const text = (node: ReactNode): string => Children.toArray(node).map(value => !isValidElement<Record<string, unknown>>(value) ? String(value)
  : typeof value.type === 'function' && /^DisplayGoodVisibility/.test(value.type.name) ? text((value.type as (props: Record<string, unknown>) => ReactNode)(value.props))
  : text(value.props.children as ReactNode)).join('');
/* 화면 → 편집기 → 상품 목록(SelectedGoods)까지 함수 부품을 펼친다. */
function expand(node: ReactNode, names: string[]): Element[] {
  return nodes(node).flatMap(element => typeof element.type === 'function' && names.includes(element.type.name)
    ? [element, ...expand((element.type as (props: Record<string, unknown>) => ReactNode)(element.props), names)] : [element]);
}
function render() {
  hooks.index = 0;
  const screen = CategoryDisplayScreen({ initial, actorId, sessionId: null, directory: { categories: [{ ...category, archivedAt: null, legacyCategoryId: null, imagePath: null }], sourceCategories: [], revision: 1, checkedAt: initial.checkedAt } });
  const result = expand(screen, ['CategoryDisplayEditor', 'SelectedGoods']);
  for (const job of hooks.jobs.splice(0)) job();
  return result;
}
/* 목록 한 줄의 상품 칸(이름·코드·공개 표시) 글자. 위로·아래로·해제 버튼은 뺀다. */
const goodText = (rows: Element[], goodId: string) => text(Children.toArray(rows.find(node => node.props['data-display-good'] === goodId)!.props.children as ReactNode)[0]);
const row = (id: string, visibility = 'public', name = `이름 ${id}`) => ({ id, name, code: id.toUpperCase(), visibility });

beforeEach(() => { hooks.values = []; hooks.index = 0; hooks.effects.clear(); hooks.jobs = []; vi.clearAllMocks(); });
afterEach(() => { for (const effect of hooks.effects.values()) effect.cleanup?.(); });

it('다시 열어도 연결 상품을 이름·판매자상품코드로 보이고, 고객 화면에 안 보이는 상품은 이유(초안·IP 초안·찾을 수 없음)와 함께 미리보기에서 빠진다고 알린다(QA1 MD)', async () => {
  /* 가벼운 읽기(admin_goods_display_visibility)는 없는 상품 URL을 결과에서 뺀다 — 화면은 그 값을 찾을 수 없음으로 본다. */
  mocks.resolve.mockResolvedValueOnce({ ok: true, goods: [row('qa-pr1'), row('qa-pr9', 'draft', 'QA 초안 상품'), row('qa-ip', 'ip_draft', 'QA IP 준비 상품')] });
  const before = render();
  /* 조회 전에는 지금처럼 상품 URL과 '저장된 상품'으로 보인다. */
  expect(goodText(before, 'qa-pr1')).toBe('qa-pr1저장된 상품');
  expect(mocks.resolve).toHaveBeenCalledWith(['qa-pr1', 'qa-pr9', 'qa-ip', 'qa-gone']);
  for (let i = 0; i < 6; i++) await Promise.resolve();

  const after = render();
  const goodRow = (goodId: string) => goodText(after, goodId);
  expect(goodRow('qa-pr1')).toBe('이름 qa-pr1QA-PR1 · qa-pr1');
  expect(goodRow('qa-pr9')).toBe('QA 초안 상품QA-PR9 · qa-pr9초안공개 전까지 고객 화면에 보이지 않습니다.');
  expect(goodRow('qa-ip')).toBe('QA IP 준비 상품QA-IP · qa-ipIP 초안IP 공개 전까지 고객 화면에 보이지 않습니다.');
  expect(goodRow('qa-gone')).toBe('qa-gone저장된 상품찾을 수 없음찾을 수 없는 상품이라 고객 화면에 보이지 않습니다.');
  const notice = after.find(node => node.props['data-display-hidden-goods'] !== undefined)!;
  expect(text(notice.props.children as ReactNode)).toBe('초안 상품 1개(QA 초안 상품)는 공개 전까지 고객 화면에 보이지 않습니다. IP가 공개 전인 상품 1개(QA IP 준비 상품)는 IP 공개 전까지 고객 화면에 보이지 않습니다. 찾을 수 없는 상품 1개(qa-gone)는 고객 화면에 보이지 않습니다. 미리보기에도 보이지 않습니다.');
  expect(text(notice.props.children as ReactNode)).not.toContain('비공개');
  /* 같은 상품을 다시 묻지 않는다. */
  render();
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
});

it('조회 권한이 없거나 실패하면 상품 URL로 보이고 빠진 이유 안내도 지어내지 않는다', async () => {
  mocks.resolve.mockResolvedValueOnce({ ok: false, error: '상품을 조회할 권한이 필요합니다.' });
  render();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  const after = render();
  expect(goodText(after, 'qa-pr9')).toBe('qa-pr9저장된 상품');
  expect(after.some(node => node.props['data-display-hidden-goods'] !== undefined)).toBe(false);
});
