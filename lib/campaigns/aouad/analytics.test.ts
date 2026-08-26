import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isAouadCampaignEvent, trackAouadCampaignEvent } from './analytics';

describe('AOUAD local analytics seam', () => {
  it('accepts only a closed, anonymous event payload at runtime', () => {
    const event = { type: 'zone_completed', zone: 'broadcast' } as const;
    expect(trackAouadCampaignEvent(event)).toEqual(event);
  });

  it('rejects forged personal fields and every additional event key at runtime', () => {
    const forgedEvents = [
      { type: 'zone_completed', zone: 'broadcast', name: '학생 25번' },
      { type: 'zone_completed', zone: 'broadcast', photo: '/local/avatar.webp' },
      { type: 'zone_completed', zone: 'broadcast', freeText: '개인 메모' },
      { type: 'game_start_clicked', unexpected: true },
    ];

    for (const event of forgedEvents) {
      expect(isAouadCampaignEvent(event)).toBe(false);
      expect(trackAouadCampaignEvent(event)).toBeNull();
    }
  });

  it('does not add a remote transport or user-provided identity field', () => {
    const source = readFileSync(new URL('./analytics.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('sendBeacon');
    expect(source).not.toContain('name:');
    expect(source).not.toContain('avatar:');
  });
});
