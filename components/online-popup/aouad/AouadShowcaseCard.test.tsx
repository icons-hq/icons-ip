import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isStaff: false, AOUAD_POPUP_ENABLED: true, AOUAD_POPUP_PUBLIC: false }));
vi.mock('@/components/shell/StaffPreviewAvailability', () => ({ useStaffPreviewVisible: () => mocks.isStaff }));
vi.mock('@/lib/aouad-popup', () => mocks);
import { AouadShowcaseCard } from './AouadShowcaseCard';

beforeEach(() => { mocks.isStaff = false; mocks.AOUAD_POPUP_ENABLED = true; mocks.AOUAD_POPUP_PUBLIC = false; });

describe('온라인 팝업 AOUAD 진입점', () => {
  it('기본 비로그인·일반 회원에게 시연 카드를 노출하지 않는다', () => {
    expect(renderToStaticMarkup(<AouadShowcaseCard />)).toBe('');
  });
  it('스태프에게 자체 route와 실거래 비연결 안내를 보여준다', () => {
    mocks.isStaff = true;
    const html = renderToStaticMarkup(<AouadShowcaseCard />);
    expect(html).toContain('href="/ip/aouad"');
    expect(html).toContain('프레젠테이션');
    expect(html).toContain('실제 주문·결제·예약·리워드는 진행되지 않습니다.');
  });
  it('공개 전환 또는 서버가 허용한 로컬 QA에는 진입점을 보여준다', () => {
    expect(renderToStaticMarkup(<AouadShowcaseCard localPreview />)).toContain('/ip/aouad');
    mocks.AOUAD_POPUP_PUBLIC = true;
    expect(renderToStaticMarkup(<AouadShowcaseCard />)).toContain('/ip/aouad');
  });
  it('킬스위치는 스태프·공개·로컬 노출보다 우선한다', () => {
    mocks.AOUAD_POPUP_ENABLED = false; mocks.AOUAD_POPUP_PUBLIC = true; mocks.isStaff = true;
    expect(renderToStaticMarkup(<AouadShowcaseCard localPreview />)).toBe('');
  });
});
