import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, search: '' }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
  useActionState: () => [{}, vi.fn(), false],
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(hooks.search) }));
vi.mock('@/app/admin/campaign-actions', () => ({ upsertAdminCampaignAction: vi.fn() }));

import { CampaignScreen } from './CampaignScreen';
import { CampaignSection } from '@/components/admin/sections/CampaignSection';
import type { AdminCampaignRecord } from '@/lib/admin/campaigns';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const record = (id: string): AdminCampaignRecord => ({
  id, kind: 'event', title: `캠페인 ${id}`, subtitle: null, status: 'published', startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-30T00:00:00.000Z',
  heroImagePath: null, cardImagePath: null, bannerImagePath: null, featuredOrder: null, sections: [], updatedAt: '2026-11-01T00:00:00.000Z',
});
const records = [record('qa-open'), record('qa-later')];
function section() { hooks.index = 0; return nodes(CampaignScreen({ offers: [], pools: [], records, canManageOffers: false })).find(node => node.type === CampaignSection)!; }
const replaceState = vi.fn();

beforeEach(() => { hooks.states = []; hooks.index = 0; hooks.search = ''; replaceState.mockClear(); vi.stubGlobal('window', { history: { replaceState } }); });
afterEach(() => { vi.unstubAllGlobals(); });

/* QA1 MD: 캠페인에서 연 할인 프로모션 화면의 돌아가기·뒤로 가기가 캠페인 목록이 아니라 그 캠페인 편집으로 온다. */
it('주소의 ?campaign=으로 그 캠페인 편집을 열고, 고르거나 닫으면 주소를 맞춘다', () => {
  hooks.search = 'campaign=qa-open';
  expect(section().props.selected).toMatchObject({ id: 'qa-open' });
  (section().props.onSelect as (record: { id: string } | null) => void)({ id: 'qa-later' });
  expect(section().props.selected).toMatchObject({ id: 'qa-later' });
  expect(replaceState).toHaveBeenLastCalledWith(null, '', '/admin/display/campaigns?campaign=qa-later');
  (section().props.onSelect as (record: { id: string } | null) => void)(null);
  expect(section().props.selected).toBeNull();
  expect(replaceState).toHaveBeenLastCalledWith(null, '', '/admin/display/campaigns');
});

it('주소가 없거나 모르는 캠페인이면 지금처럼 목록으로 연다', () => {
  expect(section().props.selected).toBeNull();
  hooks.states = []; hooks.search = 'campaign=deleted-campaign';
  expect(section().props.selected).toBeNull();
  expect(replaceState).not.toHaveBeenCalled();
});
