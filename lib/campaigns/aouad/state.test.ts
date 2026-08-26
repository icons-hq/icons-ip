import { describe, expect, it } from 'vitest';
import {
  AOUAD_CAMPAIGN_STORAGE_KEY,
  aouadRallyCount,
  initialAouadCampaignState,
  isAouadRallyComplete,
  loadAouadCampaignState,
  parseAouadCampaignState,
  saveAouadCampaignState,
  withAouadZoneComplete,
} from './state';

function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    read: () => value,
  };
}

describe('AouadCampaignState', () => {
  it('rejects malformed and future schema payloads into a safe memory default', () => {
    expect(parseAouadCampaignState({ schemaVersion: 2 })).toBeNull();
    expect(loadAouadCampaignState(storage('{not json'))).toEqual(initialAouadCampaignState);
  });

  it('migrates the pre-schema local shape without accepting untrusted values', () => {
    const migrated = parseAouadCampaignState({
      op: true,
      callsign: '  지수  ',
      clears: { cafeteria: true, broadcast: true, rooftop: true, injected: true },
      desks: ['radio', 'journal', 'coupon', 'invalid', 17],
      endings: ['signal', 'invalid'],
      wishes: ['id-set', 'unexpected'],
    });

    expect(migrated).toMatchObject({
      schemaVersion: 1,
      openingSeen: true,
      student: { name: '지수', avatar: null },
      zones: { classroom: true, cafeteria: true, broadcast: true, theater: true, rooftop: true },
      classroomRecords: ['radio', 'journal', 'coupon'],
      theaterEndings: ['signal'],
      wishlist: ['idcard'],
    });
  });

  it('keeps the session in memory when storage writes fail', () => {
    const unavailable = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
    };
    expect(saveAouadCampaignState(unavailable, initialAouadCampaignState)).toBe(false);
  });

  it('counts the five local rally seals independently from Last Bell', () => {
    let state = initialAouadCampaignState;
    for (const zone of ['classroom', 'cafeteria', 'broadcast', 'theater', 'rooftop'] as const) {
      state = withAouadZoneComplete(state, zone);
    }
    expect(aouadRallyCount(state)).toBe(5);
    expect(isAouadRallyComplete(state)).toBe(true);
  });

  it('serializes the named v1 local-storage key', () => {
    const target = storage();
    expect(saveAouadCampaignState(target, initialAouadCampaignState)).toBe(true);
    expect(target.read()).toContain('"schemaVersion":1');
    expect(AOUAD_CAMPAIGN_STORAGE_KEY).toBe('icons:aouad-campaign:v1');
  });
});
