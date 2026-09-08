import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminIpRecord } from '@/lib/admin/catalog.server';
import { IpSection } from './IpSection';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('../../../app/admin/archive-actions', () => ({
  archiveAdminCatalogRecordAction: vi.fn(),
  unarchiveAdminCatalogRecordAction: vi.fn(),
}));
vi.mock('../../../lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: vi.fn() }));

const ip: AdminIpRecord = {
  id: 'hwasan',
  archivedAt: null,
  hiddenAt: null,
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

function renderIpSection(
  selected: AdminIpRecord | null,
  verticals: Parameters<typeof IpSection>[0]['verticals'] = [],
) {
  return renderToStaticMarkup(
    <IpSection
      action={vi.fn()}
      listHref="/admin/catalog/ips?tab=archived"
      pending={false}
      selected={selected}
      state={{}}
      verticals={verticals}
    />,
  );
}

describe('IpSection', () => {
  it('uses the shared artwork field and states the horizontal key-art rule', () => {
    const html = renderIpSection(null, [{ key: 'global', label: '글로벌 IP', color: '#2DE2FF' }]);

    expect(html).toContain('data-artwork-kind="ip"');
    expect(html).toContain('name="imagePath"');
    expect(html).toContain('가로형');
    expect(html).toContain('name="featured"');
    expect(html).toContain('type="hidden"');
    expect(html).toContain('value=""');
    expect(html).not.toContain('type="checkbox" name="featured"');
  });

  it('기존 IP의 featured 값을 보이지 않는 입력으로 보존한다', () => {
    const html = renderIpSection({ ...ip, featured: true });

    expect(html).toContain('type="hidden" name="featured" value="on"');
    expect(html).not.toContain('type="checkbox" name="featured"');
  });

  /* 목록은 IpConsole 이 맡는다 — 편집 화면은 머리에 목록 링크와 대상만 쓴다. */
  it('heads the editor with a back-to-list link and shows the archive control only for an existing IP', () => {
    const existing = renderIpSection(ip);
    const creating = renderIpSection(null);

    expect(existing).toContain('href="/admin/catalog/ips?tab=archived"');
    expect(existing).toContain('← 목록으로');
    expect(existing).toContain('hwasan · 화산강림');
    expect(existing).toContain('카탈로그 보관');
    expect(existing).toContain('name="kind"');
    expect(existing).toContain('value="ip"');
    expect(creating).toContain('새 IP 등록');
    expect(creating).not.toContain('카탈로그 보관');
    expect(creating).not.toContain('aria-label="보관 상태"');
  });

  /* 숨김(노출 중지) 자리표시 — 스키마가 없어 동작하지 않음을 화면이 직접 말한다. */
  /* 현업 슬라이스 5 — 자리표시였던 노출 토글이 실제로 동작한다. */
  it('shows a working visibility control for an existing IP only', () => {
    const existing = renderIpSection(ip);
    const creating = renderIpSection(null);

    expect(existing).toContain('노출 상태');
    expect(existing).toContain('name="ipId"');
    expect(existing).toContain('>숨기기</button>');
    /* 끄는 쪽에만 사유를 받는다. */
    expect(existing).toContain('숨김 사유 (필수)');
    /* 직접 링크가 산다는 사실을 화면이 직접 말해야 「내렸으니 안 보이겠지」로 오해하지 않는다. */
    expect(existing).toContain('직접 링크와 하위 굿즈는 그대로');
    expect(creating).not.toContain('노출 상태');
  });

  it('offers to bring a hidden IP back, without asking for a reason', () => {
    const html = renderIpSection({ ...ip, hiddenAt: '2026-09-08T00:00:00.000Z' });

    expect(html).toContain('>다시 노출하기</button>');
    expect(html).not.toContain('숨김 사유 (필수)');
  });

  it('labels an archived IP and offers restoration', () => {
    const html = renderIpSection({ ...ip, archivedAt: '2026-07-17T12:00:00.000Z' });

    expect(html).toContain('[보관] hwasan · 화산강림');
    expect(html).toContain('보관 복원');
    expect(html).toContain('>복원</button>');
  });

  /*
   * #183 — 운영자에게 CSS 를 물어보지 않는다. 기존 레코드의 배경 값은
   * 그대로 보존해야 아트워크 없는 레거시 화면이 깨지지 않는다.
   */
  it('hides the background CSS input while preserving the stored value', () => {
    const html = renderIpSection({ ...ip, bg: 'url("/generated/ip/hwasan.png") center / cover no-repeat' });

    expect(html).not.toContain('배경 CSS');
    expect(html).toContain('name="bg"');
    expect(html).toContain('url(&quot;/generated/ip/hwasan.png&quot;) center / cover no-repeat');
  });

  it('takes the glyph as multi-line text instead of a typed escape sequence', () => {
    const html = renderIpSection(null);

    expect(html).toMatch(/<textarea[^>]*name="glyph"/);
    expect(html).toContain('글리프 (줄바꿈 가능)');
  });
});
