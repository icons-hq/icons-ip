import { isValidElement, type Context, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import type { GoodsNoticePreset } from '@/lib/admin/goods-notice-presets';

/*
 * 상품정보제공고시 템플릿 폼의 움직임: 삭제는 확인창을 지난 뒤에만 실행되고 결과가 목록 위에 남는다, 등록 팝업은 저장되면
 * 닫히며 결과를 목록 위로 넘긴다, 되읽기 한 줄은 지금 적힌 칸을 따라간다, 원산지는 상품등록과 같은 선택창으로 고른다.
 */
const hooks = vi.hoisted(() => ({
  state: [] as unknown[], stateIndex: 0,
  refs: [] as { current: unknown }[], refIndex: 0,
  effects: [] as (() => unknown)[],
  contexts: new Map<unknown, unknown>(),
  action: { state: {} as Record<string, unknown>, dispatch: vi.fn(), pending: false },
  transitions: [] as Promise<unknown>[],
  dialogClose: null as (() => void) | null,
}));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useActionState: () => [hooks.action.state, hooks.action.dispatch, hooks.action.pending],
  useCallback: (callback: unknown) => callback,
  useContext: (context: Context<unknown>) => (hooks.contexts.has(context) ? hooks.contexts.get(context) : (context as unknown as { _currentValue: unknown })._currentValue),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useId: () => 'form',
  useMemo: (create: () => unknown) => create(),
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hooks.state[index]) : next; }];
  },
  useTransition: () => [false, (run: () => unknown) => { hooks.transitions.push(Promise.resolve(run())); }],
}));
const actions = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn() }));
vi.mock('@/app/admin/goods-notice-preset-actions', () => ({ saveGoodsNoticePresetAction: actions.save, deleteGoodsNoticePresetAction: actions.remove }));
vi.mock('@/app/admin/good-notice-actions', () => ({ findGoodNoticePresets: vi.fn(), loadGoodNoticeOf: vi.fn() }));
vi.mock('@/components/admin/console/AdminCreateDialogButton', () => ({ useAdminCreateDialogBusy: vi.fn(), useAdminCreateDialogClose: () => hooks.dialogClose }));
vi.mock('@/components/admin/CountryNameFinder', () => ({ CountryNamePicker: () => null }));

import { AdminNotice } from '@/components/admin/console/AdminKit';
import { CountryNamePicker } from '@/components/admin/CountryNameFinder';
import { GoodReadback } from '@/components/admin/GoodEditorParts';
import { Button } from '@/components/admin/kit/ui/button';
import {
  GoodsNoticePresetFeedback, GoodsNoticePresetFeedbackLine, GoodsNoticePresetForm, NoticePresetOriginField, filledNoticeKeys,
} from './GoodsNoticePresetForm';

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function all(node: ReactNode): Element[] {
  return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node as Element).props.children)] : [];
}
const text = (node: ReactNode): string => (Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node as Element).props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function reset() { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effects = []; }

const PRESET: GoodsNoticePreset = {
  id: '00000000-0000-4000-8000-000000042401', name: '아크릴 키링', updatedAt: '2026-09-08T01:00:00Z', kcTemplate: null,
  notice: { maker: '아이콘스', origin: '대한민국', material: '아크릴', size: '', madeOn: '', asManager: '엑스스퀘어 고객센터', asContact: '02-000-0000' },
};
interface FeedbackValue { flash: { tone: string; text: string } | null; announce: (text: string) => void; remove: (preset: GoodsNoticePreset) => void; removing: boolean }
/** 결과·삭제를 든 부품을 그린다. 돌려준 Provider의 type이 곧 context다(React 19). */
function feedback() {
  reset();
  return GoodsNoticePresetFeedback({ children: null }) as ReactElement<{ value: FeedbackValue }>;
}

