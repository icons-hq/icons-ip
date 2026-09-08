import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import { normalizeAdminCardListFilters, emptyAdminCardList } from '@/lib/admin/catalog-list';
import { CardScreen } from './CardScreen';

/* 규모 후속 — 카드 화면은 굿즈·IP 와 같은 규칙이다: `?selected=` 가 목록과 편집을 가른다. */
const mocks = vi.hoisted(() => ({
  cardSection: vi.fn<(props: unknown) => null>(() => null),
  cardConsole: vi.fn<(props: unknown) => null>(() => null),
}));

vi.mock('@/app/admin/actions', () => ({ upsertAdminCardAction: vi.fn() }));
vi.mock('@/components/admin/sections/CardSection', () => ({ CardSection: mocks.cardSection }));
vi.mock('@/components/admin/catalog/CardConsole', () => ({ CardConsole: mocks.cardConsole }));

const card: AdminCatalogRecords['cards'][number] = {
  id: 'c100', archivedAt: null, ipId: 'hwasan', poolId: 'pool-1', name: '청명 홀로 카드', no: '001/120',
  rarity: 'HOLO', bg: null, imagePath: null,
};
const pool: AdminCatalogRecords['cardPools'][number] = {
  id: 'pool-1', ipId: 'hwasan', name: '화산강림 무상 리워드 풀', activeFrom: '2026-07-15T00:00:00.000Z', activeTo: null,
  updatedAt: '2026-07-15T01:00:00.000Z', status: 'active', oddsConfigured: true, rewardReady: true,
  odds: { N: 0, R: 0.7, SR: 0, SSR: 0.2, HOLO: 0.1 },
};
const ipOptions = [{ id: 'hwasan', title: '화산강림', archivedAt: null }];

function renderScreen(query: Record<string, string> = {}, records = [card]) {
  const filters = normalizeAdminCardListFilters(query);
  renderToStaticMarkup(
    <CardScreen filters={filters} ipOptions={ipOptions} list={emptyAdminCardList(filters)} pools={[pool]} records={records} />,
  );
}

describe('CardScreen', () => {
  beforeEach(() => {
    mocks.cardSection.mockClear();
    mocks.cardConsole.mockClear();
  });

  it('selected 가 없으면 목록 콘솔만 그린다', () => {
    renderScreen();
    expect(mocks.cardConsole).toHaveBeenCalledTimes(1);
    expect(mocks.cardSection).not.toHaveBeenCalled();
  });

  it('selected 가 레코드와 맞으면 편집 폼에 IP·카드풀 선택지를 좁혀 넘긴다', () => {
    renderScreen({ selected: 'c100' });
    const props = mocks.cardSection.mock.calls[0][0] as {
      selected: { id: string } | null;
      ipOptions: unknown;
      poolOptions: { id: string; ipId: string; name: string }[];
    };
    expect(props.selected).toMatchObject({ id: 'c100' });
    expect(props.ipOptions).toEqual(ipOptions);
    expect(props.poolOptions).toEqual([{ id: 'pool-1', ipId: 'hwasan', name: '화산강림 무상 리워드 풀' }]);
  });

  /* 낡은 링크는 죽지 않고 목록으로 돌아가되, 어떤 id 를 못 찾았는지 콘솔이 말한다. */
  it('모르는 selected 는 목록으로 돌아가고 못 찾은 id 를 알린다', () => {
    renderScreen({ selected: 'nope' }, []);
    expect(mocks.cardSection).not.toHaveBeenCalled();
    expect((mocks.cardConsole.mock.calls[0][0] as { missingSelection: string }).missingSelection).toBe('nope');
  });

  it('new 는 빈 등록 폼이다', () => {
    renderScreen({ selected: 'new' }, []);
    expect((mocks.cardSection.mock.calls[0][0] as { selected: unknown }).selected).toBeNull();
  });
});
