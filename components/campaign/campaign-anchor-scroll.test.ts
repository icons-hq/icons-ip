import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_ANCHOR_TOLERANCE,
  activeCampaignAnchorId,
  campaignAnchorLine,
  campaignAnchorRootMargin,
  campaignAnchorScrollTop,
  campaignAnchorSettle,
  isPlainPrimaryClick,
  parseChromeHeight,
} from './campaign-anchor-scroll';

/* 셸 크롬 높이(wc-chrome.css): 모바일·태블릿 52, 데스크톱 축약 69, 데스크톱 펼침 123.
   앵커 내브: 안쪽 48 + 하단 선 1 = 49. */
const NAV = 49;
const MOBILE_LINE = campaignAnchorLine(52, NAV);
const CONDENSED_LINE = campaignAnchorLine(69, NAV);
const EXPANDED_LINE = campaignAnchorLine(123, NAV);

describe('착지선', () => {
  it('고정 크롬 높이와 내브 높이를 더한 값이다 — 여백을 더 두지 않는다', () => {
    expect(MOBILE_LINE).toBe(101);
    expect(CONDENSED_LINE).toBe(118);
    expect(EXPANDED_LINE).toBe(172);
  });

  it('음수는 0으로 본다', () => {
    expect(campaignAnchorLine(-5, NAV)).toBe(NAV);
    expect(campaignAnchorLine(52, -1)).toBe(52);
  });
});

describe('크롬 높이 읽기', () => {
  it('변수 값을 먼저 쓴다 — sticky top 은 전환 중 중간값일 수 있다', () => {
    expect(parseChromeHeight('69px', '96.5px')).toBe(69);
    expect(parseChromeHeight(' 123px', '69px')).toBe(123);
  });

  it('변수가 없으면 대체값이 풀린 sticky top 을 쓴다', () => {
    expect(parseChromeHeight('', '81px')).toBe(81);
  });

  it('둘 다 숫자가 아니면 0이다', () => {
    expect(parseChromeHeight('', 'auto')).toBe(0);
  });
});

describe('목차 이동 위치', () => {
  it('섹션 머리를 착지선에 맞춘다', () => {
    expect(campaignAnchorScrollTop({ scrollY: 0, sectionTop: 1200, line: CONDENSED_LINE, maxScrollY: 5000 })).toBe(1082);
    expect(campaignAnchorScrollTop({ scrollY: 900, sectionTop: 400, line: MOBILE_LINE, maxScrollY: 5000 })).toBe(1199);
  });

  it('위쪽 섹션으로도 같은 선에 맞춘다', () => {
    expect(campaignAnchorScrollTop({ scrollY: 2000, sectionTop: -600, line: CONDENSED_LINE, maxScrollY: 5000 })).toBe(1282);
  });

  it('서브픽셀 위치는 반올림한다 — 착지한 머리는 선 ±0.5px 안이다', () => {
    const top = campaignAnchorScrollTop({ scrollY: 0, sectionTop: 1240.8, line: CONDENSED_LINE, maxScrollY: 5000 });
    expect(top).toBe(1123);
    expect(Math.abs(1240.8 - top! - CONDENSED_LINE)).toBeLessThanOrEqual(0.5);
  });

  it('문서 끝과 맨 위를 넘지 않는다', () => {
    expect(campaignAnchorScrollTop({ scrollY: 1000, sectionTop: 900, line: CONDENSED_LINE, maxScrollY: 1500 })).toBe(1500);
    expect(campaignAnchorScrollTop({ scrollY: 50, sectionTop: 20, line: CONDENSED_LINE, maxScrollY: 1500 })).toBe(0);
  });

  it('이미 그 자리면 움직이지 않는다', () => {
    expect(campaignAnchorScrollTop({ scrollY: 1000, sectionTop: 118.4, line: CONDENSED_LINE, maxScrollY: 5000 })).toBeNull();
    expect(campaignAnchorScrollTop({ scrollY: 1500, sectionTop: 300, line: CONDENSED_LINE, maxScrollY: 1500 })).toBeNull();
  });

  /* 데스크톱 펼친 헤더에서 누르면 이동 중 헤더가 54 접히고 본문도 54 올라온다(부드러운 이동은
     스크롤 앵커링이 되돌리지 않는다 — 2026-10-22 Chrome 실측). 펼친 선으로 잡은 목표가 접힌 선에 선다. */
  it('펼친 헤더에서 잡은 목표는 헤더가 접힌 뒤 축약 선에 선다', () => {
    const sectionTop = 1240;
    const top = campaignAnchorScrollTop({ scrollY: 0, sectionTop, line: EXPANDED_LINE, maxScrollY: 5000 })!;
    const shrink = EXPANDED_LINE - CONDENSED_LINE;
    expect(shrink).toBe(54);
    expect(sectionTop - shrink - top).toBe(CONDENSED_LINE);
  });
});

