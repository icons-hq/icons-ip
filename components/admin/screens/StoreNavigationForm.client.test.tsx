import type { FormEvent, ReactElement } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { StoreSettingsSnapshot } from '@/lib/admin/store-settings';
const mocks = vi.hoisted(() => ({ save: vi.fn(), states: [] as unknown[], index: 0, tasks: [] as Promise<void>[] }));
vi.mock('@/app/admin/store-navigation-actions', () => ({ saveStoreNavigationAction: mocks.save }));
vi.mock('@/components/shell/CardRewardAvailability', () => ({ useCardRewardsEnabled: () => false }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual,
    useState: (initial: unknown) => {
      const index = mocks.index++;
      if (!(index in mocks.states)) mocks.states[index] = initial;
      return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
    },
    useTransition: () => [false, (action: () => Promise<void>) => { mocks.tasks.push(action()); }],
  };
});
import { StoreNavigationForm } from './StoreNavigationForm';
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
