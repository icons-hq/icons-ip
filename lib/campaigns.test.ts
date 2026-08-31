import { describe, expect, it } from 'vitest';
import {
  campaignAnchors,
  campaignDisplayState,
  campaignPeriodLabel,
  campaignSectionDomId,
  campaignStateBadgeLabel,
  campaignStateBadgeVariant,
  campaignStateLabel,
  orderCampaignsForHub,
  parseCampaignSections,
  type CampaignDisplayState,
  type CampaignStatus,
  type CampaignSummary,
} from './campaigns';

const NOW = Date.parse('2026-08-15T03:00:00.000Z');

function period(
  startsAt: string,
  endsAt: string,
  status: CampaignStatus = 'published',
) {
  return { startsAt, endsAt, status };
}

describe('campaignDisplayState', () => {
  it('기간 안이면 진행중이다', () => {
    expect(campaignDisplayState(
      period('2026-08-01T00:00:00.000Z', '2026-08-31T14:59:59.000Z'),
      NOW,
    )).toBe('ongoing');
  });

  it('시작 전이면 예정이다', () => {
    expect(campaignDisplayState(
      period('2026-09-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z'),
      NOW,
    )).toBe('upcoming');
  });

  it('마감이 지나면 종료다', () => {
    expect(campaignDisplayState(
      period('2026-07-01T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
      NOW,
    )).toBe('ended');
  });

  /* 운영자가 조기 종료한 캠페인이 "진행중"으로 그려지면 참여 버튼이 살아 있는 것처럼 보인다. */
  it('기간이 남아도 status가 ended면 종료다', () => {
    expect(campaignDisplayState(
      period('2026-08-01T00:00:00.000Z', '2026-08-31T00:00:00.000Z', 'ended'),
      NOW,
    )).toBe('ended');
  });

  it('상태 뱃지 라벨은 세 가지뿐이다', () => {
    const labels: Record<CampaignDisplayState, string> = {
      ongoing: '진행중',
      upcoming: '예정',
      ended: '종료',
    };
    for (const [state, label] of Object.entries(labels)) {
      expect(campaignStateLabel(state as CampaignDisplayState)).toBe(label);
    }
  });
});

describe('campaignStateBadgeLabel', () => {
  /* draft 는 RLS 상 운영자만 받는다. 시간 기반 파생만 그리면 준비 중 편성이
     공개된 캠페인과 같은 '진행중' 뱃지를 단다. */
  it('draft면 기간과 무관하게 비공개로 그린다', () => {
    expect(campaignStateBadgeLabel({ status: 'draft', displayState: 'ongoing' })).toBe('비공개');
    expect(campaignStateBadgeLabel({ status: 'draft', displayState: 'upcoming' })).toBe('비공개');
    expect(campaignStateBadgeLabel({ status: 'draft', displayState: 'ended' })).toBe('비공개');
  });

  it('draft가 아니면 기존 상태 라벨 그대로다', () => {
    expect(campaignStateBadgeLabel({ status: 'published', displayState: 'ongoing' })).toBe('진행중');
    expect(campaignStateBadgeLabel({ status: 'published', displayState: 'upcoming' })).toBe('예정');
    expect(campaignStateBadgeLabel({ status: 'ended', displayState: 'ended' })).toBe('종료');
  });

  it('뱃지 변형도 같은 판정에서 갈린다', () => {
    expect(campaignStateBadgeVariant({ status: 'draft', displayState: 'ongoing' })).toBe('draft');
    expect(campaignStateBadgeVariant({ status: 'published', displayState: 'ongoing' })).toBe('ongoing');
    expect(campaignStateBadgeVariant({ status: 'ended', displayState: 'ended' })).toBe('ended');
  });

  /* displayState 파생은 건드리지 않는다 — draft 도 기간으로 판정한다. */
  it('draft의 displayState는 여전히 시간 기반이다', () => {
    expect(campaignDisplayState(
      period('2026-08-01T00:00:00.000Z', '2026-08-31T00:00:00.000Z', 'draft'),
      NOW,
    )).toBe('ongoing');
  });
});

describe('campaignPeriodLabel', () => {
  /* KST 자정 경계 — UTC 로 재면 하루 앞선 날짜가 나온다. */
  it('같은 해면 뒤쪽 연도를 생략한다', () => {
    expect(campaignPeriodLabel('2026-08-06T15:00:00.000Z', '2026-08-31T14:59:00.000Z'))
      .toBe('2026.8.7 – 8.31');
  });

  it('해가 넘어가면 양쪽에 연도를 적는다', () => {
    expect(campaignPeriodLabel('2026-12-24T15:00:00.000Z', '2027-01-04T14:59:00.000Z'))
      .toBe('2026.12.25 – 2027.1.4');
  });

  it('날짜를 못 읽으면 기간 미정으로 접는다', () => {
    expect(campaignPeriodLabel('nonsense', '2026-08-31T00:00:00.000Z')).toBe('기간 미정');
  });
});

describe('parseCampaignSections', () => {
  it('아는 블록만 남기고 미지 타입·비정형 원소는 조용히 건너뛴다', () => {
    const sections = parseCampaignSections([
      { type: 'intro', copy: '리드 카피', anchor: '소개' },
      { type: 'video', src: 'https://example.test/a.mp4' },
      null,
      'not-an-object',
      { type: 'attendance' },
      { type: 'intro' },
    ]);

    expect(sections).toEqual([
      { anchor: '소개', type: 'intro', copy: '리드 카피' },
      { type: 'attendance' },
    ]);
  });

  it('배열이 아니면 빈 본문이다', () => {
    expect(parseCampaignSections(null)).toEqual([]);
    expect(parseCampaignSections({ type: 'intro', copy: 'x' })).toEqual([]);
    expect(parseCampaignSections('[]')).toEqual([]);
  });

  it('DB 블록 계약의 키를 그대로 옮긴다', () => {
    const sections = parseCampaignSections([
      { type: 'image', image_path: 'campaigns/hero.png', alt: '히어로' },
      { type: 'text', heading: '안내', body: '본문' },
      { type: 'exchange', offer_id: '11111111-1111-4111-8111-111111111111' },
      { type: 'coupon', coupon_code: 'WELCOME', description: '첫 구매' },
      { type: 'goods', good_ids: ['g1', 'g2'] },
      { type: 'notice', items: ['유의사항 1'] },
    ]);

    expect(sections).toEqual([
      { type: 'image', image_path: 'campaigns/hero.png', alt: '히어로' },
      { type: 'text', body: '본문', heading: '안내' },
      { type: 'exchange', offer_id: '11111111-1111-4111-8111-111111111111' },
      { type: 'coupon', coupon_code: 'WELCOME', description: '첫 구매' },
      { type: 'goods', good_ids: ['g1', 'g2'] },
      { type: 'notice', items: ['유의사항 1'] },
    ]);
  });

  it('목록 블록의 비문자열 원소는 버리고 남은 것으로 블록을 세운다', () => {
    expect(parseCampaignSections([{ type: 'goods', good_ids: ['g1', 3, '', 'g2'] }]))
      .toEqual([{ type: 'goods', good_ids: ['g1', 'g2'] }]);
    expect(parseCampaignSections([{ type: 'notice', items: [null] }])).toEqual([]);
  });
});

describe('orderCampaignsForHub', () => {
  /* 레퍼런스는 종료 캠페인을 순서로만 밀어냈다 — 그룹을 먼저 나눈 뒤 최신순으로 센다. */
  it('진행중 → 예정 → 종료, 그룹 안에서는 시작일 내림차순', () => {
    const list = [
      { id: 'ended-old', displayState: 'ended' as const, startsAt: '2026-05-01T00:00:00.000Z' },
      { id: 'upcoming', displayState: 'upcoming' as const, startsAt: '2026-09-01T00:00:00.000Z' },
      { id: 'ongoing-old', displayState: 'ongoing' as const, startsAt: '2026-08-01T00:00:00.000Z' },
      { id: 'ended-new', displayState: 'ended' as const, startsAt: '2026-06-01T00:00:00.000Z' },
      { id: 'ongoing-new', displayState: 'ongoing' as const, startsAt: '2026-08-10T00:00:00.000Z' },
    ];

    expect(orderCampaignsForHub(list).map((entry) => entry.id)).toEqual([
      'ongoing-new',
      'ongoing-old',
      'upcoming',
      'ended-new',
      'ended-old',
    ]);
  });

  it('입력 배열을 제자리에서 뒤집지 않는다', () => {
    const list: Pick<CampaignSummary, 'displayState' | 'startsAt'>[] = [
      { displayState: 'ended', startsAt: '2026-05-01T00:00:00.000Z' },
      { displayState: 'ongoing', startsAt: '2026-08-01T00:00:00.000Z' },
    ];
    orderCampaignsForHub(list);

    expect(list[0]?.displayState).toBe('ended');
  });
});

describe('campaignAnchors', () => {
  /* 운영자 문자열을 DOM id 로 쓰면 공백·특수문자가 섞이는 순간 목차 링크가 깨진다. */
  it('앵커가 있는 블록만 목차에 올리고 id는 순서에서 만든다', () => {
    const anchors = campaignAnchors([
      { anchor: 'MY COIN' },
      {},
      { anchor: '유의 사항' },
    ]);

    expect(anchors).toEqual([
      { id: campaignSectionDomId(0), label: 'MY COIN' },
      { id: campaignSectionDomId(2), label: '유의 사항' },
    ]);
  });
});
