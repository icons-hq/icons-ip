import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminTrackingImportState } from '@/app/admin/order-actions';
import { DispatchTrackingImportPanel } from './DispatchTrackingImportPanel';

const mocks = vi.hoisted(() => ({ state: {} as AdminTrackingImportState, submit: null as null | ((state: AdminTrackingImportState, data: FormData) => Promise<AdminTrackingImportState>), register: vi.fn(), push: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useActionState: (submit: typeof mocks.submit) => { mocks.submit = submit; return [mocks.state, vi.fn(), false]; },
}));
vi.mock('@/app/admin/order-actions', () => ({ bulkRegisterAdminOrderTrackingAction: mocks.register }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

describe('운송장 업로드 후속 동선', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.state = {}; });

  it('패널을 여는 추가 클릭 없이 파일 선택과 등록을 제공한다', () => {
    const html = renderToStaticMarkup(<DispatchTrackingImportPanel carriers={[]} />);
    expect(html).not.toContain('<details');
    expect(html).toContain('type="file"');
    expect(html).toContain('일괄 등록');
    expect(html).not.toContain('배송현황에서 결과 확인');
  });

  it('부분 실패 보고서를 유지하며 성공 건이 있으면 필터를 보존한 배송현황으로 연결한다', () => {
    mocks.state = {
      message: '1건을 발송처리했습니다.',
      report: { succeeded: ['00000001'], failed: [{ line: 3, reference: '00000002', reason: '배송 건을 찾을 수 없습니다.' }] },
    };
    const html = renderToStaticMarkup(<DispatchTrackingImportPanel carriers={[]} shippingHref="/admin/sales/shipping?tab=transit&page=1&originId=warehouse" />);
    expect(html).toContain('배송현황에서 결과 확인');
    expect(html).toContain('href="/admin/sales/shipping?tab=transit&amp;page=1&amp;originId=warehouse"');
    expect(html).toContain('실패 행 내려받기');
    expect(html).toContain('00000002');
    expect(html).toContain('배송 건을 찾을 수 없습니다.');
  });

  it('전부 등록되고 메일 큐 경고가 없으면 건수만 담아 배송현황으로 바로 이동한다', async () => {
    const result = { report: { succeeded: Array.from({ length: 100 }, (_, i) => String(i)), failed: [] } };
    mocks.register.mockResolvedValue(result);
    renderToStaticMarkup(<DispatchTrackingImportPanel carriers={[]} shippingHref="/admin/sales/shipping?tab=transit&page=1&query=warehouse" />);
    expect(await mocks.submit!({}, new FormData())).toBe(result);
    expect(mocks.push).toHaveBeenCalledWith('/admin/sales/shipping?tab=transit&page=1&query=warehouse&registered=100');
  });

  it.each<AdminTrackingImportState>([
    { report: { succeeded: ['00000001'], failed: [{ line: 2, reference: '00000002', reason: '처리 실패' }] } },
    { report: { succeeded: ['00000001'], failed: [] }, queueWarning: true },
    { errors: { form: '등록 결과를 확인하지 못했습니다.' } },
  ])('부분 실패·큐 경고·미확정 응답은 자동 이동 없이 보고서를 유지한다', async result => {
    mocks.register.mockResolvedValue(result);
    renderToStaticMarkup(<DispatchTrackingImportPanel carriers={[]} />);
    expect(await mocks.submit!({}, new FormData())).toBe(result);
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
