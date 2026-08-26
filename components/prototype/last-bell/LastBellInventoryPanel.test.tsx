import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LastBellInventoryPanel } from './LastBellInventoryPanel';

describe('LastBellInventoryPanel purchase availability', () => {
  it('does not describe an expired server entitlement as purchase-ready', () => {
    const html = renderToStaticMarkup(
      <LastBellInventoryPanel
        open
        authority="verified-candidate"
        isAuthenticated
        collected={[]}
        pending={[]}
        committed={['idcard']}
        unavailable={['idcard']}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain('판매 기간 종료');
    expect(html).not.toContain('구매권 검증 완료');
  });
});
