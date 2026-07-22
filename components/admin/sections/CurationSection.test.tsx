import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCurationRecord } from '@/lib/admin/curations.server';
import { CurationSection } from './CurationSection';

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  kindSetter: vi.fn(),
  kindState: null as null | 'hero' | 'featured_ip' | 'announcement',
  notificationAction: vi.fn(),
  reducer: null as unknown,
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (reducer: unknown) => {
      mocks.reducer = reducer;
      return [{}, vi.fn(), false];
    },
    useState: (initial: unknown) => {
      const value = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      if (
        mocks.kindState
        && (value === 'hero' || value === 'featured_ip' || value === 'announcement')
      ) {
        return [mocks.kindState, mocks.kindSetter];
      }
      return actual.useState(initial);
    },
  };
});
vi.mock('@/app/admin/curation-actions', () => ({ upsertAdminCurationAction: mocks.action }));
vi.mock('@/app/admin/notification-actions', () => ({ sendAdminNotificationAction: mocks.notificationAction }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('../../../lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: vi.fn() }));

const activeAnnouncement: AdminCurationRecord = {
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

const ipOptions = [
  { id: 'active-ip', title: '운영 IP', archivedAt: null },
  { id: 'archived-ip', title: '보관 IP', archivedAt: '2026-07-01T00:00:00.000Z' },
];

function renderSection(selected: AdminCurationRecord | null, records = selected ? [selected] : []) {
  return renderToStaticMarkup(
    <CurationSection
      draftActiveFrom="2026-07-15T03:04:05.000Z"
      draftId="22222222-2222-4222-8222-222222222222"
      ipOptions={ipOptions}
      onOpenNotifications={vi.fn()}
      onSelect={vi.fn()}
      operationId="33333333-3333-4333-8333-333333333333"
      records={records}
      selected={selected}
    />,
  );
}

function findElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement | null {
  if (!isValidElement(node)) return null;
  if (predicate(node)) return node;
  const children = (node.props as { children?: ReactNode }).children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

describe('CurationSection', () => {
  beforeEach(() => {
    mocks.action.mockReset();
    mocks.kindSetter.mockReset();
    mocks.kindState = null;
    mocks.notificationAction.mockReset();
    mocks.reducer = null;
  });

  it('목록에 유형·텍스트 상태·순서·KST 운영 윈도를 함께 보여준다', () => {
    const records: AdminCurationRecord[] = [
      activeAnnouncement,
      { ...activeAnnouncement, id: '44444444-4444-4444-8444-444444444444', status: 'scheduled' },
      { ...activeAnnouncement, id: '55555555-5555-4555-8555-555555555555', status: 'ended' },
      { ...activeAnnouncement, id: '66666666-6666-4666-8666-666666666666', status: 'inactive' },
    ];
    const html = renderSection(activeAnnouncement, records);

    expect(html).toContain('홈 큐레이션');
    expect(html).toContain('운영 윈도');
    expect(html).toContain('공지 배너');
    expect(html).toContain('서비스 점검 안내');
    expect(html).toContain('공지 배너 · 노출 중 · 순서 2');
    expect(html).toContain('노출 중');
    expect(html).toContain('노출 예정');
    expect(html).toContain('종료');
    expect(html).toContain('비활성');
    expect(html).toContain('순서 2');
    expect(html).toContain('2026-07-15 09:00 KST');
  });

  it('신규 히어로에 필수 이미지·내부 링크·음수가 아닌 순서·KST 기간·활성 제어를 놓는다', () => {
    const html = renderSection(null);

    expect(html).toContain('name="kind"');
    expect(html).toContain('value="hero"');
    expect(html).toContain('히어로 이미지는 필수입니다.');
    expect(html).toContain('name="linkPath"');
    expect(html).toContain('name="displayOrder"');
    expect(html).toContain('min="0"');
    expect(html).toContain('노출 시작 (KST)');
    expect(html).toContain('노출 종료 (KST, 선택)');
    expect(html).toContain('name="enabled"');
    expect(html).toContain('data-artwork-kind="curation"');
    expect(mocks.reducer).toBe(mocks.action);
  });

  it('특집 IP에서만 IP를 필수로 받고 보관 IP는 선택할 수 없게 한다', () => {
    const featured: AdminCurationRecord = {
      ...activeAnnouncement,
      kind: 'featured_ip',
      ipId: 'active-ip',
      title: '운영 IP 특집',
    };
    const html = renderSection(featured);

    expect(html).toContain('특집 IP 이미지는 선택입니다. 비우면 IP 키아트를 사용합니다.');
    expect(html).toMatch(/<select[^>]*name="ipId"[^>]*required/);
    expect(html).toMatch(/<option disabled="" value="archived-ip">\[보관\] 보관 IP<\/option>/);
  });

  it('특집 IP 레코드에서 다른 영역으로 전환하면 IP 선택기와 현재 IP 안내를 숨긴다', () => {
    const featured: AdminCurationRecord = {
      ...activeAnnouncement,
      kind: 'featured_ip',
      ipId: 'active-ip',
      title: '운영 IP 특집',
    };
    mocks.kindState = 'announcement';

    const html = renderSection(featured);

    expect(html).toContain('공지 배너 이미지는 선택입니다.');
    expect(html).not.toContain('특집할 IP');
    expect(html).not.toContain('현재 특집 IP:');
  });

  it('공지 배너는 이미지가 선택이고 CTA는 공지 발송 화면으로만 이동한다', () => {
    const onOpenNotifications = vi.fn();
    const tree = CurationSection({
      draftActiveFrom: '2026-07-15T03:04:05.000Z',
      draftId: '22222222-2222-4222-8222-222222222222',
      ipOptions,
      onOpenNotifications,
      onSelect: vi.fn(),
      operationId: '33333333-3333-4333-8333-333333333333',
      records: [activeAnnouncement],
      selected: activeAnnouncement,
    });
    const cta = findElement(
      tree,
      (element) => element.type === 'button'
        && (element.props as { className?: string }).className === 'btn btn-ghost admin-curation-notification-cta',
    );

    expect(renderToStaticMarkup(tree)).toContain('공지 배너 이미지는 선택입니다.');
    (cta?.props as { onClick: () => void }).onClick();
    expect(onOpenNotifications).toHaveBeenCalledOnce();
    expect(mocks.notificationAction).not.toHaveBeenCalled();
  });

  it('선택 이미지가 있는 특집 IP와 공지는 제거할 수 있지만 히어로는 제거할 수 없다', () => {
    const imagePath = 'public-media/catalog/curation/77777777-7777-4777-8777-777777777777.webp';
    const withArtwork = {
      ...activeAnnouncement,
      imagePath,
      imageUrl: 'https://cdn.example/catalog/curation/current.webp',
    };
    const announcementHtml = renderSection(withArtwork);
    const featuredHtml = renderSection({
      ...withArtwork,
      kind: 'featured_ip',
      ipId: 'active-ip',
    });
    const heroHtml = renderSection({
      ...withArtwork,
      kind: 'hero',
      ipId: null,
    });

    expect(announcementHtml).toContain('>이미지 제거</button>');
    expect(featuredHtml).toContain('>이미지 제거</button>');
    expect(heroHtml).not.toContain('>이미지 제거</button>');
    expect(heroHtml).toContain('히어로 이미지는 필수입니다.');
  });

  it('390px에서도 120자 제목과 상태·순서·기간을 별도 구조로 모두 노출한다', () => {
    const longTitle = '가'.repeat(120);
    const record = { ...activeAnnouncement, title: longTitle };
    const html = renderSection(record);
    const button = html.match(/<button[^>]*admin-curation-record-button[^>]*>[\s\S]*?<\/button>/)?.[0];
    const css = readFileSync(new URL('../../../app/globals.css', import.meta.url), 'utf8');

    expect(button).toBeDefined();
    expect(button).toContain(`<strong class="admin-curation-record-title">${longTitle}</strong>`);
    expect(button).toContain('<span class="admin-curation-record-meta">');
    expect(button).toContain('공지 배너 · 노출 중 · 순서 2');
    expect(button).toContain('2026-07-15 09:00 KST → 종료 없음');
    expect(css).toMatch(/\.admin-curation-record-button\s*\{[^}]*height:\s*auto[^}]*white-space:\s*normal/);
    expect(css).toMatch(/\.admin-curation-record-title\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.admin-curation-record-meta\s*\{[^}]*color:\s*var\(--dim\)[^}]*font-size:\s*11px/);
  });

  it('실제 CurationForm key가 새 operation ID와 최신 레코드를 반영한다', () => {
    const originalTree = CurationSection({
      draftActiveFrom: '2026-07-15T03:04:05.000Z',
      draftId: '22222222-2222-4222-8222-222222222222',
      ipOptions,
      onOpenNotifications: vi.fn(),
      onSelect: vi.fn(),
      operationId: '33333333-3333-4333-8333-333333333333',
      records: [activeAnnouncement],
      selected: activeAnnouncement,
    });
    const latest = { ...activeAnnouncement, updatedAt: '2026-07-15T04:00:00.000Z' };
    const revalidatedTree = CurationSection({
      draftActiveFrom: '2026-07-15T03:04:05.000Z',
      draftId: '77777777-7777-4777-8777-777777777777',
      ipOptions,
      onOpenNotifications: vi.fn(),
      onSelect: vi.fn(),
      operationId: '88888888-8888-4888-8888-888888888888',
      records: [latest],
      selected: latest,
    });
    const isCurationForm = (element: ReactElement) => (
      typeof element.type === 'function' && element.type.name === 'CurationForm'
    );
    const originalForm = findElement(originalTree, isCurationForm);
    const revalidatedForm = findElement(revalidatedTree, isCurationForm);

    expect(originalForm?.key).toBe(JSON.stringify([
      activeAnnouncement.id,
      activeAnnouncement.updatedAt,
      '33333333-3333-4333-8333-333333333333',
    ]));
    expect(revalidatedForm?.key).toBe(JSON.stringify([
      latest.id,
      latest.updatedAt,
      '88888888-8888-4888-8888-888888888888',
    ]));
    expect(revalidatedForm?.key).not.toBe(originalForm?.key);
  });
});
