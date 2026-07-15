import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adjustAdminStockAction,
  endAdminGameAction,
  hideCommunityPostAction,
  setAdminPoolOddsAction,
  setAdminUserRoleAction,
  updateCommunityReportStatusAction,
  upsertAdminCardAction,
  upsertAdminCardPoolAction,
  upsertAdminEventAction,
  upsertAdminGoodAction,
  upsertAdminGameAction,
  upsertAdminIpAction,
  upsertAdminRewardPolicyAction,
  upsertAdminTicketTypeAction,
} from './actions';
import type { CatalogSnapshot } from '@/lib/catalog';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff' as 'user' | 'staff' | 'admin',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  catalog: null as CatalogSnapshot | null,
  getCatalogSnapshot: vi.fn(),
  getAdminCatalogRecords: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: () => mocks.adminState,
}));
vi.mock('@/lib/admin/catalog', async () => await import('../../lib/admin/catalog'));
vi.mock('@/lib/admin/catalog.server', () => ({
  getAdminCatalogRecords: mocks.getAdminCatalogRecords,
}));
vi.mock('@/lib/admin/moderation', async () => await import('../../lib/admin/moderation'));
vi.mock('@/lib/admin/roles', async () => await import('../../lib/admin/roles'));
vi.mock('@/lib/catalog', () => ({
  getCatalogSnapshot: mocks.getCatalogSnapshot,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    rpc: mocks.rpc,
  }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

const catalog: CatalogSnapshot = {
  source: 'supabase',
  verticals: [{ key: 'rofan', label: '로맨스판타지', color: '#8B5CFF' }],
  ips: [{
    id: 'hwasan',
    title: '화산강림',
    sub: '리디 · 로판',
    v: { key: 'rofan', label: '로맨스판타지', color: '#8B5CFF' },
    glyph: '화산',
    bg: 'bg',
    fans: 10,
    goods: 1,
    cards: 1,
    featured: true,
    tagline: '매화는 다시 핀다',
    synopsis: '화산파의 부활',
  }],
  goods: [{
    id: 'g100',
    name: '화산강림 아크릴 스탠드',
    ip: 'hwasan',
    type: '아크릴 스탠드',
    price: 22000,
    badge: null,
    stock: 'ok',
    stockQty: 12,
    img: '',
  }],
  cards: [],
  events: [{
    id: 'e100',
    title: '화산강림 팝업',
    ip: 'hwasan',
    mode: '오프라인',
    status: '예정',
    date: '2026.07.25',
    loc: '성수',
    accent: '#8B5CFF',
    img: '',
  }],
};

const gamePoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const adminRecords = {
  ips: [],
  goods: [],
  cards: [],
  cardPools: [{
    id: gamePoolId,
    ipId: 'hwasan',
    name: '화산 무상 리워드 풀',
    activeFrom: '2020-01-01T00:00:00.000Z',
    activeTo: '2099-01-01T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    status: 'active',
    oddsConfigured: true,
    rewardReady: true,
    odds: { N: 0, R: 0.7, SR: 0, SSR: 0.2, HOLO: 0.1 },
  }],
  rewardPolicies: [],
  events: [{
    id: 'online-hwasan',
    ipId: 'hwasan',
    title: '화산 온라인 팝업',
    mode: '온라인',
    status: '예정',
    startsAt: null,
    endsAt: null,
    location: null,
    accent: null,
    bg: null,
    imagePath: null,
  }],
  games: [],
  ticketTypes: [],
};

function goodForm() {
  const formData = new FormData();
  formData.set('id', 'g100');
  formData.set('ipId', 'hwasan');
  formData.set('name', '화산강림 아크릴 스탠드');
  formData.set('type', '아크릴 스탠드');
  formData.set('price', '22000');
  formData.set('badge', '신상');
  formData.set('stock', 'ok');
  formData.set('stockQty', '12');
  return formData;
}

function stockAdjustmentForm() {
  const formData = new FormData();
  formData.set('adjustmentId', '11111111-1111-4111-8111-111111111111');
  formData.set('goodId', 'g100');
  formData.set('ipId', 'hwasan');
  formData.set('expectedStockQty', '40');
  formData.set('delta', '12');
  formData.set('reason', '  신규 입고  ');
  return formData;
}

function ipForm() {
  const formData = new FormData();
  formData.set('id', 'hwasan');
  formData.set('title', '화산강림');
  formData.set('sub', '리디 · 로판');
  formData.set('verticalKey', 'rofan');
  formData.set('tagline', '매화는 다시 핀다');
  formData.set('synopsis', '화산파의 부활');
  formData.set('glyph', '화산');
  formData.set('featured', 'on');
  formData.set('fansCount', '42');
  return formData;
}

function eventForm() {
  const formData = new FormData();
  formData.set('id', 'e100');
  formData.set('ipId', 'hwasan');
  formData.set('title', '합동 팝업');
  formData.set('mode', '오프라인');
  formData.set('status', '예정');
  formData.set('startsAt', '2026-07-01T10:30');
  formData.set('endsAt', '2026-07-01T12:00');
  formData.set('location', '성수');
  formData.set('accent', '#8B5CFF');
  return formData;
}

function ticketTypeForm() {
  const formData = new FormData();
  formData.set('operationId', '11111111-1111-4111-8111-111111111111');
  formData.set('id', '22222222-2222-4222-8222-222222222222');
  formData.set('eventId', 'e100');
  formData.set('name', '7월 25일 1회차');
  formData.set('price', '25000');
  formData.set('capacity', '80');
  return formData;
}

function cardForm() {
  const formData = new FormData();
  formData.set('id', 'c100');
  formData.set('ipId', 'hwasan');
  formData.set('name', '청명 홀로 카드');
  formData.set('rarity', 'HOLO');
  formData.set('poolId', '22222222-2222-4222-8222-222222222222');
  return formData;
}

function cardPoolForm() {
  const formData = new FormData();
  formData.set('operationId', '11111111-1111-4111-8111-111111111111');
  formData.set('id', '22222222-2222-4222-8222-222222222222');
  formData.set('ipId', 'hwasan');
  formData.set('name', '화산강림 무상 리워드 풀');
  formData.set('activeFrom', '2026-07-15T10:00');
  formData.set('activeTo', '2026-08-01T00:00');
  return formData;
}

function poolOddsForm() {
  const formData = new FormData();
  formData.set('operationId', '33333333-3333-4333-8333-333333333333');
  formData.set('poolId', '22222222-2222-4222-8222-222222222222');
  formData.set('oddsN', '0');
  formData.set('oddsR', '70');
  formData.set('oddsSr', '0');
  formData.set('oddsSsr', '20');
  formData.set('oddsHolo', '10');
  return formData;
}

function rewardPolicyForm() {
  const formData = new FormData();
  formData.set('operationId', '44444444-4444-4444-8444-444444444444');
  formData.set('id', '55555555-5555-4555-8555-555555555555');
  formData.set('poolId', '22222222-2222-4222-8222-222222222222');
  formData.set('trigger', 'order_paid');
  formData.set('targetIpId', 'hwasan');
  formData.set('targetGoodId', 'g100');
  formData.set('minAmount', '30000');
  formData.set('ticketsPerGrant', '2');
  formData.set('active', 'on');
  formData.set('activeFrom', '2026-07-15T10:00');
  formData.set('activeTo', '2026-08-01T00:00');
  return formData;
}

function gameForm() {
  const formData = new FormData();
  formData.set('operationId', '77777777-7777-4777-8777-777777777777');
  formData.set('previousGameId', 'old-marble');
  formData.set('id', 'new-marble');
  formData.set('title', '화산 마블 룰렛');
  formData.set('rewardPoolId', gamePoolId);
  formData.set('eventId', 'online-hwasan');
  formData.set('perUserDailyLimit', '2');
  formData.set('activeFrom', '2026-07-15T10:00');
  formData.set('activeTo', '2026-08-01T00:00');
  return formData;
}

function gameEndForm() {
  const formData = new FormData();
  formData.set('operationId', '88888888-8888-4888-8888-888888888888');
  formData.set('gameId', 'marble-maple');
  return formData;
}

const reportId = '44444444-4444-4444-8444-444444444444';
const postId = '55555555-5555-4555-8555-555555555555';

function reportStatusForm() {
  const formData = new FormData();
  formData.set('reportId', reportId);
  formData.set('status', 'reviewing');
  return formData;
}

function hidePostForm() {
  const formData = new FormData();
  formData.set('reportId', reportId);
  formData.set('postId', postId);
  return formData;
}

describe('admin catalog actions', () => {
  beforeEach(() => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'staff-1', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.catalog = catalog;
    mocks.getCatalogSnapshot.mockReset();
    mocks.getCatalogSnapshot.mockResolvedValue(catalog);
    mocks.getAdminCatalogRecords.mockReset();
    mocks.getAdminCatalogRecords.mockResolvedValue(adminRecords);
    mocks.rpc.mockReset();
    mocks.revalidatePath.mockReset();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it('redirects unauthenticated users to login with the admin next path', async () => {
    mocks.adminState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(upsertAdminGoodAction({}, goodForm())).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('blocks authenticated non-staff users without writing', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'user-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(upsertAdminGoodAction({}, goodForm())).resolves.toEqual({
      errors: { form: '관리자 권한이 필요합니다.' },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns validation errors before calling the admin RPC', async () => {
    const formData = goodForm();
    formData.set('ipId', 'missing');
    formData.set('price', '-1');

    await expect(upsertAdminGoodAction({}, formData)).resolves.toEqual({
      errors: {
        ipId: '등록된 IP를 선택해주세요.',
        price: '가격은 0 이상의 정수여야 합니다.',
      },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('calls the admin IP RPC without overwriting the fan count cache', async () => {
    await expect(upsertAdminIpAction({}, ipForm())).resolves.toEqual({
      message: 'IP를 저장했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_upsert_ip', {
      target_id: 'hwasan',
      target_title: '화산강림',
      target_sub: '리디 · 로판',
      target_vertical_key: 'rofan',
      target_tagline: '매화는 다시 핀다',
      target_synopsis: '화산파의 부활',
      target_glyph: '화산',
      target_bg: null,
      target_image_path: null,
      target_featured: true,
    });
  });

  it('calls the admin good RPC and refreshes catalog surfaces', async () => {
    const formData = goodForm();
    formData.set('previousIpId', 'lumen');

    await expect(upsertAdminGoodAction({}, formData)).resolves.toEqual({
      message: '굿즈를 저장했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_upsert_good', {
      target_id: 'g100',
      target_ip_id: 'hwasan',
      target_name: '화산강림 아크릴 스탠드',
      target_type: '아크릴 스탠드',
      target_price: 22000,
      target_badge: '신상',
      target_stock: 'ok',
      target_bg: null,
      target_image_path: null,
    });
    expect(mocks.getCatalogSnapshot).toHaveBeenCalledWith({ previewDefaultSource: 'supabase' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/ip');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/ip/hwasan');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/ip/lumen');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/shop');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin');
  });

  it('adjusts stock through the audited RPC and refreshes every stock consumer', async () => {
    await expect(adjustAdminStockAction({}, stockAdjustmentForm())).resolves.toEqual({
      message: '실재고를 조정했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_adjust_stock', {
      target_adjustment_id: '11111111-1111-4111-8111-111111111111',
      target_good_id: 'g100',
      target_expected_stock_qty: 40,
      target_delta: 12,
      target_reason: '신규 입고',
    });
    for (const path of ['/', '/ip', '/ip/hwasan', '/shop', '/cart', '/checkout', '/admin']) {
      expect(mocks.revalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it('rejects an invalid stock adjustment before calling the RPC', async () => {
    const formData = stockAdjustmentForm();
    formData.set('delta', '0');
    formData.set('reason', ' ');

    await expect(adjustAdminStockAction({}, formData)).resolves.toEqual({
      errors: {
        delta: '조정 수량은 0이 아닌 정수여야 합니다.',
        reason: '조정 사유를 입력해주세요.',
      },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('blocks non-staff stock adjustments without writing', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'user-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(adjustAdminStockAction({}, stockAdjustmentForm())).resolves.toEqual({
      errors: { form: '관리자 권한이 필요합니다.' },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['stock_out_of_range', '재고는 0개 미만이거나 허용 범위를 넘도록 조정할 수 없습니다.'],
    ['good_not_found', '굿즈를 찾을 수 없습니다.'],
    ['stock_changed', '실재고가 변경되었습니다. 최신 수량을 확인한 뒤 다시 시도해주세요.'],
    ['adjustment_conflict', '이미 사용된 재고 조정 요청입니다. 최신 수량을 확인해주세요.'],
  ])('maps %s stock RPC errors without exposing internals', async (rpcMessage, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: rpcMessage } });

    await expect(adjustAdminStockAction({}, stockAdjustmentForm())).resolves.toEqual({
      errors: { form: expected },
    });

    if (rpcMessage === 'stock_changed') {
      expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin');
    }
  });

  it('calls the admin event RPC with KST date-times converted to UTC instants', async () => {
    await expect(upsertAdminEventAction({}, eventForm())).resolves.toEqual({
      message: '이벤트를 저장했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_upsert_event', {
      target_id: 'e100',
      target_ip_id: 'hwasan',
      target_title: '합동 팝업',
      target_mode: '오프라인',
      target_status: '예정',
      target_starts_at: '2026-07-01T01:30:00.000Z',
      target_ends_at: '2026-07-01T03:00:00.000Z',
      target_location: '성수',
      target_accent: '#8B5CFF',
      target_bg: null,
      target_image_path: null,
    });
  });

  it('explains when a linked game locks an event IP or mode', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'game_event_contract_locked' } });

    await expect(upsertAdminEventAction({}, eventForm())).resolves.toEqual({
      errors: { form: '연결된 게임이 있어 이벤트 IP·운영 방식을 변경할 수 없습니다.' },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('saves a card with an explicit pool binding through the audited RPC', async () => {
    await expect(upsertAdminCardAction({}, cardForm())).resolves.toEqual({
      message: '카드를 저장했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_upsert_card', {
      target_id: 'c100',
      target_ip_id: 'hwasan',
      target_name: '청명 홀로 카드',
      target_no: null,
      target_rarity: 'HOLO',
      target_bg: null,
      target_image_path: null,
      target_pool_id: '22222222-2222-4222-8222-222222222222',
      target_pool_binding_provided: true,
    });
  });

  it('saves a card pool through the retry-safe audited RPC', async () => {
    await expect(upsertAdminCardPoolAction({}, cardPoolForm())).resolves.toEqual({
      message: '카드풀을 저장했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_upsert_card_pool', {
      target_operation_id: '11111111-1111-4111-8111-111111111111',
      target_pool_id: '22222222-2222-4222-8222-222222222222',
      target_ip_id: 'hwasan',
      target_name: '화산강림 무상 리워드 풀',
      target_active_from: '2026-07-15T01:00:00.000Z',
      target_active_to: '2026-07-31T15:00:00.000Z',
    });
    for (const path of ['/admin', '/packs', '/binder']) {
      expect(mocks.revalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it('sets all five pool odds through one audited RPC call', async () => {
    await expect(setAdminPoolOddsAction({}, poolOddsForm())).resolves.toEqual({
      message: '등급별 확률을 저장했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_pool_odds', {
      target_operation_id: '33333333-3333-4333-8333-333333333333',
      target_pool_id: '22222222-2222-4222-8222-222222222222',
      target_n: 0,
      target_r: 0.7,
      target_sr: 0,
      target_ssr: 0.2,
      target_holo: 0.1,
    });
  });

  it('saves a reward policy with stable IDs and the exact audited RPC payload', async () => {
    const formData = rewardPolicyForm();

    await expect(upsertAdminRewardPolicyAction({}, formData)).resolves.toEqual({
      message: '발급 정책을 저장했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_upsert_reward_policy', {
      target_operation_id: '44444444-4444-4444-8444-444444444444',
      target_policy_id: '55555555-5555-4555-8555-555555555555',
      target_pool_id: '22222222-2222-4222-8222-222222222222',
      target_trigger: 'order_paid',
      target_ip_id: 'hwasan',
      target_good_id: 'g100',
      target_min_amount: 30000,
      target_tickets_per_grant: 2,
      target_active: true,
      target_active_from: '2026-07-15T01:00:00.000Z',
      target_active_to: '2026-07-31T15:00:00.000Z',
    });
    expect(formData.get('operationId')).toBe('44444444-4444-4444-8444-444444444444');
    expect(formData.get('id')).toBe('55555555-5555-4555-8555-555555555555');
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ['/admin'],
      ['/packs'],
      ['/binder'],
    ]);
  });

  it('saves a card game with the exact audited RPC payload and refreshes both slugs', async () => {
    await expect(upsertAdminGameAction({}, gameForm())).resolves.toEqual({
      message: '게임을 저장했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_upsert_game', {
      target_operation_id: '77777777-7777-4777-8777-777777777777',
      target_previous_game_id: 'old-marble',
      target_game_id: 'new-marble',
      target_title: '화산 마블 룰렛',
      target_reward_pool_id: gamePoolId,
      target_event_id: 'online-hwasan',
      target_per_user_daily_limit: 2,
      target_active_from: '2026-07-15T01:00:00.000Z',
      target_active_to: '2026-07-31T15:00:00.000Z',
      target_end_now: false,
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ['/admin'],
      ['/games/old-marble'],
      ['/games/new-marble'],
      ['/events'],
    ]);
  });

  it('ends an active game at database execution time without trusting browser fields', async () => {
    await expect(endAdminGameAction({}, gameEndForm())).resolves.toEqual({
      message: '게임 운영을 종료했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_upsert_game', {
      target_operation_id: '88888888-8888-4888-8888-888888888888',
      target_previous_game_id: 'marble-maple',
      target_game_id: 'marble-maple',
      target_title: null,
      target_reward_pool_id: null,
      target_event_id: null,
      target_per_user_daily_limit: null,
      target_active_from: null,
      target_active_to: null,
      target_end_now: true,
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ['/admin'],
      ['/games/marble-maple'],
      ['/events'],
    ]);
  });

  it('rejects invalid game input before RPC access or revalidation', async () => {
    const formData = gameForm();
    formData.set('activeFrom', '');
    formData.set('perUserDailyLimit', '0');

    await expect(upsertAdminGameAction({}, formData)).resolves.toEqual({
      errors: {
        perUserDailyLimit: '일일 플레이 한도는 1~100 사이의 정수여야 합니다.',
        activeFrom: '운영 시작 일시를 명시적으로 선택해주세요.',
      },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['reward_pool_not_ready', '확률과 카드 구성이 완료된 운영 가능한 카드풀을 선택해주세요.'],
    ['game_pool_window_not_covered', '게임 운영 기간은 카드풀 운영 기간 안에 있어야 합니다.'],
    ['game_event_ip_mismatch', '같은 IP의 온라인 이벤트만 선택할 수 있습니다.'],
    ['game_catalog_locked', '플레이 이력이 있어 ID·카드풀·이벤트·설정을 변경할 수 없습니다.'],
    ['game_variant_read_only', '굿즈 보상형 게임은 #115에서 운영합니다.'],
    ['operation_conflict', '이미 처리된 저장 요청입니다. 화면을 새로고침한 뒤 다시 시도해주세요.'],
  ])('maps %s game RPC errors and preserves the failure boundary', async (rpcMessage, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: rpcMessage } });

    await expect(upsertAdminGameAction({}, gameForm())).resolves.toEqual({
      errors: { form: expected },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('maps a scheduled/already-ended end request without revalidation', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'game_not_active' } });

    await expect(endAdminGameAction({}, gameEndForm())).resolves.toEqual({
      errors: { form: '운영 중인 게임만 지금 종료할 수 있습니다.' },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('validates reward-policy target truth before the RPC without revalidation', async () => {
    const formData = rewardPolicyForm();
    formData.set('targetIpId', 'missing');
    formData.set('minAmount', '-1');

    await expect(upsertAdminRewardPolicyAction({}, formData)).resolves.toEqual({
      errors: {
        targetIpId: '등록된 IP를 선택해주세요.',
        targetGoodId: '선택한 IP의 굿즈만 지정할 수 있습니다.',
        minAmount: '최소 결제 금액은 0 이상의 정수여야 합니다.',
      },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('blocks non-staff reward-policy writes before catalog loading or RPC access', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'user-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(upsertAdminRewardPolicyAction({}, rewardPolicyForm())).resolves.toEqual({
      errors: { form: '관리자 권한이 필요합니다.' },
    });
    expect(mocks.getCatalogSnapshot).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['auth_required', '로그인이 필요합니다.'],
    ['forbidden', '관리자 권한이 필요합니다.'],
    ['invalid_operation_id', '유효한 저장 요청이 아닙니다. 화면을 새로고침한 뒤 다시 시도해주세요.'],
    ['invalid_reward_policy_id', '발급 정책 정보를 확인해주세요.'],
    ['invalid_reward_trigger', '지원하지 않는 발급 조건입니다.'],
    ['invalid_min_amount', '최소 결제 금액을 확인해주세요.'],
    ['invalid_tickets_per_grant', '발급 수량은 1~100 사이여야 합니다.'],
    ['invalid_reward_policy_active', '활성화 설정을 확인해주세요.'],
    ['invalid_reward_policy_active_from', '운영 시작 일시를 확인해주세요.'],
    ['invalid_reward_policy_active_window', '운영 종료는 시작보다 뒤여야 합니다.'],
    ['ip_not_found', '연결할 IP를 찾을 수 없습니다.'],
    ['good_not_found', '연결할 굿즈를 찾을 수 없습니다.'],
    ['reward_policy_good_ip_mismatch', '선택한 IP의 굿즈만 지정할 수 있습니다.'],
    ['pool_not_found', '카드풀을 찾을 수 없습니다.'],
    ['reward_pool_not_ready', '확률과 카드 구성이 완료된 운영 가능한 카드풀을 선택해주세요.'],
    ['reward_policy_pool_window_disjoint', '정책과 카드풀 운영 기간이 겹쳐야 합니다.'],
    ['reward_policy_pool_locked', '이미 발급 이력이 있어 카드풀을 변경할 수 없습니다.'],
    ['operation_conflict', '이미 처리된 저장 요청입니다. 화면을 새로고침한 뒤 다시 시도해주세요.'],
  ])('maps %s reward-policy RPC errors without leaking SQL', async (rpcMessage, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: rpcMessage } });
    const formData = rewardPolicyForm();

    await expect(upsertAdminRewardPolicyAction({}, formData)).resolves.toEqual({
      errors: { form: expected },
    });
    expect(formData.get('operationId')).toBe('44444444-4444-4444-8444-444444444444');
    expect(formData.get('id')).toBe('55555555-5555-4555-8555-555555555555');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects an invalid pool odds total before calling the RPC', async () => {
    const formData = poolOddsForm();
    formData.set('oddsR', '69');

    await expect(setAdminPoolOddsAction({}, formData)).resolves.toEqual({
      errors: { oddsTotal: '확률 합계는 100%여야 합니다.' },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['pool_ip_locked', '연결된 발급 정책·게임·카드팩·발급 이력이 있어 카드풀 IP를 변경할 수 없습니다.'],
    ['invalid_pool_active_window', '운영 종료는 시작보다 뒤여야 합니다.'],
    ['active_reward_policy_window_conflict', '활성 발급 정책과 운영 기간이 겹치지 않습니다. 먼저 정책을 비활성화해주세요.'],
    ['game_pool_window_conflict', '카드풀 운영 기간은 연결된 게임 운영 기간 전체를 포함해야 합니다.'],
    ['operation_conflict', '이미 처리된 저장 요청입니다. 화면을 새로고침한 뒤 다시 시도해주세요.'],
  ])('maps %s card-pool RPC errors without exposing internals', async (rpcMessage, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: rpcMessage } });

    await expect(upsertAdminCardPoolAction({}, cardPoolForm())).resolves.toEqual({
      errors: { form: expected },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['pool_rarity_uncovered', '양수 확률인 모든 등급에 소속 카드가 필요합니다.'],
    ['invalid_pool_probability', '각 확률과 합계가 올바른지 확인해주세요.'],
    ['invalid_probability_precision', '각 확률과 합계가 올바른지 확인해주세요.'],
    ['pool_odds_must_sum_to_one', '각 확률과 합계가 올바른지 확인해주세요.'],
    ['operation_conflict', '이미 처리된 저장 요청입니다. 화면을 새로고침한 뒤 다시 시도해주세요.'],
  ])('maps %s pool-odds RPC errors without exposing internals', async (rpcMessage, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: rpcMessage } });

    await expect(setAdminPoolOddsAction({}, poolOddsForm())).resolves.toEqual({
      errors: { form: expected },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['card_pool_ip_mismatch', '카드와 같은 IP의 카드풀만 연결할 수 있습니다.'],
    ['pool_rarity_uncovered', '현재 풀의 마지막 양수 확률 카드는 이동하거나 해제할 수 없습니다.'],
    ['pooled_card_catalog_contract_locked', '풀에 연결된 카드는 먼저 풀을 해제한 뒤 IP·등급을 변경해주세요.'],
  ])('maps %s card binding errors without exposing internals', async (rpcMessage, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: rpcMessage } });

    await expect(upsertAdminCardAction({}, cardForm())).resolves.toEqual({
      errors: { form: expected },
    });
  });

  it('saves a ticket session through the audited RPC and refreshes ticket surfaces', async () => {
    await expect(upsertAdminTicketTypeAction({}, ticketTypeForm())).resolves.toEqual({
      message: '티켓 회차를 저장했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_upsert_ticket_type', {
      target_operation_id: '11111111-1111-4111-8111-111111111111',
      target_ticket_type_id: '22222222-2222-4222-8222-222222222222',
      target_event_id: 'e100',
      target_name: '7월 25일 1회차',
      target_price: 25000,
      target_capacity: 80,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/events');
  });

  it('validates ticket sessions and blocks non-staff calls before the RPC', async () => {
    const invalid = ticketTypeForm();
    invalid.set('eventId', 'missing');
    invalid.set('capacity', '-1');

    await expect(upsertAdminTicketTypeAction({}, invalid)).resolves.toEqual({
      errors: {
        eventId: '등록된 이벤트를 선택해주세요.',
        capacity: '정원은 0 이상의 정수여야 합니다.',
      },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.adminState = {
      isConfigured: true,
      user: { id: 'user-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };
    await expect(upsertAdminTicketTypeAction({}, ticketTypeForm())).resolves.toEqual({
      errors: { form: '관리자 권한이 필요합니다.' },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['capacity_below_sold', '정원은 현재 할당 수량보다 작게 줄일 수 없습니다.'],
    ['ticket_type_catalog_locked', '예매 이력이 있는 회차는 이벤트·회차명·가격을 변경할 수 없습니다.'],
    ['event_not_found', '연결할 이벤트를 찾을 수 없습니다.'],
    ['operation_conflict', '이미 처리된 저장 요청입니다. 화면을 새로고침한 뒤 다시 시도해주세요.'],
  ])('maps %s ticket session RPC errors without exposing internals', async (rpcMessage, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: rpcMessage } });

    await expect(upsertAdminTicketTypeAction({}, ticketTypeForm())).resolves.toEqual({
      errors: { form: expected },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/events');
  });

  it('blocks non-staff moderation status updates without writing', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'user-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(updateCommunityReportStatusAction({}, reportStatusForm())).resolves.toEqual({
      errors: { form: '관리자 권한이 필요합니다.' },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('updates report status through the admin moderation RPC', async () => {
    await expect(updateCommunityReportStatusAction({}, reportStatusForm())).resolves.toEqual({
      message: '신고 상태를 저장했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_update_report_status', {
      target_report_id: reportId,
      target_status: 'reviewing',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/community');
  });

  it('hides a reported post through the admin moderation RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: { ipId: 'hwasan' }, error: null });

    await expect(hideCommunityPostAction({}, hidePostForm())).resolves.toEqual({
      message: '포스트를 숨김 처리했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_hide_community_post', {
      target_post_id: postId,
      target_report_id: reportId,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/community');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/search');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/ip/hwasan');
  });

  describe('setAdminUserRoleAction', () => {
    const targetProfileId = '66666666-6666-4666-8666-666666666666';

    function roleForm(role = 'staff') {
      const formData = new FormData();
      formData.set('profileId', targetProfileId);
      formData.set('role', role);
      return formData;
    }

    function asAdmin() {
      mocks.adminState = {
        isConfigured: true,
        user: { id: 'admin-1', email: 'admin@icons.gg' },
        role: 'admin',
        isStaff: true,
      };
    }

    it('blocks staff users — role management is admin-only', async () => {
      await expect(setAdminUserRoleAction({}, roleForm())).resolves.toEqual({
        errors: { form: '최고 관리자(admin) 권한이 필요합니다.' },
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('returns validation errors before calling the role RPC', async () => {
      asAdmin();
      const formData = roleForm('superadmin');
      formData.set('profileId', 'not-a-uuid');

      const result = await setAdminUserRoleAction({}, formData);

      expect(result.errors?.profileId).toBeTruthy();
      expect(result.errors?.role).toBeTruthy();
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('grants a role through the audited RPC and refreshes the admin screen', async () => {
      asAdmin();

      await expect(setAdminUserRoleAction({}, roleForm('staff'))).resolves.toEqual({
        message: '역할을 저장했습니다.',
      });

      expect(mocks.rpc).toHaveBeenCalledWith('admin_set_user_role', {
        target_profile_id: targetProfileId,
        target_role: 'staff',
      });
      expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin');
    });

    it('maps self-change rejection from the RPC to a Korean message', async () => {
      asAdmin();
      mocks.rpc.mockResolvedValue({ data: null, error: { message: 'cannot_change_own_role' } });

      await expect(setAdminUserRoleAction({}, roleForm('user'))).resolves.toEqual({
        errors: { form: '본인 역할은 변경할 수 없습니다.' },
      });
    });
  });
});
