import { describe, expect, it } from 'vitest';
import { CONTACT_CHANNELS_PRIVACY_EFFECTIVE_DATE, contactChannelsLegalGateOpen, envSwitchOn } from './contact-channels';

describe('contactChannelsLegalGateOpen', () => {
  /* 처리방침 개정이 공지·시행되기 전에는 운영에서 env 스위치만으로 열리지 않는다. */
  it('keeps production closed until the privacy revision date is set and reached (KST)', () => {
    const production = { VERCEL_ENV: 'production' };
    expect(CONTACT_CHANNELS_PRIVACY_EFFECTIVE_DATE).toBeNull();
    expect(contactChannelsLegalGateOpen(production, new Date('2026-12-01T00:00:00Z'))).toBe(false);
    expect(contactChannelsLegalGateOpen(production, new Date('2026-11-19T14:59:59Z'), '2026-11-20')).toBe(false);
    expect(contactChannelsLegalGateOpen(production, new Date('2026-11-19T15:00:00Z'), '2026-11-20')).toBe(true);
    expect(contactChannelsLegalGateOpen(production, new Date('2026-12-01T00:00:00Z'), '20261120')).toBe(false);
  });

  it('lets preview and local runs open with the env switch alone', () => {
    expect(contactChannelsLegalGateOpen({ VERCEL_ENV: 'preview' }, new Date())).toBe(true);
    expect(contactChannelsLegalGateOpen({}, new Date())).toBe(true);
  });
});

describe('envSwitchOn', () => {
  it('turns on only for the exact string true', () => {
    expect(envSwitchOn({ FLAG: 'true' }, 'FLAG')).toBe(true);
    for (const value of [undefined, '', '1', 'TRUE', 'yes', ' true']) {
      expect(envSwitchOn({ FLAG: value }, 'FLAG')).toBe(false);
    }
  });
});
