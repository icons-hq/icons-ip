import { describe, expect, it } from 'vitest';
import type { FandomEvent } from './data';
import {
  ALL_IPS,
  ALL_MODES,
  ALL_STATUSES,
  eventModeOptions,
  eventStatusOptions,
  selectFandomEvents,
  selectOfflinePopupEvents,
} from './events-catalog';

function event(id: string, overrides: Partial<FandomEvent> = {}): FandomEvent {
  return {
    id,
    title: `이벤트 ${id}`,
    ip: 'ip1',
    mode: '오프라인',
    status: '예정',
    date: '5.10',
    loc: '서울',
    accent: '#fff',
    img: `img-${id}`,
    ...overrides,
  };
}

describe('selectFandomEvents', () => {
  it('IP로 필터링하고, 전체 IP는 IP 없는 이벤트도 포함한다', () => {
    const events = [event('a', { ip: 'ip1' }), event('b', { ip: 'ip2' }), event('c', { ip: null })];
    expect(selectFandomEvents(events, { ipId: 'ip1', mode: ALL_MODES, status: ALL_STATUSES }).map((e) => e.id)).toEqual(['a']);
    expect(selectFandomEvents(events, { ipId: ALL_IPS, mode: ALL_MODES, status: ALL_STATUSES }).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('모드로 필터링한다', () => {
    const events = [event('a', { mode: '온라인' }), event('b', { mode: '오프라인' })];
    expect(selectFandomEvents(events, { ipId: ALL_IPS, mode: '온라인', status: ALL_STATUSES }).map((e) => e.id)).toEqual(['a']);
  });

  it('상태로 필터링한다', () => {
    const events = [event('a', { status: '예매중' }), event('b', { status: '예정' })];
    expect(selectFandomEvents(events, { ipId: ALL_IPS, mode: ALL_MODES, status: '예매중' }).map((e) => e.id)).toEqual(['a']);
  });

  it('IP·모드·상태를 함께 적용한다', () => {
    const events = [
      event('a', { ip: 'ip1', mode: '온라인', status: '예매중' }),
      event('b', { ip: 'ip1', mode: '오프라인', status: '예매중' }),
      event('c', { ip: 'ip2', mode: '온라인', status: '예매중' }),
    ];
    expect(selectFandomEvents(events, { ipId: 'ip1', mode: '온라인', status: '예매중' }).map((e) => e.id)).toEqual(['a']);
  });

  it('진행중 → 예매중 → 예정 우선순위로 정렬하고 같은 상태는 원본 순서를 유지한다', () => {
    const events = [
      event('a', { status: '예정' }),
      event('b', { status: '진행중' }),
      event('c', { status: '예매중' }),
      event('d', { status: '예정' }),
    ];
    expect(selectFandomEvents(events, { ipId: ALL_IPS, mode: ALL_MODES, status: ALL_STATUSES }).map((e) => e.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('입력 배열을 변형하지 않는다', () => {
    const events = [event('a', { status: '예정' }), event('b', { status: '진행중' })];
    const input = [...events];
    selectFandomEvents(input, { ipId: ALL_IPS, mode: ALL_MODES, status: ALL_STATUSES });
    expect(input.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('selectOfflinePopupEvents', () => {
  /* /offline-popups 는 오프라인만 맡는 표면이다 — 온라인 팝업의 정본 자리는 IP 관이다. */
  it('온라인 이벤트를 뺀다', () => {
    const events = [
      event('a', { mode: '오프라인' }),
      event('b', { mode: '온라인' }),
      event('c', { mode: '오프라인' }),
    ];

    expect(selectOfflinePopupEvents(events).map((e) => e.id)).toEqual(['a', 'c']);
  });

  /* 모르는 값을 감추면 운영자가 등록한 팝업이 어느 화면에도 뜨지 않는 쪽으로 사라진다. */
  it('모드가 비었거나 모르는 값이면 남긴다', () => {
    const events = [event('a', { mode: '' }), event('b', { mode: '하이브리드' })];

    expect(selectOfflinePopupEvents(events).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('입력 배열을 변형하지 않는다', () => {
    const input = [event('a', { mode: '온라인' }), event('b', { mode: '오프라인' })];

    selectOfflinePopupEvents(input);

    expect(input.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('eventModeOptions', () => {
  it('등장한 모드만 온라인·오프라인 표준 순서로 반환한다', () => {
    const events = [event('a', { mode: '오프라인' }), event('b', { mode: '온라인' })];
    expect(eventModeOptions(events)).toEqual(['온라인', '오프라인']);
  });
});

describe('eventStatusOptions', () => {
  it('등장한 상태만 진행중·예매중·예정 표준 순서로 반환한다', () => {
    const events = [event('a', { status: '예정' }), event('b', { status: '진행중' })];
    expect(eventStatusOptions(events)).toEqual(['진행중', '예정']);
  });
});
