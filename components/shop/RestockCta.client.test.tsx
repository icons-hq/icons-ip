import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 재입고 버튼의 동작 테스트 — jsdom 없이 훅을 얇게 흉내 내 컴포넌트 함수를 직접 부른다
   (선례: components/campaign/CampaignMoreList.client.test.tsx). 전환은 콜백을 붙잡아 두었다가
   테스트가 직접 기다린다 — 그 사이 버튼이 어떤 상태인지(포커스를 잃지 않는 잠금)를 보려는 것이다. */

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  transitions: [] as Promise<void>[],
}));

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  requestGood: vi.fn(),
  requestVariant: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.stateIndex++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      const set = (next: unknown) => {
        hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next;
      };
      return [hooks.states[index], set];
    },
    useTransition: () => [false, (callback: () => Promise<void>) => { hooks.transitions.push(callback()); }],
  };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop/g11',
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock('@/app/shop/actions', () => ({
  requestRestockAlertAction: mocks.requestGood,
  requestVariantRestockAlertAction: mocks.requestVariant,
}));

import { RestockCta, type RestockCtaProps } from './RestockCta';

const VARIANT = '00000000-0000-4000-8000-0000005672b1';
const OTHER_VARIANT = '00000000-0000-4000-8000-0000005672c1';

function render(props: Partial<RestockCtaProps> = {}) {
  hooks.stateIndex = 0;
  return RestockCta({ goodId: 'g11', initialRequested: false, optionName: '옵션 B', variantId: VARIANT, ...props });
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}

function button(tree: ReactNode) {
  return elements(tree).find((element) => element.type === 'button')!;
}

function status(tree: ReactNode) {
  return elements(tree).find((element) => element.props.role === 'status')!;
}

function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement(node)) return '';
  return text((node as ReactElement<{ children?: ReactNode }>).props.children);
}

async function click(tree: ReactNode) {
  (button(tree).props.onClick as () => void)();
  await Promise.all(hooks.transitions.splice(0));
}

beforeEach(() => {
  hooks.states = [];
  hooks.transitions = [];
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.requestGood.mockReset();
  mocks.requestVariant.mockReset();
});

