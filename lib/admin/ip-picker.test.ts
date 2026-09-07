import { describe, expect, it } from 'vitest';
import {
  IP_PICKER_PAGE_LIMIT,
  IP_PICKER_RECENT_LIMIT,
  buildPickerOptions,
  parseRecentIps,
  rememberRecentIp,
  serializeRecentIps,
  type IpPickerOption,
} from './ip-picker';

function option(id: string, title = `IP ${id}`): IpPickerOption {
  return { id, title, archivedAt: null };
}

describe('parseRecentIps', () => {
  it('빈 값·깨진 JSON·배열이 아닌 값은 빈 목록', () => {
    expect(parseRecentIps('')).toEqual([]);
    expect(parseRecentIps('{')).toEqual([]);
    expect(parseRecentIps('{"id":"a"}')).toEqual([]);
  });

  it('id·title 이 온전한 항목만 남기고 중복은 하나만 남긴다', () => {
    const raw = JSON.stringify([
      { id: 'a', title: '가' },
      { id: 'a', title: '가(중복)' },
      { id: 'b' },
      { id: '', title: '빈 id' },
      { id: 'c', title: '다' },
    ]);
    expect(parseRecentIps(raw)).toEqual([option('a', '가'), option('c', '다')]);
  });

  it('저장된 항목이 상한을 넘어도 상한까지만 읽는다', () => {
    const raw = JSON.stringify(
      Array.from({ length: IP_PICKER_RECENT_LIMIT + 5 }, (_, index) => ({
        id: `ip-${index}`,
        title: `IP ${index}`,
      })),
    );
    expect(parseRecentIps(raw)).toHaveLength(IP_PICKER_RECENT_LIMIT);
  });
});

describe('rememberRecentIp', () => {
  it('고른 것이 맨 앞으로 오고 같은 id 는 하나만 남는다', () => {
    const current = [option('a'), option('b'), option('c')];
    expect(rememberRecentIp(current, option('b')).map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
  });

  it('상한을 넘으면 오래된 것부터 밀린다', () => {
    const current = Array.from({ length: IP_PICKER_RECENT_LIMIT }, (_, index) => option(`ip-${index}`));
    const next = rememberRecentIp(current, option('new'));
    expect(next).toHaveLength(IP_PICKER_RECENT_LIMIT);
    expect(next[0].id).toBe('new');
    expect(next.some((entry) => entry.id === `ip-${IP_PICKER_RECENT_LIMIT - 1}`)).toBe(false);
  });

  it('직렬화는 id·title 만 남긴다(보관 여부는 서버가 매번 새로 준다)', () => {
    const raw = serializeRecentIps([{ id: 'a', title: '가', archivedAt: '2026-01-01T00:00:00Z' }]);
    expect(JSON.parse(raw)).toEqual([{ id: 'a', title: '가' }]);
  });
});

describe('buildPickerOptions', () => {
  it('검색어가 없으면 최근 고른 것이 서버 목록보다 앞에 온다', () => {
    const options = buildPickerOptions({
      query: '',
      results: [option('x'), option('y')],
      recents: [option('y'), option('z')],
      selected: null,
    });
    expect(options.map((entry) => entry.id)).toEqual(['y', 'z', 'x']);
  });

  it('검색어가 있으면 최근 고른 것을 섞지 않는다', () => {
    const options = buildPickerOptions({
      query: '화산',
      results: [option('hwasan')],
      recents: [option('other')],
      selected: null,
    });
    expect(options.map((entry) => entry.id)).toEqual(['hwasan']);
  });

  it('선택된 IP 는 결과에 없어도 목록에 남는다', () => {
    const options = buildPickerOptions({
      query: '없는이름',
      results: [],
      recents: [],
      selected: { id: 'archived', title: '보관 IP', archivedAt: '2026-01-01T00:00:00Z' },
    });
    expect(options.map((entry) => entry.id)).toEqual(['archived']);
  });

  it('전량 로더가 상한보다 많이 넘겨도 한 페이지만 그린다', () => {
    const results = Array.from({ length: IP_PICKER_PAGE_LIMIT + 40 }, (_, index) => option(`ip-${index}`));
    expect(buildPickerOptions({ query: '', results, recents: [], selected: null })).toHaveLength(
      IP_PICKER_PAGE_LIMIT,
    );
  });

  it('선택된 IP 가 상한 뒤쪽에 있어도 잘리지 않고 맨 위로 온다', () => {
    const results = Array.from({ length: IP_PICKER_PAGE_LIMIT + 40 }, (_, index) => option(`ip-${index}`));
    const options = buildPickerOptions({
      query: '',
      results,
      recents: [],
      selected: option('ip-80'),
    });
    expect(options[0].id).toBe('ip-80');
    expect(options).toHaveLength(IP_PICKER_PAGE_LIMIT);
  });

  it('선택된 IP 가 결과에 이미 있으면 중복으로 넣지 않는다', () => {
    const options = buildPickerOptions({
      query: '',
      results: [option('a'), option('b')],
      recents: [],
      selected: option('a'),
    });
    expect(options.map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});
