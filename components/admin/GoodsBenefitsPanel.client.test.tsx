import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void | (() => void))[] }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
}));
/* 이탈 경고에 넘긴 값을 본다(경고 자체의 동작은 lib/admin/leave-guard.test.ts가 본다). */
const guard = vi.hoisted(() => ({ options: null as null | { dirty?: boolean; blocked?: boolean; message?: string } }));
vi.mock('./useAdminLeaveGuard', () => ({ useAdminLeaveGuard: (options: { dirty?: boolean; blocked?: boolean; message?: string }) => { guard.options = options; return { formRef: () => {}, dirty: Boolean(options.dirty) }; } }));
vi.mock('@/app/admin/goods-benefit-actions', () => ({ saveGoodsBenefitsAction: mocks.save, loadGoodsBenefitsAction: mocks.load, listGoodsEventTemplatesAction: vi.fn(), saveGoodsEventTemplateAction: vi.fn() }));
vi.mock('@/lib/media', () => ({ publicMediaUrl: (path: string) => { if (!path) throw new Error('Empty paths must not reach the configured media normalizer'); return `https://cdn.example/${path}`; } }));
import { GoodsBenefitFields, GoodsBenefitsPanel } from './GoodsBenefitsPanel';
import { ArtworkUploadField } from './ArtworkUploadField';
import { GoodsEventTemplatePicker } from './GoodsEventTemplatePicker';
import { SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { GoodsPhotoPicker } from './screens/GoodsPhotoLibraryScreen';
import type { GoodsEventTemplate } from '@/lib/goods-benefits';
const values = { eventText: '행사 안내', giftText: '사은품 설명', giftImagePaths: [] };
const snapshot = { ...values, goodId: 'good-1', goodName: '상품', revision: 1, updatedAt: '2026-10-13T14:00:00Z' };
type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onSubmit?: (event: { preventDefault: () => void }) => void; onChange?: (event: { target: { value: string } }) => void; disabled?: boolean; value?: string }>;
/* 입력 부품(GoodsBenefitFields — 등록 화면과 같이 쓴다)은 훅이 없는 함수라 그 자리에서 펼쳐 같은 입력을 찾는다. */
function children(node: ReactElement): ReactNode {
  return node.type === GoodsBenefitFields ? GoodsBenefitFields(node.props as Parameters<typeof GoodsBenefitFields>[0]) : (node.props as { children?: ReactNode }).children;
}
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all(children(node))] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text(children(node)) : typeof node === 'string' ? node : ''; }
function render() { hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; return GoodsBenefitsPanel({ goodId: 'good-1' }); }
function button(label: string) { const element = all(render()).find(item => item.type === 'button' && text(item) === label); if (!element) throw new Error(label); return element; }
function submit() { const form = all(render()).find(item => item.type === 'form'); if (!form) throw new Error('missing form'); form.props.onSubmit?.({ preventDefault: () => {} }); }
async function settle() { for (let i = 0; i < 18; i++) await Promise.resolve(); }
let confirm: ReturnType<typeof stubAdminConfirm>;
beforeEach(() => { vi.clearAllMocks(); hooks.state = [{ ...snapshot }, { ...values }]; hooks.refs = []; hooks.effects = []; confirm = stubAdminConfirm(true); });
afterEach(() => { confirm.restore(); });
const photoPath = (index: number) => `public-media/catalog/good/93800000-0000-4000-8000-00000000070${index}.webp`;
it('keeps an unknown write on one fixed request and blocks same-render double submission', async () => {
  let finish!: (value: unknown) => void;
  mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ ok: true, value: { ...snapshot, revision: 2 } });
  submit(); submit(); expect(mocks.save).toHaveBeenCalledOnce();
  finish({ ok: false, uncertain: true, error: '응답 불명' }); await settle();
  expect(all(render()).find(item => item.type === 'fieldset')?.props.disabled).toBe(true);
  /* 저장됐는지 모를 때의 문장과 버튼은 어느 화면에서나 같은 말이다(서버가 준 옛 문구를 그대로 보이지 않는다). */
  expect(text(render())).toContain(SAVE_UNKNOWN_MESSAGE); expect(text(render())).not.toContain('응답 불명');
  button('저장된 내용으로 다시 불러오기').props.onClick?.(); await settle(); expect(mocks.load).not.toHaveBeenCalled();
  button('저장됐는지 확인').props.onClick?.(); await settle();
  expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]); expect(hooks.state[0]).toMatchObject({ revision: 2 });
});
it('preserves losing edits after a confirmed conflict and requires an explicit fresh read', async () => {
  mocks.save.mockResolvedValue({ ok: false, conflict: true, error: '동시 변경' });
  submit(); await settle(); expect(hooks.state[1]).toEqual(values); expect(button('안내 저장').props.disabled).toBe(true);
  submit(); await settle(); expect(mocks.save).toHaveBeenCalledOnce();
  mocks.load.mockResolvedValue({ ok: true, value: { ...snapshot, eventText: '다른 담당자 저장', revision: 2 } });
  button('저장된 내용으로 다시 불러오기').props.onClick?.(); await settle();
  expect(hooks.state[1]).toMatchObject({ eventText: '다른 담당자 저장' }); expect(button('안내 저장').props.disabled).toBe(false);
});
it('never turns an unread record into an editable empty form', () => {
  hooks.state = [null, { eventText: '', giftText: '', giftImagePaths: [] }];
  expect(button('안내 저장').props.disabled).toBe(true); submit(); expect(mocks.save).not.toHaveBeenCalled();
});
it('keeps a later reload and save when the initial read resolves last', async () => {
  hooks.state = [];
  let initial!: (value: unknown) => void;
  const fresh = { ...snapshot, eventText: '다시 조회한 안내', revision: 2 };
  mocks.load.mockImplementationOnce(() => new Promise(resolve => { initial = resolve; })).mockResolvedValueOnce({ ok: true, value: fresh });
  mocks.save.mockResolvedValue({ ok: true, value: { ...fresh, eventText: '새로 저장한 안내', revision: 3 } });
  render(); hooks.effects[0]();
  button('저장된 내용으로 다시 불러오기').props.onClick?.(); await settle();
  all(render()).find(item => item.type === 'input' && item.props.value === fresh.eventText)?.props.onChange?.({ target: { value: '새로 저장한 안내' } });
  submit(); await settle();
  expect(mocks.save.mock.calls[0]).toEqual(['good-1', { ...values, eventText: '새로 저장한 안내' }, 2, expect.any(String)]);
  initial({ ok: true, value: snapshot }); await settle();
  expect(hooks.state[0]).toMatchObject({ eventText: '새로 저장한 안내', revision: 3 });
  expect(text(render())).toContain('사은품 안내와 이벤트 문구를 저장했습니다.');
});
it.each(['response', 'exception'])('ignores a late initial read %s error after a successful reload', async kind => {
  hooks.state = [];
  let resolveInitial!: (value: unknown) => void, rejectInitial!: (reason: Error) => void;
  mocks.load.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveInitial = resolve; rejectInitial = reject; }))
    .mockResolvedValueOnce({ ok: true, value: { ...snapshot, eventText: '최신 안내', revision: 2 } });
  render(); hooks.effects[0]();
  button('저장된 내용으로 다시 불러오기').props.onClick?.(); await settle();
  if (kind === 'exception') rejectInitial(new Error('late network error'));
  else resolveInitial({ ok: false, error: '늦은 조회 오류' });
  await settle();
  expect(hooks.state[0]).toMatchObject({ eventText: '최신 안내', revision: 2 });
  expect(text(render())).toContain('저장된 내용으로 다시 불러왔습니다.');
  expect(hooks.state[5]).toBe(false);
});

