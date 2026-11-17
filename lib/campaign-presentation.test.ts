import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_POPUP_MODES,
  CAMPAIGN_POPUP_MODE_LABELS,
  CAMPAIGN_PRESENTATION_MESSAGES,
  isCampaignPopupMode,
  normalizeCampaignPresentationInput,
  parseCampaignPresentationRow,
} from './campaign-presentation';

describe('campaign presentation vocabulary', () => {
  it('has three popup modes with the customer-facing labels', () => {
    expect(CAMPAIGN_POPUP_MODES).toEqual(['online', 'offline', 'hybrid']);
    expect(CAMPAIGN_POPUP_MODE_LABELS).toEqual({ online: '온라인', offline: '오프라인', hybrid: '온·오프라인' });
    expect(isCampaignPopupMode('hybrid')).toBe(true);
    for (const bad of ['', 'ONLINE', 'popup', undefined, null, 1]) expect(isCampaignPopupMode(bad), String(bad)).toBe(false);
  });
});

describe('parseCampaignPresentationRow', () => {
  it('reads a full DB row', () => {
    expect(parseCampaignPresentationRow({
      popup_mode: 'hybrid', popup_location: '서울 마포구 월드컵로8길 69 1층', card_link_path: '/ip/hong-sil-quest',
    })).toEqual({ popupMode: 'hybrid', popupLocation: '서울 마포구 월드컵로8길 69 1층', cardLinkPath: '/ip/hong-sil-quest' });
  });

  it('reads partial rows: a shortcut-only EVENT row and a POP-UP row without a place', () => {
    expect(parseCampaignPresentationRow({ popup_mode: null, popup_location: null, card_link_path: '/shop/new' }))
      .toEqual({ popupMode: null, popupLocation: null, cardLinkPath: '/shop/new' });
    expect(parseCampaignPresentationRow({ popup_mode: 'online' }))
      .toEqual({ popupMode: 'online', popupLocation: null, cardLinkPath: null });
  });

  it('unwraps a one-row array embed and treats an empty embed as no row', () => {
    expect(parseCampaignPresentationRow([{ popup_mode: 'offline', popup_location: '성수', card_link_path: null }]))
      .toEqual({ popupMode: 'offline', popupLocation: '성수', cardLinkPath: null });
    expect(parseCampaignPresentationRow([])).toBeNull();
    expect(parseCampaignPresentationRow([{ popup_mode: 'online' }, { popup_mode: 'offline' }])).toBeNull();
  });

  it('returns null when the shape breaks the DB constraints', () => {
    for (const bad of [
      null, undefined, 'online', 3,
      { popup_mode: 'popup' },
      { popup_mode: 'ONLINE' },
      { popup_mode: 3 },
      { popup_mode: null, popup_location: '장소만 있음' },
      { popup_mode: 'online', popup_location: '' },
      { popup_mode: 'online', popup_location: 'ㄱ'.repeat(121) },
      { popup_mode: 'online', popup_location: 7 },
      { card_link_path: '//evil.example' },
      { card_link_path: 'https://evil.example/x' },
      { card_link_path: '/' + 'a'.repeat(300) },
      { card_link_path: '/a\\b' },
      { card_link_path: 42 },
    ]) {
      expect(parseCampaignPresentationRow(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('accepts the exact length limits', () => {
    expect(parseCampaignPresentationRow({ popup_mode: 'offline', popup_location: '가'.repeat(120) })?.popupLocation).toHaveLength(120);
    expect(parseCampaignPresentationRow({ card_link_path: '/' + 'a'.repeat(299) })?.cardLinkPath).toHaveLength(300);
  });

  it('counts emoji as one character like the database', () => {
    expect(parseCampaignPresentationRow({ popup_mode: 'online', popup_location: '😀'.repeat(120) })).not.toBeNull();
    expect(parseCampaignPresentationRow({ popup_mode: 'online', popup_location: '😀'.repeat(121) })).toBeNull();
  });
});

describe('normalizeCampaignPresentationInput', () => {
  const blank = { popupMode: '', popupLocation: '', cardLinkPath: '' };

  it('turns an empty form into an all-null presentation (EVENT, no shortcut)', () => {
    expect(normalizeCampaignPresentationInput(blank)).toEqual({
      ok: true, value: { popupMode: null, popupLocation: null, cardLinkPath: null },
    });
  });

  it('trims every field and keeps a valid POP-UP with its place and shortcut', () => {
    expect(normalizeCampaignPresentationInput({
      popupMode: ' hybrid ', popupLocation: '  서울 마포구 월드컵로8길 69 1층  ', cardLinkPath: ' /ip/hong-sil-quest ',
    })).toEqual({
      ok: true,
      value: { popupMode: 'hybrid', popupLocation: '서울 마포구 월드컵로8길 69 1층', cardLinkPath: '/ip/hong-sil-quest' },
    });
  });

  it('drops the place when the campaign is not placed in POP-UP', () => {
    expect(normalizeCampaignPresentationInput({ ...blank, popupLocation: '남은 장소', cardLinkPath: '/shop' })).toEqual({
      ok: true, value: { popupMode: null, popupLocation: null, cardLinkPath: '/shop' },
    });
    // 그 장소가 120자를 넘어도 비워 저장하므로 오류가 아니다.
    expect(normalizeCampaignPresentationInput({ ...blank, popupLocation: '가'.repeat(500) }).ok).toBe(true);
  });

  it('rejects an unknown or differently cased mode', () => {
    for (const popupMode of ['popup', 'ONLINE', 'on-line', 'online,offline']) {
      expect(normalizeCampaignPresentationInput({ ...blank, popupMode }), popupMode).toEqual({
        ok: false, errors: { popupMode: CAMPAIGN_PRESENTATION_MESSAGES.popupMode },
      });
    }
  });

  it('limits the place to 120 characters', () => {
    expect(normalizeCampaignPresentationInput({ ...blank, popupMode: 'offline', popupLocation: '가'.repeat(120) }).ok).toBe(true);
    expect(normalizeCampaignPresentationInput({ ...blank, popupMode: 'offline', popupLocation: '가'.repeat(121) })).toEqual({
      ok: false, errors: { popupLocation: CAMPAIGN_PRESENTATION_MESSAGES.popupLocation },
    });
  });

  it('accepts only same-site paths for the shortcut', () => {
    for (const cardLinkPath of ['/ip/hong-sil-quest', '/shop/some-good', '/shop?displayCategory=0d2c1c1f-0000-4000-8000-000000000000', '/events/x#top']) {
      expect(normalizeCampaignPresentationInput({ ...blank, cardLinkPath }), cardLinkPath).toEqual({
        ok: true, value: { popupMode: null, popupLocation: null, cardLinkPath },
      });
    }
    for (const cardLinkPath of [
      '//evil.example', 'https://evil.example/path', 'http://evil.example', 'javascript:alert(1)', 'ip/hong-sil-quest',
      '/\\evil.example', '/a\\b', '/%2F%2Fevil.example', '/a\u0000b', '/a‮b',
    ]) {
      expect(normalizeCampaignPresentationInput({ ...blank, cardLinkPath }), JSON.stringify(cardLinkPath)).toEqual({
        ok: false, errors: { cardLinkPath: CAMPAIGN_PRESENTATION_MESSAGES.cardLinkFormat },
      });
    }
  });

  it('limits the shortcut to 300 characters with its own message', () => {
    expect(normalizeCampaignPresentationInput({ ...blank, cardLinkPath: '/' + 'a'.repeat(299) }).ok).toBe(true);
    expect(normalizeCampaignPresentationInput({ ...blank, cardLinkPath: '/' + 'a'.repeat(300) })).toEqual({
      ok: false, errors: { cardLinkPath: CAMPAIGN_PRESENTATION_MESSAGES.cardLinkLength },
    });
  });

  it('reports every field error at once', () => {
    const result = normalizeCampaignPresentationInput({ popupMode: 'popup', popupLocation: '', cardLinkPath: '//evil.example' });
    expect(result).toEqual({
      ok: false,
      errors: { popupMode: CAMPAIGN_PRESENTATION_MESSAGES.popupMode, cardLinkPath: CAMPAIGN_PRESENTATION_MESSAGES.cardLinkFormat },
    });
    const both = normalizeCampaignPresentationInput({ popupMode: 'online', popupLocation: '가'.repeat(121), cardLinkPath: 'https://x.example' });
    expect(both).toEqual({
      ok: false,
      errors: { popupLocation: CAMPAIGN_PRESENTATION_MESSAGES.popupLocation, cardLinkPath: CAMPAIGN_PRESENTATION_MESSAGES.cardLinkFormat },
    });
  });

  it('shows the operator-facing messages the spec fixes', () => {
    expect(CAMPAIGN_PRESENTATION_MESSAGES.cardLinkFormat).toBe('사이트 안 주소(/로 시작)만 넣을 수 있습니다.');
  });

  it('round-trips with the row parser', () => {
    const normalized = normalizeCampaignPresentationInput({ popupMode: 'offline', popupLocation: '성수동 팝업', cardLinkPath: '/ip/x' });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(parseCampaignPresentationRow({
      popup_mode: normalized.value.popupMode, popup_location: normalized.value.popupLocation, card_link_path: normalized.value.cardLinkPath,
    })).toEqual(normalized.value);
  });
});
