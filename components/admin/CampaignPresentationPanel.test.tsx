import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCampaignRecord } from '@/lib/admin/campaigns';

const hooks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, pending: false }));

vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useActionState: () => [hooks.state, vi.fn(), hooks.pending],
}));
vi.mock('@/app/admin/campaign-presentation-actions', () => ({ saveAdminCampaignPresentationAction: vi.fn() }));

import { CampaignPresentationPanel } from './CampaignPresentationPanel';

function campaign(presentation: AdminCampaignRecord['presentation']): AdminCampaignRecord {
  return {
    id: 'autumn-popup', kind: 'event', title: '가을 팝업', subtitle: null, status: 'published',
    startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-30T00:00:00.000Z',
    heroImagePath: null, cardImagePath: null, bannerImagePath: null, featuredOrder: null, sections: [],
    presentation, updatedAt: '2026-11-01T00:00:00.000Z',
  };
}
const EMPTY = { popupMode: null, popupLocation: null, cardLinkPath: null } as const;
const render = (presentation: AdminCampaignRecord['presentation'] = EMPTY) => renderToStaticMarkup(<CampaignPresentationPanel campaign={campaign(presentation)} />);
const tag = (markup: string, name: string) => markup.match(new RegExp(`<(?:input|select)[^>]*name="${name}"[^>]*>`))?.[0] ?? '';

beforeEach(() => { hooks.state = {}; hooks.pending = false; });

describe('CampaignPresentationPanel', () => {
  it('제목·설명과 세 칸의 라벨·도움말을 스펙 문구로 그린다', () => {
    const markup = render();

    expect(markup).toContain('>노출 설정<');
    expect(markup).toContain('EVENT와 POP-UP 중 어디에 보일지, 카드를 누르면 어디로 갈지 정합니다.');
    for (const label of ['POP-UP에 싣기', '장소', '카드·배너 바로가기']) expect(markup).toMatch(new RegExp(`<label[^>]*>${label}</label>`));
    expect(markup).toContain('고객 화면에 기간 옆에 보입니다. 예: 서울 마포구 월드컵로8길 69 1층');
    expect(markup).toContain('비우면 캠페인 페이지로 갑니다. 상품·IP관·카테고리 주소를 넣으면 EVENT 카드와 배너가 그곳으로 바로 갑니다. 예: /ip/hong-sil-quest, /shop/…');
  });

  it('POP-UP 선택지는 싣지 않음(기본)과 온라인·오프라인·온·오프라인이다', () => {
    const markup = render();

    const options = [...markup.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((match) => [match[1], match[2]]);
    expect(options).toEqual([['', '싣지 않음 — EVENT에 보입니다'], ['online', '온라인'], ['offline', '오프라인'], ['hybrid', '온·오프라인']]);
    expect(markup).toMatch(/<option value=""[^>]*selected=""/);
  });

  it('저장된 설정을 칸 초기값으로 채우고 대상 캠페인 id 를 숨은 칸으로 싣는다', () => {
    const markup = render({ popupMode: 'offline', popupLocation: '서울 마포구 월드컵로8길 69 1층', cardLinkPath: '/ip/hong-sil-quest' });

    expect(markup).toMatch(/<option value="offline"[^>]*selected=""/);
    expect(tag(markup, 'popupLocation')).toContain('value="서울 마포구 월드컵로8길 69 1층"');
    expect(tag(markup, 'cardLinkPath')).toContain('value="/ip/hong-sil-quest"');
    expect(tag(markup, 'campaignId')).toMatch(/type="hidden"/);
    expect(tag(markup, 'campaignId')).toContain('value="autumn-popup"');
  });

  /* 스펙 §2.8: POP-UP 이 '싣지 않음'이면 장소는 비활성(제출되지 않아 서버가 비운다). */
  it('POP-UP 에 싣지 않으면 장소 칸은 비활성이고, 싣으면 쓸 수 있다', () => {
    expect(tag(render(), 'popupLocation')).toContain('disabled=""');
    expect(tag(render({ popupMode: 'online', popupLocation: null, cardLinkPath: null }), 'popupLocation')).not.toContain('disabled=""');
    expect(tag(render({ popupMode: 'hybrid', popupLocation: '서울', cardLinkPath: null }), 'popupLocation')).not.toContain('disabled=""');
  });

  it('입력 길이 한도(장소 120자·주소 300자)를 칸에 건다', () => {
    const markup = render();

    expect(tag(markup, 'popupLocation')).toContain('maxLength="120"');
    expect(tag(markup, 'cardLinkPath')).toContain('maxLength="300"');
  });

  it('저장 버튼은 submit 이다(kit Button 기본 type 이 button 이라 명시해야 한다)', () => {
    const markup = render();

    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>(?:(?!<\/button>)[^])*노출 설정 저장<\/button>/);
    expect(markup).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it('저장 중에는 버튼이 막히고 문구가 바뀐다', () => {
    hooks.pending = true;
    const markup = render();

    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>(?:(?!<\/button>)[^])*저장 중<\/button>/);
  });

  describe('저장 결과', () => {
    it('성공 문구를 알린다', () => {
      hooks.state = { message: '노출 설정을 저장했습니다.' };

      expect(render()).toMatch(/role="status"[^>]*>노출 설정을 저장했습니다\.</);
    });

    it('형식 오류는 그 칸 아래에 알림으로 붙고 칸을 오류 상태로 표시한다', () => {
      hooks.state = { errors: { cardLinkPath: '사이트 안 주소(/로 시작)만 넣을 수 있습니다.' } };
      const markup = render({ popupMode: null, popupLocation: null, cardLinkPath: '//evil.com' });

      expect(markup).toMatch(/role="alert"[^>]*>사이트 안 주소\(\/로 시작\)만 넣을 수 있습니다\.</);
      expect(tag(markup, 'cardLinkPath')).toContain('aria-invalid="true"');
      expect(tag(markup, 'popupLocation')).toContain('aria-invalid="false"');
    });

    it('권한·캠페인 없음 같은 폼 오류는 저장 버튼 옆에 알린다', () => {
      hooks.state = { errors: { form: '먼저 캠페인을 저장해주세요.' } };

      expect(render()).toMatch(/role="alert"[^>]*>먼저 캠페인을 저장해주세요\.</);
    });
  });

  /* 읽지 못한 설정을 빈 값으로 그리면 운영자가 저장하며 있던 설정을 지운다. */
  it('노출 설정을 읽지 못했으면 안내하고 폼을 막는다', () => {
    const markup = render(null);

    expect(markup).toContain('노출 설정을 불러오지 못했습니다');
    expect(markup).toMatch(/<fieldset[^>]*disabled=""/);
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it('읽었으면 불러오기 실패 안내를 내지 않는다', () => {
    expect(render()).not.toContain('노출 설정을 불러오지 못했습니다');
  });
});
