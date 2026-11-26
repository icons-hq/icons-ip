import { describe, expect, it } from 'vitest';
import {
  normalizeShippingNoticeTemplateFilters,
  parseShippingNoticeTemplateInput,
  sameShippingNoticeTemplateValues,
  shippingNoticeTemplateAppliedNotice,
  shippingNoticeTemplateHref,
  shippingNoticeTemplateSaveConfirm,
  shippingNoticeTemplateSavedNotice,
  shippingNoticeTemplateValues,
} from './shipping-notice-templates';

const filled = {
  name: ' 기본 배송 안내 ', shippingNotice: '결제 후 2~3일 안에 보냅니다.', returnExchangeNotice: '주문 상세에서 신청해 주세요.',
  remoteAreaNotice: '', csName: '고객센터', csPhone: '02-000-0000', csEmail: '',
};

describe('배송 안내 템플릿 입력', () => {
  it('이름과 본문만 읽는다 — 코드와 버전은 받지 않는다', () => {
    const parsed = parseShippingNoticeTemplateInput({ ...filled, code: 'basic', version: '7' });
    expect(parsed).toEqual({ ok: true, value: {
      name: '기본 배송 안내', shipping_notice: '결제 후 2~3일 안에 보냅니다.', return_exchange_notice: '주문 상세에서 신청해 주세요.',
      remote_area_notice: '', cs_name: '고객센터', cs_phone: '02-000-0000', cs_email: '',
    } });
  });

  /* 저장하면 바로 상품에서 고를 수 있다. 고객에게 보일 필수 안내가 비면 그 칸에서 말한다. */
  it('필수 안내가 비어 있으면 그 칸에서 말한다', () => {
    const parsed = parseShippingNoticeTemplateInput({ name: '', shippingNotice: ' ', returnExchangeNotice: '', remoteAreaNotice: '', csName: '', csPhone: '', csEmail: '' });
    expect(parsed).toEqual({ ok: false, errors: {
      name: '템플릿 이름을 1~80자로 적어 주세요.',
      shippingNotice: '배송 안내를 적어 주세요. 상품 상세에 그대로 보입니다.',
      returnExchangeNotice: '교환·반품 안내를 적어 주세요. 상품 상세에 그대로 보입니다.',
      csName: '고객센터 이름을 적어 주세요.',
      csPhone: '고객센터 전화와 이메일 가운데 하나는 적어 주세요.',
    } });
  });

  it('고객센터 연락처는 전화나 이메일 하나면 된다', () => {
    expect(parseShippingNoticeTemplateInput({ ...filled, csPhone: '', csEmail: 'help@example.com' })).toMatchObject({ ok: true, value: { cs_phone: '', cs_email: 'help@example.com' } });
    expect(parseShippingNoticeTemplateInput({ ...filled, csPhone: '', csEmail: 'invalid' })).toEqual({ ok: false, errors: { csEmail: '고객센터 이메일을 name@example.com처럼 적어 주세요.' } });
  });

  it('도서산간 안내는 선택 칸이고, 줄바꿈은 받고 제어 문자와 긴 글은 받지 않는다', () => {
    expect(parseShippingNoticeTemplateInput({ ...filled, remoteAreaNotice: ' 제주\n도서산간 ', shippingNotice: '첫 줄\n둘째 줄\t탭' }))
      .toMatchObject({ ok: true, value: { remote_area_notice: '제주\n도서산간', shipping_notice: '첫 줄\n둘째 줄\t탭' } });
    expect(parseShippingNoticeTemplateInput({ ...filled, remoteAreaNotice: '가'.repeat(4001) })).toMatchObject({ ok: false, errors: { remoteAreaNotice: expect.stringContaining('4000') } });
    expect(parseShippingNoticeTemplateInput({ ...filled, shippingNotice: '배송\u0000안내' })).toMatchObject({ ok: false, errors: { shippingNotice: expect.stringContaining('4000') } });
    expect(parseShippingNoticeTemplateInput({ ...filled, name: '가'.repeat(81) })).toMatchObject({ ok: false, errors: { name: expect.any(String) } });
  });

  it('적은 내용이 저장된 내용과 같은지는 앞뒤 공백을 빼고 본다', () => {
    const saved = shippingNoticeTemplateValues({ ...filled, name: '기본 배송 안내' });
    expect(sameShippingNoticeTemplateValues(shippingNoticeTemplateValues(filled), saved)).toBe(true);
    expect(sameShippingNoticeTemplateValues({ ...saved, csPhone: '02-000-0001' }, saved)).toBe(false);
    expect(shippingNoticeTemplateValues(null)).toEqual({ name: '', shippingNotice: '', returnExchangeNotice: '', remoteAreaNotice: '', csName: '', csPhone: '', csEmail: '' });
  });
});

