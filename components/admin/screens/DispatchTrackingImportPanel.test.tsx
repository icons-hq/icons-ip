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
  it('김포 원본 회신에 필요한 출고지 문맥과 표준 세 칸 양식을 함께 안내한다',()=>{
    const html=renderToStaticMarkup(<DispatchTrackingImportPanel carriers={[]} originId="selected-origin" />);
    expect(html).toContain('name="originId"');expect(html).toContain('value="selected-origin"');
    expect(html).toContain('김포');expect(html).toContain('21열');expect(html).toContain('주문번호(쇼핑몰)');
    expect(html).toContain('배송건번호 · 택배사코드 · 운송장번호');
    expect(html).toContain('상품주문번호 · 택배사 · 운송장번호');
    expect(html).not.toContain('암호를 해제');expect(html).toContain('시트 이름과 열 순서는 바꿔도');expect(html).toContain('이전에 내려받은 파일도');expect(html).toContain('내려받은 CSV');expect(html).toContain('엑스스퀘어 표준 양식 CSV는 1MB');
    /* 네이버 양식에서 온 열 이름('발송처리' 열·안내 행)을 안내에 다시 들이지 않는다. 실행 버튼 이름의 '발송처리'는 따로 본다. */
    expect(html).not.toMatch(/<strong[^>]*>[^<]*발송처리|안내 행|스마트스토어/);
  });

  /* S-18: 파일 비밀번호 칸은 XLSX를 골랐을 때만 연다(칸 자체는 DispatchTrackingImportPanel.client.test.tsx가 본다). 파일을 고르기 전에는 칸이 없고, 접힌 안내가 어디에 넣는지 말한다. */
  it('파일을 고르기 전에는 파일 비밀번호 칸을 그리지 않고, 접힌 안내가 XLSX를 고르면 칸이 나온다고 말한다',()=>{
    const html=renderToStaticMarkup(<DispatchTrackingImportPanel carriers={[]} />);
    expect(html).not.toContain('name="filePassword"');
    expect(html).toContain('비밀번호를 건 XLSX는 풀지 않고 그대로 올립니다.');expect(html).toContain('XLSX를 고르면 나오는');
  });

  it('남양주(서원) 송장양식 회신 방법과 덮어쓰지 않는 정정 경로를 안내한다',()=>{
    const html=renderToStaticMarkup(<DispatchTrackingImportPanel carriers={[]} />);
    expect(html).toContain('남양주(서원) 송장양식');expect(html).toContain('송장번호');
    expect(html).toContain('받는분전화번호·주소·품목명·수량');expect(html).toContain('파일 양식으로 찾고');
    expect(html).toContain('이미 발송된 배송 건의 운송장은 덮어쓰지 않습니다.');expect(html).toContain('운송장 수정');
  });

  /* QA 라운드 1 m2: 파일 선택이 안내보다 먼저 오고, 회신 양식 안내·붙여넣기는 접어 둔다. 등록 전 확인 전에는 등록할 수 없다. */
  it('파일 선택·비밀번호·등록 전 확인을 안내보다 먼저 두고, 회신 양식 안내와 붙여넣기는 접어 둔다', () => {
    const html = renderToStaticMarkup(<DispatchTrackingImportPanel carriers={[]} />);
    expect(html).toContain('type="file"');
    expect(html).toContain('운송장 등록 · 발송처리');
    /* kit Button은 type이 없으면 button이 된다 — 실행 버튼은 양식을 제출한다. 확인 전에는 누를 수 없다. */
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>운송장 등록 · 발송처리<|<button[^>]*disabled=""[^>]*type="submit"[^>]*>운송장 등록 · 발송처리</);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>등록 전 확인</);
    expect(html).toContain('[등록 전 확인]으로 읽은 내용을 본 뒤 누를 수 있습니다.');
    /* 누르면 일어나는 일(배송중 + 고객 메일)과 되돌릴 수 없는 것(보낸 메일)을 한 줄로 말한다. */
    expect(html).toContain('등록한 배송 건은 바로 배송중으로 바뀌고 고객에게 배송 안내 메일이 갑니다. 보낸 메일은 회수되지 않습니다.');
    expect(html).not.toContain('배송현황에서 결과 확인');
    // 접힌 안내·붙여넣기(open 없음)는 파일 칸 뒤에 있다.
    expect(html).toMatch(/<details (?:(?!open)[^>])*data-tracking-import-guide=""(?:(?!open)[^>])*>/);
    expect(html).toMatch(/<details (?:(?!open)[^>])*data-tracking-import-paste=""(?:(?!open)[^>])*>/);
    expect(html.indexOf('type="file"')).toBeLessThan(html.indexOf('data-tracking-import-guide'));
    // 브라우저 파일 칸은 감추고 이 화면의 선택만 보인다('선택된 파일 없음'과 '선택 파일'이 함께 보이지 않게).
    expect(html).toMatch(/<input[^>]*aria-hidden="true"[^>]*class="sr-only"[^>]*type="file"|<input[^>]*type="file"[^>]*class="sr-only"/);
    expect(html).toContain('선택한 파일 없음');expect(html).not.toContain('선택 파일:');
  });

  it('부분 실패 보고서를 유지하며 성공 건이 있으면 필터를 보존한 배송현황으로 연결한다', () => {
    mocks.state = {
      message: '1건을 발송처리했습니다.',
      report: { succeeded: ['00000001'], failed: [{ line: 3, reference: '00000002', reason: '배송 건을 찾을 수 없습니다.' }] },
    };
    const html = renderToStaticMarkup(<DispatchTrackingImportPanel carriers={[]} shippingHref="/admin/sales/shipping?tab=transit&page=1&originId=warehouse" />);
    expect(html).toContain('배송현황에서 결과 확인');
    expect(html).toContain('href="/admin/sales/shipping?tab=transit&amp;page=1&amp;originId=warehouse"');
    expect(html).toContain('등록하지 못한 줄 내려받기');expect(html).toContain('대상(상품주문·배송건·주문·받는 분)');
    expect(html).toContain('00000002');
    expect(html).toContain('배송 건을 찾을 수 없습니다.');
  });

  /* ADR-0046: 출고지시 뒤 취소된 배송 건의 회신 줄은 성공·실패와 따로, 주문 상세의 처리로 잇는다. */
  it('취소한 주문의 배송 건 회신 줄은 취소 뒤 출고 발견으로 따로 보이고 주문 상세로 잇는다', () => {
    const orderId = '11111111-1111-4111-8111-111111111111';
    mocks.state = {
      message: "새로 등록할 운송장이 없습니다. 취소한 주문의 배송 건 1건은 발송처리하지 않고 '취소 뒤 출고 발견'으로 기록했습니다.",
      report: { succeeded: [], failed: [], canceledAfterExport: [{ line: 4, reference: '2026111930000001', orderId, alreadyRecorded: false },
        { line: 5, reference: '2026111930000002', orderId, alreadyRecorded: true }] },
    };
    const html = renderToStaticMarkup(<DispatchTrackingImportPanel carriers={[]} />);
    expect(html).toContain('data-tracking-canceled-after-export=""');
    expect(html).toContain('취소한 주문의 배송 건에 운송장 회신이 왔습니다 · 2건');
    expect(html).toContain('4줄 · 2026111930000001<');
    expect(html).toContain('5줄 · 2026111930000002 · 이미 기록됨');
    expect(html).toContain('재고를 다시 뺐습니다');
    expect(html).toContain(`href="/admin/sales/orders/${orderId}#warehouse-stop"`);
    expect(html).not.toContain('등록하지 못한 줄 내려받기');
    /* 같은 회신을 다시 올려 모두 이미 기록된 줄이면 다시 뺐다고 말하지 않는다. */
    mocks.state = { report: { succeeded: [], failed: [], canceledAfterExport: [{ line: 4, reference: '2026111930000001', orderId, alreadyRecorded: true }] } };
    const again = renderToStaticMarkup(<DispatchTrackingImportPanel carriers={[]} />);
    expect(again).toContain('다시 기록하거나 재고를 다시 빼지 않았습니다');
    expect(again).not.toContain('재고를 다시 뺐습니다');
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
    { report: { succeeded: ['00000001'], failed: [], canceledAfterExport: [{ line: 3, reference: '00000003', orderId: null, alreadyRecorded: false }] } },
  ])('부분 실패·큐 경고·미확정 응답·취소 뒤 출고 발견은 자동 이동 없이 보고서를 유지한다', async result => {
    mocks.register.mockResolvedValue(result);
    renderToStaticMarkup(<DispatchTrackingImportPanel carriers={[]} />);
    expect(await mocks.submit!({}, new FormData())).toBe(result);
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
