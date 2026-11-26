import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), load: vi.fn(), refresh: vi.fn(), close: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: () => {}, useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
/* 운영자 화면은 철회 이력을 읽기만 한다 — 대신 철회하거나 그 결과를 읽는 액션은 이 부품이 부르지 않는다(모킹에 없는 이름을 쓰면 시험이 깨진다). */
vi.mock('@/app/admin/claim-withdrawal-actions', () => ({ loadAdminClaimWithdrawalAction: mocks.load }));
const busy = vi.hoisted(() => vi.fn());
vi.mock('@/components/orders/claim-preview-busy', () => ({ useClaimPreviewBusy: busy }));
import { ClaimWithdrawal, ClaimWithdrawalPanel } from './ClaimWithdrawal';
import { withdrawalContextFixture as context, withdrawalReceiptFixture } from '@/lib/orders/claim-withdrawal.fixture';
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; type?: string; placeholder?: string; 'aria-label'?: string; onClick?: () => void; onSubmit?: (event: unknown) => void; onChange?: (event: unknown) => void }>;
/* 구매자가 직접 철회한 기록. 구매자 화면은 /api/orders/claims/{id}/withdrawal 을 부른다. */
const receipt = { ...withdrawalReceiptFixture, actorKind: 'customer' as const };
const API = `/api/orders/claims/${context.claimId}/withdrawal`;
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
/* 함수 부품(구매자 양식·운영자 이력)은 불러서 펼친다. 훅 순번은 한 번의 렌더 안에서 이어진다. */
function all(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!isValidElement(node)) return [];
  if (typeof node.type === 'function') return all((node.type as (props: unknown) => ReactNode)(node.props));
  return [node as Element, ...all((node.props as { children?: ReactNode }).children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'string') return node;
  if (!isValidElement(node)) return '';
  if (typeof node.type === 'function') return text((node.type as (props: unknown) => ReactNode)(node.props));
  return text((node.props as { children?: ReactNode }).children);
}
let root: () => ReactNode = () => null;
function render() { hooks.index = 0; hooks.refIndex = 0; return root(); }
const panel = () => ClaimWithdrawalPanel({ initial: context, onClose: mocks.close });
const entry = (stage: Parameters<typeof ClaimWithdrawal>[0]['stage'], operator?: boolean) => () => ClaimWithdrawal({ claimId: context.claimId, stage, ...(operator ? { operator } : {}) });
function change(label: string, value: string | boolean) { const parent = all(render()).find(e => e.type === 'label' && text(e).startsWith(label)); const input = all(parent).find(e => e.type === 'input'); if (!input) throw new Error(label); input.props.onChange?.({ target: { value, checked: value } }); }
async function settle() { for (let n = 0; n < 12; n++) await Promise.resolve(); }
async function click(label: string) { const button = all(render()).find(e => e.type === 'button' && text(e) === label); if (!button) throw new Error(label); button.props.onClick?.(); await settle(); }
async function submit() { all(render()).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); await settle(); }
const posted = (call: number) => JSON.parse(mocks.fetch.mock.calls[call][1].body as string);
beforeEach(() => { hooks.state = []; hooks.refs = []; root = panel; vi.clearAllMocks(); vi.stubGlobal('fetch', mocks.fetch); mocks.fetch.mockResolvedValue(response({ receipt: null })); });

