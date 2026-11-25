import { beforeEach, expect, it, vi } from 'vitest';
import { changeOrderProductionAction, saveGoodsProductionAction } from './production-actions';
const m = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: m.rpc }) }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: m.auth }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
const id = (n: number) => `c7160805-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { actorId: id(1), sessionId: id(2) };
const policy = { goodId: 'made-a', revision: 1, enabled: true, leadDays: 5, dayBasis: 'calendar', closedDates: [], publicNote: 'TEST 안내', evidence: 'TEST 설정', updatedAt: '2026-10-16T00:00:00Z' };
/* 저장 값에는 설정 근거·확인 체크가 없다(2026-11-25 결정). 저장된 설정 문서(policy)의 evidence는 예전에 적은 값이 그대로 남은 것이다. */
const values = { enabled: true, leadDays: 5, dayBasis: 'calendar', closedDates: [], publicNote: 'TEST 안내' };
const change = () => changeOrderProductionAction(id(4), id(5), 'start', 1, id(3), 'TEST 실제 작업', identity);
beforeEach(() => { m.rpc.mockReset(); m.auth.mockReset().mockResolvedValue({ user: { id: id(1) } }); m.revalidate.mockReset(); });
it('계정 불일치와 잘못된 납기·휴무일은 쓰기 전에 차단한다', async () => {
 for (const bad of [{ leadDays: 0 }, { leadDays: 1.2 }, { closedDates: ['2026-02-31'], dayBasis: 'business' }, { closedDates: ['2026-10-20'] }])
  expect(await saveGoodsProductionAction('made-a', { ...values, ...bad }, 0, id(3), identity)).toMatchObject({ uncertain: false });
 m.auth.mockResolvedValue({ user: { id: id(9) } }); expect(await change()).toMatchObject({ uncertain: false }); expect(m.rpc).not.toHaveBeenCalled();
});
it('정책 재시도 영수증이 오래되어도 현재 설정을 다시 읽는다', async () => {
 m.rpc.mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ data: { ...policy, revision: 2, enabled: false } });
 expect(await saveGoodsProductionAction('made-a', values, 0, id(3), identity)).toEqual({ policy: { ...policy, revision: 2, enabled: false } });
});
it('설정 근거·확인 체크 없이 필요한 값만 저장 함수에 보낸다', async () => {
 m.rpc.mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ data: policy });
 expect(await saveGoodsProductionAction('made-a', values, 0, id(3), identity)).toEqual({ policy });
 expect(m.rpc).toHaveBeenNthCalledWith(1, 'admin_save_goods_production', { p_good: 'made-a', p_values: values, p_revision: 0, p_operation: id(3), p_actor: identity.actorId, p_session: identity.sessionId });
 /* 끈 설정(기간 없음)도 근거 없이 저장된다. */
 const off = { enabled: false, leadDays: null, dayBasis: 'calendar', closedDates: [], publicNote: '' };
 m.rpc.mockResolvedValueOnce({ data: { ...policy, ...off, revision: 2 } }).mockResolvedValueOnce({ data: { ...policy, ...off, revision: 2 } });
 expect(await saveGoodsProductionAction('made-a', off, 1, id(6), identity)).toMatchObject({ policy: { enabled: false, revision: 2 } });
 expect(m.rpc).toHaveBeenNthCalledWith(3, 'admin_save_goods_production', expect.objectContaining({ p_values: off }));
});
it('옛 모양(설정 근거·확인 체크)이나 모르는 칸이 섞인 저장 값은 쓰기 전에 돌려보내고, 안내는 근거를 말하지 않는다', async () => {
 for (const extra of [{ evidence: 'TEST 설정', confirmed: true }, { evidence: '' }, { note: 'x' }]) {
  const result = await saveGoodsProductionAction('made-a', { ...values, ...extra }, 0, id(3), identity);
  expect(result).toEqual({ error: '발송 예정 기간(1~365일)·기간 계산 기준·휴무일 날짜를 확인해주세요.', uncertain: false });
 }
 expect(m.rpc).not.toHaveBeenCalled();
});
it('저장 오류를 고칠 방법과 함께 알리고, 결과를 모르면 [저장됐는지 확인]으로 이끈다', async () => {
 const save = () => saveGoodsProductionAction('made-a', values, 0, id(3), identity);
 m.rpc.mockResolvedValueOnce({ error: { code: 'PT409', message: 'production_changed' } });
 expect(await save()).toEqual({ error: '다른 사람이 먼저 바꿨습니다. [현재 주문제작 설정 불러오기]를 눌러 지금 설정을 확인한 뒤 다시 저장해주세요.', uncertain: false });
 m.rpc.mockResolvedValueOnce({ error: { code: '23514', message: 'production_preorder_conflict' } });
 expect(await save()).toEqual({ error: '예약판매를 일반 재고 판매로 전환한 뒤 주문제작을 설정해주세요.', uncertain: false });
 m.rpc.mockResolvedValueOnce({ error: { code: '23514', message: 'digital_supply_conflict' } });
 expect(await save()).toEqual({ error: '디지털 파일을 제공하는 상품에는 주문 후 제작을 쓸 수 없습니다. 수령 방식을 먼저 바꿔주세요.', uncertain: false });
 m.rpc.mockResolvedValueOnce({ error: { code: '22023', message: 'invalid_parameter_value' } });
 expect(await save()).toEqual({ error: '발송 예정 기간(1~365일)·기간 계산 기준·휴무일 날짜를 확인해주세요.', uncertain: false });
 const unsure = { error: '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.', uncertain: true };
 m.rpc.mockResolvedValueOnce({ error: { code: 'network' } });
 expect(await save()).toEqual(unsure);
 m.rpc.mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ error: { code: 'network' } });
 expect(await save()).toEqual(unsure);
 m.rpc.mockRejectedValueOnce(new Error('offline'));
 expect(await save()).toEqual(unsure);
 expect(m.revalidate).not.toHaveBeenCalled();
});
it('제작 영수증의 주문 연결이 다르면 결과 확인 필요로 남긴다', async () => {
 m.rpc.mockResolvedValue({ data: { orderId: id(8), jobId: id(5) } });
 expect(await change()).toMatchObject({ uncertain: true }); expect(m.revalidate).not.toHaveBeenCalled();
});
it('저장 후 조회 실패와 확정 CAS 충돌을 구분한다', async () => {
 m.rpc.mockResolvedValueOnce({ data: { orderId: id(4), jobId: id(5) } }).mockResolvedValueOnce({ error: { code: 'network' } });
 expect(await change()).toMatchObject({ uncertain: true });
 m.rpc.mockResolvedValue({ error: { code: 'PT409', message: 'production_changed' } }); expect(await change()).toMatchObject({ uncertain: false });
});
it('현재 제작 현황을 확인한 뒤 고객·출고 화면을 갱신한다', async () => {
 const document = { orderId: id(4), cancelReviewRequired: true, canCancel: true, jobs: [] };
 m.rpc.mockResolvedValueOnce({ data: { orderId: id(4), jobId: id(5) } }).mockResolvedValueOnce({ data: document });
 expect(await change()).toEqual({ document });
 expect(m.rpc).toHaveBeenNthCalledWith(1, 'admin_change_order_production', expect.objectContaining({ p_actor: identity.actorId, p_session: identity.sessionId, p_revision: 1, p_operation: id(3) }));
 expect(m.revalidate).toHaveBeenCalledWith(`/orders/${id(4)}`);
});
