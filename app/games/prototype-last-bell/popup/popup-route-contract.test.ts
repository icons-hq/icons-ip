import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const zonePage = readFileSync(new URL('./[zone]/page.tsx', import.meta.url), 'utf8');
const popup = readFileSync(new URL('../../../../components/campaigns/aouad/AouadCampaignPopup.tsx', import.meta.url), 'utf8');
const provider = readFileSync(new URL('../../../../components/campaigns/aouad/AouadCampaignProvider.tsx', import.meta.url), 'utf8');

describe('AOUAD popup route contract', () => {
  it('is noindex and has the same request-time Last Bell prototype gate on every route surface', () => {
    expect(layout).toContain('robots: { index: false, follow: false }');
    for (const source of [layout, page, zonePage]) {
      expect(source).toContain('await connection()');
      expect(source).toContain('isLastBellPrototypeEnabled()');
      expect(source).toContain('notFound()');
    }
  });

  it('uses Next 16 async params and fails closed for unknown zones', () => {
    expect(zonePage).toContain('params: Promise<{ zone: string }>');
    expect(zonePage).toContain('const { zone } = await params');
    expect(zonePage).toContain('if (!isAouadZoneId(zone)) notFound()');
  });

  it('owns one campaign provider in the persistent popup layout so storage-blocked soft navigation keeps in-memory progress', () => {
    expect(layout).toContain("import { AouadCampaignProvider } from '@/components/campaigns/aouad/AouadCampaignProvider'");
    expect(layout).toContain('return <AouadCampaignProvider>{children}</AouadCampaignProvider>;');
    expect(popup).not.toContain('<AouadCampaignProvider>');
    expect(provider).toContain('const storage = getOptionalStorage()');
    expect(provider).toContain('if (storage) saveAouadCampaignState(storage, next);');
    expect(provider).not.toContain('window.localStorage');
  });

  it('preloads only the visible hub or zone hero after the persistent in-memory opening state is dismissed', () => {
    expect(popup).toContain('preloadHero={!openingOpen}');
    expect(popup.match(/preload=\{preloadHero && state\.openingSeen\}/g)).toHaveLength(2);
    expect(popup).toContain('? <ZoneView zone={zone} preloadHero={!openingOpen} entry={entry} />');
    expect(popup).toContain(': <Hub studentPhotoUrl={studentPhoto.photoUrl} includeStudentPhotoInShare={studentPhoto.includeInShare} preloadHero={!openingOpen} entry={entry} />');
  });

  it('passes request-time auth and verified-host context without making the client shell authoritative', () => {
    expect(page).toContain('getAouadGameEntryContext()');
    expect(page).toContain('<AouadCampaignPopup entry={entry} />');
    expect(zonePage).toContain('<AouadCampaignPopup zone={zone} entry={entry} />');
    expect(popup).toContain("entry.authority === 'verified-candidate'");
    expect(popup).toContain('로그인하고 시작');
    expect(popup).toContain('게스트로 시작');
  });
});
