import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminCardRecord } from '@/lib/admin/catalog.server';
import { CardSection } from './CardSection';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('../../../app/admin/archive-actions', () => ({
  archiveAdminCatalogRecordAction: vi.fn(),
  unarchiveAdminCatalogRecordAction: vi.fn(),
}));
vi.mock('../../../lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: vi.fn() }));
vi.mock('@/lib/rarity', () => ({
  RARITY_META: { N: {}, R: {}, SR: {}, SSR: {}, HOLO: {} },
}));

const selected: AdminCardRecord = {
  id: 'c100',
  archivedAt: null,
  ipId: 'hwasan',
  poolId: '11111111-1111-4111-8111-111111111111',
  name: '청명 홀로 카드',
  no: '001/120',
  rarity: 'HOLO',
  bg: null,
  imagePath: null,
};

function renderCard(selectedCard: AdminCardRecord | null = selected) {
  return renderToStaticMarkup(
    <CardSection
      action={vi.fn()}
      ipOptions={[
        { id: 'hwasan', title: '화산강림', archivedAt: null },
        { id: 'lumen', title: '루멘', archivedAt: null },
      ]}
      onSelect={vi.fn()}
      pending={false}
      poolOptions={[
        { id: '11111111-1111-4111-8111-111111111111', ipId: 'hwasan', name: '화산강림 풀' },
        { id: '22222222-2222-4222-8222-222222222222', ipId: 'lumen', name: '루멘 풀' },
      ]}
      records={selectedCard ? [selectedCard] : []}
      selected={selectedCard}
      state={{}}
    />,
  );
}

describe('CardSection', () => {
  it('shows only same-IP pools and keeps an explicit unbound option', () => {
    const html = renderCard();

    expect(html).toContain('name="poolId"');
    expect(html).toContain('화산강림 풀');
    expect(html).not.toContain('루멘 풀');
    expect(html).toContain('풀 미지정');
    expect(html).toContain('value="11111111-1111-4111-8111-111111111111" selected=""');
  });

  it('locks pooled card IP and rarity until the binding is removed', () => {
    const html = renderCard();

    expect(html).toContain('aria-readonly="true"');
    expect(html).toContain('먼저 풀을 해제한 뒤 IP·등급을 변경');
    expect(html).toContain('name="ipId"');
    expect(html).toContain('name="rarity"');
  });

  it('renders editable IP and rarity selectors for a new card', () => {
    const html = renderCard(null);

    expect(html).toContain('<select');
    expect(html).toContain('name="ipId"');
    expect(html).toContain('name="rarity"');
    expect(html).not.toContain('aria-readonly="true"');
  });

  it('renders a freshly unbound existing card with its IP preserved and no pool selected', () => {
    const html = renderCard({ ...selected, poolId: null });

    expect(html).toContain('name="ipId"');
    expect(html).toContain('value="hwasan" selected=""');
    expect(html).toContain('<option value="" selected="">풀 미지정</option>');
    expect(html).not.toContain('aria-readonly="true"');
  });

  it('uses the shared artwork upload field', () => {
    const html = renderCard();

    expect(html).toContain('data-artwork-kind="card"');
    expect(html).toContain('name="imagePath"');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
  });

  it('shows archive status and restoration for an archived card', () => {
    const archived = { ...selected, archivedAt: '2026-07-17T12:00:00.000Z' };
    const html = renderCard(archived);

    expect(html).toContain('aria-label="보관 상태"');
    expect(html).toContain('[보관] c100 · 청명 홀로 카드');
    expect(html).toContain('보관 복원');
    expect(html).toContain('value="card"');
  });
});
