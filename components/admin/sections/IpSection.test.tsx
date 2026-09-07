import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('IpSection', () => {
  it('uses the shared artwork field and states the horizontal key-art rule', () => {
    const html = renderToStaticMarkup(
      <IpSection
        action={vi.fn()}
        onSelect={vi.fn()}
        pending={false}
        records={[]}
        selected={null}
        state={{}}
        verticals={[{ key: 'global', label: '글로벌 IP', color: '#2DE2FF' }]}
      />,
    );

    expect(html).toContain('data-artwork-kind="ip"');
    expect(html).toContain('name="imagePath"');
    expect(html).toContain('가로형');
    expect(html).toContain('name="featured"');
    expect(html).toContain('type="hidden"');
    expect(html).toContain('value=""');
    expect(html).not.toContain('type="checkbox" name="featured"');
  });

  it('기존 IP의 featured 값을 보이지 않는 입력으로 보존한다', () => {
    const html = renderToStaticMarkup(
      <IpSection
        action={vi.fn()}
        onSelect={vi.fn()}
        pending={false}
        records={[{ ...ip, featured: true }]}
        selected={{ ...ip, featured: true }}
        state={{}}
        verticals={[]}
      />,
    );

    expect(html).toContain('type="hidden" name="featured" value="on"');
    expect(html).not.toContain('type="checkbox" name="featured"');
  });

  it('shows the archive filter and archive control only for an existing IP', () => {
    const existing = renderToStaticMarkup(
      <IpSection
        action={vi.fn()}
        onSelect={vi.fn()}
        pending={false}
        records={[ip]}
        selected={ip}
        state={{}}
        verticals={[]}
      />,
    );
    const creating = renderToStaticMarkup(
      <IpSection
        action={vi.fn()}
        onSelect={vi.fn()}
        pending={false}
        records={[ip]}
        selected={null}
        state={{}}
        verticals={[]}
      />,
    );

    expect(existing).toContain('aria-label="보관 상태"');
    expect(existing).toContain('카탈로그 보관');
    expect(existing).toContain('name="kind"');
    expect(existing).toContain('value="ip"');
    expect(creating).not.toContain('카탈로그 보관');
  });

  it('labels an archived IP and offers restoration', () => {
    const archived = { ...ip, archivedAt: '2026-07-17T12:00:00.000Z' };
    const html = renderToStaticMarkup(
      <IpSection
        action={vi.fn()}
        onSelect={vi.fn()}
        pending={false}
        records={[archived]}
        selected={archived}
        state={{}}
        verticals={[]}
      />,
    );

    expect(html).toContain('[보관] hwasan · 화산강림');
    expect(html).toContain('보관 복원');
    expect(html).toContain('>복원</button>');
  });

  /*
   * #183 — 운영자에게 CSS 를 물어보지 않는다. 기존 레코드의 배경 값은
   * 그대로 보존해야 아트워크 없는 레거시 화면이 깨지지 않는다.
   */
  it('hides the background CSS input while preserving the stored value', () => {
    const legacy = { ...ip, bg: 'url("/generated/ip/hwasan.png") center / cover no-repeat' };
    const html = renderToStaticMarkup(
      <IpSection
        action={vi.fn()}
        onSelect={vi.fn()}
        pending={false}
        records={[legacy]}
        selected={legacy}
        state={{}}
        verticals={[]}
      />,
    );

    expect(html).not.toContain('배경 CSS');
    expect(html).toContain('name="bg"');
    expect(html).toContain('url(&quot;/generated/ip/hwasan.png&quot;) center / cover no-repeat');
  });

  it('takes the glyph as multi-line text instead of a typed escape sequence', () => {
    const html = renderToStaticMarkup(
      <IpSection
        action={vi.fn()}
        onSelect={vi.fn()}
        pending={false}
        records={[]}
        selected={null}
        state={{}}
        verticals={[]}
      />,
    );

    expect(html).toMatch(/<textarea[^>]*name="glyph"/);
    expect(html).toContain('글리프 (줄바꿈 가능)');
  });

  /*
   * 저장 실패 뒤 React 19 <form action> 이 폼을 리셋해도, 액션이 되돌려준 제출값이
   * defaultValue 로 다시 심겨야 한다 — 타이핑한 값과 업로드해 둔 imagePath 모두.
   */
  describe('after a failed save', () => {
    const failedNewIp = {
      errors: { verticalKey: '등록된 버티컬을 선택해주세요.' },
      values: {
        previousId: '',
        id: 'new-ip',
        title: '새 IP 이름',
        sub: '보조 설명 유지',
        verticalKey: 'global',
        tagline: '태그라인 유지',
        glyph: '새\n글리프',
        synopsis: '시놉시스 유지',
        bg: '',
        featured: '',
        imagePath: 'public-media/catalog/ip/uploaded.png',
      },
      attempt: 1,
    };

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('restores every typed value and the uploaded artwork path for a new IP', () => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://demo.supabase.co');
      const html = renderToStaticMarkup(
        <IpSection
          action={vi.fn()}
          onSelect={vi.fn()}
          pending={false}
          records={[]}
          selected={null}
          state={failedNewIp}
          verticals={[{ key: 'global', label: '글로벌 IP', color: '#2DE2FF' }]}
        />,
      );

      expect(html).toMatch(/name="id"[^>]*value="new-ip"|value="new-ip"[^>]*name="id"/);
      expect(html).toMatch(/name="title"[^>]*value="새 IP 이름"|value="새 IP 이름"[^>]*name="title"/);
      expect(html).toContain('보조 설명 유지');
      expect(html).toContain('태그라인 유지');
      expect(html).toContain('시놉시스 유지');
      expect(html).toMatch(/<textarea[^>]*name="glyph"[^>]*>새\n글리프<\/textarea>/);
      expect(html).toMatch(/<option[^>]*selected=""[^>]*value="global"|<option[^>]*value="global"[^>]*selected=""/);
      expect(html).toContain('name="imagePath"');
      expect(html).toContain('value="public-media/catalog/ip/uploaded.png"');
      expect(html).toContain('현재 경로: public-media/catalog/ip/uploaded.png');
      /* 업로드 직후의 object URL 은 리마운트에서 사라졌으니 경로에서 미리보기를 되살린다. */
      expect(html).toContain('src="https://demo.supabase.co/storage/v1/object/public/public-media/catalog/ip/uploaded.png"');
      expect(html).toContain('등록된 버티컬을 선택해주세요.');
    });

    it('keeps a cleared field empty instead of falling back to the stored record', () => {
      const state = {
        errors: { title: 'IP 이름을 입력해주세요.' },
        values: { previousId: 'hwasan', id: 'hwasan', title: '', sub: '', imagePath: '' },
        attempt: 2,
      };
      const stored = { ...ip, sub: '저장된 보조 설명', imagePath: 'public-media/catalog/ip/stored.png', imageUrl: 'https://cdn.test/stored.png' };
      const html = renderToStaticMarkup(
        <IpSection
          action={vi.fn()}
          onSelect={vi.fn()}
          pending={false}
          records={[stored]}
          selected={stored}
          state={state}
          verticals={[]}
        />,
      );

      expect(html).not.toContain('저장된 보조 설명');
      /* 목록 썸네일은 저장된 이미지를 계속 보여주지만, 폼의 미리보기는 제거된 상태를 따른다. */
      expect(html).not.toContain('alt="현재 아트워크 미리보기" src="https://cdn.test/stored.png"');
      expect(html).toContain('이미지 없음');
      expect(html).toContain('현재 경로: 없음');
      expect(html).toContain('IP 이름을 입력해주세요.');
    });

    it('ignores a failed submission that belonged to a different record', () => {
      const html = renderToStaticMarkup(
        <IpSection
          action={vi.fn()}
          onSelect={vi.fn()}
          pending={false}
          records={[ip]}
          selected={ip}
          state={failedNewIp}
          verticals={[]}
        />,
      );

      expect(html).not.toContain('새 IP 이름');
      expect(html).not.toContain('uploaded.png');
      expect(html).toMatch(/name="title"[^>]*value="화산강림"|value="화산강림"[^>]*name="title"/);
    });
  });
});
