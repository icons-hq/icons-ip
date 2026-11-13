import { describe, expect, it } from 'vitest';
import { newReviewEventValues, normalizeReviewEventFilters, parsePublicReviewEvent, parseReviewEvent, parseReviewEventCreditPolicy, parseReviewEventSelection, parseReviewEventValues, reviewEventCreditPolicyLabel, reviewEventCreditPolicyProblem, reviewEventFieldErrors, reviewEventToday, trimReviewEventText, withReviewEventEndsOn, withReviewEventStartsOn, parseReviewEventTemplate, parseReviewEventTemplatePage, parseReviewEventTemplateValues, reviewEventTemplateError, reviewEventTemplateFieldErrors, reviewEventTemplateNeedsConfirm, trimReviewEventTemplateText, withReviewEventTemplate, REVIEW_EVENT_TEMPLATE_REPLACE_CONFIRM, REVIEW_EVENT_TEMPLATES_ADMIN_PATH, REVIEW_EVENT_TEMPLATE_UNUSABLE, reviewEventTemplateUsable } from './review-events';
import { reviewEventError } from '@/lib/admin/review-event-messages';
describe('review event contracts', () => {
  it('uses KST date boundaries and requires real dates and bounded terms', () => {
    expect(reviewEventToday(Date.parse('2026-10-13T15:00:00Z'))).toBe('2026-10-14');
    const values = { ...newReviewEventValues('2026-10-13'), title: '후기 이벤트', description: '별점과 무관한 사용 후기' };
    expect(parseReviewEventValues(values)).toEqual(values);
    for (const change of [{ startsOn: '2026-02-30' }, { endsOn: values.startsOn }, { announcesOn: values.endsOn }, { plannedWinners: 1001 }, { creditAmount: '1000' }, { creditValidityDays: 0 }, { title: '1234567890123456' }, { title: ' 제목 ' }]) expect(parseReviewEventValues({ ...values, ...change })).toBeNull();
  });
  it('accepts target IDs only for the selected mode and rejects empty/duplicate/oversized targets', () => {
    const values = { ...newReviewEventValues(), title: '이벤트', description: '안내문' };
    expect(parseReviewEventValues({ ...values, targetType: 'goods', goodIds: ['g1'] })).not.toBeNull();
    for (const change of [{ goodIds: ['g1'] }, { targetType: 'goods' }, { targetType: 'goods', goodIds: ['g1', 'g1'] }, { targetType: 'goods', goodIds: Array.from({ length: 501 }, (_, n) => `g${n}`) }]) expect(parseReviewEventValues({ ...values, ...change })).toBeNull();
  });
  it('requires both timestamp and content fingerprint for selection rechecks', () => {
    const token = { id: '92000000-0000-4000-8000-000000000001', reviewUpdatedAt: '2026-10-13T01:00:00Z', reviewFingerprint: 'a'.repeat(32) };
    expect(parseReviewEventSelection([token])).toEqual([token]);
    expect(parseReviewEventSelection([{ ...token, reviewFingerprint: '' }])).toBeNull();
    expect(parseReviewEventSelection([token, token])).toBeNull();
  });
  it('normalizes URL filters without negative or malformed pagination', () => {
    expect(normalizeReviewEventFilters({ page: '-1', pageSize: '999', from: '2026-10-14', to: '2026-10-13', state: 'broken' })).toMatchObject({ page: 1, pageSize: 20, from: '2026-10-14', to: '2026-10-14', state: 'all' });
  });
  /* 2026-11-12 전 DB 저장 검사는 btrim만 봐서 직접 RPC로 앞뒤 NBSP·전각 공백·BOM이 붙은 문구가 저장됐을 수 있다. 그 행 하나로 어드민 목록·고객 목록이 깨지지 않는다. */
  it('reads stored events whose title or description carry Unicode whitespace at the edges, while saves stay strict', () => {
    const values = { ...newReviewEventValues('2026-10-13'), title: '\u00A0후기 이벤트', description: '별점과 무관한 사용 후기\u3000' };
    const stored = { id: '92000000-0000-4000-8000-000000000101', number: 1, revision: 1, createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', archivedAt: null, announcedAt: null,
      state: 'scheduled', canEdit: true, entryCount: 0, selectedCount: 0, awardedCount: 0, revokedCount: 0, ...values };
    expect(parseReviewEvent(stored)).toEqual(stored);
    expect(parseReviewEvent({ ...stored, title: '\uFEFF후기 이벤트\u2028' })).not.toBeNull();
    for (const change of [{ title: '\u00A0' }, { title: '\u00A0123456789012345' }, { description: '내용\u0007' }, { title: 7 }]) expect(parseReviewEvent({ ...stored, ...change })).toBeNull();
    expect(parseReviewEventValues(values)).toBeNull();
    expect(parseReviewEventValues(trimReviewEventText(values))).toEqual({ ...values, title: '후기 이벤트', description: '별점과 무관한 사용 후기' });
    const shown = { id: stored.id, title: values.title, description: values.description, startsOn: values.startsOn, endsOn: values.endsOn, announcesOn: values.announcesOn,
      creditAmount: 1000, creditValidityDays: 30, plannedWinners: 10, bannerStyle: 'basic', state: 'active', announcedAt: null, nextChangeAt: null };
    expect(parsePublicReviewEvent(shown)).toEqual(shown);
    expect(parsePublicReviewEvent({ ...shown, title: '\u3000' })).toBeNull();
  });
});