/*
 * G1(2026-11-25 리뷰, 화면 규칙 2·5): 사은품 이미지 1에 넣은 사진을 이미지 2에서 또 고를 수 있었고, 저장할 때에야 네 가지 원인을 한 문장으로 거절했다.
 * 다른 칸에 넣은 사진은 선택창에서 '선택됨'으로 막고, 저장 전 안내는 원인 하나만 말한다.
 */
it('사은품 사진 선택창은 다른 칸에 이미 넣은 사진을 선택됨으로 넘겨 다시 고르지 못하게 한다', () => {
  hooks.state[1] = { ...values, giftImagePaths: [photoPath(1), '', photoPath(3)] };
  const pickButtons = () => all(render()).filter(item => item.type === 'button' && text(item) === '사진 보관함에서 고르기');
  const picker = () => all(render()).find(item => item.type === GoodsPhotoPicker) as unknown as { props: { pickedPaths: string[]; onSelect: (photo: { imagePath: string }) => void; onClose: () => void } } | undefined;
  expect(picker()).toBeUndefined();
  /* 둘째 칸(빈 칸)을 고를 때: 첫째·셋째 칸의 사진은 고를 수 없다. */
  pickButtons()[1].props.onClick?.();
  expect(picker()!.props.pickedPaths).toEqual([photoPath(1), photoPath(3)]);
  picker()!.props.onSelect({ imagePath: photoPath(2) });
  expect((hooks.state[1] as typeof values).giftImagePaths).toEqual([photoPath(1), photoPath(2), photoPath(3)]);
  expect(picker()).toBeUndefined();
  /* 이미 사진이 있는 칸을 다른 사진으로 바꿀 때: 자기 칸의 사진은 막지 않는다(다시 골라도 같은 값이다). */
  pickButtons()[0].props.onClick?.();
  expect(picker()!.props.pickedPaths).toEqual([photoPath(2), photoPath(3)]);
});
/* 브라우저 확인 S16: 보관함에서 방금 고른 사진([안내 저장] 전)인데 사진 아래 글이 '현재 저장된 이미지'였다. */
it('사진 아래 글은 저장돼 있는 사진과 방금 고른 사진을 가려 말한다', () => {
  hooks.state = [{ ...snapshot, giftImagePaths: [photoPath(1)] }, { ...values, giftImagePaths: [photoPath(1), photoPath(2)] }];
  const notes = all(render()).filter(item => item.type === ArtworkUploadField).map(item => (item.props as { savedNote?: string }).savedNote);
  /* 첫 칸은 저장돼 있는 사진(부품의 기본 글 '현재 저장된 이미지'), 둘째 칸은 방금 고른 사진, 셋째 칸은 비어 있다. */
  expect(notes).toEqual([undefined, '고른 사진 · [안내 저장]을 눌러야 적용됩니다', undefined]);
});
it('저장하기 전에 무엇이 안 되는지 원인 하나만 말한다 — 같은 사진, 설명 없음', () => {
  hooks.state[1] = { ...values, giftImagePaths: [photoPath(1), photoPath(1)] };
  submit();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(text(render())).toContain('같은 사진이 두 칸에 들어 있습니다. 한 칸의 사진을 빼거나 다른 사진으로 바꿔 주세요.');
  expect(text(render())).not.toContain('100자');
  hooks.state[1] = { ...values, giftText: ' ', giftImagePaths: [photoPath(1)] };
  submit();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(all(render()).filter(item => (item.props as { role?: string }).role === 'alert').map(item => text(item))).toEqual(['사은품 사진을 넣었으면 사은품 설명도 적어 주세요.']);
});
/* G6: 적은 내용이 저장된 것과 다를 때만 묻는다. */
it('[저장된 내용으로 다시 불러오기]는 적은 내용이 저장된 것과 다를 때만 사라진다고 묻는다', async () => {
  mocks.load.mockResolvedValue({ ok: true, value: { ...snapshot, revision: 2 } });
  button('저장된 내용으로 다시 불러오기').props.onClick?.(); await settle();
  expect(confirm).not.toHaveBeenCalled(); expect(mocks.load).toHaveBeenCalledOnce();
  hooks.state[1] = { ...values, eventText: '고치던 문구' };
  confirm.restore(); confirm = stubAdminConfirm(false);
  button('저장된 내용으로 다시 불러오기').props.onClick?.(); await settle();
  expect(confirm).toHaveBeenCalledExactlyOnceWith('지금 적은 내용이 사라집니다.');
  expect(mocks.load).toHaveBeenCalledOnce(); expect(hooks.state[1]).toEqual({ ...values, eventText: '고치던 문구' });
});

