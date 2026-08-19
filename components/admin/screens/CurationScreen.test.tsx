import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCurationRecord } from '@/lib/admin/curations.server';
import { CurationScreen } from './CurationScreen';

const mocks = vi.hoisted(() => ({
  curationSection: vi.fn(() => null),
  selectedId: null as string | null,
  setSelectedId: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: () => [mocks.selectedId, mocks.setSelectedId],
  };
});
vi.mock('@/components/admin/sections/CurationSection', () => ({
  CurationSection: mocks.curationSection,
}));

const record: AdminCurationRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'announcement',
  ipId: null,
  title: '서비스 점검 안내',
  imagePath: null,
  imageUrl: null,
  linkPath: '/notice/maintenance',
  displayOrder: 2,
  activeFrom: '2026-07-15T00:00:00.000Z',
  activeTo: null,
  enabled: true,
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-15T01:00:00.000Z',
  status: 'active',
};

function renderScreen() {
  return CurationScreen({
    draftActiveFrom: '2026-07-15T03:04:05.000Z',
    draftId: '22222222-2222-4222-8222-222222222222',
    eventOptions: [{ id: 'e100', title: '성수 팝업', archivedAt: null }],
    goodOptions: [{ id: 'g13', title: '홍실 아크릴 블록', archivedAt: null }],
    ipOptions: [{ id: 'ip-1', title: '홍실', archivedAt: null }],
    operationId: '33333333-3333-4333-8333-333333333333',
    records: [record],
  });
}

describe('CurationScreen', () => {
  beforeEach(() => {
    mocks.curationSection.mockClear();
    mocks.selectedId = null;
    mocks.setSelectedId.mockReset();
  });

  it('선택 전에는 신규 작성 상태로 섹션에 넘긴다', () => {
    const tree = renderScreen();

    expect(tree.type).toBe(mocks.curationSection);
    expect(tree.props).toMatchObject({
      draftActiveFrom: '2026-07-15T03:04:05.000Z',
      draftId: '22222222-2222-4222-8222-222222222222',
      operationId: '33333333-3333-4333-8333-333333333333',
      records: [record],
      selected: null,
    });
  });

  it('선택한 id를 최신 레코드로 되찾아 넘긴다', () => {
    mocks.selectedId = record.id;

    expect(renderScreen().props).toMatchObject({ selected: record });
  });

  /* revalidate로 사라진 레코드를 계속 선택 상태로 두면 폼이 유령 id를 저장한다. */
  it('목록에 없는 id는 선택 없음으로 떨어뜨린다', () => {
    mocks.selectedId = '99999999-9999-4999-8999-999999999999';

    expect(renderScreen().props).toMatchObject({ selected: null });
  });

  it('섹션의 선택 콜백이 id만 상태에 남긴다', () => {
    const tree = renderScreen();

    (tree.props as { onSelect: (curation: AdminCurationRecord | null) => void }).onSelect(record);
    expect(mocks.setSelectedId).toHaveBeenLastCalledWith(record.id);

    (tree.props as { onSelect: (curation: AdminCurationRecord | null) => void }).onSelect(null);
    expect(mocks.setSelectedId).toHaveBeenLastCalledWith(null);
  });
});
