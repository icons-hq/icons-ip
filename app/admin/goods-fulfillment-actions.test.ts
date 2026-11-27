import { beforeEach, expect, it, vi } from 'vitest';
import { saveGoodsFulfillmentAction } from './goods-fulfillment-actions';

/* 상품의 수령 방식 저장 액션. 2026-11-25 결정: 저장 = 적용 — 설정 근거·확인 체크 없이 필요한 값만 받아 저장한다. */
const m = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: m.rpc }) }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: m.auth }));
vi.mock('@/lib/admin/revalidate-goods.server', () => ({ revalidateGoodDetailSurfaces: vi.fn() }));
vi.mock('@/lib/admin/digital-assets.server', () => ({ prepareDigitalAsset: vi.fn(), verifyDigitalAsset: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));

const id = (n: number) => `c7160850-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { actorId: id(1), sessionId: id(2) };
const parcel = { method: 'parcel', feeAmount: null, feeBasis: 'per_order', installationFee: 0 };
const quick = { method: 'quick', feeAmount: 3000, feeBasis: 'per_order', installationFee: 0 };
const values = { mode: 'shipping', methods: [parcel, quick], files: [], publicNote: 'TEST 퀵 가능' };
/* 저장된 설정 문서의 evidence는 예전에 적은 값이 그대로 남은 것이다(DB가 지우지 않는다). */
const settings = { goodId: 'good-a', revision: 1, mode: 'shipping', methods: [parcel, quick], files: [], publicNote: 'TEST 퀵 가능', evidence: '', updatedAt: '2026-11-25T00:00:00Z' };
const save = (input: unknown = values, revision = 0) => saveGoodsFulfillmentAction('good-a', input, revision, id(3), identity);
beforeEach(() => { m.rpc.mockReset(); m.auth.mockReset().mockResolvedValue({ user: { id: id(1) } }); m.revalidate.mockReset(); });

it('설정 근거·확인 체크 없이 필요한 값만 저장 함수에 보내고, 저장 뒤 지금 설정을 다시 읽어 돌려준다', async () => {
  m.rpc.mockResolvedValueOnce({ data: settings }).mockResolvedValueOnce({ data: { ...settings, revision: 2 } });
  expect(await save()).toEqual({ settings: { ...settings, revision: 2 } });
  expect(m.rpc).toHaveBeenNthCalledWith(1, 'admin_save_goods_fulfillment', {
    p_good: 'good-a', p_values: { mode: 'shipping', methods: [parcel, quick], assetIds: [], publicNote: 'TEST 퀵 가능' },
    p_revision: 0, p_operation: id(3), p_actor: identity.actorId, p_session: identity.sessionId,
  });
  expect(m.rpc).toHaveBeenNthCalledWith(2, 'admin_get_goods_fulfillment', { p_good: 'good-a' });
  for (const path of ['/admin/catalog/goods', '/cart', '/checkout']) expect(m.revalidate).toHaveBeenCalledWith(path);
});

it('디지털 파일은 파일 번호만 보낸다', async () => {
  const file = { id: id(7), name: '구매파일.txt', mimeType: 'text/plain', size: 32 };
  const digital = { mode: 'digital', methods: [{ method: 'digital', feeAmount: 0, feeBasis: 'per_order', installationFee: 0 }], files: [file], publicNote: '' };
  const saved = { ...settings, ...digital };
  m.rpc.mockResolvedValueOnce({ data: saved }).mockResolvedValueOnce({ data: saved });
  expect(await save(digital)).toEqual({ settings: saved });
  expect(m.rpc).toHaveBeenNthCalledWith(1, 'admin_save_goods_fulfillment', expect.objectContaining({ p_values: { mode: 'digital', methods: digital.methods, assetIds: [id(7)], publicNote: '' } }));
});

it('옛 모양(설정 근거·확인 체크)이나 맞지 않는 값은 쓰기 전에 돌려보내고, 안내는 근거를 말하지 않는다', async () => {
  for (const bad of [{ ...values, evidence: 'TEST 근거', confirmed: true }, { ...values, evidence: '' }, { ...values, methods: [] },
    { ...values, methods: [{ ...quick, feeAmount: -1 }] }, { ...values, mode: 'digital' }, { mode: 'shipping', methods: [parcel], files: [] }]) {
    expect(await save(bad)).toEqual({ error: '수령 방식·비용·디지털 파일을 확인해주세요.', uncertain: false });
  }
  expect(m.rpc).not.toHaveBeenCalled();
});

it('로그인한 계정이 다르면 저장하지 않는다', async () => {
  m.auth.mockResolvedValue({ user: { id: id(9) } });
  expect(await save()).toEqual({ error: '현재 계정과 로그인 상태로 처리할 수 없습니다.', uncertain: false });
  m.auth.mockResolvedValue(null);
  expect(await save()).toMatchObject({ uncertain: false });
  expect(m.rpc).not.toHaveBeenCalled();
});

it('저장 오류를 고칠 방법과 함께 알리고, 결과를 모르면 [저장됐는지 확인]으로 이끈다', async () => {
  m.rpc.mockResolvedValueOnce({ error: { code: 'PT409', message: 'fulfillment_changed' } });
  expect(await save()).toEqual({ error: '다른 사람이 먼저 바꿨습니다. [현재 수령 방식 불러오기]를 눌러 지금 수령 방식을 확인한 뒤 다시 저장해주세요.', uncertain: false });
  m.rpc.mockResolvedValueOnce({ error: { code: '23514', message: 'digital_asset_unavailable' } });
  expect(await save()).toEqual({ error: '파일 확인이 끝나지 않았거나 사용할 수 없는 파일입니다.', uncertain: false });
  m.rpc.mockResolvedValueOnce({ error: { code: '22023', message: 'invalid_parameter_value' } });
  expect(await save()).toEqual({ error: '수령 방식·비용·디지털 파일을 확인해주세요.', uncertain: false });
  const unsure = { error: '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.', uncertain: true };
  m.rpc.mockResolvedValueOnce({ error: { code: 'network' } });
  expect(await save()).toEqual(unsure);
  m.rpc.mockResolvedValueOnce({ data: settings }).mockResolvedValueOnce({ error: { code: 'network' } });
  expect(await save()).toEqual(unsure);
  m.rpc.mockResolvedValueOnce({ data: { ...settings, goodId: 'other' } });
  expect(await save()).toEqual(unsure);
  m.rpc.mockRejectedValueOnce(new Error('offline'));
  expect(await save()).toEqual(unsure);
  expect(m.revalidate).not.toHaveBeenCalled();
});