it('구매자 화면의 글자는 그대로다: 제목·안내·사유 칸·동의 체크·확정 버튼', () => {
 const tree = render(); const labels = all(tree).filter(e => e.type === 'label').map(e => text(e));
 expect(all(tree).find(e => e.type === 'section')?.props['aria-label']).toBe('반품 요청 철회');
 expect(text(all(tree).find(e => e.type === 'h3'))).toBe('반품 요청 철회');
 expect(text(tree)).toContain('철회하면 반품 처리를 종료합니다. 주문과 결제금액은 유지되며, 다시 신청할 때는 현재 주문 상태와 신청 기한을 확인합니다.');
 expect(labels).toEqual(['철회 사유', '요청 철회에 동의하며, 반송 중인 상품이 없습니다.']);
 expect(all(tree).find(e => e.type === 'input' && e.props.type !== 'checkbox')?.props.placeholder).toBe('요청을 철회하는 사유를 적어주세요.');
 expect(all(tree).filter(e => e.type === 'button').map(e => text(e))).toEqual(['반품 요청 철회 확정', '닫기']);
 /* 운영자 대리 철회 양식의 말은 없다. */
 for (const gone of ['고객 동의 확인', '고객과 철회에 합의', '상담 참조번호']) expect(JSON.stringify(all(tree).map(e => [text(e), e.props.placeholder]))).not.toContain(gone);
});
it('미확정 전송·readback 없음·후속 확정오류에도 첫 요청을 고정한다', async () => {
 mocks.fetch.mockResolvedValueOnce(response({ error: 'response lost', uncertain: true }, false));
 change('철회 사유', receipt.reason); change('요청 철회에 동의', true); await submit();
 expect(mocks.fetch.mock.calls[0][0]).toBe(API); expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ method: 'POST' });
 const original = posted(0); expect(original).toMatchObject({ claimId: context.claimId, revision: context.revision, reason: receipt.reason, confirmed: true });
 await click('같은 요청 결과 확인'); expect(mocks.fetch.mock.calls[1]).toEqual([`${API}?operation=${original.id}`, { cache: 'no-store' }]);
 mocks.fetch.mockResolvedValueOnce(response({ error: '권한 변경', uncertain: false }, false));
 change('철회 사유', '늦게 들어온 본문'); await click('같은 내용으로 재시도'); expect(posted(2)).toEqual(original);
 expect(all(render()).find(e => e.type === 'fieldset')?.props.disabled).toBe(true); await click('닫기'); expect(mocks.close).not.toHaveBeenCalled();
 mocks.fetch.mockResolvedValue(response({ receipt: { ...receipt, id: original.id } })); await click('같은 요청 결과 확인'); expect(text(render())).toContain('반품 요청이 철회됐습니다.'); expect(text(render())).toContain('고객 직접 신청');
 expect(mocks.refresh).toHaveBeenCalledOnce(); await click('닫기'); expect(mocks.close).toHaveBeenCalledOnce();
 expect(mocks.load).not.toHaveBeenCalled();
});
it('동시 처리 충돌은 사유를 보존하고 최신 문맥과 새 동의를 요구한다', async () => {
 mocks.fetch.mockResolvedValueOnce(response({ error: '다른 처리', conflict: true }, false)); change('철회 사유', '보존할 사유'); change('요청 철회에 동의', true); await submit();
 mocks.fetch.mockResolvedValueOnce(response({ context: { ...context, revision: 4 } })); await click('최신 요청 상태 확인');
 expect(mocks.fetch.mock.calls[1]).toEqual([API, { cache: 'no-store' }]);
 expect(all(render()).find(e => e.type === 'button' && text(e) === '반품 요청 철회 확정')?.props.disabled).toBe(true);
 mocks.fetch.mockResolvedValueOnce(response({ receipt: null })); change('요청 철회에 동의', true); await submit(); expect(posted(2)).toMatchObject({ revision: 4, reason: '보존할 사유' });
});
it('같은 렌더의 연속 제출을 한 번으로 제한하고 다른 주문·운영자 기록 receipt를 거절한다', async () => {
 let finish!: (value: unknown) => void; mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 change('철회 사유', receipt.reason); change('요청 철회에 동의', true); const form = all(render()).find(e => e.type === 'form')!;
 form.props.onSubmit?.({ preventDefault: () => {} }); form.props.onSubmit?.({ preventDefault: () => {} }); expect(mocks.fetch).toHaveBeenCalledOnce();
 finish(response({ receipt: { ...receipt, id: posted(0).id, orderId: receipt.claimId } })); await settle();
 expect(text(render())).toContain('현재 요청과 다른 결과'); expect(mocks.refresh).not.toHaveBeenCalled();
 /* 구매자가 보낸 철회의 결과는 구매자 기록이어야 한다. */
 hooks.state = []; hooks.refs = []; change('철회 사유', receipt.reason); change('요청 철회에 동의', true);
 mocks.fetch.mockImplementationOnce(async (_url: string, init: { body: string }) => response({ receipt: { ...receipt, id: JSON.parse(init.body).id, actorKind: 'operator' } })); await submit();
 expect(text(render())).toContain('현재 요청과 다른 결과'); expect(mocks.refresh).not.toHaveBeenCalled();
});
it('운영자 화면에는 철회 버튼 없이 철회된 요청의 이력만 열고, 구매자는 직접 철회한다(R7)', () => {
 for (const stage of ['requested', 'in_review', 'collecting', 'on_hold'] as const) { root = entry(stage, true); expect(render()).toBeNull(); root = entry(stage); expect(text(render())).toBe('요청 철회하기'); }
 root = entry('withdrawn', true); expect(text(render())).toBe('요청 철회 이력');
 root = entry('withdrawn'); expect(text(render())).toBe('요청 철회 이력');
 for (const stage of ['collected', 'processing', 'completed', 'rejected'] as const) { root = entry(stage); expect(render()).toBeNull(); root = entry(stage, true); expect(render()).toBeNull(); }
});
it('운영자의 철회 이력은 읽기 전용이다: 저장된 기록만 보이고 사유 칸·동의 체크·철회 버튼이 없다', async () => {
 const withdrawn = { ...context, stage: 'withdrawn' as const, allowed: false, blocker: 'claim_already_withdrawn', withdrawal: { actorKind: 'customer' as const, reason: '고객이 적은 철회 사유', createdAt: receipt.createdAt } };
 root = entry('withdrawn', true); mocks.load.mockResolvedValueOnce({ context: withdrawn }); await click('요청 철회 이력');
 expect(mocks.load).toHaveBeenCalledWith(context.claimId); expect(mocks.fetch).not.toHaveBeenCalled();
 const tree = render();
 expect(all(tree).find(e => e.type === 'section')?.props['aria-label']).toBe('반품 요청 철회 이력');
 expect(text(all(tree).find(e => e.type === 'h3'))).toBe('반품 요청 철회 이력');
 for (const shown of ['반품 요청이 철회됐습니다.', '고객 직접 신청', '고객이 적은 철회 사유']) expect(text(tree)).toContain(shown);
 expect(all(tree).some(e => ['form', 'input', 'fieldset', 'label'].includes(e.type as string))).toBe(false);
 expect(all(tree).filter(e => e.type === 'button').map(e => text(e))).toEqual(['닫기']);
 /* 구매자에게 하는 안내(철회하면 처리를 종료…)는 이력 화면에 없다. */
 expect(text(tree)).not.toContain('철회하면');
 await click('닫기'); expect(text(render())).toBe('요청 철회 이력');
 /* 예전에 담당자가 대신 기록한 철회도 누가 했는지 그대로 보인다. */
 mocks.load.mockResolvedValueOnce({ context: { ...withdrawn, withdrawal: { ...withdrawn.withdrawal, actorKind: 'operator' as const } } }); await click('요청 철회 이력');
 expect(text(render())).toContain('담당자 대리 기록');
 /* 이력을 못 읽으면 버튼 아래에 알리고 다시 누를 수 있다. */
 hooks.state = []; hooks.refs = []; mocks.load.mockRejectedValueOnce(new Error('network')); await click('요청 철회 이력');
 expect(text(render())).toContain('철회 이력을 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
});
it('구매자가 연 철회 창은 구매자 양식이고, 운영자용 조회를 부르지 않는다', async () => {
 root = entry('requested'); mocks.fetch.mockResolvedValueOnce(response({ context })); await click('요청 철회하기');
 expect(mocks.fetch).toHaveBeenCalledWith(API, { cache: 'no-store' }); expect(mocks.load).not.toHaveBeenCalled();
 expect(all(render()).some(e => e.type === 'form')).toBe(true); expect(text(render())).toContain('반품 요청 철회 확정');
});
/* m27 G4-5: 목록 위 클레임 팝업(R8) 안에서 이력 확인을 기다리는 동안 팝업이 닫히지 않게 알린다.
   구매자 화면처럼 팝업 밖에서는 훅이 아무 일도 하지 않는다(ClaimPreviewDialog 테스트). */
it('철회 저장과 이력 확인을 기다리는 동안 팝업에 처리 중을 알린다', async () => {
 let finish!: (value: unknown) => void; mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 render(); expect(busy).toHaveBeenLastCalledWith(false);
 change('철회 사유', receipt.reason); change('요청 철회에 동의', true);
 all(render()).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} });
 render(); expect(busy).toHaveBeenLastCalledWith(true);
 finish(response({ error: '다른 처리', conflict: true }, false)); await settle();
 render(); expect(busy).toHaveBeenLastCalledWith(false);

 hooks.state = []; hooks.refs = []; busy.mockClear(); root = entry('withdrawn', true);
 let loaded!: (value: unknown) => void; mocks.load.mockImplementationOnce(() => new Promise(resolve => { loaded = resolve; }));
 all(render()).find(e => e.type === 'button')!.props.onClick?.();
 render(); expect(busy).toHaveBeenLastCalledWith(true);
 loaded({ error: '읽기 실패' }); await settle();
 render(); expect(busy).toHaveBeenLastCalledWith(false);
});
