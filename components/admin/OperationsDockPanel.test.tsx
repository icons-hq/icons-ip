import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/admin' }));
vi.mock('@/app/admin/operations-dock-actions', () => ({ setAdminOperationAlertBadgeAction: vi.fn(), updateAdminOperationAlertsAction: vi.fn() }));

import { OperationsDockPanel } from './OperationsDockPanel';

describe('OperationsDockPanel 문의 PC 알림 설정 (R2)', () => {
  it('문의 알림 대상 계정에만 알림 패널 맨 위에 켜기 영역을 보인다', () => {
    const withToggle = renderToStaticMarkup(<OperationsDockPanel section="alerts" pathname="/admin" onClose={vi.fn()} onAlertRead={vi.fn()} inquiryNotificationAccountId="operator-1" />);
    expect(withToggle).toContain('aria-label="새 1:1 문의 PC 알림"');
    expect(withToggle).toContain('문의 알림 받기');
    expect(withToggle.indexOf('새 1:1 문의 PC 알림')).toBeLessThan(withToggle.indexOf('aria-label="알림 유형"'));

    const without = renderToStaticMarkup(<OperationsDockPanel section="alerts" pathname="/admin" onClose={vi.fn()} onAlertRead={vi.fn()} />);
    expect(without).not.toContain('새 1:1 문의 PC 알림');
    const tasks = renderToStaticMarkup(<OperationsDockPanel section="tasks" pathname="/admin" onClose={vi.fn()} onAlertRead={vi.fn()} inquiryNotificationAccountId="operator-1" />);
    expect(tasks).not.toContain('새 1:1 문의 PC 알림');
  });
});
