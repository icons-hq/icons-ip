import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), load: vi.fn(), refresh: vi.fn(), replace: vi.fn(), close: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: () => {},
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }));
vi.mock('@/app/admin/claim-hold-actions', () => ({ changeClaimHoldAction: mocks.save, readClaimHoldAction: mocks.read, loadClaimHoldContextAction: mocks.load }));
const busy = vi.hoisted(() => vi.fn());
vi.mock('@/components/admin/screens/ClaimPreviewDialog', () => ({ useClaimPreviewBusy: busy }));
import { ClaimHoldControl, ClaimHoldPanel } from './ClaimHoldControl';
import { holdContext, holdReceipt as receipt } from '@/lib/orders/claim-hold.fixture';
import { CLAIM_HOLD_NOTE_ERROR } from '@/lib/orders/claim-hold';
import { adminClaimStageLabel } from '@/lib/admin/claims';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; value?: string; type?: string; id?: string; htmlFor?: string; maxLength?: number; minLength?: number; required?: boolean;
  onClick?: () => void; onSubmit?: (event: unknown) => void; onChange?: (event: unknown) => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
let context = structuredClone(holdContext);
function render() { hooks.index = 0; hooks.refIndex = 0; return ClaimHoldPanel({ initial: context, onClose: mocks.close }); }
/* 이름표(label htmlFor)가 가리키는 같은 id의 칸을 찾는다. */
function field(label: string) {
  const elements = all(render()); const target = elements.find(element => element.type === 'label' && text(element).startsWith(label))?.props.htmlFor;
  const found = elements.find(element => target && element.props.id === target); if (!found) throw new Error(label); return found;
}
function change(label: string, value: string) { field(label).props.onChange?.({ target: { value } }); }
async function settle() { for (let n = 0; n < 20; n++) await Promise.resolve(); }
async function click(label: string) { const button = all(render()).find(element => element.type === 'button' && text(element) === label); if (!button) throw new Error(label); button.props.onClick?.(); await settle(); }
async function submit() { all(render()).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); await settle(); }
const fieldsetDisabled = () => all(render()).find(element => element.type === 'fieldset')?.props.disabled;
/* 확인창에 뜬 요청 전체(제목·본문·버튼 이름)를 받아 둔다. */
function captureConfirm(answer: boolean) {
  const requests: AdminConfirmRequest[] = []; const restore = setAdminConfirmHandler(async request => { requests.push(request); return answer; });
  return { requests, restore };
}
let confirm = captureConfirm(true);
beforeEach(() => { context = structuredClone(holdContext); hooks.state = []; hooks.refs = []; vi.clearAllMocks(); mocks.read.mockResolvedValue({ receipt: null }); confirm = captureConfirm(true); });
afterEach(() => { confirm.restore(); });