let confirm: ReturnType<typeof stubAdminConfirm> | undefined;
beforeEach(() => {
  hooks.state = []; hooks.refs = []; hooks.contexts.clear(); hooks.transitions = []; hooks.dialogClose = null;
  hooks.action = { state: {}, dispatch: vi.fn(), pending: false };
  actions.save.mockReset(); actions.remove.mockReset().mockResolvedValue({ attempt: 1, message: '템플릿을 삭제했습니다.' });
});
afterEach(() => { confirm?.restore(); confirm = undefined; });

describe('템플릿 삭제', () => {
  it('확인창이 이름과 남는 것·되돌릴 수 없음을 보이고, 취소하면 아무것도 지우지 않는다', async () => {
    confirm = stubAdminConfirm(false);
    feedback().props.value.remove(PRESET);
    await flush();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('삭제하면 되돌릴 수 없습니다. 이 템플릿으로 채운 상품의 내용은 그대로 남습니다.');
    expect(actions.remove).not.toHaveBeenCalled();
    expect(feedback().props.value.flash).toBeNull();
  });

  it('확인하면 확인 표시를 실어 삭제하고, 결과를 목록 위 한 줄에 남긴다', async () => {
    confirm = stubAdminConfirm(true);
    feedback().props.value.remove(PRESET);
    await flush();
    await Promise.all(hooks.transitions);
    const data = actions.remove.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(data)).toEqual({ id: PRESET.id, updatedAt: PRESET.updatedAt, confirmed: 'true' });
    expect(feedback().props.value.flash).toEqual({ tone: 'success', text: '‘아크릴 키링’ 템플릿을 삭제했습니다.' });
  });

  it('삭제하지 못했으면 이유를 목록 위에 보인다', async () => {
    confirm = stubAdminConfirm(true);
    actions.remove.mockResolvedValue({ attempt: 1, errors: { form: '다른 사람이 먼저 바꿨습니다. 새로고침해 최신 내용을 확인한 뒤 다시 삭제해 주세요.' } });
    feedback().props.value.remove(PRESET);
    await flush();
    await Promise.all(hooks.transitions);
    expect(feedback().props.value.flash).toEqual({ tone: 'danger', text: '다른 사람이 먼저 바꿨습니다. 새로고침해 최신 내용을 확인한 뒤 다시 삭제해 주세요.' });

    actions.remove.mockRejectedValue(new Error('network'));
    hooks.transitions = [];
    feedback().props.value.remove(PRESET);
    await flush();
    await Promise.all(hooks.transitions);
    expect(feedback().props.value.flash).toEqual({ tone: 'danger', text: '삭제됐는지 확인하지 못했습니다. 새로고침해 목록에서 확인해 주세요.' });
  });

  it('목록 위 한 줄은 결과가 있을 때만 상자를 그린다', () => {
    const context = feedback().type;
    hooks.contexts.set(context, { flash: null });
    expect(all(GoodsNoticePresetFeedbackLine()).some((node) => node.type === AdminNotice)).toBe(false);
    hooks.contexts.set(context, { flash: { tone: 'success', text: '‘아크릴 키링’ 템플릿을 등록했습니다.' } });
    const notice = all(GoodsNoticePresetFeedbackLine()).find((node) => node.type === AdminNotice)!;
    expect(notice.props.tone).toBe('success');
    expect(text(notice.props.children)).toBe('‘아크릴 키링’ 템플릿을 등록했습니다.');
  });

  it('수정 폼의 [삭제]는 폼 안 일반 버튼이고, 등록 폼에는 없다', () => {
    const context = feedback().type;
    const remove = vi.fn();
    hooks.contexts.set(context, { flash: null, announce: vi.fn(), remove, removing: false });
    reset();
    const deleteSlot = all(GoodsNoticePresetForm({ preset: PRESET })).find((node) => (node.props as { preset?: unknown }).preset === PRESET && typeof node.type === 'function')!;
    reset();
    const button = (deleteSlot.type as (props: { preset: GoodsNoticePreset }) => Element)({ preset: PRESET });
    expect(button.type).toBe(Button);
    expect(button.props.type).toBe('button');
    (button.props.onClick as () => void)();
    expect(remove).toHaveBeenCalledExactlyOnceWith(PRESET);
    reset();
    expect(all(GoodsNoticePresetForm({ inset: false })).some((node) => (node.props as { preset?: unknown }).preset !== undefined)).toBe(false);
  });
});

