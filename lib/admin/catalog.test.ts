import { describe, expect, it } from 'vitest';
import {
  catalogContextFromSnapshot,
  normalizeAdminCardForm,
  normalizeAdminCardPoolForm,
  normalizeAdminEventForm,
  normalizeAdminGoodForm,
  normalizeAdminGameEndForm,
  normalizeAdminGameForm,
  normalizeAdminIpForm,
  normalizeAdminPoolOddsForm,
  normalizeAdminRewardPolicyForm,
  normalizeAdminStockAdjustmentForm,
  normalizeAdminTicketTypeForm,
} from './catalog';

const context = {
  eventIds: new Set(['e100', 'e200']),
  goodIpById: new Map([
    ['g100', 'hwasan'],
    ['g200', 'lumen'],
  ]),
  ipIds: new Set(['hwasan', 'lumen']),
  verticalKeys: new Set(['rofan', 'global']),
};

const readyPoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const unavailablePoolId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const gameContext = {
  events: new Map([
    ['online-hwasan', { ipId: 'hwasan', mode: '온라인' }],
    ['offline-hwasan', { ipId: 'hwasan', mode: '오프라인' }],
    ['online-lumen', { ipId: 'lumen', mode: '온라인' }],
  ]),
  pools: new Map([
    [readyPoolId, {
      activeFrom: '2026-07-15T00:00:00.000Z',
      activeTo: '2026-08-01T00:00:00.000Z',
      ipId: 'hwasan',
      rewardReady: true,
      status: 'active' as const,
    }],
    [unavailablePoolId, {
      activeFrom: '2026-07-15T00:00:00.000Z',
      activeTo: null,
      ipId: 'hwasan',
      rewardReady: false,
      status: 'active' as const,
    }],
  ]),
};

