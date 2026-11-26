import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ShippingRegionsScreen } from './ShippingRegionsScreen';
vi.mock('@/app/admin/shipping-region-actions', () => ({ saveShippingRegionPolicyAction: vi.fn(), applyShippingRegionPolicyAction: vi.fn(), endShippingRegionPolicyAction: vi.fn(), changeShippingRegionFeesAction: vi.fn() }));
const origin = { id: '00000000-0000-4000-8000-000000000001', code: 'fixture', name: '합성 출고지', defaultCarrier: 'hanjin',
  baseFee: 3000, freeThreshold: null, returnAddress: '', cutoff: null, exportTemplate: 'standard' as const, active: true, updatedAt: '2026-09-10T00:00:00Z' };
const hanjin = [{ code: 'hanjin', label: '한진', active: true }] as never;
const now = new Date('2026-11-09T00:00:00Z');
const rule = (regionLabel: string, amount: number, postalFrom: string) => ({ id: null, postalFrom, postalTo: postalFrom, addressPrefix: '', regionLabel, disposition: 'surcharge', amount });
const active = { id: 'p2', originId: origin.id, carrierCode: 'hanjin', name: '합성 기본', version: 1, revision: 1, status: 'active', startsAt: '2026-09-10T00:00:00Z', endsAt: null,
  rules: [rule('합성 제주', 3000, '10000'), rule('합성 도서', 5000, '20000')] };
