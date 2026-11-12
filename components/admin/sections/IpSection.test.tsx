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
vi.mock('../../../app/admin/ip-publish-actions', () => ({
  publishAdminIpAction: vi.fn(),
  unpublishAdminIpAction: vi.fn(),
}));
vi.mock('@/app/admin/ip-banner-actions', () => ({ saveAdminIpHallBannerAction: vi.fn() }));
vi.mock('@/app/admin/ip-delete-actions', () => ({ deleteAdminDraftIpAction: vi.fn() }));

const ip: AdminIpRecord = {
  id: 'hwasan',
  archivedAt: null,
  publishedAt: '2026-07-15T00:00:00.000Z',
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
        accountId="operator-a"
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
        accountId="operator-a"
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
        accountId="operator-a"
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
        accountId="operator-a"
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
        accountId="operator-a"
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
        accountId="operator-a"
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
        accountId="operator-a"
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
    expect(html).toContain('크게 쓰는 글자 (줄바꿈 가능)');
  });

  it('입력을 기본 정보·소개 글·대표 이미지로 나누고, 낯선 말의 뜻을 칸 이름에서 바로 말하며, 저장 줄은 오른쪽에 둔다', () => {
    const html = renderToStaticMarkup(
      <IpSection accountId="operator-a" action={vi.fn()} onSelect={vi.fn()} pending={false} records={[]} selected={null} state={{}} verticals={[]} />,
    );
    for (const group of ['기본 정보', '소개 글', '대표 이미지']) expect(html).toContain(`aria-label="${group}"`);
    for (const label of ['한 줄 소개 · 태그라인', '크게 쓰는 글자', '자세한 소개', '키아트 이미지']) expect(html).toContain(label);
    /* 글리프·시놉시스는 CONTEXT.md에 없는 말이라 칸 이름에 쓰지 않는다. 키아트는 도메인 용어라 유지하고 뜻을 설명한다. */
    for (const word of ['글리프', '시놉시스']) expect(html).not.toContain(word);
    expect(html).toContain('키아트는 IP를 대표하는 가로형 그림입니다.');
    expect(html).toMatch(/data-admin-savebar=""/);
    expect(html).toMatch(/class="[^"]*\bjustify-end\b[^"]*" data-admin-savebar=""/);
  });

  /* 게시 상태(20260907130000) — 초안·공개·보관을 폼 머리와 목록에서 읽을 수 있어야 한다. */
  describe('publish state', () => {
    /* 제출 버튼(type="submit")의 intent 값과 문구. 앞에 장식 아이콘(svg) 하나가 올 수 있다 — 속성 순서는 묻지 않는다. */
    function intentButton(intent: string, label: string) {
      return new RegExp(`<button(?=[^>]*type="submit")(?=[^>]*value="${intent}")(?=[^>]*name="intent")[^>]*>(?:<svg[\\s\\S]*?</svg>)?\\s*${label}</button>`);
    }

    function render(selected: AdminIpRecord | null, records = selected ? [selected] : []) {
      return renderToStaticMarkup(
        <IpSection
          accountId="operator-a"
          action={vi.fn()}
          onSelect={vi.fn()}
          pending={false}
          records={records}
          selected={selected}
          state={{}}
          verticals={[]}
        />,
      );
    }

    it('starts a new IP as a draft with both save flows', () => {
      const html = render(null);

      expect(html).toContain('data-publish-state="draft"');
      expect(html).toContain('새 IP는 초안으로 시작합니다.');
      expect(html).toMatch(intentButton('draft', '초안으로 저장'));
      expect(html).toMatch(intentButton('publish', '저장 후 공개'));
      expect(html).not.toContain('PUBLISH STATE');
    });

    it('keeps both flows for an existing draft and offers the publish toggle beside archive', () => {
      const draft = { ...ip, publishedAt: null };
      const html = render(draft);

      expect(html).toContain('[초안] hwasan · 화산강림');
      expect(html).toContain('data-publish-state="draft"');
      expect(html).toContain('value="publish"');
      expect(html).toContain('data-ip-publish-control="draft"');
      expect(html).toContain('공개로 전환');
      expect(html).toContain('카탈로그 보관');
    });

    it('offers a single state-preserving save for a published IP and the revert toggle', () => {
      const html = render(ip);

      expect(html).toContain('hwasan · 화산강림');
      expect(html).not.toContain('[초안]');
      expect(html).toContain('data-publish-state="published"');
      expect(html).toMatch(intentButton('save', '저장'));
      expect(html).not.toContain('value="publish"');
      expect(html).not.toContain('초안으로 저장');
      expect(html).toContain('data-ip-publish-control="published"');
      expect(html).toContain('초안으로 되돌리기');
    });

    it('shows the archived badge and blocks publish changes until restored', () => {
      const archived = { ...ip, archivedAt: '2026-07-17T12:00:00.000Z' };
      const html = render(archived);

      expect(html).toContain('[보관] hwasan · 화산강림');
      expect(html).toContain('data-publish-state="archived"');
      expect(html).toContain('data-ip-publish-control="archived"');
      expect(html).toContain('보관된 IP는 게시 상태를 바꿀 수 없습니다.');
      expect(html).not.toContain('value="publish"');
    });

    it('disables both submit buttons while the action is pending', () => {
      const html = renderToStaticMarkup(
        <IpSection
          accountId="operator-a"
          action={vi.fn()}
          onSelect={vi.fn()}
          pending
          records={[]}
          selected={null}
          state={{}}
          verticals={[]}
        />,
      );

      expect(html.match(/name="intent"[^>]*disabled=""|disabled=""[^>]*name="intent"/g)).toHaveLength(2);
      expect(html).toContain('저장 중');
    });
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
        publicSlug: 'new-ip',
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
          accountId="operator-a"
          action={vi.fn()}
          onSelect={vi.fn()}
          pending={false}
          records={[]}
          selected={null}
          state={failedNewIp}
          verticals={[{ key: 'global', label: '글로벌 IP', color: '#2DE2FF' }]}
        />,
      );

      expect(html).toMatch(/name="publicSlug"[^>]*value="new-ip"|value="new-ip"[^>]*name="publicSlug"/);
      expect(html).not.toContain('name="id"');
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
          accountId="operator-a"
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
      /* 저장소 경로가 없을 때 '현재 경로: 없음'이라고 쓰면 그림이 보이는 IP도 등록이 안 된 것처럼 읽힌다. */
      expect(html).not.toContain('현재 경로');
      expect(html).toMatch(/name="imagePath"[^>]*value=""/);
      expect(html).toContain('IP 이름을 입력해주세요.');
    });

    it('ignores a failed submission that belonged to a different record', () => {
      const html = renderToStaticMarkup(
        <IpSection
          accountId="operator-a"
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

  /* S36-003 · ADR-0039 — 사람은 이름·공개 URL만 넣고, 내부 ID는 시스템이 발급해 이후 바꾸지 않는다. */
  describe('internal ID issuance', () => {
    it('asks a new IP for its public URL instead of an internal ID', () => {
      const html = renderToStaticMarkup(
        <IpSection accountId="operator-a" action={vi.fn()} onSelect={vi.fn()} pending={false} records={[]} selected={null} state={{}} verticals={[]} />,
      );
      expect(html).not.toContain('name="id"');
      expect(html).not.toContain('IP 코드');
      expect(html).toContain('공개 URL (필수)');
      expect(html).toMatch(/name="publicSlug"/);
      expect(html).toContain('maxLength="80"');
      expect(html).toContain('내부 ID는 처음 저장할 때 이 주소로 자동 발급되고 바꿀 수 없습니다.');
    });

    it('shows a saved IP its internal ID as read-only and leaves the public URL to the identity form', () => {
      const html = renderToStaticMarkup(
        <IpSection accountId="operator-a" action={vi.fn()} onSelect={vi.fn()} pending={false} records={[ip]} selected={ip} state={{}} verticals={[]} />,
      );
      expect(html).toContain('내부 ID (변경 불가)');
      expect(html).toMatch(/<input[^>]*readOnly=""[^>]*name="id" value="hwasan"|<input[^>]*name="id"[^>]*readOnly=""/);
      expect(html).not.toContain('name="publicSlug"');
      expect(html).toContain('공개 URL은 이 화면 아래의 공개 URL에서 바꿉니다.');
    });

    it('shows the public URL rejection next to the field after a failed create', () => {
      const html = renderToStaticMarkup(
        <IpSection accountId="operator-a" action={vi.fn()} onSelect={vi.fn()} pending={false} records={[]} selected={null}
          state={{ errors: { publicSlug: '이미 사용 중인 공개 URL입니다. 다른 주소를 입력해주세요.' }, values: { previousId: '', publicSlug: 'taken' }, attempt: 1 }} verticals={[]} />,
      );
      expect(html).toContain('이미 사용 중인 공개 URL입니다. 다른 주소를 입력해주세요.');
      expect(html).toMatch(/name="publicSlug"[^>]*value="taken"|value="taken"[^>]*name="publicSlug"/);
    });
  });

  /* S36-004 · ADR-0039 — 공개된 적 없고 연결 0건인 초안만 admin이 지운다. 판정은 DB가 하고 화면은 근거를 보인다. */
  describe('unused draft deletion', () => {
    const draft = { ...ip, publishedAt: null };
    const zero = { goods: 0, cards: 0, card_pools: 0, reward_policies: 0, events: 0, home_curations: 0, coupons: 0, order_items: 0, ip_follows: 0, posts: 0, other: 0 };
    const readiness = { id: 'hwasan', title: '화산강림', publicSlug: 'hwasan', state: 'draft' as const, publicHistory: false,
      aliases: [], references: zero, referenceTotal: 0, deletable: true };
    const render = (props: Partial<Parameters<typeof IpSection>[0]>) => renderToStaticMarkup(
      <IpSection accountId="operator-a" action={vi.fn()} onSelect={vi.fn()} pending={false} records={[draft]} selected={draft}
        state={{}} verticals={[]} {...props} />,
    );

    it('offers an enabled delete with the zero-reference evidence to an admin', () => {
      const html = render({ deletion: readiness, canDeleteDraft: true });
      expect(html).toContain('미사용 초안 삭제');
      expect(html).toContain('data-ip-draft-delete="deletable"');
      for (const label of ['공개 이력', '상품', '카드풀', '뽑기권 발급 정책', '홈 전시', '쿠폰', '주문 품목', '팔로우']) expect(html).toContain(label);
      expect(html).toContain('없음');
      expect(html).not.toContain('기타 연결');
      expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*>(?:<svg[\s\S]*?<\/svg>)?\s*삭제<\/button>/);
    });

    it('keeps the delete closed for staff without admin authority', () => {
      const html = render({ deletion: readiness, canDeleteDraft: false });
      expect(html).toContain('미사용 IP 삭제는 관리자(admin)만 할 수 있습니다.');
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:<svg[\s\S]*?<\/svg>)?\s*삭제<\/button>/);
    });

    it('blocks an IP with linked goods and says why', () => {
      const html = render({ deletion: { ...readiness, references: { ...zero, goods: 2 }, referenceTotal: 2, deletable: false }, canDeleteDraft: true });
      expect(html).toContain('data-ip-draft-delete="blocked"');
      expect(html).toContain('연결된 항목이 있어 삭제할 수 없습니다: 상품 2건');
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:<svg[\s\S]*?<\/svg>)?\s*삭제<\/button>/);
    });

    it('blocks a draft that was public once', () => {
      const html = render({ deletion: { ...readiness, publicHistory: true, deletable: false }, canDeleteDraft: true });
      expect(html).toContain('공개된 적이 있는 IP는 삭제할 수 없습니다. 더 쓰지 않으면 보관해주세요.');
    });

    it('never offers deletion for a published IP, a stale readiness or a missing judgement', () => {
      expect(render({ selected: ip, records: [ip], deletion: readiness, canDeleteDraft: true })).not.toContain('미사용 초안 삭제');
      expect(render({ deletion: { ...readiness, id: 'other' }, canDeleteDraft: true })).not.toContain('미사용 초안 삭제');
      expect(render({ deletion: null, canDeleteDraft: true })).not.toContain('미사용 초안 삭제');
    });
  });

  /* IP-06(L8b): IP관 PC/MO 배너는 기본정보 폼과 따로 저장하는 별도 폼이다 — 저장된 IP 에만 보인다. */
  it('저장된 IP 에만 IP관 PC/MO 배너 폼을 두고 현재 배너 경로를 싣는다', () => {
    const render = (selected: AdminIpRecord | null) => renderToStaticMarkup(
      <IpSection accountId="operator-a" action={vi.fn()} onSelect={vi.fn()} pending={false} records={selected ? [selected] : []}
        selected={selected} state={{}} verticals={[{ key: 'webtoon', label: '웹툰', color: '#2DE2FF' }]} />,
    );
    expect(render(null)).not.toContain('IP관 배너');

    const html = render({ ...ip, hallBannerImagePath: 'public-media/catalog/ip/97510000-0000-4000-8000-000000000001.webp', hallBannerImageUrl: 'https://cdn.test/pc.webp',
      hallBannerMobileImagePath: null, hallBannerMobileImageUrl: null });
    const form = html.slice(html.indexOf('aria-label="IP관 배너"'));
    expect(form).toContain('PC 배너');
    expect(form).toContain('모바일 배너');
    expect(form).toContain('<input type="hidden" name="ipId" value="hwasan"/>');
    expect(form).toContain('<input readOnly="" type="hidden" name="hallBannerImagePath" value="public-media/catalog/ip/97510000-0000-4000-8000-000000000001.webp"/>');
    expect(form).toContain('<input readOnly="" type="hidden" name="hallBannerMobileImagePath" value=""/>');
    expect(form).toContain('비우면 모바일에서도 PC 배너를 씁니다');
    expect(form).toContain('IP관 배너 저장');
    /* 기본정보 폼의 키아트 칸(imagePath)과 이름이 겹치지 않는다. */
    expect(form).not.toContain('name="imagePath"');
  });
});
