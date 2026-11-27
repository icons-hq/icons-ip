import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminDeliveryPolicy } from '@/lib/shipment-delivery';
vi.mock('@/app/admin/shipment-delivery-actions', () => ({ readDeliveryPoliciesAction: vi.fn(), saveDeliveryPolicyAction: vi.fn() }));
vi.mock('@/app/admin/goods-transaction-runtime-actions', () => ({ readGoodsTransactionRuntimeAction: vi.fn() }));
import { DeliveryPoliciesPanel, DeliveryPolicyForm, SavedDeliveryPolicy } from './DeliveryPoliciesPanel';

const origin = '00000000-0000-4000-8000-000000042201';
const policy: AdminDeliveryPolicy = {
  id: '00000000-0000-4000-8000-000000042301', originId: origin, method: 'quick', revision: 3, state: 'active',
  contactName: '물류팀 김담당', contactPhone: '02-0000-0000', handoffLocation: '김포 1층 데스크', handoffInstructions: '주문번호를 말해 주세요.',
  appointmentInstructions: '평일 10~17시', allowDelegate: false, completionInstructions: '수령 확인값을 보여 주세요.', cancellationInstructions: '받기 전까지 취소할 수 있습니다.',
  approvalReference: '협조전-20261101', createdAt: '2026-11-01T00:00:00Z', activatedAt: '2026-11-02T00:00:00Z', stoppedAt: null,
};
const noop = () => {};
/** 화면에 보이는 글자만(태그·속성 제외). */
const shown = (html: string) => html.replace(/<[^>]+>/g, ' ');

describe('택배 외 수령 방식 — 운영 조건 폼', () => {
  it('고객에게 보이는 일곱 칸과 대리수령만 있고 승인 근거 칸은 없다', () => {
    const html = renderToStaticMarkup(<DeliveryPolicyForm originId={origin} activeMethods={[]} runtime onSaved={noop} />);
    for (const label of ['수령 방식 (필수)', '담당자 이름', '담당자 연락처', '인계 장소', '인계 방법 안내', '예약·방문 시간 안내', '받았는지 확인하는 방법', '취소 안내', '대리수령']) expect(shown(html)).toContain(label);
    expect(html).not.toContain('approvalReference');
    for (const gone of ['근거', '초안', '활성', '버전', '정책']) expect(shown(html)).not.toContain(gone);
    expect(shown(html)).toContain('아래 내용은 이 방식을 고른 고객의 주문서와 주문 상세에 그대로 보입니다.');
    expect(html.match(/placeholder="예: /g)).toHaveLength(7);
  });
  it('저장 버튼 둘은 제출 버튼이고 이름이 하는 일을 말한다', () => {
    const html = renderToStaticMarkup(<DeliveryPolicyForm originId={origin} activeMethods={[]} runtime onSaved={noop} />);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*value="draft"[^>]*>준비 중으로 저장<\/button>/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*value="active"[^>]*>저장하고 사용<\/button>/);
  });
  it('준비 중인 조건은 저장된 값을 채우고, 저장돼 있던 승인 근거는 보이지도 보내지도 않는다', () => {
    const html = renderToStaticMarkup(<DeliveryPolicyForm originId={origin} policy={{ ...policy, state: 'draft', activatedAt: null }} activeMethods={[]} runtime onSaved={noop} />);
    expect(html).toContain('value="물류팀 김담당"'); expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="method"[^>]*value="quick"/);
    expect(html).not.toContain('협조전-20261101'); expect(shown(html)).not.toContain('수령 방식 (필수)');
  });
  it('같은 방식에 사용 중인 조건이 있으면 [저장하고 사용]을 막고 순서를 말한다', () => {
    const html = renderToStaticMarkup(<DeliveryPolicyForm originId={origin} policy={{ ...policy, id: '00000000-0000-4000-8000-000000042302', state: 'draft', activatedAt: null }} activeMethods={['quick']} runtime onSaved={noop} />);
    expect(shown(html)).toContain('‘퀵’ 방식은 이미 사용 중인 운영 조건이 있습니다.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*value="active"|<button[^>]*value="active"[^>]*disabled=""/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*value="draft"|<button[^>]*value="draft"[^>]*disabled=""/);
  });
  it('사용 안 함인 출고지에서는 켤 수 없다고 미리 말한다', () => {
    const html = renderToStaticMarkup(<DeliveryPolicyForm originId={origin} activeMethods={[]} originActive={false} runtime onSaved={noop} />);
    expect(shown(html)).toContain('사용 안 함인 출고지에서는 수령 방식을 켤 수 없습니다.');
  });
});

describe('택배 외 수령 방식 — 저장된 운영 조건', () => {
  it('사용 중인 조건은 고객에게 보이는 값과 [사용 안 함으로 바꾸기]만 보이고 승인 근거는 보이지 않는다', () => {
    const html = renderToStaticMarkup(<SavedDeliveryPolicy policy={policy} canEdit runtime onSaved={noop} />);
    expect(shown(html)).toContain('김포 1층 데스크'); expect(shown(html)).toContain('허용하지 않음'); expect(html).not.toContain('협조전-20261101');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>사용 안 함으로 바꾸기<\/button>/);
    expect(shown(html)).toContain('켠 운영 조건은 고칠 수 없습니다.');
    for (const gone of ['새 선택 중지', '근거', '버전']) expect(shown(html)).not.toContain(gone);
  });
  it('끈 조건과 편집 권한이 없는 화면에는 버튼이 없다', () => {
    expect(renderToStaticMarkup(<SavedDeliveryPolicy policy={{ ...policy, state: 'stopped', stoppedAt: '2026-11-03T00:00:00Z' }} canEdit runtime onSaved={noop} />)).not.toContain('<button');
    expect(renderToStaticMarkup(<SavedDeliveryPolicy policy={policy} canEdit={false} runtime onSaved={noop} />)).not.toContain('<button');
  });
});

it('패널 제목은 택배 외 수령 방식이고 목록을 읽는 동안 다시 불러오는 버튼이 있다', () => {
  const html = renderToStaticMarkup(<DeliveryPoliciesPanel originId={origin} canEdit />);
  expect(shown(html)).toContain('택배 외 수령 방식'); expect(shown(html)).toContain('불러오는 중입니다.'); expect(shown(html)).toContain('다시 불러오기');
  expect(shown(html)).not.toContain('배송·직접전달');
});
