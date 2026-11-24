import { describe, expect, it } from 'vitest';
import {
  GOODS_GALLERY_MAX,
  catalogContextFromSnapshot,
  normalizeAdminEventForm,
  normalizeAdminGoodForm,
  normalizeAdminIpForm,
  normalizeAdminStockAdjustmentForm,
  normalizeAdminTicketTypeForm,
} from './catalog';

it('영문 상품명을 공백 정리해 저장하고 비우면 제거하며 과도한 길이는 거절한다', () => {
  const form = new FormData();
  form.set('ipId', 'hwasan');
  form.set('name', '아크릴 키링');
  form.set('price', '1000');
  form.set('nameEn', '  Acrylic Keyring  ');
  expect(normalizeAdminGoodForm(form, context)).toMatchObject({ ok: true, value: { nameEn: 'Acrylic Keyring' } });
  form.set('nameEn', '');
  expect(normalizeAdminGoodForm(form, context)).toMatchObject({ ok: true, value: { nameEn: null } });
  form.set('nameEn', 'a'.repeat(201));
  expect(normalizeAdminGoodForm(form, context)).toMatchObject({ ok: false, errors: { nameEn: expect.any(String) } });
});

it('검색 키워드는 줄바꿈·쉼표를 나누고 공백과 대소문자 중복을 정리한다', () => {
  const form = new FormData();
  form.set('ipId', 'hwasan');
  form.set('name', '아크릴 키링');
  form.set('price', '1000');
  form.set('searchKeywords', '  여름 굿즈, 낮잠\n여름 굿즈\nKUMA, kuma  ');
  form.set('displayOrder', ' 12 ');

  expect(normalizeAdminGoodForm(form, context)).toMatchObject({
    ok: true,
    value: { searchKeywords: ['여름 굿즈', '낮잠', 'KUMA'], displayOrder: 12 },
  });
});

it('진열 순서는 미설정과 0을 구분하고 음수는 거절한다', () => {
  const form = new FormData();
  form.set('ipId', 'hwasan');
  form.set('name', '아크릴 키링');
  form.set('price', '1000');
  form.set('displayOrder', '');
  expect(normalizeAdminGoodForm(form, context)).toMatchObject({ ok: true, value: { displayOrder: null } });

  form.set('displayOrder', '-1');
  expect(normalizeAdminGoodForm(form, context)).toMatchObject({
    ok: false,
    errors: { displayOrder: expect.any(String) },
  });
});

const context = {
  eventIds: new Set(['e100', 'e200']),
  goodIpById: new Map([
    ['g100', 'hwasan'],
    ['g200', 'lumen'],
  ]),
  ipIds: new Set(['hwasan', 'lumen']),
  verticalKeys: new Set(['rofan', 'global']),
};

