import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  upsertAdminCampaignAction,
  upsertAdminCoinExchangeOfferAction,
} from './campaign-actions';

const POOL_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: () => mocks.adminState }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function form(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

function campaignForm(overrides: Record<string, string> = {}) {
  return form({
    id: 'autumn-attendance',
    kind: 'event',
    title: '가을 출석 이벤트',
    subtitle: '매일 출석하고 코인을 모으세요',
    status: 'published',
    startsAt: '2026-09-01T00:00',
    endsAt: '2026-09-30T23:59',
    featuredOrder: '1',
    heroImagePath: 'campaigns/autumn/hero.webp',
    sections: '[{"type":"attendance"}]',
    ...overrides,
  });
}

function offerForm(overrides: Record<string, string> = {}) {
  return form({
    poolId: POOL_ID,
    label: '가을 카드팩 1장',
    coinCost: '10',
    ticketCount: '1',
    status: 'active',
    ...overrides,
  });
}

beforeEach(() => {
  mocks.adminState = {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  };
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.revalidatePath.mockReset();
});

describe('upsertAdminCampaignAction', () => {
  it('정규화한 폼을 RPC 한 번으로 저장한다', async () => {
    const state = await upsertAdminCampaignAction({}, campaignForm());

    expect(mocks.rpc).toHaveBeenCalledWith('admin_upsert_campaign', {
      target_banner_image_path: null,
      target_card_image_path: null,
      target_ends_at: '2026-09-30T14:59:00.000Z',
      target_featured_order: 1,
      target_hero_image_path: 'campaigns/autumn/hero.webp',
      target_id: 'autumn-attendance',
      target_kind: 'event',
      target_previous_id: null,
      target_sections: [{ type: 'attendance' }],
      target_starts_at: '2026-08-31T15:00:00.000Z',
      target_status: 'published',
      target_subtitle: '매일 출석하고 코인을 모으세요',
      target_title: '가을 출석 이벤트',
    });
    expect(state.message).toContain('가을 출석 이벤트');
  });

  /* 수정은 previousId 를 실어 보내야 RPC 가 신규 등록과 구분한다 —
     안 보내면 기존 캠페인을 덮어쓰는 대신 catalog_id_taken 으로 거절된다. */
  it('수정은 previousId 를 그대로 넘긴다', async () => {
    await upsertAdminCampaignAction({}, campaignForm({ previousId: 'autumn-attendance' }));

    expect(mocks.rpc).toHaveBeenCalledWith(
      'admin_upsert_campaign',
      expect.objectContaining({ target_previous_id: 'autumn-attendance' }),
    );
  });

  it('비스태프는 RPC 에 닿지 않는다', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    const state = await upsertAdminCampaignAction({}, campaignForm());

    expect(state.errors?.form).toBe('관리자 권한이 필요합니다.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('폼 검증 실패는 RPC 왕복 없이 돌려준다', async () => {
    const state = await upsertAdminCampaignAction({}, campaignForm({ id: '가을 캠페인' }));

    expect(state.errors?.id).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  /* 캠페인 슬러그는 오프라인 팝업(events)과도 겹칠 수 없다. 그 사실을 말하지
     않으면 운영자는 "왜 안 되는지"를 알 수 없다. */
  it('슬러그 충돌은 오프라인 팝업까지 짚어 준다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'catalog_id_taken' } });

    const state = await upsertAdminCampaignAction({}, campaignForm());

    expect(state.errors?.id).toContain('오프라인 팝업 ID와도 겹칠 수 없어요');
  });

  it('ID 변경 시도는 변경 불가로 옮긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'catalog_id_immutable' } });

    const state = await upsertAdminCampaignAction({}, campaignForm({ previousId: 'autumn-attendance' }));

    expect(state.errors?.id).toContain('변경할 수 없습니다');
  });

  /* DB 는 사유를 invalid_sections 하나로 답하고 위치는 DETAIL 에 싣는다.
     그 위치를 버리면 20블록짜리 JSON 에서 어디를 고쳐야 하는지 알 수 없다. */
  it('본문 스키마 위반은 DB 가 알려 준 위치까지 옮긴다', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'invalid_sections', details: 'sections[2].offer_id: not a uuid' },
    });

    const state = await upsertAdminCampaignAction({}, campaignForm());

    expect(state.errors?.sections).toContain('랜딩 구성 JSON이 스키마에 맞지 않아요');
    expect(state.errors?.sections).toContain('sections[2].offer_id');
  });

  /* 오타 코드가 통과하면 랜딩에는 멀쩡한 경품처럼 걸린다 — 저장 단계에서 막고,
     운영자에게는 "쿠폰을 먼저 등록하라"는 다음 행동을 준다. */
  it('없는 쿠폰 코드는 쿠폰 관리 등록 안내로 옮긴다', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'unknown_coupon_code', details: 'CMPGHOST' },
    });

    const state = await upsertAdminCampaignAction({}, campaignForm());

    expect(state.errors?.sections).toBe('쿠폰 섹션의 코드가 쿠폰 관리에 등록되어 있지 않아요.');
  });

  it('저장 성공은 이벤트 허브와 상세를 다시 그리게 한다', async () => {
    await upsertAdminCampaignAction({}, campaignForm());

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/events');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/events/[eventId]', 'page');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/display/campaigns');
  });

  it('모르는 오류는 일반 실패로 접는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'deadlock detected' } });

    const state = await upsertAdminCampaignAction({}, campaignForm());

    expect(state.errors?.form).toContain('저장하지 못했습니다');
  });
});

describe('upsertAdminCoinExchangeOfferAction', () => {
  it('신규 교환처는 id 를 null 로 보낸다', async () => {
    const state = await upsertAdminCoinExchangeOfferAction({}, offerForm());

    expect(mocks.rpc).toHaveBeenCalledWith('admin_upsert_coin_exchange_offer', {
      target_coin_cost: 10,
      target_id: null,
      target_label: '가을 카드팩 1장',
      target_pool_id: POOL_ID,
      target_status: 'active',
      target_ticket_count: 1,
    });
    expect(state.message).toContain('가을 카드팩 1장');
  });

  it('수정은 선택한 교환처 id 를 함께 보낸다', async () => {
    await upsertAdminCoinExchangeOfferAction({}, offerForm({ offerId: OFFER_ID }));

    expect(mocks.rpc).toHaveBeenCalledWith(
      'admin_upsert_coin_exchange_offer',
      expect.objectContaining({ target_id: OFFER_ID }),
    );
  });

  it('비스태프는 RPC 에 닿지 않는다', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    const state = await upsertAdminCoinExchangeOfferAction({}, offerForm());

    expect(state.errors?.form).toBe('관리자 권한이 필요합니다.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  /* 없는 풀을 가리키는 교환처는 상세에 "교환 가능"으로 그려진 뒤 교환 시점에야
     실패한다. DB 가 등록 시점에 막고, 그 사유를 그대로 옮긴다. */
  it('없는 카드풀은 필드 오류로 옮긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'pool_not_found' } });

    const state = await upsertAdminCoinExchangeOfferAction({}, offerForm());

    expect(state.errors?.poolId).toContain('카드풀을 찾을 수 없습니다');
  });

  it('교환처 저장도 캠페인 상세를 다시 그리게 한다', async () => {
    await upsertAdminCoinExchangeOfferAction({}, offerForm());

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/events/[eventId]', 'page');
  });
});
