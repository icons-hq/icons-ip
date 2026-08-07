import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POSTCODE_SCRIPT_SRC } from './postcode';
import {
  POSTCODE_SCRIPT_TIMEOUT_MS,
  loadPostcodeSearch,
  resetPostcodeSearchLoader,
} from './postcode.client';

interface FakeScript {
  src: string;
  async: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  removed: boolean;
  remove: () => void;
}

const daumWindow: { daum?: { Postcode?: unknown } } = {};
let scripts: FakeScript[] = [];

function Postcode() {
  return { embed: () => undefined };
}

beforeEach(() => {
  resetPostcodeSearchLoader();
  scripts = [];
  delete daumWindow.daum;

  vi.stubGlobal('window', daumWindow);
  vi.stubGlobal('document', {
    createElement() {
      const script: FakeScript = {
        src: '',
        async: false,
        onload: null,
        onerror: null,
        removed: false,
        remove() {
          this.removed = true;
        },
      };
      return script;
    },
    head: {
      appendChild(script: FakeScript) {
        scripts.push(script);
        return script;
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('loadPostcodeSearch', () => {
  it('한 번만 스크립트를 붙이고 같은 약속을 재사용한다', async () => {
    const first = loadPostcodeSearch();
    const second = loadPostcodeSearch();

    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(POSTCODE_SCRIPT_SRC);
    expect(scripts[0].async).toBe(true);

    daumWindow.daum = { Postcode };
    scripts[0].onload?.();

    await expect(first).resolves.toBe(Postcode);
    await expect(second).resolves.toBe(Postcode);
  });

  it('이미 올라온 스크립트는 다시 내려받지 않는다', async () => {
    daumWindow.daum = { Postcode };

    await expect(loadPostcodeSearch()).resolves.toBe(Postcode);
    expect(scripts).toHaveLength(0);
  });

  it('로드 실패는 캐시하지 않고 재시도를 허용한다', async () => {
    const failing = loadPostcodeSearch();
    scripts[0].onerror?.();

    await expect(failing).rejects.toThrow(/failed to load/);
    expect(scripts[0].removed).toBe(true);

    const retry = loadPostcodeSearch();
    expect(scripts).toHaveLength(2);

    daumWindow.daum = { Postcode };
    scripts[1].onload?.();
    await expect(retry).resolves.toBe(Postcode);
  });

  it('응답 없는 스크립트는 무한 로딩 대신 실패로 끝난다', async () => {
    vi.useFakeTimers();
    const hanging = loadPostcodeSearch();

    vi.advanceTimersByTime(POSTCODE_SCRIPT_TIMEOUT_MS);

    await expect(hanging).rejects.toThrow(/timed out/);
    expect(scripts[0].removed).toBe(true);
  });

  it('스크립트가 떠도 생성자가 없으면 실패로 다룬다', async () => {
    const broken = loadPostcodeSearch();
    scripts[0].onload?.();

    await expect(broken).rejects.toThrow(/without a constructor/);
  });

  it('서버 렌더에서는 스크립트를 붙이지 않는다', async () => {
    vi.unstubAllGlobals();

    await expect(loadPostcodeSearch()).rejects.toThrow(/requires a browser/);
  });
});
