import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/operator-invitation-actions', () => ({
  cancelOperatorInvitationAction: vi.fn(), createOperatorInvitationsAction: vi.fn(),
  reissueOperatorInvitationAction: vi.fn(), retryOperatorInvitationEmailAction: vi.fn(),
}));
import { InvitationFields } from './OperatorInvitationConsole';

describe('매니저 초대 권한 선택', () => {
  /* QA1 S-T05-01: 초대 창에서 물류출고관리를 골라도 할 수 있는 일이 판매자 가이드에만 있었다. 선택칸 아래 설명으로 잇는다. */
  it('고른 권한으로 할 수 있는 일을 선택칸 설명으로 보이고 화면 낭독기에도 잇는다', () => {
    const html = renderToStaticMarkup(<InvitationFields disabled={false} draft={{ name: '물류담당', email: 'logistics@example.test', managerRole: 'logistics', duty: 'logistics' }}
      index={1} onChange={() => {}} />);
    const hintId = html.match(/data-operator-role-summary="" id="([^"]+)"/)?.[1];
    expect(hintId).toBeTruthy();
    expect(html).toContain(`aria-describedby="${hintId}"`);
    expect(html).toContain('물류출고관리</strong> — 상품 공지사항 관리와 출고지시 내려받기·운송장 회신 등록·발송·배송완료');
    expect(html).toContain('수령인 정보만 봅니다');
    const deputy = renderToStaticMarkup(<InvitationFields disabled={false} draft={{ name: '부매니저', email: 'deputy@example.test', managerRole: 'deputy', duty: 'cs' }}
      index={2} onChange={() => {}} />);
    expect(deputy).toContain('계정 부매니저</strong> — 상품·문의/리뷰·스토어·프로모션을 관리하고');
    expect(deputy).not.toContain('출고지시 내려받기');
  });
});
