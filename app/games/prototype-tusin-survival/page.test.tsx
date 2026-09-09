import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TusinSurvivalPrototypePage, { metadata } from './page';
import { isTusinSurvivalPrototypeEnabled } from '@/lib/prototypes/tusin-survival/gate.server';

const mocks = vi.hoisted(() => ({
  client: vi.fn(() => null),
  connection: vi.fn(),
}));

vi.mock('next/server', () => ({
  connection: mocks.connection,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/components/prototype/tusin-survival/TusinSurvivalClient', () => ({
  TusinSurvivalClient: mocks.client,
}));

describe('/games/prototype-tusin-survival page', () => {
  beforeEach(() => {
    vi.stubEnv('ICONS_PROTOTYPE', '0');
    mocks.client.mockClear();
    mocks.connection.mockReset();
    mocks.connection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('항상 검색 비노출 metadata를 선언한다', () => {
    expect(metadata).toMatchObject({
      title: '투신전생기 서바이벌 — 내부 프로토타입',
      robots: { index: false, follow: false },
    });
  });

  it.each([
    ['unset', undefined, false],
    ['disabled', '0', false],
    ['near miss', 'true', false],
    ['enabled', '1', true],
  ])('%s 환경값을 fail-closed로 판정한다', (_label, value, expected) => {
    vi.stubEnv('ICONS_PROTOTYPE', value);

    expect(isTusinSurvivalPrototypeEnabled()).toBe(expected);
  });

  it('request-time connection 뒤 비활성 프로토타입을 404로 숨긴다', async () => {
    await expect(TusinSurvivalPrototypePage()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mocks.connection).toHaveBeenCalledOnce();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('정확한 서버 플래그에서만 Client entry를 렌더링한다', async () => {
    vi.stubEnv('ICONS_PROTOTYPE', '1');

    const screen = await TusinSurvivalPrototypePage();

    expect(mocks.connection).toHaveBeenCalledOnce();
    expect(screen.type).toBe(mocks.client);
    expect(screen.props).toEqual({});
  });
});
