import { describe, expect, it } from 'vitest';
import {
  normalizeGoodsVariantExternalIdentity,
  readGoodsVariantExternalIdentityForm,
} from './variant-external-identity';

describe('상품 옵션 ERP 식별자', () => {
  it('trims text and preserves leading zeroes', () => {
    expect(normalizeGoodsVariantExternalIdentity({
      erpCode: '  0000123 ', erpName: ' ERP 품명 ', barcode: ' 0088012345678 ',
    })).toEqual({
      ok: true,
      value: { erpCode: '0000123', erpName: 'ERP 품명', barcode: '0088012345678' },
    });
  });

  it('maps blank fields to null and keeps own option code outside this shape', () => {
    const form = new FormData();
    form.set('erpCode', '  ');
    form.set('erpName', '');
    form.set('barcode', '0007');
    expect(readGoodsVariantExternalIdentityForm(form)).toEqual({
      ok: true,
      value: { erpCode: null, erpName: null, barcode: '0007' },
    });
  });

  it('rejects non-string values and bounded overflow', () => {
    expect(normalizeGoodsVariantExternalIdentity({ erpCode: 123 })).toEqual({ ok: false, error: 'invalid' });
    expect(normalizeGoodsVariantExternalIdentity({ barcode: 'x'.repeat(121) })).toEqual({ ok: false, error: 'invalid' });
    expect(normalizeGoodsVariantExternalIdentity({ erpName: 'x'.repeat(201) })).toEqual({ ok: false, error: 'invalid' });
  });
});
