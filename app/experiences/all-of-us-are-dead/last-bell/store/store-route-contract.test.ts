import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const store = readFileSync(
  new URL('../../../../../components/campaigns/aouad/AouadVerifiedStore.tsx', import.meta.url),
  'utf8',
);

describe('Last Bell verified store route', () => {
  it('uses the same request-time verified gate and remains unindexable', () => {
    expect(page).toContain('robots: { index: false, follow: false }');
    expect(page).toContain('await connection()');
    expect(page).toContain('isLastBellVerifiedExperienceEnabled()');
    expect(page).toContain('notFound()');
  });

  it('owns the campaign provider and never links its completion path back to the prototype popup', () => {
    expect(page).toContain('<AouadCampaignProvider>');
    expect(store).toContain('LAST_BELL_VERIFIED_STORE_PATH');
    expect(store).not.toContain('/games/prototype-last-bell/popup');
  });
});