describe('배송 안내 템플릿 조회 조건', () => {
  it('템플릿 이름과 페이지만 URL에 남긴다 — 상품 찾기 조건은 없다', () => {
    const filters = normalizeShippingNoticeTemplateFilters({ q: ' 기본 ', good: 'g-1', page: '2' });
    expect(filters).toEqual({ query: '기본', page: 2 });
    expect(shippingNoticeTemplateHref(filters)).toBe('/admin/settings/shipping-notices?q=%EA%B8%B0%EB%B3%B8&page=2');
    expect(shippingNoticeTemplateHref({ query: '', page: 1 })).toBe('/admin/settings/shipping-notices');
    expect(normalizeShippingNoticeTemplateFilters({ page: '-3' })).toEqual({ query: '', page: 1 });
  });
});

describe('배송 안내 템플릿의 확인창과 결과 문장', () => {
  it('저장 전 확인창은 안내가 바뀌는 상품 수와 고객 화면에 반영되는 것을 말한다', () => {
    expect(shippingNoticeTemplateSaveConfirm('기본 안내', 1234)).toEqual({
      title: '‘기본 안내’ 템플릿을 저장할까요?',
      message: '이 템플릿을 쓰는 상품 1,234개의 배송·교환·반품 안내가 새 내용으로 바뀝니다. 공개 중인 상품은 고객이 보는 상품 상세에 바로 반영됩니다.',
      confirmLabel: '저장', cancelLabel: '돌아가기',
    });
  });

  it('결과 한 줄은 등록·저장·바뀐 상품 수를 가려 말한다', () => {
    expect(shippingNoticeTemplateSavedNotice({ name: '기본 안내', created: true, appliedGoods: 0 })).toBe('‘기본 안내’ 템플릿을 등록했습니다. 상품등록의 [템플릿 고르기]에서 바로 고를 수 있습니다.');
    expect(shippingNoticeTemplateSavedNotice({ name: '기본 안내', created: false, appliedGoods: 12 })).toBe('‘기본 안내’ 템플릿을 저장했습니다. 이 템플릿을 쓰는 상품 12개의 안내를 새 내용으로 바꿨습니다.');
    expect(shippingNoticeTemplateSavedNotice({ name: '기본 안내', created: false, appliedGoods: 0 })).toBe('‘기본 안내’ 템플릿을 저장했습니다.');
  });

  it('상품 적용 결과는 된 것·이미 쓰던 것·안 된 것을 나눠 말한다', () => {
    expect(shippingNoticeTemplateAppliedNotice('기본 안내', { applied: 3, unchanged: 0, failed: [] })).toBe('‘기본 안내’ 템플릿을 상품 3개에 적용했습니다.');
    expect(shippingNoticeTemplateAppliedNotice('기본 안내', { applied: 0, unchanged: 2, failed: [] })).toBe('‘기본 안내’ 템플릿을 새로 적용한 상품이 없습니다. 이미 이 템플릿을 쓰던 2개는 그대로입니다.');
    const failed = ['키링', '엽서', '배지', '스티커'].map((name) => ({ name, reason: '보관한 상품' }));
    expect(shippingNoticeTemplateAppliedNotice('기본 안내', { applied: 1, unchanged: 1, failed }))
      .toBe('‘기본 안내’ 템플릿을 상품 1개에 적용했습니다. 이미 이 템플릿을 쓰던 1개는 그대로입니다. 적용하지 못한 상품 4개: 키링(보관한 상품), 엽서(보관한 상품), 배지(보관한 상품) 외 1개.');
    expect(shippingNoticeTemplateAppliedNotice('기본 안내', { applied: 1, unchanged: 0, failed: [], stopped: true }))
      .toBe('‘기본 안내’ 템플릿을 상품 1개에 적용했습니다. 중간에 멈춰 남은 상품에는 적용하지 못했습니다. 목록의 ‘쓰는 상품’ 수를 확인한 뒤 [상품에 적용]으로 다시 넣어 주세요.');
  });
});