describe('이동이 멈춘 뒤', () => {
  it('선에 서 있으면 그대로 둔다', () => {
    expect(campaignAnchorSettle({ scrollY: 1082, sectionTop: 118.3, line: CONDENSED_LINE, maxScrollY: 5000, lineShift: -54 }))
      .toEqual({ type: 'landed' });
  });

  /* 동작 줄이기(즉시 이동)에서는 스크롤 앵커링이 헤더 접힘을 되돌려 머리가 선보다 54 아래에 남는다. */
  it('크롬 변화량만큼 어긋났으면 다시 맞춘다', () => {
    expect(campaignAnchorSettle({ scrollY: 1028, sectionTop: 172, line: CONDENSED_LINE, maxScrollY: 5000, lineShift: -54 }))
      .toEqual({ type: 'realign', top: 1082 });
  });

  it('반올림 오차는 크롬이 그대로여도 맞춘다', () => {
    expect(campaignAnchorSettle({ scrollY: 1081, sectionTop: 119, line: CONDENSED_LINE, maxScrollY: 5000, lineShift: 0 }))
      .toEqual({ type: 'realign', top: 1082 });
  });

  it('그보다 크게 벗어났으면 사용자가 넘겨받은 것으로 보고 건드리지 않는다', () => {
    expect(campaignAnchorSettle({ scrollY: 900, sectionTop: 300, line: CONDENSED_LINE, maxScrollY: 5000, lineShift: 0 }))
      .toEqual({ type: 'left' });
    expect(campaignAnchorSettle({ scrollY: 950, sectionTop: 300, line: CONDENSED_LINE, maxScrollY: 5000, lineShift: -54 }))
      .toEqual({ type: 'left' });
  });

  it('문서 끝에 막혀 선까지 못 올라온 섹션은 착지로 본다', () => {
    expect(campaignAnchorSettle({ scrollY: 1500, sectionTop: 420, line: CONDENSED_LINE, maxScrollY: 1500, lineShift: 0 }))
      .toEqual({ type: 'landed' });
  });
});

describe('활성 앵커', () => {
  const sections = (tops: number[]) => tops.map((top, index) => ({ id: `s${index}`, top }));

  it('머리가 착지선까지 올라온 마지막 섹션이다', () => {
    expect(activeCampaignAnchorId(sections([-900, -300, 118, 700]), CONDENSED_LINE)).toBe('s2');
    expect(activeCampaignAnchorId(sections([-900, -300, 260, 700]), CONDENSED_LINE)).toBe('s1');
  });

  /* 회귀: 착지한 섹션 바로 앞 섹션의 바닥이 내브 바로 아래에 걸쳐 있어도 앞 섹션을 고르지 않는다
     (예전 판정 띠 윗변 56px은 지금 크롬 아래 선보다 위라 한 칸 늦었다). */
  it('목차로 착지한 섹션을 고른다 — 앞 섹션이 아니다', () => {
    expect(activeCampaignAnchorId(sections([-420, CONDENSED_LINE + 0.5]), CONDENSED_LINE)).toBe('s1');
    expect(activeCampaignAnchorId(sections([-420, MOBILE_LINE - 0.5]), MOBILE_LINE)).toBe('s1');
  });

  it('허용치를 넘게 아래에 있으면 아직 활성이 아니다', () => {
    expect(activeCampaignAnchorId(sections([-420, CONDENSED_LINE + CAMPAIGN_ANCHOR_TOLERANCE + 0.5]), CONDENSED_LINE)).toBe('s0');
  });

  it('아무 섹션도 선에 닿지 않았으면 첫 앵커다', () => {
    expect(activeCampaignAnchorId(sections([600, 1200]), CONDENSED_LINE)).toBe('s0');
  });

  it('앵커가 없으면 null 이다', () => {
    expect(activeCampaignAnchorId([], CONDENSED_LINE)).toBeNull();
  });

  it('목차로 이동해 머무는 동안은 문서 끝에 막힌 섹션도 누른 것을 고른다', () => {
    const tops = sections([-700, -40, 420]);
    const landing = { id: 's2', scrollY: 1500 };
    expect(activeCampaignAnchorId(tops, CONDENSED_LINE, landing, 1500)).toBe('s2');
    expect(activeCampaignAnchorId(tops, CONDENSED_LINE, landing, 1500.5)).toBe('s2');
  });

  it('그 자리를 떠나면 위치 판정으로 돌아간다', () => {
    const landing = { id: 's2', scrollY: 1500 };
    expect(activeCampaignAnchorId(sections([-660, 0, 460]), CONDENSED_LINE, landing, 1460)).toBe('s1');
  });

  it('없는 앵커를 가리키는 착지는 무시한다', () => {
    expect(activeCampaignAnchorId(sections([-700, 118]), CONDENSED_LINE, { id: 'gone', scrollY: 10 }, 10)).toBe('s1');
  });
});

describe('관찰 띠', () => {
  it('윗변을 착지선 바로 아래(허용치)에 둔다', () => {
    expect(campaignAnchorRootMargin(CONDENSED_LINE)).toBe('-119px 0px 0px 0px');
    expect(campaignAnchorRootMargin(MOBILE_LINE)).toBe('-102px 0px 0px 0px');
    expect(campaignAnchorRootMargin(EXPANDED_LINE)).toBe('-173px 0px 0px 0px');
  });
});

describe('클릭 가로채기', () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

  it('수정 키 없는 주 버튼 클릭(키보드 Enter 포함)만 가로챈다', () => {
    expect(isPlainPrimaryClick(click)).toBe(true);
  });

  it('새 탭·새 창·다운로드 조합과 이미 처리된 클릭은 브라우저에 맡긴다', () => {
    expect(isPlainPrimaryClick({ ...click, metaKey: true })).toBe(false);
    expect(isPlainPrimaryClick({ ...click, ctrlKey: true })).toBe(false);
    expect(isPlainPrimaryClick({ ...click, shiftKey: true })).toBe(false);
    expect(isPlainPrimaryClick({ ...click, altKey: true })).toBe(false);
    expect(isPlainPrimaryClick({ ...click, button: 1 })).toBe(false);
    expect(isPlainPrimaryClick({ ...click, defaultPrevented: true })).toBe(false);
  });
});
