import { describe, expect, it } from 'vitest';
import { DIRECTORY_LETTERS, directoryInitial, filterIpsByLetter, sortIpsForDirectory } from './ip-directory';

/* ip-display META 등재 여부가 표시명을 가른다 — rilakkuma는 'RILAKKUMA', 미등재 id는 한글 title 폴백. */
const ipOf = (id: string, title: string) => ({ id, title });
const rilakkuma = ipOf('rilakkuma', '리락쿠마');
const maplestory = ipOf('maplestory', '메이플스토리');
const hongsil = ipOf('hong-sil-quest', '홍실이 퀘스트');
const unlisted = ipOf('hwasan', '화산강림');

/* R-03 §3 브랜드 디렉토리 — A–Z 인덱스는 ALL + A–Z + ETC 28항목이고,
 * 레터 분류는 표시명(영문 우선)의 첫 글자로 한다. A–Z 밖(한글·숫자·기호)은 전부 ETC. */

describe('directoryInitial', () => {
  it('uses the uppercased first letter of a latin display name', () => {
    expect(directoryInitial('RILAKKUMA')).toBe('R');
    expect(directoryInitial('maplestory')).toBe('M');
  });

  it('buckets names that do not start with A–Z under ETC', () => {
    expect(directoryInitial('화산강림')).toBe('ETC');
    expect(directoryInitial('1st Anniversary')).toBe('ETC');
    expect(directoryInitial('#Hashtag')).toBe('ETC');
  });

  it('ignores leading whitespace and buckets empty names under ETC', () => {
    expect(directoryInitial('  Kakao Friends')).toBe('K');
    expect(directoryInitial('')).toBe('ETC');
    expect(directoryInitial('   ')).toBe('ETC');
  });
});

describe('filterIpsByLetter', () => {
  const ips = [rilakkuma, maplestory, hongsil, unlisted];

  it('returns every ip untouched for ALL', () => {
    expect(filterIpsByLetter(ips, 'ALL')).toEqual(ips);
  });

  it('keeps only ips whose display name starts with the letter', () => {
    expect(filterIpsByLetter(ips, 'R')).toEqual([rilakkuma, hongsil]);
    expect(filterIpsByLetter(ips, 'M')).toEqual([maplestory]);
    expect(filterIpsByLetter(ips, 'B')).toEqual([]);
  });

  it('collects non-latin display names under ETC', () => {
    expect(filterIpsByLetter(ips, 'ETC')).toEqual([unlisted]);
  });
});

describe('sortIpsForDirectory', () => {
  it('orders by display name A→Z with ETC entries last', () => {
    expect(sortIpsForDirectory([unlisted, rilakkuma, hongsil, maplestory])).toEqual([
      maplestory, // MAPLESTORY
      hongsil, // RED THREAD QUEST
      rilakkuma, // RILAKKUMA
      unlisted, // 화산강림 → ETC
    ]);
  });

  it('does not mutate the input list', () => {
    const input = [rilakkuma, maplestory];
    sortIpsForDirectory(input);
    expect(input).toEqual([rilakkuma, maplestory]);
  });
});

describe('DIRECTORY_LETTERS', () => {
  it('renders the R-03 §3 index bar: ALL, then A–Z, then ETC — 28 entries', () => {
    expect(DIRECTORY_LETTERS).toHaveLength(28);
    expect(DIRECTORY_LETTERS[0]).toBe('ALL');
    expect(DIRECTORY_LETTERS[1]).toBe('A');
    expect(DIRECTORY_LETTERS[26]).toBe('Z');
    expect(DIRECTORY_LETTERS[27]).toBe('ETC');
  });
});
