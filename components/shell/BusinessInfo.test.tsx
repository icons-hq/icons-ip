import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BusinessInfo as BusinessInfoValues } from '@/lib/legal/business-info';
import { BusinessInfo } from './BusinessInfo';

const blank: BusinessInfoValues = {
  companyName: '',
  representative: '',
  registrationNumber: '',
  mailOrderNumber: '',
  address: '',
  phone: '',
  email: '',
  hostingProvider: '',
};

describe('BusinessInfo', () => {
  it('채워진 항목만 라벨과 값의 쌍으로 표기한다', () => {
    const html = renderToStaticMarkup(
      <BusinessInfo info={{ ...blank, companyName: '주식회사 아이콘즈', hostingProvider: 'Vercel, Inc.' }} />,
    );

    expect(html).toContain('상호');
    expect(html).toContain('주식회사 아이콘즈');
    expect(html).toContain('호스팅 제공자');
    expect(html).toContain('Vercel, Inc.');
  });

  it('값이 없는 항목의 라벨은 렌더하지 않는다', () => {
    const html = renderToStaticMarkup(<BusinessInfo info={{ ...blank, companyName: '주식회사 아이콘즈' }} />);

    expect(html).not.toContain('사업자등록번호');
    expect(html).not.toContain('통신판매업 신고번호');
  });

  it('값이 하나도 없으면 블록 자체를 렌더하지 않는다', () => {
    expect(renderToStaticMarkup(<BusinessInfo info={blank} />)).toBe('');
  });

  it('라벨과 값을 dt·dd로 묶어 스크린리더가 쌍으로 읽게 한다', () => {
    const html = renderToStaticMarkup(<BusinessInfo info={{ ...blank, representative: '박상우' }} />);

    expect(html).toContain('<dt');
    expect(html).toContain('<dd');
    expect(html).toContain('aria-label="사업자 정보"');
  });
});
