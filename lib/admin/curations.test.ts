import { describe, expect, it } from 'vitest';
import { normalizeAdminCurationForm } from './curations';

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const CURATION_ID = '22222222-2222-4222-8222-222222222222';
const IMAGE_PATH = 'public-media/catalog/curation/33333333-3333-4333-8333-333333333333.webp';

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
      },
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
    ['invalid hour', { activeFrom: '2026-07-21T24:00' }, { activeFrom: '일시는 YYYY-MM-DDTHH:mm 형식이어야 합니다.' }],
    ['equal window', { activeTo: '2026-07-21T10:30' }, { activeTo: '노출 종료는 시작보다 늦어야 합니다.' }],
    ['reversed window', { activeTo: '2026-07-21T10:29' }, { activeTo: '노출 종료는 시작보다 늦어야 합니다.' }],
  ])('rejects an invalid calendar or active window: %s', (_label, entries, errors) => {
    expect(normalizeAdminCurationForm(curationForm(entries))).toEqual({ ok: false, errors });
  });
});
