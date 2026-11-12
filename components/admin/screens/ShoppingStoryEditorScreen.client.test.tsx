import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useEffect: () => undefined,
  useMemo: (factory: () => unknown) => factory(),
  useTransition: () => [false, (callback: () => unknown) => { void callback(); }],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/admin/shopping-story-actions', () => ({ saveShoppingStoryAction: mocks.save, searchShoppingStoryGoodsAction: vi.fn() }));
vi.mock('../ShoppingStoryBodyEditor', () => ({ ShoppingStoryBodyEditor: () => null }));

import { ShoppingStoryEditorScreen } from './ShoppingStoryEditorScreen';
import { Button } from '@/components/admin/kit/ui/button';
import type { AdminShoppingStory } from '@/lib/admin/shopping-stories';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const story: AdminShoppingStory = {
  id: '6f1c2a9e-3d4b-4c5d-8e6f-7a8b9c0d1e2f', reference: 3, title: 'QA 스토리', startsAt: null, endsAt: null, state: 'active', revision: 2,
  createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z', sectionCount: 0, goodCount: 0, bodyHtml: '<p>QA 스토리 본문입니다.</p>', imagePaths: [], sections: [], goods: [],
};
function render() { hooks.index = 0; hooks.refIndex = 0; return nodes(ShoppingStoryEditorScreen({ accountId: '11111111-1111-4111-8111-111111111111', draftId: story.id, initial: story })); }
const saveBar = () => render().find(node => node.props['data-admin-savebar'] !== undefined)!;
async function save() {
  (nodes(saveBar().props.children as ReactNode).find(node => node.type === Button && text(node.props.children as ReactNode) === '저장')!.props.onClick as () => void)();
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

beforeEach(() => { hooks.states = []; hooks.index = 0; hooks.refs = []; hooks.refIndex = 0; vi.clearAllMocks(); });

/* QA1 MD(기존 동작): 하단 고정 [저장]을 누르면 결과가 폼 맨 아래(화면 밖)에 떠서 스크롤해야 보였다 — 누른 버튼 바로 위 저장 막대에 보인다. */
it('저장 완료 안내를 누른 [저장]이 있는 저장 막대 안에 보인다', async () => {
  mocks.save.mockResolvedValueOnce({ ok: true, story: { ...story, revision: 3 }, warnings: [] });
  await save();
  const message = nodes(saveBar().props.children as ReactNode).find(node => node.props['data-story-save-message'] === 'saved')!;
  expect(message.props.role).toBe('status');
  expect(text(message.props.children as ReactNode)).toBe('저장한 내용을 다시 확인했습니다.');
});

it('저장이 막힌 이유도 저장 막대 안에 보인다', async () => {
  mocks.save.mockResolvedValueOnce({ ok: false, error: '다른 매니저가 이 스토리를 변경했습니다. 입력은 유지됩니다. 최신 저장 내용을 확인한 뒤 다시 저장해주세요.' });
  await save();
  const message = nodes(saveBar().props.children as ReactNode).find(node => node.props['data-story-save-message'] === 'error')!;
  expect(message.props.role).toBe('alert');
  expect(text(message.props.children as ReactNode)).toContain('다른 매니저가 이 스토리를 변경했습니다.');
});
