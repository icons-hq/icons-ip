import { describe, expect, it, vi } from 'vitest';
import { installAdminNumberWheelGuard, releaseAdminNumberInputOnWheel } from './AdminNumberWheelGuard';

function numberInput({ type = 'number', inAdmin = true } = {}) {
  return { tagName: 'INPUT', type, closest: (selector: string) => selector === '.wc-admin' && inAdmin ? {} : null, blur: vi.fn() };
}

describe('어드민 숫자 입력 휠 보호(R18)', () => {
  it('포커스된 어드민 number 입력 위의 휠만 포커스를 풀어 값이 바뀌지 않게 한다', () => {
    const focused = numberInput();
    expect(releaseAdminNumberInputOnWheel(focused as unknown as EventTarget, focused as unknown as Element)).toBe(true);
    expect(focused.blur).toHaveBeenCalledOnce();
    const other = numberInput();
    expect(releaseAdminNumberInputOnWheel(other as unknown as EventTarget, focused as unknown as Element)).toBe(false);
    for (const input of [numberInput({ type: 'text' }), numberInput({ inAdmin: false })]) {
      expect(releaseAdminNumberInputOnWheel(input as unknown as EventTarget, input as unknown as Element)).toBe(false);
      expect(input.blur).not.toHaveBeenCalled();
    }
    expect(releaseAdminNumberInputOnWheel(null, null)).toBe(false);
  });

  it('문서에 수동(passive) 캡처 리스너를 한 번 달고 정리한다', () => {
    const focused = numberInput();
    const listeners = new Map<string, EventListener>();
    const root = {
      activeElement: focused as unknown as Element,
      addEventListener: vi.fn((type: string, listener: EventListener) => { listeners.set(type, listener); }),
      removeEventListener: vi.fn(),
    };
    const cleanup = installAdminNumberWheelGuard(root as unknown as Parameters<typeof installAdminNumberWheelGuard>[0]);
    expect(root.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { capture: true, passive: true });
    listeners.get('wheel')!({ target: focused } as unknown as Event);
    expect(focused.blur).toHaveBeenCalledOnce();
    cleanup();
    expect(root.removeEventListener).toHaveBeenCalledWith('wheel', listeners.get('wheel'), { capture: true });
  });
});
