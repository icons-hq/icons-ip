import { describe, expect, it } from 'vitest';
import {
  normalizeShippingNoticeTemplateFilters,
  parseShippingNoticeTemplateInput,
  shippingNoticeTemplateHref,
} from './shipping-notice-templates';

describe('배송정보 템플릿 계약', () => {
  it('초안은 안내 문구를 비워 저장할 수 있지만 식별자와 이름을 검증한다', () => {
    expect(parseShippingNoticeTemplateInput({
      code: 'basic-v2', version: '2', name: '기본 배송 안내', shippingNotice: '',
      returnExchangeNotice: '', csName: '', csPhone: '', csEmail: '',
    })).toMatchObject({ ok: true, value: { code: 'basic-v2', version: 2 } });
    expect(parseShippingNoticeTemplateInput({
      code: 'Bad Code', version: '0', name: '', shippingNotice: '',
      returnExchangeNotice: '', csName: '', csPhone: '', csEmail: '',
    })).toMatchObject({ ok: false, errors: { code: expect.any(String), version: expect.any(String), name: expect.any(String) } });
  });

  it('고객센터 이메일과 제어 문자를 검증하고 정상 줄바꿈은 허용한다', () => {
    const result = parseShippingNoticeTemplateInput({
      code: 'basic', version: '2', name: '기본', shippingNotice: '배송 안내',
      returnExchangeNotice: '교환 안내', csName: 'CS', csPhone: '', csEmail: 'invalid',
    });
    expect(result).toMatchObject({ ok: false, errors: { csEmail: expect.stringContaining('형식') } });
    const multiline = parseShippingNoticeTemplateInput({
      code: 'basic', version: '2', name: '기본', shippingNotice: '배송\n안내',
      returnExchangeNotice: '', csName: '', csPhone: '', csEmail: '',
    });
    expect(multiline).toMatchObject({ ok: true, value: { shipping_notice: '배송\n안내' } });
    const control = parseShippingNoticeTemplateInput({
      code: 'basic', version: '2', name: '기본', shippingNotice: '배송\u0000안내',
      returnExchangeNotice: '', csName: '', csPhone: '', csEmail: '',
    });
    expect(control).toMatchObject({ ok: false, errors: { shippingNotice: expect.any(String) } });
  });

  it('템플릿과 상품 검색 조건을 URL에 보존한다', () => {
    const filters = normalizeShippingNoticeTemplateFilters({ q: ' 기본 ', good: 'g-1', page: '2' });
    expect(filters).toEqual({ query: '기본', goodQuery: 'g-1', page: 2 });
    expect(shippingNoticeTemplateHref(filters)).toBe('/admin/settings/shipping-notices?q=%EA%B8%B0%EB%B3%B8&good=g-1&page=2');
  });
});
