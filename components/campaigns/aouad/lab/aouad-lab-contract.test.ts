import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hub = readFileSync(new URL('./ComparisonLabHub.tsx', import.meta.url), 'utf8');
const infection = readFileSync(new URL('./InfectionRecordPrototype.tsx', import.meta.url), 'utf8');
const arcade = readFileSync(new URL('./SurvivalArcadePrototype.tsx', import.meta.url), 'utf8');
const resultActions = readFileSync(new URL('./ComparisonResultActions.tsx', import.meta.url), 'utf8');

describe('AOUAD G2 lab client contracts', () => {
  it('keeps the three candidates visible from one comparison hub', () => {
    expect(hub).toContain("id: 'last-bell'");
    expect(hub).toContain("id: 'infection-record'");
    expect(hub).toContain("id: 'survival-arcade'");
    expect(hub).toContain("prefetch={candidate.id === 'last-bell' ? false : undefined}");
  });

  it('keeps the low-cost candidates free of Three/R3F and uses Next Image references', () => {
    for (const source of [hub, infection, arcade]) {
      expect(source).toContain("from 'next/image'");
      expect(source).not.toContain(' priority ');
      expect(source).not.toMatch(/@react-three|three|LastBellRuntime/i);
    }
  });

  it('gives every result the same retry, share, popup, and store exit actions', () => {
    expect(resultActions).toContain('다시 하기');
    expect(resultActions).toContain('결과 공유');
    expect(resultActions).toContain('팝업으로 돌아가기');
    expect(resultActions).toContain('매점 미리보기');
  });
});
