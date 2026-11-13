import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/admin' }));
vi.mock('@/app/admin/operations-dock-actions', () => ({ setAdminOperationAlertBadgeAction: vi.fn(), updateAdminOperationAlertsAction: vi.fn() }));

import { OperationsDockPanel } from './OperationsDockPanel';

describe('OperationsDockPanel 문의 PC 알림 설정 (R2 · 1027T-002 상품 문의 포함)', () => {
  it('문의 알림 대상 계정에만 알림 패널 맨 위에 켜기 영역을 보인다', () => {
    const withToggle = renderToStaticMarkup(<OperationsDockPanel section="alerts" pathname="/admin" onClose={vi.fn()} onAlertRead={vi.fn()} inquiryNotificationAccountId="operator-1" />);
    expect(withToggle).toContain('aria-label="새 1:1 문의·상품 문의 PC 알림"');
    expect(withToggle).toContain('문의 알림 받기');
    expect(withToggle.indexOf('새 1:1 문의·상품 문의 PC 알림')).toBeLessThan(withToggle.indexOf('aria-label="알림 유형"'));

    const without = renderToStaticMarkup(<OperationsDockPanel section="alerts" pathname="/admin" onClose={vi.fn()} onAlertRead={vi.fn()} />);
    expect(without).not.toContain('PC 알림');
    const tasks = renderToStaticMarkup(<OperationsDockPanel section="tasks" pathname="/admin" onClose={vi.fn()} onAlertRead={vi.fn()} inquiryNotificationAccountId="operator-1" />);
    expect(tasks).not.toContain('PC 알림');
  });
});

describe('OperationsDockPanel 알림 항목 이동', () => {
  const source = readFileSync(join(process.cwd(), 'components/admin/OperationsDockPanel.tsx'), 'utf8');

  /* 읽음 처리에 실패하면 이동하지 않는다. 클릭만으로 대기를 걸면 본문이 30초 잠겼다. */
  it('클릭으로는 대기를 시작하지 않고 처리 성공 뒤 이동 때 시작한다', () => {
    expect(source).toMatch(/<Link className=\{linkClass\} data-admin-nav-skip="" href=\{item\.href\} onClick=/);
    expect(source).toContain('if (href) { startAdminNavigation(href); router.push(href); onClose(); }');
  });
});