it('응답 소실 뒤 읽기 없음·권한 오류에도 최초 operation과 본문을 고정하고, 다시 저장할 때는 묻지 않는다', async () => {
  mocks.save.mockResolvedValueOnce({ error: 'response lost', uncertain: true }).mockResolvedValueOnce({ error: '권한 변경', uncertain: false });
  change('보류 사유', receipt.note!); await submit();
  const original = structuredClone(mocks.save.mock.calls[0][0]);
  expect(confirm.requests).toHaveLength(1); expect(original).toMatchObject({ decision: 'hold', note: receipt.note, confirmed: true });
  await click('저장됐는지 확인'); expect(text(render())).toContain('아직 저장된 내용이 없습니다');
  change('보류 사유', '늦게 도착한 다른 입력을 전달합니다');
  await click('같은 내용으로 다시 저장'); expect(mocks.save.mock.calls[1][0]).toEqual(original); expect(confirm.requests).toHaveLength(1);
  expect(fieldsetDisabled()).toBe(true);
  await click('닫기'); expect(mocks.close).not.toHaveBeenCalled();
  mocks.read.mockResolvedValue({ receipt: { ...receipt, id: original.id } }); await click('저장됐는지 확인');
  expect(mocks.refresh).toHaveBeenCalledOnce(); await click('닫기'); expect(mocks.close).toHaveBeenCalledOnce();
});
it('유형 전환 충돌을 읽으면 이전 보류 입력을 버리고 새 유형으로 안내한다', async () => {
  mocks.save.mockResolvedValue({ error: '다른 사람이 먼저 바꿨습니다.', conflict: true });
  change('보류 사유', receipt.note!); await submit();
  expect(text(render())).toContain('다른 사람이 먼저 바꿨습니다.'); expect(all(render()).some(element => element.type === 'button' && text(element) === '최신 상태 불러오기')).toBe(true);
  mocks.load.mockResolvedValue({ context: { ...context, claimType: 'exchange', revision: 3 } });
  await click('최신 상태 불러오기');
  expect(field('보류 사유').props.value).toBe('');
  expect(mocks.replace).toHaveBeenCalledWith(`/admin/sales/claims/exchanges/${context.claimId}`);
  expect(text(render())).toContain('요청 유형이나 로그인 계정이 바뀌어 적은 내용을 지웠습니다');
});
it('같은 유형의 상태 충돌은 본문을 보존하고, 다시 누르면 확인창을 새로 묻는다', async () => {
  mocks.save.mockResolvedValue({ error: '다른 사람이 먼저 바꿨습니다.', conflict: true });
  change('보류 사유', receipt.note!); await submit();
  mocks.load.mockResolvedValue({ context: { ...context, stage: 'collected', revision: 4 } }); await click('최신 상태 불러오기');
  expect(field('보류 사유').props.value).toBe(receipt.note); expect(text(render())).toContain('[보류하기]를 다시 눌러 주세요');
  await submit(); expect(confirm.requests).toHaveLength(2); expect(mocks.save.mock.calls[1][0]).toMatchObject({ revision: 4, note: receipt.note });
});
it('연속 제출을 막고 다른 주문의 receipt를 성공으로 표시하지 않는다', async () => {
  let finish!: (value: unknown) => void; mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  change('보류 사유', receipt.note!);
  const form = all(render()).find(element => element.type === 'form')!;
  form.props.onSubmit?.({ preventDefault: () => {} }); form.props.onSubmit?.({ preventDefault: () => {} }); await settle();
  expect(confirm.requests).toHaveLength(1); expect(mocks.save).toHaveBeenCalledOnce();
  finish({ receipt: { ...receipt, id: mocks.save.mock.calls[0][0].id, orderId: receipt.claimId } }); await settle();
  expect(text(render())).toContain('맞지 않습니다'); expect(mocks.refresh).not.toHaveBeenCalled();
});

