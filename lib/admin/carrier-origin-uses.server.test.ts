import { beforeEach, describe, expect, it, vi } from 'vitest';
import { carrierTurnOffBlock, loadCarrierUsesView } from './carrier-origin-uses.server';

const mocks = vi.hoisted(() => ({ uses: vi.fn(), origins: vi.fn(), maybeSingle: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), createClient: vi.fn() }));
vi.mock('./shipping-impact.server', () => ({ loadCarrierOriginUses: mocks.uses }));
vi.mock('./fulfillment-origins.server', () => ({ loadAdminFulfillmentOrigins: mocks.origins }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

const use = (originId: string, originName: string, active: boolean) => ({ originId, originName, active, usesRegionalFee: null });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockImplementation(async () => ({ from: mocks.from }));
  mocks.from.mockImplementation(() => ({ select: mocks.select }));
  mocks.select.mockImplementation(() => ({ eq: mocks.eq }));
  mocks.eq.mockImplementation(() => ({ maybeSingle: mocks.maybeSingle }));
  mocks.maybeSingle.mockResolvedValue({ data: { is_active: true }, error: null });
});

describe('택배사 관리 화면용 조회', () => {
  it('택배사마다 쓰는 출고지를 이름·사용 여부·그 출고지 탭 링크로 돌려준다', async () => {
    mocks.uses.mockResolvedValue({ hanjin: [use('a', '김포', true)], epost: [use('b', '남양주', false)] });
    mocks.origins.mockResolvedValue([{ id: 'a', code: 'gimpo' }, { id: 'b', code: 'namyangju' }]);
    expect(await loadCarrierUsesView()).toEqual({
      hanjin: [{ name: '김포', active: true, href: '/admin/settings/origins?origin=gimpo' }],
      epost: [{ name: '남양주', active: false, href: '/admin/settings/origins?origin=namyangju' }],
    });
  });
  it('출고지 코드를 읽지 못해도 화면은 열리고, 링크는 배송정보 관리 첫 화면이다', async () => {
    mocks.uses.mockResolvedValue({ hanjin: [use('a', '김포', true)] });
    mocks.origins.mockRejectedValue(new Error('출고지를 불러오지 못했습니다.'));
    expect(await loadCarrierUsesView()).toEqual({ hanjin: [{ name: '김포', active: true, href: '/admin/settings/origins' }] });
  });
  it('쓰는 출고지를 읽지 못했으면 null이다 — 쓰는 곳이 없다는 뜻이 아니다', async () => {
    mocks.uses.mockResolvedValue(null);
    mocks.origins.mockResolvedValue([]);
    expect(await loadCarrierUsesView()).toBeNull();
  });
});

describe('택배사를 끄는 저장의 서버 판정', () => {
  it('새 주문을 받는 출고지가 기본 택배사로 쓰면 그 출고지 이름과 바꿀 곳을 말하며 막는다', async () => {
    mocks.uses.mockResolvedValue({ hanjin: [use('a', '김포', true), use('b', '남양주', false)] });
    expect(await carrierTurnOffBlock('hanjin')).toBe('김포 출고지가 이 택배사를 기본 택배사로 쓰고 있어 끌 수 없습니다. 배송정보 관리에서 그 출고지의 택배사를 먼저 바꿔 주세요.');
    expect(mocks.eq).toHaveBeenCalledWith('code', 'hanjin');
  });
  it('쓰는 출고지가 없거나 사용 안 함인 출고지만 쓰면 막지 않는다', async () => {
    mocks.uses.mockResolvedValue({ hanjin: [use('a', '김포', true)], epost: [use('b', '남양주', false)] });
    expect(await carrierTurnOffBlock('epost')).toBeNull();
    expect(await carrierTurnOffBlock('cj')).toBeNull();
  });
  it('쓰는 출고지를 읽지 못했으면 끌 수 있다고 하지 않고 다시 해 달라고 말한다', async () => {
    mocks.uses.mockResolvedValue(null);
    expect(await carrierTurnOffBlock('hanjin')).toBe('이 택배사를 기본으로 쓰는 출고지를 확인하지 못해 지금은 끌 수 없습니다. 잠시 뒤 다시 해 주세요.');
  });
  it('이미 사용 안 함인 택배사를 사용 안 함으로 다시 저장하는 것은 새로 끄는 일이 아니라 막지 않는다(이름·주소만 고치는 저장)', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { is_active: false }, error: null });
    mocks.uses.mockResolvedValue({ hanjin: [use('a', '김포', true)] });
    expect(await carrierTurnOffBlock('hanjin')).toBeNull();
    expect(mocks.uses).not.toHaveBeenCalled();
  });
  it('지금 상태를 읽지 못하면 사용 중으로 보고 쓰는 출고지를 따진다', async () => {
    mocks.uses.mockResolvedValue({ hanjin: [use('a', '김포', true)] });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect(await carrierTurnOffBlock('hanjin')).toContain('김포 출고지가');
    mocks.maybeSingle.mockRejectedValue(new Error('network'));
    expect(await carrierTurnOffBlock('hanjin')).toContain('김포 출고지가');
    mocks.createClient.mockRejectedValue(new Error('no client'));
    expect(await carrierTurnOffBlock('hanjin')).toContain('김포 출고지가');
  });
});
