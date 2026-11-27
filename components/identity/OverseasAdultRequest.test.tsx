import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { OverseasRequest } from '@/lib/identity/overseas-adult';
import { OverseasAdultRequest } from './OverseasAdultRequest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/my/adult-verification/overseas/actions', () => ({
  readOwnOverseasRequest: vi.fn(), cancelOverseasRequest: vi.fn(),
}));

function render(state: OverseasRequest['state'], language: 'ko' | 'en') {
  const time = '2026-11-27T00:00:00.000Z';
  return renderToStaticMarkup(<OverseasAdultRequest
    initialStatus={{ intakeStatus: 'open', checkedAt: time, request: {
      id: 'test-request', number: 7, state, outcome: null, expiresAt: time, validUntil: null,
    } }}
    initialLanguage={language} next="/my/adult-verification"
  />);
}

describe('해외 신분증 심사 상태', () => {
  it.each([
    ['ko', '심사 대기 중이에요', '담당자가 심사 중이에요'],
    ['en', 'Waiting for review', 'Your ID is under review'],
  ] as const)('%s 화면에서 담당자의 열람 여부를 구분한다', (language, waiting, reviewing) => {
    expect(render('pending', language)).toContain(waiting);
    expect(render('reviewing', language)).toContain(reviewing);
  });

  it('접수증을 처음 열면 수동 조회 완료 시각을 표시하지 않는다', () => {
    const receipt = render('pending', 'ko');
    expect(receipt).toContain('상태 확인');
    expect(receipt).not.toContain('<time');
    expect(receipt).not.toContain('확인 완료');
  });
});
