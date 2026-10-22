import { HTML_LIMITED_BOT_UA_RE } from 'next/dist/shared/lib/router/utils/html-bots.js';
import { shouldServeStreamingMetadata } from 'next/dist/server/lib/streaming-metadata.js';
import { describe, expect, it } from 'vitest';
import nextConfig from './next.config';

/* Next는 설정 로드 때 htmlLimitedBots를 source 문자열로 바꿔 서버에 넘기고, 요청마다 이 함수로 판정한다. */
const configuredSource = nextConfig.htmlLimitedBots?.source;
const putsMetadataInHead = (userAgent: string) => !shouldServeStreamingMetadata(userAgent, configuredSource);
const nextDefaultPutsMetadataInHead = (userAgent: string) =>
  !shouldServeStreamingMetadata(userAgent, HTML_LIMITED_BOT_UA_RE.source);

const KAKAO_SCRAP_IDENTIFIER = 'kakaotalk-scrap/1.0; +https://devtalk.kakao.com/t/scrap/33984';
const DAUMOA = 'Mozilla/5.0 (compatible; MSIE or Firefox mutant; not on Windows server;) Daumoa/4.0';
const DAUM_SEARCH = 'Mozilla/5.0 (compatible; Daum/4.1; +http://cs.daum.net/faq/15/4118.html?faqId=28966)';

describe('htmlLimitedBots', () => {
  it('Next 기본 정규식 전체를 그대로 앞에 두고 그 뒤에 덧붙인다(기본 목록의 봇을 잃지 않는다)', () => {
    expect(nextConfig.htmlLimitedBots).toBeInstanceOf(RegExp);
    expect(configuredSource?.startsWith(`${HTML_LIMITED_BOT_UA_RE.source}|`)).toBe(true);
  });

  it.each([
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Twitterbot/1.0',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'AdsBot-Google (+http://www.google.com/adsbot.html)',
    'WhatsApp/2.23.20.0',
  ])('기본 목록의 수집기는 계속 <head>로 받는다: %s', (userAgent) => {
    expect(putsMetadataInHead(userAgent)).toBe(true);
  });

  it.each([
    KAKAO_SCRAP_IDENTIFIER,
    'facebookexternalhit/1.1; kakaotalk-scrap/1.0; +https://devtalk.kakao.com/t/scrap/33984',
    DAUMOA,
    'Mozilla/5.0 (compatible; MSIE or Firefox mutant; not on Windows server;) Daumoa 4.0',
    'Mozilla/5.0 (compatible; MSIE or Firefox mutant; not on Windows server;) Daumoa-image/1.0',
    DAUM_SEARCH,
    'Mozilla/5.0 (compatible; MSIE or Firefox mutant;) Daum 4.1',
  ])('카카오톡 미리보기·다음 수집기도 <head>로 받는다: %s', (userAgent) => {
    expect(putsMetadataInHead(userAgent)).toBe(true);
  });

  it.each([KAKAO_SCRAP_IDENTIFIER, DAUMOA, DAUM_SEARCH])(
    'Next 기본 목록만으로는 본문 스트리밍을 받는 UA라 추가 토큰이 필요하다: %s',
    (userAgent) => {
      expect(nextDefaultPutsMetadataInHead(userAgent)).toBe(false);
    },
  );

  it.each([
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.8.0',
    'Mozilla/5.0 (Linux; Android 14; SM-S928N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 DaumApps/8.6.2 DaumDevice/mobile',
  ])('사람의 브라우저·인앱 브라우저는 스트리밍을 유지한다: %s', (userAgent) => {
    expect(putsMetadataInHead(userAgent)).toBe(false);
  });
});
