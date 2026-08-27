import { describe, expect, it } from 'vitest';
import { normalizeAdminCurationForm } from './curations';

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const CURATION_ID = '22222222-2222-4222-8222-222222222222';
const MIGRATED_CURATION_ID = 'b6c65692-ad84-67bb-9bb9-ea7c116a05ac';
const IMAGE_PATH = 'public-media/catalog/curation/33333333-3333-4333-8333-333333333333.webp';
const MOBILE_IMAGE_PATH = 'public-media/catalog/curation/44444444-4444-4444-8444-444444444444.webp';

function curationForm(entries: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set('operationId', OPERATION_ID);
  formData.set('id', CURATION_ID);
  formData.set('kind', 'hero');
  formData.set('ipId', '');
  formData.set('title', '  여름 신작을 만나보세요  ');
  formData.set('imagePath', `  ${IMAGE_PATH}  `);
  formData.set('linkPath', '  /ip/summer?tab=cards  ');
  formData.set('displayOrder', '0');
  formData.set('activeFrom', '2026-07-21T10:30');
  formData.set('activeTo', '2026-07-31T23:59');
  formData.set('enabled', 'on');
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

describe('admin curation form normalization', () => {
  it('normalizes UUIDs, text, artwork, ordering, and KST date-times', () => {
    expect(normalizeAdminCurationForm(curationForm({
      operationId: OPERATION_ID.toUpperCase(),
      id: CURATION_ID.toUpperCase(),
    }))).toEqual({
      ok: true,
      value: {
        operationId: OPERATION_ID,
        id: CURATION_ID,
        kind: 'hero',
        ipId: null,
        title: '여름 신작을 만나보세요',
        imagePath: IMAGE_PATH,
        linkPath: '/ip/summer?tab=cards',
        displayOrder: 0,
        activeFrom: '2026-07-21T01:30:00.000Z',
        activeTo: '2026-07-31T14:59:00.000Z',
        enabled: true,
        slot: null,
        payload: null,
      },
    });
  });

  it('accepts a canonical PostgreSQL UUID produced by the deterministic migration backfill', () => {
    expect(normalizeAdminCurationForm(curationForm({
      id: MIGRATED_CURATION_ID.toUpperCase(),
      kind: 'featured_ip',
      ipId: 'rilakkuma',
      imagePath: '',
    }))).toEqual({
      ok: true,
      value: expect.objectContaining({
        id: MIGRATED_CURATION_ID,
        kind: 'featured_ip',
        ipId: 'rilakkuma',
      }),
    });
  });

  it('requires a nonempty IP only for featured IP curations', () => {
    expect(normalizeAdminCurationForm(curationForm({
      kind: 'featured_ip',
      ipId: '  hwasan  ',
      imagePath: '',
      enabled: '',
    }))).toEqual({
      ok: true,
      value: expect.objectContaining({
        kind: 'featured_ip',
        ipId: 'hwasan',
        imagePath: null,
        enabled: false,
      }),
    });

    expect(normalizeAdminCurationForm(curationForm({
      kind: 'featured_ip',
      ipId: '   ',
      imagePath: '',
    }))).toEqual({
      ok: false,
      errors: { ipId: '특집 IP를 선택해주세요.' },
    });

    expect(normalizeAdminCurationForm(curationForm({ ipId: 'hwasan' }))).toEqual({
      ok: false,
      errors: { ipId: '특집 IP 유형에서만 IP를 선택할 수 있습니다.' },
    });
  });

  it('allows announcement and featured IP curations without artwork but requires hero artwork', () => {
    expect(normalizeAdminCurationForm(curationForm({
      kind: 'announcement',
      imagePath: '',
    }))).toEqual({
      ok: true,
      value: expect.objectContaining({ kind: 'announcement', imagePath: null }),
    });

    expect(normalizeAdminCurationForm(curationForm({ imagePath: '' }))).toEqual({
      ok: false,
      errors: { imagePath: '히어로 이미지를 업로드해주세요.' },
    });
  });

  it.each([
    ['external URL', 'https://attacker.example/path'],
    ['scheme-relative URL', '//attacker.example/path'],
    ['backslash', '/safe\\evil'],
    ['control character', '/safe\npath'],
    ['C1 control character', '/safe\u0085path'],
    ['empty path', '   '],
    ['overlong path', `/${'a'.repeat(2048)}`],
  ])('rejects an unsafe internal link: %s', (_label, linkPath) => {
    expect(normalizeAdminCurationForm(curationForm({ linkPath }))).toEqual({
      ok: false,
      errors: { linkPath: '1~2048자의 안전한 내부 경로를 입력해주세요.' },
    });
  });

  it.each([
    ['encoded scheme-relative path', '/%2F%2Fevil'],
    ['encoded backslash', '/%5Cevil'],
    ['encoded control character', '/safe%00tail'],
    ['malformed trailing percent', '/safe%'],
    ['malformed percent pair', '/safe%2Gtail'],
    ['raw trailing control', '/safe\n'],
    ['raw line separator', '/safe\u2028tail'],
    ['raw trailing line separator', '/safe\u2028'],
    ['encoded line separator', '/safe%E2%80%A8tail'],
    ['raw bidi control', '/safe\u202Eevil'],
    ['encoded bidi control', '/safe%E2%80%AEevil'],
  ])('rejects an ambiguous raw or once-decoded internal link: %s', (_label, linkPath) => {
    expect(normalizeAdminCurationForm(curationForm({ linkPath }))).toEqual({
      ok: false,
      errors: { linkPath: '1~2048자의 안전한 내부 경로를 입력해주세요.' },
    });
  });

  it('keeps a legitimate encoded internal query and hash path', () => {
    const linkPath = '/search?q=%ED%99%94%EC%82%B0%20100%25#results';

    expect(normalizeAdminCurationForm(curationForm({ linkPath }))).toEqual({
      ok: true,
      value: expect.objectContaining({ linkPath }),
    });
  });

  it.each([
    'catalog/curation/33333333-3333-4333-8333-333333333333.webp',
    'public-media/catalog/ip/33333333-3333-4333-8333-333333333333.webp',
    'public-media/catalog/curation/33333333-3333-1333-8333-333333333333.webp',
    'public-media/catalog/curation/33333333-3333-4333-8333-333333333333.gif',
  ])('rejects artwork outside the verified curation path contract: %s', (imagePath) => {
    expect(normalizeAdminCurationForm(curationForm({ imagePath }))).toEqual({
      ok: false,
      errors: { imagePath: '검증된 큐레이션 이미지를 사용해주세요.' },
    });
  });

  it('rejects malformed identity, kind, title, and display order fields', () => {
    expect(normalizeAdminCurationForm(curationForm({
      operationId: 'not-a-uuid',
      id: 'not-a-uuid',
      kind: 'banner',
      title: '가'.repeat(121),
      displayOrder: '1.5',
    }))).toEqual({
      ok: false,
      errors: {
        operationId: '유효한 저장 요청이 아닙니다.',
        id: '유효한 큐레이션 ID가 필요합니다.',
        kind: '큐레이션 유형을 선택해주세요.',
        title: '제목은 1자 이상 120자 이하로 입력해주세요.',
        displayOrder: '노출 순서는 0 이상의 정수여야 합니다.',
      },
    });
  });

  it.each(['-1', '1.5', '2147483648'])('rejects a non-integer database order: %s', (displayOrder) => {
    expect(normalizeAdminCurationForm(curationForm({ displayOrder }))).toEqual({
      ok: false,
      errors: { displayOrder: '노출 순서는 0 이상의 정수여야 합니다.' },
    });
  });

  it.each([
    ['missing start', { activeFrom: '' }, { activeFrom: '노출 시작 일시를 선택해주세요.' }],
    ['impossible date', { activeFrom: '2026-02-30T10:30' }, { activeFrom: '일시는 YYYY-MM-DDTHH:mm 형식이어야 합니다.' }],
    ['year zero', { activeFrom: '0000-07-21T10:30' }, { activeFrom: '일시는 YYYY-MM-DDTHH:mm 형식이어야 합니다.' }],
    ['KST rollover before positive ISO years', { activeFrom: '0001-01-01T00:00' }, { activeFrom: '일시는 YYYY-MM-DDTHH:mm 형식이어야 합니다.' }],
    ['invalid hour', { activeFrom: '2026-07-21T24:00' }, { activeFrom: '일시는 YYYY-MM-DDTHH:mm 형식이어야 합니다.' }],
    ['equal window', { activeTo: '2026-07-21T10:30' }, { activeTo: '노출 종료는 시작보다 늦어야 합니다.' }],
    ['reversed window', { activeTo: '2026-07-21T10:29' }, { activeTo: '노출 종료는 시작보다 늦어야 합니다.' }],
  ])('rejects an invalid calendar or active window: %s', (_label, entries, errors) => {
    expect(normalizeAdminCurationForm(curationForm(entries))).toEqual({ ok: false, errors });
  });

  it('accepts the earliest KST local time that remains in a positive ISO year', () => {
    expect(normalizeAdminCurationForm(curationForm({
      activeFrom: '0001-01-01T09:00',
    }))).toEqual({
      ok: true,
      value: expect.objectContaining({ activeFrom: '0001-01-01T00:00:00.000Z' }),
    });
  });

  /* S3 홈 편성 확장 (#325) — 아래는 kind 5종이 늘면서 붙은 슬롯·payload 계약이다. */

  it.each([
    ['notice_strip'],
    ['editor_pick'],
    ['band_banner'],
  ])('요구 이미지를 비운 %s 편성을 막는다', (kind) => {
    expect(normalizeAdminCurationForm(curationForm({ kind, imagePath: '' }))).toEqual({
      ok: false,
      errors: { imagePath: '이미지를 등록해주세요.' },
    });
  });

  it('BEST 탭과 혜택 타일은 이미지 없이 저장할 수 있다', () => {
    expect(normalizeAdminCurationForm(curationForm({
      kind: 'benefit',
      imagePath: '',
      description: '  카드팩을 무료로 열어보세요  ',
    }))).toEqual({
      ok: true,
      value: expect.objectContaining({
        kind: 'benefit',
        imagePath: null,
        slot: null,
        payload: { description: '카드팩을 무료로 열어보세요' },
      }),
    });
  });

  it('BEST 탭만 슬롯을 받고 다른 kind 의 슬롯은 버린다', () => {
    expect(normalizeAdminCurationForm(curationForm({
      kind: 'best_tab',
      imagePath: '',
      slot: 'popular',
      goodIds: ' g13 , g14,,g15 ',
    }))).toEqual({
      ok: true,
      value: expect.objectContaining({
        kind: 'best_tab',
        slot: 'popular',
        payload: { good_ids: ['g13', 'g14', 'g15'] },
      }),
    });

    expect(normalizeAdminCurationForm(curationForm({ slot: 'category' }))).toEqual({
      ok: true,
      value: expect.objectContaining({ kind: 'hero', slot: null }),
    });
  });

  it('BEST 탭은 슬롯과 상품 ID 를 둘 다 요구한다', () => {
    expect(normalizeAdminCurationForm(curationForm({
      kind: 'best_tab',
      imagePath: '',
      slot: 'trending',
      goodIds: '   ',
    }))).toEqual({
      ok: false,
      errors: {
        slot: '탭 슬롯을 선택해주세요.',
        goodIds: '상품 ID 를 1개 이상 등록해주세요.',
      },
    });
  });

  it.each([
    ['형식 위반', { kind: 'best_tab', slot: 'category', goodIds: 'g13, bad id' }, '상품 ID 형식이 올바르지 않습니다.'],
    ['BEST 탭 상한', { kind: 'best_tab', slot: 'category', goodIds: Array.from({ length: 13 }, (_, index) => `g${index}`).join(',') }, '상품 ID 는 최대 12개까지 등록할 수 있습니다.'],
    ['기획전 상한', { kind: 'band_banner', goodIds: 'g1,g2,g3,g4,g5' }, '상품 ID 는 최대 4개까지 등록할 수 있습니다.'],
  ])('연결 상품 ID 의 %s 을 막는다', (_label, entries, message) => {
    expect(normalizeAdminCurationForm(curationForm(entries))).toEqual({
      ok: false,
      errors: { goodIds: message },
    });
  });

  it('기획전 밴드는 서브카피와 연결 상품을 payload 로 모은다', () => {
    expect(normalizeAdminCurationForm(curationForm({
      kind: 'band_banner',
      subcopy: '  여름 한정 기획전  ',
      goodIds: 'g13,g14',
    }))).toEqual({
      ok: true,
      value: expect.objectContaining({
        kind: 'band_banner',
        payload: { subcopy: '여름 한정 기획전', good_ids: ['g13', 'g14'] },
      }),
    });
  });

  it('에디터의 제안은 배지 20자와 설명 200자를 지킨다', () => {
    expect(normalizeAdminCurationForm(curationForm({
      kind: 'editor_pick',
      badge: '  이번 주 신상  ',
      description: '  에디터가 고른 굿즈  ',
    }))).toEqual({
      ok: true,
      value: expect.objectContaining({
        payload: { badge: '이번 주 신상', description: '에디터가 고른 굿즈' },
      }),
    });

    expect(normalizeAdminCurationForm(curationForm({
      kind: 'editor_pick',
      badge: '가'.repeat(21),
      description: '가'.repeat(201),
    }))).toEqual({
      ok: false,
      errors: {
        badge: '배지 문구는 1자 이상 20자 이하로 입력해주세요.',
        description: '설명은 1자 이상 200자 이하로 입력해주세요.',
      },
    });
  });

  it('히어로는 부제와 모바일 아트워크 경로를 payload 로 싣는다', () => {
    expect(normalizeAdminCurationForm(curationForm({
      subtitle: '  여름 신작 컬렉션  ',
      mobileImagePath: `  ${MOBILE_IMAGE_PATH}  `,
    }))).toEqual({
      ok: true,
      value: expect.objectContaining({
        payload: { subtitle: '여름 신작 컬렉션', mobile_image_path: MOBILE_IMAGE_PATH },
      }),
    });

    expect(normalizeAdminCurationForm(curationForm({
      mobileImagePath: 'public-media/catalog/ip/44444444-4444-4444-8444-444444444444.webp',
      subtitle: '가'.repeat(201),
    }))).toEqual({
      ok: false,
      errors: {
        subtitle: '히어로 부제는 1자 이상 200자 이하로 입력해주세요.',
        mobileImagePath: '검증된 큐레이션 이미지를 사용해주세요.',
      },
    });
  });

  /* payload 키가 없는 kind 에 남은 입력이 실려 RPC 화이트리스트에 걸리면 안 된다. */
  it('payload 를 쓰지 않는 kind 는 남은 입력을 버린다', () => {
    expect(normalizeAdminCurationForm(curationForm({
      kind: 'announcement',
      imagePath: '',
      badge: '이번 주 신상',
      goodIds: 'g13',
      subtitle: '버려질 부제',
    }))).toEqual({
      ok: true,
      value: expect.objectContaining({ kind: 'announcement', slot: null, payload: null }),
    });
  });
});
