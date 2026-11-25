import { describe, expect, it } from 'vitest';
import type { Ip } from '@/lib/data';
import { buildGoodPreview, goodFormValues, goodPreviewPeriodNote, goodPreviewPeriodState } from './good-preview';
import { pdpPriceView } from '@/components/shop/PdpPrice';
import { parseGoodsKcDisclosures } from '@/lib/goods-kc';
import { goodOptionPurchaseNotices } from '@/lib/goods-options';
import { RANDOM_OPTION_LABEL, RANDOM_OPTION_NOTICE } from '@/lib/goods-option-sale-mode';

const ip: Ip = {
  id: 'hong-sil-quest',
  title: '홍실 퀘스트',
  sub: 'SOOP2RANG · 캐릭터 IP',
  v: { key: 'character', label: '캐릭터 IP', color: '#FFD84D' },
  glyph: '홍실',
  bg: 'linear-gradient(#300008, #FF2E63)',
  fans: 0,
  goods: 3,
  cards: 0,
  featured: false,
  tagline: '붉은 실을 따라',
  synopsis: '홍실 퀘스트 컬렉션',
};

const values = {
  id: 'g13',
  ipId: 'hong-sil-quest',
  name: '  아크릴 블록  ',
  price: '12000',
  badge: 'EXCLUSIVE, NEW',
  stock: 'low',
  description: '  붉은 실을 따라 놓인 아크릴 블록입니다.  ',
  noticeMaker: '주식회사 아이콘스',
  noticeOrigin: '대한민국',
  noticeMaterial: '아크릴',
  noticeSize: '80 x 60 x 20mm · 90g',
  noticeMadeOn: '2026-07',
  noticeAsManager: '엑스스퀘어 고객센터',
  noticeAsContact: '02-000-0000',
};