describe('등록 팝업과 수정 폼의 저장 결과', () => {
  it('등록 팝업은 저장되면 닫히고 결과를 목록 위 한 줄로 넘긴다', () => {
    const context = feedback().type;
    const announce = vi.fn(), close = vi.fn();
    hooks.contexts.set(context, { flash: null, announce, remove: vi.fn(), removing: false });
    hooks.dialogClose = close;
    hooks.action.state = { attempt: 1, message: '‘아크릴 키링’ 템플릿을 등록했습니다.' };
    reset();
    const tree = GoodsNoticePresetForm({ inset: false });
    for (const effect of hooks.effects) effect();
    expect(announce).toHaveBeenCalledExactlyOnceWith('‘아크릴 키링’ 템플릿을 등록했습니다.');
    expect(close).toHaveBeenCalledTimes(1);
    /* 팝업은 닫히므로 폼 안에는 결과를 다시 적지 않는다. */
    expect(all(tree).some((node) => node.props.role === 'status' && node.type === 'p')).toBe(false);
  });

  it('등록 팝업은 저장에 실패하면 닫히지 않는다', () => {
    const close = vi.fn();
    hooks.dialogClose = close;
    hooks.action.state = { attempt: 1, errors: { form: '고시 내용을 한 칸 이상 적어 주세요.' }, values: { name: '아크릴 키링' } };
    reset();
    const tree = GoodsNoticePresetForm({ inset: false });
    for (const effect of hooks.effects) effect();
    expect(close).not.toHaveBeenCalled();
    expect(all(tree).find((node) => node.props.role === 'alert' && node.type === 'p')?.props.children).toBe('고시 내용을 한 칸 이상 적어 주세요.');
  });

  it('목록 안 수정 폼은 그 자리에 결과를 보인다', () => {
    const context = feedback().type;
    const announce = vi.fn();
    hooks.contexts.set(context, { flash: null, announce, remove: vi.fn(), removing: false });
    hooks.action.state = { attempt: 1, message: '‘아크릴 키링’ 템플릿을 저장했습니다.' };
    reset();
    const tree = GoodsNoticePresetForm({ preset: PRESET });
    for (const effect of hooks.effects) effect();
    expect(announce).not.toHaveBeenCalled();
    expect(all(tree).find((node) => node.props.role === 'status' && node.type === 'p')?.props.children).toBe('‘아크릴 키링’ 템플릿을 저장했습니다.');
  });
});

