import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminCardRecord } from '@/lib/admin/catalog.server';
import type { AdminCatalogActionState } from '@/app/admin/actions';
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

function renderCard(selectedCard: AdminCardRecord | null = selected, state: AdminCatalogActionState = {}) {
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
      state={state}
    />,
  );
}

describe('CardSection', () => {
  it('restores a failed new card including its IP, pool, rarity and uploaded image path', () => {
    const html = renderCard(null, {
      attempt: 2, errors: { name: '저장 실패' },
      values: { previousId: '', id: 'c200', name: '작성 중 카드', no: '005/100',
        ipId: 'lumen', rarity: 'SSR', poolId: '22222222-2222-4222-8222-222222222222',
        imagePath: 'artworks/card/kept.webp' },
    });
    for (const value of ['c200', '작성 중 카드', '005/100', 'artworks/card/kept.webp']) {
      expect(html).toContain(`value="${value}"`);
    }
    expect(html).toContain('value="lumen" selected=""');
    expect(html).toContain('value="SSR" selected=""');
    expect(html).toContain('value="22222222-2222-4222-8222-222222222222" selected=""');
  });

  it('does not use another record or a failed new card as the selected card defaults', () => {
    const html = renderCard(selected, {
      attempt: 3, values: { previousId: '', name: '다른 카드 입력', imagePath: 'artworks/card/other.webp' },
    });
    expect(html).toContain('value="청명 홀로 카드"');
    expect(html).not.toContain('다른 카드 입력');
    expect(html).not.toContain('artworks/card/other.webp');
  });
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

  it('입력 묶음 맨 위 제목이 새 등록과 수정을 가른다', () => {
    expect(renderCard(null)).toContain('>새 카드 등록</h3>');
    expect(renderCard()).toContain('>청명 홀로 카드 수정</h3>');
  });

  it('목록은 번호 순서로 등급·카드풀 연결을 보이고, 카드풀이 없는 카드는 건수 칩과 줄의 주의 배지로 표시한다', () => {
    const unbound = { ...selected, id: 'c2', poolId: null, name: '미연결 카드', rarity: 'N' as const };
    const later = { ...selected, id: 'c10', name: '뒤 번호 카드' };
    const html = renderToStaticMarkup(
      <CardSection action={vi.fn()} ipOptions={[]} onSelect={vi.fn()} pending={false}
        poolOptions={[{ id: selected.poolId as string, ipId: 'hwasan', name: '화산강림 풀' }]} records={[later, unbound]} selected={null} state={{}} />,
    );
    expect(html).toContain('aria-label="카드 목록"');
    expect(html.indexOf('c2 · 미연결 카드')).toBeLessThan(html.indexOf('c10 · 뒤 번호 카드'));
    expect(html).toContain('HOLO · 화산강림 풀');
    expect(html).toMatch(/data-tone="warning"[^>]*>풀 미지정 1장</);
    /* 위 건수가 가리키는 줄이 바로 보여야 한다 — 미지정 줄에만 같은 말의 주의 배지가 붙고, 지정된 줄은 조용하다. */
    expect(html).toMatch(/data-tone="warning"[^>]*>풀 미지정</);
    expect(html.match(/data-tone="warning"/g)).toHaveLength(2);
    const row = (code: string) => html.split('<button').find(part => part.includes(`>${code} ·`)) ?? '';
    expect(row('c10')).not.toContain('data-tone');
  });

  it('보관된 카드는 카드풀이 없어도 풀 미지정으로 재촉하지 않는다', () => {
    const archived = { ...selected, poolId: null, archivedAt: '2026-07-17T12:00:00.000Z' };
    const html = renderToStaticMarkup(
      <CardSection action={vi.fn()} ipOptions={[]} onSelect={vi.fn()} pending={false} poolOptions={[]} records={[archived]} selected={archived} state={{}} />,
    );
    expect(html).toMatch(/data-tone="neutral"[^>]*>보관</);
    expect(html).not.toContain('data-tone="warning"');
  });

  it('아무것도 고르지 않으면 오른쪽은 안내만 보이고, 등록을 시작했거나 카드를 고르면 입력 칸이 열린다', () => {
    const render = (props: { creating?: boolean; picked?: AdminCardRecord | null }) => renderToStaticMarkup(
      <CardSection action={vi.fn()} creating={props.creating} ipOptions={[]} onSelect={vi.fn()} pending={false} poolOptions={[]} records={[selected]} selected={props.picked ?? null} state={{}} />,
    );
    const idle = render({});
    expect(idle).toContain('목록에서 카드를 고르면 여기에서 수정합니다.');
    /* 저장 실패 복원·리마운트 키가 그대로 동작하도록 폼은 DOM에 남고 숨기기만 한다. */
    expect(idle).toMatch(/<div class="hidden" data-record-detail="form"><form/);
    for (const html of [render({ creating: true }), render({ picked: selected })]) {
      expect(html).not.toContain('data-record-detail="prompt"');
      expect(html).toMatch(/<div class="contents" data-record-detail="form"><form/);
    }
  });
});
