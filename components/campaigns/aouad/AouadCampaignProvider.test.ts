import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AouadCampaignProvider.tsx', import.meta.url), 'utf8');

describe('AOUAD campaign local-storage resilience', () => {
  it('hydrates and updates the in-memory campaign state when the localStorage getter is unavailable', () => {
    expect(source).toContain("from '@/lib/campaigns/aouad/browser-storage'");
    expect(source).toContain('const storage = getOptionalStorage()');
    expect(source).toContain('storage ? loadLastBellCompletion(storage) : null');
    expect(source).toContain('storage ? loadAouadCampaignState(storage) : initialAouadCampaignState');
    expect(source).toContain('if (storage) saveAouadCampaignState(storage, next);');
    expect(source).not.toContain('window.localStorage');
  });
});
