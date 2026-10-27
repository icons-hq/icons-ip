import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applicableShellNotices,
  firstVisibleNoticeBar,
  forgetShellNoticeNow,
  initialShellNoticeNow,
  nextShellNoticeEnd,
  noticeStripDimensions,
  noticeStripIndex,
  parseShellNoticePageTypes,
  readDismissedNoticeKeys,
  readShellNoticeNow,
  readShellNoticeSeed,
  rememberDismissedNotice,
  shellNoticeImpressionVisible,
  SHELL_NOTICE_DISMISSED_KEY,
  SHELL_NOTICE_NOW_GLOBAL,
  SHELL_NOTICE_ROOT_ID,
  SHELL_NOTICE_SCRIPT,
  SHELL_NOTICE_SEED_GLOBAL,
  shellNoticeLive,
  shellNoticePageType,
  shellNoticeTimerDelay,
  visibleNoticeStripIndex,
  type ShellNoticeBar,
  type ShellNotices,
  type ShellNoticeStrip,
} from './shell-notices';

const bar = (id: string, patch: Partial<ShellNoticeBar> = {}): ShellNoticeBar => ({
  id, key: `${id}:k`, message: `공지 ${id}`, cta: { label: '자세히 보기', href: '/events' },
  pageTypes: ['home', 'collection', 'product', 'content', 'other'], endsAt: null, ...patch,
});
const strip = (id: string, patch: Partial<ShellNoticeStrip> = {}): ShellNoticeStrip => ({
  id, title: `띠배너 ${id}`, imageUrl: `https://cdn.example/${id}.webp`, mobileImageUrl: null, href: '/events',
  pageTypes: null, endsAt: null, ...patch,
});
const open = { cardRewardsEnabled: true, communityEnabled: true };

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    data,
  };
}

describe('공지 대상 화면 유형', () => {
  it('홈·상품 목록·상품 상세·콘텐츠·그 밖의 화면으로 나눈다', () => {
    expect(shellNoticePageType('/')).toBe('home');
    for (const path of ['/shop', '/shop/new', '/shop/best', '/ip/rilakkuma']) expect(shellNoticePageType(path), path).toBe('collection');
    expect(shellNoticePageType('/shop/g11')).toBe('product');
    for (const path of ['/stories', '/stories/abc', '/events', '/events/summer-drop']) expect(shellNoticePageType(path), path).toBe('content');
    for (const path of ['/search', '/ip', '/cart', '/my', '/legal/terms', '/offline-popups']) expect(shellNoticePageType(path), path).toBe('other');
  });

  it('page_types는 알려진 유형의 중복 없는 비지 않은 목록만 받고 정해진 순서로 돌려준다', () => {
    expect(parseShellNoticePageTypes(undefined)).toBeUndefined();
    expect(parseShellNoticePageTypes(['other', 'home'])).toEqual(['home', 'other']);
    for (const value of [[], ['home', 'home'], ['checkout'], 'home', [1], null]) expect(parseShellNoticePageTypes(value), JSON.stringify(value)).toBeNull();
  });
});

describe('화면별 공지 후보', () => {
  const notices: ShellNotices = {
    bars: [bar('b1', { pageTypes: ['home'] }), bar('b2', { pageTypes: ['product'] }), bar('b3', { cta: null })],
    strips: [strip('s1', { pageTypes: ['home', 'product'] }), strip('s2')],
  };

  it('대상 유형에 맞는 공지만 운영 순서대로 남기고, 대상 없는 기존 스트립은 어디서나 후보다', () => {
    expect(applicableShellNotices(notices, '/', open)).toEqual({ bars: [notices.bars[0], notices.bars[2]], strips: notices.strips });
    expect(applicableShellNotices(notices, '/shop', open)).toEqual({ bars: [notices.bars[2]], strips: [notices.strips[1]] });
    expect(applicableShellNotices(notices, '/shop/g1', open).bars.map((item) => item.id)).toEqual(['b2', 'b3']);
  });

  it('게이트가 꺼진 목적지(카드팩·게임·커뮤니티)의 공지는 숨기고, 버튼 없는 공지 바는 게이트와 무관하다', () => {
    const gated: ShellNotices = {
      bars: [bar('packs', { cta: { label: '보기', href: '/packs' } }), bar('copy', { cta: null }), bar('community', { cta: { label: '보기', href: '/community' } })],
      strips: [strip('games', { href: '/games/roulette' }), strip('events')],
    };
    const closed = applicableShellNotices(gated, '/', { cardRewardsEnabled: false, communityEnabled: false });
    expect(closed.bars.map((item) => item.id)).toEqual(['copy']);
    expect(closed.strips.map((item) => item.id)).toEqual(['events']);
    expect(applicableShellNotices(gated, '/', open).bars).toHaveLength(3);
  });
});

