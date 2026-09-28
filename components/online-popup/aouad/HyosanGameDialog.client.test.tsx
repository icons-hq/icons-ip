import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HyosanGameDialog } from './HyosanGameDialog.client';

// Readiness, retry, keyboard and unmount behavior are exercised with the real
// React DOM by scripts/aouad-hyosan-browser-smoke.mjs, without replacing hooks.
describe('Hyosan game dialog rendering', () => {
  it('renders the named modal, embedded game and initial loading announcement', () => {
    const html = renderToStaticMarkup(<HyosanGameDialog onClose={() => {}} />);
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-label="효산의 기억 게임"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('src="/ip-popups/aouad/hyosan/index.html"');
    expect(html).toContain('title="효산의 기억"');
    expect(html).toContain('role="status"');
    expect(html).toContain('효산의 기억을 준비하고 있습니다');
    expect(html).toContain('팝업으로 돌아가기');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('/api/dev/');
  });

  it('accepts an explicit launcher as the focus return target without rendering it as DOM data', () => {
    const html = renderToStaticMarkup(<HyosanGameDialog onClose={() => {}} returnFocusRef={{ current: null }} />);
    expect(html).toContain('팝업으로 돌아가기');
    expect(html).not.toContain('returnFocusRef');
  });
});
