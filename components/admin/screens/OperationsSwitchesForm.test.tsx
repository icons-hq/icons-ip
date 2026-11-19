import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('@/app/admin/operations-switches-actions', () => ({
  saveOrderDelayNoticeSwitchAction: vi.fn(), savePartialCancelSwitchAction: vi.fn(), saveReturnFeeDeductionSwitchAction: vi.fn(),
}));
import { OperationsSwitchesForm } from './OperationsSwitchesForm';
import type { OperationsSwitchesState } from '@/lib/admin/operations-switches';

const at = '2026-11-19T01:00:00Z';
const off: OperationsSwitchesState = {
  delayNotice: { revision: 1, enabled: false, smsEnabled: false, evidence: null, changedAt: at, updatedBy: null },
  returnFee: { revision: 1, enabled: false, oneWayAmount: null, evidence: null, enabledAt: null, updatedAt: at, updatedBy: null, inflightCount: 7 },
  partialCancel: { revision: 1, enabled: false, evidence: null, enabledAt: null, updatedAt: at, updatedBy: null },
  partialReturn: { revision: 1, enabled: false, evidence: null, enabledAt: null, updatedAt: at, updatedBy: null },
};

it('꺼진 화면은 진행 중 단순 변심 반품 수와 켜기 전 확인 항목(부분 취소 게이트·HMAC 키)을 보인다', () => {
  const html = renderToStaticMarkup(<OperationsSwitchesForm emailConfigured initial={off} />);
  expect(html).toMatch(/data-return-fee-inflight=""[^>]*>[^]*7건/);
  expect(html).toContain('켜도 이 건들은 차감하지 않고 전액 환불');
  expect(html).toContain('EMAIL_DISPATCH_HMAC_SECRET');
  expect(html).toContain('나이스페이 부분 취소 계약');
  expect(html).toContain('서원(물류)에서 품절을 통보받는 경로');
  expect(html).toContain('배분 점검 쿼리');
  expect(html).not.toContain('무통장 송금 대기로 처리');
});

it('이메일 설정이 없으면 지연 안내 켜기를 막는 안내를 보인다', () => {
  expect(renderToStaticMarkup(<OperationsSwitchesForm emailConfigured={false} initial={off} />)).toContain('지금은 켤 수 없습니다');
});

it('부분 반품(ADR-0047) 스위치 칸이 약관 개정·결제사 거절 처리 확인 항목과 함께 꺼진 채로 보인다', () => {
  const html = renderToStaticMarkup(<OperationsSwitchesForm emailConfigured initial={off} />);
  expect(html).toContain('부분 반품');
  expect(html).toContain('이용약관 제16조와 배송·반품 정책의 부분 반품 개정');
  expect(html).toContain('전액 환불로 돌리지 않고 확인 필요로 남는다');
});