describe('같은 탭 닫힘과 스트립 선택', () => {
  it('닫힘 기록은 깨진 값을 무시하고, 다시 닫으면 최신 순서로 하나만 남긴다', () => {
    expect(readDismissedNoticeKeys(null)).toEqual([]);
    expect(readDismissedNoticeKeys(memoryStorage({ [SHELL_NOTICE_DISMISSED_KEY]: '{oops' }))).toEqual([]);
    expect(readDismissedNoticeKeys(memoryStorage({ [SHELL_NOTICE_DISMISSED_KEY]: '{"a":1}' }))).toEqual([]);
    expect(readDismissedNoticeKeys(memoryStorage({ [SHELL_NOTICE_DISMISSED_KEY]: '["a",1,"b"]' }))).toEqual(['a', 'b']);
    const storage = memoryStorage({ [SHELL_NOTICE_DISMISSED_KEY]: '["a","b"]' });
    expect(rememberDismissedNotice(storage, 'a')).toEqual(['b', 'a']);
    expect(JSON.parse(storage.data.get(SHELL_NOTICE_DISMISSED_KEY) ?? '')).toEqual(['b', 'a']);
  });

  it('저장소가 막혀도 이번 화면에서는 닫힌 목록을 돌려준다', () => {
    const blocked = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(rememberDismissedNotice(blocked, 'x')).toEqual(['x']);
  });

  /* 저장소가 막히면 매번 빈 목록을 읽으므로, 지금 화면의 닫힘에 합치지 않으면 둘째를 닫을 때 첫째가 다시 나타난다(Codex #599). */
  it('저장소가 막히거나 없어도 앞서 닫은 공지를 지금 화면 상태에서 이어받는다', () => {
    const blocked = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    const first = rememberDismissedNotice(blocked, 'first');
    expect(rememberDismissedNotice(blocked, 'second', first)).toEqual(['first', 'second']);
    expect(rememberDismissedNotice(null, 'third', ['first', 'second'])).toEqual(['first', 'second', 'third']);
    const storage = memoryStorage({ [SHELL_NOTICE_DISMISSED_KEY]: '["stored"]' });
    expect(rememberDismissedNotice(storage, 'b', ['a', 'stored'])).toEqual(['stored', 'a', 'b']);
  });

  /* IntersectionObserver는 관찰 시작·교차 변화 때 문턱 아래 비율로도 항목을 준다 — 절반 미만은 노출이 아니다(Codex #599). */
  it('공지는 절반 이상 보일 때만 노출로 센다', () => {
    expect(shellNoticeImpressionVisible({ isIntersecting: true, intersectionRatio: 0.02 })).toBe(false);
    expect(shellNoticeImpressionVisible({ isIntersecting: true, intersectionRatio: 0.49 })).toBe(false);
    expect(shellNoticeImpressionVisible({ isIntersecting: true, intersectionRatio: 0.5 })).toBe(true);
    expect(shellNoticeImpressionVisible({ isIntersecting: false, intersectionRatio: 0.8 })).toBe(false);
  });

  it('닫지 않은 첫 공지 바 하나만 보이고, 스트립은 시드로 후보 하나를 고른다', () => {
    const bars = [bar('b1'), bar('b2'), bar('b3')];
    expect(firstVisibleNoticeBar(bars, [])?.id).toBe('b1');
    expect(firstVisibleNoticeBar(bars, ['b1:k'])?.id).toBe('b2');
    expect(firstVisibleNoticeBar(bars, ['b1:k', 'b2:k', 'b3:k'])).toBeNull();
    expect(noticeStripIndex(0, 3)).toBe(0);
    expect(noticeStripIndex(0.5, 3)).toBe(1);
    expect(noticeStripIndex(0.9999, 3)).toBe(2);
    expect(noticeStripIndex(0.3, 0)).toBe(-1);
    for (const seed of [-1, 1, Number.NaN]) expect(noticeStripIndex(seed, 3)).toBe(0);
  });

  it('시드는 인라인 스크립트가 남긴 값만 읽고, 없거나 이상하면 서버가 그린 첫 후보(0)다', () => {
    expect(readShellNoticeSeed(null)).toBe(0);
    expect(readShellNoticeSeed({ [SHELL_NOTICE_SEED_GLOBAL]: 0.42 })).toBe(0.42);
    for (const value of [1, -0.1, '0.3', undefined]) expect(readShellNoticeSeed({ [SHELL_NOTICE_SEED_GLOBAL]: value })).toBe(0);
  });
});

