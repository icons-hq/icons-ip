import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GoodsKcDisclosure as Disclosure } from '@/lib/goods-kc';
import { GoodsKcDisclosure } from './GoodsKcDisclosure';

const notApplicable: Disclosure = { family: 'other', scheme: 'not_applicable', productCategory: '', modelName: '', businessRole: '',
  businessName: '', identifier: '', publicNote: '', variants: [{ id: '00000000-0000-4000-8000-000000000001', name: '기본' }] };
const certified: Disclosure = { family: 'children', scheme: 'safety_confirmation', productCategory: '합성 분류', modelName: '합성 모델',
  businessRole: 'importer', businessName: '합성 수입자', identifier: 'TEST-ONLY-1', publicNote: '',
  variants: [{ id: '00000000-0000-4000-8000-000000000002', name: '파랑' }] };

describe('고객 상세 KC 고시', () => {
  it('상품 전체 해당 없음은 빈 칸·빈 제목 없이 KC 인증 대상이 아님만 알린다', () => {
    const html = renderToStaticMarkup(<GoodsKcDisclosure disclosures={[notApplicable]} />);
    expect(html).toContain('KC 인증 대상이 아닌 상품입니다.');
    expect(html).not.toContain('<caption');
    expect(html).not.toContain('<td style="white-space:pre-wrap"></td>');
    expect(html.match(/<tr>/g)).toHaveLength(1);
    expect(html).not.toContain('그 외');
  });
  it('고객 안내가 있으면 함께 보여주고 여러 모델이면 적용 옵션을 구분한다', () => {
    const html = renderToStaticMarkup(<GoodsKcDisclosure disclosures={[{ ...notApplicable, publicNote: '합성 안내 문구' }, certified]} />);
    expect(html).toContain('합성 안내 문구');
    // KC 신고 옵션과 함께 나가므로 '상품 전체가 KC 대상이 아님'으로 읽히면 안 된다.
    expect(html).not.toContain('KC 인증 대상이 아닌 상품입니다.');
    expect(html).toContain('<th scope="row">KC 인증</th><td style="white-space:pre-wrap">적용 옵션은 KC 인증 대상이 아닙니다.</td>');
    expect(html).toContain('<th scope="row">적용 옵션</th><td style="white-space:pre-wrap">기본</td>');
    expect(html).toContain('<caption class="wc-pdp-notice__caption">합성 모델</caption>');
    expect(html).toContain('안전확인 신고번호');
    expect(html).toContain('<th scope="row">적용 옵션</th><td style="white-space:pre-wrap">파랑</td>');
  });
  it('해당 없음 모델이 여럿이어도 상품 단위가 아니라 옵션 단위로 알린다', () => {
    const second = { ...notApplicable, variants: [{ id: '00000000-0000-4000-8000-000000000003', name: '빨강' }] };
    const html = renderToStaticMarkup(<GoodsKcDisclosure disclosures={[notApplicable, second]} />);
    expect(html).not.toContain('KC 인증 대상이 아닌 상품입니다.');
    expect(html.match(/적용 옵션은 KC 인증 대상이 아닙니다\./g)).toHaveLength(2);
    expect(html).toContain('<th scope="row">적용 옵션</th><td style="white-space:pre-wrap">빨강</td>');
  });
  /* SHEET-014(ADR-0036): 고객 노출을 고른 기타 인증만 KC 고지 뒤 '기타 인증' 표로 잇는다. KC 문구는 그대로다. */
  it('기타 인증은 KC 고지 뒤 같은 영역에 표로 잇고, KC 고지 문구를 바꾸지 않는다', () => {
    const other = [{ kind: '방송통신기자재 적합성평가', agency: '국립전파연구원', number: 'R-R-TEST-0001' }, { kind: 'KS 인증', agency: '', number: 'KS-1' }];
    const html = renderToStaticMarkup(<GoodsKcDisclosure disclosures={[notApplicable]} otherCertifications={other} />);
    expect(html).toContain('KC 인증 대상이 아닌 상품입니다.');
    expect(html.indexOf('KC 인증 대상이 아닌 상품입니다.')).toBeLessThan(html.indexOf('<caption class="wc-pdp-notice__caption">기타 인증</caption>'));
    expect(html).toContain('<th scope="row">방송통신기자재 적합성평가</th><td style="white-space:pre-wrap">인증번호 R-R-TEST-0001 · 인증기관 국립전파연구원</td>');
    expect(html).toContain('<th scope="row">KS 인증</th><td style="white-space:pre-wrap">인증번호 KS-1</td>');
    expect(html.match(/<section/g)).toHaveLength(1);
  });
  it('KC 고지가 없어도 기타 인증만으로 제품 안전정보를 보이고, 둘 다 없으면 그리지 않는다', () => {
    const html = renderToStaticMarkup(<GoodsKcDisclosure disclosures={[]} otherCertifications={[{ kind: 'KS 인증', agency: '', number: 'KS-1' }]} />);
    expect(html).toContain('<h2 class="wc-pdp-panel__title">제품 안전정보</h2>');
    expect(html).toContain('KS-1');
    expect(html).not.toContain('KC 인증');
    expect(renderToStaticMarkup(<GoodsKcDisclosure disclosures={[]} otherCertifications={[]} />)).toBe('');
    expect(renderToStaticMarkup(<GoodsKcDisclosure disclosures={[]} />)).toBe('');
  });
  it('KC 대상 제도는 단독이어도 기존 항목을 모두 보여준다', () => {
    const html = renderToStaticMarkup(<GoodsKcDisclosure disclosures={[certified]} />);
    for (const label of ['제품군', '적용 제도', '품목 분류', '모델명', '적용 옵션', '수입업자', '안전확인 신고번호']) {
      expect(html).toContain(`<th scope="row">${label}</th>`);
    }
  });
});
