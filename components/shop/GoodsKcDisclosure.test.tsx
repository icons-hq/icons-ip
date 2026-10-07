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
    expect(html).toContain('<th scope="row">적용 옵션</th><td style="white-space:pre-wrap">기본</td>');
    expect(html).toContain('<caption class="wc-pdp-notice__caption">합성 모델</caption>');
    expect(html).toContain('안전확인 신고번호');
    expect(html).toContain('<th scope="row">적용 옵션</th><td style="white-space:pre-wrap">파랑</td>');
  });
  it('KC 대상 제도는 단독이어도 기존 항목을 모두 보여준다', () => {
    const html = renderToStaticMarkup(<GoodsKcDisclosure disclosures={[certified]} />);
    for (const label of ['제품군', '적용 제도', '품목 분류', '모델명', '적용 옵션', '수입업자', '안전확인 신고번호']) {
      expect(html).toContain(`<th scope="row">${label}</th>`);
    }
  });
});
