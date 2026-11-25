import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));

import { GoodsShippingNoticeField, type GoodsShippingNoticeOption } from './GoodsShippingNoticeField';

const option = (code: string, version: number, name: string) => ({ id: `${code}-${version}`, code, version, name, shippingNotice: '배송 안내', returnExchangeNotice: '교환 안내', csName: 'CS', csPhone: '0212345678', csEmail: 'cs@example.test' }) as GoodsShippingNoticeOption;
const options = [option('BASIC', 2, '기본 안내'), option('FIGURE', 1, '피규어 안내')];

describe('배송·교환·반품 안내 템플릿 선택', () => {
  /* 2026-11-25 화면 규칙 8: 코드와 버전은 운영자가 할 일이 없는 내부 값이다. 값(코드@버전)은 그대로 제출하고 이름만 보인다. */
  it('선택지에는 이름만 보이고 코드·버전은 값으로만 보낸다', () => {
    const html = renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="FIGURE@1" />);
    expect(html).toContain('<option value="BASIC@2">기본 안내</option>');
    expect(html).toContain('<option value="FIGURE@1" selected="">피규어 안내</option>');
    expect(html).toContain('<option value="">기본 안내 사용</option>');
    const labels = [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(([, label]) => label);
    expect(labels.join('|')).not.toMatch(/BASIC|FIGURE|\bv\d|@|버전/);
  });

  it('목록에 없는 안내가 적용 중이어도 저장하면 그대로 이어지게 이름과 함께 선택지로 남긴다', () => {
    const html = renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="FIGURE@0" currentName="피규어 안내" />);
    expect(html).toContain('<option value="FIGURE@0" selected="">피규어 안내 (지금 적용 중)</option>');
    expect(renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="OLD@3" />)).toContain('<option value="OLD@3" selected="">지금 적용 중인 안내</option>');
    expect(renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="" />)).not.toContain('지금 적용 중');
  });

  it('안내 한 단락과 템플릿 관리 링크만 둔다', () => {
    const html = renderToStaticMarkup(<GoodsShippingNoticeField options={options} value="" error="안내를 확인해주세요." />);
    expect(html.match(/<p /g)).toHaveLength(2);
    expect(html).toContain('href="/admin/settings/shipping-notices"');
    expect(html).toContain('배송비와 회수 주소는 출고지 설정을 따릅니다.');
    expect(html).toContain('안내를 확인해주세요.');
  });
});
