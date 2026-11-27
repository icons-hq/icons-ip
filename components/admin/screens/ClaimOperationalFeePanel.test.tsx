import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ClaimOperationalFeePanel } from './ClaimOperationalFeePanel';

vi.mock('@/app/admin/claim-actions', () => ({ recordOrderClaimOperationalFeeAction: vi.fn() }));

describe('클레임 운영 확인액 패널', () => {
  it('0원과 미확인을 구분하고 자동 청구·환불을 약속하지 않는다', () => {
    const html = renderToStaticMarkup(<ClaimOperationalFeePanel
      claimId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      claimType="return"
      fee={{ kind: 'return_shipping', amount: 0, note: '무료 확인', evidence: '택배 회신', confirmedBy: 'staff', confirmedAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z' }}
    />);
    expect(html).toContain('value="0"');
    /* 청구·환불·정산·엑셀 어디에도 쓰이지 않는 기록용 값이다 — 한 줄로 사실만 말한다. */
    expect(html).toContain('기록용 메모입니다. 환불·청구 금액은 바뀌지 않습니다.');
    expect(html).not.toContain('추가 청구하거나 환불액에서 차감하지 않으며');
    /* 0원은 '비용이 없다고 확인함'이고, 비워 두면 확인 안 함이다. 넷 가운데 금액만 적을 수는 없다. */
    expect(html).toContain('금액을 적으면 비용 유형·비용 메모·확인 근거도 모두 적어야 저장됩니다.');
    expect(html).toContain('비용이 없다고 확인했으면 0을 적고, 모두 비우고 저장하면 기록이 지워집니다.');
    expect(html).toContain('운영 확인액 갱신');
    /* 칸 이름은 저장 검사의 오류 문구('비용 메모는 1~500자…')와 같은 말이다. */
    expect(html).toMatch(/<label[^>]*>비용 메모<\/label>/);
    expect(html).toMatch(/<label[^>]*>확인 근거<\/label>/);
    expect(html).not.toContain('금액 의미·메모');
    /* kit 버튼은 type을 주지 않으면 type="button"이다 — 기록 버튼은 양식을 제출해야 한다. */
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>운영 확인액 갱신<\/button>/);
    expect(html).toMatch(/<select[^>]*name="feeKind"/);
  });
});
