import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ShippingRegionsScreen } from './ShippingRegionsScreen';
vi.mock('@/app/admin/shipping-region-actions', () => ({ saveShippingRegionPolicyAction: vi.fn(), setShippingRegionPolicyStatusAction: vi.fn() }));
const origin = { id: '00000000-0000-4000-8000-000000000001', code: 'fixture', name: '합성 출고지', defaultCarrier: 'hanjin',
  baseFee: 3000, freeThreshold: null, returnAddress: '', cutoff: null, exportTemplate: 'standard' as const, active: true, updatedAt: '2026-09-10T00:00:00Z' };
describe('지역 추가 배송비 운영 화면', () => {
  it('실제 지역·금액 없이 공란 초안을 제공하고 미등록 상태를 구별한다', () => {
    const html = renderToStaticMarkup(<ShippingRegionsScreen policies={[]} adoptions={[]} origins={[origin]} carriers={[]} canEdit />);
    for (const label of ['지역표 미등록', '기존 배송비로 주문 확정', '물류사 원본 회신', '무료 기준 금액', '초안 저장', '지역표·고객 안내 미리보기']) expect(html).toContain(label);
    expect(html).not.toContain('>저장된 정책 활성화</button>');
    expect(html).not.toContain('TEST-ONLY');
  });
  /* 늘 떠 있는 경고는 지금 문제인지 알 수 없어 안 보게 된다 — 도입한 출고지에 적용 중인 정책이 없을 때만 경고하고, 평소에는 같은 규칙을 조용한 글자로 둔다. */
  it('적용 중인 정책이 없는 도입 출고지가 있을 때만 신규 주문 차단을 경고한다', () => {
    const draft = { id: 'p1', originId: origin.id, carrierCode: 'hanjin', name: '합성 초안', version: 2, revision: 1, status: 'draft', rules: [] } as never;
    const now = new Date('2026-11-09T00:00:00Z');
    const hanjin = [{ code: 'hanjin', label: '한진', active: true }] as never;
    const active = { id: 'p2', originId: origin.id, carrierCode: 'hanjin', name: '합성 활성', version: 1, revision: 1, status: 'active', startsAt: '2026-09-10T00:00:00Z', endsAt: null, rules: [] } as never;
    const adoption = { originId: origin.id, managedFrom: '2026-09-10T00:00:00Z' } as never;
    const uncovered = renderToStaticMarkup(<ShippingRegionsScreen policies={[draft]} adoptions={[adoption]} origins={[origin]} carriers={[]} canEdit />);
    expect(uncovered).toContain('data-admin-notice="warning"');
    expect(uncovered).toContain('합성 출고지에 적용 중인 정책이 없습니다');
    const covered = renderToStaticMarkup(<ShippingRegionsScreen policies={[active]} adoptions={[adoption]} origins={[origin]} carriers={hanjin} canEdit now={now} />);
    expect(covered).not.toContain('data-admin-notice="warning"');
    expect(covered).toContain('신규 주문을 차단합니다');
    expect(covered).toContain('지역 정책 적용');
    /* 활성이어도 기간이 끝났거나 다른 택배사 정책이면 견적은 막힌다 — '적용'으로 말하지 않는다. */
    for (const policy of [{ ...(active as object), endsAt: '2026-10-01T00:00:00Z' }, { ...(active as object), startsAt: '2026-12-01T00:00:00Z' }, { ...(active as object), carrierCode: 'cj' }]) {
      const blocked = renderToStaticMarkup(<ShippingRegionsScreen policies={[policy as never]} adoptions={[adoption]} origins={[origin]} carriers={hanjin} canEdit now={now} />);
      expect(blocked).toContain('data-admin-notice="warning"');
      expect(blocked).toContain('적용 중인 정책 없음');
      expect(blocked).not.toContain('지역 정책 적용');
    }
  });
  /* QA2: 시작 전 정책에 '활성' 배지와 '신규 주문이 차단될 수 있습니다' 경고가 붙었다. 시작 전에는 '예정'이고, 도입 시각 전에는 기존 배송비로 주문이 확정된다. */
  it('적용 시작 전인 활성 정책은 예정으로 말하고 차단 경고를 붙이지 않는다', () => {
    const now = new Date('2026-11-09T00:00:00Z');
    const scheduled = { id: 'p3', originId: origin.id, carrierCode: 'hanjin', name: '합성 예정', version: 1, revision: 1, status: 'active', startsAt: '2026-12-01T00:00:00Z', endsAt: null, rules: [] } as never;
    const adoption = { originId: origin.id, managedFrom: '2026-12-01T00:00:00Z' } as never;
    const html = renderToStaticMarkup(<ShippingRegionsScreen policies={[scheduled]} adoptions={[adoption]} origins={[origin]} carriers={[{ code: 'hanjin', label: '한진', active: true }] as never} canEdit now={now} />);
    expect(html).toContain('>예정<');
    expect(html).not.toContain('>활성<');
    expect(html).toContain('지역 정책 적용 예정');
    expect(html).not.toContain('data-admin-notice="warning"');
    expect(html).not.toContain('신규 주문이 차단될 수 있습니다');
  });
  /* 정책이 있으면 첫 화면은 현황·버전 목록이다 — 빈 입력칸과 바닥 저장 막대가 목록을 밀어내지 않는다. 초안 확정은 실제 버튼이다. */
  it('정책이 있으면 입력칸은 닫혀 있고 초안 줄의 확정하기가 주 행동이다', () => {
    const draft = { id: 'p1', originId: origin.id, carrierCode: 'hanjin', name: '합성 초안', version: 2, revision: 1, status: 'draft', rules: [] } as never;
    const html = renderToStaticMarkup(<ShippingRegionsScreen policies={[draft]} adoptions={[]} origins={[origin]} carriers={[]} canEdit />);
    expect(html).toMatch(/<button[^>]*bg-primary[^>]*>확정하기<\/button>/);
    expect(html).not.toContain('data-region-editor');
    expect(html).not.toContain('초안 저장');
  });
  it('staff 조회 화면에는 생성·저장 입력을 제공하지 않는다', () => {
    const html = renderToStaticMarkup(<ShippingRegionsScreen policies={[]} adoptions={[]} origins={[origin]} carriers={[]} canEdit={false} />);
    expect(html).toContain('지역표 미등록');
    expect(html).not.toContain('초안 저장'); expect(html).not.toContain('<textarea');
  });
});
