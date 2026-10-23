import { describe, expect, it } from 'vitest';
import {
  applicableShellNotices,
  firstVisibleNoticeBar,
  noticeStripIndex,
  parseShellNoticePageTypes,
  readDismissedNoticeKeys,
  readShellNoticeSeed,
  rememberDismissedNotice,
  SHELL_NOTICE_DISMISSED_KEY,
  SHELL_NOTICE_ROOT_ID,
  SHELL_NOTICE_SCRIPT,
  SHELL_NOTICE_SEED_GLOBAL,
  shellNoticePageType,
  type ShellNoticeBar,
  type ShellNotices,
  type ShellNoticeStrip,
} from './shell-notices';

const bar = (id: string, patch: Partial<ShellNoticeBar> = {}): ShellNoticeBar => ({
  id, key: `${id}:k`, message: `공지 ${id}`, cta: { label: '자세히 보기', href: '/events' },
  pageTypes: ['home', 'collection', 'product', 'content', 'other'], ...patch,
});
const strip = (id: string, patch: Partial<ShellNoticeStrip> = {}): ShellNoticeStrip => ({
  id, title: `띠배너 ${id}`, imageUrl: `https://cdn.example/${id}.webp`, mobileImageUrl: null, href: '/events',
  pageTypes: null, ...patch,
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

  function run({ bars, strips, dismissed, seed, rootPresent = true }: {
    bars: string[]; strips: string[]; dismissed?: string; seed?: unknown; rootPresent?: boolean;
  }) {
    const barElements = bars.map((key, index) => new FakeElement({ 'data-notice-bar': key, ...(index > 0 ? { hidden: '' } : {}) }));
    const stripElements = strips.map((id, index) => new FakeElement({ 'data-notice-strip': id, ...(index > 0 ? { hidden: '' } : {}) }));
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

  it('시드가 없으면 하드 로드마다 새로 뽑아 남기고, 공지 묶음이 없는 화면에서도 뒤 화면 이동을 위해 남긴다', () => {
    const first = run({ bars: [], strips: [], rootPresent: false });
    const seed = first.scope[SHELL_NOTICE_SEED_GLOBAL];
    expect(typeof seed).toBe('number');
    expect(seed as number).toBeGreaterThanOrEqual(0);
    expect(seed as number).toBeLessThan(1);
    expect(readShellNoticeSeed(first.scope)).toBe(seed);
    expect(run({ bars: [], strips: ['a', 'b'], seed: 0.75 }).scope[SHELL_NOTICE_SEED_GLOBAL]).toBe(0.75);
  });

  it('운영 입력을 끼워 넣지 않는 고정 소스다', () => {
    expect(SHELL_NOTICE_SCRIPT).not.toMatch(/<\/script/i);
    expect(SHELL_NOTICE_SCRIPT).toContain(JSON.stringify(SHELL_NOTICE_DISMISSED_KEY));
    expect(SHELL_NOTICE_SCRIPT.startsWith('(function(){try{')).toBe(true);
  });
});
