import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), load: vi.fn(), refresh: vi.fn(), close: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: () => {}, useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; } }));
/* 목록 위 주문 상세 팝업의 대기 신호(useClaimPreviewBusy)는 실제 렌더러 없이 부르는 이 시험에서 아무 일도 하지 않는다. */
vi.mock('@/components/orders/claim-preview-busy', () => ({ useClaimPreviewBusy: () => {} }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/order-address-actions', () => ({ changeOrderAddressAction: mocks.save, readOrderAddressChangeAction: mocks.read, loadOrderAddressContextAction: mocks.load }));
import { OrderAddressEditor } from './OrderAddressEditor';
import { orderAddressContextFixture as baseContext } from '@/lib/admin/order-address.fixture';
import type { OrderAddressContext } from '@/lib/admin/order-address';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; type?: string; busy?: boolean; title?: string; onClose?: () => void; onClick?: () => void; onSubmit?: (event: unknown) => void; onChange?: (event: unknown) => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
/* 팝업은 kit 버튼·입력(ADR-0028)을 쓴다 — 렌더 전 요소 트리에서는 그 부품 자체가 요소 종류다. */
const isButton = (e: Element) => e.type === 'button' || e.type === Button;
const isInput = (e: Element) => e.type === 'input' || e.type === Input;
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
let context: OrderAddressContext = baseContext;
function render() { hooks.index = 0; hooks.refIndex = 0; return OrderAddressEditor({ initial: context, onClose: mocks.close }); }
function change(label: string, value: string) { const parent = all(render()).find(e => e.type === 'label' && text(e).startsWith(label)); const input = all(parent).find(isInput); if (!input) throw new Error(label); input.props.onChange?.({ target: { value } }); }
/* 확인창을 지나 서버 액션까지 가므로 약속이 여러 번 이어진다. */
async function settle() { for (let n = 0; n < 24; n++) await Promise.resolve(); }
async function click(label: string) { const button = all(render()).find(e => isButton(e) && text(e) === label); if (!button) throw new Error(label); button.props.onClick?.(); await settle(); }
async function submit() { all(render()).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); await settle(); }
/* 확인창에 뜬 요청을 그대로 모으고, 운영자의 답은 answer로 정한다. */
const requests: AdminConfirmRequest[] = []; let answer = true; let restore = () => {};
beforeEach(() => {
  hooks.state = []; hooks.refs = []; vi.resetAllMocks(); mocks.read.mockResolvedValue({ receipt: null });
  context = baseContext; requests.length = 0; answer = true;
  restore = setAdminConfirmHandler(async request => { requests.push(request); return answer; });
});
afterEach(() => restore());
const ORIGINAL_NAME = baseContext.address.recipientName;
const NOTICE = '결제금액과 배송비는 그대로입니다.';
it('미확정 응답과 readback 없음 이후에도 첫 본문을 고정하고 동일 요청만 재시도한다', async () => {
  mocks.save.mockRejectedValue(new Error('response lost'));
  change('수령인', '최초 변경 이름'); change('변경 사유', '고객 전화 확인'); await submit();
  const original = structuredClone(mocks.save.mock.calls[0][0]);
  /* 확인 체크는 없앴다 — DB가 요구하는 고객 동의 값은 화면이 늘 true로 보낸다. */
  expect(original.agreed).toBe(true);
  await click('저장됐는지 확인');
  expect(all(render()).find(e => e.type === 'fieldset')?.props.disabled).toBe(true); expect((render() as Element).props.busy).toBe(true);
  change('수령인', '지연된 다른 입력'); await click('같은 내용으로 다시 저장'); expect(mocks.save.mock.calls[1][0]).toEqual(original);
  /* 같은 요청을 다시 보낼 때는 이미 확인한 내용이라 확인창을 다시 띄우지 않는다. */
  expect(requests).toHaveLength(1);
  (render() as Element).props.onClose?.(); expect(mocks.close).not.toHaveBeenCalled();
  mocks.read.mockResolvedValue({ receipt: { ...original, changedAt: '2026-10-13T10:00:00Z', currentMatches: true } });
  await click('저장됐는지 확인'); expect(text(render())).toContain('배송지를 바꿨습니다.'); expect(mocks.refresh).toHaveBeenCalledOnce();
});
it('저장됐는지 모를 때의 말은 다른 어드민 화면과 같은 버튼 이름과 문장을 쓴다', async () => {
  mocks.save.mockRejectedValue(new Error('response lost'));
  change('수령인', '변경 이름'); change('변경 사유', '전화'); await submit();
  expect(text(render())).toContain('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');
  expect(text(render())).not.toContain('같은 요청');
  mocks.read.mockResolvedValue({ receipt: null }); await click('저장됐는지 확인');
  expect(text(render())).toContain('아직 저장된 내용이 없습니다.'); expect(text(render())).toContain('[같은 내용으로 다시 저장]');
});
it('다른 사람이 먼저 바꾸면 입력을 보존하고, 최신 배송지를 불러온 뒤 그 배송지와 비교하는 확인창으로 다시 저장한다', async () => {
  mocks.save.mockResolvedValue({ error: '다른 사람이 먼저 바꿨습니다.', conflict: true, uncertain: false });
  change('수령인', '보존할 이름'); change('변경 사유', '상담 기록'); await submit();
  expect(requests[0].message).toContain(`수령인: ${ORIGINAL_NAME} → 보존할 이름`);
  expect(text(render())).toContain('최신 배송지 불러오기');
  mocks.load.mockResolvedValue({ context: { ...baseContext, revision: 4, address: { ...baseContext.address, recipientName: '다른 사람이 저장한 이름' } } });
  await click('최신 배송지 불러오기');
  expect(text(render())).toContain('다른 사람이 저장한 이름');
  /* 고객 동의 체크가 없어서 다시 받을 것이 없다 — 그 자리에서 저장할 수 있다. */
  expect(all(render()).find(e => isButton(e) && text(e) === '저장')?.props.disabled).toBe(false);
  mocks.save.mockResolvedValue({ error: '확인 중', uncertain: true }); await submit();
  expect(mocks.save.mock.calls[1][0]).toMatchObject({ revision: 4, address: { recipientName: '보존할 이름' } });
  expect(requests[1].message).toContain('수령인: 다른 사람이 저장한 이름 → 보존할 이름');
});
it('미확정 첫 요청 이후 재시도의 확정 오류도 원요청의 고정을 풀지 않는다', async () => {
  mocks.save.mockResolvedValueOnce({ error: '첫 응답 유실', uncertain: true }).mockResolvedValueOnce({ error: '나중 시점에서 차단', uncertain: false, conflict: true });
  change('수령인', '고정한 고객'); change('변경 사유', '확인 근거'); await submit();
  await click('같은 내용으로 다시 저장');
  expect(all(render()).find(e => e.type === 'fieldset')?.props.disabled).toBe(true);
  expect((render() as Element).props.busy).toBe(true); expect(text(render())).toContain('저장됐는지 확인');
});
it('다시 렌더되기 전 연속 제출도 확인창 하나, 요청 하나만 보낸다', async () => {
  let finish!: (value: unknown) => void; mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  change('수령인', '연속 제출 고객'); change('변경 사유', '확인 근거');
  const form = all(render()).find(e => e.type === 'form')!; const event = { preventDefault: () => {} };
  form.props.onSubmit?.(event); form.props.onSubmit?.(event); await settle();
  expect(requests).toHaveLength(1); expect(mocks.save).toHaveBeenCalledTimes(1);
  finish({ error: '응답 불명확', uncertain: true }); await settle();
});
it('저장 전 확인창이 어느 주문의 배송지를 무엇에서 무엇으로 바꾸는지와 돈이 그대로인 것을 말하고, 돌아가면 아무것도 저장하지 않는다', async () => {
  context = { ...baseContext, orderNumber: '20261126140010000034' };
  answer = false;
  change('수령인', '새 수령인'); change('연락처', '01099998888'); change('배송 메모', '문 앞에 두세요'); change('변경 사유', '11/26 고객 전화'); await submit();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ title: '배송지를 바꿀까요?', confirmLabel: '배송지 바꾸기', cancelLabel: '돌아가기' });
  expect(requests[0].message).toBe([
    '주문 20261126140010000034의 배송지를 바꿉니다. 배송 건 2개 모두에 적용됩니다.', '',
    `수령인: ${ORIGINAL_NAME} → 새 수령인`, '연락처: 01000000000 → 01099998888', '배송 메모: 없음 → 문 앞에 두세요', '',
    `구매자가 요청한 변경으로 기록됩니다. ${NOTICE}`,
  ].join('\n'));
  expect(mocks.save).not.toHaveBeenCalled();
  /* 돌아가도 적은 내용은 그대로이고 다시 저장할 수 있다. */
  expect(all(render()).find(e => isButton(e) && text(e) === '저장')?.props.disabled).toBe(false);
  answer = true; await submit(); expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ reason: '11/26 고객 전화', agreed: true, address: { recipientName: '새 수령인', phone: '01099998888', deliveryNote: '문 앞에 두세요' } });
});
it('선물 주문은 받는 분의 요청으로 기록된다고 확인창이 말하고, 주소가 바뀌면 주소를 한 줄로 비교한다', async () => {
  context = { ...baseContext, isGift: true };
  change('우편번호', '54321'); change('상세 주소', '202호'); change('변경 사유', '받는 분 요청'); await submit();
  expect(requests[0].message).toContain('이 주문의 배송지를 바꿉니다.');
  expect(requests[0].message).toContain('주소: (12345) 합성시 검증로 1 101호 → (54321) 합성시 검증로 1 202호');
  expect(requests[0].message).toContain(`선물 받는 분이 요청한 변경으로 기록됩니다. ${NOTICE}`);
});
it('바뀐 내용이 없으면 확인창도 서버 호출도 없이 이유를 알린다', async () => {
  change('변경 사유', '그대로 저장해 보기'); await submit();
  expect(requests).toHaveLength(0); expect(mocks.save).not.toHaveBeenCalled();
  expect(text(render())).toContain('바뀐 내용이 없습니다. 고칠 칸을 고친 뒤 저장해 주세요.');
});
it('고객 동의 확인 체크는 없고, 변경 사유 칸이 필수이며 어디에 남는지를 말한다', () => {
  const tree = all(render());
  expect(tree.some(e => e.type === 'input' || (e.props as { type?: string }).type === 'checkbox')).toBe(false);
  const reason = tree.find(e => e.type === 'label' && text(e).startsWith('변경 사유'));
  expect(text(reason)).toBe('변경 사유 (필수)');
  expect(text(render())).toContain('배송지 변경 이력에만 남고 고객에게는 보이지 않습니다.');
  /* 돈이 걸린 한 줄만 늘 보이고, 흐름 설명 글은 없다. */
  expect(text(render())).toContain('배송비가 달라지는 주소로는 바꿀 수 없습니다.');
  expect(text(render())).not.toContain('출고지시 전달·발송 전 주문만');
  expect(text(render())).not.toContain('수령자'); expect(text(render())).toContain('수령인');
  expect((render() as Element).props.title).toBe('배송지 수정');
});
it('바꿀 수 없는 주문은 입력 칸 없이 이유와 변경 이력만 보이고 제목이 배송지 변경 이력이다', () => {
  const entry = { id: 'abcd1234-0000-7000-8000-000000000003', changedAt: '2026-10-13T10:00:00Z', actorName: '수민', before: baseContext.address, after: { ...baseContext.address, recipientName: '이전 변경' }, reason: '고객 전화' };
  for (const [blocker, reason] of [
    ['order_not_ready', '신규주문이나 발주확인 상태의 주문만 배송지를 바꿀 수 있습니다.'],
    ['order_dispatched', '출고지시를 이미 보냈거나 발송한 기록이 있어 배송지를 바꿀 수 없습니다.'],
    ['order_claim_open', '진행 중인 취소·반품·교환 요청이 있어 배송지를 바꿀 수 없습니다. 요청을 먼저 처리해 주세요.'],
    ['something_new', '지금은 배송지를 바꿀 수 없습니다.'],
  ] as const) {
    hooks.state = []; hooks.refs = [];
    context = { ...baseContext, allowed: false, blocker, history: [entry] };
    const element = render() as Element;
    expect(element.props.title).toBe('배송지 변경 이력');
    expect(all(element).some(e => e.type === 'form')).toBe(false);
    expect(text(element)).toContain(reason); expect(text(element)).not.toContain(blocker);
    expect(text(element)).toContain('최근 변경 이력 1건'); expect(text(element)).toContain('변경 후: 이전 변경');
    expect(all(element).some(e => isButton(e) && text(e) === '닫기')).toBe(true);
  }
  hooks.state = []; hooks.refs = []; context = { ...baseContext, allowed: false, blocker: 'order_dispatched' };
  expect(text(render())).toContain('바꾼 이력이 없습니다.');
});
it('적은 내용이 있으면 닫기 전에 사라진다고 묻고, 적은 것이 없으면 바로 닫는다', async () => {
  (render() as Element).props.onClose?.(); await settle();
  expect(mocks.close).toHaveBeenCalledOnce(); expect(requests).toHaveLength(0);
  mocks.close.mockClear();
  change('변경 사유', '적던 내용'); answer = false;
  (render() as Element).props.onClose?.(); await settle();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ title: '적은 내용을 저장하지 않고 닫을까요?', message: '지금 적은 내용이 사라집니다.', confirmLabel: '저장하지 않고 닫기', cancelLabel: '돌아가기' });
  expect(mocks.close).not.toHaveBeenCalled();
  /* 돌아가면 적은 내용이 그대로 있고, 닫기로 답하면 닫힌다. */
  expect(text(render())).toContain('변경 사유 (필수)');
  answer = true; (render() as Element).props.onClose?.(); await settle();
  expect(mocks.close).toHaveBeenCalledOnce();
});
it('입력칸만 바꿔도 적은 내용으로 보고, 원래 값으로 되돌리면 묻지 않는다', async () => {
  change('수령인', '바꾼 이름'); answer = false;
  all(render()).find(e => isButton(e) && text(e) === '닫기')!.props.onClick?.(); await settle();
  expect(requests).toHaveLength(1); expect(mocks.close).not.toHaveBeenCalled();
  change('수령인', ORIGINAL_NAME);
  all(render()).find(e => isButton(e) && text(e) === '닫기')!.props.onClick?.(); await settle();
  expect(requests).toHaveLength(1); expect(mocks.close).toHaveBeenCalledOnce();
});
/* QA-O 고칠 것 4: 배송비 기준 기록이 없는 주문(퀵·방문수령이거나 옛 주문)은 우편번호·기본 주소를 바꿀 수 없다 — 두 칸을 미리 잠그고 이유를 보인다. */
it('우편번호·기본 주소를 바꿀 수 없는 주문은 두 칸을 잠그고 이유를 말한다. 나머지 칸은 열려 있다', () => {
  const inputOf = (label: string) => all(all(render()).find(e => e.type === 'label' && text(e).startsWith(label))).find(isInput)!;
  expect(inputOf('우편번호').props.disabled).toBe(false); expect(inputOf('기본 주소').props.disabled).toBe(false);
  expect(text(render())).toContain('배송비가 달라지는 주소로는 바꿀 수 없습니다.');
  /* 창을 새로 연 것처럼 상태를 비우고 잠긴 주문으로 다시 연다. */
  hooks.state = []; hooks.refs = []; context = { ...baseContext, destinationLocked: true };
  expect(inputOf('우편번호').props.disabled).toBe(true); expect(inputOf('기본 주소').props.disabled).toBe(true);
  for (const label of ['수령인', '연락처', '상세 주소', '배송 메모']) expect(inputOf(label).props.disabled, label).toBe(false);
  expect(text(render())).toContain('배송비 기준을 확인할 수 없는 주문(퀵·방문수령이거나 옛 주문)이라 우편번호·기본 주소는 바꿀 수 없습니다. 수령인·연락처·상세 주소·배송 메모는 바꿀 수 있습니다.');
  expect(text(render())).not.toContain('배송비가 달라지는 주소로는 바꿀 수 없습니다.');
});