/* R6: 등록 실패 원인(정책 꺼짐·상한 초과·필드 범위)을 저장 전에 필드별로 알린다. 서버·DB 규칙과 같은 기준이다. */
describe('review event editor guidance (R6)', () => {
  const today = '2026-10-28';
  const base = () => ({ ...newReviewEventValues(today), title: '후기 이벤트', description: '별점과 무관한 사용 후기' });

  it('trims surrounding spaces before validation instead of failing the whole form', () => {
    const trimmed = trimReviewEventText({ ...base(), title: ' 후기 이벤트 ', description: '사용 후기 \n' });
    expect(trimmed.title).toBe('후기 이벤트');
    expect(trimmed.description).toBe('사용 후기');
    expect(parseReviewEventValues(trimmed)).not.toBeNull();
  });

  it('reports each invalid field with its own reason', () => {
    expect(reviewEventFieldErrors(base(), today)).toEqual({});
    const errors = reviewEventFieldErrors({ ...base(), title: '', description: '1234567890123456789012345678901', startsOn: today,
      endsOn: '2026-12-31', announcesOn: '2026-10-29', plannedWinners: 0, creditAmount: 0, creditValidityDays: 0, targetType: 'goods' }, today);
    expect(Object.keys(errors).sort()).toEqual(['announcesOn', 'creditAmount', 'creditValidityDays', 'description', 'endsOn', 'plannedWinners', 'startsOn', 'target', 'title'].sort());
    expect(errors.title).toContain('1~15자');
    expect(errors.description).toContain('1~30자');
    expect(errors.startsOn).toContain('내일');
    expect(errors.endsOn).toContain('+1~31일');
    expect(errors.target).toContain('상품');
  });

  it('moves the end and announcement dates with the start date, staying inside their ranges', () => {
    const values = base();
    const moved = withReviewEventStartsOn(values, '2026-11-10');
    expect(moved.startsOn).toBe('2026-11-10');
    expect(moved.endsOn).toBe('2026-11-17');
    expect(moved.announcesOn).toBe('2026-11-20');
    expect(reviewEventFieldErrors(moved, today)).toEqual({});
    const broken = withReviewEventStartsOn({ ...values, endsOn: '2027-12-01', announcesOn: '2026-01-01' }, '2026-11-10');
    expect(reviewEventFieldErrors(broken, today)).toEqual({});
    expect(withReviewEventStartsOn(values, '').startsOn).toBe('');
    const ended = withReviewEventEndsOn({ ...values, announcesOn: '2026-11-30' }, '2026-11-08');
    expect(ended.announcesOn).toBe('2026-11-11');
    expect(withReviewEventEndsOn(values, '2026-11-04').announcesOn).toBe(values.announcesOn);
  });

  it('compares credit terms with the store credit policy before saving', () => {
    expect(parseReviewEventCreditPolicy({ enabled: true, maxBalance: 100000, validityDays: 30 })).toEqual({ enabled: true, maxBalance: 100000, validityDays: 30 });
    expect(parseReviewEventCreditPolicy({ enabled: false, maxBalance: null, validityDays: null })).toEqual({ enabled: false, maxBalance: null, validityDays: null });
    expect(parseReviewEventCreditPolicy({ enabled: 'yes' })).toBeNull();
    expect(reviewEventCreditPolicyLabel({ enabled: true, maxBalance: 100000, validityDays: 30 })).toBe('적립금 정책: 켜짐 · 보유 상한 100,000원 · 유효기간 30일');
    expect(reviewEventCreditPolicyLabel({ enabled: false, maxBalance: null, validityDays: null })).toBe('적립금 정책: 꺼짐');
    expect(reviewEventCreditPolicyProblem(base(), { enabled: false, maxBalance: null, validityDays: null })).toEqual({
      form: '적립금 정책이 꺼져 있어 리뷰이벤트를 저장할 수 없습니다. 판매자 정보 > 적립금 정책(관리자)에서 켠 뒤 저장하세요.' });
    const policy = { enabled: true, maxBalance: 500, validityDays: 10 };
    const problem = reviewEventCreditPolicyProblem(base(), policy);
    expect(problem.creditAmount).toContain('500원');
    expect(problem.creditValidityDays).toContain('10일');
    expect(reviewEventCreditPolicyProblem({ ...base(), creditAmount: 500, creditValidityDays: 10 }, policy)).toEqual({});
    expect(reviewEventCreditPolicyProblem(base(), null)).toEqual({});
  });

  it('maps a rejected value check to the input guidance instead of a generic permission message', () => {
    expect(reviewEventError('invalid_review_event')).toContain('입력값');
    expect(reviewEventError('invalid_review_event')).not.toContain('권한');
  });
});

