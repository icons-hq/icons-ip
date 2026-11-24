import { Children, isValidElement, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { StoreSettingsSnapshot } from '@/lib/admin/store-settings';
const mocks = vi.hoisted(() => ({ save: vi.fn(), states: [] as unknown[], index: 0, tasks: [] as Promise<void>[] }));
vi.mock('@/app/admin/store-navigation-actions', () => ({ saveStoreNavigationAction: mocks.save }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual,
    useState: (initial: unknown) => {
      const index = mocks.index++;
      if (!(index in mocks.states)) mocks.states[index] = initial;
      return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
    },
    useTransition: () => [false, (action: () => Promise<void>) => { mocks.tasks.push(action()); }],
    useRef: (current: unknown) => ({ current }),
    useEffect: () => {},
  };
});
import { StoreNavigationForm } from './StoreNavigationForm';
import { Button } from '@/components/admin/kit/ui/button';
import { DEFAULT_STORE_NAVIGATION } from '@/lib/store-navigation';
const initialStamp = '2026-10-13T01:00:00.000001Z';
const operation = '00000000-0000-4000-8000-000000019001';
const settings: StoreSettingsSnapshot = { business: {}, bankTransfer: null, inquiryAutoReplies: { order: { enabled: false, body: '' }, claim: { enabled: false, body: '' }, good: { enabled: false, body: '' }, account: { enabled: false, body: '' }, etc: { enabled: false, body: '' } }, navigation: [...DEFAULT_STORE_NAVIGATION].reverse(), updatedAt: initialStamp };
function form(updatedAt = initialStamp) {
  mocks.index = 0;
  return StoreNavigationForm({ settings: { ...settings, updatedAt }, canEdit: true, operationId: operation }) as ReactElement<{ onSubmit: (event: FormEvent<HTMLFormElement>) => void }>;
}
function submit(element: ReturnType<typeof form>) {
  element.props.onSubmit({ preventDefault: vi.fn() } as unknown as FormEvent<HTMLFormElement>);
  return mocks.tasks.at(-1);
}
beforeEach(() => { mocks.states = []; mocks.index = 0; mocks.tasks = []; mocks.save.mockReset(); });
it('전송 실패와 서버 재조회 후에도 메뉴 초안·기준 버전·동일 요청을 보존한다', async () => {
  mocks.save.mockRejectedValueOnce(new Error('network lost'));
  await expect(submit(form())).resolves.toBeUndefined();
  expect(mocks.states[3]).toMatchObject({ error: expect.stringContaining('입력값을 유지') });
  expect(mocks.states[0]).toEqual(settings.navigation);
  mocks.save.mockResolvedValueOnce({ message: '저장했습니다.', updatedAt: '2026-10-13T03:00:00.000001Z' });
  await submit(form('2026-10-13T02:00:00.000001Z'));
  expect(mocks.save.mock.calls).toHaveLength(2);
  for (const [payload, stamp, id] of mocks.save.mock.calls) {
    expect(payload).toEqual(settings.navigation); expect(stamp).toBe(initialStamp); expect(id).toBe(operation);
  }
  expect(mocks.states[1]).toBe('2026-10-13T03:00:00.000001Z');
});
/* kit Button은 type을 주지 않으면 type="button"이라 폼을 제출하지 않는다 — 저장만 제출하고 순서 이동은 제출하지 않는다. */
it('공개 메뉴 저장 버튼만 폼을 제출한다', () => {
  const nodes = (node: ReactNode): ReactElement<Record<string, unknown>>[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
  const buttons = nodes(form()).filter(node => node.type === Button);
  expect(buttons.filter(node => node.props.type === 'submit').map(node => node.props.children)).toEqual(['공개 메뉴 저장']);
  expect(buttons.filter(node => node.props.type !== 'button' && node.props.type !== 'submit')).toEqual([]);
});
/* X SQUARE GNB(ADR-0043): 저장 계약은 9개(popups 추가)지만 카드팩은 2026-11-24 지운 퇴역 칸(ADR-0052)이라 그리지 않는다 —
   남은 8개를 한 줄씩 그리고, POP-UP이 무엇인지 한 줄로 알린다. 저장 값에는 카드팩 칸이 그대로 실린다(위 저장 시험). */
const labels = (tree: ReactElement<Record<string, unknown>>[]) => tree
  .filter(node => node.type === 'label' || (typeof node.type !== 'string' && typeof node.props.htmlFor === 'string'))
  .map(node => Children.toArray(node.props.children as ReactNode).join(''));
it('퇴역한 카드팩 칸을 뺀 메뉴 8개를 한 줄씩 그리고 POP-UP 안내를 둔다', () => {
  const nodes = (node: ReactNode): ReactElement<Record<string, unknown>>[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
  const tree = nodes(form());
  /* Children.toArray 가 키 앞에 '.$' 를 붙인다. */
  const rows = tree.filter(node => node.type === 'li' && String(node.props.className).startsWith('grid'));
  expect(rows.map(node => String(node.key).replace(/^\.\$/, ''))).toEqual(['stories', 'community', 'iphub', 'events', 'popups', 'shop', 'best', 'new']);
  expect(labels(tree)).not.toContain('카드팩 메뉴명');
  expect(labels(tree)).toContain('POP-UP 메뉴명');
  expect(tree.some(node => node.type === 'p' && typeof node.props.children === 'string' && node.props.children.includes('POP-UP은 진행 중인 온·오프라인 팝업'))).toBe(true);
});