describe('상품 판매 조건 입력', () => {
  function form(values: Record<string, string> = {}) {
    const data = new FormData();
    for (const [key, value] of Object.entries({ ipId: 'hwasan', name: '아크릴 키링', price: '1000', ...values })) data.set(key, value);
    return data;
  }

  it('무통장 전용과 주문·회원 한도를 명시한 값으로 전달한다', () => {
    expect(normalizeAdminGoodForm(form({
      allowCardPayment: 'false', allowBankTransfer: 'true', saleRestriction: 'none',
      orderQuantityLimitEnabled: 'true', minOrderQty: '2', maxOrderQty: '5',
      memberPurchaseLimitEnabled: 'true', memberLifetimeQtyLimit: '8',
    }), context)).toMatchObject({ ok: true, value: {
      allowCardPayment: false, allowBankTransfer: true, saleRestriction: 'none',
      orderQuantityLimitEnabled: true, minOrderQty: 2, maxOrderQty: 5,
      memberPurchaseLimitEnabled: true, memberLifetimeQtyLimit: 8,
    } });
  });

  it('미설정 한도를 0이나 무제한 값으로 바꾸지 않고 활성화를 거절한다', () => {
    expect(normalizeAdminGoodForm(form({ orderQuantityLimitEnabled: 'true', minOrderQty: '', maxOrderQty: '',
      memberPurchaseLimitEnabled: 'true', memberLifetimeQtyLimit: '' }), context)).toMatchObject({
      ok: false, errors: { minOrderQty: expect.any(String), maxOrderQty: expect.any(String), memberLifetimeQtyLimit: expect.any(String) },
    });
    expect(normalizeAdminGoodForm(form({ orderQuantityLimitEnabled: 'false', minOrderQty: '', maxOrderQty: '',
      memberPurchaseLimitEnabled: 'false', memberLifetimeQtyLimit: '' }), context)).toMatchObject({
      ok: true, value: { orderQuantityLimitEnabled: false, minOrderQty: null, maxOrderQty: null,
        memberPurchaseLimitEnabled: false, memberLifetimeQtyLimit: null },
    });
  });

  it('범위 역전·0·소수·임의 결제 상태를 거절한다', () => {
    expect(normalizeAdminGoodForm(form({ minOrderQty: '6', maxOrderQty: '5', memberLifetimeQtyLimit: '0',
      allowCardPayment: 'yes', saleRestriction: 'unrestricted' }), context)).toMatchObject({
      ok: false, errors: { maxOrderQty: expect.any(String), memberLifetimeQtyLimit: expect.any(String),
        allowCardPayment: expect.any(String), saleRestriction: expect.any(String) },
    });
    expect(normalizeAdminGoodForm(form({ minOrderQty: '1.5' }), context)).toMatchObject({ ok: false });
  });

  it('이전 폼에서 생략한 정책은 현재 저장값 보존을 위해 전달하지 않는다', () => {
    const result = normalizeAdminGoodForm(form(), context);
    expect(result.ok).toBe(true);
    if (result.ok) for (const key of ['allowCardPayment', 'allowBankTransfer', 'saleRestriction',
      'orderQuantityLimitEnabled', 'minOrderQty', 'maxOrderQty', 'memberPurchaseLimitEnabled', 'memberLifetimeQtyLimit']) {
      expect(result.value).not.toHaveProperty(key);
    }
  });
});

/* 고시정보는 저장 필수라서(#171) 굿즈 폼 픽스처는 항상 값을 채워야 한다. */
const goodsNoticeValues: Record<string, string> = {
  noticeMaker: '주식회사 아이콘스',
  noticeOrigin: '대한민국',
  noticeMaterial: '아크릴',
  noticeSize: '80 x 60 x 20mm · 90g',
  noticeMadeOn: '2026-07',
  noticeAsManager: '아이콘스 고객센터',
  noticeAsContact: '02-000-0000',
};

function setGoodsNotice(formData: FormData) {
  for (const [key, value] of Object.entries(goodsNoticeValues)) formData.set(key, value);
  return formData;
}

