import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * IP 상세(/admin/catalog/ips/[ipId]) 로더. 'IP관 배너' 폼(IP-06)은 이 로더의 값을 현재 배너로 연다 —
 * 배너 두 칸이 빠지면 폼이 빈 칸으로 열리고, 모바일만 바꿔 저장하면 PC 배너가 지워진다(l8b-qa-1).
 */

const mocks = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  selects: [] as Array<[string, string]>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/app/admin/archive-actions', () => ({ archiveAdminCatalogRecordAction: vi.fn(), unarchiveAdminCatalogRecordAction: vi.fn() }));
vi.mock('@/lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: vi.fn() }));
vi.mock('@/app/admin/ip-publish-actions', () => ({ publishAdminIpAction: vi.fn(), unpublishAdminIpAction: vi.fn() }));
vi.mock('@/app/admin/ip-banner-actions', () => ({ saveAdminIpHallBannerAction: vi.fn() }));
vi.mock('@/lib/ip-identity.server', () => ({ loadAdminIpIdentity: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      const api: Record<string, unknown> = {};
      api.select = (columns: string) => { mocks.selects.push([table, columns]); return api; };
      api.eq = () => api;
      api.order = () => api;
      api.maybeSingle = async () => ({ data: table === 'ips' ? mocks.row : null, error: null });
      api.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
      return api;
    },
    storage: { from: (bucket: string) => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }) }) },
  }),
}));

import { loadAdminIpWorkspace } from './ip-workspace.server';
import { IpSection } from '@/components/admin/sections/IpSection';

const PC = 'public-media/catalog/ip/97480000-0000-4000-8000-000000000201.png';
const MO = 'public-media/catalog/ip/97480000-0000-4000-8000-000000000202.png';

function ipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'maplestory', archived_at: null, published_at: '2026-10-01T00:00:00Z', title: '메이플스토리', sub: null,
    vertical_key: 'game', tagline: null, synopsis: null, glyph: null, bg: null, image_path: null,
    hall_banner_image_path: PC, hall_banner_mobile_image_path: MO, featured: false, fans_count: 3,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.row = ipRow();
  mocks.selects = [];
});

describe('loadAdminIpWorkspace', () => {
  it('저장된 IP관 PC/MO 배너 경로와 미리보기 URL 을 싣는다', async () => {
    const data = await loadAdminIpWorkspace('maplestory', 'basic');

    const ipSelect = mocks.selects.find(([table, columns]) => table === 'ips' && columns.includes('fans_count'))?.[1] ?? '';
    expect(ipSelect.split(',')).toEqual(expect.arrayContaining(['hall_banner_image_path', 'hall_banner_mobile_image_path']));
    expect(data?.ip).toMatchObject({
      hallBannerImagePath: PC,
      hallBannerImageUrl: 'https://cdn.test/public-media/catalog/ip/97480000-0000-4000-8000-000000000201.png',
      hallBannerMobileImagePath: MO,
      hallBannerMobileImageUrl: 'https://cdn.test/public-media/catalog/ip/97480000-0000-4000-8000-000000000202.png',
    });
  });

  it('배너가 없는 IP 는 네 필드가 null 이다(폼은 빈 칸)', async () => {
    mocks.row = ipRow({ hall_banner_image_path: null, hall_banner_mobile_image_path: undefined });
    const data = await loadAdminIpWorkspace('maplestory', 'basic');
    expect(data?.ip).toMatchObject({ hallBannerImagePath: null, hallBannerImageUrl: null, hallBannerMobileImagePath: null, hallBannerMobileImageUrl: null });
  });

  it('IP 상세 화면이 그리는 배너 폼에 저장된 두 배너가 현재 경로·숨은 값으로 내려간다', async () => {
    const data = await loadAdminIpWorkspace('maplestory', 'basic');
    const html = renderToStaticMarkup(
      <IpSection accountId="operator-a" action={vi.fn()} onSelect={vi.fn()} pending={false} records={[data!.ip]}
        selected={data!.ip} state={{}} verticals={[{ key: 'game', label: '게임', color: '#2DE2FF' }]} />,
    );
    const form = html.slice(html.indexOf('aria-label="IP관 배너"'));
    expect(form).toContain(`<input readOnly="" type="hidden" name="hallBannerImagePath" value="${PC}"/>`);
    expect(form).toContain(`<input readOnly="" type="hidden" name="hallBannerMobileImagePath" value="${MO}"/>`);
    expect(form).toContain(`현재 경로: ${PC}`);
    expect(form).toContain(`현재 경로: ${MO}`);
    /* 저장된 배너를 운영자가 지울 수 있다 — 두 칸의 '이미지 제거'가 켜진다. */
    const banners = form.slice(0, form.indexOf('IP관 배너 저장'));
    expect(banners.match(/class="btn btn-ghost admin-artwork-remove"[^>]*>/g)).toHaveLength(2);
    expect(banners).not.toMatch(/admin-artwork-remove" disabled/);
  });
});
