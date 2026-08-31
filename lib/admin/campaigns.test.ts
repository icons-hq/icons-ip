import { describe, expect, it } from 'vitest';
import {
  adminCampaignDateTimeInput,
  adminCampaignSectionsInput,
  normalizeAdminCampaignForm,
  normalizeAdminCoinExchangeOfferForm,
  parseAdminCampaignSections,
} from './campaigns';

const POOL_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '22222222-2222-4222-8222-222222222222';

function form(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

function campaignForm(overrides: Record<string, string> = {}) {
  return form({
    id: 'autumn-attendance',
    kind: 'event',
    title: '가을 출석 이벤트',
    status: 'published',
    startsAt: '2026-09-01T00:00',
    endsAt: '2026-09-30T23:59',
    sections: '',
    ...overrides,
  });
}

function offerForm(overrides: Record<string, string> = {}) {
  return form({
    poolId: POOL_ID,
    label: '가을 카드팩 1장',
    coinCost: '10',
    ticketCount: '1',
    status: 'active',
    ...overrides,
  });
}

describe('normalizeAdminCampaignForm', () => {
  /* datetime-local 은 타임존이 없는 값이다. 브라우저 로컬로 읽으면 해외에서
     접속한 운영자가 9시간 어긋난 기간을 만든다 — 항상 KST 로 해석한다. */
  it('기간 입력을 KST 로 해석해 ISO 로 옮긴다', () => {
    const result = normalizeAdminCampaignForm(campaignForm());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.startsAt).toBe('2026-08-31T15:00:00.000Z');
    expect(result.value.endsAt).toBe('2026-09-30T14:59:00.000Z');
  });

  it('종료가 시작보다 앞서면 거절한다', () => {
    const result = normalizeAdminCampaignForm(campaignForm({
      startsAt: '2026-09-30T00:00',
      endsAt: '2026-09-01T00:00',
    }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.endsAt).toBeTruthy();
  });

  it('슬러그 규칙에 맞지 않는 ID 를 거절한다', () => {
    const result = normalizeAdminCampaignForm(campaignForm({ id: 'Autumn Attendance' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.id).toBeTruthy();
  });

  /* DB 가 catalog_id_immutable 로 막는 경로다. 읽기 전용 입력을 우회당해도
     RPC 왕복 전에 걸러 낸다. */
  it('등록된 캠페인의 ID 변경 시도를 거절한다', () => {
    const result = normalizeAdminCampaignForm(campaignForm({
      id: 'winter-attendance',
      previousId: 'autumn-attendance',
    }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.id).toContain('변경할 수 없습니다');
  });

  it('빈 배너 순서는 배너 미노출(null)로 읽는다', () => {
    const result = normalizeAdminCampaignForm(campaignForm({ featuredOrder: '' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.featuredOrder).toBeNull();
  });

  it('0 이하의 배너 순서는 거절한다', () => {
    const result = normalizeAdminCampaignForm(campaignForm({ featuredOrder: '0' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.featuredOrder).toBeTruthy();
  });

  it('빈 선택 필드는 null 로 접는다', () => {
    const result = normalizeAdminCampaignForm(campaignForm({
      subtitle: '  ',
      heroImagePath: '',
      cardImagePath: '',
      bannerImagePath: '',
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.subtitle).toBeNull();
    expect(result.value.heroImagePath).toBeNull();
    expect(result.value.cardImagePath).toBeNull();
    expect(result.value.bannerImagePath).toBeNull();
  });

  it('본문 JSON 을 블록 배열로 실어 보낸다', () => {
    const result = normalizeAdminCampaignForm(campaignForm({
      sections: '[{"type":"intro","copy":"안녕하세요"}]',
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections).toEqual([{ type: 'intro', copy: '안녕하세요' }]);
  });

  it('깨진 본문 JSON 은 sections 오류로 돌려준다', () => {
    const result = normalizeAdminCampaignForm(campaignForm({ sections: '[{"type":"intro"' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.sections).toBeTruthy();
  });
});

describe('parseAdminCampaignSections', () => {
  it('빈 입력은 빈 블록 배열이다', () => {
    expect(parseAdminCampaignSections('   ')).toEqual({ ok: true, value: [] });
  });

  it('최상위가 배열이 아니면 거절한다', () => {
    const result = parseAdminCampaignSections('{"type":"intro","copy":"x"}');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('블록 배열');
  });

  it('블록 20개를 넘기면 거절한다', () => {
    const blocks = Array.from({ length: 21 }, () => ({ type: 'attendance' }));

    const result = parseAdminCampaignSections(JSON.stringify(blocks));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('최대 20개');
  });

  it('모르는 type 을 거절한다', () => {
    const result = parseAdminCampaignSections('[{"type":"hero"}]');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('type');
  });

  /* 오타 하나가 조용히 저장되면 상세 페이지에서는 빈 블록으로만 보이고,
     원인을 데이터에서 찾아야 한다. DB 도 같은 규칙으로 막는다. */
  it('블록에 없는 키를 거절한다', () => {
    const result = parseAdminCampaignSections('[{"type":"intro","copy":"x","headline":"y"}]');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('headline');
  });

  it('필수 키가 빠지면 거절한다', () => {
    const result = parseAdminCampaignSections('[{"type":"image","image_path":"a/b.webp"}]');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('alt');
  });

  it('exchange 블록의 offer_id 는 UUID 여야 한다', () => {
    const bad = parseAdminCampaignSections('[{"type":"exchange","offer_id":"offer-1"}]');
    const good = parseAdminCampaignSections(
      `[{"type":"exchange","offer_id":"${OFFER_ID}"}]`,
    );

    expect(bad.ok).toBe(false);
    expect(good.ok).toBe(true);
  });

  it('goods 블록의 good_ids 는 1~8개의 문자열이다', () => {
    const empty = parseAdminCampaignSections('[{"type":"goods","good_ids":[]}]');
    const nonString = parseAdminCampaignSections('[{"type":"goods","good_ids":[13]}]');
    const ok = parseAdminCampaignSections('[{"type":"goods","good_ids":["g13","g14"]}]');

    expect(empty.ok).toBe(false);
    expect(nonString.ok).toBe(false);
    expect(ok.ok).toBe(true);
  });

  it('anchor 는 모든 블록의 선택 키다', () => {
    const ok = parseAdminCampaignSections('[{"type":"attendance","anchor":"attend"}]');
    const tooLong = parseAdminCampaignSections(
      `[{"type":"attendance","anchor":"${'a'.repeat(21)}"}]`,
    );

    expect(ok.ok).toBe(true);
    expect(tooLong.ok).toBe(false);
  });

  it('text 블록의 heading 은 선택이고 body 는 필수다', () => {
    const bodyOnly = parseAdminCampaignSections('[{"type":"text","body":"본문"}]');
    const headingOnly = parseAdminCampaignSections('[{"type":"text","heading":"제목"}]');

    expect(bodyOnly.ok).toBe(true);
    expect(headingOnly.ok).toBe(false);
  });
});

describe('normalizeAdminCoinExchangeOfferForm', () => {
  it('신규 등록은 id 를 null 로 보낸다', () => {
    const result = normalizeAdminCoinExchangeOfferForm(offerForm());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      id: null,
      poolId: POOL_ID,
      label: '가을 카드팩 1장',
      coinCost: 10,
      ticketCount: 1,
      status: 'active',
    });
  });

  it('수정은 선택한 교환처 id 를 함께 보낸다', () => {
    const result = normalizeAdminCoinExchangeOfferForm(offerForm({ offerId: OFFER_ID }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(OFFER_ID);
  });

  it('카드풀을 고르지 않으면 거절한다', () => {
    const result = normalizeAdminCoinExchangeOfferForm(offerForm({ poolId: '' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.poolId).toBeTruthy();
  });

  /* DB 체크와 같은 경계다. 여기서 통과시키면 저장 왕복 뒤에야 실패를 본다. */
  it('코인 비용과 카드팩 수량의 상·하한을 지킨다', () => {
    expect(normalizeAdminCoinExchangeOfferForm(offerForm({ coinCost: '0' })).ok).toBe(false);
    expect(normalizeAdminCoinExchangeOfferForm(offerForm({ coinCost: '100001' })).ok).toBe(false);
    expect(normalizeAdminCoinExchangeOfferForm(offerForm({ ticketCount: '11' })).ok).toBe(false);
    expect(normalizeAdminCoinExchangeOfferForm(offerForm({ ticketCount: '10' })).ok).toBe(true);
  });

  it('모르는 노출 상태를 거절한다', () => {
    const result = normalizeAdminCoinExchangeOfferForm(offerForm({ status: 'archived' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.status).toBeTruthy();
  });
});

describe('폼 초기값 변환', () => {
  it('저장된 시각을 KST datetime-local 값으로 되돌린다', () => {
    expect(adminCampaignDateTimeInput('2026-08-31T15:00:00.000Z')).toBe('2026-09-01T00:00');
    expect(adminCampaignDateTimeInput(null)).toBe('');
    expect(adminCampaignDateTimeInput('not-a-date')).toBe('');
  });

  it('빈 블록은 빈 문자열로, 있는 블록은 들여쓴 JSON 으로 그린다', () => {
    expect(adminCampaignSectionsInput([])).toBe('');
    expect(adminCampaignSectionsInput(null)).toBe('');
    expect(adminCampaignSectionsInput([{ type: 'attendance' }]))
      .toBe('[\n  {\n    "type": "attendance"\n  }\n]');
  });
});