describe('admin catalog form normalization', () => {

  /* S36-003 · ADR-0039 — 새 IP는 내부 ID 없이 공개 URL로 등록하고, 내부 ID는 DB가 공개 URL로 발급한다. */
  it('normalizes a valid new IP form around its public URL', () => {
    const formData = new FormData();
    formData.set('publicSlug', ' hwasan ');
    formData.set('id', 'ignored-for-new-ip');
    formData.set('title', ' 화산강림 ');
    formData.set('sub', '리디 · 로판');
    formData.set('verticalKey', 'rofan');
    formData.set('tagline', '매화는 다시 핀다');
    formData.set('synopsis', '화산파의 부활');
    formData.set('glyph', '화산');
    formData.set('bg', 'linear-gradient(red, blue)');
    formData.set('imagePath', 'public-media/ip/hwasan.png');
    formData.set('featured', 'on');
    formData.set('fansCount', '42');

    expect(normalizeAdminIpForm(formData, context)).toEqual({
      ok: true,
      value: {
        previousId: null,
        id: null,
        publicSlug: 'hwasan',
        title: '화산강림',
        sub: '리디 · 로판',
        verticalKey: 'rofan',
        tagline: '매화는 다시 핀다',
        synopsis: '화산파의 부활',
        glyph: '화산',
        bg: 'linear-gradient(red, blue)',
        imagePath: 'public-media/ip/hwasan.png',
        featured: true,
        publish: null,
      },
    });
  });

  /* 게시 의도는 제출 버튼이 정한다 — "저장 후 공개"만 true 고 나머지는 상태를 건드리지 않는다. */
  it.each([
    ['publish', true],
    ['draft', null],
    ['save', null],
    ['', null],
  ])('maps the IP form intent %j to publish %j', (intent, publish) => {
    const formData = new FormData();
    formData.set('publicSlug', 'hwasan');
    formData.set('title', '화산강림');
    formData.set('verticalKey', 'rofan');
    if (intent) formData.set('intent', intent);

    const result = normalizeAdminIpForm(formData, context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.publish).toBe(publish);
  });

  /*
   * #181 — 저장 의도를 폼이 명시한다. previousId 가 없으면 신규 등록이고,
   * 있으면 목록에서 선택한 그 레코드의 수정이다. ID 변경은 허용하지 않는다.
   */
  it.each([
    ['IP', normalizeAdminIpForm, () => {
      const formData = new FormData();
      formData.set('id', 'hwasan');
      formData.set('title', '화산강림');
      formData.set('verticalKey', 'rofan');
      return formData;
    }],

    ['이벤트', normalizeAdminEventForm, () => {
      const formData = new FormData();
      formData.set('id', 'e100');
      formData.set('title', '합동 팝업');
      formData.set('mode', '오프라인');
      formData.set('status', '예정');
      return formData;
    }],
  ])('carries the %s edit target and refuses to rename it', (_label, normalize, makeForm) => {
    const editing = makeForm();
    const editingId = String(editing.get('id'));
    editing.set('previousId', editingId);

    expect(normalize(editing, context)).toMatchObject({
      ok: true,
      value: { previousId: editingId, id: editingId },
    });

    const renamed = makeForm();
    renamed.set('previousId', editingId);
    renamed.set('id', `${editingId}-renamed`);

    expect(normalize(renamed, context)).toMatchObject({
      ok: false,
      errors: { id: '등록된 ID는 변경할 수 없습니다.' },
    });
  });

  it('rejects missing required IP fields and unknown verticals', () => {
    const formData = new FormData();
    formData.set('publicSlug', ' ');
    formData.set('title', ' ');
    formData.set('verticalKey', 'unknown');
    formData.set('fansCount', '-1');

    expect(normalizeAdminIpForm(formData, context)).toEqual({
      ok: false,
      errors: {
        publicSlug: '공개 URL을 입력해주세요.',
        title: 'IP 이름을 입력해주세요.',
        verticalKey: '등록된 IP 분류를 선택해주세요.',
      },
    });
  });

  it.each([
    ['Hwasan', '공개 URL은 영문 소문자·숫자·하이픈만 사용할 수 있습니다.'],
    ['hwasan-', '공개 URL은 영문 소문자·숫자·하이픈만 사용할 수 있습니다.'],
    ['a'.repeat(81), '공개 URL은 영문 소문자·숫자·하이픈만 사용할 수 있습니다.'],
    ['aouad', '이 공개 URL은 시스템 경로로 예약되어 있습니다.'],
  ])('rejects the new IP public URL %j', (publicSlug, message) => {
    const formData = new FormData();
    formData.set('publicSlug', publicSlug);
    formData.set('title', '화산강림');
    formData.set('verticalKey', 'rofan');
    expect(normalizeAdminIpForm(formData, context)).toEqual({ ok: false, errors: { publicSlug: message } });
  });

  it('edits an existing IP by its internal ID and never reads a public URL from the basic form', () => {
    const formData = new FormData();
    formData.set('previousId', 'hwasan');
    formData.set('id', 'hwasan');
    formData.set('publicSlug', 'ignored');
    formData.set('title', '화산강림');
    formData.set('verticalKey', 'rofan');
    expect(normalizeAdminIpForm(formData, context)).toMatchObject({
      ok: true,
      value: { previousId: 'hwasan', id: 'hwasan', publicSlug: null },
    });
  });

  it('normalizes a valid good form and rejects negative price or unknown stock', () => {
    const valid = setGoodsNotice(new FormData());
    valid.set('id', 'g100');
    valid.set('ipId', 'hwasan');
    valid.set('name', '화산강림 아크릴 스탠드');
    valid.set('type', '아크릴 스탠드');
    valid.set('price', '22000');
    valid.set('badge', 'exclusive, NEW, EXCLUSIVE');
    valid.set('stock', 'ok');
    valid.set('stockQty', '12');

    expect(normalizeAdminGoodForm(valid, context)).toEqual({
      ok: true,
      value: {
        previousId: null,
        id: 'g100',
        ipId: 'hwasan',
        code: null,
        defaultVariantCode: null,
        publish: null,
        name: '화산강림 아크릴 스탠드',
        price: 22000,
        compareAtPrice: null,
        /* 고른 순서를 지키고 표준 표기(대문자)로 맞추며, 같은 값은 한 번만 남긴다. */
        badges: ['EXCLUSIVE', 'NEW'],
        stock: 'ok',
        bg: null,
        imagePath: null,
        notice: {
          maker: '주식회사 아이콘스',
          origin: '대한민국',
          material: '아크릴',
          size: '80 x 60 x 20mm · 90g',
          madeOn: '2026-07',
          asManager: '아이콘스 고객센터',
          asContact: '02-000-0000',
        },
        description: null,
        galleryPaths: [],
        detailImagePaths: [],
      },
    });

    const invalid = setGoodsNotice(new FormData());
    invalid.set('id', 'g101');
    invalid.set('ipId', 'hwasan');
    invalid.set('name', '굿즈');
    invalid.set('type', '키링');
    invalid.set('price', '-1');
    invalid.set('stock', 'soon');
    invalid.set('stockQty', '-5');

    expect(normalizeAdminGoodForm(invalid, context)).toEqual({
      ok: false,
      errors: {
        price: '가격은 0 이상의 정수여야 합니다.',
        stock: '재고 상태를 선택해주세요.',
      },
    });
  });

  /* #326 — 정가는 취소선 표기 전용이다. 판매가 이하면 0%·음수 할인율이 나온다. */
  it('reads the compare-at price and refuses one that is not above the sale price', () => {
    function goodForm(compareAtPrice: string) {
      const formData = setGoodsNotice(new FormData());
      formData.set('id', 'g103');
      formData.set('ipId', 'hwasan');
      formData.set('name', '화산강림 아크릴 스탠드');
      formData.set('type', '아크릴');
      formData.set('price', '22000');
      formData.set('stock', 'ok');
      formData.set('compareAtPrice', compareAtPrice);
      return formData;
    }

    const onSale = normalizeAdminGoodForm(goodForm('26000'), context);
    expect(onSale).toMatchObject({ ok: true, value: { compareAtPrice: 26000 } });

    /* 빈 칸은 0 이 아니라 "할인 아님"이다. */
    expect(normalizeAdminGoodForm(goodForm('   '), context))
      .toMatchObject({ ok: true, value: { compareAtPrice: null } });

    expect(normalizeAdminGoodForm(goodForm('22000'), context)).toEqual({
      ok: false,
      errors: { compareAtPrice: '할인은 0원보다 크고 판매가보다 작아야 해요. 판매가와 할인을 확인해주세요.' },
    });
    expect(normalizeAdminGoodForm(goodForm('26000.5'), context)).toEqual({
      ok: false,
      errors: { compareAtPrice: '판매가와 할인은 0 이상의 원 단위 숫자로 입력해주세요.' },
    });
    /* 상품 엑셀(v8)은 같은 검증을 쓰되 엑셀 열 이름(판매가·즉시할인)으로 알린다(T17a·T20). */
    expect(normalizeAdminGoodForm(goodForm('22000'), context, { copy: 'workbook' })).toEqual({
      ok: false,
      errors: { compareAtPrice: '즉시할인은 1원 이상, 판매가보다 작아야 합니다.' },
    });
    expect(normalizeAdminGoodForm(goodForm('26000.5'), context, { copy: 'workbook' })).toEqual({
      ok: false,
      errors: { compareAtPrice: '판매가와 즉시할인은 0 이상의 원 단위 정수로 입력해주세요.' },
    });
  });

  /* #171 — 고시정보는 법정 표기라 한 항목이라도 비면 저장을 막는다. */
  it('rejects a good form that leaves any goods notice field blank', () => {
    const missing = setGoodsNotice(new FormData());
    missing.set('id', 'g102');
    missing.set('ipId', 'hwasan');
    missing.set('name', '오로라 아크릴 키링');
    missing.set('type', '아크릴 키링');
    missing.set('price', '9000');
    missing.set('stock', 'ok');
    missing.set('published', 'true');
    missing.set('noticeOrigin', '   ');
    missing.delete('noticeAsContact');

    expect(normalizeAdminGoodForm(missing, context)).toEqual({
      ok: false,
      errors: {
        noticeOrigin: '고시정보 필수 항목입니다.',
        noticeAsContact: '고시정보 필수 항목입니다.',
      },
    });
  });

  /* #172 — 갤러리 순서는 슬롯 번호가 정한다. 빈 슬롯은 배열에서 빠진다. */
  it('compacts gallery slots into an ordered path list', () => {
    const formData = setGoodsNotice(new FormData());
    formData.set('id', 'g13');
    formData.set('ipId', 'hwasan');
    formData.set('name', '아크릴 블록');
    formData.set('type', '아크릴 블록');
    formData.set('price', '12000');
    formData.set('stock', 'ok');
    formData.set('description', '  붉은 실을 따라 놓인 아크릴 블록입니다.  ');
    formData.set('galleryPath0', '');
    formData.set('galleryPath1', 'public-media/catalog/good/22222222-2222-4222-8222-222222222222.webp');
    formData.set('galleryPath2', '   ');
    formData.set('galleryPath3', 'public-media/catalog/good/33333333-3333-4333-8333-333333333333.webp');
    formData.set('detailImagePath', 'public-media/catalog/good/44444444-4444-4444-8444-444444444444.webp');

    expect(normalizeAdminGoodForm(formData, context)).toMatchObject({
      ok: true,
      value: {
        description: '붉은 실을 따라 놓인 아크릴 블록입니다.',
        galleryPaths: [
          'public-media/catalog/good/22222222-2222-4222-8222-222222222222.webp',
          'public-media/catalog/good/33333333-3333-4333-8333-333333333333.webp',
        ],
        detailImagePaths: ['public-media/catalog/good/44444444-4444-4444-8444-444444444444.webp'],
      },
    });
  });

  /* 2026-11-19 — 긴 상세 이미지는 detailImagePath(첫 칸)·detailImagePath1~9를 칸 순서대로 읽고 빈 칸은 뺀다. 같은 이미지를 두 번 넣으면 칸 오류다. */
  it('reads ordered long detail images, skipping blanks and rejecting a duplicate', () => {
    const formData = setGoodsNotice(new FormData());
    formData.set('id', 'g200');
    formData.set('ipId', 'hwasan');
    formData.set('name', '랜덤 티켓 세트');
    formData.set('type', '문구');
    formData.set('price', '12000');
    formData.set('stock', 'ok');
    formData.set('detailImagePath', '');
    formData.set('detailImagePath1', 'public-media/catalog/good/55555555-5555-4555-8555-555555555555.png');
    formData.set('detailImagePath4', 'public-media/catalog/good/66666666-6666-4666-8666-666666666666.png');
    formData.set('detailImagePath10', 'public-media/catalog/good/77777777-7777-4777-8777-777777777777.png');

    expect(normalizeAdminGoodForm(formData, context)).toMatchObject({
      ok: true,
      value: { detailImagePaths: [
        'public-media/catalog/good/55555555-5555-4555-8555-555555555555.png',
        'public-media/catalog/good/66666666-6666-4666-8666-666666666666.png',
      ] },
    });

    formData.set('detailImagePath5', 'public-media/catalog/good/55555555-5555-4555-8555-555555555555.png');
    expect(normalizeAdminGoodForm(formData, context)).toMatchObject({
      ok: false,
      errors: { detailImagePath5: '같은 이미지를 긴 상세 이미지에 두 번 넣을 수 없습니다.' },
    });
  });

  /* 2026-10-07 — 추가 이미지는 대표 이미지 외 9장(galleryPath0~8)까지 읽는다. 10번째 칸 이름은 읽지 않는다. */
  it('reads up to nine additional images and ignores a tenth field', () => {
    const formData = setGoodsNotice(new FormData());
    formData.set('id', 'g13');
    formData.set('ipId', 'hwasan');
    formData.set('name', '아크릴 블록');
    formData.set('type', '아크릴 블록');
    formData.set('price', '12000');
    formData.set('stock', 'ok');
    const gallery = Array.from({ length: 10 }, (_, index) => `public-media/catalog/good/${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000000.webp`);
    gallery.forEach((path, index) => formData.set(`galleryPath${index}`, path));

    expect(GOODS_GALLERY_MAX).toBe(9);
    expect(normalizeAdminGoodForm(formData, context)).toMatchObject({ ok: true, value: { galleryPaths: gallery.slice(0, 9) } });
  });

  it('rejects duplicated gallery images and an overlong description', () => {
    const duplicate = 'public-media/catalog/good/22222222-2222-4222-8222-222222222222.webp';
    const formData = setGoodsNotice(new FormData());
    formData.set('id', 'g13');
    formData.set('ipId', 'hwasan');
    formData.set('name', '아크릴 블록');
    formData.set('type', '아크릴 블록');
    formData.set('price', '12000');
    formData.set('stock', 'ok');
    formData.set('description', 'ㄱ'.repeat(2001));
    formData.set('galleryPath0', duplicate);
    formData.set('galleryPath1', duplicate);

    expect(normalizeAdminGoodForm(formData, context)).toEqual({
      ok: false,
      errors: {
        description: '설명은 2,000자 이하로 입력해주세요.',
        galleryPath1: '같은 이미지를 갤러리에 두 번 넣을 수 없습니다.',
      },
    });
  });

  it('normalizes a signed stock delta and trims its required reason', () => {
    const formData = new FormData();
    formData.set('adjustmentId', '11111111-1111-4111-8111-111111111111');
    formData.set('goodId', 'g100');
    formData.set('variantId', '22222222-2222-4222-8222-222222222222');
    formData.set('expectedStockQty', '12');
    formData.set('delta', '-3');
    formData.set('reason', '  파손 재고 보정  ');

    expect(normalizeAdminStockAdjustmentForm(formData)).toEqual({
      ok: true,
      value: {
        adjustmentId: '11111111-1111-4111-8111-111111111111',
        goodId: 'g100',
        variantId: '22222222-2222-4222-8222-222222222222',
        expectedStockQty: 12,
        delta: -3,
        reason: '파손 재고 보정',
      },
    });
  });

  it.each([
    { delta: '0', reason: '재고 조사', errors: { delta: '조정 수량은 0이 아닌 정수여야 합니다.' } },
    { delta: '1.5', reason: '재고 조사', errors: { delta: '조정 수량은 0이 아닌 정수여야 합니다.' } },
    { delta: '2147483648', reason: '재고 조사', errors: { delta: '조정 수량이 너무 큽니다. -2,147,483,648~2,147,483,647 안의 정수로 입력해주세요.' } },
    { delta: '1', reason: '   ', errors: { reason: '조정 사유를 입력해주세요.' } },
    { delta: '1', reason: '가'.repeat(201), errors: { reason: '조정 사유는 200자 이하로 입력해주세요.' } },
  ])('rejects an invalid stock adjustment: $errors', ({ delta, reason, errors }) => {
    const formData = new FormData();
    formData.set('adjustmentId', '11111111-1111-4111-8111-111111111111');
    formData.set('goodId', 'g100');
    formData.set('variantId', '22222222-2222-4222-8222-222222222222');
    formData.set('expectedStockQty', '12');
    formData.set('delta', delta);
    formData.set('reason', reason);

    expect(normalizeAdminStockAdjustmentForm(formData)).toEqual({ ok: false, errors });
  });

  it('rejects malformed idempotency and stale-stock contract fields', () => {
    const formData = new FormData();
    formData.set('adjustmentId', 'not-a-uuid');
    formData.set('goodId', 'g100');
    formData.set('variantId', '22222222-2222-4222-8222-222222222222');
    formData.set('expectedStockQty', '-1');
    formData.set('delta', '1');
    formData.set('reason', '입고');

    expect(normalizeAdminStockAdjustmentForm(formData)).toEqual({
      ok: false,
      errors: {
        adjustmentId: '재고 조정 요청을 읽지 못했습니다. 새로고침한 뒤 다시 시도해주세요.',
        expectedStockQty: '현재 실재고를 확인해주세요.',
      },
    });
  });

  it('normalizes event forms with optional IP and KST date-times', () => {
    const formData = new FormData();
    formData.set('id', 'e100');
    formData.set('ipId', '');
    formData.set('title', '합동 팝업');
    formData.set('mode', '오프라인');
    formData.set('status', '예정');
    formData.set('startsAt', '2026-07-01T10:30');
    formData.set('endsAt', '');
    formData.set('location', '성수');
    formData.set('accent', '#8B5CFF');

    expect(normalizeAdminEventForm(formData, context)).toEqual({
      ok: true,
      value: {
        previousId: null,
        id: 'e100',
        ipId: null,
        title: '합동 팝업',
        mode: '오프라인',
        status: '예정',
        startsAt: '2026-07-01T01:30:00.000Z',
        endsAt: null,
        location: '성수',
        accent: '#8B5CFF',
        bg: null,
        imagePath: null,
      },
    });
  });

  it('rejects malformed event date-times before RPC submission', () => {
    const formData = new FormData();
    formData.set('id', 'e101');
    formData.set('title', '합동 팝업');
    formData.set('mode', '오프라인');
    formData.set('status', '예정');
    formData.set('startsAt', '2026/07/01 10:30');
    formData.set('endsAt', '2026-13-01T10:30');

    expect(normalizeAdminEventForm(formData, context)).toEqual({
      ok: false,
      errors: {
        startsAt: '일시는 날짜와 시각(시·분)까지 모두 골라주세요.',
        endsAt: '일시는 날짜와 시각(시·분)까지 모두 골라주세요.',
      },
    });
  });

  it('normalizes a valid ticket session without exposing sold or deferred sales settings', () => {
    const formData = new FormData();
    formData.set('operationId', '11111111-1111-4111-8111-111111111111');
    formData.set('id', '22222222-2222-4222-8222-222222222222');
    formData.set('eventId', 'e100');
    formData.set('name', '  7월 25일 1회차  ');
    formData.set('price', '25000');
    formData.set('capacity', '80');
    formData.set('sold', '999');
    formData.set('perUserLimit', '99');
    formData.set('salesOpenAt', '2026-07-20T10:00');

    expect(normalizeAdminTicketTypeForm(formData, context)).toEqual({
      ok: true,
      value: {
        operationId: '11111111-1111-4111-8111-111111111111',
        id: '22222222-2222-4222-8222-222222222222',
        eventId: 'e100',
        name: '7월 25일 1회차',
        price: 25000,
        capacity: 80,
      },
    });
  });

  it('rejects invalid ticket session identifiers, event, name, price, and capacity', () => {
    const formData = new FormData();
    formData.set('operationId', 'not-a-uuid');
    formData.set('id', 'also-not-a-uuid');
    formData.set('eventId', 'missing');
    formData.set('name', '   ');
    formData.set('price', '-1');
    formData.set('capacity', '1.5');

    expect(normalizeAdminTicketTypeForm(formData, context)).toEqual({
      ok: false,
      errors: {
        operationId: '저장 요청을 읽지 못했습니다. 새로고침한 뒤 다시 저장해주세요.',
        id: '티켓 회차를 찾지 못했습니다. 새로고침한 뒤 다시 골라주세요.',
        eventId: '등록된 이벤트를 선택해주세요.',
        name: '회차명을 입력해주세요.',
        price: '가격은 0 이상의 정수여야 합니다.',
        capacity: '정원은 0 이상의 정수여야 합니다.',
      },
    });
  });

  it('rejects ticket values outside the PostgreSQL integer range', () => {
    const formData = new FormData();
    formData.set('operationId', '11111111-1111-4111-8111-111111111111');
    formData.set('id', '22222222-2222-4222-8222-222222222222');
    formData.set('eventId', 'e100');
    formData.set('name', '회차');
    formData.set('price', '2147483648');
    formData.set('capacity', '2147483648');

    expect(normalizeAdminTicketTypeForm(formData, context)).toEqual({
      ok: false,
      errors: {
        price: '가격은 0 이상의 정수여야 합니다.',
        capacity: '정원은 0 이상의 정수여야 합니다.',
      },
    });
  });

  it('builds good-to-IP validation truth from the catalog snapshot', () => {
    expect(catalogContextFromSnapshot({
      events: [],
      goods: [
        { id: 'g100', ip: 'hwasan' },
        { id: 'g200', ip: 'lumen' },
      ],
      ips: [{ id: 'hwasan' }, { id: 'lumen' }],
      verticals: [],
    }).goodIpById).toEqual(new Map([
      ['g100', 'hwasan'],
      ['g200', 'lumen'],
    ]));
  });

});