/* 셸 공지는 하드 로드 때만 내려오고 앱 안 이동에는 다시 오지 않는다 — 열린 화면은 종료 시각을 직접 지킨다(l8a-ui-4). */
describe('노출 종료(열린 화면)', () => {
  const T = Date.UTC(2026, 9, 23, 9, 0, 0);

  it('종료 시각이 없거나 아직 지나지 않은 공지만 노출 중이고, 서버 렌더(now 없음)는 시각으로 거르지 않는다', () => {
    expect(shellNoticeLive({ endsAt: null }, T)).toBe(true);
    expect(shellNoticeLive({ endsAt: T + 1 }, T)).toBe(true);
    expect(shellNoticeLive({ endsAt: T }, T)).toBe(false);
    expect(shellNoticeLive({ endsAt: T - 1 }, null)).toBe(true);
    /* 종료 시각을 싣기 전 모양의 캐시 값(endsAt 없음)은 끝나지 않은 것으로 본다 — 공지를 통째로 숨기지 않는다. */
    expect(shellNoticeLive({} as { endsAt: number | null }, T)).toBe(true);
  });

  it('끝난 공지 바는 건너뛰어 다음 공지 바를 보이고, 닫힘과 함께 판정한다', () => {
    const bars = [bar('b1', { endsAt: T }), bar('b2', { endsAt: T + 60_000 }), bar('b3')];
    expect(firstVisibleNoticeBar(bars, [], T - 1)?.id).toBe('b1');
    expect(firstVisibleNoticeBar(bars, [], T)?.id).toBe('b2');
    expect(firstVisibleNoticeBar(bars, ['b2:k'], T)?.id).toBe('b3');
    expect(firstVisibleNoticeBar(bars, [], T + 60_000)?.id).toBe('b3');
    expect(firstVisibleNoticeBar(bars, [], null)?.id).toBe('b1');
  });

  it('보이던 스트립은 다른 후보가 끝나도 그대로고, 그 스트립이 끝나면 다음 후보로 넘기며, 모두 끝나면 숨긴다', () => {
    const strips = [strip('s1', { endsAt: T }), strip('s2', { endsAt: T + 60_000 }), strip('s3')];
    /* 시드 0.5 → 가운데(s2). s1이 끝나도 s2를 유지한다(후보 수로 다시 나누지 않는다). */
    expect(visibleNoticeStripIndex(strips, 0.5, T - 1)).toBe(1);
    expect(visibleNoticeStripIndex(strips, 0.5, T)).toBe(1);
    expect(visibleNoticeStripIndex(strips, 0.5, T + 60_000)).toBe(2);
    /* 시드 0 → s1, s1이 끝나면 s2로 넘긴다. 마지막 후보가 끝나면 처음으로 돌아 찾는다. */
    expect(visibleNoticeStripIndex(strips, 0, T)).toBe(1);
    expect(visibleNoticeStripIndex([strip('a'), strip('b', { endsAt: T })], 0.9, T)).toBe(0);
    expect(visibleNoticeStripIndex([strip('a', { endsAt: T }), strip('b', { endsAt: T })], 0.3, T)).toBe(-1);
    expect(visibleNoticeStripIndex([], 0.3, T)).toBe(-1);
    expect(visibleNoticeStripIndex(strips, 0.5, null)).toBe(1);
  });

  it('다음 종료 시각과 타이머 지연을 고른다 — 지났으면 곧바로, 아주 멀면 타이머 한도까지만', () => {
    const notices: ShellNotices = {
      bars: [bar('b1', { endsAt: T + 5_000 }), bar('b2')],
      strips: [strip('s1', { endsAt: T + 1_000 }), strip('s2', { endsAt: T - 1 })],
    };
    expect(nextShellNoticeEnd(notices, T)).toBe(T + 1_000);
    expect(nextShellNoticeEnd(notices, T + 1_000)).toBe(T + 5_000);
    expect(nextShellNoticeEnd(notices, T + 5_000)).toBeNull();
    expect(nextShellNoticeEnd({ bars: [bar('b')], strips: [] }, T)).toBeNull();
    expect(shellNoticeTimerDelay(T + 1_000, T)).toBe(1_050);
    expect(shellNoticeTimerDelay(T - 10_000, T)).toBe(50);
    expect(shellNoticeTimerDelay(T + 40 * 24 * 60 * 60 * 1_000, T)).toBe(2_147_483_647);
  });

  it('하이드레이션은 스크립트가 쓴 판정 시각을 쓰고, 그 시각을 지운 뒤나 스크립트가 없으면 지금 시각, 서버는 null이다', () => {
    const scope: Record<string, unknown> = { [SHELL_NOTICE_NOW_GLOBAL]: T };
    expect(readShellNoticeNow(scope)).toBe(T);
    expect(initialShellNoticeNow(scope, () => T + 9_999)).toBe(T);
    forgetShellNoticeNow(scope);
    expect(readShellNoticeNow(scope)).toBeNull();
    expect(initialShellNoticeNow(scope, () => T + 9_999)).toBe(T + 9_999);
    expect(initialShellNoticeNow(null, () => T)).toBeNull();
    for (const value of ['1', Number.NaN, Infinity, undefined]) expect(readShellNoticeNow({ [SHELL_NOTICE_NOW_GLOBAL]: value })).toBeNull();
  });
});

