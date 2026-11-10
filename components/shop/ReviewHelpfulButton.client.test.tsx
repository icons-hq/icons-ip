import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewHelpfulActionResult } from '@/app/shop/review-helpful-actions';
import type { ReviewHelpfulState } from '@/lib/review-helpful';

// Exercise the real component's event handlers and prop updates without a
// browser or server write. Transitions stay pending until the action settles.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, pending: 0, jobs: [] as Promise<unknown>[] }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value;
    }];
  },
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
  useTransition: () => [hooks.pending > 0, (action: () => unknown) => {
    hooks.pending++;
    try {
      const job = Promise.resolve(action()).finally(() => { hooks.pending--; });
      hooks.jobs.push(job);
    } catch (error) {
      hooks.pending--;
      throw error;
    }
  }],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/shop/review-helpful-actions', () => ({ setReviewHelpfulAction: mocks.save }));
import { ReviewHelpfulButton } from './ReviewHelpfulButton';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value =>
  isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value =>
  isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const reviewId = 'a6140000-0000-4000-8000-000000000001';
const initial: ReviewHelpfulState = { reviewId, helpfulCount: 0, helpfulByMe: false, canMarkHelpful: true };
const options = { sort: 'helpful_desc' as const, photoOnly: true, page: 2 };

function setup(snapshot = initial) {
  let current = snapshot;
  const render = () => {
    hooks.index = 0;
    return nodes(ReviewHelpfulButton({ goodId: 'current-group-good', initial: current, options }));
  };
  const main = () => render().find(node => node.type === 'button' && node.props.className === 'wc-review-helpful__button')!;
  const button = (label: string) => render().find(node => node.type === 'button' && text(node.props.children as ReactNode) === label);
  return { render, main, button, update: (next: ReviewHelpfulState) => { current = next; },
    clickMain: () => { const node = main(); if (!node.props.disabled) (node.props.onClick as () => void)(); },
    click: (label: string) => {
      const node = button(label); expect(node, label).toBeDefined();
      expect(node!.props.disabled, label).toBeFalsy(); (node!.props.onClick as () => void)();
    },
  };
}
async function settle() { await Promise.all(hooks.jobs.splice(0)); }
function deferred() {
  let resolve!: (value: ReviewHelpfulActionResult) => void;
  const promise = new Promise<ReviewHelpfulActionResult>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks(); hooks.values = []; hooks.index = 0; hooks.pending = 0; hooks.jobs = [];
});

describe('ReviewHelpfulButton client state', () => {
  it('확정 전에는 숫자와 선택을 바꾸지 않고 pending 버튼으로 중복 클릭을 막는다', async () => {
    const action = deferred(); mocks.save.mockReturnValue(action.promise); const h = setup();
    h.clickMain(); h.clickMain();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ goodId: 'current-group-good', reviewId, marked: true, options });
    expect(h.main().props.disabled).toBe(true);
    expect(h.main().props['aria-pressed']).toBe(false);
    expect(text(h.main())).toBe('도움이 돼요 0');
    expect(h.render().some(node => node.props.role === 'status' && text(node) === '저장 결과 확인 중')).toBe(true);
    action.resolve({ ok: true, state: { ...initial, helpfulCount: 1, helpfulByMe: true } }); await settle();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('액션 영수증을 별도 표시값으로 남기지 않고 동일 값으로 돌아온 서버 snapshot에도 수렴한다', async () => {
    mocks.save.mockResolvedValue({ ok: true, state: { ...initial, helpfulCount: 1, helpfulByMe: true } });
    const h = setup(); h.clickMain(); await settle();
    // Another tab withdrew before the authoritative server read completed: its
    // values equal the first snapshot, so a value-based React key cannot help.
    h.update({ ...initial });
    expect(h.main().props['aria-pressed']).toBe(false); expect(text(h.main())).toBe('도움이 돼요 0');
    h.update({ ...initial, helpfulCount: 3, helpfulByMe: true });
    expect(h.main().props['aria-pressed']).toBe(true); expect(text(h.main())).toBe('도움이 돼요 3');
    h.update({ ...initial });
    expect(h.main().props['aria-pressed']).toBe(false); expect(text(h.main())).toBe('도움이 돼요 0');
  });

  it.each([false, true])('미확정 요청은 외부 snapshot 변경 뒤에도 기존 목표 상태를 그대로 재확인한다 (기존 선택=%s)', async (markedBefore) => {
    const before = { ...initial, helpfulCount: markedBefore ? 5 : 0, helpfulByMe: markedBefore };
    const desired = !markedBefore;
    mocks.save.mockResolvedValueOnce({ ok: false, error: '저장 결과 미확인' })
      .mockResolvedValueOnce({ ok: true, state: { ...initial, helpfulCount: 8, helpfulByMe: desired } });
    const h = setup(before); h.clickMain(); await settle();
    h.update({ ...initial, helpfulCount: 8, helpfulByMe: desired });
    expect(h.main().props.disabled).toBe(true); expect(text(h.main())).toBe('도움이 돼요 8');
    expect(h.button('같은 요청으로 다시 확인')).toBeDefined();
    h.click('같은 요청으로 다시 확인'); await settle();
    expect(mocks.save.mock.calls.map(call => call[0].marked)).toEqual([desired, desired]);
    expect(h.button('같은 요청으로 다시 확인')).toBeUndefined();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('응답 유실과 최신 상태 조회 중에도 미확정 목표를 지우거나 반대 상태로 바꾸지 않는다', async () => {
    mocks.save.mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ ok: true, state: { ...initial, helpfulCount: 2, helpfulByMe: true } });
    const h = setup(); h.clickMain(); await settle();
    expect(h.render().some(node => node.props.role === 'alert' && text(node).includes('저장 결과를 확인하지 못했습니다'))).toBe(true);
    h.click('최신 상태 확인'); await settle();
    expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.refresh).toHaveBeenCalledOnce();
    h.update({ ...initial, helpfulCount: 2, helpfulByMe: true });
    expect(h.main().props.disabled).toBe(true);
    expect(h.button('같은 요청으로 다시 확인')).toBeDefined();
    h.click('같은 요청으로 다시 확인'); await settle();
    expect(mocks.save.mock.calls.map(call => call[0].marked)).toEqual([true, true]);
  });

  it('최신 서버 권한이 읽기 전용으로 바뀌면 표시를 보존하고 새 쓰기를 막는다', () => {
    const h = setup(); h.update({ ...initial, helpfulCount: 4, helpfulByMe: true, canMarkHelpful: false });
    expect(h.main().props.disabled).toBe(true); expect(h.main().props['aria-pressed']).toBe(true);
    expect(text(h.main())).toBe('도움이 돼요 4'); h.clickMain(); expect(mocks.save).not.toHaveBeenCalled();
  });
});
