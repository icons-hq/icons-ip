import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/claim-bulk-step-actions', () => ({ loadOrderClaimBulkReshipmentsAction: vi.fn() }));

import { ClaimBulkReshipExcluded } from './ClaimBulkReshipDialog';

/* F-19: 선택 3건인데 재출고할 수 없는 1건이 아무 말 없이 빠지지 않는다 — 첫 화면에서 요청번호와 이유를 보인다. */
describe('일괄 재출고 창의 뺀 요청', () => {
  it('표에 넣지 않은 요청이 있으면 몇 건인지와 요청번호·이유를 보이고 상세에서 처리하라고 말한다', () => {
    const html = renderToStaticMarkup(<ClaimBulkReshipExcluded excluded={[
      { claimId: 'a', reference: 'C00030', reason: '재출고할 수 있는 단계가 아닙니다. 승인과 회수 확인 뒤에 재출고합니다.' },
      { claimId: 'b', reference: null, reason: '요청을 찾을 수 없습니다.' },
    ]} />);
    expect(html).toContain('이 표에서 뺀 요청 2건 · 상세에서 처리');
    expect(html).toContain('<span class="tabular-nums">C00030</span> — 재출고할 수 있는 단계가 아닙니다. 승인과 회수 확인 뒤에 재출고합니다.');
    expect(html).toContain('확인 불가</span> — 요청을 찾을 수 없습니다.');
  });

  it('뺀 요청이 없으면 아무것도 그리지 않는다', () => {
    expect(renderToStaticMarkup(<ClaimBulkReshipExcluded excluded={[]} />)).toBe('');
  });
});