/*
 * F6(2026-11-26 QA-B): 저장돼 있는 상품의 사은품·이벤트 안내는 따로 저장하는 영역이라, 고치고 [안내 저장]을 누르지 않은 채 떠나면
 * 묻지 않고 적은 것이 사라졌다. 고친 내용이 있으면 이탈 경고가 뜬다(같은 화면의 정기배송·배송비 규칙 패널과 같은 방식).
 */
it('고친 내용이 있으면 화면을 떠날 때 묻고, 저장된 그대로면 묻지 않는다', async () => {
  render();
  expect(guard.options).toEqual({ dirty: false, blocked: false, message: '사은품·이벤트 안내를 고친 뒤 [안내 저장]을 누르지 않았습니다. 이 화면을 떠나면 적은 내용이 사라집니다. 이동할까요?' });
  hooks.state[1] = { ...values, eventText: '고치던 문구' }; render();
  expect(guard.options?.dirty).toBe(true);
  /* 사진만 넣어도 고친 것이다. 빈 사진 칸은 고친 것이 아니다. */
  hooks.state[1] = { ...values, giftImagePaths: [photoPath(1)] }; render(); expect(guard.options?.dirty).toBe(true);
  hooks.state[1] = { ...values, giftImagePaths: ['', ''] }; render(); expect(guard.options?.dirty).toBe(false);
  /* 아직 읽지 못한 상품은 묻지 않는다. 저장됐는지 모르는 동안에는 묻는다. */
  hooks.state = [null, { eventText: '', giftText: '', giftImagePaths: [] }]; render(); expect(guard.options?.dirty).toBe(false);
  hooks.state = [{ ...snapshot }, { ...values }];
  mocks.save.mockResolvedValue({ ok: false, uncertain: true, error: '결과 불명' });
  submit(); await settle(); render();
  expect(guard.options).toMatchObject({ dirty: true, blocked: false });
});

it('이벤트 템플릿은 공용 선택창에서 고르고, 지금 적어 둔 문구를 선택창에 알려 바꾸기 전에 묻게 한다', () => {
  expect(all(render()).some(item => item.type === GoodsEventTemplatePicker)).toBe(false);
  button('이벤트 템플릿 고르기').props.onClick?.();
  const picker = all(render()).find(item => item.type === GoodsEventTemplatePicker) as unknown as { props: { current: string; onSelect: (template: GoodsEventTemplate) => void; onClose: () => void } };
  expect(picker.props.current).toBe('행사 안내');
  picker.props.onSelect({ id: '93800000-0000-4000-8000-000000000901', eventText: '연말 한정 증정', revision: 1, archived: false, createdAt: '2026-10-13T14:00:00Z' });
  picker.props.onClose();
  expect(hooks.state[1]).toEqual({ ...values, eventText: '연말 한정 증정' });
  expect(all(render()).some(item => item.type === GoodsEventTemplatePicker)).toBe(false);
});
