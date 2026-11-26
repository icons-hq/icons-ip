import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusFirstInvalid } from './focus-invalid';

afterEach(() => vi.unstubAllGlobals());

/* S7-4: 빈 채 저장했을 때 포커스는 첫 오류 칸으로 간다(창이 길면 오류 문구가 화면 밖이다). */
describe('첫 오류 칸으로 포커스', () => {
  const run = (queued: ((time: number) => void)[]) => vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => { queued.push(callback); return queued.length; });

  it('그린 다음 프레임에 잘못된 첫 칸을 찾아 포커스를 준다', () => {
    const queued: ((time: number) => void)[] = []; run(queued);
    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    focusFirstInvalid({ querySelector } as never);
    /* 오류가 칸에 붙기 전(같은 틱)에는 찾지 않는다. */
    expect(querySelector).not.toHaveBeenCalled();
    queued.forEach((callback) => callback(0));
    expect(querySelector).toHaveBeenCalledWith('[aria-invalid="true"]:not(:disabled)');
    expect(focus).toHaveBeenCalledTimes(1);
  });
  it('잘못된 칸이 없거나 폼이 없거나 프레임을 쓸 수 없으면 아무것도 하지 않는다', () => {
    const queued: ((time: number) => void)[] = []; run(queued);
    expect(() => { focusFirstInvalid(null); focusFirstInvalid(undefined); focusFirstInvalid({ querySelector: () => null } as never); queued.forEach((callback) => callback(0)); }).not.toThrow();
    vi.unstubAllGlobals();
    const querySelector = vi.fn();
    focusFirstInvalid({ querySelector } as never);
    expect(querySelector).not.toHaveBeenCalled();
  });
});
