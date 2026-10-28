import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import { preservedFormValues, resolveFieldDefault } from '@/lib/admin/form-state';

/*
 * 등록 화면(R13·D6②)은 처음 저장한 뒤 주소만 ?goodId=로 바꾸고 같은 화면(key)을 이어 쓴다. 그 뒤 같은 화면에서 다시
 * 저장이 실패하면 액션 상태에서 savedGoodId가 빠진다. 그때도 화면은 방금 저장한 상품을 고치는 중이어야 한다 —
 * 신규 등록 화면으로 뒤집히면 실패한 입력이 사라지고(previousId 불일치), 다시 저장하면 같은 상품이 한 번 더 등록된다.
 */

const hooks = vi.hoisted(() => ({
  scope: 'screen',
  stores: {} as Record<string, unknown[]>,
  index: 0,
  effects: [] as (() => void | (() => void))[],
  action: { state: {} as Record<string, unknown>, pending: false },
}));
const mocks = vi.hoisted(() => ({ replace: vi.fn(), bind: vi.fn(), discard: vi.fn() }));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: () => [hooks.action.state, () => undefined, hooks.action.pending],
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
    useMemo: (factory: () => unknown) => factory(),
    useState: (initial: unknown) => {
      const store = (hooks.stores[hooks.scope] ??= []);
      const index = hooks.index++;
      if (!(index in store)) store[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [store[index], (next: unknown) => {
        store[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(store[index]) : next;
      }];
    },
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/app/admin/actions', () => ({ upsertAdminGoodAction: () => undefined }));
vi.mock('@/components/admin/sections/GoodSection', () => ({ GoodSection: () => null }));
vi.mock('../useGoodsKcTemplate', () => ({
  GoodsKcTemplateProvider: ({ children }: { children: ReactNode }) => children,
  useGoodsKcTemplate: () => ({ bindSavedGood: mocks.bind, discard: mocks.discard }),
}));

import { GoodScreen } from './GoodScreen';

type ScreenProps = Parameters<typeof GoodScreen>[0];
type FormElement = ReactElement<Record<string, unknown>> & { type: (props: Record<string, unknown>) => ReactElement<{ selected: AdminGoodRecord | null; state: Record<string, unknown>; pending: boolean }> };

let mountedFormKey: string | null = null;

/** GoodScreen과 그 안의 폼을 그리고, 폼 key가 바뀌면 React처럼 폼 상태를 새로 시작한다. 렌더 중 상태 갱신은 다시 그린다. */
function render(props: ScreenProps) {
  let tree: ReactElement<{ children: FormElement }> | null = null;
  for (let pass = 0; pass < 5; pass += 1) {
    const before = JSON.stringify(hooks.stores.screen ?? []);
    hooks.scope = 'screen'; hooks.index = 0;
    tree = GoodScreen(props) as ReactElement<{ children: FormElement }>;
    if (JSON.stringify(hooks.stores.screen ?? []) === before) break;
  }
  const form = tree!.props.children;
  if (!isValidElement(form)) throw new Error('GoodScreenForm이 없습니다.');
  if (form.key !== mountedFormKey) { hooks.stores.form = []; mountedFormKey = form.key; }
  hooks.scope = 'form'; hooks.index = 0; hooks.effects = [];
  const section = form.type(form.props);
  for (const effect of hooks.effects.splice(0)) effect();
  return { formKey: form.key, section };
}

const saved = { id: 'g-new', name: '처음 저장한 상품', code: 'NEW-0001', archivedAt: null } as unknown as AdminGoodRecord;
const base: ScreenProps = {
  adjustmentId: 'adjustment', catalogIps: [], ips: [], records: [], variants: [],
  hideRecordList: true, listHref: '/admin/catalog/goods',
};

beforeEach(() => {
  hooks.stores = {}; hooks.effects = []; hooks.action = { state: {}, pending: false };
  mountedFormKey = null;
  vi.clearAllMocks();
});

it('등록 화면에서 처음 저장한 뒤 같은 화면에서 다시 저장이 실패해도 저장된 상품을 계속 고치고 실패 입력을 되살린다', () => {
  let view = render(base);
  expect(view.section.props.selected).toBeNull();
  const createKey = view.formKey;

  hooks.action.state = { savedGoodId: saved.id, message: '저장했습니다.' };
  view = render({ ...base, records: [saved] });
  expect(view.section.props.selected?.id).toBe(saved.id);
  expect(mocks.replace).toHaveBeenCalledWith('/admin/catalog/goods?goodId=g-new', { scroll: false });

  /* 주소가 ?goodId=로 바뀌어도 같은 화면(key)을 이어 쓴다(R13). */
  const adopted = { ...base, records: [saved], initialSelectedId: saved.id };
  view = render(adopted);
  expect(view.formKey).toBe(createKey);
  expect(view.section.props.selected?.id).toBe(saved.id);

  /* 대표 이미지 없이 '저장 후 공개' — 서버가 거절하면 상태에 savedGoodId 없이 제출값만 남는다. */
  hooks.action.state = { errors: { form: '대표 이미지를 등록해야 공개할 수 있습니다.' }, values: { previousId: saved.id, name: '고친 이름' }, attempt: 1 };
  view = render(adopted);
  expect(view.formKey).toBe(createKey);
  const { selected, state, pending } = view.section.props;
  expect(selected?.id).toBe(saved.id);
  expect(pending).toBe(false);
  expect(preservedFormValues(state, selected?.id)?.name).toBe('고친 이름');
  expect(resolveFieldDefault(state, selected, 'name')).toBe('고친 이름');
  /* 다시 저장하면 편집기의 previousId(선택 상품 id)가 실려 같은 상품을 고친다 — 새 상품으로 한 번 더 등록되지 않는다. */
  expect(readFileSync(join(process.cwd(), 'components/admin/GoodEditor.tsx'), 'utf8')).toContain('<input name="previousId" type="hidden" value={selected?.id ?? \'\'} />');

  /* 다시 저장에 성공하면 주소는 이미 그 상품이라 이동하지 않는다. */
  mocks.replace.mockClear();
  hooks.action.state = { savedGoodId: saved.id, message: '저장했습니다.' };
  view = render(adopted);
  expect(view.section.props.selected?.id).toBe(saved.id);
  expect(mocks.replace).not.toHaveBeenCalled();
});

it('다른 상품이나 새 등록으로 옮기면 새 화면으로 시작한다', () => {
  hooks.action.state = { savedGoodId: saved.id };
  const first = render({ ...base, records: [saved] });
  render({ ...base, records: [saved], initialSelectedId: saved.id });
  const other = { ...saved, id: 'g-other' } as AdminGoodRecord;
  hooks.action.state = {};
  const moved = render({ ...base, records: [saved, other], initialSelectedId: other.id });
  expect(moved.formKey).not.toBe(first.formKey);
  expect(moved.section.props.selected?.id).toBe(other.id);
});

it('상품 수정 화면은 처음부터 주소의 상품을 고치고, 저장 실패에도 그 상품을 유지한다', () => {
  const edit = { ...base, records: [saved], initialSelectedId: saved.id };
  expect(render(edit).section.props.selected?.id).toBe(saved.id);
  hooks.action.state = { errors: { form: '저장하지 못했습니다.' }, values: { previousId: saved.id, name: '수정 중' }, attempt: 1 };
  const failed = render(edit);
  expect(failed.section.props.selected?.id).toBe(saved.id);
  expect(preservedFormValues(failed.section.props.state, saved.id)?.name).toBe('수정 중');
  expect(mocks.replace).not.toHaveBeenCalled();
});
