import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), load: vi.fn(), refresh: vi.fn(), close: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: () => {}, useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/order-address-actions', () => ({ changeOrderAddressAction: mocks.save, readOrderAddressChangeAction: mocks.read, loadOrderAddressContextAction: mocks.load }));
import { OrderAddressEditor } from './OrderAddressEditor';
import { orderAddressContextFixture as context } from '@/lib/admin/order-address.fixture';
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; type?: string; busy?: boolean; onClose?: () => void; onClick?: () => void; onSubmit?: (event: unknown) => void; onChange?: (event: unknown) => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
function render() { hooks.index = 0; hooks.refIndex = 0; return OrderAddressEditor({ initial: context, onClose: mocks.close }); }
function change(label: string, value: string | boolean) { const parent = all(render()).find(e => e.type === 'label' && text(e).startsWith(label)); const input = all(parent).find(e => e.type === 'input'); if (!input) throw new Error(label); input.props.onChange?.({ target: { value, checked: value } }); }
async function settle() { for (let n = 0; n < 8; n++) await Promise.resolve(); }
async function click(label: string) { const button = all(render()).find(e => e.type === 'button' && text(e) === label); if (!button) throw new Error(label); button.props.onClick?.(); await settle(); }
async function submit() { all(render()).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); await settle(); }
beforeEach(() => { hooks.state = []; hooks.refs = []; vi.clearAllMocks(); mocks.read.mockResolvedValue({ receipt: null }); });
it('미확정 응답과 readback 없음 이후에도 첫 본문을 고정하고 동일 요청만 재시도한다', async () => {
  mocks.save.mockRejectedValue(new Error('response lost'));
  change('수령자', '최초 변경 이름'); change('고객 요청 확인 근거', '고객 전화 확인'); change('고객이 위 주문', true); await submit();
  const original = structuredClone(mocks.save.mock.calls[0][0]); await click('같은 요청의 저장 결과 확인');
  expect(all(render()).find(e => e.type === 'fieldset')?.props.disabled).toBe(true); expect((render() as Element).props.busy).toBe(true);
  change('수령자', '지연된 다른 입력'); await click('같은 내용으로 다시 저장'); expect(mocks.save.mock.calls[1][0]).toEqual(original);
  (render() as Element).props.onClose?.(); expect(mocks.close).not.toHaveBeenCalled();
  mocks.read.mockResolvedValue({ receipt: { ...original, changedAt: '2026-10-13T10:00:00Z', currentMatches: true } });
  await click('같은 요청의 저장 결과 확인'); expect(text(render())).toContain('배송 정보를 저장했습니다.'); expect(mocks.refresh).toHaveBeenCalledOnce();
});
it('다른 담당자의 저장과 충돌하면 입력을 보존하고 최신 주소와 동의를 다시 비교한다', async () => {
  mocks.save.mockResolvedValue({ error: '다른 담당자의 변경', conflict: true, uncertain: false });
  change('수령자', '보존할 이름'); change('고객 요청 확인 근거', '상담 기록'); change('고객이 위 주문', true); await submit();
  mocks.load.mockResolvedValue({ context: { ...context, revision: 4, address: { ...context.address, recipientName: '다른 담당자가 저장한 이름' } } });
  await click('최신 배송지와 비교');
  expect(text(render())).toContain('다른 담당자가 저장한 이름'); expect(all(render()).find(e => e.type === 'button' && text(e) === '주문 전체 배송지 변경')?.props.disabled).toBe(true);
  change('고객이 위 주문', true); mocks.save.mockResolvedValue({ error: '확인 중', uncertain: true }); await submit();
  expect(mocks.save.mock.calls[1][0]).toMatchObject({ revision: 4, address: { recipientName: '보존할 이름' } });
});
it('미확정 첫 요청 이후 재시도의 확정 오류도 원요청의 고정을 풀지 않는다', async () => {
  mocks.save.mockResolvedValueOnce({ error: '첫 응답 유실', uncertain: true }).mockResolvedValueOnce({ error: '나중 시점에서 차단', uncertain: false, conflict: true });
  change('수령자', '고정한 고객'); change('고객 요청 확인 근거', '확인 근거'); change('고객이 위 주문', true); await submit();
  await click('같은 내용으로 다시 저장');
  expect(all(render()).find(e => e.type === 'fieldset')?.props.disabled).toBe(true);
  expect((render() as Element).props.busy).toBe(true); expect(text(render())).toContain('같은 요청의 저장 결과 확인');
});
it('다시 렌더되기 전 연속 제출도 요청 하나만 전송한다', async () => {
  let finish!: (value: unknown) => void; mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  change('수령자', '연속 제출 고객'); change('고객 요청 확인 근거', '확인 근거'); change('고객이 위 주문', true);
  const form = all(render()).find(e => e.type === 'form')!; const event = { preventDefault: () => {} };
  form.props.onSubmit?.(event); form.props.onSubmit?.(event); expect(mocks.save).toHaveBeenCalledTimes(1);
  finish({ error: '응답 불명확', uncertain: true }); await settle();
});