describe('RestockCta 신청 동작 (PD-11 · 리뷰 l2-ui-2·3)', () => {
  /* 구매 시트(모달) 안에서 누른 버튼이 disabled 가 되면 포커스가 다이얼로그 밖 body 로 빠진다. */
  it('누르는 순간 aria-disabled 로 잠그고 disabled 로 바꾸지 않아 포커스를 지킨다', async () => {
    let settle!: (value: unknown) => void;
    mocks.requestVariant.mockReturnValue(new Promise((resolve) => { settle = resolve; }));

    let tree = render();
    (button(tree).props.onClick as () => void)();
    tree = render();
    expect(button(tree).props.disabled).toBeUndefined();
    expect(button(tree).props['aria-disabled']).toBe('true');
    expect(button(tree).props.className).toBe('wc-btn primary disabled');
    expect(text(button(tree).props.children as ReactNode)).toContain('재입고 알림 신청됨');

    /* 잠긴 동안 다시 눌러도 두 번 신청하지 않는다. */
    (button(tree).props.onClick as () => void)();
    expect(mocks.requestVariant).toHaveBeenCalledTimes(1);
    expect(mocks.requestVariant).toHaveBeenCalledWith('g11', VARIANT);

    settle({ ok: true, status: 'pending' });
    await Promise.all(hooks.transitions.splice(0));
    tree = render();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(button(tree).props.disabled).toBeUndefined();
    expect(status(tree).props.className).toBe('wc-sr-only');
    expect(text(status(tree).props.children as ReactNode)).toBe('재입고 알림을 신청했어요.');
  });

  /* 그 사이 재입고됐으면(variant_available) 서버 사실을 다시 받아 담기·구매가 돌아오게 한다. */
  it('판매 상태가 바뀌어 거절되면 낙관 표시를 되돌리고 화면을 다시 받으며 이유를 알린다', async () => {
    mocks.requestVariant.mockResolvedValue({ ok: false, error: 'invalid_request' });

    let tree = render();
    await click(tree);
    tree = render();

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(button(tree).props['aria-disabled']).toBeUndefined();
    expect(text(button(tree).props.children as ReactNode)).toContain('재입고 알림 받기');
    expect(status(tree).props.className).toBe('wc-buy-panel__status');
    expect(text(status(tree).props.children as ReactNode)).toBe('판매 상태가 바뀌었어요. 지금 상태를 확인해주세요.');
  });

  /* 화면을 다시 받으면 이 버튼(과 그 상태 줄)은 담기·구매로 바뀌며 사라진다 — 이유와 포커스는 버튼을 둔 표면이 맡는다. */
  it('버튼을 둔 표면이 받겠다고 하면 거절 이유를 그 표면에 넘기고 자기 상태 줄에는 띄우지 않는다', async () => {
    mocks.requestVariant.mockResolvedValue({ ok: false, error: 'invalid_request' });
    const onStaleState = vi.fn();

    let tree = render({ onStaleState });
    await click(tree);
    tree = render({ onStaleState });

    expect(onStaleState).toHaveBeenCalledWith('판매 상태가 바뀌었어요. 지금 상태를 확인해주세요.');
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(text(status(tree).props.children as ReactNode)).toBe('');
    /* 다른 실패는 그대로 버튼 옆에서 알린다. */
    mocks.requestVariant.mockResolvedValue({ ok: false, error: 'unavailable' });
    await click(tree);
    tree = render({ onStaleState });
    expect(onStaleState).toHaveBeenCalledTimes(1);
    expect(text(status(tree).props.children as ReactNode)).toBe('재입고 알림을 신청하지 못했어요. 잠시 후 다시 시도해주세요.');
  });

  it('일시 오류·정지 계정은 버튼 아래 상태 줄로 알리고 화면은 그대로 둔다', async () => {
    mocks.requestVariant.mockResolvedValueOnce({ ok: false, error: 'unavailable' });
    let tree = render();
    await click(tree);
    tree = render();
    expect(text(status(tree).props.children as ReactNode)).toBe('재입고 알림을 신청하지 못했어요. 잠시 후 다시 시도해주세요.');
    expect(status(tree).props.className).toBe('wc-buy-panel__status');
    expect(mocks.refresh).not.toHaveBeenCalled();

    /* 다시 누르면 안내를 지우고 새로 신청한다. */
    mocks.requestVariant.mockResolvedValueOnce({ ok: false, error: 'account_suspended' });
    await click(tree);
    tree = render();
    expect(mocks.requestVariant).toHaveBeenCalledTimes(2);
    expect(text(status(tree).props.children as ReactNode)).toBe('정지된 계정은 재입고 알림을 신청할 수 없어요.');
  });

  /* 모바일 바·레일 박스는 줄을 늘릴 자리가 없다 — 실패를 버튼 글자로 보이고 상태 줄은 보조기기 전용이다. */
  it('좁은 표면에서는 실패 안내를 버튼 글자로 보인다', async () => {
    mocks.requestGood.mockResolvedValue({ ok: false, error: 'unavailable' });

    let tree = render({ compact: true, variantId: null, optionName: null });
    await click(tree);
    tree = render({ compact: true, variantId: null, optionName: null });

    expect(mocks.requestGood).toHaveBeenCalledWith('g11');
    expect(text(button(tree).props.children as ReactNode)).toBe('신청하지 못했어요 · 다시 시도');
    expect(status(tree).props.className).toBe('wc-sr-only');
    expect(text(status(tree).props.children as ReactNode)).toBe('재입고 알림을 신청하지 못했어요. 잠시 후 다시 시도해주세요.');
  });

  it('비로그인은 고른 옵션으로 돌아오는 로그인으로 보내고 안내를 남기지 않는다', async () => {
    mocks.requestVariant.mockResolvedValue({ ok: false, error: 'auth_required' });

    let tree = render();
    await click(tree);
    tree = render();

    expect(mocks.push).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/shop/g11?variant=${VARIANT}`)}`);
    expect(text(status(tree).props.children as ReactNode)).toBe('');
    expect(button(tree).props['aria-disabled']).toBeUndefined();
  });

  /* 같은 인스턴스가 옵션을 바꿔 가며 쓰인다 — 한 옵션의 실패 안내가 다른 옵션으로 새지 않는다. */
  it('옵션을 바꾸면 이전 옵션의 안내를 보이지 않는다', async () => {
    mocks.requestVariant.mockResolvedValue({ ok: false, error: 'unavailable' });

    const tree = render();
    await click(tree);
    const other = render({ variantId: OTHER_VARIANT, optionName: '옵션 C' });

    expect(text(status(other).props.children as ReactNode)).toBe('');
    expect(status(other).props.className).toBe('wc-sr-only');
  });

  it('어드민 미리보기에서는 진짜 disabled 이고 눌러도 신청하지 않는다', () => {
    const tree = render({ disabled: true });

    expect(button(tree).props.disabled).toBe(true);
    expect(button(tree).props['aria-disabled']).toBeUndefined();
    (button(tree).props.onClick as () => void)();
    expect(mocks.requestVariant).not.toHaveBeenCalled();
  });
});
