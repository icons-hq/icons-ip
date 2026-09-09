import { describe, expect, it } from 'vitest';

import {
  appendLeaderboardRecord,
  parseLeaderboardRecords,
  rankScoreRecords,
  rankSpeedrunRecords,
  type LeaderboardRecord,
} from './leaderboard';

const baseRecord: LeaderboardRecord = {
  id: 'base',
  seed: 'seed-base',
  rawScore: 10_000,
  clear: false,
  bossSplitTicks: null,
  completionTicks: 20_000,
  recordedAt: 1_786_659_200_000,
  debug: false,
};

function record(
  id: string,
  overrides: Partial<LeaderboardRecord> = {},
): LeaderboardRecord {
  return { ...baseRecord, id, seed: `seed-${id}`, ...overrides };
}

describe('rankScoreRecords', () => {
  it('debug 기록을 제외하고 합의한 전체 tie-break 순서로 정렬한다', () => {
    const records = [
      record('debug', { rawScore: 99_999, debug: true }),
      record('low-score', { rawScore: 9_999 }),
      record('not-clear', { rawScore: 20_000 }),
      record('split-null', { rawScore: 20_000, clear: true }),
      record('split-late', {
        rawScore: 20_000,
        clear: true,
        bossSplitTicks: 3_000,
      }),
      record('completion-late', {
        rawScore: 20_000,
        clear: true,
        bossSplitTicks: 2_000,
        completionTicks: 24_000,
      }),
      record('recorded-late', {
        rawScore: 20_000,
        clear: true,
        bossSplitTicks: 2_000,
        completionTicks: 23_000,
        recordedAt: 1_786_659_200_001,
      }),
      record('id-z', {
        rawScore: 20_000,
        clear: true,
        bossSplitTicks: 2_000,
        completionTicks: 23_000,
      }),
      record('id-a', {
        rawScore: 20_000,
        clear: true,
        bossSplitTicks: 2_000,
        completionTicks: 23_000,
      }),
    ];

    expect(rankScoreRecords(records).map(({ id }) => id)).toEqual([
      'id-a',
      'id-z',
      'recorded-late',
      'completion-late',
      'split-late',
      'split-null',
      'not-clear',
      'low-score',
    ]);
    expect(records[0]?.id).toBe('debug');
  });
});

describe('rankSpeedrunRecords', () => {
  it('정상 클리어 기록만 split, 점수, 완료 시각, 기록 시각, id 순으로 정렬한다', () => {
    const records = [
      record('loss', { rawScore: 99_999 }),
      record('missing-split', { rawScore: 99_999, clear: true }),
      record('debug', {
        rawScore: 99_999,
        clear: true,
        bossSplitTicks: 1,
        debug: true,
      }),
      record('slow', {
        rawScore: 99_999,
        clear: true,
        bossSplitTicks: 3_000,
      }),
      record('low-score', {
        rawScore: 19_999,
        clear: true,
        bossSplitTicks: 2_000,
      }),
      record('completion-late', {
        rawScore: 20_000,
        clear: true,
        bossSplitTicks: 2_000,
        completionTicks: 24_000,
      }),
      record('recorded-late', {
        rawScore: 20_000,
        clear: true,
        bossSplitTicks: 2_000,
        completionTicks: 23_000,
        recordedAt: 1_786_659_200_001,
      }),
      record('id-z', {
        rawScore: 20_000,
        clear: true,
        bossSplitTicks: 2_000,
        completionTicks: 23_000,
      }),
      record('id-a', {
        rawScore: 20_000,
        clear: true,
        bossSplitTicks: 2_000,
        completionTicks: 23_000,
      }),
    ];

    expect(rankSpeedrunRecords(records).map(({ id }) => id)).toEqual([
      'id-a',
      'id-z',
      'recorded-late',
      'completion-late',
      'low-score',
      'slow',
    ]);
  });
});

describe('local leaderboard persistence helpers', () => {
  it('직렬화된 정상 기록 배열만 파싱한다', () => {
    const input = [
      baseRecord,
      record('clear', { clear: true, bossSplitTicks: 2_000 }),
    ];

    expect(parseLeaderboardRecords(JSON.stringify(input))).toEqual(input);
  });

  it.each([
    ['invalid JSON', '{'],
    ['not an array', '{}'],
    ['malformed member', JSON.stringify([baseRecord, { id: 'broken' }])],
    [
      'logically impossible clear state',
      JSON.stringify([record('bad', { clear: false, bossSplitTicks: 1 })]),
    ],
  ])('%s 입력은 빈 배열로 fail closed 한다', (_label, serialized) => {
    expect(parseLeaderboardRecords(serialized)).toEqual([]);
  });

  it('새 기록을 끝에 추가하고 저장 cap을 넘으면 가장 오래된 항목부터 버린다', () => {
    const first = record('first', { recordedAt: 1 });
    const second = record('second', { recordedAt: 2 });
    const third = record('third', { recordedAt: 3 });

    expect(appendLeaderboardRecord([first, second], third, 2)).toEqual([
      second,
      third,
    ]);
  });

  it('malformed 기존 목록이나 신규 기록, 잘못된 cap은 빈 배열로 fail closed 한다', () => {
    expect(
      appendLeaderboardRecord(
        [baseRecord, { ...baseRecord, rawScore: Number.NaN }],
        record('new'),
      ),
    ).toEqual([]);
    expect(
      appendLeaderboardRecord([], { ...baseRecord, id: '' }, 10),
    ).toEqual([]);
    expect(appendLeaderboardRecord([], record('new'), -1)).toEqual([]);
  });
});
