import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Events } from './Events';

describe('Events', () => {
  it('explains provider-confirmed ticket issuance without naming a legacy provider', () => {
    const html = renderToStaticMarkup(<Events catalog={{ ips: [], events: [] }} />);

    expect(html).toContain('결제사 승인 확인 후 티켓이 발급돼요');
    expect(html).not.toContain('토스페이먼츠로 결제해요');
  });
});