/* 인라인 스크립트는 하이드레이션 전에 DOM을 고친다 — 컴포넌트의 계산(firstVisibleNoticeBar·noticeStripIndex)과
   한 칸이라도 다르면 React가 서버 HTML과 다른 결과를 보게 된다. 최소 DOM 대역으로 같은 입력의 결과를 대조한다. */
describe('첫 페인트 전 스크립트 ↔ 컴포넌트 계산', () => {
  class FakeElement {
    attributes = new Map<string, string>();
    constructor(attributes: Record<string, string>) { Object.entries(attributes).forEach(([name, value]) => this.attributes.set(name, value)); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    get hidden() { return this.attributes.has('hidden'); }
  }

  afterEach(() => vi.useRealTimers());

  /* ends: 컴포넌트가 그리는 data-notice-ends(종료 시각이 있을 때만). */
  const endsAttribute = (endsAt: number | null | undefined): Record<string, string> => (typeof endsAt === 'number' ? { 'data-notice-ends': String(endsAt) } : {});

  function run({ bars, strips, dismissed, seed, rootPresent = true, barEnds = [], stripEnds = [] }: {
    bars: string[]; strips: string[]; dismissed?: string; seed?: unknown; rootPresent?: boolean;
    barEnds?: (number | null)[]; stripEnds?: (number | null)[];
  }) {
    const barElements = bars.map((key, index) => new FakeElement({ 'data-notice-bar': key, ...endsAttribute(barEnds[index]), ...(index > 0 ? { hidden: '' } : {}) }));
    const stripElements = strips.map((id, index) => new FakeElement({ 'data-notice-strip': id, ...endsAttribute(stripEnds[index]), ...(index > 0 ? { hidden: '' } : {}) }));
    const root = {
      querySelectorAll: (selector: string) => (selector === '[data-notice-bar]' ? barElements : selector === '[data-notice-strip]' ? stripElements : []),
    };
    const storage = memoryStorage(dismissed === undefined ? {} : { [SHELL_NOTICE_DISMISSED_KEY]: dismissed });
    const scope: Record<string, unknown> = { sessionStorage: storage, ...(seed === undefined ? {} : { [SHELL_NOTICE_SEED_GLOBAL]: seed }) };
    const document = { getElementById: (id: string) => (rootPresent && id === SHELL_NOTICE_ROOT_ID ? root : null) };
    new Function('window', 'document', SHELL_NOTICE_SCRIPT)(scope, document);
    return { barElements, stripElements, scope, storage };
  }

  it.each([
    { name: '닫힘 없음', dismissed: undefined, seed: 0.1 },
    { name: '첫 공지 닫힘', dismissed: '["b1:k"]', seed: 0.5 },
    { name: '모두 닫힘', dismissed: '["b1:k","b2:k","b3:k"]', seed: 0.99 },
    { name: '깨진 기록', dismissed: 'not-json', seed: 0.7 },
  ])('$name: 공지 바·스트립의 hidden이 컴포넌트 계산과 같다', ({ dismissed, seed }) => {
    const bars = [bar('b1'), bar('b2'), bar('b3')];
    const strips = ['s1', 's2', 's3'];
    const result = run({ bars: bars.map((item) => item.key), strips, dismissed, seed });
    const visible = firstVisibleNoticeBar(bars, readDismissedNoticeKeys(result.storage));
    expect(result.barElements.map((element) => !element.hidden)).toEqual(bars.map((item) => item === visible));
    const index = noticeStripIndex(readShellNoticeSeed(result.scope), strips.length);
    expect(result.stripElements.map((element) => !element.hidden)).toEqual(strips.map((_, i) => i === index));
  });

  /* 오래된 정적 HTML·캐시에는 이미 끝난 공지가 남아 있을 수 있다 — 스크립트가 첫 페인트 전에 숨기고, 컴포넌트는 스크립트가
     남긴 판정 시각으로 같은 결과를 계산한다. */
  it.each([
    { name: '첫 공지 바·보이던 스트립이 끝남', barEnds: [0, null, null], stripEnds: [null, 0, null], seed: 0.5, dismissed: undefined },
    { name: '끝나지 않음', barEnds: [60_000, null, null], stripEnds: [60_000, 60_000, null], seed: 0.1, dismissed: undefined },
    { name: '끝남과 닫힘이 겹침', barEnds: [0, null, 0], stripEnds: [0, 0, 0], seed: 0.99, dismissed: '["b2:k"]' },
    { name: '마지막 후보가 끝나 처음으로 돎', barEnds: [null, null, null], stripEnds: [null, null, -5], seed: 0.9, dismissed: undefined },
  ])('$name: 종료 시각이 지난 공지의 hidden도 컴포넌트 계산과 같다', ({ barEnds, stripEnds, seed, dismissed }) => {
    const T = Date.UTC(2026, 9, 23, 9, 0, 0);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T);
    const at = (offset: number | null) => (offset === null ? null : T + offset);
    const bars = [bar('b1', { endsAt: at(barEnds[0]) }), bar('b2', { endsAt: at(barEnds[1]) }), bar('b3', { endsAt: at(barEnds[2]) })];
    const strips = [strip('s1', { endsAt: at(stripEnds[0]) }), strip('s2', { endsAt: at(stripEnds[1]) }), strip('s3', { endsAt: at(stripEnds[2]) })];
    const result = run({
      bars: bars.map((item) => item.key), strips: strips.map((item) => item.id), dismissed, seed,
      barEnds: bars.map((item) => item.endsAt), stripEnds: strips.map((item) => item.endsAt),
    });
    const now = initialShellNoticeNow(result.scope);
    expect(now).toBe(T);
    const visible = firstVisibleNoticeBar(bars, readDismissedNoticeKeys(result.storage), now);
    expect(result.barElements.map((element) => !element.hidden)).toEqual(bars.map((item) => item === visible));
    const index = visibleNoticeStripIndex(strips, readShellNoticeSeed(result.scope), now);
    expect(result.stripElements.map((element) => !element.hidden)).toEqual(strips.map((_, i) => i === index));
  });

  it('시드가 없으면 하드 로드마다 새로 뽑아 남기고, 공지 묶음이 없는 화면에서도 뒤 화면 이동을 위해 남긴다', () => {
    const first = run({ bars: [], strips: [], rootPresent: false });
    const seed = first.scope[SHELL_NOTICE_SEED_GLOBAL];
    expect(typeof seed).toBe('number');
    expect(seed as number).toBeGreaterThanOrEqual(0);
    expect(seed as number).toBeLessThan(1);
    expect(readShellNoticeSeed(first.scope)).toBe(seed);
    expect(run({ bars: [], strips: ['a', 'b'], seed: 0.75 }).scope[SHELL_NOTICE_SEED_GLOBAL]).toBe(0.75);
    /* 판정 시각도 공지 묶음이 없는 화면에서 남긴다 — 하이드레이션이 같은 시각으로 판정한다. */
    expect(typeof first.scope[SHELL_NOTICE_NOW_GLOBAL]).toBe('number');
  });

  it('운영 입력을 끼워 넣지 않는 고정 소스다', () => {
    expect(SHELL_NOTICE_SCRIPT).not.toMatch(/<\/script/i);
    expect(SHELL_NOTICE_SCRIPT).toContain(JSON.stringify(SHELL_NOTICE_DISMISSED_KEY));
    expect(SHELL_NOTICE_SCRIPT.startsWith('(function(){try{')).toBe(true);
  });

  /* l8a-qa-1: 이 스크립트는 head 스타일시트가 끝난 뒤(로컬 실측 첫 페인트 15~20ms 전)에야 돈다. 여기서 고른 후보만 eager로 바꾸는 식으로
     숨은 후보를 미루면, 첫 후보가 아닌 후보가 뽑힌 하드 로드는 이미지 요청이 그때서야 시작돼 첫 페인트 뒤에 끼어든다.
     후보 이미지는 서버 마크업에서 모두 eager이고 스크립트는 hidden만 고친다. */
  it('스트립 이미지의 loading을 바꾸지 않는다 — 어느 후보가 뽑혀도 HTML 파싱 중 이미 요청된 상태다', () => {
    expect(SHELL_NOTICE_SCRIPT).not.toMatch(/loading/i);
  });
});