/* 확인 체크 칸이 없다. 대신 누르면 확인창이 한 번 뜬다(고객 앱 알림이 가고 처리가 멈춘다). */
it('보류 칸에는 확인 체크가 없고 사유가 필수이며 어디에 보이는지와 글자 수를 말한다', () => {
  const tree = all(render()); const html = text(render());
  expect(tree.some(element => element.type === 'input' && element.props.type === 'checkbox')).toBe(false);
  expect(html).not.toContain('확인했습니다'); expect(html).not.toContain('확정'); expect(html).not.toContain('주문 전체의 요청을 처리합니다');
  expect(html).toContain('보류 사유 (필수)'); expect(html).toContain('10~200자 · 지금 0자'); expect(html).toContain('고객 앱 알림에 담겨 가고, 요청 상세의 ‘보류 사유’에 남습니다.');
  const note = field('보류 사유'); expect(note.props).toMatchObject({ minLength: 10, maxLength: 200, required: true });
  expect(tree.find(element => element.type === 'button' && element.props.type === 'submit')?.props.disabled).toBe(false);
  expect(text(tree.find(element => element.type === 'button' && element.props.type === 'submit'))).toBe('보류하기');
  change('보류 사유', receipt.note!); expect(text(render())).toContain(`10~200자 · 지금 ${receipt.note!.length}자`);
});
it('보류하기를 누르면 고객에게 가는 사유와 멈추는 일을 확인창으로 한 번 묻는다', async () => {
  mocks.save.mockImplementation(async request => ({ receipt: { ...receipt, id: request.id } }));
  change('보류 사유', receipt.note!); await submit();
  expect(confirm.requests).toHaveLength(1);
  const [request] = confirm.requests;
  expect(request).toMatchObject({ title: '반품 보류 설정', confirmLabel: '보류하기', cancelLabel: '돌아가기' });
  expect(request.message).toContain('반품 요청을 보류합니다.'); expect(request.message).toContain(adminClaimStageLabel('return', 'collecting'));
  expect(request.message).toContain(`고객에게 보일 보류 사유: ${receipt.note}`); expect(request.message).toContain('앱 알림이 고객에게 바로 갑니다');
  expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(text(render())).toContain('보류했습니다. 고객에게 앱 알림을 남겼습니다.');
});
it('확인창에서 돌아가면 저장하지 않고 적은 사유를 그대로 둔다', async () => {
  confirm.restore(); confirm = captureConfirm(false);
  change('보류 사유', receipt.note!); await submit();
  expect(confirm.requests).toHaveLength(1); expect(mocks.save).not.toHaveBeenCalled();
  expect(field('보류 사유').props.value).toBe(receipt.note); expect(fieldsetDisabled()).toBe(false);
});
it('사유가 규칙에 맞지 않으면 확인창을 띄우지 않고 글자 수를 말한다', async () => {
  change('보류 사유', '짧음'); await submit();
  expect(confirm.requests).toHaveLength(0); expect(mocks.save).not.toHaveBeenCalled();
  expect(all(render()).find(element => element.props && (element.props as { role?: string }).role === 'alert')).toBeDefined();
  expect(text(render())).toContain(CLAIM_HOLD_NOTE_ERROR);
});
it('DB가 거절한 오류는 입력을 그대로 두고 다시 누를 수 있다', async () => {
  mocks.save.mockResolvedValueOnce({ error: '이미 보류 중입니다. 창을 닫고 지금 상태를 다시 확인해 주세요.' });
  change('보류 사유', receipt.note!); await submit();
  expect(text(render())).toContain('이미 보류 중입니다.'); expect(fieldsetDisabled()).toBe(false);
  expect(field('보류 사유').props.value).toBe(receipt.note);
  expect(all(render()).some(element => element.type === 'button' && text(element) === '저장됐는지 확인')).toBe(false);
});
it('보류를 풀 때는 입력 칸 없이 돌아가는 단계를 보이고, 확인창이 알림을 말한다', async () => {
  context = { ...structuredClone(holdContext), stage: 'on_hold', heldFrom: 'collecting', holdReason: '기존 보류 사유를 확인합니다', canHold: false, canResume: true };
  const html = text(render());
  expect(html).toContain('반품 보류 해제'); expect(html).toContain('기존 보류 사유: 기존 보류 사유를 확인합니다');
  expect(html).toContain(`보류 전 단계(${adminClaimStageLabel('return', 'collecting')})로 돌아갑니다. 환불·재출고는 돌아간 단계에서 따로 처리합니다.`);
  expect(all(render()).some(element => element.type === 'input')).toBe(false);
  expect(text(all(render()).find(element => element.type === 'button' && element.props.type === 'submit'))).toBe('보류 풀기');
  mocks.save.mockImplementation(async request => ({ receipt: { ...receipt, id: request.id, decision: 'resume', note: null, fromStage: 'on_hold', stage: 'collecting' } }));
  await submit();
  expect(confirm.requests[0]).toMatchObject({ title: '반품 보류 해제', confirmLabel: '보류 풀기', cancelLabel: '돌아가기' });
  expect(confirm.requests[0].message).toContain('앱 알림이 갑니다');
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ decision: 'resume', note: null, confirmed: true });
  expect(text(render())).toContain('보류를 풀었습니다. 고객에게 앱 알림을 남겼습니다.');
});

/* m27 G4-5: 목록 위 클레임 팝업(R8) 안에서 보류 처리를 기다리는 동안 팝업이 Esc·×로 닫히지 않게 알린다. */
it('보류 저장과 요청 확인을 기다리는 동안 팝업에 처리 중을 알린다', async () => {
  let finish!: (value: unknown) => void; mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(); expect(busy).toHaveBeenLastCalledWith(false);
  change('보류 사유', receipt.note!);
  all(render()).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); await settle();
  render(); expect(busy).toHaveBeenLastCalledWith(true);
  finish({ error: '다른 사람이 먼저 바꿨습니다.', conflict: true }); await settle();
  render(); expect(busy).toHaveBeenLastCalledWith(false);

  hooks.state = []; hooks.refs = []; busy.mockClear();
  let loaded!: (value: unknown) => void; mocks.load.mockImplementationOnce(() => new Promise(resolve => { loaded = resolve; }));
  const entry = () => { hooks.index = 0; hooks.refIndex = 0; return ClaimHoldControl({ claimId: context.claimId, claimType: context.claimType, held: false }); };
  all(entry()).find(element => element.type === 'button')!.props.onClick?.();
  entry(); expect(busy).toHaveBeenLastCalledWith(true);
  loaded({ error: '읽기 실패' }); await settle();
  entry(); expect(busy).toHaveBeenLastCalledWith(false);
});
it('진입 버튼은 옛 이름 그대로 보류 설정·보류 해제다(처리 칸과 가이드가 같은 이름을 쓴다)', () => {
  const entry = (held: boolean) => { hooks.state = []; hooks.refs = []; hooks.index = 0; hooks.refIndex = 0; return text(ClaimHoldControl({ claimId: context.claimId, claimType: 'exchange', held })); };
  expect(entry(false)).toBe('교환 보류 설정'); expect(entry(true)).toBe('교환 보류 해제');
});