describe('어드민 굿즈 미리보기', () => {
  it('저장된 검토 기준의 KC 표를 공개 상세와 같은 파생 함수로 전달한다', () => {
    const disclosures=parseGoodsKcDisclosures([{family:'living',scheme:'not_applicable',productCategory:'합성 분류',modelName:'합성 모델',
      businessRole:'manufacturer',businessName:'합성 제조자',identifier:'',publicNote:'합성 해당 없음 안내',
      variants:[{id:'00000000-0000-4000-8000-000000050901',name:'기본 옵션'}]}])!;
    const input={values,imageUrls:{},ip,fallbackBg:null,stockQty:0,kcDisclosures:disclosures};
    expect(buildGoodPreview(input).kcDisclosures).toEqual(disclosures);
    expect(buildGoodPreview({...input,kcDisclosures:[]}).kcDisclosures).toEqual([]);
  });
  it('현재 HTML 입력을 저장 서버와 같은 문서/이미지 형식으로 미리본다', () => {
    const path = 'public-media/catalog/good/22222222-2222-4222-8222-222222222222.webp';
    const preview = buildGoodPreview({ values: { ...values, descriptionFormat: 'html', description: `<h2>상세</h2><img src="${path}" alt="앞면"><img src="https://img.example.com/x.png"><img src="/x.png"><script>alert(1)</script>` }, imageUrls: {}, ip, fallbackBg: null, stockQty: 0 });
    /* 호스팅 이미지는 주소 그대로 보이되 저장소 소유 검증 목록(descriptionImagePaths)에는 들어가지 않는다. */
    expect(preview).toMatchObject({ descriptionFormat: 'html', descriptionImagePaths: [path], description: `<h2>상세</h2><img src="${path}" alt="앞면" loading="lazy" decoding="async" /><img src="https://img.example.com/x.png" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` });
  });
  it('projects unsaved option prices, order and total inventory into the public preview', () => {
    const preview = buildGoodPreview({ values: { ...values, price: '1000', variants: JSON.stringify([
      { name: '파랑 / L', code: 'B-L', attributes: { 색상: '파랑', 사이즈: 'L' }, extraPrice: 500, stockQty: 2 },
      { name: '빨강 / M', code: 'R-M', attributes: { 색상: '빨강', 사이즈: 'M' }, extraPrice: 0, stockQty: 3 },
    ]) }, imageUrls: {}, ip, fallbackBg: null, stockQty: 99 });
    expect(preview.good).toMatchObject({ price: 1000, priceMax: 1500, stockQty: 5, options: [
      { name: '파랑 / L', price: 1500, stockQty: 2, isDefault: true },
      { name: '빨강 / M', price: 1000, stockQty: 3, isDefault: false },
    ] });
  });
  /* S36-051 — 미리보기는 공개 상세와 같다: 랜덤 판매 상품은 판매 중인 옵션을 '랜덤' 한 줄(풀 합계)로 접고 랜덤 안내를 보인다. */
  it('랜덤 판매 상품은 공개 상세처럼 옵션을 랜덤 한 줄로 접고 같은 옵션 배정 상한 안내까지 같게 보인다', () => {
    const variants = JSON.stringify([
      { name: '기훈', code: 'K', attributes: { 종류: '기훈' }, extraPrice: 0, stockQty: 2, orderMaxQty: 1, memberMaxQty: 2 },
      { name: '홍실', code: 'H', attributes: { 종류: '홍실' }, extraPrice: 0, stockQty: 3, orderMaxQty: 1, memberMaxQty: 2 },
      { name: '무영', code: 'M', attributes: { 종류: '무영' }, extraPrice: 0, stockQty: 9, isActive: false, orderMaxQty: 1, memberMaxQty: 2 },
    ]);
    const input = { values: { ...values, price: '15000', variants }, imageUrls: {}, ip, fallbackBg: null, stockQty: 0 };
    const random = buildGoodPreview({ ...input, optionSaleMode: 'random' });
    expect(random.good.optionSaleMode).toBe('random');
    expect(random.good.options).toEqual([expect.objectContaining({ name: RANDOM_OPTION_LABEL, price: 15000, stockQty: 5, isDefault: true, attributes: {}, randomAllocationLimit: { orderMaxQty: 1, memberMaxQty: 2 } })]);
    expect(random.good.stockQty).toBe(5);
    expect(goodOptionPurchaseNotices(random.good, random.good.options![0])).toEqual([RANDOM_OPTION_NOTICE, '같은 옵션은 한 번에 1개, 1인당 2개까지 배정됩니다.']);
    /* 일반 판매는 지금처럼 옵션 행을 그대로 보인다. */
    const select = buildGoodPreview({ ...input, optionSaleMode: 'select' });
    expect(select.good.optionSaleMode).toBeUndefined();
    expect(select.good.options?.map((option) => option.name)).toEqual(['기훈', '홍실']);
  });

  /* 0901-015 — 비운 재고 칸(NaN)은 미리보기에서 0개(품절)로 본다. */
  it('비운 재고 칸은 미리보기 재고를 깨지 않고 0개로 센다', () => {
    const preview = buildGoodPreview({ values: { ...values, variants: JSON.stringify([{ name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: null }]) }, imageUrls: {}, ip, fallbackBg: null, stockQty: 7 });
    expect(preview.good).toMatchObject({ stockQty: 0, stock: 'soldout' });
  });

  /* #184 — 저장된 값이 아니라 지금 폼에 들어 있는 값을 그린다. */
  it('폼 값과 업로드 전 이미지를 공개 화면 모양으로 옮긴다', () => {
    const preview = buildGoodPreview({
      values,
      imageUrls: {
        imagePath: 'blob:selected-main',
        galleryPath0: 'blob:selected-gallery-0',
        galleryPath2: 'blob:selected-gallery-2',
        detailImagePath: 'https://cdn.example/detail.webp',
        detailImagePath2: 'https://cdn.example/detail-2.webp',
      },
      fallbackBg: null,
      ip,
      stockQty: 8,
    });

    expect(preview.good).toEqual({
      id: 'g13',
      name: '아크릴 블록',
      nameEn: undefined,
      searchKeywords: [],
      displayOrder: null, categoryId: null,
      allowCardPayment: true, allowBankTransfer: true, saleRestriction: 'none',
      orderQuantityLimitEnabled: false, minOrderQty: null, maxOrderQty: null,
      memberPurchaseLimitEnabled: false, memberLifetimeQtyLimit: null,
      ip: 'hong-sil-quest',
      price: 12000,
      catalogPrice: 12000,
      catalogCompareAtPrice: null,
      compareAtPrice: null,
      showDiscountRate: true,
      badge: 'EXCLUSIVE',
      badges: ['EXCLUSIVE', 'NEW'],
      stock: 'low',
      stockQty: 8,
      img: 'url("blob:selected-main") center / cover no-repeat',
    });
    expect(preview.gallery).toEqual([
      'url("blob:selected-gallery-0") center / cover no-repeat',
      'url("blob:selected-gallery-2") center / cover no-repeat',
    ]);
    expect(preview.detailImageUrls).toEqual(['https://cdn.example/detail.webp', 'https://cdn.example/detail-2.webp']);
    expect(preview.description).toBe('붉은 실을 따라 놓인 아크릴 블록입니다.');
    expect(preview.notice.maker).toBe('주식회사 아이콘스');
    expect(preview.ip).toBe(ip);
  });

  it('비어 있는 입력을 안전한 자리표시로 떨어뜨린다', () => {
    const preview = buildGoodPreview({
      values: { price: '-5', stock: 'unknown' },
      imageUrls: {},
      fallbackBg: null,
      ip: null,
      stockQty: 0,
    });

    expect(preview.good.name).toBe('(상품 이름 미입력)');
    expect(preview.good.price).toBe(0);
    expect(preview.good.stock).toBe('ok');
    expect(preview.good.img).toContain('linear-gradient');
    expect(preview.description).toBeNull();
    expect(preview.notice.origin).toBeNull();
  });

  /*
   * #184 완료 조건 — 저장된 값이 아니라 폼에 지금 있는 값이 반영돼야 한다.
   * 저장 전 수정본을 그대로 읽어 미리보기가 바뀌는지 확인한다.
   */
  it('저장하지 않은 폼 수정본을 그대로 읽어 미리보기에 반영한다', () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries(values)) formData.set(key, value);
    formData.set('name', '수정 중인 이름');
    formData.set('price', '15000');
    formData.set('noticeOrigin', '일본');
    formData.set('imagePath', 'public-media/catalog/good/11111111-1111-4111-8111-111111111111.webp');

    const preview = buildGoodPreview({
      values: goodFormValues(formData),
      imageUrls: {},
      fallbackBg: 'url("/generated/goods/g13.webp") center / cover no-repeat',
      ip,
      stockQty: 8,
    });

    expect(preview.good.name).toBe('수정 중인 이름');
    expect(preview.good.price).toBe(15000);
    expect(preview.notice.origin).toBe('일본');
  });

  it('파일 항목은 폼 값에서 걸러낸다', () => {
    const formData = new FormData();
    formData.set('name', '아크릴 블록');
    formData.set('artwork', new File(['x'], 'x.png', { type: 'image/png' }));

    expect(goodFormValues(formData)).toEqual({ name: '아크릴 블록' });
  });

  /*
   * 2026-11-25 — 저장 전 미리보기에 할인 표기가 나와야 한다. 즉시할인(기간 없음)은 폼의 price=할인가·compareAtPrice=판매가로 정해지고,
   * 고객 화면(PdpPrice·PriceBlock)이 그 값으로 취소선 정가·할인율을 그린다. 미리보기가 같은 값을 싣는지 고객 화면의 판정 함수로 확인한다.
   */
  describe('할인 표기', () => {
    const discounted = { ...values, price: '9000', compareAtPrice: '10000' };
    const build = (changes: Record<string, string> = {}, extra: Partial<Parameters<typeof buildGoodPreview>[0]> = {}) =>
      buildGoodPreview({ values: { ...discounted, ...changes }, imageUrls: {}, ip, fallbackBg: null, stockQty: 0, ...extra }).good;
    const shown = (good: ReturnType<typeof build>) => pdpPriceView({ compareAtPrice: good.compareAtPrice, price: good.price, priceMax: good.priceMax, showDiscountRate: good.showDiscountRate });

    it('즉시할인은 판매가를 정가로 싣고 고객 화면처럼 취소선 정가와 할인율을 보인다', () => {
      const good = build();
      expect(good).toMatchObject({ price: 9000, catalogPrice: 9000, compareAtPrice: 10000, catalogCompareAtPrice: 10000, showDiscountRate: true });
      expect(shown(good)).toMatchObject({ original: '₩10,000', rate: '10%', amount: '₩9,000' });
    });

    it('할인율 표시를 끄면 정가와 할인율을 숨기고 할인가만 보인다', () => {
      const good = build({ showDiscountRate: 'false' });
      expect(good.showDiscountRate).toBe(false);
      expect(shown(good)).toMatchObject({ original: null, rate: null, amount: '₩9,000' });
    });

    it('정가가 비었거나 할인가보다 크지 않으면 할인으로 보지 않는다', () => {
      for (const compareAtPrice of ['', '9000', '8000', 'abc']) {
        const good = build({ compareAtPrice });
        expect(good, compareAtPrice).toMatchObject({ compareAtPrice: null, catalogCompareAtPrice: null });
        expect(shown(good).original, compareAtPrice).toBeNull();
      }
    });

    it('옵션이 있으면 가장 싼 옵션의 정가를 취소선으로 보이고, 옵션가는 할인하지 않는다', () => {
      const variants = JSON.stringify([
        { name: 'M', code: 'M', attributes: {}, extraPrice: 500, stockQty: 2 },
        { name: 'S', code: 'S', attributes: {}, extraPrice: 0, stockQty: 3 },
      ]);
      const good = build({ variants });
      /* 가장 싼 옵션 S는 9,000원이고 정가는 그 옵션 금액에 상품 할인 금액 1,000원을 더한 10,000원이다. */
      expect(good).toMatchObject({ price: 9000, priceMax: 9500, compareAtPrice: 10000, catalogCompareAtPrice: 10000 });
    });

    describe('특정기간만 할인', () => {
      /* 폼의 price는 판매가 그대로이고 compareAtPrice는 비어 있다. 기간과 금액은 따로 받는다. */
      const period = { amount: 1000, startsAt: '2026-11-30T15:00:00.000Z', endsAt: '2026-12-07T15:00:00.000Z' };
      const regular = { price: '10000', compareAtPrice: '' };
      const at = (iso: string) => Date.parse(iso);

      it('기간 안이면 옵션마다 같은 금액을 빼고 정가를 취소선으로 보인다', () => {
        const good = build(regular, { pricePeriod: period, now: at('2026-12-03T00:00:00+09:00') });
        expect(good).toMatchObject({ price: 9000, compareAtPrice: 10000, catalogPrice: 10000, catalogCompareAtPrice: null });
        expect(shown(good)).toMatchObject({ original: '₩10,000', rate: '10%', amount: '₩9,000' });
        const variants = JSON.stringify([
          { name: 'M', code: 'M', attributes: {}, extraPrice: 500, stockQty: 2 },
          { name: 'S', code: 'S', attributes: {}, extraPrice: 0, stockQty: 3 },
        ]);
        const options = build({ ...regular, variants }, { pricePeriod: period, now: at('2026-12-03T00:00:00+09:00') });
        expect(options.options?.map((option) => [option.name, option.price, option.pricing?.regularPrice])).toEqual([['M', 9500, 10500], ['S', 9000, 10000]]);
        expect(options).toMatchObject({ price: 9000, priceMax: 9500, compareAtPrice: 10000 });
      });

      it('시작 전과 종료 뒤에는 판매가이고 할인 표기가 없다', () => {
        for (const now of ['2026-11-25T00:00:00+09:00', '2026-12-08T00:00:00+09:00']) {
          const good = build(regular, { pricePeriod: period, now: at(now) });
          expect(good, now).toMatchObject({ price: 10000, compareAtPrice: null });
          expect(shown(good).original, now).toBeNull();
        }
      });

      it('시작 시각에는 할인이 시작되고 종료 시각부터는 판매가로 돌아간다', () => {
        expect(build(regular, { pricePeriod: period, now: Date.parse(period.startsAt) }).price).toBe(9000);
        expect(build(regular, { pricePeriod: period, now: Date.parse(period.endsAt) - 1 }).price).toBe(9000);
        expect(build(regular, { pricePeriod: period, now: Date.parse(period.endsAt) }).price).toBe(10000);
      });

      it('기간 할인이 어긋나 판매 금액보다 크면 0원 밑으로 내리지 않는다', () => {
        const good = build(regular, { pricePeriod: { ...period, amount: 50000 }, now: at('2026-12-03T00:00:00+09:00') });
        expect(good.price).toBe(0);
      });

      it('기간 판정은 시작 전·기간 중·종료 뒤 셋이다', () => {
        expect(goodPreviewPeriodState(period, Date.parse(period.startsAt) - 1)).toBe('before');
        expect(goodPreviewPeriodState(period, Date.parse(period.startsAt))).toBe('active');
        expect(goodPreviewPeriodState(period, Date.parse(period.endsAt))).toBe('ended');
      });

      /* 시작 전이면 미리보기에 할인이 없는 까닭을 한 줄로 알린다. 기간 중에는 할인이 보이고 기간이 없으면 말할 것이 없다. */
      it('시작 전에만 할인이 아직 나오지 않는 까닭을 알린다', () => {
        expect(goodPreviewPeriodNote(period, Date.parse(period.startsAt) - 1)).toBe('할인 시작 전이라 미리보기에는 아직 할인이 나오지 않습니다.');
        expect(goodPreviewPeriodNote(period, Date.parse(period.startsAt))).toBeUndefined();
        expect(goodPreviewPeriodNote(period, Date.parse(period.endsAt))).toBeUndefined();
        expect(goodPreviewPeriodNote(null)).toBeUndefined();
      });
    });
  });

  it('아트워크가 없으면 레거시 배경 값으로 떨어진다', () => {
    const preview = buildGoodPreview({
      values,
      imageUrls: {},
      fallbackBg: 'url("/generated/goods/g13.webp") center / cover no-repeat',
      ip,
      stockQty: 0,
    });

    expect(preview.good.img).toBe('url("/generated/goods/g13.webp") center / cover no-repeat');
  });
});
