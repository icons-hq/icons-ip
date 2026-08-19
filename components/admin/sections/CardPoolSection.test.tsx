import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminCardPoolRecord, AdminCardRecord } from '@/lib/admin/catalog.server';
import { CardPoolSection, poolOddsTotalMilliPercent } from './CardPoolSection';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/app/admin/actions', () => ({
  setAdminPoolOddsAction: vi.fn(),
  upsertAdminCardPoolAction: vi.fn(),
}));

const pool: AdminCardPoolRecord = {
  id: '11111111-1111-4111-8111-111111111111',
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

const card: AdminCardRecord = {
  id: 'c100',
  archivedAt: null,
  ipId: 'hwasan',
  poolId: pool.id,
  name: '청명 홀로 카드',
  no: '001/120',
  rarity: 'HOLO',
  bg: null,
  imagePath: null,
};

function renderPool(
  selected: AdminCardPoolRecord | null = pool,
  cards: AdminCardRecord[] = [card],
  records: AdminCardPoolRecord[] = [pool],
  ipOptions = [{ id: 'hwasan', title: '화산강림', archivedAt: null as string | null }],
) {
  return renderToStaticMarkup(
    <CardPoolSection
      cards={cards}
      draftActiveFrom="2026-07-15T02:00:00.000Z"
      draftId="22222222-2222-4222-8222-222222222222"
      ipOptions={ipOptions}
      oddsOperationId="33333333-3333-4333-8333-333333333333"
      onSelect={vi.fn()}
      operationId="44444444-4444-4444-8444-444444444444"
      records={records}
      selected={selected}
    />,
  );
}

describe('CardPoolSection', () => {
  it('renders KST operating fields, live 100% total, and the current card roster', () => {
    const html = renderPool();

    expect(html).toContain('aria-label="카드풀 목록"');
    expect(html).toContain('운영 중');
    expect(html).toContain('value="2026-07-15T09:00"');
    expect(html).toContain('name="oddsR"');
    expect(html).toContain('value="70"');
    expect(html).toContain('합계 100% · 저장 가능');
    expect(html).toContain('청명 홀로 카드');
    expect(html).toContain('카드 편집');
  });

  /*
   * 카드 편집은 부모 상태를 바꾸는 콜백이 아니라 카드 화면 딥링크다.
   * 화면별 라우트에서는 두 화면이 상태를 공유하지 않으므로 링크가 유일한 이동 수단이다.
   */
  it('카드 편집을 카드 화면 딥링크로 건다', () => {
    const html = renderPool(pool, [{ ...card, id: 'c 100/&' }]);

    expect(html).toContain('href="/admin/catalog/cards?cardId=c%20100%2F%26"');
    expect(html).not.toContain('<button class="btn"');
  });

  it('warns that odds changes affect unopened card packs immediately', () => {
    const html = renderPool();

    expect(html).toContain('미사용 카드팩도 개봉 시점의 최신 구성과 확률');
  });

  it('requires a saved pool before odds can be edited', () => {
    const html = renderPool(null, [], []);

    expect(html).toContain('카드풀을 먼저 저장해주세요.');
    expect(html).toContain('disabled=""');
    expect(html).toContain('value="22222222-2222-4222-8222-222222222222"');
  });

  it('surfaces a positive rarity without a bound card', () => {
    const html = renderPool(pool, []);

    expect(html).toContain('HOLO 등급 카드가 없습니다.');
  });

  it('keeps archived roster history without counting it as an issuable rarity', () => {
    const html = renderPool(pool, [{
      ...card,
      archivedAt: '2026-07-17T12:00:00.000Z',
    }]);

    expect(html).toContain('HOLO 등급 카드가 없습니다.');
    expect(html).toContain('[보관] 청명 홀로 카드');
  });

  it('shows an explicit warning before a pool has any configured odds', () => {
    const html = renderPool({
      ...pool,
      oddsConfigured: false,
      odds: { N: 0, R: 0, SR: 0, SSR: 0, HOLO: 0 },
    });

    expect(html).toContain('등급별 발급 확률이 아직 설정되지 않았습니다.');
  });

  it('preserves an archived current IP but disables it for new pools', () => {
    const archivedIps = [{
      id: 'hwasan',
      title: '화산강림',
      archivedAt: '2026-07-17T12:00:00.000Z',
    }];
    const existing = renderPool(pool, [card], [pool], archivedIps);
    const creating = renderPool(null, [], [], archivedIps);

    expect(existing).toContain('value="hwasan" selected="">[보관] 화산강림');
    expect(existing).not.toContain('disabled="" value="hwasan" selected=""');
    expect(creating).toContain('<option value="" selected="">선택</option>');
    expect(creating).toContain('disabled="" value="hwasan">[보관] 화산강림');
    expect(creating).toContain('먼저 IP를 등록해주세요.');
  });

  it('defaults a new pool to the first active IP when an archived IP sorts first', () => {
    const html = renderPool(null, [], [], [
      { id: 'archived', title: '보관 IP', archivedAt: '2026-07-17T12:00:00.000Z' },
      { id: 'active', title: '운영 IP', archivedAt: null },
    ]);

    expect(html).toContain('disabled="" value="archived">[보관] 보관 IP');
    expect(html).toContain('value="active" selected="">운영 IP');
  });

  it('calculates exact milli-percent totals and rejects transient invalid input', () => {
    expect(poolOddsTotalMilliPercent({ N: '0', R: '70', SR: '0', SSR: '20.125', HOLO: '9.875' })).toBe(100_000);
    expect(poolOddsTotalMilliPercent({ N: '0', R: '', SR: '0', SSR: '20', HOLO: '10' })).toBeNull();
    expect(poolOddsTotalMilliPercent({ N: '0', R: '70.0001', SR: '0', SSR: '20', HOLO: '10' })).toBeNull();
  });
});