describe('되읽기 한 줄', () => {
  const formWith = (values: Record<string, string>) => ({ elements: { namedItem: (name: string) => (name in values ? { value: values[name] } : null) } });
  const readback = (tree: ReactNode) => text(all(tree).find((node) => node.type === GoodReadback)!.props.children);

  it('폼에 글자가 적힌 고시 칸만 센다(공백만 있으면 빈 칸)', () => {
    expect(filledNoticeKeys(formWith({ noticeMaker: '아이콘스', noticeSize: '  ', noticeMadeOn: '', name: '이름은 세지 않는다' }))).toEqual(['maker']);
    expect(filledNoticeKeys(formWith({}))).toEqual([]);
  });

  it('저장된 값에서 시작해, 칸을 적거나 비우면 따라 바뀐다', () => {
    reset();
    const saved = GoodsNoticePresetForm({ preset: PRESET });
    expect(readback(saved)).toBe('상품에 가져오면 5개 칸이 이 내용으로 바뀝니다. 비운 칸(크기 · 중량, 제조연월)은 상품에 적어 둔 값 그대로입니다.');
    const form = all(saved).find((node) => node.type === 'form')!;
    (form.props.onInput as (event: unknown) => void)({ currentTarget: formWith({ noticeMaker: '아이콘스', noticeSize: '80mm' }) });
    reset();
    expect(readback(GoodsNoticePresetForm({ preset: PRESET }))).toBe('상품에 가져오면 2개 칸이 이 내용으로 바뀝니다. 비운 칸(원산지, 소재, 제조연월, A/S 책임자, A/S 연락처)은 상품에 적어 둔 값 그대로입니다.');
  });

  it('저장에 실패해 칸이 다시 그려지면 되돌려 받은 값으로 다시 읽는다', () => {
    reset();
    const form = all(GoodsNoticePresetForm({ inset: false })).find((node) => node.type === 'form')!;
    (form.props.onInput as (event: unknown) => void)({ currentTarget: formWith({ noticeMaker: '아이콘스' }) });
    hooks.action.state = { attempt: 1, errors: { name: '템플릿 이름을 80자 안으로 적어 주세요.' }, values: { noticeMaker: '아이콘스', noticeMaterial: '아크릴' } };
    reset();
    expect(readback(GoodsNoticePresetForm({ inset: false }))).toContain('2개 칸이 이 내용으로 바뀝니다.');
  });
});

describe('원산지 칸', () => {
  const props = { defaultValue: '', label: '원산지', placeholder: '대한민국', inputProps: { id: 'form-noticeOrigin', name: 'noticeOrigin', 'aria-invalid': false, 'aria-describedby': undefined } };
  function field(input: { value: string; matches: (selector: string) => boolean; dispatchEvent: (event: Event) => boolean }) {
    reset();
    const first = NoticePresetOriginField(props);
    hooks.refs[0].current = { querySelector: () => input };
    return first;
  }

  it('[원산지 고르기]는 상품등록과 같은 선택창을 열고, 고르면 칸에 넣은 뒤 폼에 알린다', () => {
    const input = { value: '중국산', matches: () => false, dispatchEvent: vi.fn<(event: Event) => boolean>(() => true) };
    const closed = field(input);
    expect(all(closed).some((node) => node.type === CountryNamePicker)).toBe(false);
    const open = all(closed).find((node) => node.props['aria-label'] === '원산지 고르기')!;
    expect(open.props.type).toBe('button');
    (open.props.onClick as () => void)();
    reset();
    const picker = all(NoticePresetOriginField(props)).find((node) => node.type === CountryNamePicker)!;
    expect(picker.props).toMatchObject({ mode: 'apply', currentValue: '중국산', disabled: false });
    expect((picker.props.onApply as (name: string) => boolean)('대한민국')).toBe(true);
    expect(input.value).toBe('대한민국');
    expect(input.dispatchEvent.mock.calls[0][0]).toMatchObject({ type: 'input', bubbles: true });
    (picker.props.onClose as () => void)();
    reset();
    expect(all(NoticePresetOriginField(props)).some((node) => node.type === CountryNamePicker)).toBe(false);
  });

  it('저장 중이라 칸이 잠겨 있으면 값을 넣지 않고 선택창에 알린다', () => {
    const input = { value: '', matches: (selector: string) => selector === ':disabled', dispatchEvent: vi.fn<(event: Event) => boolean>(() => true) };
    (all(field(input)).find((node) => node.props['aria-label'] === '원산지 고르기')!.props.onClick as () => void)();
    reset();
    const picker = all(NoticePresetOriginField(props)).find((node) => node.type === CountryNamePicker)!;
    expect((picker.props.onApply as (name: string) => boolean)('대한민국')).toBe(false);
    expect(input.value).toBe('');
    expect(input.dispatchEvent).not.toHaveBeenCalled();
  });
});