describe('admin catalog form normalization', () => {
  it('normalizes a card-reward game without accepting raw config', () => {
    const formData = new FormData();
    formData.set('operationId', '11111111-1111-4111-8111-111111111111');
    formData.set('previousGameId', 'old-marble');
    formData.set('id', 'new-marble');
    formData.set('title', '  화산 마블 룰렛  ');
    formData.set('rewardPoolId', readyPoolId.toUpperCase());
    formData.set('eventId', 'online-hwasan');
    formData.set('perUserDailyLimit', '3');
    formData.set('activeFrom', '2026-07-15T10:00');
    formData.set('activeTo', '2026-07-31T09:00');
    formData.set('config', '{"variant":{"kind":"goods"}}');

    expect(normalizeAdminGameForm(formData, gameContext)).toEqual({
      ok: true,
      value: {
        operationId: '11111111-1111-4111-8111-111111111111',
        previousGameId: 'old-marble',
        id: 'new-marble',
        title: '화산 마블 룰렛',
        rewardPoolId: readyPoolId,
        eventId: 'online-hwasan',
        perUserDailyLimit: 3,
        activeFrom: '2026-07-15T01:00:00.000Z',
        activeTo: '2026-07-31T00:00:00.000Z',
      },
    });
  });

  it('rejects implicit starts, invalid limits, unavailable pools, and incompatible events', () => {
    const formData = new FormData();
    formData.set('operationId', 'bad-operation');
    formData.set('previousGameId', 'INVALID GAME');
    formData.set('id', 'INVALID GAME');
    formData.set('title', ' ');
    formData.set('rewardPoolId', unavailablePoolId);
    formData.set('eventId', 'offline-hwasan');
    formData.set('perUserDailyLimit', '101');

    expect(normalizeAdminGameForm(formData, gameContext)).toEqual({
      ok: false,
      errors: {
        operationId: '유효한 저장 요청이 아닙니다.',
        previousGameId: '이전 게임 ID를 확인해주세요.',
        id: 'ID는 소문자 영어, 숫자, 하이픈만 사용할 수 있습니다.',
        title: '게임 제목을 입력해주세요.',
        rewardPoolId: '확률과 카드 구성이 완료된 운영 가능한 카드풀을 선택해주세요.',
        eventId: '같은 IP의 온라인 이벤트만 선택할 수 있습니다.',
        perUserDailyLimit: '일일 플레이 한도는 1~100 사이의 정수여야 합니다.',
        activeFrom: '운영 시작 일시를 명시적으로 선택해주세요.',
      },
    });
  });

  it('rejects a game window that is not fully covered by its reward pool', () => {
    const formData = new FormData();
    formData.set('operationId', '11111111-1111-4111-8111-111111111111');
    formData.set('id', 'marble-maple');
    formData.set('title', '메이플 마블');
    formData.set('rewardPoolId', readyPoolId);
    formData.set('perUserDailyLimit', '1');
    formData.set('activeFrom', '2026-07-15T08:00');

    expect(normalizeAdminGameForm(formData, gameContext)).toEqual({
      ok: false,
      errors: { activeFrom: '게임 운영 기간은 카드풀 운영 기간 안에 있어야 합니다.' },
    });
  });

  it('normalizes a retry-safe end-now request', () => {
    const formData = new FormData();
    formData.set('operationId', '22222222-2222-4222-8222-222222222222');
    formData.set('gameId', 'marble-maple');

    expect(normalizeAdminGameEndForm(formData)).toEqual({
      ok: true,
      value: {
        operationId: '22222222-2222-4222-8222-222222222222',
        gameId: 'marble-maple',
      },
    });
  });

  it('normalizes a valid IP form', () => {
    const formData = new FormData();
    formData.set('id', ' hwasan ');
    formData.set('title', ' 화산강림 ');
    formData.set('sub', '리디 · 로판');
    formData.set('verticalKey', 'rofan');
    formData.set('tagline', '매화는 다시 핀다');
    formData.set('synopsis', '화산파의 부활');
    formData.set('glyph', '화산');
    formData.set('bg', 'linear-gradient(red, blue)');
    formData.set('imagePath', 'public-media/ip/hwasan.png');
    formData.set('featured', 'on');
    formData.set('fansCount', '42');

    expect(normalizeAdminIpForm(formData, context)).toEqual({
      ok: true,
      value: {
        id: 'hwasan',
        title: '화산강림',
        sub: '리디 · 로판',
        verticalKey: 'rofan',
        tagline: '매화는 다시 핀다',
        synopsis: '화산파의 부활',
        glyph: '화산',
        bg: 'linear-gradient(red, blue)',
        imagePath: 'public-media/ip/hwasan.png',
        featured: true,
      },
    });
  });

  it('rejects missing required IP fields and unknown verticals', () => {
    const formData = new FormData();
    formData.set('id', ' ');
    formData.set('title', ' ');
    formData.set('verticalKey', 'unknown');
    formData.set('fansCount', '-1');

    expect(normalizeAdminIpForm(formData, context)).toEqual({
      ok: false,
      errors: {
        id: 'ID를 입력해주세요.',
        title: 'IP 이름을 입력해주세요.',
        verticalKey: '등록된 버티컬을 선택해주세요.',
      },
    });
  });

  it('normalizes a valid good form and rejects negative price or unknown stock', () => {
    const valid = new FormData();
    valid.set('id', 'g100');
    valid.set('ipId', 'hwasan');
    valid.set('name', '화산강림 아크릴 스탠드');
    valid.set('type', '아크릴 스탠드');
    valid.set('price', '22000');
    valid.set('badge', '신상');
    valid.set('stock', 'ok');
    valid.set('stockQty', '12');

    expect(normalizeAdminGoodForm(valid, context)).toEqual({
      ok: true,
      value: {
        id: 'g100',
        ipId: 'hwasan',
        name: '화산강림 아크릴 스탠드',
        type: '아크릴 스탠드',
        price: 22000,
        badge: '신상',
        stock: 'ok',
        bg: null,
        imagePath: null,
      },
    });

    const invalid = new FormData();
    invalid.set('id', 'g101');
    invalid.set('ipId', 'hwasan');
    invalid.set('name', '굿즈');
    invalid.set('type', '키링');
    invalid.set('price', '-1');
    invalid.set('stock', 'soon');
    invalid.set('stockQty', '-5');

    expect(normalizeAdminGoodForm(invalid, context)).toEqual({
      ok: false,
      errors: {
        price: '가격은 0 이상의 정수여야 합니다.',
        stock: '재고 상태를 선택해주세요.',
      },
    });
  });

  it('normalizes a signed stock delta and trims its required reason', () => {
    const formData = new FormData();
    formData.set('adjustmentId', '11111111-1111-4111-8111-111111111111');
    formData.set('goodId', 'g100');
    formData.set('expectedStockQty', '12');
    formData.set('delta', '-3');
    formData.set('reason', '  파손 재고 보정  ');

    expect(normalizeAdminStockAdjustmentForm(formData)).toEqual({
      ok: true,
      value: {
        adjustmentId: '11111111-1111-4111-8111-111111111111',
        goodId: 'g100',
        expectedStockQty: 12,
        delta: -3,
        reason: '파손 재고 보정',
      },
    });
  });

  it.each([
    { delta: '0', reason: '재고 조사', errors: { delta: '조정 수량은 0이 아닌 정수여야 합니다.' } },
    { delta: '1.5', reason: '재고 조사', errors: { delta: '조정 수량은 0이 아닌 정수여야 합니다.' } },
    { delta: '2147483648', reason: '재고 조사', errors: { delta: '조정 수량은 32비트 정수 범위여야 합니다.' } },
    { delta: '1', reason: '   ', errors: { reason: '조정 사유를 입력해주세요.' } },
    { delta: '1', reason: '가'.repeat(201), errors: { reason: '조정 사유는 200자 이하로 입력해주세요.' } },
  ])('rejects an invalid stock adjustment: $errors', ({ delta, reason, errors }) => {
    const formData = new FormData();
    formData.set('adjustmentId', '11111111-1111-4111-8111-111111111111');
    formData.set('goodId', 'g100');
    formData.set('expectedStockQty', '12');
    formData.set('delta', delta);
    formData.set('reason', reason);

    expect(normalizeAdminStockAdjustmentForm(formData)).toEqual({ ok: false, errors });
  });

  it('rejects malformed idempotency and stale-stock contract fields', () => {
    const formData = new FormData();
    formData.set('adjustmentId', 'not-a-uuid');
    formData.set('goodId', 'g100');
    formData.set('expectedStockQty', '-1');
    formData.set('delta', '1');
    formData.set('reason', '입고');

    expect(normalizeAdminStockAdjustmentForm(formData)).toEqual({
      ok: false,
      errors: {
        adjustmentId: '유효한 재고 조정 요청이 아닙니다.',
        expectedStockQty: '현재 실재고를 확인해주세요.',
      },
    });
  });

  it('rejects catalog items pointing at unknown IPs and invalid card rarity', () => {
    const formData = new FormData();
    formData.set('id', 'c100');
    formData.set('ipId', 'missing');
    formData.set('name', '카드');
    formData.set('rarity', 'UR');

    expect(normalizeAdminCardForm(formData, context)).toEqual({
      ok: false,
      errors: {
        ipId: '등록된 IP를 선택해주세요.',
        rarity: '등급을 선택해주세요.',
      },
    });
  });

  it('normalizes an optional card-pool binding and rejects malformed pool IDs', () => {
    const valid = new FormData();
    valid.set('id', 'c100');
    valid.set('ipId', 'hwasan');
    valid.set('name', '청명 홀로 카드');
    valid.set('rarity', 'HOLO');
    valid.set('poolId', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA');

    expect(normalizeAdminCardForm(valid, context)).toEqual({
      ok: true,
      value: {
        id: 'c100',
        ipId: 'hwasan',
        name: '청명 홀로 카드',
        no: null,
        rarity: 'HOLO',
        poolId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        bg: null,
        imagePath: null,
      },
    });

    const invalid = new FormData();
    invalid.set('id', 'c100');
    invalid.set('ipId', 'hwasan');
    invalid.set('name', '카드');
    invalid.set('rarity', 'R');
    invalid.set('poolId', 'not-a-uuid');

    expect(normalizeAdminCardForm(invalid, context)).toEqual({
      ok: false,
      errors: { poolId: '유효한 카드풀을 선택해주세요.' },
    });
  });

  it('normalizes a card-pool form from KST local date-times', () => {
    const formData = new FormData();
    formData.set('operationId', '11111111-1111-4111-8111-111111111111');
    formData.set('id', '22222222-2222-4222-8222-222222222222');
    formData.set('ipId', 'hwasan');
    formData.set('name', '  화산강림 무상 리워드 풀  ');
    formData.set('activeFrom', '2026-07-15T10:00');
    formData.set('activeTo', '2026-08-01T00:00');

    expect(normalizeAdminCardPoolForm(formData, context)).toEqual({
      ok: true,
      value: {
        operationId: '11111111-1111-4111-8111-111111111111',
        id: '22222222-2222-4222-8222-222222222222',
        ipId: 'hwasan',
        name: '화산강림 무상 리워드 풀',
        activeFrom: '2026-07-15T01:00:00.000Z',
        activeTo: '2026-07-31T15:00:00.000Z',
      },
    });
  });

  it('rejects invalid card-pool identifiers, fields, and operating windows', () => {
    const formData = new FormData();
    formData.set('operationId', 'bad-operation');
    formData.set('id', 'bad-pool');
    formData.set('ipId', 'missing');
    formData.set('name', ' ');
    formData.set('activeFrom', '2026-07-15T10:00');
    formData.set('activeTo', '2026-07-15T09:59');

    expect(normalizeAdminCardPoolForm(formData, context)).toEqual({
      ok: false,
      errors: {
        operationId: '유효한 저장 요청이 아닙니다.',
        id: '유효한 카드풀이 아닙니다.',
        ipId: '등록된 IP를 선택해주세요.',
        name: '카드풀 이름을 입력해주세요.',
        activeTo: '운영 종료는 시작보다 뒤여야 합니다.',
      },
    });
  });

  it('normalizes five rarity percentages into exact probabilities', () => {
    const formData = new FormData();
    formData.set('operationId', '11111111-1111-4111-8111-111111111111');
    formData.set('poolId', '22222222-2222-4222-8222-222222222222');
    formData.set('oddsN', '0');
    formData.set('oddsR', '70');
    formData.set('oddsSr', '0');
    formData.set('oddsSsr', '20.125');
    formData.set('oddsHolo', '9.875');

    expect(normalizeAdminPoolOddsForm(formData)).toEqual({
      ok: true,
      value: {
        operationId: '11111111-1111-4111-8111-111111111111',
        poolId: '22222222-2222-4222-8222-222222222222',
        odds: { N: 0, R: 0.7, SR: 0, SSR: 0.20125, HOLO: 0.09875 },
      },
    });
  });

  it('rejects malformed rarity percentages and totals other than 100%', () => {
    const malformed = new FormData();
    malformed.set('operationId', '11111111-1111-4111-8111-111111111111');
    malformed.set('poolId', '22222222-2222-4222-8222-222222222222');
    malformed.set('oddsN', '-1');
    malformed.set('oddsR', '70.0001');
    malformed.set('oddsSr', '0');
    malformed.set('oddsSsr', '20');
    malformed.set('oddsHolo', '10');

    expect(normalizeAdminPoolOddsForm(malformed)).toEqual({
      ok: false,
      errors: {
        oddsN: '확률은 0~100 사이, 소수 셋째 자리까지 입력해주세요.',
        oddsR: '확률은 0~100 사이, 소수 셋째 자리까지 입력해주세요.',
      },
    });

    const wrongTotal = new FormData();
    wrongTotal.set('operationId', '11111111-1111-4111-8111-111111111111');
    wrongTotal.set('poolId', '22222222-2222-4222-8222-222222222222');
    wrongTotal.set('oddsN', '0');
    wrongTotal.set('oddsR', '69');
    wrongTotal.set('oddsSr', '0');
    wrongTotal.set('oddsSsr', '20');
    wrongTotal.set('oddsHolo', '10');

    expect(normalizeAdminPoolOddsForm(wrongTotal)).toEqual({
      ok: false,
      errors: { oddsTotal: '확률 합계는 100%여야 합니다.' },
    });
  });

  it('normalizes event forms with optional IP and KST date-times', () => {
    const formData = new FormData();
    formData.set('id', 'e100');
    formData.set('ipId', '');
    formData.set('title', '합동 팝업');
    formData.set('mode', '오프라인');
    formData.set('status', '예정');
    formData.set('startsAt', '2026-07-01T10:30');
    formData.set('endsAt', '');
    formData.set('location', '성수');
    formData.set('accent', '#8B5CFF');

    expect(normalizeAdminEventForm(formData, context)).toEqual({
      ok: true,
      value: {
        id: 'e100',
        ipId: null,
        title: '합동 팝업',
        mode: '오프라인',
        status: '예정',
        startsAt: '2026-07-01T01:30:00.000Z',
        endsAt: null,
        location: '성수',
        accent: '#8B5CFF',
        bg: null,
        imagePath: null,
      },
    });
  });

  it('rejects malformed event date-times before RPC submission', () => {
    const formData = new FormData();
    formData.set('id', 'e101');
    formData.set('title', '합동 팝업');
    formData.set('mode', '오프라인');
    formData.set('status', '예정');
    formData.set('startsAt', '2026/07/01 10:30');
    formData.set('endsAt', '2026-13-01T10:30');

    expect(normalizeAdminEventForm(formData, context)).toEqual({
      ok: false,
      errors: {
        startsAt: '일시는 YYYY-MM-DDTHH:mm 형식이어야 합니다.',
        endsAt: '일시는 YYYY-MM-DDTHH:mm 형식이어야 합니다.',
      },
    });
  });

  it('normalizes a valid ticket session without exposing sold or deferred sales settings', () => {
    const formData = new FormData();
    formData.set('operationId', '11111111-1111-4111-8111-111111111111');
    formData.set('id', '22222222-2222-4222-8222-222222222222');
    formData.set('eventId', 'e100');
    formData.set('name', '  7월 25일 1회차  ');
    formData.set('price', '25000');
    formData.set('capacity', '80');
    formData.set('sold', '999');
    formData.set('perUserLimit', '99');
    formData.set('salesOpenAt', '2026-07-20T10:00');

    expect(normalizeAdminTicketTypeForm(formData, context)).toEqual({
      ok: true,
      value: {
        operationId: '11111111-1111-4111-8111-111111111111',
        id: '22222222-2222-4222-8222-222222222222',
        eventId: 'e100',
        name: '7월 25일 1회차',
        price: 25000,
        capacity: 80,
      },
    });
  });

  it('rejects invalid ticket session identifiers, event, name, price, and capacity', () => {
    const formData = new FormData();
    formData.set('operationId', 'not-a-uuid');
    formData.set('id', 'also-not-a-uuid');
    formData.set('eventId', 'missing');
    formData.set('name', '   ');
    formData.set('price', '-1');
    formData.set('capacity', '1.5');

    expect(normalizeAdminTicketTypeForm(formData, context)).toEqual({
      ok: false,
      errors: {
        operationId: '유효한 저장 요청이 아닙니다.',
        id: '유효한 티켓 회차가 아닙니다.',
        eventId: '등록된 이벤트를 선택해주세요.',
        name: '회차명을 입력해주세요.',
        price: '가격은 0 이상의 정수여야 합니다.',
        capacity: '정원은 0 이상의 정수여야 합니다.',
      },
    });
  });

  it('rejects ticket values outside the PostgreSQL integer range', () => {
    const formData = new FormData();
    formData.set('operationId', '11111111-1111-4111-8111-111111111111');
    formData.set('id', '22222222-2222-4222-8222-222222222222');
    formData.set('eventId', 'e100');
    formData.set('name', '회차');
    formData.set('price', '2147483648');
    formData.set('capacity', '2147483648');

    expect(normalizeAdminTicketTypeForm(formData, context)).toEqual({
      ok: false,
      errors: {
        price: '가격은 0 이상의 정수여야 합니다.',
        capacity: '정원은 0 이상의 정수여야 합니다.',
      },
    });
  });

  it('builds good-to-IP validation truth from the catalog snapshot', () => {
    expect(catalogContextFromSnapshot({
      events: [],
      goods: [
        { id: 'g100', ip: 'hwasan' },
        { id: 'g200', ip: 'lumen' },
      ],
      ips: [{ id: 'hwasan' }, { id: 'lumen' }],
      verticals: [],
    }).goodIpById).toEqual(new Map([
      ['g100', 'hwasan'],
      ['g200', 'lumen'],
    ]));
  });

  it('normalizes a retry-safe order-paid reward policy with KST operating times', () => {
    const formData = new FormData();
    formData.set('operationId', '11111111-1111-4111-8111-111111111111');
    formData.set('id', '22222222-2222-4222-8222-222222222222');
    formData.set('poolId', '33333333-3333-4333-8333-333333333333');
    formData.set('trigger', 'order_paid');
    formData.set('targetIpId', 'hwasan');
    formData.set('targetGoodId', 'g100');
    formData.set('minAmount', '30000');
    formData.set('ticketsPerGrant', '2');
    formData.set('active', 'on');
    formData.set('activeFrom', '2026-07-15T10:00');
    formData.set('activeTo', '2026-08-01T00:00');

    expect(normalizeAdminRewardPolicyForm(formData, context)).toEqual({
      ok: true,
      value: {
        operationId: '11111111-1111-4111-8111-111111111111',
        id: '22222222-2222-4222-8222-222222222222',
        poolId: '33333333-3333-4333-8333-333333333333',
        trigger: 'order_paid',
        targetIpId: 'hwasan',
        targetGoodId: 'g100',
        minAmount: 30000,
        ticketsPerGrant: 2,
        active: true,
        activeFrom: '2026-07-15T01:00:00.000Z',
        activeTo: '2026-07-31T15:00:00.000Z',
      },
    });
  });

  it('accepts an IP-wide inactive policy without a target good', () => {
    const formData = new FormData();
    formData.set('operationId', '11111111-1111-4111-8111-111111111111');
    formData.set('id', '22222222-2222-4222-8222-222222222222');
    formData.set('poolId', '33333333-3333-4333-8333-333333333333');
    formData.set('trigger', 'order_paid');
    formData.set('targetIpId', 'hwasan');
    formData.set('targetGoodId', '');
    formData.set('minAmount', '0');
    formData.set('ticketsPerGrant', '1');
    formData.set('activeFrom', '2026-07-15T10:00');

    const result = normalizeAdminRewardPolicyForm(formData, context);

    expect(result).toMatchObject({
      ok: true,
      value: { active: false, targetGoodId: null },
    });
  });

  it('rejects cross-IP goods and invalid reward-policy values', () => {
    const formData = new FormData();
    formData.set('operationId', 'bad-operation');
    formData.set('id', 'bad-policy');
    formData.set('poolId', 'bad-pool');
    formData.set('trigger', 'signup');
    formData.set('targetIpId', 'hwasan');
    formData.set('targetGoodId', 'g200');
    formData.set('minAmount', '-1');
    formData.set('ticketsPerGrant', '101');
    formData.set('activeFrom', '2026-07-15T10:00');
    formData.set('activeTo', '2026-07-15T09:59');

    expect(normalizeAdminRewardPolicyForm(formData, context)).toEqual({
      ok: false,
      errors: {
        operationId: '유효한 저장 요청이 아닙니다.',
        id: '유효한 발급 정책이 아닙니다.',
        poolId: '유효한 카드풀이 아닙니다.',
        trigger: '지원하지 않는 발급 조건입니다.',
        targetGoodId: '선택한 IP의 굿즈만 지정할 수 있습니다.',
        minAmount: '최소 결제 금액은 0 이상의 정수여야 합니다.',
        ticketsPerGrant: '발급 수량은 1~100 사이의 정수여야 합니다.',
        activeTo: '운영 종료는 시작보다 뒤여야 합니다.',
      },
    });
  });
});