const adoption = { originId: origin.id, managedFrom: '2026-09-10T00:00:00Z' } as never;
/* 화면에서 걷어 낸 것: 근거 칸·확인 체크, 초안 → 확인 → 활성화 단계의 말, 내부 번호. */
const REMOVED = ['물류사', '근거', '확인했습니다', '초안', '활성화', '확정하기', '버전', '추가료', '지역 정책', '지역 배송 정책', '미확인', '도입', 'TEST-ONLY'];
describe('지역별 추가배송비 관리 화면', () => {
  it('하나도 없으면 새로 만드는 칸을 열어 두고, 한 번에 저장하고 적용하는 버튼을 준다', () => {
    const html = renderToStaticMarkup(<ShippingRegionsScreen policies={[]} adoptions={[]} origins={[origin]} carriers={hanjin} canEdit />);
    for (const label of ['제주·도서산간처럼 배송비를 더 받는 지역과 금액을 출고지마다 정합니다.', '>안 씀<', '추가배송비 없이 주문받습니다', '>저장하고 적용</button>', '>적용하지 않고 저장</button>',
      '저장하면 바로', '정하지 않음 · 계속 적용', '지역표로 정하기', '추가배송비 없이 주문받기', '한 주문에 한 번', '배송정보 관리', '택배사 관리']) expect(html).toContain(label);
    for (const removed of REMOVED) expect(html).not.toContain(removed);
    /* 지역표 입력칸은 머리글과 예시 두 줄을 예시 글로 보인다. 긴 설명 문단 대신 "?" 하나다. */
    expect(html).toMatch(/<textarea[^>]*placeholder="우편번호 시작\t우편번호 끝\t주소 시작문구\t지역명\t처리\t추가배송비\n63000/);
    expect(html.match(/data-admin-help=""/g)).toHaveLength(1);
    expect(html).not.toContain('data-admin-notice');
  });
  /* 늘 떠 있는 경고는 지금 문제인지 알 수 없어 안 보게 된다 — 쓰기 시작한 출고지에 적용 중인 설정이 없을 때만 경고한다. */
  it('적용 중인 설정이 없는 출고지가 있을 때만 새 주문이 막혔다고 경고하고 까닭을 말한다', () => {
    const draft = { id: 'p1', originId: origin.id, carrierCode: 'hanjin', name: '합성 준비', version: 2, revision: 1, status: 'draft', startsAt: null, endsAt: null, rules: [] } as never;
    const uncovered = renderToStaticMarkup(<ShippingRegionsScreen policies={[draft]} adoptions={[adoption]} origins={[origin]} carriers={hanjin} canEdit now={now} />);
    expect(uncovered).toContain('data-admin-notice="warning"');
    expect(uncovered).toContain('새 주문이 막혀 있는 출고지가 있습니다');
    expect(uncovered).toContain('합성 출고지: 적용 기간이 끝났거나 끝낸 설정만 있습니다.');
    expect(uncovered).toContain('>적용 중인 설정 없음<');
    const covered = renderToStaticMarkup(<ShippingRegionsScreen policies={[active as never]} adoptions={[adoption]} origins={[origin]} carriers={hanjin} canEdit now={now} />);
    expect(covered).not.toContain('data-admin-notice');
    /* 적용 중이면 지금 받는 금액을 그대로 보인다. */
    expect(covered).toContain('>적용 중<');
    expect(covered).toContain('합성 제주 3,000원 · 합성 도서 5,000원');
    /* 기간이 끝났거나 아직 시작 전이거나 택배사가 다르면 주문에 쓰이지 않는다 — '적용 중'으로 말하지 않는다. */
    for (const [policy, label, reason] of [[{ ...active, endsAt: '2026-10-01T00:00:00Z' }, '>기간 끝남<', '적용 기간이 끝났거나 끝낸 설정만 있습니다'],
      [{ ...active, startsAt: '2026-12-01T00:00:00Z' }, '>예정<', '합성 출고지: 다음 설정이 2026. 12. 1. 09:00에 시작합니다. 그때까지 막혀 있습니다.'],
      [{ ...active, carrierCode: 'cj' }, '>택배사 다름<', '출고지의 기본 택배사가 적용해 둔 설정의 택배사와 다릅니다']] as const) {
      const blocked = renderToStaticMarkup(<ShippingRegionsScreen policies={[policy as never]} adoptions={[adoption]} origins={[origin]} carriers={hanjin} canEdit now={now} />);
      expect(blocked).toContain('data-admin-notice="warning"');
      expect(blocked).toContain('>적용 중인 설정 없음<');
      expect(blocked).toContain(label); expect(blocked).toContain(reason);
      expect(blocked).not.toContain('>적용 중<');
    }
    const carrierOff = renderToStaticMarkup(<ShippingRegionsScreen policies={[active as never]} adoptions={[adoption]} origins={[origin]} carriers={[{ code: 'hanjin', label: '한진', active: false }] as never} canEdit now={now} />);
    expect(carrierOff).toContain('합성 출고지: 기본 택배사가 없거나 ‘사용 안 함’입니다.');
    /* 택배사가 같은데 사용 안 함이어서 쓰이지 않는 설정에는 '택배사 다름'이라 하지 않는다. */
    expect(carrierOff).toContain('>택배사 사용 안 함<');
    expect(carrierOff).not.toContain('>택배사 다름<');
  });
  /* 시작 전인 설정에 '적용 중' 배지와 주문 차단 경고가 붙으면 안 된다. 쓰기 시작하는 시각 전에는 지금처럼 주문받는다. */
  it('적용 시작 전이면 예정으로 말하고 경고하지 않는다', () => {
    const scheduled = { ...active, id: 'p3', name: '합성 예정', startsAt: '2026-12-01T00:00:00Z' } as never;
    const html = renderToStaticMarkup(<ShippingRegionsScreen policies={[scheduled]} adoptions={[{ originId: origin.id, managedFrom: '2026-12-01T00:00:00Z' }] as never} origins={[origin]} carriers={hanjin} canEdit now={now} />);
    expect(html.match(/>예정</g)).toHaveLength(2);
    expect(html).not.toContain('>적용 중<');
    expect(html).toContain('부터 적용 · 그 전에는 추가배송비 없이 주문받습니다');
    expect(html).not.toContain('data-admin-notice');
  });
  /* 설정이 있으면 첫 화면은 적용 상태와 목록이다 — 빈 입력칸과 바닥 저장 막대가 목록을 밀어내지 않는다. */
  it('설정이 있으면 입력칸은 닫혀 있고, 목록은 이름·적용 기간·상태로 구분한다', () => {
    const draft = { id: 'p1', originId: origin.id, carrierCode: 'hanjin', name: '합성 준비', version: 2, revision: 1, status: 'draft', startsAt: null, endsAt: null, rules: [] } as never;
    const html = renderToStaticMarkup(<ShippingRegionsScreen policies={[draft, { ...active, endsAt: '2026-12-01T00:00:00Z' } as never]} adoptions={[adoption]} origins={[origin]} carriers={hanjin} canEdit now={now} />);
    expect(html).toContain('합성 출고지 · 합성 준비');
    expect(html).toContain('적용하면 바로 시작');
    expect(html).toContain('>준비 중<');
    expect(html).toContain('‘준비 중’은 아직 주문에 적용되지 않습니다.');
    expect(html).toMatch(/합성 출고지 · 합성 기본 <span[^>]*>· 2026\. 9\. 10\. 09:00부터 2026\. 12\. 1\. 09:00까지<\/span>/);
    expect(html).toContain('>새로 만들기</button>');
    expect(html).not.toContain('data-region-editor');
    expect(html).not.toContain('저장하고 적용');
    for (const removed of REMOVED) expect(html).not.toContain(removed);
  });
  it('조회만 하는 계정에는 만들기·저장 입력을 주지 않는다', () => {
    const html = renderToStaticMarkup(<ShippingRegionsScreen policies={[]} adoptions={[]} origins={[origin]} carriers={hanjin} canEdit={false} />);
    expect(html).toContain('>안 씀<');
    expect(html).toContain('아직 만든 설정이 없습니다.');
    for (const hidden of ['저장하고 적용', '적용하지 않고 저장', '새로 만들기', '<textarea']) expect(html).not.toContain(hidden);
  });
  /* S5-4: 적용 중인 설정이 곧 끝나도 '출고지별 적용 상태'에서 알 수 있게 끝나는 날을 함께 보인다(끝이 없으면 아무것도 덧붙이지 않는다). */
  it('적용 중인 설정이 끝나는 날을 출고지별 적용 상태에 함께 보인다', () => {
    const ending = renderToStaticMarkup(<ShippingRegionsScreen policies={[{ ...active, endsAt: '2026-11-11T00:00:00Z' } as never]} adoptions={[adoption]} origins={[origin]} carriers={hanjin} canEdit now={now} />);
    expect(ending).toContain('>적용 중<');
    expect(ending).toContain('합성 제주 3,000원 · 합성 도서 5,000원 · 2026. 11. 11. 09:00까지');
    const open = renderToStaticMarkup(<ShippingRegionsScreen policies={[active as never]} adoptions={[adoption]} origins={[origin]} carriers={hanjin} canEdit now={now} />);
    expect(open).toContain('합성 제주 3,000원 · 합성 도서 5,000원<');
  });
  /* S5-3: 끝낸 설정에 남은 끝은 예정했던 끝일 뿐이다 — 실제로 끝낸 때처럼 읽히지 않게 시작만 보이고, 기간이 끝난 설정은 끝을 그대로 보인다. */
  it('끝낸 설정은 예정했던 끝을 보이지 않고, 기간이 끝난 설정은 끝을 보인다', () => {
    const planned = { ...active, id: 'p5', name: '합성 끝냄', status: 'retired', endsAt: '2026-11-27T00:00:00Z' } as never;
    const expired = { ...active, id: 'p6', name: '합성 기간끝', endsAt: '2026-10-01T00:00:00Z' } as never;
    const html = renderToStaticMarkup(<ShippingRegionsScreen policies={[planned, expired]} adoptions={[adoption]} origins={[origin]} carriers={hanjin} canEdit now={now} />);
    const row = (name: string) => html.match(new RegExp(`합성 출고지 · ${name} <span[^>]*>([^<]*)</span>`))?.[1] ?? '';
    expect(row('합성 끝냄')).toBe('· 2026. 9. 10. 09:00부터');
    expect(row('합성 기간끝')).toBe('· 2026. 9. 10. 09:00부터 2026. 10. 1. 09:00까지');
    expect(html).toContain('>끝냄<');
    expect(html).toContain('>기간 끝남<');
  });
});
