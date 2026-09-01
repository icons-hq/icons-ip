import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminCampaignRecord } from '@/lib/admin/campaigns';
import { CampaignSection } from './CampaignSection';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

function campaign(overrides: Partial<AdminCampaignRecord> = {}): AdminCampaignRecord {
  return {
    id: 'autumn-attendance',
    kind: 'event',
    title: '가을 출석 이벤트',
    subtitle: '매일 출석하고 코인을 모으세요',
    status: 'published',
    startsAt: '2026-08-31T15:00:00.000Z',
    endsAt: '2026-09-30T14:59:00.000Z',
    heroImagePath: 'campaigns/autumn/hero.webp',
    cardImagePath: null,
    bannerImagePath: null,
    featuredOrder: 1,
    sections: [{ type: 'attendance' }],
    updatedAt: '2026-08-31T15:00:00.000Z',
    ...overrides,
  };
}

/** 슬러그 입력 한 칸만 떼어 낸다 — 폼 전체를 훑으면 다른 칸의 속성에 걸린다. */
function idInputTag(markup: string) {
  return markup.match(/<input[^>]*name="id"[^>]*>/i)?.[0] ?? '';
}

function render(selected: AdminCampaignRecord | null, records = [campaign()]) {
  return renderToStaticMarkup(
    <CampaignSection
      action={() => {}}
      onSelect={() => {}}
      pending={false}
      records={records}
      selected={selected}
      state={{}}
    />,
  );
}

describe('CampaignSection', () => {
  it('목록에 종류·상태·배너 순서를 함께 읽어 준다', () => {
    const markup = render(null);

    expect(markup).toContain('가을 출석 이벤트');
    expect(markup).toContain('이벤트');
    expect(markup).toContain('진행 중');
    expect(markup).toContain('배너 1');
  });

  /* 슬러그는 URL 이자 운영 식별자다. 수정 모드에서 열려 있으면 운영자가 바꿀 수
     있다고 읽고, DB 는 catalog_id_immutable 로 거절한다. */
  it('수정 모드에서 ID 를 잠그고 previousId 를 함께 싣는다', () => {
    const markup = render(campaign());

    expect(markup).toContain('name="previousId" value="autumn-attendance"');
    expect(idInputTag(markup)).toMatch(/readonly/i);
  });

  it('신규 등록에서는 ID 를 열어 두고 previousId 를 비운다', () => {
    const markup = render(null);

    expect(markup).toContain('name="previousId" value=""');
    expect(idInputTag(markup)).not.toMatch(/readonly/i);
  });

  it('기간 입력을 KST 값으로 되돌려 그린다', () => {
    const markup = render(campaign());

    expect(markup).toContain('value="2026-09-01T00:00"');
    expect(markup).toContain('value="2026-09-30T23:59"');
  });

  /* 상태 셀렉트가 종료 운영 창구다 — 별도의 "종료" 버튼을 두지 않는다. */
  it('상태 셀렉트로 종료까지 고를 수 있다', () => {
    const markup = render(campaign());

    expect(markup).toContain('작성 중 (비공개)');
    expect(markup).toContain('진행 중 (공개)');
    expect(markup).toContain('>종료<');
  });

  it('배너 순서 칸이 비면 미노출임을 라벨로 말한다', () => {
    const markup = render(campaign({ featuredOrder: null }));

    expect(markup).toContain('허브 배너 미노출');
  });

  /* 블록 JSON 직접 편집이 v1 계약이라 계약서가 화면 안에 있어야 한다. */
  it('랜딩 구성 JSON 스키마를 8종 전부 안내한다', () => {
    const markup = render(campaign());

    for (const type of ['intro', 'image', 'text', 'attendance', 'exchange', 'coupon', 'goods', 'notice']) {
      expect(markup).toContain(`<code>${type}</code>`);
    }
    expect(markup).toContain('offer_id');
  });

  it('저장된 블록을 들여쓴 JSON 으로 프리필한다', () => {
    const markup = render(campaign());

    expect(markup).toContain('&quot;type&quot;: &quot;attendance&quot;');
  });

  it('서버가 돌려준 sections 오류를 그대로 보여 준다', () => {
    const markup = renderToStaticMarkup(
      <CampaignSection
        action={() => {}}
        onSelect={() => {}}
        pending={false}
        records={[campaign()]}
        selected={campaign()}
        state={{ errors: { sections: 'sections[2].offer_id: not a uuid' } }}
      />,
    );

    expect(markup).toContain('sections[2].offer_id');
  });

  it('캠페인이 없으면 빈 목록임을 말한다', () => {
    const markup = render(null, []);

    expect(markup).toContain('등록된 캠페인이 없습니다.');
  });
});
