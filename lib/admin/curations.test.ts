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
  it('preserves legacy style omission and saves only valid explicit banner styles', () => {
    expect(normalizeAdminCurationForm(curationForm({ imageDim: '', textColor: '' }))).toMatchObject({ ok: true, value: { payload: null } });
    expect(normalizeAdminCurationForm(curationForm({ imageDim: 'none', textColor: 'black' }))).toMatchObject({ ok: true, value: { payload: { image_dim: 'none', text_color: 'black' } } });
    expect(normalizeAdminCurationForm(curationForm({ imageDim: 'gray', textColor: 'red' }))).toMatchObject({ ok: false, errors: { imageDim: expect.any(String), textColor: expect.any(String) } });
  });
  it('saves the free-product pool separately from design, crop and display count', () => {
    const base = { kind: 'product_collection', title: '😀'.repeat(15), imagePath: '', linkPath: '', productLayout: 'list', productImageShape: 'portrait', productItemCount: '3', goodIds: 'g3, hidden, g2, g1' };
    expect(normalizeAdminCurationForm(curationForm(base))).toMatchObject({ ok: true, value: { linkPath: null, imagePath: null, slot: null,
      payload: { layout: 'list', image_shape: 'portrait', item_count: 3, good_ids: ['g3', 'hidden', 'g2', 'g1'] } } });
    expect(normalizeAdminCurationForm(curationForm({ ...base, goodIds: '', productLayout: 'full_image', productItemCount: '1' })))
      .toMatchObject({ ok: true, value: { payload: { good_ids: [], item_count: 1 } } });
    for (const value of [{ productItemCount: '2' }, { productItemCount: '3e0' }, { productLayout: 'full_image', productItemCount: '12' },
      { productImageShape: 'auto' }, { goodIds: 'g1,g1' }, { title: '😀'.repeat(16) }, { title: '제목\n줄' }, { imagePath: IMAGE_PATH }, { linkPath: '/shop' }]) {
      expect(normalizeAdminCurationForm(curationForm({ ...base, ...value }))).toMatchObject({ ok: false });
    }
  });
  it('프로모션 배너만 제목·내용과 링크를 비울 수 있다', () => {
    expect(normalizeAdminCurationForm(curationForm({ title: '', subtitle: '', linkPath: '', altEnabled: 'on', altTitle: '', altContent: '' })))
      .toMatchObject({ ok: true, value: { title: '', linkPath: null, payload: { alt_enabled: true } } });
    expect(normalizeAdminCurationForm(curationForm({ kind: 'announcement', title: '', linkPath: '' })))
      .toMatchObject({ ok: false, errors: { title: expect.any(String), linkPath: expect.any(String) } });
    expect(normalizeAdminCurationForm(curationForm({ linkPath: '\n' }))).toMatchObject({ ok: false, errors: { linkPath: expect.any(String) } });
  });

  it('새 문구는 코드포인트 40·150자와 3줄을 제한하고 기존 긴 문구는 그대로 유지한다', () => {
    expect(normalizeAdminCurationForm(curationForm({ title: '😀'.repeat(40), subtitle: '😀'.repeat(150) }))).toMatchObject({ ok: true });
    expect(normalizeAdminCurationForm(curationForm({ title: '😀'.repeat(41), subtitle: '가'.repeat(151) }))).toMatchObject({ ok: false, errors: { title: expect.any(String), subtitle: expect.any(String) } });
    expect(normalizeAdminCurationForm(curationForm({ subtitle: '1\n2\n3\n4' }))).toMatchObject({ ok: false, errors: { subtitle: expect.any(String) } });
    expect(normalizeAdminCurationForm(curationForm({ title: '가'.repeat(120), originalTitle: '가'.repeat(120), subtitle: '나'.repeat(200), originalSubtitle: '나'.repeat(200) })))
      .toMatchObject({ ok: true, value: { title: '가'.repeat(120), payload: { subtitle: '나'.repeat(200) } } });
  });

  it('대체텍스트는 화면 문구와 분리되며 해제하면 예전 입력을 저장하지 않는다', () => {
    expect(normalizeAdminCurationForm(curationForm({ title: '화면 제목', subtitle: '화면 내용', altEnabled: 'on', altTitle: '  이미지 제목  ', altContent: '이미지 내용' })))
      .toMatchObject({ ok: true, value: { title: '화면 제목', payload: { subtitle: '화면 내용', alt_enabled: true, alt_title: '이미지 제목', alt_content: '이미지 내용' } } });
    expect(normalizeAdminCurationForm(curationForm({ altEnabled: 'off', altTitle: '오래된 제목', altContent: '오래된 설명' })))
      .toMatchObject({ ok: true, value: { payload: { alt_enabled: false } } });
    expect(normalizeAdminCurationForm(curationForm({ altEnabled: 'on', altTitle: '😀'.repeat(41), altContent: '😀'.repeat(151) })))
      .toMatchObject({ ok: false, errors: { altTitle: expect.any(String), altContent: expect.any(String) } });
  });

  it('마이크로초를 포함한 저장 시각을 손실 없이 전달하고 잘못된 시각은 거절한다', () => {
    const saved = '2026-10-14T02:00:00.123456+09:00';
    expect(normalizeAdminCurationForm(curationForm({ expectedUpdatedAt: saved }))).toMatchObject({ ok: true, value: { expectedUpdatedAt: saved } });
    expect(normalizeAdminCurationForm(curationForm({ expectedUpdatedAt: 'yesterday' }))).toMatchObject({ ok: false, errors: { expectedUpdatedAt: expect.any(String) } });
  });

  it('브라우저 FormData의 CRLF를 화면과 같은 LF 150자로 계산한다', () => {
    const content = `${'가'.repeat(148)}\n나`;
    expect(Array.from(content)).toHaveLength(150);
    expect(normalizeAdminCurationForm(curationForm({ subtitle: content.replace('\n', '\r\n'), altEnabled: 'on', altContent: content.replace('\n', '\r\n') })))
      .toMatchObject({ ok: true, value: { payload: { subtitle: content, alt_content: content } } });
  });

  it('FormData 줄바꿈 변환과 무관하게 변경하지 않은 긴 기존 문구의 원문을 유지한다', () => {
    const old = `${'가'.repeat(195)}\r\n두줄`;
    const result = normalizeAdminCurationForm(curationForm({ subtitle: old.replace('\r\n', '\n'), originalSubtitle: encodeURIComponent(old) }));
    expect(result).toMatchObject({ ok: true, value: { payload: { subtitle: old } } });
  });

  it('roundtrips eight mosaic positions and rejects malformed or overlong configuration', () => {
    const mosaic: { mosaic_title: string; mosaic_subtitle: string; slots: { good_id: string | null; image_path: string | null }[] } = { mosaic_title: '추천', mosaic_subtitle: '상품 모음', slots: Array.from({ length: 8 }, () => ({ good_id: null, image_path: null })) };
    mosaic.slots[7] = { good_id: 'g1', image_path: IMAGE_PATH } as typeof mosaic.slots[0];
    const form = (value: unknown) => curationForm({ kind: 'product_mosaic', title: '모자이크', imagePath: '', mosaic: JSON.stringify(value) });
    expect(normalizeAdminCurationForm(form(mosaic))).toMatchObject({ ok: true, value: { payload: mosaic, slot: null, imagePath: null } });
    for (const invalid of [{ ...mosaic, slots: [] }, { ...mosaic, mosaic_title: '가'.repeat(11) }, { ...mosaic, extra: true }]) {
      expect(normalizeAdminCurationForm(form(invalid))).toMatchObject({ ok: false, errors: { mosaic: expect.any(String) } });
    }
    const overlongTitle = form(mosaic); overlongTitle.set('title', '가'.repeat(16));
    expect(normalizeAdminCurationForm(overlongTitle)).toMatchObject({ ok: false, errors: { title: expect.any(String) } });
  });

  it('normalizes separate sales and review rules without carrying hidden stale product selections', () => {
    expect(normalizeAdminCurationForm(curationForm({ kind: 'sales_best', title: '판매량 BEST', imagePath: '', salesExposure: 'all', salesPeriod: 'monthly', goodIds: 'g1' }))).toEqual({
      ok: true, value: expect.objectContaining({ slot: null, payload: { exposure_mode: 'all', period: 'monthly' } }),
    });
    expect(normalizeAdminCurationForm(curationForm({ kind: 'review_best', title: '후기', imagePath: '', reviewSelectionMode: 'rating', goodIds: 'g1' }))).toEqual({
      ok: true, value: expect.objectContaining({ payload: { selection_mode: 'rating' } }),
    });
    expect(normalizeAdminCurationForm(curationForm({ kind: 'review_best', title: '후기', imagePath: '', reviewSelectionMode: 'manual', goodIds: 'g3,g2,g1' }))).toEqual({
      ok: true, value: expect.objectContaining({ payload: { selection_mode: 'manual', good_ids: ['g3', 'g2', 'g1'] } }),
    });
    expect(normalizeAdminCurationForm(curationForm({ kind: 'review_best', title: '후기', imagePath: '', reviewSelectionMode: 'manual', goodIds: 'g1,g1' }))).toMatchObject({ ok: false, errors: { goodIds: expect.any(String) } });
    expect(normalizeAdminCurationForm(curationForm({ kind: 'sales_best', title: '가'.repeat(16), imagePath: '', salesExposure: 'all', salesPeriod: 'yearly' }))).toMatchObject({ ok: false, errors: { title: expect.any(String), salesPeriod: expect.any(String) } });
  });

  it('saves an automatic rule without leaking the previous manual selection', () => {
    expect(normalizeAdminCurationForm(curationForm({ kind: 'best_tab', imagePath: '', slot: 'category', selectionMode: 'latest', itemCount: '6', goodIds: 'g1,g2' }))).toEqual({
      ok: true, value: expect.objectContaining({ payload: { selection_mode: 'latest', item_count: 6 } }),
    });
    for (const itemCount of ['', '2', '11', '3.5', '3e0']) {
      expect(normalizeAdminCurationForm(curationForm({ kind: 'best_tab', imagePath: '', slot: 'category', selectionMode: 'latest', itemCount }))).toEqual({
        ok: false, errors: { itemCount: '최신 상품은 3개부터 10개까지 전시할 수 있습니다.' },
      });
    }
    expect(normalizeAdminCurationForm(curationForm({ kind: 'best_tab', imagePath: '', slot: 'category', selectionMode: 'popular' }))).toEqual({
      ok: false, errors: { selectionMode: '상품 선정 방식을 선택해주세요.' },
    });
  });

  it('normalizes UUIDs, text, artwork, ordering, and KST date-times', () => {
    expect(normalizeAdminCurationForm(curationForm({
      operationId: OPERATION_ID.toUpperCase(),
      id: CURATION_ID.toUpperCase(),
    }))).toEqual({
      ok: true,
      value: {
        operationId: OPERATION_ID,
        expectedUpdatedAt: null,
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
        subtitle: '내용은 150자 이하, 최대 3줄로 입력해주세요. 기존 내용은 그대로 유지할 수 있습니다.',
        mobileImagePath: '검증된 큐레이션 이미지를 사용해주세요.',
      },
    });
  });

  /* PC 비율 스트립은 모바일 폭에서 붕괴한다 — 히어로와 같은 모바일 아트웍 payload 를 받는다. */
  it('notice_strip 도 모바일 아트웍 경로를 payload 로 싣는다', () => {
    expect(normalizeAdminCurationForm(curationForm({
      kind: 'notice_strip',
      mobileImagePath: MOBILE_IMAGE_PATH,
      subtitle: '스트립에서 버려질 부제',
    }))).toEqual({
      ok: true,
      value: expect.objectContaining({
        kind: 'notice_strip',
        payload: { mobile_image_path: MOBILE_IMAGE_PATH },
      }),
    });
  });

  /* L8a (#573) — 텍스트 공지 바: 한 줄 문구·선택 버튼·대상 화면. 띠배너도 대상 화면을 받는다. */
  function noticeForm(entries: Record<string, string> = {}, pageTypes: string[] | null = ['other', 'home']) {
    const formData = curationForm({ kind: 'notice_bar', title: '  이용약관 개정 안내  ', imagePath: '', linkPath: '/legal/terms', ctaLabel: '  자세히 보기 ', ...entries });
    if (pageTypes) {
      formData.set('pageTypesField', '1');
      for (const type of pageTypes) formData.append('pageTypes', type);
    }
    return formData;
  }

  it('텍스트 공지 바는 버튼 문구·대상 화면을 정해진 순서로 싣고 이미지를 쓰지 않는다', () => {
    expect(normalizeAdminCurationForm(noticeForm())).toEqual({
      ok: true,
      value: expect.objectContaining({
        kind: 'notice_bar', title: '이용약관 개정 안내', imagePath: null, linkPath: '/legal/terms', slot: null,
        payload: { page_types: ['home', 'other'], cta_label: '자세히 보기' },
      }),
    });
  });

  it('링크 없는 공지 바는 버튼 문구를 버리고, 링크가 있으면 버튼 문구가 필수다', () => {
    expect(normalizeAdminCurationForm(noticeForm({ linkPath: '', ctaLabel: '남은 버튼' }))).toMatchObject({
      ok: true, value: { linkPath: null, payload: { page_types: ['home', 'other'] } },
    });
    for (const ctaLabel of ['', '   ', '열세글자가넘는버튼이름입니다']) {
      expect(normalizeAdminCurationForm(noticeForm({ ctaLabel }))).toMatchObject({ ok: false, errors: { ctaLabel: '버튼 문구는 줄바꿈 없이 1자 이상 12자 이하로 입력해주세요.' } });
    }
  });

  /* 셸 로더와 DB([[:cntrl:]])는 C0·DEL과 함께 C1(U+0080~U+009F)도 제어 문자로 거절한다 — 폼이 먼저 칸 오류로 막아야
     '홈 큐레이션을 저장하지 못했습니다' 같은 일반 실패로 새지 않는다. trim은 U+0085(NEL)를 지우지 않는다. */
  it.each([
    ['U+0085', '\u0085', true], ['U+0080', '\u0080', true], ['U+009F', '\u009f', true], ['U+007F', '\u007f', true],
    /* 끝의 탭은 trim이 지워 저장되지 않는다(DB에도 가지 않는다) — 문구 안의 탭만 막으면 된다. */
    ['U+0009', '\t', false],
  ])('공지 문구·버튼 문구의 제어 문자 %s를 칸 오류로 막는다', (_name, control, keptByTrim) => {
    const titleError = { ok: false, errors: { title: '공지 문구는 줄바꿈 없이 1자 이상 60자 이하로 입력해주세요.' } };
    const labelError = { ok: false, errors: { ctaLabel: '버튼 문구는 줄바꿈 없이 1자 이상 12자 이하로 입력해주세요.' } };
    expect(normalizeAdminCurationForm(noticeForm({ title: `배송${control}안내` }))).toMatchObject(titleError);
    expect(normalizeAdminCurationForm(noticeForm({ ctaLabel: `자세히${control}보기` }))).toMatchObject(labelError);
    if (keptByTrim) {
      expect(normalizeAdminCurationForm(noticeForm({ title: `배송 안내${control}` }))).toMatchObject(titleError);
      expect(normalizeAdminCurationForm(noticeForm({ ctaLabel: `보기${control}` }))).toMatchObject(labelError);
    }
  });

  it('제어 문자가 아닌 C1 바로 다음 문자(U+00A0)는 문구 안에서 받는다', () => {
    expect(normalizeAdminCurationForm(noticeForm({ title: '배송 안내', ctaLabel: '자세히 보기' }))).toMatchObject({
      ok: true, value: { title: '배송 안내', payload: { cta_label: '자세히 보기' } },
    });
  });

  it('공지 바 문구는 줄바꿈 없이 60자까지, 이미지와 빈 대상은 거절한다', () => {
    expect(normalizeAdminCurationForm(noticeForm({ title: '😀'.repeat(60) }))).toMatchObject({ ok: true });
    for (const title of ['😀'.repeat(61), '배송\n공지', '']) {
      expect(normalizeAdminCurationForm(noticeForm({ title }))).toMatchObject({ ok: false, errors: { title: expect.any(String) } });
    }
    expect(normalizeAdminCurationForm(noticeForm({ imagePath: IMAGE_PATH }))).toMatchObject({ ok: false, errors: { imagePath: '텍스트 공지 바는 이미지를 쓰지 않습니다.' } });
    /* 체크박스를 모두 끄면 '전 화면'이 아니라 오류다(표식은 있고 값이 없다). 표식 없이 온 요청도 공지 바는 거절한다. */
    for (const pageTypes of [[], ['checkout'], ['home', 'home']]) {
      expect(normalizeAdminCurationForm(noticeForm({}, pageTypes))).toMatchObject({ ok: false, errors: { pageTypes: '공지를 보일 화면을 하나 이상 선택해주세요.' } });
    }
    expect(normalizeAdminCurationForm(noticeForm({}, null))).toMatchObject({ ok: false, errors: { pageTypes: expect.any(String) } });
  });

  it('띠배너는 고른 대상 화면을 싣고, 대상 표식 없이 온 이전 요청은 모든 화면 동작을 유지한다', () => {
    const strip = curationForm({ kind: 'notice_strip', mobileImagePath: MOBILE_IMAGE_PATH, pageTypesField: '1' });
    strip.append('pageTypes', 'product');
    strip.append('pageTypes', 'home');
    expect(normalizeAdminCurationForm(strip)).toMatchObject({ ok: true, value: { payload: { mobile_image_path: MOBILE_IMAGE_PATH, page_types: ['home', 'product'] } } });
    expect(normalizeAdminCurationForm(curationForm({ kind: 'notice_strip', pageTypesField: '1' }))).toMatchObject({ ok: false, errors: { pageTypes: expect.any(String) } });
    expect(normalizeAdminCurationForm(curationForm({ kind: 'notice_strip' }))).toMatchObject({ ok: true, value: { payload: null } });
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
