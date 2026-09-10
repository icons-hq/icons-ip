import { describe, expect, it } from 'vitest';
import { goodsLinkedMetadataRpcFields, readGoodsLinkedMetadata } from './goods-linked-metadata';

describe('상품 분류와 배송 템플릿 입력 계약', () => {
  it('기존 호출의 생략과 명시 해제를 구별한다', () => {
    const form = new FormData();
    expect(goodsLinkedMetadataRpcFields(readGoodsLinkedMetadata(form).value)).toEqual({});
    form.set('categoryId', ''); form.set('shippingNoticeTemplate', '');
    expect(goodsLinkedMetadataRpcFields(readGoodsLinkedMetadata(form).value)).toEqual({
      category_id: null, shipping_notice_template_code: null, shipping_notice_template_version: null,
    });
  });
  it('같은 템플릿 선택을 폼과 엑셀에서 동일하게 보존한다', () => {
    const form = new FormData(); form.set('shippingNoticeTemplate', 'standard@3');
    const workbook = new FormData(); workbook.set('shippingNoticeTemplateCode', 'standard'); workbook.set('shippingNoticeTemplateVersion', '3');
    expect(readGoodsLinkedMetadata(form)).toEqual(readGoodsLinkedMetadata(workbook));
    expect(goodsLinkedMetadataRpcFields(readGoodsLinkedMetadata(form).value)).toEqual({ shipping_notice_template_code: 'standard', shipping_notice_template_version: 3 });
  });
  it('버전 누락과 잘못된 분류를 0 또는 미분류로 바꾸지 않는다', () => {
    const form = new FormData(); form.set('categoryId', 'invalid'); form.set('shippingNoticeTemplate', 'standard@');
    expect(Object.keys(readGoodsLinkedMetadata(form).errors)).toEqual(['categoryId', 'shippingNoticeTemplate']);
    for (const text of ['standard@0', '@1', 'standard@2@3', 'standard@1e3']) {
      form.set('shippingNoticeTemplate', text);
      expect(readGoodsLinkedMetadata(form).errors.shippingNoticeTemplate).toBeTruthy();
    }
  });
});
