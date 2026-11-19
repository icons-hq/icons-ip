import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const guard = vi.hoisted(() => vi.fn());
vi.mock('@/components/admin/useAdminLeaveGuard', () => ({ useAdminLeaveGuard: guard }));
vi.mock('@/app/admin/ops-alert-digest-actions', () => ({ saveOpsAlertDigestAction: vi.fn() }));
import { OpsAlertDigestPanel } from './OpsAlertDigestPanel';
import { parseOpsAlertDigestSettings } from '@/lib/admin/ops-alert-digest';

const settings = parseOpsAlertDigestSettings({ revision: 1, enabled: false, recipients: [], categories: ['inquiries', 'system'], delayHours: 4,
  enabledAt: null, updatedAt: '2031-05-01T00:00:00Z', updatedByName: null, runs: [] })!;

describe('운영 알림 메일 설정 패널', () => {
  it('이탈 보호를 등록한다(처음에는 깨끗한 상태)', () => {
    renderToStaticMarkup(<OpsAlertDigestPanel initial={settings} />);
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({ dirty: false, blocked: false, message: expect.stringContaining('이동할까요') }));
  });
});
