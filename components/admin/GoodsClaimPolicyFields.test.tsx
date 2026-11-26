import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/* 접힌 줄은 입력 부품만 필요하다 — 서버 액션·스토리지 클라이언트는 쓰지 않는다. */
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
import { GoodsClaimPolicyFields } from './GoodsClaimPolicyFields';

const ADDRESSES = [{ id: '11111111-1111-4111-8111-111111111111', name: '서울 반품처', address: '서울특별시 합성구 반품로 1' }];
const render = (values: Record<string, string> = {}, returnAddresses: readonly { id: string; name: string; address: string }[] = ADDRESSES) =>
  renderToStaticMarkup(<GoodsClaimPolicyFields values={values} returnAddresses={returnAddresses} />);

/* W-1: 배송 설정 화면(반품/교환지 관리)과 같은 이름이다 — 상품 수정 화면의 칸·도움말·접힌 줄 요약에 옛 이름 '반품지'가 남지 않는다. */
describe('상품 수정 화면의 반품/교환지 이름', () => {
  it('칸 이름과 도움말과 접힌 줄 요약이 모두 반품/교환지다', () => {
    const html = render({ claimReturnAddressId: ADDRESSES[0].id });
    expect(html).toContain('반품/교환지');
    expect(html).toContain('반품 기본 정책 확인 · 교환 기본 정책 확인 · 반품/교환지 서울 반품처');
    expect(html).toContain('반품을 승인하면 그때의 반품/교환지가 회수 주소로 정해집니다. 반품/교환지는 ');
    expect(html).toMatch(/<a [^>]*href="\/admin\/settings\/return-addresses"[^>]*>반품\/교환지 관리<\/a>에서 등록합니다/);
    expect(html.replace(/반품\/교환지/g, '')).not.toContain('반품지');
  });
  it('고르지 않으면 출고지 반품 주소를 쓴다고 말하고, 주소록에서 지워진 값은 그대로 두며 확인을 요청한다', () => {
    expect(render()).toContain('반품/교환지 출고지 반품 주소');
    const html = render({ claimReturnAddressId: '22222222-2222-4222-8222-222222222222' });
    expect(html).toContain('저장된 반품/교환지 · 주소록에서 확인 필요');
    expect(html.replace(/반품\/교환지/g, '')).not.toContain('반품지');
  });
});