describe('띠배너 자리 크기', () => {
  const PC = { width: 1440, height: 36 };
  const MOBILE = { width: 375, height: 52 };
  it('모바일 소스가 없으면 PC 크기, 있으면 둘 다 알 때만 단다', () => {
    expect(noticeStripDimensions(strip('a', { imageSize: PC }))).toEqual({ image: PC, mobile: null });
    expect(noticeStripDimensions(strip('b', { mobileImageUrl: 'https://cdn.example/b-m.webp', imageSize: PC, mobileImageSize: MOBILE }))).toEqual({ image: PC, mobile: MOBILE });
    /* 고른 <source> 에 크기가 없으면 브라우저는 <img> 크기로 비율을 잡는다 — 모바일에 PC 비율이 쓰이지 않게 둘 다 뺀다. */
    expect(noticeStripDimensions(strip('c', { mobileImageUrl: 'https://cdn.example/c-m.webp', imageSize: PC, mobileImageSize: null }))).toEqual({ image: null, mobile: null });
    expect(noticeStripDimensions(strip('d', { mobileImageUrl: 'https://cdn.example/d-m.webp', imageSize: null, mobileImageSize: MOBILE }))).toEqual({ image: null, mobile: MOBILE });
    /* 모바일 소스가 없는데 남은 모바일 크기는 쓰지 않는다. 크기를 모르는 기존 스트립은 그리던 그대로다. */
    expect(noticeStripDimensions(strip('e', { imageSize: PC, mobileImageSize: MOBILE }))).toEqual({ image: PC, mobile: null });
    expect(noticeStripDimensions(strip('f'))).toEqual({ image: null, mobile: null });
  });
});