/* SHEET-017: 문구 템플릿은 이벤트명·내용 칸과 같은 규칙이고, 불러오면 그 두 칸만 바꾼다. */
describe('review event wording templates (SHEET-017)', () => {
  const template = { id: '93100000-0000-4000-8000-000000000101', title: '포토리뷰 이벤트', description: '사진과 함께 후기를 남겨주세요', revision: 2,
    createdAt: '2026-11-11T01:00:00.000Z', updatedAt: '2026-11-11T02:00:00+00:00' };

  it('uses the same text rules as the event title and description fields', () => {
    const event = { ...newReviewEventValues('2026-11-11'), title: '', description: '' };
    for (const values of [{ title: '포토리뷰 이벤트', description: '사진 후기' }, { title: '1'.repeat(15), description: '2'.repeat(30) }, { title: '', description: '' },
      { title: '1'.repeat(16), description: '내용' }, { title: '제목', description: '2'.repeat(31) }, { title: '제목', description: '첫 줄\n둘째 줄' }]) {
      const templateErrors = reviewEventTemplateFieldErrors(values);
      const eventErrors = reviewEventFieldErrors({ ...event, ...values });
      expect(templateErrors.title).toBe(eventErrors.title);
      expect(templateErrors.description).toBe(eventErrors.description);
      expect(parseReviewEventTemplateValues(values) !== null).toBe(!templateErrors.title && !templateErrors.description);
    }
    expect(parseReviewEventTemplateValues({ title: ' 제목 ', description: '내용' })).toBeNull();
    expect(trimReviewEventTemplateText({ title: ' 제목 ', description: '내용 \n' })).toEqual({ title: '제목', description: '내용' });
  });

  it('checks a save receipt strictly, including the wording rules', () => {
    expect(parseReviewEventTemplate(template)).toEqual(template);
    for (const broken of [{ ...template, id: 'nope' }, { ...template, revision: 0 }, { ...template, title: '1'.repeat(16) }, { ...template, updatedAt: 'later' }, { ...template, title: `${template.title} ` }]) {
      expect(parseReviewEventTemplate(broken)).toBeNull();
    }
  });

  /* 리뷰 지적(SHEET-017): JS trim은 NBSP·전각 공백·BOM도 자른다. 그런 행 하나 때문에 목록 전체를 버리지 않는다. */
  it('keeps a page readable when one row breaks the wording rules or the row format', () => {
    const page = { total: 1, page: 1, pageSize: 20, rows: [template] };
    expect(parseReviewEventTemplatePage(page)).toEqual({ ...page, skipped: 0 });
    const spaced = { ...template, id: '93100000-0000-4000-8000-000000000102', title: `${template.title} `, description: '　사진 후기' };
    const mixed = parseReviewEventTemplatePage({ ...page, total: 2, rows: [spaced, template] });
    expect(mixed?.rows).toEqual([spaced, template]);
    expect(mixed?.rows.map(reviewEventTemplateUsable)).toEqual([false, true]);
    expect(mixed?.skipped).toBe(0);
    const broken = parseReviewEventTemplatePage({ ...page, total: 4, rows: [{ ...template, id: 'nope' }, template, template, { ...template, id: '93100000-0000-4000-8000-000000000103', title: 7 }] });
    expect(broken).toEqual({ total: 4, page: 1, pageSize: 20, rows: [template], skipped: 3 });
    for (const envelope of [{ ...page, pageSize: 50 }, { ...page, total: 0 }, { ...page, page: 0 }, { ...page, rows: 'none' }]) expect(parseReviewEventTemplatePage(envelope)).toBeNull();
  });

  it('treats JS-trimmed whitespace at either end as unusable but keeps inner spaces', () => {
    for (const edge of [' ', '　', '﻿', ' ', ' ', ' ', '\t']) {
      expect(reviewEventTemplateUsable({ title: `제목${edge}`, description: '내용' }), JSON.stringify(edge)).toBe(false);
      expect(reviewEventTemplateUsable({ title: '제목', description: `${edge}내용` }), JSON.stringify(edge)).toBe(false);
    }
    expect(reviewEventTemplateUsable({ title: '포토 리뷰', description: '사진　후기' })).toBe(true);
    expect(REVIEW_EVENT_TEMPLATE_UNUSABLE).toContain('불러올 수 없습니다');
  });

  it('replaces only the event title and description, asking first when typed wording differs', () => {
    const values = { ...newReviewEventValues('2026-11-11'), title: '가을 이벤트', description: '후기 남기기', targetType: 'goods' as const, goodIds: ['g1'], creditAmount: 3000 };
    const applied = withReviewEventTemplate(values, template);
    expect(applied).toEqual({ ...values, title: template.title, description: template.description });
    expect(reviewEventTemplateNeedsConfirm(values, template)).toBe(true);
    expect(reviewEventTemplateNeedsConfirm({ title: ' ', description: '' }, template)).toBe(false);
    expect(reviewEventTemplateNeedsConfirm({ title: ` ${template.title}`, description: template.description }, template)).toBe(false);
    expect(REVIEW_EVENT_TEMPLATE_REPLACE_CONFIRM).toContain('바꿀까요');
  });

  it('explains conflicts and invalid wording without blaming permissions', () => {
    expect(reviewEventTemplateError('review_event_template_changed')).toContain('다른 운영자');
    expect(reviewEventTemplateError('invalid_review_event_template')).toContain('1~15자');
    expect(reviewEventTemplateError('invalid_review_event_template')).not.toContain('권한');
    expect(reviewEventTemplateError('operator_capability_required')).toContain('권한');
    expect(REVIEW_EVENT_TEMPLATES_ADMIN_PATH).toBe('/admin/cs/review-events/templates');
  });
});
