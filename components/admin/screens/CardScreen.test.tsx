import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import { CardScreen } from './CardScreen';

const mocks = vi.hoisted(() => ({
  /* props를 받는 것으로 선언해야 mock.calls[0][0]이 빈 튜플로 좁혀지지 않는다. */
  cardSection: vi.fn<(props: unknown) => null>(() => null),
}));

vi.mock('@/app/admin/actions', () => ({
  upsertAdminCardAction: vi.fn(),
}));
vi.mock('@/components/admin/sections/CardSection', () => ({
  CardSection: mocks.cardSection,
}));

const card: AdminCatalogRecords['cards'][number] = {
  id: 'c100',
  archivedAt: null,
  ipId: 'hwasan',
  poolId: 'pool-1',
  name: '청명 홀로 카드',
  no: '001/120',
  rarity: 'HOLO',
  bg: null,
  imagePath: null,
};

const ip: AdminCatalogRecords['ips'][number] = {
  id: 'hwasan',
  archivedAt: null,
  title: '화산강림',
  sub: null,
  verticalKey: 'webtoon',
  tagline: null,
  synopsis: null,
  glyph: null,
  bg: null,
  imagePath: null,
  featured: false,
  fansCount: 0,
};

const pool: AdminCatalogRecords['cardPools'][number] = {
  id: 'pool-1',
  ipId: 'hwasan',
  name: '화산강림 무상 리워드 풀',
  activeFrom: '2026-07-15T00:00:00.000Z',
  activeTo: null,
  updatedAt: '2026-07-15T01:00:00.000Z',
  status: 'active',
  oddsConfigured: true,
  rewardReady: true,
  odds: { N: 0, R: 0.7, SR: 0, SSR: 0.2, HOLO: 0.1 },
};

function renderScreen(initialSelectedId?: string | null) {
  renderToStaticMarkup(
    <CardScreen
      initialSelectedId={initialSelectedId}
      ips={[ip]}
      pools={[pool]}
      records={[card]}
    />,
  );
  return mocks.cardSection.mock.calls[0][0] as unknown as {
    ipOptions: { id: string; title: string; archivedAt: string | null }[];
    poolOptions: { id: string; ipId: string; name: string }[];
    selected: AdminCatalogRecords['cards'][number] | null;
  };
}

describe('CardScreen', () => {
  beforeEach(() => {
    mocks.cardSection.mockClear();
  });

  /*
   * 카드풀 화면의 "카드 편집" 링크가 `?cardId=`로 넘겨준 카드는 처음부터 선택돼 있어야 한다.
   * 라우트가 갈라진 뒤로 두 화면이 상태를 공유하지 않으므로 이 값이 유일한 연결 고리다.
   */
  it('딥링크로 받은 카드를 선택 레코드로 섹션에 넘긴다', () => {
    expect(renderScreen('c100').selected).toMatchObject({ id: 'c100', name: '청명 홀로 카드' });
  });

  /* 목록에 없는 id로 들어와도 화면이 죽지 않고 "새 카드" 상태로 열려야 한다. */
  it('모르는 cardId는 선택 없이 연다', () => {
    expect(renderScreen('does-not-exist').selected).toBeNull();
    expect(renderScreen().selected).toBeNull();
  });

  it('IP·카드풀 옵션을 섹션 계약대로 좁혀 넘긴다', () => {
    const props = renderScreen('c100');

    expect(props.ipOptions).toEqual([{ id: 'hwasan', title: '화산강림', archivedAt: null }]);
    expect(props.poolOptions).toEqual([
      { id: 'pool-1', ipId: 'hwasan', name: '화산강림 무상 리워드 풀' },
    ]);
  });
});
